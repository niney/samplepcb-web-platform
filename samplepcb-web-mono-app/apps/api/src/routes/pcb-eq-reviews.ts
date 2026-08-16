import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CustomerPcbEqDecisionBody,
  CustomerPcbEqDecisionResponse,
  CustomerPcbEqReviewListQuery,
  CustomerPcbEqReviewListResponse,
  CustomerPcbProgressResponse,
} from '@sp/api-contract';
import { getCartRowsByOdId, getOrderRow } from '../lib/g5-db';
import {
  decideEqReview,
  getEqReviewFile,
  listCustomerEqReviews,
} from '../lib/pcb-eq-review';
import { getCustomerCoordFile, listCustomerPcbProgress } from '../lib/pcb-customer-progress';
import { downloadFromFileServer } from '../lib/file-server';
import { sendPcbMail, buildPcbEqCustomerDecisionEmail } from '../lib/pcb-rfq-email';
import { prisma } from '../lib/prisma';

// ── 고객 EQ 확인(P4.1) — docs/PCB_PARTNER_TRACK.md D16 ──────────────────────
// 소비처는 **sp-php 주문내역 상세**다(테마 orderinquiryview.php 가 서버사이드에서 호출).
// 회원 주문만 지원한다(사용자 결정) — 소유권을 spec.mbId 로 확실히 판정하기 위해서다.
//
// ⚠ 메일 링크는 이 라우트를 직접 부르지 않는다. 링크는 주문내역 화면을 열 뿐이고
//   결정은 화면 안에서 POST 로만 일어난다 — 메일 보안 스캐너의 링크 프리페치(GET)로
//   승인이 자동 처리되는 사고를 막는 규칙이다(설계 결정 2026-08-07).

const ReviewParams = z.object({ reviewId: z.coerce.bigint() });
const ReviewFileParams = ReviewParams.extend({ fileId: z.coerce.bigint() });
const ApiError = z.object({ error: z.string(), message: z.string() });

