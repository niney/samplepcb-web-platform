import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomCaseDeleteBody,
  AdminBomCaseDeletePreviewResponse,
  AdminBomCaseDeleteResponse,
  AdminBomQuoteDetailResponse,
  AdminBomQuoteItemAddBody,
  AdminBomQuoteItemRemoveBody,
  AdminBomQuoteItemSelectionBody,
  AdminBomQuoteListResponse,
  AdminBomQuotePatchBody,
  ApiError,
  BomQuoteComparisonResponse,
  BomQuoteItemCandidatesResponse,
  BomQuotePrintResponse,
  BomQuoteStatus,
} from '@sp/api-contract';
import type { AdminBomQuoteCountsType } from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { downloadFromFileServer } from '../lib/file-server';
import {
  addAdminQuoteItem,
  canTransition,
  applyAdminQuoteItemSelection,
  filterActiveQuoteItems,
  getQuoteItemCandidates,
  loadQuoteComparisonPage,
  removeAdminQuoteItem,
  toAdminDetailDto,
  toAdminSummaryDto,
  toBomQuotePrintDto,
} from '../lib/bom-quote';
import { closeRfqsForQuote } from '../lib/bom-rfq';
import { loadReceivedPoCounts, loadShipmentAdminPending } from '../lib/bom-po';
import {
  getCartStates,
  getMembersByIds,
  getNotifyConfig,
  getShopEstimateProfile,
} from '../lib/g5-db';
import { buildBomQuoteAnsweredEmail, sendBomRfqMail } from '../lib/rfq-email';
import {
  BomCaseDeleteExecutionError,
  loadBomCaseDeletePlan,
  purgeBomCase,
  validateBomCaseDeleteRequest,
} from '../lib/bom-case-delete';

// 발신처 폴백(설정 미입력 로컬 등) — 빈 값이면 시트가 해당 행을 생략한다.
const EMPTY_SELLER = {
  name: '',
  owner: '',
  tel: '',
  zip: '',
  addr: '',
  managerName: '',
  managerEmail: '',
  bankAccount: '',
};

// ── /api/admin/bom-quotes — 고객 BOM 견적요청 검토 (requireAdmin) ─────────────
// 1차 범위: 목록·상세·상태 전이·확정가(운송료/관리비/총액)·메모·원본 다운로드.
// 협력사 RFQ·발주·선적 풀 워크벤치는 이 데이터 모델 위에서 후속 재설계(docs/BOM_QUOTE.md).

const IdParams = z.object({ id: z.coerce.bigint() });
const ItemParams = IdParams.extend({ itemId: z.coerce.bigint() });
const ListQuery = z.object({
  status: BomQuoteStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const ComparisonQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(5),
  search: z.string().trim().max(191).optional(),
  sheet: z.string().trim().min(1).max(191).optional(),
  status: z.enum(['matched', 'attention', 'not_found']).optional(),
});

const FILE_REF_TYPE = 'sp_bom_quote';

