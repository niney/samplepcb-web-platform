import { z } from 'zod';

// ── 분야 레지스트리 팩토리 (2026-09-08) ─────────────────────────────────────────
// 재능마켓(market-areas.ts)과 개발의뢰(develop-areas.ts)가 **같은 모양의 레지스트리**를 각자의 분야·질문으로
// 만든다. 분야 코드·질문·툴·슬롯의 자료형과 파생 함수(정렬·배지·질문 목록·답변 검증·툴·슬롯 파싱)는 전부
// 여기 한 곳에 있고, 두 레지스트리는 `createAreaRegistry(config)` 로 바인딩된 함수 묶음이다.
// 이 파일은 leaf 다 — zod 외에 아무것도 import 하지 않는다.
//
// 질문 `kind`: 'choice'(기본, 칩 선택 + 선택 메모) · 'text'(선택지 없이 서술만 — 개발의뢰 시스템개발 질문처럼
// "누가 어디서 어떻게"를 묻는 자리). text 문항의 답은 choices 빈 배열 + note 다.

export interface MarketQuestionOption {
  readonly code: string;
  readonly label: string;
}

// 질문 하나 — 공통 질문과 분야별 질문이 같은 모양이다. 분야별 질문의 code 는 `${area}.${name}`
// 으로 네임스페이스를 갖는다(답변 저장은 평면 배열 하나, 분야는 code 접두로 알 수 있다).
export interface MarketQuestionDef {
  readonly code: string;
  readonly label: string; // 질문 문장(쉬운 말)
  readonly short: string; // 브리프 행 라벨
  readonly multi: boolean;
  readonly options: readonly MarketQuestionOption[]; // '잘 모르겠어요' 는 withUnknown 으로 부착. text 문항은 빈 배열
  readonly kind?: 'choice' | 'text';
  // 시스템개발 "전문가에게 맡김"에서도 묻는 문항(역할·협업 범위처럼 기술값이 아닌 것). 기본 false = 맡김이면 생략.
  readonly askOnDelegate?: boolean;
  readonly notePlaceholder?: string;
  readonly noteRequiredFor?: readonly string[]; // 이 선택지를 고르면 메모 필수
  readonly required?: boolean; // 등록 전 답해야 한다(모르면 탈출구 선택지) — 공통 조건이 쓴다
  readonly promptHint?: string; // 검토서 프롬프트에 주는 "이 답이 개발에서 뜻하는 것" 한 줄
  readonly why?: string; // 위저드 문항 아래 "왜 묻나요" 한 줄(고객용 — promptHint 와 다르다)
}

export interface MarketToolOption {
  readonly code: string;
  readonly label: string;
}

// 분야별 추가자료 슬롯 — "이 분야에는 이런 자료가 있으면 좋다"는 안내이자 저장 시 sp_file.slot.
export interface MarketAttachmentSlotDef {
  readonly code: string;
  readonly label: string;
  readonly hint: string;
}

export type MarketAreaKind = 'hardware' | 'software';

export interface MarketAreaDef {
  readonly code: string;
  readonly label: string; // '회로 개발'
  readonly short: string; // '회로' — 배지·칩
  readonly hint: string; // 비전문가용 한 줄 설명(위저드 카드)
  readonly kind: MarketAreaKind;
  readonly questions: readonly MarketQuestionDef[]; // 분야별 맞춤 질문 — 배열 순서 = 우선순위
  readonly tools: { readonly label: string; readonly options: readonly MarketToolOption[] };
  readonly attachmentSlots: readonly MarketAttachmentSlotDef[];
  // 검토서·구성도 프롬프트 조각 — 분야가 늘어도 프롬프트 본문은 안 바뀐다.
  readonly prompt: {
    readonly what: string; // 이 분야에서 무엇을 만드는가(모델에게 주는 정의)
    readonly specItems: readonly string[]; // 개발명세서 항목명 예시
    readonly checks: readonly string[]; // 해당하는 경우에만 묻는 상의 항목 규칙
  };
}

