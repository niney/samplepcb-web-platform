// 결제 후 부품 확인 요청(D43) — 관리자 라우트. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// Case 상세 패널(요청 작성·대리 회신·적용·정산)과 스마트 BOM '부품 확인' 워크큐가 쓴다.
// 변경 계열은 모두 그 Case 의 최신 뷰(AdminBomConfirmCaseResponse)를 돌려준다 — 화면은 그대로 덮어쓴다.
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ADMIN_BOM_CONFIRM_ELIGIBILITY_LABELS,
  AdminBomConfirmApplyBody,
  AdminBomConfirmCancelBody,
  AdminBomConfirmCaseResponse,
  AdminBomConfirmCreateBody,
  AdminBomConfirmCreateResponse,
  AdminBomConfirmFollowupBody,
  AdminBomConfirmListQuery,
  AdminBomConfirmListResponse,
  AdminBomConfirmProxyAnswerBody,
  AdminBomConfirmResolveBody,
  AdminBomSettlementActionBody,
  AdminBomSettlementCancelBody,
  ApiError,
} from '@sp/api-contract';
import {
  CONFIRM_ANSWER_ERROR_MESSAGES,
  CONFIRM_MUTATION_ERROR_MESSAGES,
  SETTLEMENT_ERROR_MESSAGES,
  answerConfirmRequest,
  applyConfirmIssue,
  cancelConfirmRequest,
  cancelSettlement,
  createConfirmRequest,
  listAdminConfirms,
  loadAdminConfirmCase,
  recordConfirmFollowup,
  recordSettlementRefund,
  reduceSettlementOrder,
  resolveConfirmRequest,
  type ConfirmCreateError,
} from '../lib/bom-confirm';
import { prisma } from '../lib/prisma';

const CaseParams = z.object({ id: z.coerce.bigint() });
const RequestParams = z.object({ id: z.coerce.bigint(), requestId: z.coerce.bigint() });
const IssueParams = z.object({ id: z.coerce.bigint(), requestId: z.coerce.bigint(), issueId: z.coerce.bigint() });
const SettlementParams = z.object({ id: z.coerce.bigint(), settlementId: z.coerce.bigint() });

const REPLACEMENT_REASON_LABELS: Record<string, string> = {
  'candidate-not-found': '후보를 찾을 수 없습니다',
  'candidate-blocked': '엔진이 선택을 막은 후보입니다',
  'offer-not-found': '고른 구매 조건이 후보에 없습니다',
  'offer-not-priced': '고른 구매 조건에 가격이 없습니다',
  'part-not-found': '카탈로그 부품을 찾을 수 없습니다',
  'catalog-offer-not-found': '카탈로그 구매 조건을 찾을 수 없습니다',
  'rfq-item-not-found': '이 품목의 협력사 회신이 아닙니다',
  'not-priced': '협력사 회신에 단가가 없습니다',
  'fx-unavailable': '외화 회신에 쓸 환율이 없습니다 — 견적요청 비교 화면에서 환율을 입력해 주세요',
  'no-offer': '구매 조건이 없습니다',
  'qty-below-needed': '필요수량보다 적게 살 수 없습니다',
  'item-not-found': '품목을 찾을 수 없습니다',
  'quote-not-found': '견적을 찾을 수 없습니다',
};

function createErrorReply(reply: FastifyReply, error: ConfirmCreateError) {
  switch (error.code) {
    case 'QUOTE_NOT_FOUND':
      return reply.status(404).send({ error: error.code, message: 'Case 를 찾을 수 없습니다.' });
    case 'NOT_ORDERED':
    case 'NOT_PAID':
    case 'ORDER_CLOSED':
      return reply.status(409).send({ error: error.code, message: ADMIN_BOM_CONFIRM_ELIGIBILITY_LABELS[error.code] });
    case 'ITEM_NOT_FOUND':
      return reply.status(400).send({ error: error.code, message: `품목 #${error.quoteItemId} 은(는) 이 Case 의 주문 대상이 아닙니다.` });
    case 'ITEM_NOT_ELIGIBLE':
      return reply.status(409).send({ error: error.code, message: `품목 #${error.quoteItemId} 은(는) 이미 사급·입고 대기로 처리된 품목입니다.` });
    case 'ITEM_HAS_OPEN_ISSUE':
      return reply.status(409).send({ error: error.code, message: `품목 #${error.quoteItemId} 에는 아직 닫히지 않은 확인 요청이 있습니다.` });
    case 'DUPLICATE_ITEM':
      return reply.status(400).send({ error: error.code, message: `품목 #${error.quoteItemId} 이(가) 두 번 들어갔습니다.` });
    case 'MOQ_QTY_INVALID':
      return reply.status(400).send({ error: error.code, message: `품목 #${error.quoteItemId}: 구매 수량은 필요수량 이상이어야 합니다.` });
    case 'REPLACEMENT_UNAVAILABLE':
      return reply.status(409).send({
        error: error.code,
        message: `품목 #${error.quoteItemId}: ${REPLACEMENT_REASON_LABELS[error.reason] ?? error.reason}.`,
      });
  }
}

