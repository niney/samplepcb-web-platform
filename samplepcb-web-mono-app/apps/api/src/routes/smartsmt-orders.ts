import type { FastifyReply } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  SmartsmtErrorBody,
  SmartsmtOrderDetailResponse,
  SmartsmtOrderListQuery,
  SmartsmtOrderListResponse,
  SmartsmtOrderOwnerQuery,
} from '@sp/api-contract';
import type { SmartsmtInboundReason, SmartsmtOrderListItemType } from '@sp/api-contract';
import { downloadFromFileServer } from '../lib/file-server';
import { SMARTSMT_REASON_MESSAGES } from '../lib/smartsmt';
import { listSmtOrdersOf, loadSmtOrderOf } from '../lib/smartsmt-orders';
import type { SmtOrderRow } from '../lib/smartsmt-orders';
import { checkSmartsmtCaller } from '../lib/smartsmt-token';

// ── /api/smartsmt/orders — SmartSMT 서버가 의뢰를 읽어 가는 주소 (docs/SMARTSMT_INTEGRATION.md §10) ──────
// 의뢰 데이터는 samplepcb 가 보관한다. SmartSMT 의 "내 의뢰 목록 · 다시 부르기 · 검토서/견적서"가 여기서 읽는다.
// 전달 규격: docs/SMARTSMT_REPLY.html 6.2.
//
//   GET /smartsmt/orders?owner=&page=&page_size=           그 회원의 의뢰 목록
//   GET /smartsmt/orders/:orderId?owner=                    한 건 — 견적서 · 확정 금액을 채운 견적서 · 작업 상태 · 파일 목록
//   GET /smartsmt/orders/:orderId/files/:part?owner=        원본 파일
//
// 인증은 견적서 전송과 같은 토큰(iss=smartsmt, aud=samplepcb)이고, 실패 본문도 같은 모양({"detail":{reason,message}})이다.
// `owner` 는 SmartSMT 가 자기 세션의 회원 아이디를 넣는다 — 우리는 그 회원의 의뢰만 내주고, 주인이 다른 의뢰는
// 없는 의뢰와 똑같이 404 로 답한다(있는지조차 알려 주지 않는다).

const Params = z.object({ orderId: z.string().min(1).max(100) });
const FileParams = Params.extend({ part: z.string().min(1).max(32) });

const errorResponses = { 400: SmartsmtErrorBody, 401: SmartsmtErrorBody, 404: SmartsmtErrorBody, 503: SmartsmtErrorBody };

const toItem = (row: SmtOrderRow): SmartsmtOrderListItemType => ({
  order_id: row.orderId,
  title: row.title,
  processes: row.processes,
  quote_id: row.quoteId,
  requested_at: row.requestedAt.toISOString(),
  review_status: row.confirmed ? 'CONFIRMED' : 'REVIEWING',
  estimated_total: row.estimatedTotal,
  confirmed_total: row.confirmedTotal,
  currency: row.currency,
});

export const smartsmtOrderRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  const fail = (reply: FastifyReply, status: 400 | 401 | 404 | 503, reason: SmartsmtInboundReason, message?: string) =>
    reply.status(status).send({ detail: { reason, message: message ?? SMARTSMT_REASON_MESSAGES[reason] } });

  // 이 플러그인의 모든 주소 — SmartSMT 전용 토큰. 비밀이 설정되지 않았으면 닫아 둔다.
  fastify.addHook('onRequest', async (request, reply) => {
    const denied = checkSmartsmtCaller(request.headers.authorization);
    if (denied !== null) return fail(reply, denied.status, denied.reason);
    return undefined;
  });

  /** owner 를 읽는다. 없거나 모양이 틀리면 400 을 보내고 null. */
  const ownerOf = (query: unknown, reply: FastifyReply): string | null => {
    const parsed = SmartsmtOrderOwnerQuery.safeParse(query);
    if (parsed.success) return parsed.data.owner;
    void fail(reply, 400, 'INVALID_REQUEST', 'owner(회원 아이디)가 없습니다');
    return null;
  };

  fastify.get(
    '/smartsmt/orders',
    { schema: { response: { 200: SmartsmtOrderListResponse, ...errorResponses } } },
    async (request, reply) => {
      // 형식이 틀린 요청도 같은 모양의 본문으로 답하려고 querystring 스키마에 맡기지 않고 여기서 읽는다.
      const query = SmartsmtOrderListQuery.safeParse(request.query);
      if (!query.success) {
        const where = query.error.issues[0]?.path.join('.') ?? '';
        return fail(reply, 400, 'INVALID_REQUEST', where === 'owner' ? 'owner(회원 아이디)가 없습니다' : `요청 값이 올바르지 않습니다 (${where})`);
      }
      const { total, items } = await listSmtOrdersOf(query.data.owner, query.data.page, query.data.page_size);
      reply.header('cache-control', 'no-store');
      return { result: true as const, data: { total, items: items.map(toItem) } };
    },
  );

  fastify.get(
    '/smartsmt/orders/:orderId',
    { schema: { params: Params, response: { 200: SmartsmtOrderDetailResponse, ...errorResponses } } },
    async (request, reply) => {
      const owner = ownerOf(request.query, reply);
      if (owner === null) return reply;
      const detail = await loadSmtOrderOf(owner, request.params.orderId);
      if (detail === null) return fail(reply, 404, 'NOT_FOUND');
      reply.header('cache-control', 'no-store');
      return {
        result: true as const,
        data: {
          order_id: detail.row.orderId,
          title: detail.row.title,
          quote_id: detail.row.quoteId,
          requested_at: detail.row.requestedAt.toISOString(),
          review_status: detail.row.confirmed ? ('CONFIRMED' as const) : ('REVIEWING' as const),
          confirmed_at: detail.confirmedAt?.toISOString() ?? null,
          customer_note: detail.customerNote,
          envelope: detail.envelope,
          confirmed_envelope: detail.confirmedEnvelope,
          state: detail.state,
          files: detail.files.map(({ part, name, bytes, sha256 }) => ({ part, name, bytes, sha256 })),
        },
      };
    },
  );

  // 원본 파일 — 파일서버를 거쳐 내준다(pathToken 을 밖에 내보내지 않는다). 본문이 파일이라 응답 스키마를 두지 않는다.
  fastify.get(
    '/smartsmt/orders/:orderId/files/:part',
    { schema: { params: FileParams } },
    async (request, reply) => {
      const owner = ownerOf(request.query, reply);
      if (owner === null) return reply;
      const detail = await loadSmtOrderOf(owner, request.params.orderId);
      const file = detail?.files.find((entry) => entry.part === request.params.part);
      if (file === undefined) return fail(reply, 404, 'NOT_FOUND', '파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return fail(reply, 404, 'NOT_FOUND', '파일을 찾을 수 없습니다');
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
        .header('cache-control', 'no-store')
        .send(downloaded.buffer);
    },
  );

  done();
};