export const MARKET_UNKNOWN_CHOICE = 'unknown';
export const MARKET_UNKNOWN_LABEL = '잘 모르겠어요';
export const MARKET_EXPERT_PICK_LABEL = '전문가 추천';
export const MARKET_NEGOTIATE_LABEL = '협의해서 정할게요';

// 탈출구 선택지 — 코드는 언제나 'unknown'(검토서가 상의 항목으로 흘린다), 라벨만 문항 성격에 맞춘다.
export const withUnknown = (
  options: readonly MarketQuestionOption[],
  label: string = MARKET_UNKNOWN_LABEL,
): readonly MarketQuestionOption[] => [...options, { code: MARKET_UNKNOWN_CHOICE, label }];

export const isTextQuestion = (q: MarketQuestionDef): boolean => q.kind === 'text';

// ── 답변·툴 — 레지스트리와 무관한 저장 모양 ────────────────────────────────────────
// 답변 하나 — 미응답 문항은 배열에서 빠진다. 옛 사전에서 사라진 문항 코드는 읽기에서 조용히 지난다.
// choices 는 빈 배열을 허용한다(text 문항) — choice 문항의 빈 choices 는 answerIssues 가 EMPTY_CHOICES 로 막는다.
export const MarketAnswer = z.object({
  code: z.string().min(1).max(40),
  choices: z.array(z.string().trim().min(1).max(40)).max(12),
  note: z.string().trim().max(2000).optional(),
});
export type MarketAnswerType = z.infer<typeof MarketAnswer>;

// 저장·읽기용 — 형태만 본다(사전 검증 없음). 신규 입력은 레지스트리 answerIssues 로 사전 검증.
export const MarketAnswers = z.array(MarketAnswer).max(64);
export type MarketAnswersType = z.infer<typeof MarketAnswers>;

export const isMarketAnswerUnknown = (answer: MarketAnswerType): boolean =>
  answer.choices.length === 1 && answer.choices[0] === MARKET_UNKNOWN_CHOICE;

// 문항 기준 "답했다" — choice 는 선택지 1개 이상, text 는 서술이 비어 있지 않을 때.
export const isMarketAnswered = (
  question: MarketQuestionDef,
  answer: { readonly choices: readonly string[]; readonly note?: string | undefined },
): boolean => (isTextQuestion(question) ? (answer.note ?? '').trim() !== '' : answer.choices.length > 0);

// ── 희망 툴 — 분야별 코드 배열, 빈 배열·미기재 = "전문가 추천" ───────────────────────
export const MARKET_TOOLS_VERSION = 1 as const;
export const MarketTools = z.object({
  version: z.literal(MARKET_TOOLS_VERSION).catch(MARKET_TOOLS_VERSION),
  byArea: z.record(z.string().max(32), z.array(z.string().trim().min(1).max(32)).max(16)).catch({}),
});
export type MarketToolsType = z.infer<typeof MarketTools>;
export const EMPTY_MARKET_TOOLS: MarketToolsType = { version: MARKET_TOOLS_VERSION, byArea: {} };

export interface MarketToolRow { area: string; areaLabel: string; labels: string[] }

// ── 첨부 슬롯 — multipart 파트 이름 `attachment:<area>:<slot>` ↔ sp_file(area, slot) ─────
export const MARKET_ATTACHMENT_FIELD = 'attachment';
export const marketAttachmentField = (area: string, slot: string): string => `${MARKET_ATTACHMENT_FIELD}:${area}:${slot}`;
export interface MarketAttachmentSlotRef { area: string; slot: string }

// ── 팩토리 ──────────────────────────────────────────────────────────────────
export interface AreaRegistryConfig {
  readonly areas: readonly MarketAreaDef[];
  readonly conditions: readonly MarketQuestionDef[]; // 답변에 저장되는 필수 공통 조건(질문 목록 맨 앞)
  readonly common: readonly MarketQuestionDef[]; // 선택 공통 질문
  readonly fullAreaQuestionCap: number; // 전 분야 선택 시 분야당 질문 상한(fullQuestions 가 없을 때)
  readonly fullQuestions?: readonly MarketQuestionDef[]; // 전 분야 선택 시 분야별 질문 **대신** 묻는 문항(개발의뢰 시스템개발)
  readonly fullBadge: (shorts: readonly string[]) => string; // 전 분야 배지 문구
}