export const pcbEqReviewRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  /** 결정 직후 뷰를 되돌리기 위한 최소 조회 — spec 의 ctId 하나. */
  const ctIdsOfSpec = async (specId: bigint): Promise<number[]> => {
    const spec = await prisma.spOrderSpec.findUnique({
      where: { id: specId },
      select: { ctId: true },
    });
    return spec?.ctId == null ? [] : [spec.ctId];
  };

  // ── GET /pcb-eq-reviews?odId= — 내 주문의 확인 요청 ─────────────────────────
  fastify.get(
    '/pcb-eq-reviews',
    {
      schema: {
        querystring: CustomerPcbEqReviewListQuery,
        response: { 200: CustomerPcbEqReviewListResponse },
      },
    },
    async (request) => {
      // od_id → ct_id 는 g5 영역. 소유권은 그 다음 spec.mbId 로 한 번 더 판정한다.
      const rows = await getCartRowsByOdId(request.query.odId);
      const ctIds = rows.map((r) => r.ctId);
      return {
        result: true as const,
        data: { reviews: await listCustomerEqReviews(ctIds, request.user.mbId) },
      };
    },
  );

  // ── GET /pcb-progress?odId= — 내 주문의 제작 진행 단계(P4.13, od 무접촉) ─────
  // 주문이 배송·완료·취소면 항목을 내지 않는다 — 그 상태에선 코어 배송정보(운송장)가
  // 정본이라, 협력 축 파생 카드가 남아 있으면 두 상태가 서로 딴말을 한다(재점검 08-10).
  const PROGRESS_CLOSED_OD = new Set(['배송', '완료', '취소']);
  fastify.get(
    '/pcb-progress',
    {
      schema: {
        querystring: CustomerPcbEqReviewListQuery,
        response: { 200: CustomerPcbProgressResponse },
      },
    },
    async (request) => {
      const [rows, order] = await Promise.all([
        getCartRowsByOdId(request.query.odId),
        getOrderRow(request.query.odId),
      ]);
      const closed = order !== null && PROGRESS_CLOSED_OD.has(order.status);
      return {
        result: true as const,
        data: {
          // 줄 단위 취소(부분 취소)는 여기서 안 걸린다 — lib 이 ct_status 로 거른다.
          items: closed ? [] : await listCustomerPcbProgress(rows, request.user.mbId),
        },
      };
    },
  );

  // ── POST /pcb-eq-reviews/:reviewId/decide — 승인·반려 ───────────────────────
  fastify.post(
    '/pcb-eq-reviews/:reviewId/decide',
    {
      schema: {
        params: ReviewParams,
        body: CustomerPcbEqDecisionBody,
        response: { 200: CustomerPcbEqDecisionResponse, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await decideEqReview(
        request.params.reviewId,
        request.user.mbId,
        request.body.decision,
        request.body.note ?? null,
      );
      if (!outcome.ok) {
        // 답이 갈 곳을 잃은 두 경우 — 이미 답했거나(재제출), 그 사이 관리자가 EQ 를
        // 움직여 요청이 닫혔다. 뒤엣것은 화면이 낡은 것이므로 새로고침까지 안내한다.
        if (outcome.error === 'ALREADY_DECIDED' || outcome.error === 'NOT_EQ_REQUESTED') {
          return reply.status(409).send({
            error: outcome.error,
            message:
              outcome.error === 'NOT_EQ_REQUESTED'
                ? '이미 처리된 확인 요청입니다 — 화면을 새로고침해 주세요.'
                : '이미 처리된 확인 요청입니다.',
          });
        }
        return reply.notFound('확인 요청을 찾을 수 없습니다');
      }

      // 관리자에게 알림 — 고객이 답했다는 사실을 놓치면 생산이 멈춘다.
      const po = await prisma.spPcbPo.findUnique({
        where: { id: outcome.poId },
        include: { spec: { select: { projectName: true } } },
      });
      const adminEmail = (await prisma.spPartner.findFirst({ where: { type: 'house' } }))
        ?.contactEmail;
      if (po !== null && adminEmail != null && adminEmail !== '') {
        void sendPcbMail(
          request.log,
          adminEmail,
          buildPcbEqCustomerDecisionEmail({
            projectName: po.spec.projectName,
            approved: request.body.decision === 'approve',
            note: request.body.note ?? null,
            customerId: request.user.mbId,
          }),
          {
            kind: 'pcb_eq_customer_decision',
            refType: 'pcb_spec',
            refId: po.specId,
            sentBy: request.user.mbId,
            params: {
              poId: String(po.id),
              reviewId: String(request.params.reviewId),
              approved: request.body.decision === 'approve',
            },
          },
        );
      }

      const reviews = await listCustomerEqReviews(
        po?.specId === undefined ? [] : await ctIdsOfSpec(po.specId),
        request.user.mbId,
      );
      const view = reviews.find((r) => r.id === Number(request.params.reviewId));
      if (view === undefined) return reply.notFound('확인 요청을 찾을 수 없습니다');
      return { result: true as const, data: { review: view } };
    },
  );

  // ── GET /pcb-progress/coord-files/:fileId — 좌표파일(통보 없는 열람) ────────
  // D16(확인 요청)과 **다른 축**이다: 요청도 결정도 없고, 관리자가 고른 것도 아니다.
  // 종류(coord)가 곧 공개 권한이고, 단계·소유권은 lib 이 다시 판정한다 — 목록에 실렸다는
  // 사실을 신뢰하지 않는다(URL 을 직접 두드릴 수 있다).
  fastify.get(
    '/pcb-progress/coord-files/:fileId',
    { schema: { params: z.object({ fileId: z.coerce.bigint() }) } },
    async (request, reply) => {
      const file = await getCustomerCoordFile(request.params.fileId, request.user.mbId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      // 원본 파일명은 쓰지 않는다 — 협력사명이 섞여 있을 수 있다(lib 이 중립 이름을 만든다).
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.downloadName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // ── GET /pcb-eq-reviews/:reviewId/files/:fileId — 공개 첨부 ─────────────────
  fastify.get(
    '/pcb-eq-reviews/:reviewId/files/:fileId',
    { schema: { params: ReviewFileParams } },
    async (request, reply) => {
      const file = await getEqReviewFile(
        request.params.reviewId,
        request.params.fileId,
        request.user.mbId,
      );
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  done();
};
