import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminDigikeyOauthStartResponse,
  AdminDigikeyStatusResponse,
  ApiError,
} from '@sp/api-contract';
import {
  completeDigikeyOauth,
  disconnectDigikey,
  getDigikeyConnectionStatus,
  startDigikeyOauth,
} from '../lib/digikey-oauth';

// ── DigiKey 3-legged OAuth 연결(D42) ───────────────────────────────────────────────────────
// 관리자: 상태·[연결] 시작·해제 (requireAdmin). 콜백은 DigiKey 가 브라우저를 돌려보내는 자리라 JWT 헤더가
// 없다 — 별도 플러그인(무인증)으로 두되 관리자가 만든 단일 대기 state(10분) 가 맞을 때만 code 를 교환한다.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';
const RETURN_PATH = '/app/admin/smartbom/logistics';

export const adminDigikeyRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/digikey/status',
    { schema: { response: { 200: AdminDigikeyStatusResponse } } },
    async () => ({ result: true as const, data: await getDigikeyConnectionStatus() }),
  );

  fastify.post(
    '/digikey/oauth/start',
    { schema: { response: { 200: AdminDigikeyOauthStartResponse, 409: ApiError } } },
    async (request, reply) => {
      const started = await startDigikeyOauth(request.user.mbId);
      if (!started.ok) {
        return reply.status(409).send({
          error: started.error,
          message:
            'DigiKey OAuth 설정(DIGIKEY_CLIENT_ID/SECRET/DIGIKEY_OAUTH_REDIRECT_URI)이 없습니다.',
        });
      }
      return { result: true as const, data: { url: started.url } };
    },
  );

  fastify.delete(
    '/digikey/connection',
    { schema: { response: { 200: AdminDigikeyStatusResponse } } },
    async () => {
      await disconnectDigikey();
      return { result: true as const, data: await getDigikeyConnectionStatus() };
    },
  );

  done();
};

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/** 무인증 콜백 — DigiKey 앱에 등록한 Redirect URI(…/api/admin/digikey/oauth/callback)가 이 자리다. */
export const digikeyOauthCallbackRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/admin/digikey/oauth/callback',
    { schema: { querystring: CallbackQuery } },
    async (request, reply) => {
      const back = (params: Record<string, string>): string =>
        `${WEB_BASE_URL}${RETURN_PATH}?${new URLSearchParams(params).toString()}`;
      const { code, state, error, error_description: errorDescription } = request.query;
      if (error !== undefined) {
        return reply.redirect(back({ digikey: 'error', reason: error, detail: errorDescription ?? '' }));
      }
      if (code === undefined || state === undefined) {
        return reply.redirect(back({ digikey: 'error', reason: 'MISSING_CODE' }));
      }
      const result = await completeDigikeyOauth(code, state);
      if (!result.ok) {
        return reply.redirect(back({ digikey: 'error', reason: result.error, detail: result.detail ?? '' }));
      }
      return reply.redirect(back({ digikey: 'connected' }));
    },
  );
  done();
};
