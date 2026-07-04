import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AdminCompanyNameBody,
  AdminCompanyNameResponse,
  AdminConfirmPriceBody,
  AdminConfirmPriceResponse,
  AdminDeleteBatchBody,
  AdminDeletePreviewResponse,
  AdminDeleteResponse,
  AdminEstimateResponse,
  AdminQuoteDetailResponse,
  AdminQuoteListQuery,
  AdminQuoteListResponse,
  ApiError,
} from '@sp/api-contract';
import type {
  AdminApplicantType,
  AdminDeleteOrderGroupType,
  AdminDeleteResultItemType,
  PcbProjectPayloadType,
} from '@sp/api-contract';
import { buildOptionSummary } from '../lib/option-summary';
import { downloadFromFileServer } from '../lib/file-server';
import {
  deleteUnpaidOrder,
  getCartStates,
  getMembersByIds,
  getOrderInfoByCtId,
  getShopEstimateProfile,
} from '../lib/g5-db';
import type { CartState, G5Member, OrderInfo } from '../lib/g5-db';
import { kstDateStr } from '../lib/kst';
import { prisma } from '../lib/prisma';
import { purgeQuoteData, removeCartRow } from '../lib/quote-delete';
import { signedThumbUrl } from '../lib/thumb-url';

// ── /api/admin/pcb-projects — 관리자 견적 관리 (sp-vue /app/admin/quotes) ────
// 전 사용자 견적의 목록·상세 조회와 가격 확정(rfq→quoted·조정·재확정)을 담당한다.
// GERBER_ORDER_FLOW 7장 "남은 것 ②"의 구현. 전 라우트가 requireAdmin(JWT isAdmin
// 클레임, 발급은 그누보드 me.php = cf_admin 1인) 뒤에 있고, 응답은 계약의
// response 스키마로 직렬화되어 미선언 필드(특히 sp_file.pathToken)가 구조적으로
// 탈락한다.

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const FileIdParams = z.object({ fileId: z.string().regex(/^\d+$/) });

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
      const tabWhere: Prisma.SpOrderSpecWhereInput =
        tab === 'carted' ? { ctId: { not: null } } : tab !== 'all' ? { quoteStatus: tab } : {};

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
          price: spec.finalPrice ?? quote?.autoPrice ?? null,
          cartState,
          applicant: toApplicant(
            spec.mbId,
            spec.mbId !== null ? members.get(spec.mbId) : undefined,
          ),
          createdAt: spec.createdAt.toISOString(),
          message: spec.message,
          companyName: resolveCompanyName(spec.companyName, spec.mbId, memberProfile),
          spec: spec.specJson as PcbProjectPayloadType['spec'],
          finalPrice: spec.finalPrice,
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

      const [quote, members, profile, memberProfile] = await Promise.all([
        prisma.spQuote.findUnique({ where: { id: spec.quoteId } }),
        spec.mbId !== null
          ? getMembersByIds([spec.mbId])
          : Promise.resolve(new Map<string, G5Member>()),
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
      const supply = total !== null ? Math.round(total / 1.1) : null;
      const amounts =
        total !== null && supply !== null ? { supply, vat: total - supply, total } : null;

      // 유효기간 — 확정가(finalPrice) 문서는 확정이 곧 발행 근거라 발행일+30일(레거시
      // "견적서 발행후 1개월" 관례). 자동견적 기반만 스냅샷 만료일(expiresAt)을 그대로
      // 쓴다(오래된 자동견적이 만료로 표시되는 건 정직한 상태).
      const now = new Date();
      const validUntil =
        spec.finalPrice === null && quote !== null
          ? kstDateStr(quote.expiresAt)
          : kstDateStr(new Date(now.getTime() + 30 * 24 * 3600 * 1000));

      return {
        result: true as const,
        data: {
          projectId: Number(spec.id),
          estimateNo: `Q${String(Number(spec.id))}`,
          issuedAt: kstDateStr(now),
          validUntil,
          projectName: spec.projectName,
          category: spec.category,
          orderCategory: asOrderCategory(spec.orderCategory),
          qty: spec.qty,
          optionSummary: buildOptionSummary(
            spec.specJson as PcbProjectPayloadType['spec'],
            spec.qty,
          ),
          spec: spec.specJson as PcbProjectPayloadType['spec'],
          eta: quote?.eta ?? null,
          applicant: toApplicant(
            spec.mbId,
            spec.mbId !== null ? members.get(spec.mbId) : undefined,
          ),
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
        },
      };
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
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id) },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      if (spec.status !== 'active') {
        return reply.status(409).send({
          error: 'NOT_ACTIVE',
          message: '활성 상태의 견적이 아닙니다',
        });
      }
      if (spec.ctId !== null) {
        const state = (await getCartStates([spec.ctId])).get(spec.ctId);
        if (state === 'cart') {
          return reply.status(409).send({
            error: 'IN_CART',
            message: '장바구니에 담긴 견적은 확정할 수 없습니다',
          });
        }
        if (state === 'ordered') {
          return reply.status(409).send({
            error: 'ALREADY_ORDERED',
            message: '이미 주문된 견적입니다',
          });
        }
        // cart 행이 사라진 유령 active — 쓰기 라우트이므로 사용자 lazy reconcile 과
        // 동일하게 보관함으로 정리한 뒤 거부(유령 건에 확정하는 것 방지)
        await prisma.spOrderSpec.update({
          where: { id: spec.id },
          data: { status: 'deleted' },
        });
        return reply.status(409).send({
          error: 'NOT_ACTIVE',
          message: '장바구니에서 삭제된 견적입니다 (보관함으로 이동됨)',
        });
      }

      const pricedAt = new Date();
      // 조건부 updateMany — 사용자 소프트 삭제와의 레이스 최소 방어(0건이면 409)
      const updated = await prisma.spOrderSpec.updateMany({
        where: { id: spec.id, status: 'active' },
        data: {
          finalPrice: request.body.finalPrice,
          quoteStatus: 'quoted',
          pricedBy: request.user.mbId,
          pricedAt,
        },
      });
      if (updated.count === 0) {
        return reply.status(409).send({
          error: 'NOT_ACTIVE',
          message: '활성 상태의 견적이 아닙니다',
        });
      }
      return {
        result: true as const,
        data: {
          projectId: Number(spec.id),
          quoteStatus: 'quoted' as const,
          finalPrice: request.body.finalPrice,
          pricedBy: request.user.mbId,
          pricedAt: pricedAt.toISOString(),
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

      const items = specs.map((spec) => {
        const state: CartState =
          spec.ctId !== null ? (cartStates.get(spec.ctId) ?? 'none') : 'none';
        const info = spec.ctId !== null ? (orderInfoByCtId.get(spec.ctId) ?? null) : null;
        const deletable = !(info?.isPaid ?? false);
        return {
          projectId: Number(spec.id),
          projectName: spec.projectName,
          cartState: state,
          deletable,
          blockReason: deletable ? null : ('PAID_ORDER' as const),
          fileCount: fileCountByRef.get(spec.id.toString()) ?? 0,
          removesCartRow: state === 'cart',
          deletesOrder: state === 'ordered' && info !== null && !info.isPaid,
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
      const totalFileCount = items
        .filter((i) => i.deletable)
        .reduce((sum, i) => sum + i.fileCount, 0);

      return {
        result: true as const,
        data: {
          items,
          orderGroups,
          notFound,
          summary: {
            deletableCount,
            blockedCount: items.length - deletableCount,
            totalFileCount,
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
  // 결제완료 주문이 묶인 건은 blocked. 되돌릴 수 없어 건별 감사 로그를 남긴다.
  fastify.post(
    '/pcb-projects/delete',
    {
      schema: {
        body: AdminDeleteBatchBody,
        response: { 200: AdminDeleteResponse },
      },
    },
    async (request) => {
      const { ids } = request.body;
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

      const processedOrderIds = new Set<string>();
      const results: AdminDeleteResultItemType[] = [];
      for (const spec of specs) {
        const state: CartState =
          spec.ctId !== null ? (cartStates.get(spec.ctId) ?? 'none') : 'none';
        const info = spec.ctId !== null ? (orderInfoByCtId.get(spec.ctId) ?? null) : null;
        const projectId = Number(spec.id);
        let orderDeleted = false;
        let cartRemoved = false;
        try {
          if (info?.isPaid === true) {
            results.push({ projectId, outcome: 'blocked', orderDeleted: false, cartRemoved: false });
            continue;
          }
          if (state === 'ordered' && info !== null) {
            if (!processedOrderIds.has(info.odId)) {
              const outcome = await deleteUnpaidOrder(info.odId, request.user.mbId, request.ip);
              if (outcome === 'paid') {
                // 레이스: 프리뷰 후 결제 확정됨 — 차단
                results.push({
                  projectId,
                  outcome: 'blocked',
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
          await purgeQuoteData(spec);
          results.push({ projectId, outcome: 'deleted', orderDeleted, cartRemoved });
          request.log.warn(
            {
              audit: 'admin_quote_delete',
              actor: request.user.mbId,
              projectId,
              mbId: spec.mbId,
              odId: info?.odId ?? null,
              receiptPrice: info?.receiptPrice ?? 0,
              orderDeleted,
              cartRemoved,
            },
            '관리자 견적 완전삭제',
          );
        } catch (err) {
          request.log.error({ err, projectId }, '관리자 견적 완전삭제 실패(배치 건별)');
          results.push({ projectId, outcome: 'failed', orderDeleted, cartRemoved });
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
