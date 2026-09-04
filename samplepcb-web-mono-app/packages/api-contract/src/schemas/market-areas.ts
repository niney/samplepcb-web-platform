import { z } from 'zod';

// ── 재능마켓 분야 레지스트리 (docs/AI_DEV_REVIEW.md §13, 2026-09-04 v3) ─────────────
// **분야·질문·희망 툴·추가자료 슬롯·프롬프트 조각의 단일 정본.** 위저드 2단계, 전문가 등록 폼,
// 목록·관리자 필터, 검토서 프롬프트·후처리, 분야 배지, 정밀 구성도 프롬프트가 전부 이 파일에서
// 파생된다. 분야를 더하는 일 = MARKET_AREAS 에 항목 하나 + 프로빙 픽스처 하나. 질문·툴·슬롯을
// 더하는 일 = 해당 분야 항목만 고친다. 다른 파일에 분야 코드를 문자열로 박지 않는다.
//
// 저장 스키마는 z.enum 이 아니라 **문자열 + 레지스트리 검증**이다: 분야를 빼도 옛 저장분 파싱이
// 깨지지 않고 라벨만 "(종료)" 로 바뀐다. 이 파일은 leaf 다 — zod 외에 아무것도 import 하지 않는다
// (market.ts ↔ market-dev-review.ts 순환 참조를 끊는 자리).

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
  readonly options: readonly MarketQuestionOption[]; // '잘 모르겠어요' 는 자동 부착
  readonly notePlaceholder?: string;
  readonly noteRequiredFor?: readonly string[]; // 이 선택지를 고르면 메모 필수
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
  readonly questions: readonly MarketQuestionDef[]; // 분야별 추가 질문(전부 선택, 0~2개)
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

const withUnknown = (options: readonly MarketQuestionOption[]): readonly MarketQuestionOption[] => [
  ...options,
  { code: MARKET_UNKNOWN_CHOICE, label: MARKET_UNKNOWN_LABEL },
];

// ── 공통 질문 4문항 — 어느 분야든 비전문가가 답할 수 있는 것만 ─────────────────────
export const MARKET_COMMON_QUESTIONS: readonly MarketQuestionDef[] = [
  {
    code: 'stage', label: '지금 어떤 상태인가요?', short: '현재 상태', multi: false,
    options: withUnknown([
      { code: 'idea', label: '아이디어만 있어요' },
      { code: 'spec', label: '원하는 기능을 정리한 자료가 있어요' },
      { code: 'schematic', label: '회로도가 있어요' },
      { code: 'pcb', label: 'PCB 설계 파일이 있어요' },
      { code: 'production', label: '이미 만든 제품을 고치고 싶어요' },
    ]),
  },
  {
    code: 'quantity', label: '몇 개나 필요한가요?', short: '수량', multi: false,
    options: withUnknown([
      { code: 'proto_1_10', label: '시제품 1~10개' },
      { code: 'proto_11_100', label: '11~100개' },
      { code: 'mass', label: '양산(대량 생산) 예정' },
    ]),
    notePlaceholder: '예: 먼저 3개, 이후 월 200개',
  },
  {
    code: 'external', label: '함께 쓰는 것이 있나요?', short: '함께 쓰는 것', multi: true,
    options: withUnknown([
      { code: 'none', label: '없어요(장치 단독)' },
      { code: 'mobile_app', label: '스마트폰 앱' },
      { code: 'server_cloud', label: '서버·웹(클라우드)' },
      { code: 'pc_software', label: 'PC 프로그램' },
      { code: 'existing_device', label: '기존 장비·설비' },
    ]),
  },
  {
    code: 'timeline', label: '언제까지 필요한가요?', short: '목표 시점', multi: false,
    options: withUnknown([
      { code: 'asap', label: '가능한 빨리' },
      { code: 'within_1m', label: '1개월 안' },
      { code: 'within_3m', label: '3개월 안' },
      { code: 'flexible', label: '여유 있어요' },
    ]),
    notePlaceholder: '예: 10월 전시회 전까지',
  },
];

