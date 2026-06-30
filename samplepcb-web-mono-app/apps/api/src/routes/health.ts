import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { HealthResponse } from '@sp/api-contract';

// GET /api/health — 인증 불필요. 응답은 HealthResponse(Zod) 로 직렬화/검증.
export const healthRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/health',
    { schema: { response: { 200: HealthResponse } } },
    () => ({ ok: true as const, service: 'samplepcb-api' }),
  );

  done();
};
