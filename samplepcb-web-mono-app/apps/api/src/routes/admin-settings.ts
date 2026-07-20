import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  AI_USECASES,
  AiAdminPromptTestRun,
  AiModelsResponse,
  AiRunResponse,
  AiSettingsResponse,
  AiSettingsUpdate,
  ApiError,
  BomQuoteConfig,
  BomQuoteConfigResponse,
  BomQuoteExchangeRateRefreshResponse,
  BusinessInfoResponse,
  BusinessInfoUpdate,
  GerberPricingResponse,
  GerberPricingUpdate,
} from '@sp/api-contract';
import type { AiUsecaseKeyType } from '@sp/api-contract';
import { getBusinessInfo, updateBusinessInfo, type BusinessInfo } from '../lib/g5-db';
import { cleanXssTags, isValidCallback } from '../lib/shop-config';
import { getBomQuoteConfig, getGerberPriceMode, setBomQuoteConfig, setGerberPriceMode } from '../lib/sp-config';
import {
  getBomQuoteExchangeRateStatus,
  refreshKoreaEximUsdExchangeRate,
} from '../lib/exchange-rate';
import { ollamaListModels } from '../lib/ai/ollama';
import {
  AI_USECASE_DEFS,
  ensureAiUsecaseRows,
  getAiConnection,
  maskApiKey,
  setAiConnection,
} from '../lib/ai/usecases';
import { getAiAdminSampleInput } from '../lib/ai/admin-samples';
import { startAiJob } from '../lib/ai/runner';
import { prisma } from '../lib/prisma';

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

  // ── AI 연동(ai) 탭 — 연결(sp_config ai_*) + 유스케이스(sp_ai_usecase) ────────
  // apiKey 원문은 응답에 절대 싣지 않는다(마스킹만). 유스케이스 행은 레지스트리 기준
  // lazy 생성 — 새 유스케이스가 코드에 추가되면 이 GET 이 자동으로 행을 만든다.

  const aiSettingsData = async () => {
    await ensureAiUsecaseRows();
    const [conn, rows] = await Promise.all([
      getAiConnection(),
      prisma.spAiUsecase.findMany({ orderBy: { useCase: 'asc' } }),
    ]);
    return {
      baseUrl: conn.baseUrl,
      apiKeyMasked: maskApiKey(conn.apiKey),
      baseUrlFromEnv: conn.baseUrlFromEnv,
      apiKeyFromEnv: conn.apiKeyFromEnv,
      usecases: rows
        .filter((r) => (AI_USECASES as readonly string[]).includes(r.useCase))
        .map((r) => ({
          useCase: r.useCase as AiUsecaseKeyType,
          enabled: r.enabled,
          model: r.model,
          promptTemplate: r.promptTemplate,
          updatedAt: r.updatedAt.toISOString(),
        })),
    };
  };

  // GET/PUT /api/admin/settings/bom-quote — 고객 BOM 견적 비용·검색 한도(sp_config)
  const bomQuoteSettingsData = async (lastRefreshError: string | null = null) => {
    const config = await getBomQuoteConfig();
    return {
      result: true as const,
      data: config,
      exchangeRate: await getBomQuoteExchangeRateStatus(config, lastRefreshError),
    };
  };

  fastify.get(
    '/settings/bom-quote',
    { schema: { response: { 200: BomQuoteConfigResponse } } },
    async () => bomQuoteSettingsData(),
  );

  fastify.put(
    '/settings/bom-quote',
    { schema: { body: BomQuoteConfig, response: { 200: BomQuoteConfigResponse } } },
    async (request) => {
      await setBomQuoteConfig(request.body);
      return bomQuoteSettingsData();
    },
  );

  // 외부 호출은 관리자 명시 액션과 일일 스케줄러에서만 수행. 실패해도 마지막 정상 캐시는 보존한다.
  fastify.post(
    '/settings/bom-quote/exchange-rate/refresh',
    { schema: { response: { 200: BomQuoteExchangeRateRefreshResponse } } },
    async () => {
      let error: string | null = null;
      try {
        await refreshKoreaEximUsdExchangeRate();
      } catch (cause: unknown) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      return bomQuoteSettingsData(error);
    },
  );

  // GET /api/admin/settings/ai — 현재 연결(마스킹)·유스케이스 설정
  fastify.get(
    '/settings/ai',
    { schema: { response: { 200: AiSettingsResponse } } },
    async () => ({ result: true as const, data: await aiSettingsData() }),
  );

  // PATCH /api/admin/settings/ai — 부분 저장(보낸 필드만). apiKey 문자열=교체·null=삭제.
  fastify.patch(
    '/settings/ai',
    { schema: { body: AiSettingsUpdate, response: { 200: AiSettingsResponse } } },
    async (request) => {
      const body = request.body;
      await setAiConnection({ baseUrl: body.baseUrl, apiKey: body.apiKey });
      if (body.usecases !== undefined) {
        await ensureAiUsecaseRows();
        for (const u of body.usecases) {
          await prisma.spAiUsecase.update({
            where: { useCase: u.useCase },
            data: { enabled: u.enabled, model: u.model, promptTemplate: u.promptTemplate },
          });
        }
      }
      return { result: true as const, data: await aiSettingsData() };
    },
  );

  // POST /api/admin/settings/ai/test — 저장 전 모델·프롬프트를 비식별 샘플로 실제 실행.
  // 활성 토글과 DB 설정은 바꾸지 않으며 캐시도 우회해 현재 연결·모델을 반드시 검증한다.
  fastify.post(
    '/settings/ai/test',
    { schema: { body: AiAdminPromptTestRun, response: { 200: AiRunResponse } } },
    async (request) => {
      const { useCase, model, promptTemplate } = request.body;
      const def = AI_USECASE_DEFS[useCase];
      const input: unknown = def.inputSchema.parse(getAiAdminSampleInput(useCase));
      const prompt = def.buildPrompt(promptTemplate, input);
      const started = await startAiJob({
        useCase,
        mbId: request.user.mbId,
        model,
        promptTemplate,
        input,
        prompt,
        log: request.log,
        reuseCompleted: false,
      });
      return { result: true as const, data: { jobId: started.job.id, cached: false } };
    },
  );

  // GET /api/admin/settings/ai/models — 연결 테스트 겸 모델 목록(/api/tags 프록시)
  fastify.get(
    '/settings/ai/models',
    { schema: { response: { 200: AiModelsResponse, 502: ApiError } } },
    async (request, reply) => {
      try {
        const models = await ollamaListModels(await getAiConnection());
        return { result: true as const, data: { models } };
      } catch (err) {
        request.log.warn({ err }, 'ai models fetch failed');
        return reply.status(502).send({
          error: 'AI_CONNECTION_FAILED',
          message: 'AI 서버 연결에 실패했습니다. 주소·API 키를 확인해 주세요.',
        });
      }
    },
  );

  done();
};