// ── 툴 사전 — 같은 목록을 여러 분야가 공유할 수 있다(회로·PCB 의 ECAD) ─────────────
const ECAD_TOOLS: readonly MarketToolOption[] = [
  { code: 'altium', label: 'Altium Designer' },
  { code: 'orcad', label: 'OrCAD · Allegro' },
  { code: 'pads', label: 'PADS' },
  { code: 'xpedition', label: 'Xpedition (Mentor)' },
  { code: 'kicad', label: 'KiCad' },
  { code: 'eagle', label: 'EAGLE' },
];

// ── 분야 5종 — 순서 = 화면 순서(위저드 카드·배지·검토서 분야 카드) ───────────────────
export const MARKET_AREAS: readonly MarketAreaDef[] = [
  {
    code: 'circuit',
    label: '회로 개발',
    short: '회로',
    hint: '어떤 부품을 어떻게 연결할지 설계(회로도·부품 목록)',
    kind: 'hardware',
    questions: [],
    tools: { label: '회로 설계 툴', options: ECAD_TOOLS },
    attachmentSlots: [
      { code: 'schematic', label: '회로도·부품 목록', hint: '있으면 그대로(손그림도 좋아요)' },
      { code: 'reference', label: '참고 제품·사진', hint: '비슷한 제품, 카탈로그, 원하는 모양' },
      { code: 'spec', label: '요구사항·사양서', hint: '기능 목록, 동작 시나리오, 조건' },
    ],
    prompt: {
      what: '부품을 고르고 연결해 회로도와 부품 목록을 만드는 일',
      specItems: ['입력부', '전원부', '통신', '출력·구동부', '보호·절연', '측정·센싱'],
      checks: [
        '상용 AC 전원이나 모터·히터·릴레이·펌프 같은 큰 부하를 제어하면 절연·보호(퓨즈·서지) 방식',
        '전원 입력 종류(어댑터·배터리·AC)가 자료에 없으면 전원 방식',
        '무선(Wi-Fi·BLE·LTE·LoRa)이 있으면 안테나 형태(내장·외장)와 전파 인증',
      ],
    },
  },
  {
    code: 'pcb',
    label: 'PCB 설계',
    short: 'PCB',
    hint: '실제 기판 도면과 제작 파일(아트웍·거버)',
    kind: 'hardware',
    questions: [
      {
        code: 'pcb.outline', label: '기판 크기·모양이 정해져 있나요?', short: '기판 크기', multi: false,
        options: withUnknown([
          { code: 'fixed', label: '정해져 있어요(아래에 적어 주세요)' },
          { code: 'free', label: '아직 자유로워요' },
        ]),
        notePlaceholder: '예: 80×50mm, 케이스에 맞춰야 함',
        noteRequiredFor: ['fixed'],
      },
    ],
    tools: { label: 'PCB 설계 툴', options: ECAD_TOOLS },
    attachmentSlots: [
      { code: 'gerber', label: 'PCB 설계 파일·거버', hint: '기존 설계가 있으면' },
      { code: 'outline', label: '외형·치수 도면', hint: '기판 크기, 구멍 위치, 케이스 도면' },
      { code: 'schematic', label: '회로도', hint: '아트웍의 근거가 되는 회로도' },
    ],
    prompt: {
      what: '회로도를 실제 기판 도면(아트웍)과 제작 파일(거버)로 만드는 일',
      specItems: ['기판 크기·외형', '고정·커넥터 위치', '층수·재질', '제작 수량', '조립·실장'],
      checks: [
        '설치 환경(옥외·고온·다습·진동)이 자료에 없으면 설치 환경',
        '기판 크기·케이스 제약이 자료에 없으면 크기·외형 제약',
      ],
    },
  },
  {
    code: 'firmware',
    label: '펌웨어 개발',
    short: '펌웨어',
    hint: '보드를 동작시키는 프로그램',
    kind: 'hardware',
    questions: [],
    tools: {
      label: '언어·개발환경',
      options: [
        { code: 'c_cpp', label: 'C / C++' },
        { code: 'rust', label: 'Rust' },
        { code: 'micropython', label: 'Python · MicroPython' },
        { code: 'stm32cube', label: 'STM32CubeIDE' },
        { code: 'esp_idf', label: 'ESP-IDF' },
        { code: 'zephyr', label: 'nRF Connect SDK · Zephyr' },
        { code: 'arduino', label: 'Arduino IDE' },
      ],
    },
    attachmentSlots: [
      { code: 'source', label: '기존 펌웨어·소스', hint: '고칠 제품이 있으면' },
      { code: 'protocol', label: '통신 규약·동작 시나리오', hint: '명령 목록, 상태 흐름, 연동 규격' },
    ],
    prompt: {
      what: '보드 위 MCU 가 동작하도록 만드는 프로그램(제어·통신·저장·업데이트)',
      specItems: ['제어 동작', '통신 처리', '데이터 저장', '업데이트(OTA)', '오류 복구', '사용자 조작'],
      checks: [
        'RS-485·CAN 등 외부 장비와 유선 통신이 있으면 통신 규약과 절연 여부',
        '기록·저장 요구가 있으면 보관 기간과 저장 위치(보드·서버)',
      ],
    },
  },
  {
    code: 'app',
    label: '앱 개발',
    short: '앱',
    hint: '휴대폰·태블릿에서 보고 조작하는 화면',
    kind: 'software',
    questions: [
      {
        code: 'app.platform', label: '어떤 기기에서 쓰나요?', short: '앱 기기', multi: true,
        options: withUnknown([
          { code: 'android', label: '안드로이드' },
          { code: 'ios', label: '아이폰' },
          { code: 'tablet', label: '태블릿' },
          { code: 'web', label: '웹 브라우저' },
        ]),
      },
    ],
    tools: {
      label: '앱 개발 방식',
      options: [
        { code: 'flutter', label: 'Flutter · Dart' },
        { code: 'react_native', label: 'React Native · TypeScript' },
        { code: 'kotlin', label: 'Android · Kotlin' },
        { code: 'swift', label: 'iOS · Swift' },
        { code: 'maui', label: '.NET MAUI · C#' },
      ],
    },
    attachmentSlots: [
      { code: 'screens', label: '화면 시안·참고 앱', hint: '손그림, 캡처, 비슷한 앱' },
      { code: 'flow', label: '기능 흐름·시나리오', hint: '사용자가 무엇을 누르면 무엇이 되는지' },
    ],
    prompt: {
      what: '장치와 연결해 보고 조작하는 스마트폰·태블릿·웹 화면',
      specItems: ['화면·기능', '장치 연결 방식', '사용자 계정', '알림', '오프라인 동작'],
      checks: [
        '앱이 장치와 직접 연결되는지(블루투스) 서버를 거치는지 자료에 없으면 연결 경로',
        '사용자 계정·여러 사람이 함께 쓰는지 자료에 없으면 사용자 구조',
      ],
    },
  },
  {
    code: 'server',
    label: '서버 개발',
    short: '서버',
    hint: '데이터를 모아 두고 여러 기기가 함께 쓰는 곳',
    kind: 'software',
    questions: [
      {
        code: 'server.scale', label: '몇 대·몇 명이 함께 쓰나요?', short: '사용 규모', multi: false,
        options: withUnknown([
          { code: 'small', label: '장치 몇 대, 나 혼자·소수' },
          { code: 'medium', label: '수십~수백 대, 여러 사용자' },
          { code: 'large', label: '수천 대 이상·서비스 규모' },
        ]),
      },
    ],
    tools: {
      label: '서버 개발 방식',
      options: [
        { code: 'node', label: 'Node.js · TypeScript' },
        { code: 'spring', label: 'Java · Spring' },
        { code: 'python', label: 'Python · FastAPI/Django' },
        { code: 'dotnet', label: 'C# · .NET' },
        { code: 'go', label: 'Go' },
        { code: 'php', label: 'PHP · Laravel' },
      ],
    },
    attachmentSlots: [
      { code: 'api', label: 'API·데이터 명세', hint: '주고받을 데이터, 기존 연동 규격' },
      { code: 'infra', label: '기존 서버·운영 환경', hint: '이미 쓰는 클라우드·서버가 있으면' },
    ],
    prompt: {
      what: '장치·앱이 주고받는 데이터를 저장하고 관리하는 서버(API·데이터베이스·관리 화면)',
      specItems: ['데이터 수집·저장', 'API·연동', '사용자·권한', '관리 화면', '운영 환경'],
      checks: [
        '데이터를 얼마나 오래 보관하는지 자료에 없으면 보관 기간',
        '기존 서버·클라우드가 있는지 자료에 없으면 운영 환경',
      ],
    },
  },
];

