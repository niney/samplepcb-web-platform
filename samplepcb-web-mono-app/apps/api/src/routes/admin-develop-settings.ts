import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { AdminDevelopSettingsResponse, AdminDevelopSettingsUpdate } from '@sp/api-contract';
import { getDevelopSettings, updateDevelopSettings } from '../lib/develop-settings';

// ── /api/admin/develop/settings — 개발의뢰 설정 싱글턴(docs/DEVELOP_FLOW.md §7.3) ─────────
// 표준 조건·별도 실비·하자/검수/유효기간·기본 마일스톤·관리자 수신 메일·AI 자동 초안. 견적 생성이 복사해 쓴다.
export const adminDevelopSettingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get('/develop/settings', { schema: { response: { 200: AdminDevelopSettingsResponse } } }, async () => ({
    result: true as const,
    data: await getDevelopSettings(),
  }));

  fastify.patch(
    '/develop/settings',
    { schema: { body: AdminDevelopSettingsUpdate, response: { 200: AdminDevelopSettingsResponse } } },
    async (request) => ({ result: true as const, data: await updateDevelopSettings(request.body) }),
  );

  done();
};
