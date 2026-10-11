import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { autoTranslateEqComments } from '../lib/ai/pcb-eq-translate';
import {
  CustomerPcbEqAnswerBody,
  CustomerPcbEqAnswerResponse,
  CustomerPcbEqDecisionBody,
  CustomerPcbEqDecisionResponse,
  CustomerPcbEqReviewListQuery,
  CustomerPcbEqReviewListResponse,
  CustomerPcbEqReviewMineQuery,
  CustomerPcbEqReviewMineResponse,
  CustomerPcbProgressBatchBody,
  CustomerPcbProgressBatchResponse,
  CustomerPcbProgressResponse,
  CustomerOrderProgressBatchBody,
  CustomerOrderProgressBatchResponse,
  CustomerOrderProgressResponse,
} from '@sp/api-contract';
import type {
  CustomerOrderProgressOrderSummaryType,
  CustomerPcbProgressOrderSummaryType,
} from '@sp/api-contract';
import { listOrderProgressForLines, slowestOrderProgress } from '../lib/order-progress';
import { getCartOrderLinks, getCartRowsByOdId, getOrderRow } from '../lib/g5-db';
import {
  EQ_ITEMS_ERRORS,
  answerEqReview,
  decideEqReview,
  getEqReviewFile,
  listCustomerEqReviews,
  listMyEqReviews,
  type EqItemsError,
} from '../lib/pcb-eq-review';
import { eqFigureContentType } from '../lib/pcb-eq-items';
import {
  getCustomerCoordFile,
  listCustomerPcbProgress,
  slowestPcbProgress,
} from '../lib/pcb-customer-progress';
import { downloadFromFileServer } from '../lib/file-server';
import {
  buildPcbEqCustomerAnswerEmail,
  buildPcbEqCustomerDecisionEmail,
  pcbAdminCaseUrl,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
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

/** 화면이 낡은 경우의 공통 안내 — 이미 답했거나, 그 사이 관리자가 EQ 를 움직여 요청이 닫혔다. */
const STALE_MESSAGE = '이미 처리된 확인 요청입니다 — 화면을 새로고침해 주세요.';

/**
 * 고객 회신(D20) 오류 → HTTP·문구. 고객 어휘로 덮는다('제조 확인' — EQ·발주라는 말을 쓰지
 * 않는다, P4.1-b). 남의 회차·작성 중 초안은 404 로 존재를 알리지 않는다.
 */
const customerAnswerError = (error: EqItemsError): { code: 400 | 404 | 409; message: string } => {
  switch (error) {
    case 'REVIEW_NOT_FOUND':
    case 'NOT_OWNER':
      return { code: 404, message: '확인 요청을 찾을 수 없습니다.' };
    case 'NOT_REQUESTED':
    case 'NOT_EQ_REQUESTED':
      return { code: 409, message: STALE_MESSAGE };
    case 'WRONG_FORMAT':
      return { code: 409, message: '이 확인 요청은 승인·반려로 답하는 요청입니다 — 화면을 새로고침해 주세요.' };
    case 'VERSION_CONFLICT':
      return { code: 409, message: '그사이 확인 내용이 바뀌었습니다 — 화면을 새로고침한 뒤 다시 골라 주세요.' };
    default:
      return EQ_ITEMS_ERRORS[error];
  }
};

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

  // ── GET /pcb-eq-reviews/mine — 주문을 가로지르는 내 확인 요청(마이페이지) ────
  // 소비처는 sp-php `/shop/eq`(spcb/pages/eq.php). 결정은 여기서 하지 않는다 —
  // 행은 주문 상세 딥링크로 보내고, 승인·반려 폼은 orderinquiryview 한 곳에만 둔다.
  fastify.get(
    '/pcb-eq-reviews/mine',
    {
      schema: {
        querystring: CustomerPcbEqReviewMineQuery,
        response: { 200: CustomerPcbEqReviewMineResponse },
      },
    },
    async (request) => {
      const { reviews, openCount } = await listMyEqReviews(request.user.mbId, request.query.scope);
      // 주문번호는 g5 영역이라 여기서 붙인다(lib 은 sp_ 만 만진다 — 위 목록과 같은 관례).
      // 주문이 지워진 건(여정 34호)은 링크할 곳이 없으므로 odId=null 로 남는다.
      const links = await getCartOrderLinks(
        [...new Set(reviews.map((r) => r.ctId).filter((v): v is number => v !== null))],
      );
      return {
        result: true as const,
        data: {
          reviews: reviews.map((r) => ({
            ...r,
            odId: r.ctId === null ? null : (links.get(r.ctId)?.odId ?? null),
          })),
          openCount,
        },
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

  // ── GET /order-progress?odId= · POST /order-progress/batch — 트랙 공용(PCB+BOM) ──────
  // /pcb-progress 는 PCB 전용으로 남긴다(기존 여정이 읽는다). PHP 주문내역·/app/bom 은 이쪽.
  fastify.get(
    '/order-progress',
    {
      schema: {
        querystring: CustomerPcbEqReviewListQuery,
        response: { 200: CustomerOrderProgressResponse },
      },
    },
    async (request) => {
      const [rows, order] = await Promise.all([
        getCartRowsByOdId(request.query.odId),
        getOrderRow(request.query.odId),
      ]);
      const closed = order?.mbId !== request.user.mbId || PROGRESS_CLOSED_OD.has(order.status);
      return {
        result: true as const,
        data: { items: closed ? [] : await listOrderProgressForLines(rows, request.user.mbId, order.status) },
      };
    },
  );

  fastify.post(
    '/order-progress/batch',
    {
      schema: {
        body: CustomerOrderProgressBatchBody,
        response: { 200: CustomerOrderProgressBatchResponse },
      },
    },
    async (request) => {
      const orders: CustomerOrderProgressOrderSummaryType[] = [];
      for (const odId of [...new Set(request.body.odIds)]) {
        const [rows, order] = await Promise.all([getCartRowsByOdId(odId), getOrderRow(odId)]);
        if (order?.mbId !== request.user.mbId) continue;
        if (PROGRESS_CLOSED_OD.has(order.status)) continue;
        const items = await listOrderProgressForLines(rows, request.user.mbId, order.status);
        const slowest = slowestOrderProgress(items);
        if (slowest === null) continue;
        orders.push({
          odId,
          track: slowest.track,
          stage: slowest.stage,
          label: slowest.label,
          shortLabel: slowest.shortLabel,
          lineCount: items.length,
        });
      }
      return { result: true as const, data: { orders } };
    },
  );

  // ── POST /pcb-progress/batch — 주문내역 **목록**용 일괄 요약(주문마다 가장 느린 줄) ──
  // 목록 배지가 od 만 읽으면 협력 트랙이 입고까지 가도 '입금완료'다(2026-08-25 실측).
  // 소유 판정은 서버가 다시 한다 — 목록은 내 주문만 넘기지만 odId 는 아무나 적을 수 있다.
  // 접힘 규칙은 단건과 같다(배송·완료·취소면 없음). '주문'(미입금)의 우선순위는 PHP 가
  // 정한다 — 돈이 먼저라 진행이 있어도 '입금확인중'을 보인다.
  fastify.post(
    '/pcb-progress/batch',
    {
      schema: {
        body: CustomerPcbProgressBatchBody,
        response: { 200: CustomerPcbProgressBatchResponse },
      },
    },
    async (request) => {
      const orders: CustomerPcbProgressOrderSummaryType[] = [];
      for (const odId of [...new Set(request.body.odIds)]) {
        const [rows, order] = await Promise.all([getCartRowsByOdId(odId), getOrderRow(odId)]);
        if (order?.mbId !== request.user.mbId) continue;
        if (PROGRESS_CLOSED_OD.has(order.status)) continue;
        const items = await listCustomerPcbProgress(rows, request.user.mbId);
        const slowest = slowestPcbProgress(items);
        if (slowest === null) continue;
        orders.push({
          odId,
          stage: slowest.stage,
          label: slowest.label,
          shortLabel: slowest.shortLabel,
          lineCount: items.length,
        });
      }
      return { result: true as const, data: { orders } };
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
              outcome.error === 'NOT_EQ_REQUESTED' ? STALE_MESSAGE : '이미 처리된 확인 요청입니다.',
          });
        }
        // 문항형 회차(D20)는 통째 승인·반려가 없다 — 항목별 회신(/answer)으로만 답한다.
        if (outcome.error === 'WRONG_FORMAT') {
          return reply.status(409).send({
            error: outcome.error,
            message: '항목별로 회신하는 확인 요청입니다 — 화면을 새로고침해 주세요.',
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

  // ── POST /pcb-eq-reviews/:reviewId/answer — 문항형 회차(D20) 항목별 회신 ──────
  // 전 문항에 답하고 "이 답변대로 제작 진행"에 동의(agree)해야 한다 — 부분 제출은 없다.
  // 주문 상세의 POST+CSRF 브리지(sp-php)가 부른다. 메일 링크가 이 라우트를 직접 부르는 일은
  // 없다(D16 — 링크 프리페치로 답이 자동 제출되는 사고를 막는 규칙).
  fastify.post(
    '/pcb-eq-reviews/:reviewId/answer',
    {
      schema: {
        params: ReviewParams,
        body: CustomerPcbEqAnswerBody,
        response: { 200: CustomerPcbEqAnswerResponse, 400: ApiError, 404: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await answerEqReview(request.params.reviewId, request.user.mbId, {
        expectedVersion: request.body.expectedVersion,
        answers: request.body.answers,
      });
      if (!outcome.ok) {
        const mapped = customerAnswerError(outcome.error);
        return reply.status(mapped.code).send({ error: outcome.error, message: mapped.message });
      }
      // 회신이 저장됐다 — 고객 의견을 뒤에서 번역해 둔다(D20 P4). 응답을 기다리게 하지 않고, 번역이 꺼져 있거나
      // 실패해도 회신은 그대로다(협력사 화면은 원문만 보인다).
      void autoTranslateEqComments(request.params.reviewId, request.log);

      const reviews = await listCustomerEqReviews(await ctIdsOfSpec(outcome.specId), request.user.mbId);
      const view = reviews.find((r) => r.id === Number(request.params.reviewId));
      if (view === undefined) return reply.notFound('확인 요청을 찾을 수 없습니다');

      // 관리자에게 알림 — 회신을 놓치면 협력사 전달이 멈춘다. 수신처는 D16 결정 알림과 같다
      // (자사 조직 메일). 비어 있어도 발송 래퍼에 넘긴다 — 원장에 skipped(missing_recipient)로
      // 남아야 "알림이 왜 안 왔나"를 메일 이력에서 찾을 수 있다.
      const spec = await prisma.spOrderSpec.findUnique({
        where: { id: outcome.specId },
        select: { projectName: true },
      });
      const adminEmail = (await prisma.spPartner.findFirst({ where: { type: 'house' } }))
        ?.contactEmail;
      void sendPcbMail(
        request.log,
        adminEmail,
        buildPcbEqCustomerAnswerEmail({
          projectName: spec?.projectName ?? view.projectName,
          customerId: request.user.mbId,
          roundNo: view.roundNo,
          items: view.items.map((i) => ({
            no: String(i.seq + 1),
            question: i.question,
            key: i.answer?.key ?? '-',
            label: i.options.find((o) => o.key === i.answer?.key)?.label ?? null,
            comment: i.answer?.comment ?? null,
          })),
          caseUrl: pcbAdminCaseUrl(outcome.specId.toString()),
        }),
        {
          kind: 'pcb_eq_customer_decision',
          refType: 'pcb_spec',
          refId: outcome.specId,
          sentBy: request.user.mbId,
          params: {
            poId: String(outcome.poId),
            reviewId: String(request.params.reviewId),
            format: 'items',
          },
        },
      );
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

  // ── GET /pcb-eq-reviews/:reviewId/files/:fileId — 공개 첨부·공개 문항 그림 ───
  // 문항 그림(D20)은 **인라인**으로 낸다 — sp-php 브리지가 주문 상세에서 `<img>` 로 쓴다.
  // Content-Type 은 확장자 MIME(업로드 때 이미지 확장자만 받았다)이고 nosniff 를 붙인다.
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
      if (file.inline) {
        return reply
          .header(
            'content-disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
          )
          .header('content-type', eqFigureContentType(file.originFileName))
          .header('x-content-type-options', 'nosniff')
          .send(downloaded.buffer);
      }
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