// ── 파생 사전·판정 ─────────────────────────────────────────────────────────
export const MARKET_AREA_CODES: readonly string[] = MARKET_AREAS.map((a) => a.code);
export const MARKET_AREA_MAP: ReadonlyMap<string, MarketAreaDef> = new Map(MARKET_AREAS.map((a) => [a.code, a]));

export const isMarketAreaCode = (code: string): boolean => MARKET_AREA_MAP.has(code);
export const marketArea = (code: string): MarketAreaDef | undefined => MARKET_AREA_MAP.get(code);
// 라벨 — 레지스트리에서 빠진 옛 코드는 "(종료)" 표기로 남는다(파싱은 안 깨진다).
export const marketAreaLabel = (code: string): string => MARKET_AREA_MAP.get(code)?.label ?? `${code}(종료)`;
export const marketAreaShort = (code: string): string => MARKET_AREA_MAP.get(code)?.short ?? code;
// 레지스트리 순서로 정렬 + 미지 코드 제거.
export const sortMarketAreas = (codes: readonly string[]): string[] =>
  MARKET_AREA_CODES.filter((c) => codes.includes(c));

// 분야 배지 — 1개=분야명, 2~4개="회로 + PCB", 전부="풀 개발(회로·PCB·펌웨어·앱·서버)".
export function marketAreaBadge(codes: readonly string[]): string {
  const sorted = sortMarketAreas(codes);
  if (sorted.length === 0) return '';
  if (sorted.length === MARKET_AREA_CODES.length) return `풀 개발(${sorted.map(marketAreaShort).join('·')})`;
  if (sorted.length >= 2) return sorted.map(marketAreaShort).join(' + ');
  return marketAreaLabel(sorted[0] ?? '');
}