export const adminBomQuoteRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get('/bom-quotes', { schema: { querystring: ListQuery, response: { 200: AdminBomQuoteListResponse } } }, async (request) => {
    const { status, page, pageSize } = request.query;
    // draft 는 고객 작업중 문서 — 관리자 목록에서는 요청 이후 상태만 보인다(명시 필터 제외)
    const where = status !== undefined ? { status } : { status: { not: 'draft' } };
    const [rows, total, grouped] = await Promise.all([
      prisma.spBomQuote.findMany({
        where,
        include: {
          sheets: { select: { sheetIndex: true, selected: true } },
          items: { select: { sourceSheetIndex: true, included: true, matchStatus: true } },
        },
        orderBy: [{ requestedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.spBomQuote.count({ where }),
      // 진행현황 요약 카드·탭 — 상태별 전체 분포(상태 필터 미반영, draft 포함 집계)
      prisma.spBomQuote.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const counts: AdminBomQuoteCountsType = {
      all: 0,
      draft: 0,
      requested: 0,
      reviewing: 0,
      answered: 0,
      closed: 0,
      canceled: 0,
      shipmentPending: 0, // D22 파생 배치에서 채운다(아래)
    };
    for (const g of grouped) {
      const key = BomQuoteStatus.safeParse(g.status);
      if (!key.success) continue;
      counts[key.data] += g._count._all;
      if (key.data !== 'draft') counts.all += g._count._all;
    }
    // 주문(D16)·발주(D18)·입고(D21·§6.10 조인 기반)·관리자 차례 선적(D22)·RFQ 실황
    // (견적관리 메뉴) 파생 — batch 5회.
    const ctIds = rows.flatMap((row) => (row.ctId === null ? [] : [row.ctId]));
    const quoteIds = rows.map((row) => row.id);
    const [cartStates, poGroups, receivedCounts, shipmentPending, rfqGroups] = await Promise.all([
      getCartStates(ctIds),
      prisma.spBomPo.groupBy({
        by: ['quoteId'],
        where: { quoteId: { in: quoteIds } },
        _count: { _all: true },
      }),
      loadReceivedPoCounts(quoteIds),
      loadShipmentAdminPending(),
      prisma.spBomRfq.groupBy({
        by: ['quoteId', 'status'],
        where: { quoteId: { in: quoteIds } },
        _count: { _all: true },
      }),
    ]);
    const poCounts = new Map(poGroups.map((g) => [g.quoteId, g._count._all]));
    counts.shipmentPending = shipmentPending.total;
    const rfqCounts = new Map<bigint, { total: number; replied: number }>();
    for (const g of rfqGroups) {
      const entry = rfqCounts.get(g.quoteId) ?? { total: 0, replied: 0 };
      entry.total += g._count._all;
      if (g.status === 'quoted') entry.replied += g._count._all;
      rfqCounts.set(g.quoteId, entry);
    }
    return {
      result: true as const,
      data: {
        items: rows.map((row) =>
          toAdminSummaryDto(
            row,
            filterActiveQuoteItems(row.items, row.sheets),
            row.ctId === null ? 'none' : (cartStates.get(row.ctId) ?? 'none'),
            poCounts.get(row.id) ?? 0,
            receivedCounts.get(row.id) ?? 0,
            shipmentPending.byQuote.has(row.id.toString()),
            rfqCounts.get(row.id) ?? { total: 0, replied: 0 },
          ),
        ),
        total,
        page,
        pageSize,
        counts,
      },
    };
  });

  fastify.get('/bom-quotes/:id', { schema: { params: IdParams, response: { 200: AdminBomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id }, include: { items: true, sheets: true } });
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: quote.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(quote.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(quote, quote.items, quote.sheets, fileUrl) };
  });

  // Case 강제 영구 삭제 1단계 — 주문·결제·엔진 잡·선적·파일까지 서버가 다시 읽은 영향 프리뷰.
  // 화면 계산값을 신뢰하지 않고, 실행 시 같은 프리뷰 해시를 재검증한다.
  fastify.get(
    '/bom-quotes/:id/force-delete-preview',
    {
      schema: {
        params: IdParams,
        response: { 200: AdminBomCaseDeletePreviewResponse },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const plan = await loadBomCaseDeletePlan(request.params.id);
      if (plan === null) return reply.notFound('Case를 찾을 수 없습니다');
      return { result: true as const, data: plan.preview };
    },
  );

  // Case 강제 영구 삭제 2단계 — audited는 최소 감사행과 영카트 주문 복원행을 남기고,
  // reset은 같은 삭제 그래프를 기록 없이 정리한다. 결제 주문은 별도 force 체크로만
  // 우회하며 공유 주문과 관계 불일치는 계속 차단한다. 파일/G5는 트랜잭션 밖이라 멱등 순서로 정리한다.
  fastify.post(
    '/bom-quotes/:id/force-delete',
    {
      schema: {
        params: IdParams,
        body: AdminBomCaseDeleteBody,
        response: {
          200: AdminBomCaseDeleteResponse,
          409: ApiError,
          502: ApiError,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const plan = await loadBomCaseDeletePlan(request.params.id);
      if (plan === null) return reply.notFound('Case를 찾을 수 없습니다');

      const validationError = validateBomCaseDeleteRequest(plan.preview, request.body);
      if (validationError !== null) {
        const messages = {
          STALE_PREVIEW: '삭제 영향이 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
          DELETE_BLOCKED: '강제 결제 삭제로도 우회할 수 없는 공유 주문·실행 중 작업 또는 물류 연결 때문에 이 Case를 영구 삭제할 수 없습니다.',
        } as const;
        return reply.status(409).send({ error: validationError, message: messages[validationError] });
      }

      try {
        const data = await purgeBomCase(plan, request.body, {
          mbId: request.user.mbId,
          ip: request.ip,
        });
        if (request.body.mode === 'audited') {
          request.log.warn(
            {
              audit: 'admin_bom_case_delete',
              actor: request.user.mbId,
              quoteId: data.caseId,
              reason: request.body.reason,
              forceDeletePaidOrder: request.body.forceDeletePaidOrder === true,
              deleted: data.deleted,
            },
            '관리자 SmartBOM Case 영구 삭제',
          );
        }
        return { result: true as const, data };
      } catch (error) {
        if (error instanceof BomCaseDeleteExecutionError) {
          const code = error.code;
          if (code === 'PAID_ORDER' || code === 'ENGINE_JOB_ACTIVE' || code === 'STALE_PREVIEW') {
            return reply.status(409).send({
              error: code,
              message:
                code === 'PAID_ORDER'
                  ? '결제 주문 강제 삭제 확인이 없거나 삭제 직전 결제 상태가 변경되어 작업을 중단했습니다.'
                  : code === 'ENGINE_JOB_ACTIVE'
                    ? 'BOM 분석 또는 공급사 검색이 아직 실행 중이어서 삭제를 중단했습니다.'
                    : '삭제 중 관련 상태가 변경되었습니다. 최신 내용을 다시 확인해 주세요.',
            });
          }
        }
        request.log.error(
          {
            err: error,
            mode: request.body.mode,
            forceDeletePaidOrder: request.body.forceDeletePaidOrder === true,
          },
          'SmartBOM Case 영구 삭제 실패 — 영향 프리뷰를 다시 조회한 뒤 재시도 필요',
        );
        return reply.status(502).send({
          error: 'CASE_DELETE_FAILED',
          message: '관련 데이터 정리 중 실패했습니다. 최신 삭제 영향을 다시 확인한 뒤 재시도해 주세요.',
        });
      }
    },
  );

  fastify.get('/bom-quotes/:id/comparison', {
    schema: { params: IdParams, querystring: ComparisonQuery, response: { 200: BomQuoteComparisonResponse } },
  }, async (request, reply) => {
    const data = await loadQuoteComparisonPage(request.params.id, request.query);
    if (data === null) return reply.notFound('견적을 찾을 수 없습니다');
    return { result: true as const, data };
  });

  fastify.get('/bom-quotes/:id/items/:itemId/candidates', {
    schema: { params: ItemParams, response: { 200: BomQuoteItemCandidatesResponse } },
  }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      include: { items: true, sheets: true },
    });
    if (
      quote === null
      || !filterActiveQuoteItems(quote.items, quote.sheets).some((item) => item.id === request.params.itemId)
    ) {
      return reply.notFound('견적 항목을 찾을 수 없습니다');
    }
    const data = await getQuoteItemCandidates(request.params.id, request.params.itemId);
    if (data === null) return reply.notFound('견적 항목을 찾을 수 없습니다');
    return { result: true as const, data };
  });

  // 관리자 부품 교체 — 일반/강제 모두 후보·카탈로그 정체성만 받고 서버가 영향 정리+재계산한다.
  fastify.post('/bom-quotes/:id/items/:itemId/selection', {
    schema: {
      params: ItemParams,
      body: AdminBomQuoteItemSelectionBody,
      response: { 200: AdminBomQuoteDetailResponse, 409: ApiError },
    },
  }, async (request, reply) => {
    const result = await applyAdminQuoteItemSelection(
      request.params.id,
      request.params.itemId,
      request.body,
      request.user.mbId,
    );
    if (result !== 'ok') {
      if (result === 'quote-not-found') return reply.notFound('견적을 찾을 수 없습니다');
      if (result === 'item-not-found') return reply.notFound('견적 항목을 찾을 수 없습니다');
      const errors: Record<Exclude<typeof result, 'quote-not-found' | 'item-not-found'>, { error: string; message: string }> = {
        'stale-quote': {
          error: 'STALE_QUOTE',
          message: '견적 내용이 변경되었습니다. 최신 내용을 확인한 뒤 다시 선택해 주세요.',
        },
        'invalid-status': {
          error: 'INVALID_QUOTE_STATUS',
          message: '견적요청 또는 검토 중 상태에서만 부품을 변경할 수 있습니다.',
        },
        'quote-busy': {
          error: 'QUOTE_BUSY',
          message: 'BOM 계산이나 공급사 확인이 완료된 뒤 부품을 변경할 수 있습니다.',
        },
        'order-started': {
          error: 'ORDER_ALREADY_STARTED',
          message: '장바구니 또는 주문으로 전환된 견적의 부품은 변경할 수 없습니다.',
        },
        'po-issued': {
          error: 'PO_ALREADY_ISSUED',
          message: '발주서가 생성된 견적의 부품은 변경할 수 없습니다.',
        },
        'rfq-sent': {
          error: 'RFQ_ALREADY_SENT',
          message: '이 품목은 협력사 RFQ에 포함되어 있어 변경할 수 없습니다.',
        },
        'candidate-not-found': {
          error: 'CANDIDATE_NOT_FOUND',
          message: '선택 후보가 최신 견적에 없습니다. 후보를 새로고침해 주세요.',
        },
        'candidate-blocked': {
          error: 'CANDIDATE_BLOCKED',
          message: '기술 검토에서 차단된 후보는 선택할 수 없습니다.',
        },
        'offer-not-found': {
          error: 'OFFER_NOT_FOUND',
          message: '선택한 공급사 오퍼가 후보 스냅샷에 없습니다.',
        },
        'offer-not-priced': {
          error: 'OFFER_NOT_PRICED',
          message: '가격을 계산할 수 없는 공급사 오퍼는 선택할 수 없습니다.',
        },
        'part-not-found': {
          error: 'PART_NOT_FOUND',
          message: '선택한 카탈로그 부품을 찾을 수 없습니다.',
        },
        'catalog-offer-not-found': {
          error: 'CATALOG_OFFER_NOT_FOUND',
          message: '선택한 카탈로그 오퍼가 최신 부품 정보에 없습니다.',
        },
      };
      return reply.status(409).send(errors[result]);
    }

    const fresh = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      include: { items: true, sheets: true },
    });
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: fresh.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(fresh.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(fresh, fresh.items, fresh.sheets, fileUrl) };
  });

  // 관리자 부품 추가 — 카탈로그 정체성과 세트당 수량만 받고 현재 원장으로 가격·MOQ를 확정한다.
  fastify.post('/bom-quotes/:id/items', {
    schema: {
      params: IdParams,
      body: AdminBomQuoteItemAddBody,
      response: { 200: AdminBomQuoteDetailResponse, 409: ApiError },
    },
  }, async (request, reply) => {
    const result = await addAdminQuoteItem(
      request.params.id,
      request.body,
      request.user.mbId,
    );
    if (result !== 'ok') {
      if (result === 'quote-not-found') return reply.notFound('견적을 찾을 수 없습니다');
      const errors: Record<Exclude<typeof result, 'quote-not-found'>, { error: string; message: string }> = {
        'stale-quote': {
          error: 'STALE_QUOTE',
          message: '견적 내용이 변경되었습니다. 최신 내용을 확인한 뒤 다시 추가해 주세요.',
        },
        'invalid-status': {
          error: 'INVALID_QUOTE_STATUS',
          message: '견적요청 또는 검토 중 상태에서만 부품을 추가할 수 있습니다.',
        },
        'quote-busy': {
          error: 'QUOTE_BUSY',
          message: 'BOM 계산이나 공급사 확인이 완료된 뒤 부품을 추가할 수 있습니다.',
        },
        'order-started': {
          error: 'ORDER_ALREADY_STARTED',
          message: '장바구니 또는 주문으로 전환된 견적에 부품을 추가하려면 강제 변경 확인이 필요합니다.',
        },
        'po-issued': {
          error: 'PO_ALREADY_ISSUED',
          message: '발주서가 생성된 견적에 부품을 추가하려면 강제 변경 확인이 필요합니다.',
        },
        'rfq-sent': {
          error: 'RFQ_ALREADY_SENT',
          message: '협력사 RFQ가 발송된 견적에 부품을 추가하려면 영향 확인이 필요합니다.',
        },
        'part-not-found': {
          error: 'PART_NOT_FOUND',
          message: '선택한 카탈로그 부품을 찾을 수 없습니다.',
        },
        'catalog-offer-not-found': {
          error: 'CATALOG_OFFER_NOT_FOUND',
          message: '선택한 카탈로그 오퍼가 최신 부품 정보에 없습니다.',
        },
        'offer-not-priced': {
          error: 'OFFER_NOT_PRICED',
          message: '가격을 계산할 수 없는 공급사 오퍼는 선택할 수 없습니다.',
        },
        'item-limit': {
          error: 'QUOTE_ITEM_LIMIT',
          message: '한 견적에는 최대 2,000개 품목까지 추가할 수 있습니다.',
        },
        'quantity-too-large': {
          error: 'QUOTE_ITEM_QUANTITY_TOO_LARGE',
          message: '세트 수와 MOQ를 적용한 주문 수량이 허용 범위를 초과합니다.',
        },
      };
      return reply.status(409).send(errors[result]);
    }

    const fresh = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      include: { items: true, sheets: true },
    });
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: fresh.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(fresh.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(fresh, fresh.items, fresh.sheets, fileUrl) };
  });

  // 관리자 수동 추가 행 제거 — 업로드 원본 행은 보호하고 RFQ 영향은 서버 트랜잭션으로 정리한다.
  fastify.delete('/bom-quotes/:id/items/:itemId', {
    schema: {
      params: ItemParams,
      body: AdminBomQuoteItemRemoveBody,
      response: { 200: AdminBomQuoteDetailResponse, 409: ApiError },
    },
  }, async (request, reply) => {
    const result = await removeAdminQuoteItem(
      request.params.id,
      request.params.itemId,
      request.body,
    );
    if (result !== 'ok') {
      if (result === 'quote-not-found') return reply.notFound('견적을 찾을 수 없습니다');
      if (result === 'item-not-found') return reply.notFound('견적 항목을 찾을 수 없습니다');
      const errors: Record<Exclude<typeof result, 'quote-not-found' | 'item-not-found'>, { error: string; message: string }> = {
        'stale-quote': {
          error: 'STALE_QUOTE',
          message: '견적 내용이 변경되었습니다. 최신 내용을 확인한 뒤 다시 제거해 주세요.',
        },
        'invalid-status': {
          error: 'INVALID_QUOTE_STATUS',
          message: '견적요청 또는 검토 중 상태에서만 부품을 제거할 수 있습니다.',
        },
        'quote-busy': {
          error: 'QUOTE_BUSY',
          message: 'BOM 계산이나 공급사 확인이 완료된 뒤 부품을 제거할 수 있습니다.',
        },
        'order-started': {
          error: 'ORDER_ALREADY_STARTED',
          message: '장바구니 또는 주문으로 전환된 견적의 부품을 제거하려면 강제 변경 확인이 필요합니다.',
        },
        'po-issued': {
          error: 'PO_ALREADY_ISSUED',
          message: '발주서가 생성된 견적의 부품을 제거하려면 강제 변경 확인이 필요합니다.',
        },
        'rfq-sent': {
          error: 'RFQ_ALREADY_SENT',
          message: '협력사 RFQ에 포함된 부품을 제거하려면 영향 확인이 필요합니다.',
        },
        'original-item': {
          error: 'ORIGINAL_QUOTE_ITEM',
          message: '업로드 원본 품목은 제거할 수 없습니다. 견적 포함 여부 또는 부품 교체를 사용해 주세요.',
        },
      };
      return reply.status(409).send(errors[result]);
    }

    const fresh = await prisma.spBomQuote.findUnique({
      where: { id: request.params.id },
      include: { items: true, sheets: true },
    });
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: fresh.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(fresh.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(fresh, fresh.items, fresh.sheets, fileUrl) };
  });

  // 원본 BOM 파일 다운로드(서버 경유 스트리밍 — pathToken 클라 미노출 원칙)
  fastify.get('/bom-quotes/:id/file', { schema: { params: IdParams } }, async (request, reply) => {
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: request.params.id } });
    if (file === null) return reply.notFound('원본 파일이 없습니다');
    const downloaded = await downloadFromFileServer(file.pathToken);
    if (downloaded === null) return reply.notFound('파일서버에서 파일을 찾을 수 없습니다');
    return reply
      .header('content-type', downloaded.contentType)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`)
      .send(downloaded.buffer);
  });

  // 견적서 인쇄 데이터(§6.8) — 관리자는 상태 무관(확정 전이면 화면이 "가안" 표시).
  fastify.get(
    '/bom-quotes/:id/print',
    { schema: { params: IdParams, response: { 200: BomQuotePrintResponse } } },
    async (request, reply) => {
      const quote = await prisma.spBomQuote.findUnique({
        where: { id: request.params.id },
        include: { items: true, sheets: true },
      });
      if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
      const [profile, members] = await Promise.all([
        getShopEstimateProfile(),
        getMembersByIds([quote.mbId]),
      ]);
      const customerName = members.get(quote.mbId)?.name ?? quote.mbId;
      return {
        result: true as const,
        data: toBomQuotePrintDto(
          quote,
          quote.items,
          quote.sheets,
          customerName,
          profile ?? EMPTY_SELLER,
        ),
      };
    },
  );

  // 검토 — 상태 전이 검증 + 확정가·메모. answered 전이 시 answeredAt 스탬프.
  fastify.patch('/bom-quotes/:id', { schema: { params: IdParams, body: AdminBomQuotePatchBody, response: { 200: AdminBomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

    const body = request.body;
    if (body.status !== undefined && body.status !== quote.status && !canTransition(quote.status, body.status)) {
      return reply.conflict(`전이 불가: ${quote.status} → ${body.status}`);
    }

    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.status === 'answered' && quote.answeredAt === null ? { answeredAt: new Date() } : {}),
        ...(body.adminMemo !== undefined ? { adminMemo: body.adminMemo } : {}),
        ...(body.answerNote !== undefined ? { answerNote: body.answerNote } : {}),
        ...(body.confirmedShippingFee !== undefined ? { confirmedShippingFee: body.confirmedShippingFee } : {}),
        ...(body.confirmedManagementFee !== undefined ? { confirmedManagementFee: body.confirmedManagementFee } : {}),
        ...(body.confirmedTotal !== undefined ? { confirmedTotal: body.confirmedTotal } : {}),
      },
    });

    // 고객 회신 확정/종료 시 하위 협력사 RFQ 도 마감한다(docs/SMARTBOM_PARTNER_RFQ.md §2.3).
    if (body.status === 'answered' || body.status === 'closed' || body.status === 'canceled') {
      await closeRfqsForQuote(quote.id);
    }

    const fresh = await prisma.spBomQuote.findUnique({ where: { id: quote.id }, include: { items: true, sheets: true } });
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');

    // 고객 회신 알림 — answered 로 "전이"되는 순간 1회(재저장·확정가만 수정 시엔 안 보냄).
    // 게이트는 코어 회원 알림 설정(cf_email_use) — 운영이 메일을 꺼두면 존중한다.
    if (body.status === 'answered' && quote.status !== 'answered') {
      const [notify, members] = await Promise.all([
        getNotifyConfig(),
        getMembersByIds([quote.mbId]),
      ]);
      if (notify.mailAvailable) {
        const member = members.get(quote.mbId);
        void sendBomRfqMail(
          request.log,
          member?.email,
          buildBomQuoteAnsweredEmail({
            customerName: member?.name ?? '',
            quoteTitle: fresh.title,
            quoteId: String(fresh.id),
            confirmedTotal: fresh.confirmedTotal,
          }),
        );
      }
    }
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: fresh.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(fresh.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(fresh, fresh.items, fresh.sheets, fileUrl) };
  });

  done();
};
