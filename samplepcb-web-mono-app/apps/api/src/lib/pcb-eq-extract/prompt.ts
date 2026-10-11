// EQ 표 → PcbEqDraft LLM 프롬프트(D20 P2). 두 갈래:
//  · 전체 분석(buildEqParsePrompt) — 직렬화된 표를 받아 문항 구조·원문·한국어 번역·그림 참조까지 한 번에
//  · 번역만(buildEqTranslatePrompt) — 템플릿 파서가 구조를 잡은 뒤 질문·선택지 문구만 한국어로(+유형 보정)
// 출력은 둘 다 JSON 하나 — ollama `format`(JSON 스키마)을 같이 보내고, 받은 뒤 extractJsonObject → coerce →
// PcbEqDraft.safeParse 로 계약을 다시 확인한다(ollama.com 직결은 format 을 무시하기도 한다 — AI_DEV_REVIEW 실측).
import {
  PCB_EQ_ITEM_CATEGORIES,
  PCB_EQ_ITEM_CATEGORY_LABELS,
  PcbEqDraft,
  type PcbEqDraftType,
  type PcbEqItemCategoryType,
  type PcbEqItemOptionType,
} from '@sp/api-contract';
import { glossaryPromptLines } from './glossary';

/** 출하 판(D20 P2-4) — 러너·잡 기록이 이 값을 쓴다. v1·v2 는 프로빙 비교용으로만 남긴다. */
export const EQ_PARSE_PROMPT_VERSION = 'eq-parse-v3';
export const EQ_TRANSLATE_PROMPT_VERSION = 'eq-translate-v1';

const nullableString = { type: ['string', 'null'] } as const;

// 속성 순서가 곧 생성 순서다 — 원문(questionOrig·labelOrig)을 먼저 베끼고 번역을 쓰게 한다.
export const EQ_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['header', 'items'],
  properties: {
    header: {
      type: 'object',
      required: ['customerPartNo', 'factoryPartNo', 'issuedOn'],
      properties: { customerPartNo: nullableString, factoryPartNo: nullableString, issuedOn: nullableString },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['factoryNo', 'category', 'questionOrig', 'question', 'options', 'figureRefs'],
        properties: {
          factoryNo: nullableString,
          category: { type: 'string', enum: [...PCB_EQ_ITEM_CATEGORIES] },
          questionOrig: nullableString,
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'labelOrig', 'label', 'recommended', 'requiresComment'],
              properties: {
                key: { type: 'string' },
                labelOrig: nullableString,
                label: { type: 'string' },
                recommended: { type: 'boolean' },
                requiresComment: { type: 'boolean' },
              },
            },
          },
          figureRefs: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const categoryLines = (): string =>
  PCB_EQ_ITEM_CATEGORIES.map((c) => `${c}=${PCB_EQ_ITEM_CATEGORY_LABELS[c]}`).join(' / ');

// v2(2026-10-11 2단 실측 뒤) — v1 에서 모델들이 공통으로 틀린 두 곳만 규칙을 보탠다:
//  ① 선택지가 열마다 있는 표(方案A|方案B)에서 직렬화 표기의 **열 문자(E·F)를 기호로** 썼다(deepseek-v4.1-flash·gemma4)
//  ② 'Option 1:' 숫자 기호를 A·B 로 바꾸고 labelOrig 에 'Option 1:' 머리를 남겼다(kimi-k3·glm-5.3-flash·gemma4)
// 그리고 질문이 중문·영문 두 칸으로 나뉜 양식(n)의 원문 잇기를 분명히 한다.
// v3(D20 P2-5·P2-7, 사용자 결정 2026-10-11) — v2 에 번역 문체 두 규칙을 보탠다:
//  ③ 이중언어 문항은 같은 뜻이면 한 번만 옮기되 **한쪽에만 있는 정보(수치·파일명·품번)는 반드시 남긴다**
//     (kimi-k3 가 합쳐 옮기며 영문에만 있던 파일명을 빠뜨린 실측 — 실샘플 4번)
//  ④ 선택지 문구는 **고객이 고르는 답의 문장** — '请贵司指示' 류는 "직접 지시하겠습니다(의견 작성)", '귀사'를 쓰지 않는다
export const EQ_PARSE_PROMPT_VERSIONS = ['eq-parse-v1', 'eq-parse-v2', 'eq-parse-v3'] as const;
export type EqParsePromptVersion = (typeof EQ_PARSE_PROMPT_VERSIONS)[number];