export const adminBomConfirmRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const caseView = async (reply: FastifyReply, quoteId: bigint) => {
    const data = await loadAdminConfirmCase(quoteId);
    if (data === null) return reply.notFound('Case 를 찾을 수 없습니다');
    return { result: true as const, data };
  };

  // ── Case 뷰 ────────────────────────────────────────────────────────────────
  fastify.get(
    '/bom-quotes/:id/confirms',
    { schema: { params: CaseParams, response: { 200: AdminBomConfirmCaseResponse } } },
    async (request, reply) => caseView(reply, request.params.id),
  );

  // ── 요청 작성 ──────────────────────────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms',
    {
      schema: {
        params: CaseParams,
        body: AdminBomConfirmCreateBody,
        response: { 200: AdminBomConfirmCreateResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await createConfirmRequest(request.log, request.params.id, request.body, request.user.mbId);
      if (!result.ok) return createErrorReply(reply, result.error);
      return { result: true as const, data: { request: result.request, mail: result.mail } };
    },
  );

  // ── 요청 취소 ──────────────────────────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms/:requestId/cancel',
    {
      schema: {
        params: RequestParams,
        body: AdminBomConfirmCancelBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await cancelConfirmRequest(
        request.params.requestId,
        request.params.id,
        request.body.expectedVersion,
        request.body.reason,
        request.user.mbId,
      );
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: CONFIRM_MUTATION_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 대리 회신(전화·메일로 받은 답) ─────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms/:requestId/answer',
    {
      schema: {
        params: RequestParams,
        body: AdminBomConfirmProxyAnswerBody,
        response: { 200: AdminBomConfirmCaseResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const owned = await prisma.spBomConfirmRequest.findFirst({
        where: { id: request.params.requestId, quoteId: request.params.id },
        select: { id: true },
      });
      if (owned === null) return reply.notFound('확인 요청을 찾을 수 없습니다');
      const { channel, ...answer } = request.body;
      const result = await answerConfirmRequest(request.log, request.params.requestId, answer, {
        role: 'admin',
        mbId: request.user.mbId,
        channel,
      });
      if (!result.ok) {
        const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'NOT_OPEN' || result.error === 'STALE_VERSION' ? 409 : 400;
        return reply.status(status).send({ error: result.error, message: CONFIRM_ANSWER_ERROR_MESSAGES[result.error] });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 적용 ───────────────────────────────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms/:requestId/issues/:issueId/apply',
    {
      schema: {
        params: IssueParams,
        body: AdminBomConfirmApplyBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await applyConfirmIssue(
        request.params.requestId,
        request.params.id,
        request.params.issueId,
        request.body,
        request.user.mbId,
      );
      if (!result.ok) {
        const base = CONFIRM_MUTATION_ERROR_MESSAGES[result.error];
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: result.detail === undefined ? base : `${base} (${REPLACEMENT_REASON_LABELS[result.detail] ?? result.detail})`,
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 분할 발송 — 나머지 부품 두 번째 발송 ───────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms/:requestId/issues/:issueId/followup',
    {
      schema: {
        params: IssueParams,
        body: AdminBomConfirmFollowupBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await recordConfirmFollowup(
        request.params.requestId,
        request.params.id,
        request.params.issueId,
        request.body,
        request.user.mbId,
      );
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: CONFIRM_MUTATION_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 처리 완료(수동) ────────────────────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/confirms/:requestId/resolve',
    {
      schema: {
        params: RequestParams,
        body: AdminBomConfirmResolveBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await resolveConfirmRequest(
        request.params.requestId,
        request.params.id,
        request.body.expectedVersion,
        request.user.mbId,
      );
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: CONFIRM_MUTATION_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 정산: 감액 → 환불 기록 / 취소 ──────────────────────────────────────────
  fastify.post(
    '/bom-quotes/:id/settlements/:settlementId/reduce',
    {
      schema: {
        params: SettlementParams,
        body: AdminBomSettlementActionBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await reduceSettlementOrder(request.params.id, request.params.settlementId, request.user.mbId);
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: SETTLEMENT_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  fastify.post(
    '/bom-quotes/:id/settlements/:settlementId/refund',
    {
      schema: {
        params: SettlementParams,
        body: AdminBomSettlementActionBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await recordSettlementRefund(
        request.params.id,
        request.params.settlementId,
        request.body.note,
        request.user.mbId,
      );
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: SETTLEMENT_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  fastify.post(
    '/bom-quotes/:id/settlements/:settlementId/cancel',
    {
      schema: {
        params: SettlementParams,
        body: AdminBomSettlementCancelBody,
        response: { 200: AdminBomConfirmCaseResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await cancelSettlement(
        request.params.id,
        request.params.settlementId,
        request.body.reason,
        request.user.mbId,
      );
      if (!result.ok) {
        return reply.status(result.error === 'NOT_FOUND' ? 404 : 409).send({
          error: result.error,
          message: SETTLEMENT_ERROR_MESSAGES[result.error],
        });
      }
      return caseView(reply, request.params.id);
    },
  );

  // ── 워크큐 ─────────────────────────────────────────────────────────────────
  fastify.get(
    '/bom-confirms',
    { schema: { querystring: AdminBomConfirmListQuery, response: { 200: AdminBomConfirmListResponse } } },
    async (request) => {
      const { items, total, counts } = await listAdminConfirms(request.query);
      return {
        result: true as const,
        data: { items, total, page: request.query.page, pageSize: request.query.pageSize, counts },
      };
    },
  );

  done();
};
