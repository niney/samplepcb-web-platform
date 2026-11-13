import type { FastifyRequest } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { SmartsmtEnvelope, SmartsmtErrorBody, SmartsmtInboundAccepted } from '@sp/api-contract';
import type { SmartsmtErrorBodyType, SmartsmtInboundReason } from '@sp/api-contract';
import { clientIp } from '../lib/client-ip';
import {
  checkSmartsmtFiles,
  collectSmartsmtParts,
  recordSmartsmtReceive,
  saveSmartsmtQuote,
  smartsmtQuoteExists,
  summarizeSmartsmtEnvelope,
} from '../lib/smartsmt';
import type { SmartsmtParts, SmartsmtReceiveEntry } from '../lib/smartsmt';
import {
  SMARTSMT_PEER,
  SMARTSMT_SELF,
  readBearerToken,
  smartsmtSecret,
  verifySmartsmtToken,
} from '../lib/smartsmt-token';

// ── /api/smartsmt — SmartSMT 서버가 부르는 주소 (docs/SMARTSMT_INTEGRATION.md §4.4) ───────────
// 회원·관리자 JWT 가 아니라 SmartSMT 전용 토큰(Authorization: Bearer, HS256 2분)으로 인증한다.
// 인터넷에 열린 주소이므로 **본문을 읽기 전에**(onRequest) 인증을 끝낸다 — 인증되지 않은 요청이
// 큰 파일을 메모리에 올리지 못한다.
//
// 보내는 쪽은 재시도가 없고 2xx 만 성공으로 본다. 그래서:
//  · 거절은 인증·형식·번호 불일치·파일 대조 실패뿐이다. 모르는 코드나 모르는 칸으로는 거절하지 않는다.
//  · 같은 quote_id 가 다시 오면 덮어쓰지 않고 2xx 로 답한다.
//  · 수신 시도는 성공·실패 모두 sp_smt_receive_log 에 남긴다(보내는 쪽 화면에는 HTTP_<코드> 만 뜬다).

const MESSAGES: Record<SmartsmtInboundReason, string> = {
  NO_TOKEN: '토큰이 없습니다',
  BAD_TOKEN: '토큰을 읽을 수 없거나 서명이 맞지 않습니다',
  WRONG_AUDIENCE: '토큰의 만든 쪽 또는 받는 쪽이 맞지 않습니다',
  EXPIRED: '토큰이 만료됐습니다',
  NOT_CONFIGURED: 'SmartSMT 연동이 설정되지 않았습니다',
  INVALID_REQUEST: '요청을 읽을 수 없습니다 (multipart/form-data 여야 합니다)',
  TOO_LARGE: '파일 또는 견적서가 허용 크기를 넘습니다',
  INVALID_ENVELOPE: '견적서(envelope)가 없거나 꼭 있어야 하는 칸이 없습니다',
  ID_MISMATCH: 'quote_id 또는 order_id 가 견적서 안의 값과 다릅니다',
  FILE_MISMATCH: '동봉 파일이 견적서의 파일 목록과 다릅니다',
  FILE_STORE_FAILED: '동봉 파일을 저장하지 못했습니다. 다시 보내 주십시오',
};

const startedAt = new WeakMap<object, number>();

const requestMeta = (request: FastifyRequest): Pick<SmartsmtReceiveEntry, 'bytes' | 'durationMs' | 'remoteAddr'> => {
  const length = Number(request.headers['content-length']);
  return {
    bytes: Number.isFinite(length) && length >= 0 ? length : null,
    durationMs: performance.now() - (startedAt.get(request) ?? performance.now()),
    // nginx 뒤라 request.ip 는 언제나 127.0.0.1 이다 — 보낸 서버의 주소는 X-Real-IP 에서 읽는다.
    remoteAddr: clientIp(request),
  };
};

/** multipart 한도 초과(파일·값·파트 수)인가. */
const isTooLarge = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
  return statusCode === 413 || (typeof code === 'string' && /_LIMIT$|TOO_LARGE/.test(code));
};

