import { z } from 'zod';
import { MarketDevReview } from './market-dev-review';

// ── AI 유스케이스 계약 ───────────────────────────────────────────────────────
// 2026-08-28 재작성(docs/AI_DEV_REVIEW.md): 4산출물 체계(구성도·명세·ROC·포스팅)와 rnd
// 실험 유스케이스를 폐기하고 **AI 사전 검토서 1종**만 남긴다. 실행 입력 스키마는
// market-dev-review.ts 의 DevReviewRunPayload(멀티파트 payload 파트)가 정본이며,
// 프롬프트는 코드 정본(버전 태그)이라 관리자 설정에서 사라졌다 — 관리자는 사용 토글·
// 모델·첨부 판독 모델·추가 지침 한 칸·샘플 테스트·실행 이력만 만진다.
// apiKey 원문은 어떤 응답에도 싣지 않는다(마스킹만) — 서버 밖 유출 원천 차단.

export const AI_USECASES = ['market.dev-review'] as const;
export type AiUsecaseKeyType = (typeof AI_USECASES)[number];
export const AiUsecaseKey = z.enum(AI_USECASES);

// ── 공개 상태(비밀 없음) — FE 스텝 게이트용 ─────────────────────────────────
export const AiUsecaseStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({ useCase: AiUsecaseKey, enabled: z.boolean() }),
});
export type AiUsecaseStatusResponseType = z.infer<typeof AiUsecaseStatusResponse>;

// ── 실행(비동기 잡) ─────────────────────────────────────────────────────────
// 생성이 수 분(첨부 판독 + 검토서)이라 동기 HTTP 로 못 버틴다 — run 은 jobId 를 즉시
// 반환하고 클라이언트가 폴링한다. 잡은 sp_ai_job(DB) — 재시작에 견디고 등록 시점의
// 소유자·신선도 대조가 서버 사실 하나로 끝난다.
export const AiRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string(), cached: z.boolean() }),
});
export type AiRunResponseType = z.infer<typeof AiRunResponse>;

export const AiJobStatus = z.enum(['running', 'done', 'error']);
export type AiJobStatusType = z.infer<typeof AiJobStatus>;

// 진행 표시("첨부 확인 중 → 검토서 작성 중")의 원천. 완료 잡은 null.
export const AiJobStage = z.enum(['attachments', 'review']);
export type AiJobStageType = z.infer<typeof AiJobStage>;

export const AiJobResponse = z.object({
  result: z.literal(true),
  data: z.object({
    jobId: z.string(),
    status: AiJobStatus,
    stage: AiJobStage.nullable(),
    review: MarketDevReview.nullable(), // done 일 때만 — 후처리까지 끝난 검토서
    error: z.string().nullable(),
    elapsedSecs: z.number(),
  }),
});
export type AiJobResponseType = z.infer<typeof AiJobResponse>;

// ── 관리자 설정 ─────────────────────────────────────────────────────────────

export const AI_EXTRA_INSTRUCTIONS_MAX = 2000;

// 검토서 생성 설정 — 프롬프트 본문은 코드(promptVersion 은 읽기 전용 표시).
export const AiDevReviewSettings = z.object({
  enabled: z.boolean(),
  model: z.string(),
  extraInstructions: z.string(),
  promptVersion: z.string(),
  updatedAt: z.string(), // ISO
});
export type AiDevReviewSettingsType = z.infer<typeof AiDevReviewSettings>;

export const AiSettingsResponse = z.object({
  result: z.literal(true),
  data: z.object({
    baseUrl: z.string(),
    apiKeyMasked: z.string().nullable(), // 예: '****abcd' — 원문은 절대 미노출
    // 연결 우선순위는 env(.env) > 관리자 저장값 > 기본값 — env 가 잡혀 있으면 true,
    // 화면은 해당 입력을 잠그고 ".env 값이 우선 적용 중" 안내를 띄운다.
    baseUrlFromEnv: z.boolean(),
    apiKeyFromEnv: z.boolean(),
    visionModel: z.string(), // 첨부 판독(비전) 모델 — 2단 파이프라인의 1단
    visionModelFromEnv: z.boolean(),
    devReview: AiDevReviewSettings,
  }),
});
export type AiSettingsResponseType = z.infer<typeof AiSettingsResponse>;

// 부분 저장 — 보낸 필드만 갱신. apiKey: 문자열=교체, null=삭제, 미전송=유지.
export const AiSettingsUpdate = z.object({
  baseUrl: z.string().trim().url().max(300).optional(),
  apiKey: z.string().trim().min(1).max(300).nullable().optional(),
  visionModel: z.string().trim().min(1).max(100).optional(),
  devReview: z
    .object({
      enabled: z.boolean(),
      model: z.string().trim().min(1).max(100),
      extraInstructions: z.string().trim().max(AI_EXTRA_INSTRUCTIONS_MAX),
    })
    .optional(),
});
export type AiSettingsUpdateType = z.infer<typeof AiSettingsUpdate>;

// 관리자 샘플 테스트 — 저장 전 편집 중인 모델·추가 지침을 고정 비식별 샘플로 실행한다.
// 실제 실행과 같은 잡 조회 계약을 사용하되 유스케이스 활성 여부·설정 저장은 건드리지 않는다.
export const AiAdminDevReviewTestRun = z.object({
  model: z.string().trim().min(1).max(100),
  extraInstructions: z.string().trim().max(AI_EXTRA_INSTRUCTIONS_MAX),
});
export type AiAdminDevReviewTestRunType = z.infer<typeof AiAdminDevReviewTestRun>;

// 모델 목록(연결 테스트 겸용) — 현재 연결(baseUrl·apiKey)로 /api/tags 조회.
export const AiModelsResponse = z.object({
  result: z.literal(true),
  data: z.object({ models: z.array(z.string()) }),
});
export type AiModelsResponseType = z.infer<typeof AiModelsResponse>;

// ── 실행 이력(관리자) ───────────────────────────────────────────────────────
// 회원 식별자는 마스킹해서만 노출한다(@sp/utils maskName) — 운영 감독에 원 식별자가
// 필요 없고, 이력 화면은 실패 원인 추적이 목적이다.
export const AiJobLogQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type AiJobLogQueryType = z.infer<typeof AiJobLogQuery>;

export const AiJobLogItem = z.object({
  jobId: z.string(),
  useCase: z.string(),
  stage: z.string().nullable(),
  model: z.string(),
  status: AiJobStatus,
  mbIdMasked: z.string(),
  elapsedSecs: z.number(),
  error: z.string().nullable(),
  startedAt: z.string(), // ISO
  finishedAt: z.string().nullable(), // ISO
});
export type AiJobLogItemType = z.infer<typeof AiJobLogItem>;

export const AiJobLogResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(AiJobLogItem), total: z.number() }),
});
export type AiJobLogResponseType = z.infer<typeof AiJobLogResponse>;