// 분야 코드 스키마 — 문자열 + 레지스트리 검증(신규 입력용). 읽기는 MarketAreaCodeLoose.
export const MarketAreaCode = z.string().refine(isMarketAreaCode, { message: 'UNKNOWN_AREA' });
export const MarketAreaCodeLoose = z.string().max(32);
export const MarketAreaCodes = z.array(MarketAreaCode).min(1).max(MARKET_AREAS.length)
  .refine((a) => new Set(a).size === a.length, { message: 'DUPLICATE_AREA' });

// ── 질문 사전(공통 + 분야별) ────────────────────────────────────────────────
export const MARKET_QUESTIONS: readonly MarketQuestionDef[] = [
  ...MARKET_COMMON_QUESTIONS,
  ...MARKET_AREAS.flatMap((a) => a.questions),
];
export const MARKET_QUESTION_MAP: ReadonlyMap<string, MarketQuestionDef> = new Map(MARKET_QUESTIONS.map((q) => [q.code, q]));
export const marketQuestion = (code: string): MarketQuestionDef | undefined => MARKET_QUESTION_MAP.get(code);
// 분야별 질문의 분야 — 공통 질문은 null.
export const marketQuestionArea = (code: string): string | null => {
  const dot = code.indexOf('.');
  return dot > 0 ? code.slice(0, dot) : null;
};
// 선택 분야에서 물을 질문(공통 → 분야 순).
export const marketQuestionsFor = (areas: readonly string[]): MarketQuestionDef[] => [
  ...MARKET_COMMON_QUESTIONS,
  ...sortMarketAreas(areas).flatMap((c) => MARKET_AREA_MAP.get(c)?.questions ?? []),
];