const RULE5_V1 =
  '5. options: key = 원문 선택지 기호 그대로(A/B/C, 1/2 …, 빠진 기호를 메우지 않는다). 원문에 기호가 없을 때만 "A","B" 순. labelOrig = 원문 선택지 문구 그대로(기호 제외). label = 한국어 번역.';
const RULE5_V2 = `5. options: key = 원문이 선택지에 붙인 기호 그대로 — A/B/C 면 A/B/C, 숫자(1/2, "Option 1", "1)")면 "1","2"(A·B 로 바꾸지 않는다), 빠진 기호를 메우지 않는다. 기호가 전혀 없을 때만(□ 체크박스 등) "A","B" 순.
   ⚠ 입력의 \`E:\`·\`F:\` 같은 **열 문자는 셀 위치일 뿐 선택지 기호가 아니다.** 선택지가 열마다 나뉜 표는 그 열 머리글의 기호(方案A·Option A → "A")를 쓴다.
   labelOrig = 원문 선택지 문구 그대로, 단 앞의 기호 머리("A.", "A：", "(B)", "Option 1:", "□")는 뺀다. label = 한국어 번역.`;
const RULE3_V1 =
  '3. questionOrig = 원문 질문 셀 텍스트를 **글자 그대로 복사**(중국어·영어 모두, 번역·요약·수정 금지, ⏎ 는 공백으로). 이전 회차의 고객 답·비고 칸은 넣지 않는다.';
const RULE3_V2 = `${RULE3_V1} 질문이 중문 칸·영문 칸처럼 두 칸으로 나뉘어 있으면 두 칸을 공백 하나로 이어 넣는다. 질문 앞의 라벨("问题：" 등)은 뺀다.`;

const RULE4_V1 =
  '4. question = 한국 고객이 읽을 자연스러운 한국어(존댓말). 원문에 없는 내용을 더하지 않는다. 파일명·품번·수치·단위는 그대로 둔다. 공장 자신(我司/we)은 "제조사", 고객(贵司/you)은 "귀사"로 옮긴다. 아래 용어집을 따른다.';
const RULE4_V3 = `${RULE4_V1}
   원문이 중문·영문 이중언어일 때: 두 언어가 같은 뜻이면 **한 번만** 옮긴다(같은 말을 두 번 쓰지 않는다). 다만 **한쪽 언어에만 있는 정보(수치·치수·파일명·품번·그림 번호)는 반드시 번역에 남긴다** — 따옴표 속 파일명은 글자 그대로 옮겨 적는다.`;
const RULE5_V3 = `${RULE5_V2}
   label 은 **고객이 고르는 답의 문장**(고객 자신의 말)으로 쓴다 — 接受/Accept → "수용합니다", 请贵司指示 / Pls send your suggestion / please advise → "직접 지시하겠습니다(의견 작성)", 贵司重新提供 → "다시 제공하겠습니다". 선택지 문구(label)에는 '귀사'라는 말을 쓰지 않는다(고객 화면에서 귀사는 자기 자신이다). 원문의 수치·파일명은 label 에도 그대로 남긴다.`;

/** 관리자 추가 지침 상한 — 프롬프트 끝에 붙는다(계약 AI_EXTRA_INSTRUCTIONS_MAX 와 별개의 방어). */
const EXTRA_INSTRUCTIONS_MAX = 2_000;

