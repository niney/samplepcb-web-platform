// EQ 첨부 한 개 → 문항 초안 + 문항별 검토 표시 + 올릴 그림(D20 P2) — 러너(lib/ai)가 부르는 단 하나의 진입점.
// 정본 docs/PCB_PARTNER_TRACK.md 「D20 P2 설계」 · 근거 docs/PCB_EQ_AI_PROBE.md §7.
//
//   추출(결정적) → 직렬화 → LLM(chat — 러너가 chatWithOptionFallback 으로 구현) → JSON → coerceEqDraft(계약)
//   → 결정적 사후 검사: ① 템플릿 파서가 통하면 구조 대조(structure)·머리 보충 ② 번역이 수치·파일명을 뺐나(translation)
//                       ③ 못 그리는 그림(EMF·WMF 등)은 빼고 표시(figure) ④ 어느 문항도 안 부른 그림(로고)은 버린다
//
// 이 파일은 DB·파일 서버·HTTP 를 모른다 — 입력은 바이트, 출력은 값. LLM 은 `chat` 하나로만 닿는다(테스트는 가짜 chat).
// 실패는 throw 가 아니라 `{ ok:false, reason }` — 사유는 계약 `PCB_EQ_AI_FAIL_REASONS` 그대로다.
import type { PcbEqAiFailReasonType, PcbEqAiFlagType, PcbEqDraftType } from '@sp/api-contract';
import { extractJsonObject } from '../ai/ollama';
import { extractEqWorkbook } from './extract';
import { EQ_DRAFT_JSON_SCHEMA, EQ_PARSE_PROMPT_VERSION, buildEqParsePrompt, coerceEqDraft, findDroppedFacts, parseEqJson } from './prompt';
import { serializeForLlm } from './serialize';
import { parseEqTemplate } from './template';
import type { EqExtract, EqImage } from './types';

export { EQ_DRAFT_JSON_SCHEMA, EQ_PARSE_PROMPT_VERSION };

/** LLM 호출 — 프롬프트와 `format` 스키마를 받아 원출력 문자열을 돌려준다. 실패(전송·타임아웃)는 throw. */
export type EqChat = (prompt: string, jsonSchema: unknown) => Promise<string>;

export interface EqAnalyzedImage {
  /** `draft.items[].figureRefs` 가 가리키는 값(추출기 그림 id, 예 img-2) — 러너가 올린 뒤 fileId 로 바꿔 끼운다. */
  ref: string;
  /** 올릴 파일 이름 — 공장명이 안 드러나게 중립(figure-2.png). */
  name: string;
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  mime: string;
  data: Buffer;
}

export type EqAnalyzeResult =
  | {
      ok: true;
      draft: PcbEqDraftType;
      /** draft.items 와 같은 순서·길이. */
      itemFlags: PcbEqAiFlagType[][];
      /** 문항이 참조하고 브라우저가 그릴 수 있는 그림만. */
      images: EqAnalyzedImage[];
      warnings: string[];
      promptChars: number;
    }
  | { ok: false; reason: PcbEqAiFailReasonType; detail: string };

const SUPPORTED_EXT_RE = /\.(xls|xlsx|xlsm|zip)$/i;
const DRAWABLE: Record<string, { ext: EqAnalyzedImage['ext']; mime: string } | undefined> = {
  png: { ext: 'png', mime: 'image/png' },
  jpg: { ext: 'jpg', mime: 'image/jpeg' },
  gif: { ext: 'gif', mime: 'image/gif' },
  webp: { ext: 'webp', mime: 'image/webp' },
};