// 답변 하나 — 미응답 문항은 배열에서 빠진다. 옛 사전에서 사라진 문항 코드는 읽기에서 조용히 지난다.
export const MarketAnswer = z.object({
  code: z.string().min(1).max(40),
  choices: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
  note: z.string().trim().max(500).optional(),
});
export type MarketAnswerType = z.infer<typeof MarketAnswer>;

// 저장·읽기용 — 형태만 본다(사전 검증 없음). 신규 입력은 MarketAnswersFor(areas) 로 사전 검증.
export const MarketAnswers = z.array(MarketAnswer).max(MARKET_QUESTIONS.length + 8);
export type MarketAnswersType = z.infer<typeof MarketAnswers>;

// 신규 입력 검증 — 코드 중복·사전에 없는 문항·선택 분야 밖 문항·미지 선택지·단일 선택 위반·메모 필수.
export function marketAnswerIssues(answers: readonly MarketAnswerType[], areas: readonly string[]): string[] {
  const issues: string[] = [];
  const allowed = new Set(marketQuestionsFor(areas).map((q) => q.code));
  const seen = new Set<string>();
  answers.forEach((answer, index) => {
    const at = `answers[${String(index)}]`;
    if (seen.has(answer.code)) issues.push(`${at}: DUPLICATE_CODE`);
    seen.add(answer.code);
    const question = MARKET_QUESTION_MAP.get(answer.code);
    if (question === undefined || !allowed.has(answer.code)) {
      issues.push(`${at}: UNKNOWN_QUESTION`);
      return;
    }
    const valid = new Set(question.options.map((o) => o.code));
    if (answer.choices.some((c) => !valid.has(c))) issues.push(`${at}: INVALID_CHOICE`);
    if (!question.multi && answer.choices.length > 1) issues.push(`${at}: SINGLE_CHOICE`);
    const noteRequired = question.noteRequiredFor?.some((c) => answer.choices.includes(c)) ?? false;
    if (noteRequired && (answer.note ?? '') === '') issues.push(`${at}: NOTE_REQUIRED`);
  });
  return issues;
}

export const isMarketAnswerUnknown = (answer: MarketAnswerType): boolean =>
  answer.choices.length === 1 && answer.choices[0] === MARKET_UNKNOWN_CHOICE;

// 선택 라벨(+메모) 문자열 — 브리프 행·프롬프트·근거 코퍼스가 같은 문자열을 쓴다.
export function marketAnswerText(answer: MarketAnswerType): string {
  const question = MARKET_QUESTION_MAP.get(answer.code);
  const labels = answer.choices
    .map((c) => question?.options.find((o) => o.code === c)?.label ?? c)
    .join(', ');
  const note = answer.note?.trim() ?? '';
  return note === '' ? labels : `${labels} (${note})`;
}

// ── 희망 툴 — 분야별 코드 배열, 빈 배열·미기재 = "전문가 추천" ───────────────────────
export const MARKET_TOOLS_VERSION = 1 as const;
export const MarketTools = z.object({
  version: z.literal(MARKET_TOOLS_VERSION).catch(MARKET_TOOLS_VERSION),
  byArea: z.record(z.string().max(32), z.array(z.string().trim().min(1).max(32)).max(16)).catch({}),
});
export type MarketToolsType = z.infer<typeof MarketTools>;
export const EMPTY_MARKET_TOOLS: MarketToolsType = { version: MARKET_TOOLS_VERSION, byArea: {} };

