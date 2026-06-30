import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Me } from '@sp/api-contract';

// GET /api/me — authenticate preHandler 로 JWT 검증 후 클레임(request.user)을 Me 로 반환.
export const meRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/me',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: Me } },
    },
    (request) => request.user,
  );

  done();
};
