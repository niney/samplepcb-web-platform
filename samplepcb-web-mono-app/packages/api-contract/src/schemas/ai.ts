import { z } from 'zod';
import {
  MarketBudgetRange,
  MarketCategoryCode,
  MarketAiInterviewAnswer,
  MarketProjectDeadline,
  MarketProjectMethod,
  MarketRequestType,
  MarketServiceArea,
  MarketToolCode,
  MARKET_CATEGORIES,
  MARKET_SERVICE_AREAS,
  MARKET_TOOL_CODES,
} from './market';

// ── AI 유스케이스 계약 ───────────────────────────────────────────────────────
// 범용 실행 라우트(/api/ai/:useCase/run)와 관리자 설정(/api/admin/settings/ai)의 계약.
// 정책(입력 스키마·프롬프트 바인딩·권한)은 서버 레지스트리(lib/ai/usecases.ts)가 유스
// 케이스별로 명시한다 — 라우트만 범용, 정책은 케이스별. 연결(sp_config ai_base_url ·
// ai_api_key)과 유스케이스 설정(sp_ai_usecase: enabled·model·promptTemplate)은 분리.
// apiKey 원문은 어떤 응답에도 싣지 않는다(마스킹만) — 서버 밖 유출 원천 차단.

// structurize=인터뷰 답변→구성 명세 JSON(P1). 구성도는 DiagramSpec을 공용 결정적 렌더러로
// 즉시 변환한다. 기존 diagram(설명→HTML 단발)은 구조화 비활성 시 전자 분야 폴백으로 유지.
export const AI_USECASES = [
  'market.request-diagram',
  'market.request-structurize',
  'market.request-roc',
  'market.request-postings',
  'rnd.file-classify',
  'rnd.pcb-request-document',
] as const;
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
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
});
export type AiDiagramRunBodyType = z.infer<typeof AiDiagramRunBody>;

// ── 구성 명세(DiagramSpec) — 인터뷰 파이프라인의 피벗 JSON ──────────────────
// LLM 산출을 스키마로 정규화한다: enum 이탈은 .catch 로 안전값으로 흡수(프로빙 실측 —
// glm·deepseek 모두 flow "debug" 슬립), 알 수 없는 키는 zod 기본 strip. 구조 결함
// (미정의 그룹·끊긴 연결)은 normalizeDiagramSpec 이 보정한다 — 실패 대신 복구가 원칙.

export const DIAGRAM_BLOCK_TYPES = [
  'power', 'controller', 'communication', 'sensor', 'input', 'output', 'driver',
  'storage', 'debug', 'ui', 'external', 'mechanical', 'protection',
  'client', 'service', 'api', 'database', 'cache', 'queue', 'worker', 'operations', 'other',
] as const;

const specId = z.string().trim().min(1).max(60);

export const DiagramSpec = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(500).catch(''),
    stage: z.string().trim().max(40).catch(''),
    service_type: z.string().trim().max(40).catch(''),
  }),
  groups: z.array(z.object({ id: specId, label: z.string().trim().min(1).max(80) })).min(1).max(12),
  blocks: z
    .array(
      z.object({
        id: specId,
        group: specId,
        type: z.enum(DIAGRAM_BLOCK_TYPES).catch('other'),
        label: z.string().trim().min(1).max(200),
        status: z.enum(['confirmed', 'tbd', 'option']).catch('tbd'),
      }),
    )
    .min(1)
    .max(80),
  connections: z
    .array(
      z.object({
        from: specId,
        to: specId,
        interface: z.string().trim().max(60).catch(''),
        flow: z.enum(['power', 'data', 'control', 'feedback']).catch('data'),
      }),
    )
    .max(160)
    .catch([]),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20).catch([]),
  feature_highlights: z.array(z.string().trim().min(1).max(200)).max(20).catch([]),
  questions_missing: z
    .array(z.object({ topic: z.string().trim().max(60).catch(''), question: z.string().trim().min(1).max(500) }))
    .max(20)
    .catch([]),
});
export type DiagramSpecType = z.infer<typeof DiagramSpec>;

// 구조 보정 — 블록이 참조하는 미정의 그룹은 자동 생성, 끊긴 연결은 제거, 중복 블록 id 는
// 뒤엣것을 버린다. LLM 재호출 없이 렌더 가능한 상태로 만드는 최소 수리.
export function normalizeDiagramSpec(spec: DiagramSpecType): DiagramSpecType {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const groups = [...spec.groups];
  const seenBlocks = new Set<string>();
  const blocks = spec.blocks.filter((b) => {
    if (seenBlocks.has(b.id)) return false;
    seenBlocks.add(b.id);
    if (!groupIds.has(b.group)) {
      groupIds.add(b.group);
      groups.push({ id: b.group, label: b.group.replaceAll('_', ' ').toUpperCase() });
    }
    return true;
  });
  const connections = spec.connections.filter(
    (c) => seenBlocks.has(c.from) && seenBlocks.has(c.to) && c.from !== c.to,
  );
  return { ...spec, groups, blocks, connections };
}