export const smartsmtInboundRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  /** 실패를 수신 기록에 남기고 응답 본문을 만든다. */
  const failure = async (
    request: FastifyRequest,
    httpStatus: number,
    reason: SmartsmtInboundReason,
    extra: { message?: string; quoteId?: string | null; orderId?: string | null; unauthenticated?: boolean } = {},
  ): Promise<SmartsmtErrorBodyType> => {
    const message = extra.message ?? MESSAGES[reason];
    await recordSmartsmtReceive(
      {
        result: httpStatus >= 500 ? 'failed' : 'rejected',
        reason,
        httpStatus,
        quoteId: extra.quoteId ?? null,
        orderId: extra.orderId ?? null,
        message,
        ...(extra.unauthenticated === true ? { unauthenticated: true } : {}),
        ...requestMeta(request),
      },
      request.log,
    );
    return { detail: { reason, message } };
  };

  // 견적서 전송 — envelope(JSON) + quote_id + order_id + gerber_archive + bom + cpl
  fastify.post(
    '/smartsmt/quotes',
    {
      schema: {
        response: {
          200: SmartsmtInboundAccepted,
          400: SmartsmtErrorBody,
          401: SmartsmtErrorBody,
          413: SmartsmtErrorBody,
          502: SmartsmtErrorBody,
          503: SmartsmtErrorBody,
        },
      },
      // 인증은 본문보다 먼저. 비밀이 설정되지 않았으면 닫아 둔다(열어 두지 않는다).
      onRequest: async (request, reply) => {
        startedAt.set(request, performance.now());
        const secret = smartsmtSecret();
        if (secret === null) {
          return reply.status(503).send(await failure(request, 503, 'NOT_CONFIGURED', { unauthenticated: true }));
        }
        const checked = verifySmartsmtToken(readBearerToken(request.headers.authorization), secret, {
          iss: SMARTSMT_PEER,
          aud: SMARTSMT_SELF,
        });
        if (!checked.ok) {
          return reply.status(401).send(await failure(request, 401, checked.reason, { unauthenticated: true }));
        }
        return undefined;
      },
    },
    async (request, reply) => {
      try {
        if (!request.isMultipart()) {
          return await reply.status(400).send(await failure(request, 400, 'INVALID_REQUEST'));
        }

        let parts: SmartsmtParts;
        try {
          parts = await collectSmartsmtParts(request);
        } catch (err) {
          request.log.warn({ err }, 'smartsmt: multipart 를 읽지 못했습니다');
          return isTooLarge(err)
            ? await reply.status(413).send(await failure(request, 413, 'TOO_LARGE'))
            : await reply.status(400).send(await failure(request, 400, 'INVALID_REQUEST'));
        }

        const parsed = SmartsmtEnvelope.safeParse(parts.envelope);
        if (!parsed.success) {
          const where = parsed.error.issues[0]?.path.join('.') ?? '';
          return await reply.status(400).send(
            await failure(request, 400, 'INVALID_ENVELOPE', {
              message: where === '' ? MESSAGES.INVALID_ENVELOPE : `${MESSAGES.INVALID_ENVELOPE} (${where})`,
              quoteId: parts.quoteId,
              orderId: parts.orderId,
            }),
          );
        }

        const summary = summarizeSmartsmtEnvelope(parsed.data);
        const ids = { quoteId: summary.quoteId, orderId: summary.orderId };
        if (
          (parts.quoteId !== null && parts.quoteId !== summary.quoteId) ||
          (parts.orderId !== null && parts.orderId !== summary.orderId)
        ) {
          return await reply.status(400).send(await failure(request, 400, 'ID_MISMATCH', ids));
        }

        const duplicate = async () => {
          await recordSmartsmtReceive(
            { result: 'duplicate', reason: null, httpStatus: 200, ...ids, message: null, ...requestMeta(request) },
            request.log,
          );
          return reply.status(200).send({ result: true as const, data: { ...ids, duplicate: true } });
        };
        // 이미 받은 견적 — 파일을 다시 올리지 않고 받은 것으로 답한다.
        if (await smartsmtQuoteExists(summary.quoteId)) return await duplicate();

        const files = checkSmartsmtFiles(summary.manifest, parts.files);
        if (!files.ok) {
          return await reply.status(400).send(await failure(request, 400, 'FILE_MISMATCH', { ...ids, message: files.message }));
        }

        const saved = await saveSmartsmtQuote(
          {
            summary,
            // 글자로 왔으면 받은 글자 그대로, 객체로 왔으면(application/json 파트) 그 객체를 다시 글자로.
            envelopeText: parts.envelopeText ?? JSON.stringify(parts.envelope),
            source: 'push',
            files: parts.files,
            fileChecks: files.files,
            receivedAt: new Date(),
          },
          request.log,
        );
        if (!saved.saved) {
          if (saved.reason === 'duplicate') return await duplicate();
          return await reply.status(502).send(await failure(request, 502, 'FILE_STORE_FAILED', ids));
        }

        await recordSmartsmtReceive(
          {
            result: 'accepted',
            reason: null,
            httpStatus: 200,
            ...ids,
            message: parts.ignored.length === 0 ? null : `읽지 않은 파트: ${parts.ignored.join(', ')}`,
            ...requestMeta(request),
          },
          request.log,
        );
        return await reply.status(200).send({ result: true as const, data: { ...ids, duplicate: false } });
      } catch (err) {
        // 예상하지 못한 오류도 원장에 남긴다 — 보내는 쪽 화면에는 HTTP_500 만 뜬다. 본문은 전역 핸들러가 정한다.
        await recordSmartsmtReceive(
          { result: 'failed', reason: null, httpStatus: 500, message: '예상하지 못한 오류', ...requestMeta(request) },
          request.log,
        );
        throw err;
      }
    },
  );

  done();
};
