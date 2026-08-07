import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbEqReviewCreateBody,
  AdminPcbEqReviewListResponse,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { cancelEqReview, createEqReview, listAdminEqReviews } from '../lib/pcb-eq-review';
import { getMembersByIds, getOrderInfoByCtId } from '../lib/g5-db';
import { buildPcbEqCustomerRequestEmail, sendPcbMail } from '../lib/pcb-rfq-email';
import { recordMailLog } from '../lib/mail-log';
import type { MailLogMeta } from '../lib/mail-log';

// ── 관리자 EQ 고객 확인 요청(P4.1) — docs/PCB_PARTNER_TRACK.md D16 ───────────
// 협력사 EQ 를 고객에게 물어본다. **EQ 전이는 건드리지 않는다** — 고객이 승인해도
// 상태는 eq_requested 그대로이고 eq_done 은 관리자가 별도로 누른다.
//
// 공개 파일은 관리자가 고른 것만 나간다(협력사가 올린 첨부에는 협력사명·로고가 들어
// 있을 수 있어 전체 자동 공개는 공급망을 드러낸다 — 사용자 결정 2026-08-07).

const PoParams = z.object({ poId: z.coerce.bigint() });
const ReviewParams = PoParams.extend({ reviewId: z.coerce.bigint() });
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

export const adminPcbEqReviewRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /pcb-eq-reviews/:poId — 이 발주서의 확인 요청 이력 ──────────────────
  fastify.get(
    '/pcb-eq-reviews/:poId',
    { schema: { params: PoParams, response: { 200: AdminPcbEqReviewListResponse } } },
    async (request) => ({
      result: true as const,
      data: { reviews: await listAdminEqReviews(request.params.poId) },
    }),
  );

  // ── POST /pcb-eq-reviews/:poId — 고객에게 확인 요청 보내기 ──────────────────
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

      // 메일 — 고객 주문 메일 주소로. 주문이 없으면(주문 전 발주는 없지만 방어) 회원 메일.
      const po = await prisma.spPcbPo.findUnique({
        where: { id: request.params.poId },
        include: { spec: { select: { projectName: true, ctId: true, mbId: true } } },
      });
      if (po !== null && po.spec.ctId !== null) {
        const order = await getOrderInfoByCtId(po.spec.ctId);
        const members = await getMembersByIds(po.spec.mbId === null ? [] : [po.spec.mbId]);
        const to = members.get(po.spec.mbId ?? '')?.email ?? '';
        const eqMailMeta: MailLogMeta = {
          kind: 'pcb_eq_customer_request',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          toMbId: po.spec.mbId,
          params: { poId: String(po.id), reviewId: String(outcome.reviewId) },
        };
        if (order !== null && to !== '') {
          void sendPcbMail(
            request.log,
            to,
            buildPcbEqCustomerRequestEmail({
              projectName: po.spec.projectName,
              odId: order.odId,
              reviewId: Number(outcome.reviewId),
              message: request.body.message,
              dueText: request.body.dueOn ?? null,
              fileCount: request.body.sharedFileIds.length,
            }),
            eqMailMeta,
          );
        } else {
          request.log.warn(
            { poId: Number(request.params.poId), hasOrder: order !== null, hasEmail: to !== '' },
            'EQ 고객 확인 메일 발송 생략 — 주문 또는 회원 이메일 없음',
          );
          void recordMailLog(request.log, eqMailMeta, {
            channel: 'email',
            status: 'skipped',
            reason: order === null ? 'missing_order' : 'missing_recipient',
            recipient: to,
          });
        }
      }

      return {
        result: true as const,
        data: { reviews: await listAdminEqReviews(request.params.poId) },
      };
    },
  );

  // ── DELETE /pcb-eq-reviews/:poId/:reviewId — 요청 취소(대기 중만) ───────────
  fastify.delete(
    '/pcb-eq-reviews/:poId/:reviewId',
    { schema: { params: ReviewParams, response: { 200: AdminPcbEqReviewListResponse, 404: ApiError } } },
    async (request, reply) => {
      const ok = await cancelEqReview(request.params.poId, request.params.reviewId);
      if (!ok) return reply.notFound('취소할 수 있는 확인 요청이 없습니다');
      return {
        result: true as const,
        data: { reviews: await listAdminEqReviews(request.params.poId) },
      };
    },
  );

  done();
};