export const marketToolLabel = (area: string, code: string): string =>
  MARKET_AREA_MAP.get(area)?.tools.options.find((o) => o.code === code)?.label ?? code;

// 신규 입력 검증 — 미지 분야·그 분야 사전에 없는 코드.
export function marketToolIssues(tools: MarketToolsType): string[] {
  const issues: string[] = [];
  for (const [area, codes] of Object.entries(tools.byArea)) {
    const def = MARKET_AREA_MAP.get(area);
    if (def === undefined) {
      issues.push(`tools.byArea.${area}: UNKNOWN_AREA`);
      continue;
    }
    const valid = new Set(def.tools.options.map((o) => o.code));
    for (const c of codes) if (!valid.has(c)) issues.push(`tools.byArea.${area}: UNKNOWN_TOOL:${c}`);
  }
  return issues;
}

// 저장 정규화 — 선택 분야에 속하는 항목만, 빈 배열은 버린다(빈 배열 = 전문가 추천과 같은 뜻).
export function normalizeMarketTools(tools: MarketToolsType, areas: readonly string[]): MarketToolsType {
  const byArea: Record<string, string[]> = {};
  for (const area of sortMarketAreas(areas)) {
    const codes = [...new Set(tools.byArea[area] ?? [])];
    if (codes.length > 0) byArea[area] = codes;
  }
  return { version: MARKET_TOOLS_VERSION, byArea };
}

// 표시용 — 분야별 "라벨 · 라벨" 또는 "전문가 추천".
export interface MarketToolRow { area: string; areaLabel: string; labels: string[] }
export function marketToolRows(tools: MarketToolsType, areas: readonly string[]): MarketToolRow[] {
  return sortMarketAreas(areas).map((area) => ({
    area,
    areaLabel: marketAreaLabel(area),
    labels: (tools.byArea[area] ?? []).map((c) => marketToolLabel(area, c)),
  }));
}
// 전체 툴 코드 → 라벨(분야 무관, 필터 옵션·전문가 카드용). 같은 코드는 같은 라벨이다.
export const MARKET_TOOL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  MARKET_AREAS.flatMap((a) => a.tools.options.map((o) => [o.code, o.label] as const)),
);
export const marketToolCodesOf = (tools: MarketToolsType): string[] =>
  [...new Set(Object.values(tools.byArea).flat())];

// ── 첨부 슬롯 — multipart 파트 이름 `attachment:<area>:<slot>` ↔ sp_file(area, slot) ─────
export const MARKET_ATTACHMENT_FIELD = 'attachment';
export const marketAttachmentField = (area: string, slot: string): string => `${MARKET_ATTACHMENT_FIELD}:${area}:${slot}`;
export interface MarketAttachmentSlotRef { area: string; slot: string }
// 파트 이름 → 슬롯(일반 첨부는 null). 사전에 없는 분야·슬롯은 undefined(거절 대상).
export function parseMarketAttachmentField(field: string): MarketAttachmentSlotRef | null | undefined {
  if (field === MARKET_ATTACHMENT_FIELD) return null;
  const m = /^attachment:([a-z0-9_-]+):([a-z0-9_-]+)$/.exec(field);
  if (m === null) return undefined;
  const area = m[1] ?? '';
  const slot = m[2] ?? '';
  const ok = MARKET_AREA_MAP.get(area)?.attachmentSlots.some((s) => s.code === slot) ?? false;
  return ok ? { area, slot } : undefined;
}
export const marketSlotLabel = (area: string, slot: string): string =>
  MARKET_AREA_MAP.get(area)?.attachmentSlots.find((s) => s.code === slot)?.label ?? slot;