export interface AreaRegistry {
  readonly areas: readonly MarketAreaDef[];
  readonly codes: readonly string[];
  readonly map: ReadonlyMap<string, MarketAreaDef>;
  readonly conditions: readonly MarketQuestionDef[];
  readonly common: readonly MarketQuestionDef[];
  readonly fullQuestions: readonly MarketQuestionDef[];
  readonly questions: readonly MarketQuestionDef[]; // 조건 → 공통 → 분야별 → 전 분야 전용
  readonly questionMap: ReadonlyMap<string, MarketQuestionDef>;
  readonly fullAreaQuestionCap: number;
  readonly AreaCode: z.ZodEffects<z.ZodString, string, string>;
  readonly AreaCodes: z.ZodEffects<z.ZodArray<z.ZodEffects<z.ZodString, string, string>>, string[], string[]>;
  readonly isAreaCode: (code: string) => boolean;
  readonly area: (code: string) => MarketAreaDef | undefined;
  readonly areaLabel: (code: string) => string;
  readonly areaShort: (code: string) => string;
  readonly sortAreas: (codes: readonly string[]) => string[];
  readonly isFull: (areas: readonly string[]) => boolean;
  readonly areaBadge: (codes: readonly string[]) => string;
  readonly question: (code: string) => MarketQuestionDef | undefined;
  readonly questionArea: (code: string) => string | null;
  readonly areaQuestionsFor: (areas: readonly string[]) => MarketQuestionDef[];
  readonly questionsFor: (areas: readonly string[]) => MarketQuestionDef[];
  readonly requiredMissing: (
    answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
    areas: readonly string[],
  ) => string[];
  readonly answerIssues: (answers: readonly MarketAnswerType[], areas: readonly string[]) => string[];
  readonly answerText: (answer: MarketAnswerType) => string;
  readonly toolLabel: (area: string, code: string) => string;
  readonly toolIssues: (tools: MarketToolsType) => string[];
  readonly normalizeTools: (tools: MarketToolsType, areas: readonly string[]) => MarketToolsType;
  readonly toolRows: (tools: MarketToolsType, areas: readonly string[]) => MarketToolRow[];
  readonly toolLabels: Readonly<Record<string, string>>;
  readonly parseAttachmentField: (field: string) => MarketAttachmentSlotRef | null | undefined;
  readonly slotLabel: (area: string, slot: string) => string;
}