export function buildEqParsePrompt(
  serialized: string,
  version: EqParsePromptVersion = EQ_PARSE_PROMPT_VERSION,
  extraInstructions = '',
): string {
  const v2 = version !== 'eq-parse-v1';
  const v3 = version === 'eq-parse-v3';
  const extra = extraInstructions.trim().slice(0, EXTRA_INSTRUCTIONS_MAX);
  return `너는 PCB 제조 공장이 보낸 EQ(Engineering Query, 제조 확인 사항) 엑셀 표를 읽어, 한국 고객이 문항별로 답할 수 있는 JSON 으로 바꾸는 도우미다.

## 입력 표기
- \`R8 A:… | D:…\` = 8행의 A열·D열 셀 텍스트(빈 셀은 생략). \`⏎\` = 셀 안 줄바꿈.
- \`세로 병합(같은 블록): R8~R10[ABC]\` = A·B·C열이 8~10행에 걸쳐 합쳐진 한 칸이다(대개 문항 하나의 블록).
- \`[IMG img-2 sheet="图 1" at=C1]\` = 그림(id img-2). 그림 전용 시트(예 "图 1")의 그림은 첨부 칸(附件/Attachment 등)에 그 시트 이름을 적은 문항의 그림이다. 메인 시트 안 그림은 그 행이 속한 문항의 그림이다.

## 규칙
1. 문항 = 공장이 고객에게 묻는 질문 하나. 질문 칸이 빈 번호 슬롯(빈 템플릿 줄)은 버린다. 문구가 빈 선택지는 버린다.
2. factoryNo = 원문 번호를 그대로(예 "1", "EQ-03"). 번호를 새로 매기거나 빠진 번호를 채우지 않는다.
${v2 ? RULE3_V2 : RULE3_V1}
${v3 ? RULE4_V3 : RULE4_V1}
${v3 ? RULE5_V3 : v2 ? RULE5_V2 : RULE5_V1}
6. requiresComment = 고객이 직접 지시·의견을 써야 하는 선택지(请贵司指示 / Pls send your suggestion / 其他请注明 / please advise / specify 등)면 true.
7. recommended = 원문에 권장 표시(推荐 / 建议选此 / recommended 등)가 **글로 적힌** 선택지만 true. 첫 선택지라는 이유만으로 true 로 하지 않는다.
8. category = 아래 목록의 영문 값 하나. 원문에 문제 유형 칸(问题类型/Category)이 있으면 그것을 우선한다.
9. figureRefs = 그 문항의 그림 id 목록(없으면 []). 공장 로고처럼 문항과 무관한 그림은 넣지 않는다. 입력에 없는 id 를 지어내지 않는다.
10. header: customerPartNo(고객 품번)·factoryPartNo(공장 내부 품번, 뒤의 설명어 제외)·issuedOn(표 작성일 YYYY-MM-DD) — 표에 없으면 null.
11. 출력은 JSON 객체 하나만. 설명문·코드펜스를 붙이지 않는다.

## category 목록
${categoryLines()}

## 용어집(원문 → 한국어)
${glossaryPromptLines()}

## 출력 모양
{"header":{"customerPartNo":…,"factoryPartNo":…,"issuedOn":…},"items":[{"factoryNo":"1","category":"legend","questionOrig":"…원문…","question":"…한국어…","options":[{"key":"A","labelOrig":"…","label":"…","recommended":false,"requiresComment":false}],"figureRefs":["img-2"]}]}

## 입력
${serialized}
${extra === '' ? '' : `\n## 관리자 추가 지침(위 규칙과 어긋나면 위 규칙이 이긴다)\n${extra}\n`}`;
}

// ── 번역만(템플릿 구조 + LLM 번역) ──────────────────────────────────────────