export const AiInterviewAnswer = MarketAiInterviewAnswer;
export type AiInterviewAnswerType = z.infer<typeof AiInterviewAnswer>;

// market.request-structurize 입력 — 인터뷰 답변(있는 것만) + 제목·분야·설명 텍스트.
export const AiStructurizeRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  requestType: MarketRequestType.default('individual'),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
  questionCodes: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  // multipart 첨부 분석 라우트가 서버에서 채우는 내부 컨텍스트. 원본 바이너리 대신
  // 추출 텍스트·파일 메타데이터만 구조화 프롬프트에 바인딩한다.
  attachmentContext: z.string().max(90_000).optional(),
  // 캐시·provenance 용 원본 SHA-256. 프롬프트에는 노출하지 않는다.
  attachmentHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10).optional(),
  answers: z.array(AiInterviewAnswer).max(40).default([]),
});
export type AiStructurizeRunBodyType = z.infer<typeof AiStructurizeRunBody>;

// 최초 질문 전에 제목·설명·첨부에서 이미 답이 확인된 후보 코드를 찾는 선분석 입력.
// attachmentContext는 multipart 라우트가 서버 내부에서만 채우고, 원본은 해시로 추적한다.
export const AiQuestionPreanalysisRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  requestType: MarketRequestType.default('individual'),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
  candidateQuestionCodes: z.array(z.string().trim().min(1).max(30)).max(15),
  attachmentContext: z.string().max(90_000).optional(),
  attachmentHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(10).optional(),
});
export type AiQuestionPreanalysisRunBodyType = z.infer<typeof AiQuestionPreanalysisRunBody>;

export const AiQuestionPreanalysisResult = z.object({
  knownQuestionCodes: z.array(z.string().trim().min(1).max(30)).max(15),
  findings: z.array(z.object({
    code: z.string().trim().min(1).max(30),
    evidence: z.string().trim().min(1).max(300),
  })).max(15),
  // "제가 이해한 내용" 카드용 요약(v2). optional — v1 프롬프트 응답·기존 캐시 잡도 계약을 통과해야 한다.
  // 제목·설명·첨부에 명시된 내용만 담고, 확인되지 않은 필드는 생략한다.
  understood: z.object({
    product: z.string().trim().min(1).max(200).optional(),
    problem: z.string().trim().min(1).max(300).optional(),
    users: z.string().trim().min(1).max(200).optional(),
    environment: z.string().trim().min(1).max(200).optional(),
    coreFunctions: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
    materials: z.string().trim().min(1).max(200).optional(),
  }).optional(),
});
export type AiQuestionPreanalysisResultType = z.infer<typeof AiQuestionPreanalysisResult>;

// ── R&D: 첨부 묶음 분류 ────────────────────────────────────────────────────
// 원본 파일은 서버에 저장하지 않는다. 브라우저가 보유한 clientId 는 인메모리 잡의
// 소유 확인과 동일 브라우저 내 재시도 캐시에만 쓰며, 신원 식별자가 아니다.
export const RndClientId = z.string().uuid();

export const RndFileClassifyPayload = z.object({
  clientId: RndClientId,
  requirements: z.string().trim().max(20_000).default(''),
  model: z.string().trim().min(1).max(100),
});
export type RndFileClassifyPayloadType = z.infer<typeof RndFileClassifyPayload>;

export const RndFileManifestItem = z.object({
  id: z.string().regex(/^F\d{4}$/),
  path: z.string().trim().min(1).max(1_000),
  extension: z.string().trim().max(40),
  size: z.number().int().nonnegative(),
  extracted: z.boolean(),
});
export type RndFileManifestItemType = z.infer<typeof RndFileManifestItem>;

export const RndFileCategory = z.enum([
  'image',
  'pdf-document',
  'spreadsheet',
  'text-document',
  'schematic',
  'pcb-layout',
  'gerber-manufacturing',
  'bom',
  'archive',
  'binary-unknown',
  'other',
]);

export const RndFileClassifyInput = z.object({
  requirements: z.string().max(20_000),
  files: z.array(RndFileManifestItem).min(1).max(300),
  attachmentContext: z.string().max(100_000),
});
export type RndFileClassifyInputType = z.infer<typeof RndFileClassifyInput>;

