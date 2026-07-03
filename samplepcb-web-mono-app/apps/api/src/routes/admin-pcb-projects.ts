import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AdminConfirmPriceBody,
  AdminConfirmPriceResponse,
  AdminQuoteDetailResponse,
  AdminQuoteListQuery,
  AdminQuoteListResponse,
  ApiError,
} from '@sp/api-contract';
import type { AdminApplicantType, PcbProjectPayloadType } from '@sp/api-contract';
import { buildOptionSummary } from '../lib/option-summary';
import { downloadFromFileServer } from '../lib/file-server';
import { getCartStates, getMembersByIds } from '../lib/g5-db';
import type { CartState, G5Member } from '../lib/g5-db';
import { prisma } from '../lib/prisma';
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

      const [quote, files, cartStates, members] = await Promise.all([
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
