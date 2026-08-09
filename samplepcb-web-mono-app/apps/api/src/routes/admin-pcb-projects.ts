import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma, SpOrderSpec } from '@prisma/client';
import { z } from 'zod';
import {
  AdminCompanyNameBody,
  AdminCompanyNameResponse,
  AdminConfirmPriceBody,
  AdminConfirmPriceResponse,
  AdminDeleteBatchBody,
  AdminDeleteExecuteBody,
  AdminDeletePreviewResponse,
  AdminDeleteResponse,
  AdminEstimateResponse,
  AdminQuoteDetailResponse,
  AdminQuoteListQuery,
  AdminQuoteListResponse,
  AdminSendEstimateBody,
  AdminSendEstimateResponse,
  AdminSpecReviseBody,
  AdminSpecReviseResponse,
  ADMIN_SPEC_REVISE_BLOCK_TEXT,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminApplicantType,
  AdminDeleteOrderGroupType,
  AdminDeleteResultItemType,
  AdminEstimateType,
  PcbProjectPayloadType,
} from '@sp/api-contract';
import { splitVatIncluded } from '@sp/utils';
import { createHash } from 'node:crypto';
import { buildOptionSummary } from '../lib/option-summary';
import { calculateQuote } from '../pricing/engine';
import { getFreshPricingData } from '../pricing/live-pricing';
import { applyGerberPriceMode } from '../pricing/gerber-price-mode';
import { getGerberPriceMode } from '../lib/sp-config';
import { downloadFromFileServer } from '../lib/file-server';
import {
  deleteUnpaidOrder,
  getCartOrderLinks,
  getCartStates,
  getMembersByIds,
  getNotifyConfig,
  getOrderHeadersLite,
  getOrdererContactByOdId,
  getOrderInfoByCtId,
  getShopEstimateProfile,
  getTemplateItem,
  insertQuoteOption,
  updateCartQuoteRow,
  deleteQuoteOption,
} from '../lib/g5-db';
import type { CartState, G5Member, OrderInfo } from '../lib/g5-db';
import {
  toAdminCaseCustomer,
  trimmedOrNull,
  type CaseOrdererInput,
} from '../lib/admin-case-customer';
import { sendCompleteEstimate } from '../lib/alimtalk';
import { confirmPcbFinalPrice } from '../lib/pcb-price';
import { buildEstimateEmail } from '../lib/estimate-email';
import { kstDateStr } from '../lib/kst';
import { sendMail } from '../lib/mailer';
import { errorReason, recordMailLog } from '../lib/mail-log';
import type { MailLogMeta } from '../lib/mail-log';
import { prisma } from '../lib/prisma';
import {
  judgePcbCaseDelete,
  loadPcbTrackFacts,
  remainingBlockers,
  type PcbTrackFacts,
} from '../lib/pcb-case-delete';
import { purgeQuoteData, removeCartRow } from '../lib/quote-delete';
import { signedThumbUrl } from '../lib/thumb-url';

// ── /api/admin/pcb-projects — 관리자 견적 관리 (sp-vue /app/admin/quotes) ────
// 전 사용자 견적의 목록·상세 조회와 가격 확정(rfq→quoted·조정·재확정)을 담당한다.
// GERBER_ORDER_FLOW 7장 "남은 것 ②"의 구현. 전 라우트가 requireAdmin(JWT isAdmin
// 클레임, 발급은 그누보드 me.php = cf_admin 1인) 뒤에 있고, 응답은 계약의
// response 스키마로 직렬화되어 미선언 필드(특히 sp_file.pathToken)가 구조적으로
// 탈락한다.

// 견적 스냅샷 TTL — 고객 재견적(pcb-projects.ts)과 같은 값.
const QUOTE_TTL_HOURS = 72;

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const FileIdParams = z.object({ fileId: z.string().regex(/^\d+$/) });

// 협력 트랙 사실이 없는(= 한 번도 진입하지 않은) 스펙의 기본값.
const EMPTY_TRACK: PcbTrackFacts = { rfqs: 0, pos: 0, shipments: 0, attachments: 0, sentRfqs: 0 };

// Prisma 컬럼은 string — 계약의 리터럴 유니온으로 총함수 내로잉(직렬화 실패 방지).
const asOrderCategory = (v: string): 'sample' | 'mass' => (v === 'mass' ? 'mass' : 'sample');
const asQuoteStatus = (v: string): 'priced' | 'rfq' | 'quoted' =>
  v === 'rfq' ? 'rfq' : v === 'quoted' ? 'quoted' : 'priced';
const asSpecStatus = (v: string): 'active' | 'deleted' | 'archived' =>
  v === 'deleted' ? 'deleted' : v === 'archived' ? 'archived' : 'active';

// 신청자 합성 — mbId null(비회원)이면 null, 회원 행 소실(탈퇴)이면 mbId 만 채운다.
const toApplicant = (
  mbId: string | null,
  member: G5Member | undefined,
): AdminApplicantType | null => {
  if (mbId === null) return null;
  return {
    mbId,
    name: member?.name ?? '',
    nick: member?.nick ?? '',
    email: member?.email ?? '',
    phone: member === undefined ? '' : member.hp !== '' ? member.hp : member.tel,
  };
};

// 수신처 회사명 해석(2층 구조) — 문서 스냅샷(spec.companyName) 우선, 없고 회원이면
// 회원 프로필(SpMemberProfile) fallback. 프로필 조회는 스냅샷이 null 이고 mbId 가 있을
// 때만 하므로, 그 외엔 profile 이 null 로 전달돼 결과도 null 이 된다.
const resolveCompanyName = (
  snapshot: string | null,
  mbId: string | null,
  profile: { companyName: string | null } | null,
): string | null => snapshot ?? (mbId !== null ? (profile?.companyName ?? null) : null);

// 마이그레이션 이관 레코드의 specJson 에는 내부 메타 `_legacy`(itId·odId·supplyPrice·
// memberContact 등 객체)가 섞여 있다. PcbProjectSpec 은 catchall 이 스칼라(string|number)만
// 허용하므로 이 객체가 응답 직렬화를 깨뜨리고(FST_ERR_RESPONSE_SERIALIZATION), 게다가
// `_legacy.memberContact.mail` 은 PII 다. 클라이언트 응답 spec 에는 언더스코어 프리픽스
// 내부 키를 제거한 사용자 사양만 싣는다(스키마 정합 + 개인정보 보호). spec 을 응답에 싣는
// 라우트(상세·견적서)에서만 쓴다 — buildOptionSummary 는 알려진 키만 읽어 영향 없음.
function toClientSpec(specJson: unknown): PcbProjectPayloadType['spec'] {
  if (typeof specJson !== 'object' || specJson === null) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(specJson as Record<string, unknown>)) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out as PcbProjectPayloadType['spec'];
}