export const RndFileClassification = z.object({
  id: z.string().regex(/^F\d{4}$/),
  // 서버가 입력 manifest에서 다시 붙이는 표시용 경로다. LLM은 id만 반환하면 된다.
  path: z.string().trim().min(1).max(1_000).optional(),
  category: RndFileCategory,
  role: z.string().trim().min(1).max(160),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().trim().min(1).max(500),
});

export const RndFileClassifyResult = z.object({
  summary: z.string().trim().min(1).max(2_000),
  files: z.array(RndFileClassification).max(300),
  warnings: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
});
export type RndFileClassifyResultType = z.infer<typeof RndFileClassifyResult>;

// 분류 결과를 다음 단계인 "PCB 설계 개발의뢰서"에 그대로 전달한다. 원본은 다시
// multipart로 받아 서버 메모리에서만 재추출하므로, 브라우저 캐시의 편집 결과도 반영된다.
export const RndPcbRequestDocumentPayload = z.object({
  clientId: RndClientId,
  requirements: z.string().trim().max(20_000).default(''),
  model: z.string().trim().min(1).max(100),
  classification: RndFileClassifyResult,
});
export type RndPcbRequestDocumentPayloadType = z.infer<typeof RndPcbRequestDocumentPayload>;

export const RndPcbRequestDocumentInput = z.object({
  requirements: z.string().max(20_000),
  classification: RndFileClassifyResult,
  attachmentContext: z.string().max(100_000),
});
export type RndPcbRequestDocumentInputType = z.infer<typeof RndPcbRequestDocumentInput>;

export const RndAiModelsResponse = z.object({
  result: z.literal(true),
  data: z.object({
    // 분류는 실제 이미지도 읽어야 하므로 검증된 비전 모델만 노출한다.
    models: z.array(z.string()),
    // 의뢰서 생성은 추출 텍스트·분류 결과 기반이라 전체 사용 가능 모델을 제공한다.
    documentModels: z.array(z.string()),
  }),
});
export type RndAiModelsResponseType = z.infer<typeof RndAiModelsResponse>;

export const RndAiJobQuery = z.object({ clientId: RndClientId });
export type RndAiJobQueryType = z.infer<typeof RndAiJobQuery>;

// market.request-roc 입력 — 작업검토지시서(Phase 2). 구성 명세 + 의뢰 텍스트 + 인터뷰
// 답변으로 개발자/검수자용 마크다운 문서를 생성한다. 산출은 잡의 md 필드.
export const AiRocRunBody = z.object({
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketServiceArea).max(MARKET_SERVICE_AREAS.length).default([]),
  categories: z.array(MarketCategoryCode).max(MARKET_CATEGORIES.length).default([]),
  cadTools: z.array(MarketToolCode).max(MARKET_TOOL_CODES.length).default([]),
  description: z.string().trim().min(10).max(20000),
  budgetRange: MarketBudgetRange,
  startHopeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  dueHopeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  deadline: MarketProjectDeadline,
  method: MarketProjectMethod,
  spec: z.string().min(2).max(200_000),
  answers: z.array(AiInterviewAnswer).max(60).default([]),
});
export type AiRocRunBodyType = z.infer<typeof AiRocRunBody>;

// market.request-postings 입력 — ROC 와 동일한 원천(명세+답변+의뢰 텍스트)에서 분야별
// 포스팅 카드(JSON, market.ts MarketPostingCards)를 생성한다. 산출은 잡의 json 필드.
export const AiPostingsRunBody = AiRocRunBody;
export type AiPostingsRunBodyType = AiRocRunBodyType;

export const AiRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string(), cached: z.boolean() }),
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
    json: z.string().nullable(), // done 일 때만 — JSON 산출 유스케이스(정규화된 명세 문자열)
    md: z.string().nullable(), // done 일 때만 — 마크다운 산출 유스케이스(작업검토지시서)
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

// 관리자 샘플 테스트 — 저장 전 편집 중인 모델·프롬프트를 고정 비식별 샘플로 실행한다.
// 실제 실행과 같은 잡 조회 계약을 사용하되 유스케이스 활성 여부와 설정 저장은 건드리지 않는다.
export const AiAdminPromptTestRun = z.object({
  useCase: AiUsecaseKey,
  model: z.string().trim().min(1).max(100),
  promptTemplate: z.string().trim().min(10).max(20000),
});
export type AiAdminPromptTestRunType = z.infer<typeof AiAdminPromptTestRun>;

// 모델 목록(연결 테스트 겸용) — 현재 연결(baseUrl·apiKey)로 /api/tags 조회.
export const AiModelsResponse = z.object({
  result: z.literal(true),
  data: z.object({ models: z.array(z.string()) }),
});
export type AiModelsResponseType = z.infer<typeof AiModelsResponse>;
