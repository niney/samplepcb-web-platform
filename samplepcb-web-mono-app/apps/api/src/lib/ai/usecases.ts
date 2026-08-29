import { AI_USECASES } from '@sp/api-contract';
import type { AiUsecaseKeyType } from '@sp/api-contract';
import { DEV_REVIEW_PROMPT_VERSION } from './dev-review';
import { prisma } from '../prisma';

// ── AI 유스케이스 레지스트리 ─────────────────────────────────────────────────
// 2026-08-28 재작성(docs/AI_DEV_REVIEW.md): 유스케이스는 **AI 사전 검토서 하나**뿐이고,
// 프롬프트는 코드 정본(lib/ai/dev-review.ts)이라 DB 에서 사라졌다 — 관리자는 사용 토글·
// 모델·추가 지침만 만진다(스키마와 어긋난 DB 프롬프트가 파서를 깨는 구조를 제거).
// 기본 모델·think 는 프로빙 결과로 바뀌는 상수라 **여기 한 곳**에만 둔다.

export const DEV_REVIEW_USECASE = 'market.dev-review' as const;

export interface AiUsecaseDef {
  defaultModel: string;
  promptVersion: string;
  think: boolean;
}

export const AI_USECASE_DEFS: Record<AiUsecaseKeyType, AiUsecaseDef> = {
  'market.dev-review': {
    defaultModel: 'deepseek-v4-pro:0813',
    promptVersion: DEV_REVIEW_PROMPT_VERSION,
    think: false,
  },
};

// ── 연결 설정 — 우선순위: env(.env) > 관리자 저장값(sp_config) > 기본값 ──────
// 운영은 .env 파일 관리 권장(키가 DB 에 남지 않음). env 가 잡혀 있으면 관리자 화면
// 저장값은 무시되며, 화면에는 fromEnv 플래그로 그 사실을 표시한다.

const AI_BASE_URL_KEY = 'ai_base_url';
const AI_API_KEY_KEY = 'ai_api_key';
const AI_VISION_MODEL_KEY = 'ai_vision_model';
export const AI_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'; // 로컬 데몬(클라우드 프록시)
// ollama.com 직결 태그에는 `:cloud` 접미사가 없다 — 옛 기본값 'qwen3.5:cloud' 는 직결에서
// 존재하지 않아 첨부 판독이 통째로 실패했다(프로빙 실측 교정).
export const AI_DEFAULT_VISION_MODEL = 'qwen3.5:397b';

const envOrNull = (name: string): string | null => {
  const v = process.env[name]?.trim();
  return v !== undefined && v !== '' ? v : null;
};

export interface AiConnectionInfo {
  baseUrl: string;
  apiKey: string | null;
  baseUrlFromEnv: boolean;
  apiKeyFromEnv: boolean;
}

export async function getAiConnection(): Promise<AiConnectionInfo> {
  const envBaseUrl = envOrNull('AI_BASE_URL');
  const envApiKey = envOrNull('AI_API_KEY');
  const rows = await prisma.spConfig.findMany({
    where: { key: { in: [AI_BASE_URL_KEY, AI_API_KEY_KEY] } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    baseUrl: envBaseUrl ?? map.get(AI_BASE_URL_KEY) ?? AI_DEFAULT_BASE_URL,
    apiKey: envApiKey ?? map.get(AI_API_KEY_KEY) ?? null,
    baseUrlFromEnv: envBaseUrl !== null,
    apiKeyFromEnv: envApiKey !== null,
  };
}

export async function setAiConnection(patch: {
  baseUrl?: string | undefined;
  apiKey?: string | null | undefined; // null=삭제, undefined=유지
}): Promise<void> {
  if (patch.baseUrl !== undefined) {
    await prisma.spConfig.upsert({
      where: { key: AI_BASE_URL_KEY },
      create: { key: AI_BASE_URL_KEY, value: patch.baseUrl },
      update: { value: patch.baseUrl },
    });
  }
  if (patch.apiKey !== undefined) {
    if (patch.apiKey === null) {
      await prisma.spConfig.deleteMany({ where: { key: AI_API_KEY_KEY } });
    } else {
      await prisma.spConfig.upsert({
        where: { key: AI_API_KEY_KEY },
        create: { key: AI_API_KEY_KEY, value: patch.apiKey },
        update: { value: patch.apiKey },
      });
    }
  }
}

// ── 첨부 판독(비전) 모델 — 연결과 같은 우선순위 규칙 ────────────────────────
export interface AiVisionModelInfo {
  model: string;
  fromEnv: boolean;
}

export async function getAiVisionModel(): Promise<AiVisionModelInfo> {
  const fromEnv = envOrNull('AI_ATTACHMENT_VISION_MODEL');
  if (fromEnv !== null) return { model: fromEnv, fromEnv: true };
  const row = await prisma.spConfig.findUnique({ where: { key: AI_VISION_MODEL_KEY } });
  const stored = row?.value.trim() ?? '';
  return { model: stored === '' ? AI_DEFAULT_VISION_MODEL : stored, fromEnv: false };
}

export async function setAiVisionModel(model: string): Promise<void> {
  await prisma.spConfig.upsert({
    where: { key: AI_VISION_MODEL_KEY },
    create: { key: AI_VISION_MODEL_KEY, value: model },
    update: { value: model },
  });
}

// 마스킹 — 원문은 어떤 응답에도 싣지 않는다.
export const maskApiKey = (key: string | null): string | null =>
  key === null || key === '' ? null : `****${key.slice(-4)}`;

// ── 유스케이스 행 lazy 보장 + 조회 ──────────────────────────────────────────

// 레지스트리에 있는데 DB 에 없는 행을 기본값(비활성)으로 생성 — 마이그레이션에 INSERT 를
// 두지 않는다. promptTemplate 은 deprecated 라 '' 로 채운다(프롬프트 정본은 코드).
export async function ensureAiUsecaseRows(): Promise<void> {
  const existing = await prisma.spAiUsecase.findMany({ select: { useCase: true } });
  const have = new Set(existing.map((r) => r.useCase));
  for (const key of AI_USECASES) {
    if (have.has(key)) continue;
    await prisma.spAiUsecase.create({
      data: {
        useCase: key,
        enabled: false,
        model: AI_USECASE_DEFS[key].defaultModel,
        promptTemplate: '',
        extraInstructions: null,
      },
    });
  }
}

export async function getAiUsecase(key: AiUsecaseKeyType) {
  await ensureAiUsecaseRows();
  return prisma.spAiUsecase.findUnique({ where: { useCase: key } });
}
