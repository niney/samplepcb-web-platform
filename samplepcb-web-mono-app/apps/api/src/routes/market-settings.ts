import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { MarketSettingsResponse } from '@sp/api-contract';
import { DEFAULT_FEE_RATE_BP } from '../lib/market';
import { prisma } from '../lib/prisma';

// 공개 마켓 설정(/api/market/settings) — 수수료율(bp) 읽기 전용.
// 입찰 폼의 "수수료 공제 후 실수령" 표시용이라 비인증 GET(feeRateBp 는 공개 정보).
// 쓰기(upsert)는 관리자 전용 admin-market-settings 로 분리(requireAdmin 게이트).
export const marketSettingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── GET /api/market/settings — 수수료율(bp) 현재값 ──────────────────────────
  fastify.get(
    '/market/settings',
    { schema: { response: { 200: MarketSettingsResponse } } },
    async () => {
      const row = await prisma.spMarketSettings.findUnique({ where: { id: 1 } });
      return { result: true as const, data: { feeRateBp: row?.feeRateBp ?? DEFAULT_FEE_RATE_BP } };
    },
  );

  done();
};
