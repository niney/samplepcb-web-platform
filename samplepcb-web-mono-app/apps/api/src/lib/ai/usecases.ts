import { AI_USECASES } from '@sp/api-contract';
import type { AiThinkLevelType, AiUsecaseKeyType } from '@sp/api-contract';
import { DEV_REVIEW_PROMPT_VERSION } from './dev-review';
import { DEV_DIAGRAM_PROMPT_VERSION } from './dev-diagram';
import type { OllamaThink } from './ollama';
import { prisma } from '../prisma';

// ── AI 유스케이스 레지스트리 ─────────────────────────────────────────────────
// 유스케이스 2종(docs/AI_DEV_REVIEW.md §13): market.dev-review(사전 검토서, 즉시) ·
// market.dev-diagram(정밀 구성도, 비동기). 프롬프트는 코드 정본이라 DB 에 없다 — 관리자는
// 사용 토글·모델·thinking 단계·추가 지침만 만진다. 기본 모델·think 는 프로빙 결과로 바뀌는
// 상수라 **여기 한 곳**에만 둔다.

export const DEV_REVIEW_USECASE = 'market.dev-review' as const;
export const DEV_DIAGRAM_USECASE = 'market.dev-diagram' as const;
// 개발의뢰(docs/DEVELOP_FLOW.md §6) — 같은 프롬프트·러너, 별도 행. 관리자가 대기하므로 정밀 모델을 기본으로 둔다.
export const DEVELOP_REVIEW_USECASE = 'develop.dev-review' as const;
export const DEVELOP_DIAGRAM_USECASE = 'develop.dev-diagram' as const;

// 유스케이스 키의 "종류"(검토서/구성도) — 잡 저장소·러너가 market/develop 을 가르지 않고 이걸 본다.
export const isReviewUsecase = (key: string): boolean => key.endsWith('.dev-review');
export const isDiagramUsecase = (key: string): boolean => key.endsWith('.dev-diagram');

export interface AiUsecaseDef {
  defaultModel: string;
  promptVersion: string;
  think: AiThinkLevelType;
  temperature?: number;
  seed?: number;
  timeoutMs: number;
}

export const AI_USECASE_DEFS: Record<AiUsecaseKeyType, AiUsecaseDef> = {
  'market.dev-review': {
    defaultModel: 'deepseek-v4-pro:0813',
    promptVersion: DEV_REVIEW_PROMPT_VERSION,
    think: 'off',
    timeoutMs: 600_000,
  },
  // §12.11 프로빙: kimi-k3 thinking high, temperature 0, seed 42 — 566초. 동기 UX 불가 → 비동기 전용.
  'market.dev-diagram': {
    defaultModel: 'kimi-k3',
    promptVersion: DEV_DIAGRAM_PROMPT_VERSION,
    think: 'high',
    temperature: 0,
    seed: 42,
    timeoutMs: 900_000,
  },
  // 개발의뢰 검토서 — 고객이 기다리지 않으므로(관리자 초안) §12.8 프로빙에서 품질이 deepseek 급이면서 상의 항목을
  // 덜 내던 kimi-k3 에 thinking 을 켠다. glm-5.3(가장 촘촘, 3~9분)은 관리자가 설정에서 고를 수 있다.
  'develop.dev-review': {
    defaultModel: 'kimi-k3',
    promptVersion: DEV_REVIEW_PROMPT_VERSION,
    think: 'medium',
    timeoutMs: 900_000,
  },
  'develop.dev-diagram': {
    defaultModel: 'kimi-k3',
    promptVersion: DEV_DIAGRAM_PROMPT_VERSION,
    think: 'high',
    temperature: 0,
    seed: 42,
    timeoutMs: 900_000,
  },
};

// 관리자 설정값(off|low|medium|high) → ollama think 옵션.
export const toOllamaThink = (level: AiThinkLevelType): OllamaThink => (level === 'off' ? false : level);
export const asThinkLevel = (v: string | null | undefined, fallback: AiThinkLevelType): AiThinkLevelType =>
  v === 'off' || v === 'low' || v === 'medium' || v === 'high' ? v : fallback;

// ── 연결 설정 — 우선순위: env(.env) > 관리자 저장값(sp_config) > 기본값 ──────
// 운영은 .env 파일 관리 권장(키가 DB 에 남지 않음). env 가 잡혀 있으면 관리자 화면
// 저장값은 무시되며, 화면에는 fromEnv 플래그로 그 사실을 표시한다.

const AI_BASE_URL_KEY = 'ai_base_url';
const AI_API_KEY_KEY = 'ai_api_key';
const AI_VISION_MODEL_KEY = 'ai_vision_model';
export const AI_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'; // 로컬 데몬(클라우드 프록시)
// ollama.com 직결 태그에는 `:cloud` 접미사가 없다 — 옛 기본값 'qwen3.5:cloud' 는 직결에서
// 존재하지 않아 첨부 판독이 통째로 실패했다(프로빙 실측 교정). 로컬 데몬 프록시는 반대로
// `:cloud` 가 필요하다 → 러너가 404 에 접미사를 붙였다 떼며 1회 재시도한다(runner.ts).
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
        think: AI_USECASE_DEFS[key].think,
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

// 실행에 필요한 유효 설정(행 + 코드 기본값 병합).
export interface AiUsecaseRuntime {
  enabled: boolean;
  model: string;
  think: AiThinkLevelType;
  extraInstructions: string;
  def: AiUsecaseDef;
}

export async function getAiUsecaseRuntime(key: AiUsecaseKeyType): Promise<AiUsecaseRuntime> {
  const row = await getAiUsecase(key);
  const def = AI_USECASE_DEFS[key];
  return {
    enabled: row?.enabled ?? false,
    model: row?.model ?? def.defaultModel,
    think: asThinkLevel(row?.think, def.think),
    extraInstructions: row?.extraInstructions ?? '',
    def,
  };
}