// GET /estimate(화면 시트)와 POST /send-estimate(메일 본문)가 공유하는 견적서 표시 데이터
// 조립 — 두 매체가 같은 뷰모델(AdminEstimate)을 쓰도록 단일화(드리프트 방지). 금액은
// 부가세 역산(가격 미확정 rfq 면 amounts=null), 발신처는 g5_shop_default 재사용(한정 예외 ⑦).
// status 무제한 — 발송 가능 여부(rfq 차단 등)는 호출 라우트가 판단한다.
async function assembleEstimateData(spec: SpOrderSpec): Promise<AdminEstimateType> {
  const [quote, members, profile, memberProfile] = await Promise.all([
    prisma.spQuote.findUnique({ where: { id: spec.quoteId } }),
    spec.mbId !== null ? getMembersByIds([spec.mbId]) : Promise.resolve(new Map<string, G5Member>()),
    getShopEstimateProfile(),
    // 수신처 회사명 프로필 fallback — 스냅샷이 없고 회원일 때만(2층 구조 해석 규칙)
    spec.companyName === null && spec.mbId !== null
      ? prisma.spMemberProfile.findUnique({
          where: { mbId: spec.mbId },
          select: { companyName: true },
        })
      : Promise.resolve(null),
  ]);

  // 부가세 정석 역산 — 합계(부가세 포함) 기준 공급가액·부가세를 서버가 계산.
  const total = spec.finalPrice ?? quote?.autoPrice ?? null;
  const amounts = total !== null ? splitVatIncluded(total) : null;

  // 유효기간 — 확정가(finalPrice) 문서는 발행일+30일(레거시 "발행후 1개월"), 자동견적 기반만
  // 스냅샷 만료일(expiresAt)을 그대로 쓴다(오래된 자동견적이 만료로 표시되는 건 정직한 상태).
  const now = new Date();
  const validUntil =
    spec.finalPrice === null && quote !== null
      ? kstDateStr(quote.expiresAt)
      : kstDateStr(new Date(now.getTime() + 30 * 24 * 3600 * 1000));

  return {
    projectId: Number(spec.id),
    estimateNo: `Q${String(Number(spec.id))}`,
    issuedAt: kstDateStr(now),
    validUntil,
    projectName: spec.projectName,
    category: spec.category,
    orderCategory: asOrderCategory(spec.orderCategory),
    qty: spec.qty,
    optionSummary: buildOptionSummary(spec.specJson as PcbProjectPayloadType['spec'], spec.qty),
    spec: toClientSpec(spec.specJson),
    eta: quote?.eta ?? null,
    applicant: toApplicant(spec.mbId, spec.mbId !== null ? members.get(spec.mbId) : undefined),
    companyName: resolveCompanyName(spec.companyName, spec.mbId, memberProfile),
    amounts,
    company: {
      name: profile?.name ?? '',
      owner: profile?.owner ?? '',
      tel: profile?.tel ?? '',
      zip: profile?.zip ?? '',
      addr: profile?.addr ?? '',
      managerName: profile?.managerName ?? '',
      managerEmail: profile?.managerEmail ?? '',
      bankAccount: profile?.bankAccount ?? '',
    },
  };
}

