import { z } from 'zod';
import { MarketServiceArea, MARKET_SERVICE_AREAS } from './market';

// ── AI 유스케이스 계약 ───────────────────────────────────────────────────────
// 범용 실행 라우트(/api/ai/:useCase/run)와 관리자 설정(/api/admin/settings/ai)의 계약.
// 정책(입력 스키마·프롬프트 바인딩·권한)은 서버 레지스트리(lib/ai/usecases.ts)가 유스
// 케이스별로 명시한다 — 라우트만 범용, 정책은 케이스별. 연결(sp_config ai_base_url ·
// ai_api_key)과 유스케이스 설정(sp_ai_usecase: enabled·model·promptTemplate)은 분리.
// apiKey 원문은 어떤 응답에도 싣지 않는다(마스킹만) — 서버 밖 유출 원천 차단.

export const AI_USECASES = ['market.request-diagram'] as const;
export type AiUsecaseKeyType = (typeof AI_USECASES)[number];
export const AiUsecaseKey = z.enum(AI_USECASES);

// ── 공개 상태(비밀 없음) — FE 스텝 게이트용 ─────────────────────────────────
export const AiUsecaseStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({ useCase: AiUsecaseKey, enabled: z.boolean() }),
});
export type AiUsecaseStatusResponseType = z.infer<typeof AiUsecaseStatusResponse>;

// ── 실행(비동기 잡) ─────────────────────────────────────────────────────────
// 생성이 수 분(glm-5.2 ~3분)이라 동기 HTTP 로 못 버틴다 — run 은 jobId 를 즉시 반환하고
// 클라이언트가 폴링한다. 잡은 인메모리(단일 인스턴스 전제, 재시작 시 소실=재시도).

// market.request-diagram 입력 — 사용자 첨부는 절대 보내지 않는다(NDA 원칙, 텍스트만).
export const AiDiagramRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  description: z.string().trim().min(10).max(20000),
});
export type AiDiagramRunBodyType = z.infer<typeof AiDiagramRunBody>;

export const AiRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string() }),
});
export type AiRunResponseType = z.infer<typeof AiRunResponse>;

export const AiJobStatus = z.enum(['running', 'done', 'error']);
export type AiJobStatusType = z.infer<typeof AiJobStatus>;

export const AiJobResponse = z.object({
  result: z.literal(true),
  data: z.object({
    jobId: z.string(),
    status: AiJobStatus,
    html: z.string().nullable(), // done 일 때만 — 렌더는 반드시 sandbox iframe(srcdoc)
    error: z.string().nullable(),
    elapsedSecs: z.number(),
  }),
});
export type AiJobResponseType = z.infer<typeof AiJobResponse>;

// ── 관리자 설정 ─────────────────────────────────────────────────────────────

export const AiUsecaseConfig = z.object({
  useCase: AiUsecaseKey,
  enabled: z.boolean(),
  model: z.string(),
  promptTemplate: z.string(),
  updatedAt: z.string(), // ISO
});
export type AiUsecaseConfigType = z.infer<typeof AiUsecaseConfig>;

export const AiSettingsResponse = z.object({
  result: z.literal(true),
  data: z.object({
    baseUrl: z.string(),
    apiKeyMasked: z.string().nullable(), // 예: '****abcd' — 원문은 절대 미노출
    // 연결 우선순위는 env(.env) > 관리자 저장값 > 기본값 — env 가 잡혀 있으면 true,
    // 화면은 해당 입력을 잠그고 ".env 값이 우선 적용 중" 안내를 띄운다.
    baseUrlFromEnv: z.boolean(),
    apiKeyFromEnv: z.boolean(),
    usecases: z.array(AiUsecaseConfig),
  }),
});
export type AiSettingsResponseType = z.infer<typeof AiSettingsResponse>;

// 부분 저장 — 보낸 필드만 갱신. apiKey: 문자열=교체, null=삭제, 미전송=유지.
export const AiSettingsUpdate = z.object({
  baseUrl: z.string().trim().url().max(300).optional(),
  apiKey: z.string().trim().min(1).max(300).nullable().optional(),
  usecases: z
    .array(
      z.object({
        useCase: AiUsecaseKey,
        enabled: z.boolean(),
        model: z.string().trim().min(1).max(100),
        promptTemplate: z.string().trim().min(10).max(20000),
      }),
    )
    .optional(),
});
export type AiSettingsUpdateType = z.infer<typeof AiSettingsUpdate>;

// 모델 목록(연결 테스트 겸용) — 현재 연결(baseUrl·apiKey)로 /api/tags 조회.
export const AiModelsResponse = z.object({
  result: z.literal(true),
  data: z.object({ models: z.array(z.string()) }),
});
export type AiModelsResponseType = z.infer<typeof AiModelsResponse>;