export const EQ_TRANSLATE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['factoryNo', 'category', 'question', 'options'],
        properties: {
          factoryNo: nullableString,
          category: { type: 'string', enum: [...PCB_EQ_ITEM_CATEGORIES] },
          question: { type: 'string' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'label'],
              properties: { key: { type: 'string' }, label: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

export function buildEqTranslatePrompt(draft: PcbEqDraftType): string {
  const input = draft.items.map((it) => ({
    factoryNo: it.factoryNo,
    categoryGuess: it.category,
    questionOrig: it.questionOrig,
    options: it.options.map((o) => ({ key: o.key, labelOrig: o.labelOrig })),
  }));
  return `너는 PCB 제조 공장의 EQ(제조 확인 사항) 문항을 한국 고객용 한국어로 옮기는 번역가다.
아래 JSON 의 각 문항에 대해 question(질문 번역)·options[].label(선택지 번역)을 쓰고, category 를 확인한다.

## 규칙
- 자연스러운 존댓말. 원문에 없는 내용을 더하지 않는다. 파일명·품번·수치·단위는 그대로.
- 공장 자신(我司/we)은 "제조사", 고객(贵司/you)은 "귀사".
- factoryNo·key 는 입력 그대로 돌려준다. 선택지 수·순서를 바꾸지 않는다.
- category = 아래 목록의 영문 값 하나(categoryGuess 가 맞으면 그대로).
- 출력은 JSON 객체 하나만.

## category 목록
${categoryLines()}

## 용어집(원문 → 한국어)
${glossaryPromptLines()}

## 입력
${JSON.stringify({ items: input }, null, 1)}
`;
}

// ── 출력 파싱 ──────────────────────────────────────────────────────────────

export type EqJsonParsePath = 'extract' | 'whole' | 'scan';

const hasItems = (v: unknown): boolean => isRecord(v) && Array.isArray(v.items);

/**
 * LLM 출력 → JSON. 공용 extractJsonObject 를 먼저 쓰고, 결과에 `items` 배열이 없으면 구제한다.
 * 2026-10-11 1단 실측: 모델이 items 원소를 줄마다 열 0 에서 `{"factoryNo":…}` 로 찍으면 extractJsonObject 의
 * '마지막 열0 객체' 규칙이 **마지막 문항 하나**를 돌려줬다(minimax-m3·glm-5.3 / 17문항 — 원출력은 온전한 JSON).
 * 공용 함수는 같은 날 고쳐졌고(31758cb85) 이 래퍼는 모양 검사(items 배열)로 남는다 — 다음 회귀를 여기서 잡는다.
 * 구제 순서: 펜스 벗긴 통째 JSON.parse → `{"header"`/`{"items"` 로 여는 균형 객체 중 가장 긴 것.
 */
export function parseEqJson(text: string, extract: (t: string) => unknown): { value: unknown; path: EqJsonParsePath } {
  let first: unknown = null;
  let firstErr: unknown = null;
  try {
    first = extract(text);
    if (hasItems(first)) return { value: first, path: 'extract' };
  } catch (err) {
    firstErr = err;
  }
  const unfenced = (/```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? text).trim();
  try {
    const whole: unknown = JSON.parse(unfenced);
    if (hasItems(whole)) return { value: whole, path: 'whole' };
  } catch {
    // 아래 균형 객체 훑기로
  }
  const starts: number[] = [];
  for (let i = unfenced.indexOf('{'); i >= 0; i = unfenced.indexOf('{', i + 1)) starts.push(i);
  let best: unknown = null;
  let bestLen = 0;
  for (const s of starts) {
    // 최상위 후보만 — `{"header"`·`{"items"` 로 여는 객체(추론문 속 중괄호·문항 객체를 건너뛴다).
    if (!/^\{\s*"(?:header|items)"/.test(unfenced.slice(s, s + 40))) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = s; i < unfenced.length; i += 1) {
      const ch = unfenced[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const span = unfenced.slice(s, i + 1);
          if (span.length > bestLen && span.includes('"items"')) {
            try {
              const v: unknown = JSON.parse(span);
              if (hasItems(v)) {
                best = v;
                bestLen = span.length;
              }
            } catch {
              // 다음 후보
            }
          }
          break;
        }
      }
    }
  }
  if (best !== null) return { value: best, path: 'scan' };
  if (firstErr !== null) throw firstErr instanceof Error ? firstErr : new Error('no JSON object in LLM output');
  return { value: first, path: 'extract' };
}

// ── 출력 정리 ──────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return null;
};
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
const CATEGORY_SET = new Set<string>(PCB_EQ_ITEM_CATEGORIES);

export interface EqCoerceReport {
  /** 정리 없이 계약을 통과했나. */
  rawValid: boolean;
  /** 고친 것들(숫자 번호→문자, 빈 선택지 제거, 모르는 그림 id 제거 …). */
  fixes: string[];
}

/**
 * LLM 출력(이미 JSON 으로 파싱된 값)을 계약 모양으로 다듬는다 — 가벼운 형 변환·빈 값 제거·모르는 그림 id 제거만.
 * 내용을 지어내지 않는다: 질문이 비면 문항을 버리고, 선택지가 하나도 안 남으면 문항을 버린다.
 */
export function coerceEqDraft(raw: unknown, knownImageIds: readonly string[]): { draft: PcbEqDraftType | null; report: EqCoerceReport } {
  const rawValid = PcbEqDraft.safeParse(raw).success;
  const fixes: string[] = [];
  if (!isRecord(raw)) return { draft: null, report: { rawValid, fixes: ['최상위가 객체가 아님'] } };
  const known = new Set(knownImageIds);
  const h = isRecord(raw.header) ? raw.header : {};
  const nonEmpty = (v: unknown): string | null => {
    const s = str(v);
    return s === null || s === '' ? null : s;
  };
  const header = {
    customerPartNo: nonEmpty(h.customerPartNo),
    factoryPartNo: nonEmpty(h.factoryPartNo),
    issuedOn: nonEmpty(h.issuedOn),
  };
  const rawItems = Array.isArray(raw.items) ? (raw.items as unknown[]) : [];
  const items: PcbEqDraftType['items'] = [];
  for (const it of rawItems) {
    if (!isRecord(it)) continue;
    const question = str(it.question) ?? '';
    const questionOrig = str(it.questionOrig);
    if (question === '' && (questionOrig ?? '') === '') {
      fixes.push('빈 질문 문항 제거');
      continue;
    }
    if (typeof it.factoryNo === 'number') fixes.push('번호 숫자→문자');
    const catRaw = str(it.category) ?? 'other';
    const category = (CATEGORY_SET.has(catRaw) ? catRaw : 'other') as PcbEqItemCategoryType;
    if (!CATEGORY_SET.has(catRaw)) fixes.push(`모르는 유형 ${catRaw}→other`);
    const options: PcbEqItemOptionType[] = [];
    for (const o of Array.isArray(it.options) ? (it.options as unknown[]) : []) {
      if (!isRecord(o)) continue;
      const key = str(o.key) ?? '';
      const label = str(o.label) ?? '';
      const labelOrig = str(o.labelOrig);
      if (typeof o.recommended !== 'boolean' || typeof o.requiresComment !== 'boolean') fixes.push('선택지 불리언 누락');
      if (!('labelOrig' in o)) fixes.push('labelOrig 누락');
      if (key === '' || (label === '' && (labelOrig ?? '') === '')) {
        fixes.push('빈 선택지 제거');
        continue;
      }
      options.push({
        key: clip(key, 4),
        label: clip(label === '' ? (labelOrig ?? '') : label, 500),
        labelOrig: labelOrig === null || labelOrig === '' ? null : clip(labelOrig, 1000),
        recommended: o.recommended === true,
        requiresComment: o.requiresComment === true,
      });
    }
    if (options.length === 0) {
      fixes.push('선택지 없는 문항 제거');
      continue;
    }
    if (!Array.isArray(it.figureRefs)) fixes.push('figureRefs 누락');
    const refs = (Array.isArray(it.figureRefs) ? (it.figureRefs as unknown[]) : []).map(str).filter((s): s is string => s !== null);
    const goodRefs = refs.filter((r) => known.has(r));
    if (goodRefs.length !== refs.length) fixes.push('모르는 그림 id 제거');
    items.push({
      factoryNo: str(it.factoryNo) === null ? null : clip(str(it.factoryNo) ?? '', 32),
      category,
      question: clip(question === '' ? (questionOrig ?? '') : question, 4000),
      questionOrig: questionOrig === null || questionOrig === '' ? null : clip(questionOrig, 8000),
      options: options.slice(0, 8),
      figureRefs: [...new Set(goodRefs)].slice(0, 10),
    });
  }
  const parsed = PcbEqDraft.safeParse({ header, items: items.slice(0, 60) });
  return { draft: parsed.success ? parsed.data : null, report: { rawValid, fixes } };
}

const squash = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/**
 * 번역이 원문의 **수치·따옴표 속 파일명**을 빠뜨렸나 — 관리자 검토 경고용(결정적, LLM 없음).
 * 2026-10-11 실측: 이중언어 문항에서 모델이 중문·영문을 한 문장으로 합치며 영문에만 있던 파일명을 떨어뜨린다
 * (실샘플 4번 — kimi-k3·gemma4 3/3회, deepseek-v4.1-flash think=off 는 2·4번 모두). 한 자리 정수는 보지 않는다
 * ('图1'·'2x3' 같은 것 — 번역에서 풀어 쓰는 일이 흔하다).
 */
export function findDroppedFacts(orig: string, korean: string): string[] {
  const target = squash(korean).replace(/(\d),(?=\d{3})/g, '$1'); // 2,865개 = 2865
  const facts = new Set<string>();
  for (const m of orig.matchAll(/['"‘“]([^'"’”\n]{4,120})['"’”]/g)) {
    const q = m[1]?.trim() ?? '';
    // 따옴표 속이 파일명(확장자)이거나 공백 없는 식별자일 때만 — 인치 기호(2u")가 따옴표로 읽혀 문장 조각이
    // '사실'로 걸리는 오경보를 막는다(e 6번 `2u"，我司常规1u"` 실측).
    if (/\.[A-Za-z0-9]{2,5}$/.test(q) || /^[A-Za-z0-9][\w.-]{3,}$/.test(q)) facts.add(q);
  }
  for (const m of orig.matchAll(/\d+(?:\.\d+)?/g)) if (m[0].length >= 2) facts.add(m[0]);
  return [...facts].filter((f) => !target.includes(squash(f)));
}

/** 번역만 결과를 템플릿 구조에 입힌다 — 구조(번호·기호·원문·그림·의견필수)는 템플릿 것이 이긴다. */
export function mergeTranslation(base: PcbEqDraftType, raw: unknown): { draft: PcbEqDraftType; translated: number } {
  const rawItems = isRecord(raw) && Array.isArray(raw.items) ? (raw.items as unknown[]).filter(isRecord) : [];
  let translated = 0;
  const items = base.items.map((it, idx) => {
    const t = rawItems.find((r) => str(r.factoryNo) === it.factoryNo) ?? rawItems[idx];
    if (t === undefined) return it;
    const question = str(t.question);
    const cat = str(t.category);
    const tOptions = Array.isArray(t.options) ? (t.options as unknown[]).filter(isRecord) : [];
    translated += 1;
    return {
      ...it,
      category: cat !== null && CATEGORY_SET.has(cat) ? (cat as PcbEqItemCategoryType) : it.category,
      question: question === null || question === '' ? it.question : clip(question, 4000),
      options: it.options.map((o, oi) => {
        const to = tOptions.find((x) => str(x.key) === o.key) ?? tOptions[oi];
        const label = to === undefined ? null : str(to.label);
        return label === null || label === '' ? o : { ...o, label: clip(label, 500) };
      }),
    };
  });
  return { draft: { header: base.header, items }, translated };
}
