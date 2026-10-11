import type { FastifyBaseLogger, FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbEqAiAnalyzeBody,
  AdminPcbEqAiAnalyzeResponse,
  AdminPcbEqDraftCreateBody,
  AdminPcbEqDraftUpdateBody,
  AdminPcbEqFigureUploadResponse,
  AdminPcbEqProxyAnswerBody,
  AdminPcbEqReviewCreateBody,
  AdminPcbEqReviewListResponse,
  AdminPcbEqReviewResponse,
  AdminPcbEqVersionBody,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  EQ_ITEMS_ERRORS,
  cancelEqReview,
  createEqDraft,
  createEqReview,
  deleteEqFigure,
  forwardEqReview,
  getAdminEqFigure,
  kstDateText,
  listAdminEqReviews,
  loadAdminEqReview,
  proxyAnswerEqReview,
  saveEqDraft,
  sendEqDraft,
  uploadEqFigure,
  type EqItemsError,
} from '../lib/pcb-eq-review';
import { eqFigureContentType, eqItemNo } from '../lib/pcb-eq-items';
import { isEqAiEnabled, loadEqAiState } from '../lib/pcb-eq-ai';
import { EQ_ANALYSIS_ERRORS, startEqAnalysis } from '../lib/ai/pcb-eq-runner';
import { eqRoundStartOf } from '../lib/pcb-po';
import { getMembersByIds, getOrderInfoByCtId } from '../lib/g5-db';
import {
  buildPcbEqAnswerForwardedEmail,
  buildPcbEqCustomerRequestEmail,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { resolvePcbPortalCta } from '../lib/pcb-portal-cta';
import { recordMailLog } from '../lib/mail-log';
import type { MailLogMeta } from '../lib/mail-log';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';

// ── 관리자 EQ 고객 확인 요청(P4.1) — docs/PCB_PARTNER_TRACK.md D16·D20 ───────
// 협력사 EQ 를 고객에게 물어본다. **EQ 전이는 건드리지 않는다** — 고객이 승인해도
// 상태는 eq_requested 그대로이고 eq_done 은 관리자가 별도로 누른다.
//
// 공개 파일은 관리자가 고른 것만 나간다(협력사가 올린 첨부에는 협력사명·로고가 들어
// 있을 수 있어 전체 자동 공개는 공급망을 드러낸다 — 사용자 결정 2026-08-07).
//
// D20 문항형 회차 — 초안(drafts) → 편집(draft) → 그림(figures) → 발송(send) → 고객 회신 |
// 대리 회신(answer) → 협력사 전달(forward). 변경 응답은 모두 그 회차의 최신 뷰다(화면이 덮어쓴다).
//
// D20 P2 AI 분석 — 승인요청 때 자동으로 돌고(전이 라우트가 건다), 여기는 그 상태를 목록 응답에 싣고
// (ai·aiEnabled) 관리자의 [AI 분석]·[AI 다시 분석]·[AI 결과를 초안에 적용](ai-analyze)을 받는다.

const PoParams = z.object({ poId: z.coerce.bigint() });
const ReviewParams = PoParams.extend({ reviewId: z.coerce.bigint() });
const FigureParams = ReviewParams.extend({ fileId: z.coerce.bigint() });
const ApiError = z.object({ error: z.string(), message: z.string() });

const CREATE_ERROR: Record<string, { code: 400 | 404 | 409; message: string }> = {
  PO_NOT_FOUND: { code: 404, message: '발주서를 찾을 수 없습니다.' },
  NOT_EQ_REQUESTED: {
    code: 409,
    message: 'EQ 승인요청 상태에서만 고객 확인을 요청할 수 있습니다.',
  },
  ALREADY_OPEN: {
    code: 409,
    message: '이미 열린 확인 요청이 있습니다 — 취소하거나 고객 회신을 기다려 주세요.',
  },
  BAD_FILES: { code: 400, message: '이 발주서의 EQ 첨부만 공개할 수 있습니다.' },
};

const sendItemsError = (reply: FastifyReply, error: EqItemsError) => {
  const mapped = EQ_ITEMS_ERRORS[error];
  return reply.status(mapped.code).send({ error, message: mapped.message });
};

/**
 * 고객 확인 요청 메일 — 고객 주문 메일 주소로. 주문이 없으면(주문 전 발주는 없지만 방어) 생략·기록.
 * 문구형(D16 생성)과 문항형(D20 발송)이 같은 메일·같은 kind 를 쓴다 — 문항형이면 "확인할 항목 N개".
 */
const notifyCustomerEqRequest = async (
  log: FastifyBaseLogger,
  poId: bigint,
  reviewId: bigint,
  content: { message: string; dueText: string | null; fileCount: number; itemCount?: number },
  sentBy: string,
): Promise<void> => {
  const po = await prisma.spPcbPo.findUnique({
    where: { id: poId },
    include: { spec: { select: { projectName: true, ctId: true, mbId: true } } },
  });
  if (po?.spec.ctId == null) return;
  const order = await getOrderInfoByCtId(po.spec.ctId);
  const members = await getMembersByIds(po.spec.mbId === null ? [] : [po.spec.mbId]);
  const to = members.get(po.spec.mbId ?? '')?.email ?? '';
  const eqMailMeta: MailLogMeta = {
    kind: 'pcb_eq_customer_request',
    refType: 'pcb_spec',
    refId: po.specId,
    sentBy,
    toMbId: po.spec.mbId,
    params: {
      poId: String(po.id),
      reviewId: String(reviewId),
      ...(content.itemCount === undefined ? {} : { format: 'items', itemCount: content.itemCount }),
    },
  };
  if (order !== null && to !== '') {
    void sendPcbMail(
      log,
      to,
      buildPcbEqCustomerRequestEmail({
        projectName: po.spec.projectName,
        odId: order.odId,
        reviewId: Number(reviewId),
        message: content.message,
        dueText: content.dueText,
        fileCount: content.fileCount,
        ...(content.itemCount === undefined ? {} : { itemCount: content.itemCount }),
      }),
      eqMailMeta,
    );
  } else {
    log.warn(
      { poId: Number(poId), hasOrder: order !== null, hasEmail: to !== '' },
      'EQ 고객 확인 메일 발송 생략 — 주문 또는 회원 이메일 없음',
    );
    void recordMailLog(log, eqMailMeta, {
      channel: 'email',
      status: 'skipped',
      reason: order === null ? 'missing_order' : 'missing_recipient',
      recipient: to,
    });
  }
};

export const adminPcbEqReviewRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  /** 변경 응답 — 갱신된 회차 하나. 방금 쓴 행이라 없을 수 없지만, 사라졌으면 404. */
  const reviewView = async (reply: FastifyReply, poId: bigint, reviewId: bigint) => {
    const review = await loadAdminEqReview(poId, reviewId);
    if (review === null) return reply.notFound('확인 요청을 찾을 수 없습니다');
    return { result: true as const, data: { review } };
  };

  /**
   * 목록 응답 — 회차들 + 이번 승인요청의 AI 분석 상태(D20 P2). AI 상태는 **승인요청 중일 때만** 싣는다:
   * 발주가 지나간 뒤(승인·반려)에는 "분석 안 됨" 배너가 볼 일이 없는 옛 소식이다(행 칩 eqAi 와 같은 규칙).
   */
  const listPayload = async (poId: bigint) => {
    const po = await prisma.spPcbPo.findUnique({
      where: { id: poId },
      select: { status: true, eqHistory: true },
    });
    const [reviews, ai, aiEnabled] = await Promise.all([
      listAdminEqReviews(poId),
      po?.status === 'eq_requested' ? loadEqAiState(poId, eqRoundStartOf(po)) : Promise.resolve(null),
      isEqAiEnabled(),
    ]);
    return { result: true as const, data: { reviews, ai, aiEnabled } };
  };

  // ── GET /pcb-eq-reviews/:poId — 이 발주서의 확인 요청 이력 + AI 분석 상태 ────
  fastify.get(
    '/pcb-eq-reviews/:poId',
    { schema: { params: PoParams, response: { 200: AdminPcbEqReviewListResponse } } },
    async (request) => listPayload(request.params.poId),
  );

  // ── POST /pcb-eq-reviews/:poId — 고객에게 확인 요청 보내기(D16 문구형) ──────
  fastify.post(
    '/pcb-eq-reviews/:poId',
    {
      schema: {
        params: PoParams,
        body: AdminPcbEqReviewCreateBody,
        response: { 200: AdminPcbEqReviewListResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await createEqReview(
        request.params.poId,
        {
          message: request.body.message,
          ...(request.body.dueOn === undefined ? {} : { dueOn: request.body.dueOn }),
          sharedFileIds: request.body.sharedFileIds,
        },
        request.user.mbId,
      );
      if (!outcome.ok) {
        const mapped = CREATE_ERROR[outcome.error] ?? {
          code: 400 as const,
          message: '요청에 실패했습니다.',
        };
        return reply.status(mapped.code).send({ error: outcome.error, message: mapped.message });
      }

      await notifyCustomerEqRequest(
        request.log,
        request.params.poId,
        outcome.reviewId,
        {
          message: request.body.message,
          dueText: request.body.dueOn ?? null,
          fileCount: request.body.sharedFileIds.length,
        },
        request.user.mbId,
      );

      return listPayload(request.params.poId);
    },
  );

  // ── DELETE /pcb-eq-reviews/:poId/:reviewId — 요청 취소(작성 중·회신 대기만) ──
  fastify.delete(
    '/pcb-eq-reviews/:poId/:reviewId',
    { schema: { params: ReviewParams, response: { 200: AdminPcbEqReviewListResponse, 404: ApiError } } },
    async (request, reply) => {
      const ok = await cancelEqReview(
        request.params.poId,
        request.params.reviewId,
        request.user.mbId,
      );
      if (!ok) return reply.notFound('취소할 수 있는 확인 요청이 없습니다');
      return listPayload(request.params.poId);
    },
  );

  // ═══ D20 P2 AI 분석 ════════════════════════════════════════════════════════

  // ── POST /pcb-eq-reviews/:poId/ai-analyze — [AI 분석]·[AI 다시 분석]·[AI 결과를 초안에 적용] ──
  // 분석은 백그라운드로 돈다 — 202 와 잡 상태를 돌려주고, 화면은 목록 GET 의 ai 를 다시 읽는다.
  // 같은 파일·같은 설정의 1시간 안 결과는 모델을 다시 부르지 않고 쓴다(잡은 새로 서지만 곧 끝난다).
  fastify.post(
    '/pcb-eq-reviews/:poId/ai-analyze',
    {
      schema: {
        params: PoParams,
        body: AdminPcbEqAiAnalyzeBody,
        response: { 202: AdminPcbEqAiAnalyzeResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await startEqAnalysis(request.params.poId, {
        trigger: 'manual',
        actorMbId: request.user.mbId,
        replaceDraft: request.body.replaceDraft,
        log: request.log,
      });
      if (!outcome.ok) {
        const mapped = EQ_ANALYSIS_ERRORS[outcome.error];
        return reply.status(mapped.code).send({ error: outcome.error, message: mapped.message });
      }
      return reply.status(202).send({ result: true as const, data: { ai: outcome.state } });
    },
  );

  // ═══ D20 문항형 회차 ═══════════════════════════════════════════════════════

  // ── POST /pcb-eq-reviews/:poId/drafts — 초안 만들기(직접 작성 | 직전 회차에서) ──
  fastify.post(
    '/pcb-eq-reviews/:poId/drafts',
    {
      schema: {
        params: PoParams,
        body: AdminPcbEqDraftCreateBody,
        response: { 201: AdminPcbEqReviewResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await createEqDraft(request.params.poId, request.body, request.user.mbId);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      const review = await loadAdminEqReview(request.params.poId, outcome.reviewId);
      if (review === null) return reply.notFound('확인 요청을 찾을 수 없습니다');
      return reply.status(201).send({ result: true as const, data: { review } });
    },
  );

  // ── PUT /pcb-eq-reviews/:poId/:reviewId/draft — 초안 저장(통째 교체) ─────────
  fastify.put(
    '/pcb-eq-reviews/:poId/:reviewId/draft',
    {
      schema: {
        params: ReviewParams,
        body: AdminPcbEqDraftUpdateBody,
        response: { 200: AdminPcbEqReviewResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { poId, reviewId } = request.params;
      const outcome = await saveEqDraft(poId, reviewId, request.body);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      return reviewView(reply, poId, reviewId);
    },
  );

  // ── POST /pcb-eq-reviews/:poId/:reviewId/figures — 그림 올리기(초안만, multipart `file`) ──
  fastify.post(
    '/pcb-eq-reviews/:poId/:reviewId/figures',
    {
      schema: {
        params: ReviewParams,
        response: { 200: AdminPcbEqFigureUploadResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) {
        return reply.status(400).send({ error: 'BAD_UPLOAD', message: 'multipart 요청이어야 합니다.' });
      }
      const { files } = await collectMultipart(request);
      const file = files[0];
      if (file === undefined) {
        return reply.status(400).send({ error: 'BAD_UPLOAD', message: '그림 파일이 필요합니다.' });
      }
      const outcome = await uploadEqFigure(request.params.poId, request.params.reviewId, file);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      return { result: true as const, data: { figure: outcome.figure } };
    },
  );

  // ── DELETE /pcb-eq-reviews/:poId/:reviewId/figures/:fileId — 그림 지우기(초안만) ──
  fastify.delete(
    '/pcb-eq-reviews/:poId/:reviewId/figures/:fileId',
    {
      schema: {
        params: FigureParams,
        response: { 200: AdminPcbEqReviewResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { poId, reviewId, fileId } = request.params;
      const outcome = await deleteEqFigure(poId, reviewId, fileId);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      return reviewView(reply, poId, reviewId);
    },
  );

  // ── GET /pcb-eq-reviews/:poId/:reviewId/figures/:fileId — 그림 열람(인라인) ────
  fastify.get(
    '/pcb-eq-reviews/:poId/:reviewId/figures/:fileId',
    { schema: { params: FigureParams } },
    async (request, reply) => {
      const { poId, reviewId, fileId } = request.params;
      const file = await getAdminEqFigure(poId, reviewId, fileId);
      if (file === null) return reply.notFound('그림을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('그림을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `inline; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', eqFigureContentType(file.originFileName))
        .header('x-content-type-options', 'nosniff')
        .send(downloaded.buffer);
    },
  );

  // ── POST /pcb-eq-reviews/:poId/:reviewId/send — 고객에게 보내기(draft → requested) ──
  fastify.post(
    '/pcb-eq-reviews/:poId/:reviewId/send',
    {
      schema: {
        params: ReviewParams,
        body: AdminPcbEqVersionBody,
        response: { 200: AdminPcbEqReviewResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { poId, reviewId } = request.params;
      const outcome = await sendEqDraft(poId, reviewId, request.body.expectedVersion, request.user.mbId);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      const review = await loadAdminEqReview(poId, reviewId);
      if (review === null) return reply.notFound('확인 요청을 찾을 수 없습니다');
      // 메일은 링크만 — 문항·그림은 주문내역에서 본다(그림 공개 판단이 메일에서 새지 않게).
      await notifyCustomerEqRequest(
        request.log,
        poId,
        reviewId,
        {
          message: review.message,
          dueText: review.dueOn === null ? null : kstDateText(new Date(review.dueOn)),
          fileCount: 0,
          itemCount: review.items.length,
        },
        request.user.mbId,
      );
      return { result: true as const, data: { review } };
    },
  );

  // ── POST /pcb-eq-reviews/:poId/:reviewId/answer — 대리 회신(채널·근거 필수, 메일 없음) ──
  fastify.post(
    '/pcb-eq-reviews/:poId/:reviewId/answer',
    {
      schema: {
        params: ReviewParams,
        body: AdminPcbEqProxyAnswerBody,
        response: { 200: AdminPcbEqReviewResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { poId, reviewId } = request.params;
      const outcome = await proxyAnswerEqReview(poId, reviewId, request.body, request.user.mbId);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      return reviewView(reply, poId, reviewId);
    },
  );

  // ── POST /pcb-eq-reviews/:poId/:reviewId/forward — 협력사에 전달 ───────────────
  fastify.post(
    '/pcb-eq-reviews/:poId/:reviewId/forward',
    {
      schema: {
        params: ReviewParams,
        body: AdminPcbEqVersionBody,
        response: { 200: AdminPcbEqReviewResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const { poId, reviewId } = request.params;
      const outcome = await forwardEqReview(poId, reviewId, request.body.expectedVersion, request.user.mbId);
      if (!outcome.ok) return sendItemsError(reply, outcome.error);
      const review = await loadAdminEqReview(poId, reviewId);
      if (review === null) return reply.notFound('확인 요청을 찾을 수 없습니다');

      // 수신자는 EQ 승인/반려 메일(pcb_eq_decision)과 같은 해석 — 이 발주서의 수주 협력사.
      const po = await prisma.spPcbPo.findUnique({
        where: { id: poId },
        include: { partner: true, spec: { select: { projectName: true } } },
      });
      if (po !== null) {
        const portalCta = await resolvePcbPortalCta(po.partnerId, po.parentPartnerId);
        void sendPcbMail(
          request.log,
          po.partner.contactEmail,
          buildPcbEqAnswerForwardedEmail({
            partnerName: po.partner.name,
            projectName: po.spec.projectName,
            roundNo: review.roundNo ?? 1,
            poId: String(po.id),
            items: review.items.map((i) => ({
              no: eqItemNo({ factoryNo: i.factoryNo, seq: i.seq }),
              question: i.questionOrig ?? i.question,
              key: i.answer?.key ?? '-',
              label: null,
              comment: i.answer?.comment ?? null,
            })),
            ...portalCta,
          }),
          {
            kind: 'pcb_eq_answer_forwarded',
            refType: 'pcb_spec',
            refId: po.specId,
            sentBy: request.user.mbId,
            params: {
              poId: String(po.id),
              reviewId: String(reviewId),
              partnerName: po.partner.name,
              roundNo: review.roundNo ?? 1,
            },
          },
        );
      }
      return { result: true as const, data: { review } };
    },
  );

  done();
};
