import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { MarketSettings, MarketSettingsResponse } from '@sp/api-contract';
import { prisma } from '../lib/prisma';

// 관리자 마켓 설정(/app/admin/market/settings) — sp_market_settings 싱글턴(id=1).
// 행 부재 시 GET 은 기본값 폴백, PATCH 가 upsert — 시드 불요(설계 §4).
// g5_shop_default 는 영카트 소유라 마켓 설정을 섞지 않는다(소유권 규칙).
export const adminMarketSettingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/market/settings — 수수료율(bp) 현재값 ────────────────────
  fastify.get(
    '/market/settings',
    { schema: { response: { 200: MarketSettingsResponse } } },
    async () => {
      const row = await prisma.spMarketSettings.findUnique({ where: { id: 1 } });
      return { result: true as const, data: { feeRateBp: row?.feeRateBp ?? 1000 } };
    },
  );

  // ── PATCH /api/admin/market/settings — 수수료율 저장(upsert id=1) ───────────
  fastify.patch(
    '/market/settings',
    { schema: { body: MarketSettings, response: { 200: MarketSettingsResponse } } },
    async (request) => {
      const saved = await prisma.spMarketSettings.upsert({
        where: { id: 1 },
        create: { id: 1, feeRateBp: request.body.feeRateBp },
        update: { feeRateBp: request.body.feeRateBp },
      });
      return { result: true as const, data: { feeRateBp: saved.feeRateBp } };
    },
  );

  done();
};