export const adminPcbProjectRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 전 라우트 관리자 전용 — 라우트별 preHandler 누락 사고를 원천 차단
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/pcb-projects — 전 사용자 견적 목록 ─────────────────────
  // 오프셋 페이지네이션(월 ~500건 규모 + "총 건수/페이지 점프" 관리 UX 표준).
  // counts 는 탭 미반영·나머지 필터 반영(= 현재 필터 집합의 분포), total 만 탭 반영.
  // ⚠ 사용자 목록의 lazy reconcile 은 여기서 하지 않는다 — 읽기 요청이 타 사용자
  //   데이터를 변경하지 않도록. 유령 건(ctId 있는데 cart 행 없음)은 cartState 'none'
  //   으로 보일 뿐이고, 사용자 다음 방문 또는 가격 확정 시도 시점에 정리된다.
  fastify.get(
    '/pcb-projects',
    {
      schema: {
        querystring: AdminQuoteListQuery,
        response: { 200: AdminQuoteListResponse },
      },
    },
    async (request) => {
      const { page, pageSize, tab, status, category, q } = request.query;

      // 신청일 필터 — 견적은 한국 업무 기준이라 KST(+09:00) 고정 해석, to 는 해당 일 포함
      const fromDate =
        request.query.from !== undefined
          ? new Date(`${request.query.from}T00:00:00+09:00`)
          : undefined;
      const toDate =
        request.query.to !== undefined
          ? new Date(new Date(`${request.query.to}T00:00:00+09:00`).getTime() + 24 * 3600 * 1000)
          : undefined;

      const keyword = q?.trim() ?? '';
      const where: Prisma.SpOrderSpecWhereInput = {
        ...(status !== 'all' ? { status } : {}),
        ...(category !== undefined && category !== '' ? { category } : {}),
        ...(keyword !== ''
          ? { OR: [{ mbId: { contains: keyword } }, { projectName: { contains: keyword } }] }
          : {}),
        ...(fromDate !== undefined || toDate !== undefined
          ? {
              createdAt: {
                ...(fromDate !== undefined ? { gte: fromDate } : {}),
                ...(toDate !== undefined ? { lt: toDate } : {}),
              },
            }
          : {}),
      };
      // ⚠ PCB 전용이던 preorder 탭은 회수했다(2026-08-05) — PCB 진행현황·대기 큐가
      //   /api/admin/pcb-cases(스펙 축 SQL)로 옮겨가며 유령 판정도 그쪽 LEFT JOIN 이
      //   자연히 처리한다. 코어 견적 관리 계약에 PCB 개념을 남기지 않는다.
      const tabWhere: Prisma.SpOrderSpecWhereInput =
        tab === 'carted'
          ? { ctId: { not: null } }
          : tab !== 'all'
            ? { quoteStatus: tab }
            : {};

      const [specs, total, grouped, cartedCount, allCount] = await Promise.all([
        prisma.spOrderSpec.findMany({
          where: { ...where, ...tabWhere },
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spOrderSpec.count({ where: { ...where, ...tabWhere } }),
        prisma.spOrderSpec.groupBy({ by: ['quoteStatus'], where, _count: { _all: true } }),
        prisma.spOrderSpec.count({ where: { ...where, ctId: { not: null } } }),
        prisma.spOrderSpec.count({ where }),
      ]);
      const countByStatus = new Map(grouped.map((g) => [g.quoteStatus, g._count._all]));

      // PCB 협력사 RFQ 진행 요약(P3.5) — 페이지 행 단위 enrich(관리자 직속 트랙만).
      // 회신 여부는 respondedAt 기준 — unselected 는 미회신 탈락도 포함하므로 status
      // 로 판정하지 않는다(P1 선정 시 형제 일괄 미선정 규칙).
      const rfqRows = await prisma.spPcbRfq.findMany({
        where: { specId: { in: specs.map((s) => s.id) }, parentPartnerId: 0n },
        select: { specId: true, status: true, respondedAt: true },
      });
      const rfqBySpec = new Map<string, { total: number; quoted: number; selected: boolean }>();
      for (const row of rfqRows) {
        const key = row.specId.toString();
        const agg = rfqBySpec.get(key) ?? { total: 0, quoted: 0, selected: false };
        agg.total += 1;
        if (row.respondedAt !== null) agg.quoted += 1;
        if (row.status === 'selected') agg.selected = true;
        rfqBySpec.set(key, agg);
      }

      const [cartStates, members, quotes, thumbs] = await Promise.all([
        getCartStates(specs.map((s) => s.ctId).filter((id): id is number => id !== null)),
        getMembersByIds(specs.map((s) => s.mbId).filter((id): id is string => id !== null)),
        prisma.spQuote.findMany({
          where: { id: { in: specs.map((s) => s.quoteId) } },
          select: { id: true, autoPrice: true },
        }),
        prisma.spFile.findMany({
          where: {
            refType: 'sp_order_spec',
            refId: { in: specs.map((s) => s.id) },
            fileType: 'thumbnail',
          },
          orderBy: { id: 'asc' },
          select: { id: true, refId: true },
        }),
      ]);
      const quoteById = new Map(quotes.map((qt) => [qt.id, qt]));
      const thumbByRef = new Map<string, bigint>();
      for (const t of thumbs) {
        if (!thumbByRef.has(t.refId.toString())) thumbByRef.set(t.refId.toString(), t.id);
      }

      return {
        result: true as const,
        data: {
          items: specs.map((s) => {
            const cartState: CartState =
              s.ctId !== null ? (cartStates.get(s.ctId) ?? 'none') : 'none';
            const thumbId = thumbByRef.get(s.id.toString());
            return {
              projectId: Number(s.id),
              quoteId: s.quoteId,
              projectName: s.projectName,
              category: s.category,
              orderCategory: asOrderCategory(s.orderCategory),
              qty: s.qty,
              optionSummary: buildOptionSummary(
                s.specJson as PcbProjectPayloadType['spec'],
                s.qty,
              ),
              thumbnailUrl: thumbId !== undefined ? signedThumbUrl(thumbId) : null,
              quoteStatus: asQuoteStatus(s.quoteStatus),
              status: asSpecStatus(s.status),
              price: s.finalPrice ?? quoteById.get(s.quoteId)?.autoPrice ?? null,
              cartState,
              applicant: toApplicant(s.mbId, s.mbId !== null ? members.get(s.mbId) : undefined),
              createdAt: s.createdAt.toISOString(),
              pcbRfq: rfqBySpec.get(s.id.toString()) ?? null,
            };
          }),
          total,
          page,
          pageSize,
          counts: {
            total: allCount,
            rfq: countByStatus.get('rfq') ?? 0,
            priced: countByStatus.get('priced') ?? 0,
            quoted: countByStatus.get('quoted') ?? 0,
            carted: cartedCount,
          },
        },
      };
    },
  );

  // ── GET /api/admin/pcb-projects/:id — 견적 상세 ───────────────────────────
  // status 무제한(보관함 deleted 도 열람). 파일 목록은 pathToken 을 select 자체에서
  // 배제한 안전 필드만 — 원본 다운로드는 /pcb-files/:fileId 로.
  fastify.get(
    '/pcb-projects/:id',
    {
      schema: {
        params: ProjectIdParams,
        response: { 200: AdminQuoteDetailResponse },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id) },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');

      const [quote, files, cartStates, members, memberProfile] = await Promise.all([
        prisma.spQuote.findUnique({ where: { id: spec.quoteId } }),
        prisma.spFile.findMany({
          where: { refType: 'sp_order_spec', refId: spec.id },
          orderBy: { id: 'asc' },
          select: { id: true, fileType: true, originFileName: true, size: true, writeDate: true },
        }),
        spec.ctId !== null
          ? getCartStates([spec.ctId])
          : Promise.resolve(new Map<number, CartState>()),
        spec.mbId !== null
          ? getMembersByIds([spec.mbId])
          : Promise.resolve(new Map<string, G5Member>()),
        // 프로필 fallback 은 스냅샷이 없고 회원일 때만 조회(2층 구조 해석 규칙)
        spec.companyName === null && spec.mbId !== null
          ? prisma.spMemberProfile.findUnique({
              where: { mbId: spec.mbId },
              select: { companyName: true },
            })
          : Promise.resolve(null),
      ]);
      const thumb = files.find((f) => f.fileType === 'thumbnail');
      const cartState: CartState =
        spec.ctId !== null ? (cartStates.get(spec.ctId) ?? 'none') : 'none';
      const price = spec.finalPrice ?? quote?.autoPrice ?? null;
      const priceAmounts = price !== null ? splitVatIncluded(price) : null;
      const applicantMember = spec.mbId !== null ? members.get(spec.mbId) : undefined;
      const applicant = toApplicant(spec.mbId, applicantMember);
      const companyName = resolveCompanyName(spec.companyName, spec.mbId, memberProfile);

      // PCB RFQ 진행 요약(P3.5) — 목록 계약(ListItem.extend)과 동일 집계.
      const detailRfqRows = await prisma.spPcbRfq.findMany({
        where: { specId: spec.id, parentPartnerId: 0n },
        select: { status: true, respondedAt: true },
      });
      const pcbRfq =
        detailRfqRows.length === 0
          ? null
          : {
              total: detailRfqRows.length,
              quoted: detailRfqRows.filter((r) => r.respondedAt !== null).length,
              selected: detailRfqRows.some((r) => r.status === 'selected'),
            };

      // 주문 요약(P3.5) — 주문됨일 때만 od 헤더를 lazy 파생(저장 없음, BOM D10 동형).
      let order: {
        odId: string;
        odStatus: string;
        isPaid: boolean;
        receiptPrice: number;
        cartPrice: number;
        settleCase: string;
        orderedAt: string | null;
        taxAmounts: {
          supply: number;
          vat: number;
          taxFree: number;
        };
      } | null = null;
      let orderer: CaseOrdererInput | null = null;
      if (spec.ctId !== null && cartState === 'ordered') {
        const link = (await getCartOrderLinks([spec.ctId])).get(spec.ctId);
        if (link?.ordered === true) {
          const [headers, ordererContact, orderBizInfo] = await Promise.all([
            getOrderHeadersLite([link.odId]),
            getOrdererContactByOdId(link.odId),
            prisma.spOrderBizInfo.findUnique({
              where: { odId: link.odId },
              select: { companyName: true },
            }),
          ]);
          const header = headers.get(link.odId);
          if (header !== undefined) {
            order = {
              odId: header.odId,
              odStatus: header.odStatus,
              isPaid: header.isPaid,
              receiptPrice: header.receiptPrice,
              cartPrice: header.cartPrice,
              settleCase: header.settleCase,
              orderedAt: header.orderedAt,
              taxAmounts: {
                supply: header.taxMny,
                vat: header.vatMny,
                taxFree: header.freeMny,
              },
            };
            if (ordererContact !== null) {
              orderer = {
                ...ordererContact,
                companyName: trimmedOrNull(orderBizInfo?.companyName) ?? companyName,
              };
            }
          }
        }
      }
      const customer = toAdminCaseCustomer({
        applicant: {
          mbId: spec.mbId,
          companyName,
          member: applicantMember,
        },
        orderer,
      });

      return {
        result: true as const,
        data: {
          projectId: Number(spec.id),
          quoteId: spec.quoteId,
          projectName: spec.projectName,
          category: spec.category,
          orderCategory: asOrderCategory(spec.orderCategory),
          qty: spec.qty,
          optionSummary: buildOptionSummary(
            spec.specJson as PcbProjectPayloadType['spec'],
            spec.qty,
          ),
          thumbnailUrl: thumb !== undefined ? signedThumbUrl(thumb.id) : null,
          quoteStatus: asQuoteStatus(spec.quoteStatus),
          status: asSpecStatus(spec.status),
          price,
          cartState,
          applicant,
          createdAt: spec.createdAt.toISOString(),
          message: spec.message,
          companyName,
          customer,
          spec: toClientSpec(spec.specJson),
          finalPrice: spec.finalPrice,
          priceAmounts,
          pricedBy: spec.pricedBy,
          pricedAt: spec.pricedAt?.toISOString() ?? null,
          ctId: spec.ctId,
          quote:
            quote === null
              ? null
              : {
                  autoPrice: quote.autoPrice,
                  eta: quote.eta,
                  priceVersion: quote.priceVersion,
                  expiresAt: quote.expiresAt.toISOString(),
                  createdAt: quote.createdAt.toISOString(),
                },
          files: files.map((f) => ({
            fileId: Number(f.id),
            fileType: f.fileType,
            originFileName: f.originFileName,
            size: Number(f.size),
            writeDate: f.writeDate.toISOString(),
          })),
          updatedAt: spec.updatedAt.toISOString(),
          pcbRfq,
          order,
        },
      };
    },
  );

  // ── GET /api/admin/pcb-projects/:id/estimate — 견적서(A4) 표시 데이터 ──────
  // 순수 표시 컴포넌트(EstimateSheet.vue)에 주입할 완성 데이터. 금액은 서버에서
  // 부가세 역산(가격 미확정 rfq 면 amounts=null), 발신처는 g5_shop_default 재사용
  // (한정 예외 ⑦). status 무제한 — 버튼 활성 판단은 FE 가 하고 서버는 데이터만 준다.
  // pathToken 은 response 스키마에 없어 구조적으로 배제된다(상세 라우트와 동일 방어).
  fastify.get(
    '/pcb-projects/:id/estimate',
    {
      schema: {
        params: ProjectIdParams,
        response: { 200: AdminEstimateResponse },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id) },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      return { result: true as const, data: await assembleEstimateData(spec) };
    },
  );

  // ── POST /api/admin/pcb-projects/:id/send-estimate — 견적서 발송(메일+알림톡) ──
  // 레거시 sendFileMail(estimate.php) 이식 — 한 번에 메일 + 알림톡을 발송한다. PDF 없이
  // 견적서를 메일 본문에 직접 임베드한다. 전송은 sp-node 직송(메일=nodemailer→로컬 Mailpit,
  // 알림톡=iwinv fetch)이라 결과를 채널별로 정직하게 반환한다. 가격 미확정(rfq=amounts null)은
  // 409(NOT_PRICED). 채널 게이트는 독립: 메일=cf_email_use, 알림톡=ALIMTALK_ENABLED(로컬 기본
  // false→실발송 0). 수신자 이메일은 body 명시 파라미터(회원 이메일 암묵 의존 금지).
  fastify.post(
    '/pcb-projects/:id/send-estimate',
    {
      schema: {
        params: ProjectIdParams,
        body: AdminSendEstimateBody,
        response: { 200: AdminSendEstimateResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id) },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');

      const data = await assembleEstimateData(spec);
      // 가격 미확정 견적은 금액이 비어 발송 의미가 없다 — 확정 요구(409).
      if (data.amounts === null) {
        return reply.status(409).send({
          error: 'NOT_PRICED',
          message: '가격이 확정되지 않은 견적은 발송할 수 없습니다',
        });
      }

      // ── 메일 채널 (게이트: cf_email_use=0 이면 보내지 않고 skipped 로 표면화) ──
      const notify = await getNotifyConfig();
      const mailMeta: MailLogMeta = {
        kind: 'estimate',
        refType: 'pcb_spec',
        refId: spec.id,
        sentBy: request.user.mbId,
        toMbId: spec.mbId,
        params: { estimateNo: data.estimateNo },
      };
      let mail: 'sent' | 'failed' | 'skipped' = 'skipped';
      let mailSubject = '';
      let mailReason: string | null = 'mail_unavailable';
      if (notify.mailAvailable) {
        const { subject, html } = buildEstimateEmail(data);
        mailSubject = subject;
        // 발신 — 발신처(g5_shop_default) 담당자 이메일, 없으면 MAIL_FROM env, 그것도 없으면 상수.
        const fromAddress =
          data.company.managerEmail !== ''
            ? data.company.managerEmail
            : (process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr');
        const fromName = data.company.name !== '' ? data.company.name : 'SamplePCB';
        try {
          await sendMail({ to: request.body.email, subject, html, fromName, fromAddress });
          mail = 'sent';
          mailReason = null;
        } catch (err) {
          request.log.error({ err }, 'estimate mail send failed');
          mail = 'failed';
          mailReason = errorReason(err);
        }
      }
      await recordMailLog(request.log, mailMeta, {
        channel: 'email',
        status: mail,
        reason: mailReason,
        recipient: request.body.email,
        subject: mailSubject,
      });

      // ── 알림톡 채널 (게이트: ALIMTALK_ENABLED, 메일과 독립) ──
      // 로컬은 ALIMTALK_ENABLED!=='true' 라 실발송 없이 skipped. 비회원(applicant null)·무효
      // 번호도 skipped. 파일명 자리는 프로젝트명(없으면 견적번호), 날짜는 발행일(YYYY.MM.DD).
      const recipientName =
        (data.applicant?.name ?? '').trim() || (data.companyName ?? '').trim() || '고객';
      const alimtalk = await sendCompleteEstimate(
        {
          phone: data.applicant?.phone ?? '',
          name: recipientName,
          filename: data.projectName !== '' ? data.projectName : data.estimateNo,
          date: data.issuedAt.replace(/-/g, '.'),
        },
        (obj, msg) => {
          request.log.info(obj, msg);
        },
      );
      await recordMailLog(request.log, mailMeta, {
        channel: 'alimtalk',
        status: alimtalk,
        // 세부 사유(비활성/무효번호/vendor 오류)는 서버 로그에 — 이력엔 대분류만.
        reason: alimtalk === 'sent' ? null : alimtalk === 'failed' ? 'send_failed' : 'alimtalk_unavailable',
        recipient: data.applicant?.phone ?? '',
      });

      return { result: true as const, data: { email: request.body.email, mail, alimtalk } };
    },
  );

  // ── PATCH /api/admin/pcb-projects/:id/price — 가격 확정 ───────────────────
  // rfq 신규 확정 · priced 수동 조정 · quoted 재확정 전부 허용. 단 cart 행과 가격이
  // 어긋나면 안 되므로 담김(cart)/주문됨(ordered)은 409 (사용자 수량 PATCH 와 동일
  // 논리). rfq 는 가격이 없어 cart 에 못 들어가므로(NOT_PRICED 가드) 항상 통과한다.
  // 확정 vs 담기 레이스: 담기는 담는 순간의 finalPrice ?? autoPrice 를 cart 행에
  // 스냅샷하므로 어느 쪽이 이겨도 데이터 오염은 없다.
  fastify.patch(
    '/pcb-projects/:id/price',
    {
      schema: {
        params: ProjectIdParams,
        body: AdminConfirmPriceBody,
        // 409 도 스키마에 선언해야 type-provider 가 reply.status(409) 를 허용한다.
        // 바디는 계약의 ApiError({error, message}) — FE 에러 매핑이 이걸 읽는다.
        response: { 200: AdminConfirmPriceResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      // 게이트·등록 코어는 lib/pcb-price.ts — "선정+확정가 한 번에"(admin-pcb-rfqs)와 공유.
      const res = await confirmPcbFinalPrice(
        BigInt(request.params.id),
        request.body.finalPrice,
        request.user.mbId,
      );
      if (res === null) return reply.notFound('프로젝트가 없습니다');
      if (!res.ok) return reply.status(res.status).send({ error: res.error, message: res.message });
      return {
        result: true as const,
        data: {
          projectId: res.projectId,
          quoteStatus: 'quoted' as const,
          finalPrice: res.finalPrice,
          pricedBy: res.pricedBy,
          pricedAt: res.pricedAt.toISOString(),
        },
      };
    },
  );

  // ── PATCH /api/admin/pcb-projects/:id/spec — 제작 사양 수정(P4.2, D17) ──────
  // 사양은 **가격의 입력**이라 따로 고칠 수 없다. 수량 변경(재견적, pcb-projects.ts
  // PATCH /:id)과 **같은 길**을 탄다: 새 sp_quote 발급(스냅샷 불변) → calculateQuote 로
  // 재계산 → quoteStatus 재판정 → 담긴 견적이면 cart 행·옵션 동기화.
  //
  // 전 필드를 수정할 수 있다(사용자 결정) — 거버 파생값(크기·층수·파일 개수)도 막지
  // 않는다. 화면이 그 사실을 경고하고, 판단은 관리자에게 맡긴다(D14 와 같은 결).
  // 차단은 둘뿐: 발주된 건(협력사와 합의된 사양) · 담긴 견적을 rfq 사양으로 바꾸는 경우
  // (장바구니 금액을 유지할 수 없다 — 고객 재견적 경로의 가드를 그대로 승계).
  fastify.patch(
    '/pcb-projects/:id/spec',
    {
      schema: {
        params: ProjectIdParams,
        body: AdminSpecReviseBody,
        response: { 200: AdminSpecReviseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id), status: { in: ['active', 'deleted'] } },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      const currentQuote = await prisma.spQuote.findUnique({ where: { id: spec.quoteId } });

      // 발주된 건은 사양이 협력사와 합의된 기록이다 — 여기서 조용히 바꾸지 않는다.
      const poCount = await prisma.spPcbPo.count({ where: { specId: spec.id } });
      if (poCount > 0) {
        return reply.status(409).send({
          error: 'PO_ISSUED',
          message: ADMIN_SPEC_REVISE_BLOCK_TEXT.PO_ISSUED,
        });
      }

      const qty = request.body.qty ?? spec.qty;
      const nextSpec = request.body.spec;
      // 라이브 가격표로 재계산 — 사양 수정의 가격이 낡은 스냅샷에 묶이지 않게(사용자 결정
      // 2026-08-07). 조회 실패 시 폴백은 live-pricing.ts 가 책임진다.
      const rawQuote = calculateQuote(
        {
          category: spec.category,
          orderCategory: spec.orderCategory,
          qty,
          spec: nextSpec,
        },
        await getFreshPricingData(request.log),
      );
      const listPrice = applyGerberPriceMode(rawQuote.listPrice, await getGerberPriceMode());

      // 담김 상태 — 고객 재견적과 같은 가드(자동견적 불가 사양은 담긴 금액을 못 지킨다).
      let cartState: CartState = 'none';
      if (spec.ctId !== null) {
        cartState = (await getCartStates([spec.ctId])).get(spec.ctId) ?? 'none';
      }
      if (cartState === 'cart' && listPrice === null) {
        return reply.status(409).send({
          error: 'REQUOTE_RFQ_IN_CART',
          message: ADMIN_SPEC_REVISE_BLOCK_TEXT.REQUOTE_RFQ_IN_CART,
        });
      }

      // 무엇이 바뀌었는지 — 화면·감사 양쪽이 쓴다. 값 비교는 문자열로(숫자·문자 혼재 스키마).
      const before = (spec.specJson ?? {}) as Record<string, unknown>;
      // 스칼라만 비교한다 — 이관 레코드의 `_legacy` 는 객체라 String() 이 '[object Object]'
      // 가 되어 늘 "바뀐 것"으로 잡힌다. 내부 키(_ 접두)는 애초에 비교 대상이 아니다.
      const text = (v: unknown): string =>
        typeof v === 'string' || typeof v === 'number' ? String(v) : '';
      const changedKeys = [...new Set([...Object.keys(before), ...Object.keys(nextSpec)])]
        .filter((k) => !k.startsWith('_'))
        .filter((k) => text(before[k]) !== text(nextSpec[k]))
        .sort();

      // 확정가는 사양이 바뀌면 근거가 사라진다 — 지우지는 않고(관리자가 판단) 낡음만 알린다.
      const previousAutoPrice = currentQuote?.autoPrice ?? null;
      // 확정(quoted)은 유지한다 — 관리자가 매긴 값이라 사양이 바뀌어도 서버가 지우지 않고
      // finalPriceStale 로 "다시 매기라"고 알리기만 한다(판단은 관리자 몫).
      const quoteStatus: 'priced' | 'rfq' | 'quoted' =
        spec.quoteStatus === 'quoted' ? 'quoted' : listPrice === null ? 'rfq' : 'priced';

      const oldQuoteId = spec.quoteId;
      const updated = await prisma.$transaction(async (tx) => {
        // 견적 스냅샷 불변 — 수정은 새 quoteId 발급으로 기록을 남긴다(고객 재견적과 동형).
        const q = await tx.spQuote.create({
          data: {
            category: spec.category,
            orderCategory: spec.orderCategory,
            qty,
            specJson: nextSpec,
            specHash: createHash('sha256').update(JSON.stringify(nextSpec)).digest('hex'),
            autoPrice: listPrice,
            eta: rawQuote.eta === '' ? null : rawQuote.eta,
            priceVersion: rawQuote.priceVersion,
            expiresAt: new Date(Date.now() + QUOTE_TTL_HOURS * 3600 * 1000),
            revisedBy: request.user.mbId,
            // 사유는 선택 — 빈 값은 null 로 둔다(빈 문자열을 남기면 "적었는데 비었다"와
            // "안 적었다"가 구분되지 않는다).
            revisedReason:
              request.body.reason === undefined || request.body.reason === ''
                ? null
                : request.body.reason,
          },
        });
        await tx.spOrderSpec.update({
          where: { id: spec.id },
          data: {
            qty,
            quoteId: q.id,
            quoteStatus,
            specJson: nextSpec,
          },
        });
        return q;
      });

      // 담긴 견적이면 cart 행·옵션을 새 견적에 맞춘다(고객 재견적과 같은 순서·같은 이유).
      if (cartState === 'cart' && spec.ctId !== null && listPrice !== null) {
        const item = await getTemplateItem(spec.category);
        if (item !== null) {
          try {
            await insertQuoteOption(item.itId, updated.id, listPrice);
            await updateCartQuoteRow(
              spec.ctId,
              updated.id,
              listPrice,
              buildOptionSummary(nextSpec, qty),
            );
            await deleteQuoteOption(item.itId, oldQuoteId);
          } catch (err) {
            request.log.error({ err, projectId: Number(spec.id) }, '사양 수정 cart 동기화 실패');
            return reply.status(409).send({
              error: 'CART_SYNC_FAILED',
              message: '장바구니 반영에 실패했습니다. 장바구니에서 빼고 다시 시도해 주세요.',
            });
          }
        }
      }

      // 이미 회신받은 협력사 견적 — 사양이 바뀌었으니 그 회신의 전제가 달라졌다(차단 아님).
      const answeredRfqCount = await prisma.spPcbRfq.count({
        where: { specId: spec.id, status: { in: ['quoted', 'selected'] } },
      });

      return {
        result: true as const,
        data: {
          quoteId: updated.id,
          quoteStatus,
          autoPrice: listPrice,
          previousAutoPrice,
          finalPriceStale: spec.finalPrice !== null && changedKeys.length > 0,
          answeredRfqCount,
          changedKeys,
        },
      };
    },
  );

  // ── PATCH /api/admin/pcb-projects/:id/company-name — 수신처 회사명 저장 ─────
  // 2층 구조: ① 스냅샷(문서층, spec.companyName) 저장 ② 값이 있고 회원이면 프로필층
  // (SpMemberProfile) 기억해 같은 회원의 다음 견적서에 프리필. 빈 값(트림 후)은 스냅샷
  // 삭제(null)이며 프로필은 건드리지 않는다(fallback 으로 프로필값이 다시 보임).
  // /price 와 달리 status/cart 가드가 없다 — 회사명은 문서 메타데이터라 담김·주문·보관
  // 상태와 무관하게 수정 가능(의도적 차이). 404(프로젝트 없음)만 방어한다.
  fastify.patch(
    '/pcb-projects/:id/company-name',
    {
      schema: {
        params: ProjectIdParams,
        body: AdminCompanyNameBody,
        response: { 200: AdminCompanyNameResponse },
      },
    },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id) },
        select: { id: true, mbId: true },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');

      const snapshot = request.body.companyName === '' ? null : request.body.companyName;

      // 스냅샷 저장(빈 값이면 null)
      await prisma.spOrderSpec.update({
        where: { id: spec.id },
        data: { companyName: snapshot },
      });

      // 값이 있고 회원이면 프로필층 갱신(upsert). 삭제(빈 값)는 프로필 불변.
      if (snapshot !== null && spec.mbId !== null) {
        await prisma.spMemberProfile.upsert({
          where: { mbId: spec.mbId },
          create: { mbId: spec.mbId, companyName: snapshot },
          update: { companyName: snapshot },
        });
      }

      // 응답도 해석 규칙 적용값 — 삭제 시(회원)엔 남아있는 프로필값이 fallback 으로 보인다.
      const memberProfile =
        snapshot === null && spec.mbId !== null
          ? await prisma.spMemberProfile.findUnique({
              where: { mbId: spec.mbId },
              select: { companyName: true },
            })
          : null;

      return {
        result: true as const,
        data: {
          projectId: Number(spec.id),
          companyName: resolveCompanyName(snapshot, spec.mbId, memberProfile),
        },
      };
    },
  );

  // ── POST /api/admin/pcb-projects/delete-preview — 배치 완전삭제 영향 프리뷰 ─
  // 선택된 견적들(ids)에 대해 "무엇이 함께 지워지는지"를 서버가 집계한다. 건별 분류
  // (삭제가능/차단=결제완료) + 견적↔주문 1:N 이라 같은 미입금 주문에 묶인 선택 견적을
  // orderGroups 로 묶고(주문 1회 삭제), 선택 안 된 형제 견적은 함께 영향받는다고 경고한다.
  // 상태 무관(active/deleted). read-only.
  fastify.post(
    '/pcb-projects/delete-preview',
    {
      schema: {
        body: AdminDeleteBatchBody,
        response: { 200: AdminDeletePreviewResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
      const specs = await prisma.spOrderSpec.findMany({
        where: { id: { in: ids.map((id) => BigInt(id)) } },
      });
      const foundIds = new Set(specs.map((s) => Number(s.id)));
      const notFound = ids.filter((id) => !foundIds.has(id));

      // cartState 배치 판정
      const ctIds = specs.map((s) => s.ctId).filter((v): v is number => v !== null);
      const cartStates = await getCartStates(ctIds);

      // 파일 수 배치(groupBy refId)
      const fileGroups =
        specs.length > 0
          ? await prisma.spFile.groupBy({
              by: ['refId'],
              where: { refType: 'sp_order_spec', refId: { in: specs.map((s) => s.id) } },
              _count: { _all: true },
            })
          : [];
      const fileCountByRef = new Map(fileGroups.map((g) => [g.refId.toString(), g._count._all]));

      // 주문됨 견적의 주문 정보(ctId별)
      const orderInfoByCtId = new Map<number, OrderInfo | null>();
      for (const spec of specs) {
        if (spec.ctId !== null && cartStates.get(spec.ctId) === 'ordered') {
          orderInfoByCtId.set(spec.ctId, await getOrderInfoByCtId(spec.ctId));
        }
      }

      // 협력 트랙 사실(RFQ·발주·선적·첨부) 배치 집계 — 차단·경고 판정의 입력.
      const trackFacts = await loadPcbTrackFacts(specs.map((s) => s.id));
      const selectedQuoteIdSet = new Set(specs.map((s) => s.quoteId));
      const unselectedSiblingCountOf = (info: OrderInfo | null): number =>
        info === null
          ? 0
          : info.siblingCarts.filter((sib) => !selectedQuoteIdSet.has(sib.ioId)).length;

      const items = specs.map((spec) => {
        const state: CartState =
          spec.ctId !== null ? (cartStates.get(spec.ctId) ?? 'none') : 'none';
        const info = spec.ctId !== null ? (orderInfoByCtId.get(spec.ctId) ?? null) : null;
        const track = trackFacts.get(spec.id.toString()) ?? EMPTY_TRACK;
        const judgement = judgePcbCaseDelete({
          spec,
          cartState: state,
          order: info,
          track,
          unselectedSiblingCount: unselectedSiblingCountOf(info),
        });
        return {
          projectId: Number(spec.id),
          projectName: spec.projectName,
          cartState: state,
          deletable: judgement.blockReasons.length === 0,
          blockReason: judgement.blockReasons[0] ?? null,
          blockReasons: judgement.blockReasons,
          warnings: judgement.warnings,
          fileCount: fileCountByRef.get(spec.id.toString()) ?? 0,
          pcb: {
            rfqs: track.rfqs,
            pos: track.pos,
            shipments: track.shipments,
            attachments: track.attachments,
          },
          isLegacy: judgement.isLegacy,
          removesCartRow: judgement.removesCartRow,
          deletesOrder: judgement.deletesOrder,
          odId: info?.odId ?? null,
          odStatus: info?.odStatus ?? null,
        };
      });

      // 같은 주문(od_id)에 묶인 선택 견적 그룹핑 — {spec, info} 로 담아 재조회 회피
      const orderedByOdId = new Map<
        string,
        { spec: (typeof specs)[number]; info: OrderInfo }[]
      >();
      for (const spec of specs) {
        if (spec.ctId === null) continue;
        const info = orderInfoByCtId.get(spec.ctId);
        if (info == null) continue;
        const group = orderedByOdId.get(info.odId) ?? [];
        group.push({ spec, info });
        orderedByOdId.set(info.odId, group);
      }

      // 미선택 형제 견적명 매핑 — io_id(=quoteId)로 sp_order_spec 조회(배치)
      const unselectedIoIds = new Set<string>();
      for (const [, group] of orderedByOdId) {
        const first = group[0];
        if (first === undefined) continue;
        const selectedQuoteIds = new Set(group.map((e) => e.spec.quoteId));
        for (const sib of first.info.siblingCarts) {
          if (!selectedQuoteIds.has(sib.ioId)) unselectedIoIds.add(sib.ioId);
        }
      }
      const nameByQuoteId = new Map<string, string>();
      if (unselectedIoIds.size > 0) {
        const rows = await prisma.spOrderSpec.findMany({
          where: { quoteId: { in: [...unselectedIoIds] } },
          select: { quoteId: true, projectName: true },
        });
        for (const r of rows) nameByQuoteId.set(r.quoteId, r.projectName);
      }

      const orderGroups: AdminDeleteOrderGroupType[] = [];
      for (const [odId, group] of orderedByOdId) {
        const first = group[0];
        if (first === undefined) continue;
        const selectedQuoteIds = new Set(group.map((e) => e.spec.quoteId));
        const unselectedSiblings = first.info.siblingCarts
          .filter((sib) => !selectedQuoteIds.has(sib.ioId))
          .map((sib) => nameByQuoteId.get(sib.ioId) ?? sib.itName);
        orderGroups.push({
          odId,
          odStatus: first.info.odStatus,
          isPaid: first.info.isPaid,
          receiptPrice: first.info.receiptPrice,
          selectedCount: group.length,
          unselectedSiblings,
        });
      }

      const deletableCount = items.filter((i) => i.deletable).length;
      // 선택분 전체 요약 — 모달이 "무엇이 막고 무엇을 각오해야 하는지"를 한 번에 읽는다.
      // 차단된 건은 전부 강제 해제 대상이라 별도 forceable 집계가 필요 없다.
      const blockReasons = [...new Set(items.flatMap((i) => i.blockReasons))];
      const warnings = [...new Set(items.flatMap((i) => i.warnings))];

      return {
        result: true as const,
        data: {
          items,
          orderGroups,
          notFound,
          summary: {
            deletableCount,
            blockedCount: items.length - deletableCount,
            blockReasons,
            warnings,
          },
        },
      };
    },
  );

  // ── POST /api/admin/pcb-projects/delete — 배치 완전삭제(1단계 즉시) ─────────
  // 소유권 없이 선택 견적들(ids)을 삭제한다(관리자 전용). 건별 순차 처리 — 전체 롤백은
  // 불가(파일서버 삭제·MyISAM 무트랜잭션)하므로 건별 결과(deleted/blocked/failed)를
  // 정직하게 보고한다. 순서: g5(미입금 주문/장바구니) 먼저 → sp_(파일→DB) 나중(재시도
  // 멱등). 견적↔주문 1:N — processedOrderIds 로 같은 od_id 주문은 1회만 삭제한다.
  // 차단은 forceDeleteAll 체크로 전부 우회되며, 체크하지 않으면 걸린 건만 blocked 로
  // 남긴다. 기본은 건별 감사행을 남기고(audited), mode='reset' 이면 감사행도 영카트
  // 주문 삭제 백업도 만들지 않는다 — "흔적 없이 지우기"까지 관리자 선택이다.
  fastify.post(
    '/pcb-projects/delete',
    {
      schema: {
        body: AdminDeleteExecuteBody,
        response: { 200: AdminDeleteResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
      const force = request.body.forceDeleteAll === true;
      const retainAudit = request.body.mode !== 'reset';
      const reason = request.body.reason ?? '';
      const specs = await prisma.spOrderSpec.findMany({
        where: { id: { in: ids.map((id) => BigInt(id)) } },
      });

      // 시작 스냅샷 — 배치 처리 중 상태가 바뀌므로(주문 삭제) 미리 확정한다
      const ctIds = specs.map((s) => s.ctId).filter((v): v is number => v !== null);
      const cartStates = await getCartStates(ctIds);
      const orderInfoByCtId = new Map<number, OrderInfo | null>();
      for (const spec of specs) {
        if (spec.ctId !== null && cartStates.get(spec.ctId) === 'ordered') {
          orderInfoByCtId.set(spec.ctId, await getOrderInfoByCtId(spec.ctId));
        }
      }
      // ⚠ 차단 판정은 프리뷰가 아니라 **여기서 다시** 한다 — 프리뷰 이후 발주·선적이
      //   생겼을 수 있고, 프리뷰를 거치지 않은 직접 호출도 막아야 한다.
      const trackFacts = await loadPcbTrackFacts(specs.map((s) => s.id));
      const selectedQuoteIdSet = new Set(specs.map((s) => s.quoteId));

      const processedOrderIds = new Set<string>();
      const results: AdminDeleteResultItemType[] = [];
      for (const spec of specs) {
        const state: CartState =
          spec.ctId !== null ? (cartStates.get(spec.ctId) ?? 'none') : 'none';
        const info = spec.ctId !== null ? (orderInfoByCtId.get(spec.ctId) ?? null) : null;
        const projectId = Number(spec.id);
        let orderDeleted = false;
        let cartRemoved = false;
        const judgement = judgePcbCaseDelete({
          spec,
          cartState: state,
          order: info,
          track: trackFacts.get(spec.id.toString()) ?? EMPTY_TRACK,
          unselectedSiblingCount:
            info === null
              ? 0
              : info.siblingCarts.filter((sib) => !selectedQuoteIdSet.has(sib.ioId)).length,
        });
        const blockers = remainingBlockers(judgement.blockReasons, force);
        try {
          if (blockers.length > 0) {
            results.push({
              projectId,
              outcome: 'blocked',
              blockReason: blockers[0] ?? null,
              orderDeleted: false,
              cartRemoved: false,
            });
            continue;
          }
          if (state === 'ordered' && info !== null) {
            if (!processedOrderIds.has(info.odId)) {
              // 강제(force)면 하드 삭제 경로 — 결제 흔적을 통과하고(allowPaymentEvidence)
              // 형제 cart 행까지 물리삭제하며(deleteAllCarts) 포인트·쿠폰·PG 로그를 정리한다.
              // 강제가 아니면 코어와 같은 소프트 경로(백업 + cart ct_status='삭제').
              // reset 모드면 g5_shop_order_delete 복원행도 만들지 않는다(감사와 같은 결).
              const outcome = await deleteUnpaidOrder(
                info.odId,
                request.user.mbId,
                request.ip,
                undefined,
                {
                  retainBackup: retainAudit,
                  ...(force ? { allowPaymentEvidence: true, deleteAllCarts: true } : {}),
                },
              );
              if (outcome === 'paid' || outcome === 'shared') {
                // 레이스: 프리뷰 후 결제 확정됨 — 차단
                results.push({
                  projectId,
                  outcome: 'blocked',
                  blockReason: outcome === 'paid' ? 'PAID_ORDER' : 'SHARED_ORDER',
                  orderDeleted: false,
                  cartRemoved: false,
                });
                continue;
              }
              processedOrderIds.add(info.odId);
              orderDeleted = outcome === 'deleted';
            }
            // 이미 처리한 od_id면 주문삭제 스킵(cart 행은 앞선 삭제가 '삭제' 처리)
          } else if (state === 'ordered' && info === null) {
            await removeCartRow(spec); // 고아 ordered — cart 물리 정리
            cartRemoved = true;
          } else if (state === 'cart') {
            await removeCartRow(spec);
            cartRemoved = true;
          }
          // 감사 원장 먼저 — spec 이 사라진 뒤엔 스냅샷을 만들 수 없다(FK 없음, 남는다).
          // reset 모드면 통째로 건너뛴다: 업무 DB에 삭제 흔적을 남기지 않는 선택.
          if (retainAudit) {
            await prisma.spDeleteAudit.create({
              data: {
                subjectType: 'pcb_case',
                subjectId: spec.id.toString(),
                title: spec.projectName,
                mbId: spec.mbId ?? '',
                subjectStatus: spec.quoteStatus,
                actorMbId: request.user.mbId,
                actorIp: request.ip,
                reason,
                snapshot: {
                  cartState: state,
                  odId: info?.odId ?? null,
                  odStatus: info?.odStatus ?? null,
                  receiptPrice: info?.receiptPrice ?? 0,
                  forceDeleteAll: force,
                  // 강제로 넘긴 차단이 무엇이었는지 — 사후 대조의 핵심 근거.
                  overriddenBlockers: [...judgement.blockReasons],
                  isLegacy: judgement.isLegacy,
                  warnings: [...judgement.warnings],
                  pcb: { ...(trackFacts.get(spec.id.toString()) ?? EMPTY_TRACK) },
                } satisfies Prisma.InputJsonValue,
              },
            });
          }
          await purgeQuoteData(spec);
          results.push({
            projectId,
            outcome: 'deleted',
            blockReason: null,
            orderDeleted,
            cartRemoved,
          });
        } catch (err) {
          request.log.error({ err, projectId }, '관리자 견적 완전삭제 실패(배치 건별)');
          results.push({
            projectId,
            outcome: 'failed',
            blockReason: null,
            orderDeleted,
            cartRemoved,
          });
        }
      }

      return {
        result: true as const,
        data: {
          results,
          summary: {
            deleted: results.filter((r) => r.outcome === 'deleted').length,
            blocked: results.filter((r) => r.outcome === 'blocked').length,
            failed: results.filter((r) => r.outcome === 'failed').length,
          },
        },
      };
    },
  );

  // ── GET /api/admin/pcb-files/:fileId — 원본 파일 다운로드 (거버 등) ────────
  // 썸네일 프록시(pcb-thumbs.ts)는 fileType='thumbnail' 고정이라 원본에 못 쓴다.
  // 거버는 고객 설계 자산 — 무인증 서명 URL 표면을 새로 만들지 않고 Bearer 뒤에
  // 둔다(SPA 가 fetch→blob 으로 저장). pathToken 은 파일서버로만 전달, 응답 미노출.
  fastify.get(
    '/pcb-files/:fileId',
    { schema: { params: FileIdParams } },
    async (request, reply) => {
      const file = await prisma.spFile.findFirst({
        where: { id: BigInt(request.params.fileId), refType: 'sp_order_spec' },
        select: { pathToken: true, originFileName: true },
      });
      if (file === null) return reply.notFound('파일이 없습니다');

      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일이 없습니다');

      return reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .type(downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  done();
};