export function createAreaRegistry(config: AreaRegistryConfig): AreaRegistry {
  const areas = config.areas;
  const codes: readonly string[] = areas.map((a) => a.code);
  const map: ReadonlyMap<string, MarketAreaDef> = new Map(areas.map((a) => [a.code, a]));
  const fullQuestions = config.fullQuestions ?? [];
  const questions: readonly MarketQuestionDef[] = [
    ...config.conditions,
    ...config.common,
    ...areas.flatMap((a) => a.questions),
    ...fullQuestions,
  ];
  const questionMap: ReadonlyMap<string, MarketQuestionDef> = new Map(questions.map((q) => [q.code, q]));

  const isAreaCode = (code: string): boolean => map.has(code);
  const area = (code: string): MarketAreaDef | undefined => map.get(code);
  // 라벨 — 레지스트리에서 빠진 옛 코드는 "(종료)" 표기로 남는다(파싱은 안 깨진다).
  const areaLabel = (code: string): string => map.get(code)?.label ?? `${code}(종료)`;
  const areaShort = (code: string): string => map.get(code)?.short ?? code;
  // 레지스트리 순서로 정렬 + 미지 코드 제거.
  const sortAreas = (list: readonly string[]): string[] => codes.filter((c) => list.includes(c));
  const isFull = (list: readonly string[]): boolean => codes.every((c) => list.includes(c));

  // 분야 배지 — 1개=분야명, 2개 이상="회로 + PCB", 전부=fullBadge.
  const areaBadge = (list: readonly string[]): string => {
    const sorted = sortAreas(list);
    if (sorted.length === 0) return '';
    if (sorted.length === codes.length) return config.fullBadge(sorted.map(areaShort));
    if (sorted.length >= 2) return sorted.map(areaShort).join(' + ');
    return areaLabel(sorted[0] ?? '');
  };

  const AreaCode = z.string().refine(isAreaCode, { message: 'UNKNOWN_AREA' });
  const AreaCodes = z
    .array(AreaCode)
    .min(1)
    .max(areas.length)
    .refine((a) => new Set(a).size === a.length, { message: 'DUPLICATE_AREA' });

  const question = (code: string): MarketQuestionDef | undefined => questionMap.get(code);
  // 분야별 질문의 분야 — 공통 질문은 null.
  const questionArea = (code: string): string | null => {
    const dot = code.indexOf('.');
    return dot > 0 ? code.slice(0, dot) : null;
  };
  // 선택 분야에서 물을 분야별 질문 — 전 분야면 fullQuestions(있으면) 또는 분야당 앞 cap 개만.
  const areaQuestionsFor = (list: readonly string[]): MarketQuestionDef[] => {
    if (isFull(list) && config.fullQuestions !== undefined) return [...config.fullQuestions];
    const cap = isFull(list) ? config.fullAreaQuestionCap : Number.POSITIVE_INFINITY;
    return sortAreas(list).flatMap((c) => (map.get(c)?.questions ?? []).slice(0, cap));
  };
  // 선택 분야에서 물을 질문 전체(조건 → 공통 → 분야 순) — 답변 검증·브리프 순서·프롬프트가 같은 목록을 쓴다.
  const questionsFor = (list: readonly string[]): MarketQuestionDef[] => [
    ...config.conditions,
    ...config.common,
    ...areaQuestionsFor(list),
  ];
  // 필수 문항 중 미응답 코드 — 등록 라우트와 위저드 "다음" 게이트가 같은 함수를 쓴다.
  const requiredMissing = (
    answers: readonly { code: string; choices: readonly string[]; note?: string | undefined }[],
    list: readonly string[],
  ): string[] => {
    const byCode = new Map(answers.map((a) => [a.code, a]));
    return questionsFor(list)
      .filter((q) => {
        if (q.required !== true) return false;
        const a = byCode.get(q.code);
        return a === undefined || !isMarketAnswered(q, a);
      })
      .map((q) => q.code);
  };

  // 신규 입력 검증 — 코드 중복·사전에 없는 문항·선택 분야 밖 문항·미지 선택지·단일 선택 위반·메모 필수·빈 답.
  const answerIssues = (answers: readonly MarketAnswerType[], list: readonly string[]): string[] => {
    const issues: string[] = [];
    const allowed = new Set(questionsFor(list).map((q) => q.code));
    const seen = new Set<string>();
    answers.forEach((answer, index) => {
      const at = `answers[${String(index)}]`;
      if (seen.has(answer.code)) issues.push(`${at}: DUPLICATE_CODE`);
      seen.add(answer.code);
      const q = questionMap.get(answer.code);
      if (q === undefined || !allowed.has(answer.code)) {
        issues.push(`${at}: UNKNOWN_QUESTION`);
        return;
      }
      if (isTextQuestion(q)) {
        if (answer.choices.length > 0) issues.push(`${at}: INVALID_CHOICE`);
        if ((answer.note ?? '').trim() === '') issues.push(`${at}: NOTE_REQUIRED`);
        return;
      }
      if (answer.choices.length === 0) issues.push(`${at}: EMPTY_CHOICES`);
      const valid = new Set(q.options.map((o) => o.code));
      if (answer.choices.some((c) => !valid.has(c))) issues.push(`${at}: INVALID_CHOICE`);
      if (!q.multi && answer.choices.length > 1) issues.push(`${at}: SINGLE_CHOICE`);
      const noteRequired = q.noteRequiredFor?.some((c) => answer.choices.includes(c)) ?? false;
      if (noteRequired && (answer.note ?? '') === '') issues.push(`${at}: NOTE_REQUIRED`);
    });
    return issues;
  };

  // 선택 라벨(+메모) 문자열 — 브리프 행·프롬프트·근거 코퍼스가 같은 문자열을 쓴다. text 문항은 서술 그대로.
  const answerText = (answer: MarketAnswerType): string => {
    const q = questionMap.get(answer.code);
    const labels = answer.choices.map((c) => q?.options.find((o) => o.code === c)?.label ?? c).join(', ');
    const note = answer.note?.trim() ?? '';
    if (labels === '') return note;
    return note === '' ? labels : `${labels} (${note})`;
  };

  const toolLabel = (a: string, code: string): string =>
    map.get(a)?.tools.options.find((o) => o.code === code)?.label ?? code;
  // 신규 입력 검증 — 미지 분야·그 분야 사전에 없는 코드.
  const toolIssues = (tools: MarketToolsType): string[] => {
    const issues: string[] = [];
    for (const [a, list] of Object.entries(tools.byArea)) {
      const def = map.get(a);
      if (def === undefined) {
        issues.push(`tools.byArea.${a}: UNKNOWN_AREA`);
        continue;
      }
      const valid = new Set(def.tools.options.map((o) => o.code));
      for (const c of list) if (!valid.has(c)) issues.push(`tools.byArea.${a}: UNKNOWN_TOOL:${c}`);
    }
    return issues;
  };
  // 저장 정규화 — 선택 분야에 속하는 항목만, 빈 배열은 버린다(빈 배열 = 전문가 추천과 같은 뜻).
  const normalizeTools = (tools: MarketToolsType, list: readonly string[]): MarketToolsType => {
    const byArea: Record<string, string[]> = {};
    for (const a of sortAreas(list)) {
      const c = [...new Set(tools.byArea[a] ?? [])];
      if (c.length > 0) byArea[a] = c;
    }
    return { version: MARKET_TOOLS_VERSION, byArea };
  };
  // 표시용 — 분야별 "라벨 · 라벨" 또는 "전문가 추천".
  const toolRows = (tools: MarketToolsType, list: readonly string[]): MarketToolRow[] =>
    sortAreas(list).map((a) => ({
      area: a,
      areaLabel: areaLabel(a),
      labels: (tools.byArea[a] ?? []).map((c) => toolLabel(a, c)),
    }));
  // 전체 툴 코드 → 라벨(분야 무관, 필터 옵션·전문가 카드용). 같은 코드는 같은 라벨이다.
  const toolLabels: Readonly<Record<string, string>> = Object.fromEntries(
    areas.flatMap((a) => a.tools.options.map((o) => [o.code, o.label] as const)),
  );

  // 파트 이름 → 슬롯(일반 첨부는 null). 사전에 없는 분야·슬롯은 undefined(거절 대상).
  const parseAttachmentField = (field: string): MarketAttachmentSlotRef | null | undefined => {
    if (field === MARKET_ATTACHMENT_FIELD) return null;
    const m = /^attachment:([a-z0-9_-]+):([a-z0-9_-]+)$/.exec(field);
    if (m === null) return undefined;
    const a = m[1] ?? '';
    const slot = m[2] ?? '';
    const ok = map.get(a)?.attachmentSlots.some((s) => s.code === slot) ?? false;
    return ok ? { area: a, slot } : undefined;
  };
  const slotLabel = (a: string, slot: string): string =>
    map.get(a)?.attachmentSlots.find((s) => s.code === slot)?.label ?? slot;

  return {
    areas,
    codes,
    map,
    conditions: config.conditions,
    common: config.common,
    fullQuestions,
    questions,
    questionMap,
    fullAreaQuestionCap: config.fullAreaQuestionCap,
    AreaCode,
    AreaCodes,
    isAreaCode,
    area,
    areaLabel,
    areaShort,
    sortAreas,
    isFull,
    areaBadge,
    question,
    questionArea,
    areaQuestionsFor,
    questionsFor,
    requiredMissing,
    answerIssues,
    answerText,
    toolLabel,
    toolIssues,
    normalizeTools,
    toolRows,
    toolLabels,
    parseAttachmentField,
    slotLabel,
  };
}
