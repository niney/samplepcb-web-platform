import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  ApiError,
  BusinessInfoResponse,
  BusinessInfoUpdate,
  GerberPricingResponse,
  GerberPricingUpdate,
} from '@sp/api-contract';
import { getBusinessInfo, updateBusinessInfo, type BusinessInfo } from '../lib/g5-db';
import { cleanXssTags, isValidCallback } from '../lib/shop-config';
import { getGerberPriceMode, setGerberPriceMode } from '../lib/sp-config';

// 관리자 설정(/app/admin/settings) — 영카트 쇼핑몰설정을 탭 단위로 이식하는 도메인.
// 현재 "사업자정보"(g5_shop_default de_admin_* 11컬럼) 탭만. 전 라우트 requireAdmin.
export const adminSettingsRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 전 라우트 관리자 전용 — 라우트별 preHandler 누락 사고를 원천 차단.
  fastify.addHook('preHandler', fastify.requireAdmin);

  // ── GET /api/admin/settings/business-info — 사업자정보 현재값 ──────────────
  fastify.get(
    '/settings/business-info',
    { schema: { response: { 200: BusinessInfoResponse } } },
    async (_request, reply) => {
      const info = await getBusinessInfo();
      // g5_shop_default 는 설치 후 항상 1행 — null 은 미설치(비정상)뿐.
      if (info === null) return reply.notFound('쇼핑몰 기본설정(g5_shop_default)이 없습니다');
      return { result: true as const, data: info };
    },
  );

  // ── PATCH /api/admin/settings/business-info — 사업자정보 저장 ──────────────
  // 코어 adm/shop_admin/configformupdate.php 저장 순서 이식:
  //   (1) 대표전화 형식검증(check_vaild_callback) → (2) 대표자명 공백 가드(sanitize 이전
  //   raw 기준) → (3) 11필드 XSS 정제(clean_xss_tags) → (4) 저장. tel/owner 실패는 400.
  fastify.patch(
    '/settings/business-info',
    {
      schema: {
        body: BusinessInfoUpdate,
        response: { 200: BusinessInfoResponse, 400: ApiError },
      },
    },
    async (request, reply) => {
      const body = request.body;

      // (1) 대표전화번호(SMS 발신번호 겸용) 형식 — 코어 configformupdate.php:11-13.
      if (!isValidCallback(body.tel)) {
        return reply
          .status(400)
          .send({ error: 'INVALID_CALLBACK', message: '대표전화번호를 올바르게 입력해 주세요.' });
      }

      // (2) 대표자명 공백 가드 — 코어 configformupdate.php:15-16(설정값 유실 방지). zod 가
      //     이미 trim 하므로 공백만 있으면 ''. 코어는 silent 리다이렉트지만 API 는 400 명시화.
      if (body.ownerName === '') {
        return reply
          .status(400)
          .send({ error: 'OWNER_REQUIRED', message: '대표자명을 입력해 주세요.' });
      }

      // (3) 11필드 XSS 정제 — 코어 configformupdate.php:248-254(clean_xss_tags).
      const clean: BusinessInfo = {
        companyName: cleanXssTags(body.companyName),
        ownerName: cleanXssTags(body.ownerName),
        businessNo: cleanXssTags(body.businessNo),
        tel: cleanXssTags(body.tel),
        fax: cleanXssTags(body.fax),
        mailOrderNo: cleanXssTags(body.mailOrderNo),
        bugaNo: cleanXssTags(body.bugaNo),
        zip: cleanXssTags(body.zip),
        addr: cleanXssTags(body.addr),
        infoManagerName: cleanXssTags(body.infoManagerName),
        infoManagerEmail: cleanXssTags(body.infoManagerEmail),
      };
      await updateBusinessInfo(clean);

      // 저장(정제 후) 값을 그대로 에코 — FE 캐시 즉시 정합화.
      return { result: true as const, data: clean };
    },
  );

  // ── GET /api/admin/settings/gerber-pricing — 거버 가격 해석 모드 현재값 ─────
  // 미설정이면 order(현행 = 거버값을 부가세 포함 총액으로 취급) 기본. sp_config 싱글 키.
  fastify.get(
    '/settings/gerber-pricing',
    { schema: { response: { 200: GerberPricingResponse } } },
    async () => {
      const mode = await getGerberPriceMode();
      return { result: true as const, data: { mode } };
    },
  );

  // ── PATCH /api/admin/settings/gerber-pricing — 모드 저장(order|supply) ──────
  // 순수 스위치라 도메인 검증 없음(zod enum 이 값 보장). supply 로 바꾸면 이후 견적부터
  // listPrice 에 부가세 10% 가 얹혀 저장된다(pcb-projects 정규화). 기존 견적엔 소급 없음.
  fastify.patch(
    '/settings/gerber-pricing',
    { schema: { body: GerberPricingUpdate, response: { 200: GerberPricingResponse } } },
    async (request) => {
      await setGerberPriceMode(request.body.mode);
      return { result: true as const, data: { mode: request.body.mode } };
    },
  );

  done();
};