const clip = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const fail = (reason: PcbEqAiFailReasonType, detail: string): EqAnalyzeResult => ({ ok: false, reason, detail: clip(detail) });
const normNo = (s: string | null): string =>
  (s ?? '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/^0+(?=\d)/, '')
    .toUpperCase();
const keysOf = (it: PcbEqDraftType['items'][number]): string => it.options.map((o) => o.key.toUpperCase()).join('·');
const marked = (it: PcbEqDraftType['items'][number], field: 'requiresComment' | 'recommended'): string =>
  it.options
    .filter((o) => o[field])
    .map((o) => o.key.toUpperCase())
    .sort()
    .join('·');

// ① 구조 대조 — 템플릿 파서(표 규칙)와 LLM 이 같은 표를 다르게 읽은 문항. 템플릿이 틀렸을 수도 있다(표시는 "볼 곳").
function structureFlags(llm: PcbEqDraftType, tpl: PcbEqDraftType, uncertain: ReadonlySet<string>, warnings: string[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const tplByNo = new Map(tpl.items.map((it) => [normNo(it.factoryNo), it]));
  const seen = new Set<string>();
  llm.items.forEach((it, idx) => {
    const no = normNo(it.factoryNo);
    const t = tplByNo.get(no);
    const diffs: string[] = [];
    if (t === undefined) {
      diffs.push('표 규칙으로 읽은 결과에는 이 번호의 문항이 없습니다 — 번호·문항 범위를 확인해 주세요');
    } else {
      seen.add(no);
      // 표 규칙이 선택지를 자신 있게 못 읽은 문항(기호를 지어 붙임)은 선택지를 견주지 않는다 — 오경보만 낸다(n 의 `A-…` 실측).
      const comparable = !uncertain.has(no);
      if (comparable && keysOf(it) !== keysOf(t)) diffs.push(`선택지 기호가 다릅니다(AI ${keysOf(it)} · 표 규칙 ${keysOf(t)})`);
      else if (comparable) {
        if (marked(it, 'requiresComment') !== marked(t, 'requiresComment')) {
          diffs.push(`의견 필수 선택지가 다릅니다(AI ${marked(it, 'requiresComment') || '없음'} · 표 규칙 ${marked(t, 'requiresComment') || '없음'})`);
        }
        if (marked(it, 'recommended') !== marked(t, 'recommended')) {
          diffs.push(`권장 표시가 다릅니다(AI ${marked(it, 'recommended') || '없음'} · 표 규칙 ${marked(t, 'recommended') || '없음'})`);
        }
      }
      const a = [...it.figureRefs].sort().join(',');
      const b = [...t.figureRefs].sort().join(',');
      if (a !== b) diffs.push(`그림 연결이 다릅니다(AI ${String(it.figureRefs.length)}장 · 표 규칙 ${String(t.figureRefs.length)}장)`);
    }
    if (diffs.length > 0) out.set(idx, diffs);
  });
  const missing = tpl.items.filter((it) => !seen.has(normNo(it.factoryNo))).map((it) => it.factoryNo ?? '?');
  if (missing.length > 0) warnings.push(`표 규칙으로는 문항 ${missing.join(', ')} 도 읽혔으나 AI 초안에 없습니다 — 빠진 문항이 없는지 확인해 주세요`);
  return out;
}

// ② 번역 누락 — 질문과 선택지 각각.
function translationDetail(it: PcbEqDraftType['items'][number]): string | null {
  const parts: string[] = [];
  const q = findDroppedFacts(it.questionOrig ?? '', it.question);
  if (q.length > 0) parts.push(`질문: ${q.slice(0, 4).join(', ')}`);
  for (const o of it.options) {
    const d = findDroppedFacts(o.labelOrig ?? '', o.label);
    if (d.length > 0) parts.push(`선택지 ${o.key}: ${d.slice(0, 3).join(', ')}`);
  }
  return parts.length === 0 ? null : `원문의 수치·파일명이 번역에 없습니다 — ${parts.join(' / ')}`;
}

function readFailure(x: EqExtract): EqAnalyzeResult | null {
  const first = x.warnings[0] ?? '';
  if (x.sheets.length === 0) {
    if (x.problem === 'no_workbook') return fail('unsupported_file', `${x.fileName}: ${first || '엑셀 통합문서가 아닙니다'}`);
    return fail('unreadable', `${x.fileName}: ${first || '시트를 읽지 못했습니다'}`);
  }
  if (!x.sheets.some((s) => s.rows.some((r) => r.some((c) => c !== '')))) {
    return fail('no_items', `${x.fileName}: 시트 ${String(x.sheets.length)}개가 모두 비어 있습니다`);
  }
  return null;
}

/**
 * EQ 첨부 하나를 분석한다. `chat` 은 최대 2번 불린다(JSON 을 못 꺼내거나 계약을 못 넘으면 한 번 더).
 * `chat` 이 throw 하면 다시 부르지 않고 `llm_failed` — 전송 재시도는 부르는 쪽(러너) 정책이다.
 */
export async function analyzeEqFile(
  input: { buf: Buffer; fileName: string; extraInstructions?: string },
  chat: EqChat,
): Promise<EqAnalyzeResult> {
  if (!SUPPORTED_EXT_RE.test(input.fileName.trim())) {
    return fail('unsupported_file', `${input.fileName}: 엑셀(.xls·.xlsx·.zip)이 아닙니다`);
  }
  const extract = extractEqWorkbook(input.buf, input.fileName);
  const unreadable = readFailure(extract);
  if (unreadable !== null) return unreadable;

  const prompt = buildEqParsePrompt(serializeForLlm(extract), EQ_PARSE_PROMPT_VERSION, input.extraInstructions ?? '');
  const imageIds = extract.images.map((i) => i.id);
  const warnings: string[] = [...extract.warnings];

  let draft: PcbEqDraftType | null = null;
  let lastProblem = '';
  for (let attempt = 1; attempt <= 2 && draft === null; attempt += 1) {
    let text: string;
    try {
      text = await chat(prompt, EQ_DRAFT_JSON_SCHEMA);
    } catch (err) {
      return fail('llm_failed', `AI 호출 실패: ${errText(err)}`);
    }
    try {
      const { value } = parseEqJson(text, extractJsonObject);
      // items 배열이 아예 없으면 "문항 0개"가 아니라 잘못된 출력이다(coerce 는 너그러워 빈 초안을 만든다).
      const shaped = typeof value === 'object' && value !== null && Array.isArray((value as { items?: unknown }).items);
      const coerced = shaped ? coerceEqDraft(value, imageIds) : { draft: null, report: { rawValid: false, fixes: [] } };
      if (coerced.draft === null) {
        lastProblem = 'AI 출력이 문항 초안 모양(계약)이 아닙니다';
        continue;
      }
      draft = coerced.draft;
      const fixes = [...new Set(coerced.report.fixes)];
      if (fixes.length > 0) warnings.push(`AI 출력 정리: ${fixes.join(', ')}`);
    } catch (err) {
      lastProblem = `AI 출력에서 JSON 을 꺼내지 못했습니다(${errText(err)})`;
    }
  }
  if (draft === null) return fail('llm_failed', `${lastProblem} — 2회 시도`);
  if (draft.items.length === 0) return fail('no_items', `${input.fileName}: AI 가 문항을 찾지 못했습니다(빈 양식이거나 EQ 표가 아님)`);

  // ── 결정적 사후 검사 ──
  const flags: PcbEqAiFlagType[][] = draft.items.map(() => []);
  const push = (idx: number, code: PcbEqAiFlagType['code'], detail: string): void => {
    flags[idx]?.push({ code, detail: clip(detail) });
  };

  const tpl = parseEqTemplate(extract);
  let header = draft.header;
  if (tpl.draft !== null) {
    const uncertain = new Set(tpl.uncertain.map(normNo));
    for (const [idx, diffs] of structureFlags(draft, tpl.draft, uncertain, warnings)) push(idx, 'structure', diffs.join(' / '));
    // 머리 보충 — LLM 이 비운 칸만(문항 줄에만 날짜가 있는 양식에서 작성일을 null 로 두는 실측).
    header = {
      customerPartNo: header.customerPartNo ?? tpl.draft.header.customerPartNo,
      factoryPartNo: header.factoryPartNo ?? tpl.draft.header.factoryPartNo,
      issuedOn: header.issuedOn ?? tpl.draft.header.issuedOn,
    };
  }

  const byId = new Map<string, EqImage>(extract.images.map((i) => [i.id, i]));
  const images = new Map<string, EqAnalyzedImage>();
  const items = draft.items.map((it, idx) => {
    const t = translationDetail(it);
    if (t !== null) push(idx, 'translation', t);
    const keep: string[] = [];
    const dropped: string[] = [];
    for (const ref of it.figureRefs) {
      const img = byId.get(ref);
      if (img === undefined) continue;
      const kind = DRAWABLE[img.ext];
      if (kind === undefined) {
        dropped.push(img.ext.toUpperCase());
        continue;
      }
      keep.push(ref);
      if (!images.has(ref)) {
        images.set(ref, { ref, name: `figure-${ref.replace(/^img-/, '')}.${kind.ext}`, ext: kind.ext, mime: kind.mime, data: img.data });
      }
    }
    if (dropped.length > 0) {
      push(idx, 'figure', `그림 ${String(dropped.length)}장이 브라우저에서 못 그리는 형식(${[...new Set(dropped)].join('·')})이라 올리지 않았습니다 — 원본 엑셀에서 캡처해 올려 주세요`);
    }
    return { ...it, figureRefs: keep };
  });

  return {
    ok: true,
    draft: { header, items },
    itemFlags: flags,
    images: [...images.values()],
    warnings,
    promptChars: prompt.length,
  };
}
