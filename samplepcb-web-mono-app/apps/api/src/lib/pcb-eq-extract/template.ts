// 템플릿 파서 — LLM 없는 기준선(D20 P2). 머리글 낱말로 열 역할을 찾고, 번호 칸으로 문항 블록을 나누고,
// 제안 칸에서 선택지 줄(또는 한 셀 안 'A.… B.…')을 읽는다. 번역은 하지 않는다 — 한국어 칸(question·label)에도
// 원문을 그대로 넣는다. 공장 양식이 다르면 실패해도 된다(draft=null) — 얼마나 통하는지가 프로빙의 측정 대상이고,
// 통한 구조는 "템플릿 구조 + LLM 번역만" 조합의 뼈대가 된다.
import { PcbEqDraft, type PcbEqDraftType, type PcbEqItemCategoryType, type PcbEqItemOptionType } from '@sp/api-contract';
import { categoryFromText } from './glossary';
import { EQ_HEADER_HINT_RE, pickMainSheet } from './serialize';
import type { EqExtract, EqImage, EqSheet } from './types';

export type EqTemplateRole = 'no' | 'date' | 'type' | 'question' | 'attach' | 'suggestion' | 'answer' | 'comment';

// 위에서부터 먼저 맞는 역할 — '描述或备注'(비고)가 '描述'(질문)보다, '请选择答复…option'(답)이 'option'(제안)보다 먼저.
const ROLE_RULES: readonly [EqTemplateRole, RegExp][] = [
  ['no', /^(?:序号|编号|项次|序|No\.?|NO\.?|#|Item(?:\s*No\.?)?|EQ\s*No\.?|EQ\s*#|S\/N)(?:\s|$|[^A-Za-z])/i],
  ['date', /日期|^date\b/i],
  ['type', /问题类型|问题类别|问题分类|类型|类别|types? of problems?|category|^type\b/i],
  ['comment', /备注|remark|comments?\b/i],
  ['answer', /答复|回复|客户确认|客户选择|客户意见|customer'?s?\s*(?:reply|answer|decision|confirm|feedback)|^reply|^answer|choose one/i],
  ['attach', /附件|附图|图片|图示|attachment|picture|^fig/i],
  ['suggestion', /建议|方案|解决|选项|recommendation|suggestion|proposal|proposed|option|solution/i],
  ['question', /问题描述|问题内容|问题|描述|description|problem|query|question|issue|content/i],
];

const roleOf = (text: string): EqTemplateRole | null => {
  const t = text.trim();
  if (t === '' || t.length > 120) return null;
  for (const [role, re] of ROLE_RULES) if (re.test(t)) return role;
  return null;
};

export interface EqTemplateLayout {
  sheetName: string;
  /** 머리글 마지막 행(0 기준) — 데이터는 그다음 행부터. */
  headerRow: number;
  columns: Partial<Record<EqTemplateRole, number>>;
  /** 제안(선택지) 칸 [시작열, 끝열] — 2열 이상이면 첫 열이 기호, 나머지가 문구. */
  suggestionSpan: [number, number];
  /** 선택지가 열마다 하나인 양식('方案A | 方案B') — 열 순서대로의 기호. 아니면 null. */
  optionColumnKeys: string[] | null;
}

export interface EqTemplateResult {
  /** null = 양식을 알아보지 못함. */
  draft: PcbEqDraftType | null;
  layout: EqTemplateLayout | null;
  /** 질문이 비어 버린 번호 슬롯. */
  emptySlots: string[];
  warnings: string[];
}

// 빈 슬롯 자리표시('/', '-', '无', 'N/A') — 질문이 없는 것으로 본다.
const PLACEHOLDER_RE = /^[\s/\-—_.]*$|^(?:无|無|N\/?A|none|nil)$/i;
const NUM_LIKE_RE = /^(?:[A-Za-z]{1,3}[-\s.]?)?\d{1,3}(?:\.\d{1,2})?$/;
const cell = (sheet: EqSheet, r: number, c: number): string => (sheet.rows[r]?.[c] ?? '').trim();

function findHeader(sheet: EqSheet): { row: number; texts: string[] } | null {
  let best: { row: number; texts: string[]; score: number } | null = null;
  const limit = Math.min(sheet.rows.length, 40);
  for (let r = 0; r < limit; r += 1) {
    const row = sheet.rows[r] ?? [];
    const next = sheet.rows[r + 1] ?? [];
    const nextIsData = next.slice(0, 3).some((c) => NUM_LIKE_RE.test(c.trim()));
    const variants: { row: number; texts: string[] }[] = [{ row: r, texts: row }];
    if (!nextIsData && next.length > 0) {
      const width = Math.max(row.length, next.length);
      variants.push({
        row: r + 1,
        texts: Array.from({ length: width }, (_, c) => `${row[c] ?? ''} ${next[c] ?? ''}`.trim()),
      });
    }
    for (const v of variants) {
      const roles = new Set(v.texts.map(roleOf).filter((x): x is EqTemplateRole => x !== null));
      if (!roles.has('question') || !(roles.has('suggestion') || roles.has('answer'))) continue;
      // 두 줄 머리글은 동률이면 진다 — 제목 줄(예 '…问题列表')이 머리글과 합쳐져 열 역할을 흐리는 것을 막는다.
      const score = roles.size - (v.row === r ? 0 : 0.5);
      if (best === null || score > best.score) best = { ...v, score };
    }
  }
  return best === null ? null : { row: best.row, texts: best.texts };
}

function buildLayout(sheet: EqSheet, header: { row: number; texts: string[] }): EqTemplateLayout | null {
  const columns: Partial<Record<EqTemplateRole, number>> = {};
  const roleCols: [number, EqTemplateRole][] = [];
  header.texts.forEach((t, c) => {
    const role = roleOf(t);
    if (role !== null) roleCols.push([c, role]);
  });
  const question = roleCols.find(([, r]) => r === 'question')?.[0];
  if (question === undefined) return null;
  const suggestion = roleCols.find(([c, r]) => r === 'suggestion' && c > question)?.[0];
  const answer = roleCols.find(([c, r]) => r === 'answer' && (suggestion === undefined || c > suggestion))?.[0];
  for (const [c, role] of roleCols) {
    if (columns[role] !== undefined) continue;
    if (role === 'attach' && suggestion !== undefined && c > suggestion) continue; // 제안 칸 뒤 첨부는 공장 제안 첨부
    if (role === 'comment' && suggestion !== undefined && c > suggestion) continue; // 고객 비고
    columns[role] = c;
  }
  columns.question = question;
  if (answer !== undefined) columns.answer = answer;
  let spanStart = suggestion;
  if (spanStart === undefined) {
    // 제안 머리글이 없는 양식 — 질문 다음 첫 빈 머리글 열이 선택지일 수 있다(답 칸 앞까지).
    const after = question + 1;
    if (answer !== undefined && after < answer) spanStart = after;
  }
  if (spanStart === undefined) return null;
  columns.suggestion = spanStart;
  // 열마다 선택지 하나('方案A Option A | 方案B Option B') — 머리글에 기호가 이어지는 동안.
  const keys: string[] = [];
  for (let c = spanStart; c < spanStart + 8; c += 1) {
    const k = OPTION_HEADER_RE.exec(header.texts[c] ?? '')?.[1];
    if (k === undefined) break;
    keys.push(k.toUpperCase());
  }
  if (keys.length >= 2) {
    return {
      sheetName: sheet.name,
      headerRow: header.row,
      columns,
      suggestionSpan: [spanStart, spanStart + keys.length - 1],
      optionColumnKeys: keys,
    };
  }
  // 제안 칸 너비 — 머리글 가로 병합 또는 (제안이 아닌) 다음 역할 열 앞까지(최대 3열). '选项 | 工程建议' 처럼
  // 기호 열과 문구 열이 둘 다 제안 낱말이면 한 칸으로 본다.
  const merge = sheet.merges.find((m) => m.s.col === spanStart && m.s.row <= header.row && m.e.row >= header.row - 1 && m.e.col > m.s.col);
  const nextRoleCol = roleCols
    .filter(([c, r]) => c > spanStart && r !== 'suggestion')
    .map(([c]) => c)
    .sort((a, b) => a - b)[0];
  let spanEnd = merge?.e.col ?? (nextRoleCol === undefined ? spanStart : nextRoleCol - 1);
  spanEnd = Math.min(spanEnd, spanStart + 2);
  return { sheetName: sheet.name, headerRow: header.row, columns, suggestionSpan: [spanStart, spanEnd], optionColumnKeys: null };
}

// ── 선택지 ─────────────────────────────────────────────────────────────────

interface RawOption {
  key: string;
  text: string;
}

const KEY_CELL_RE = /^\(?([A-Ha-h]|[1-9])[.、:：)）]?$/;
const INLINE_MARK_RE = /(?:^|[\s;；,，⏎])(?:Option|OPTION|option|选项|方案)?\s*[(（]?([A-H]|[1-9])[.、:：)）]\s*/g;
const SINGLE_OPTION_RE = /^(?:Option|OPTION|option|选项|方案)?\s*[(（]?([A-H]|[1-9])[.、:：)）]\s*(.+)$/s;
const OPTION_HEADER_RE = /(?:方案|选项|option)\s*([A-H1-9])(?![A-Za-z])/i;

/** 한 셀 안 'A.接受 B.按原稿 C.请贵司指示' → 선택지들. 기호가 A(또는 1)부터 차례로 이어질 때만. */
export function parseInlineOptions(text: string): RawOption[] {
  const marks = [...text.matchAll(INLINE_MARK_RE)].map((m) => ({ key: m[1] ?? '', start: m.index, end: m.index + m[0].length }));
  const seq: typeof marks = [];
  for (const m of marks) {
    const expect = seq.length === 0 ? null : String.fromCharCode((seq[seq.length - 1]?.key ?? 'A').charCodeAt(0) + 1);
    if (seq.length === 0 ? m.key === 'A' || m.key === '1' : m.key === expect) seq.push(m);
  }
  if (seq.length < 2) return [];
  return seq.map((m, i) => ({ key: m.key, text: text.slice(m.end, seq[i + 1]?.start ?? text.length).trim() }));
}

function readOptions(sheet: EqSheet, layout: EqTemplateLayout, from: number, to: number): { options: RawOption[]; keyless: boolean } {
  const [s, e] = layout.suggestionSpan;
  const options: RawOption[] = [];
  let keyless = false;
  if (layout.optionColumnKeys !== null) {
    layout.optionColumnKeys.forEach((key, i) => {
      const texts: string[] = [];
      for (let r = from; r <= to; r += 1) {
        const t = cell(sheet, r, s + i);
        if (t !== '') texts.push(t);
      }
      options.push({ key, text: texts.join('\n') });
    });
    return { options, keyless };
  }
  for (let r = from; r <= to; r += 1) {
    const keyCell = cell(sheet, r, s);
    const rest = Array.from({ length: e - s }, (_, i) => cell(sheet, r, s + 1 + i)).filter((t) => t !== '').join(' ');
    const keyMatch = e > s ? KEY_CELL_RE.exec(keyCell) : null;
    if (keyMatch?.[1] !== undefined) {
      options.push({ key: keyMatch[1].toUpperCase(), text: rest });
      continue;
    }
    const text = [keyCell, rest].filter((t) => t !== '').join(' ');
    if (text === '') continue;
    const inline = parseInlineOptions(text);
    if (inline.length > 0) {
      options.push(...inline);
      continue;
    }
    // 'A.接受'·'Option 1: Accept' 처럼 줄마다 한 선택지(기호가 문구에 붙음)
    const single = SINGLE_OPTION_RE.exec(text);
    if (single?.[1] !== undefined && single[2] !== undefined) {
      options.push({ key: single[1], text: single[2].trim() });
      continue;
    }
    keyless = true;
    options.push({ key: String.fromCharCode(65 + options.length), text });
  }
  return { options, keyless };
}

const REQUIRES_COMMENT_RE =
  /指示|请注明|请说明|请提供|请告知|贵司意见|其他|其它|send your suggestion|your suggestion|your advice|please advise|pls advise|advise us|specify|instruct|other/i;
const RECOMMENDED_RE = /推荐|建议选|[(（]\s*建议\s*[)）]|recommended|\(rec\)|preferred/i;

// ── 그림 ───────────────────────────────────────────────────────────────────

const normName = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
const FIG_SHEET_RE = /^(?:图|圖|fig(?:ure)?\.?|pic(?:ture)?|附图|附件|image|img)\s*[._-]?\s*(\d+)$/i;

function figureSheetsFor(ref: string, sheets: EqSheet[]): EqSheet[] {
  const n = normName(ref);
  if (n === '') return [];
  const exact = sheets.filter((s) => normName(s.name) === n);
  if (exact.length > 0) return exact;
  const nums = [...ref.matchAll(/\d+/g)].map((m) => m[0]);
  if (nums.length === 0) return [];
  return sheets.filter((s) => {
    const m = FIG_SHEET_RE.exec(s.name.trim());
    return m?.[1] !== undefined && nums.includes(String(Number(m[1])));
  });
}

// ── 머리 ───────────────────────────────────────────────────────────────────

const CUSTOMER_PN_RE = /顾客型号|客户型号|客户料号|客户编号|客户P\/?N|Customer\s*P\/?N|Customer\s*Part/i;
const FACTORY_PN_RE = /内部型号|本厂型号|厂内型号|我司型号|生产型号|工厂型号|[A-Z]{2,4}\s*P\/N|Internal\s*P\/?N|Factory\s*P\/?N|Our\s*P\/?N|Job\s*No/i;
const DATE_LABEL_RE = /日期|^date\b|issue date/i;
const PART_TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._\-/]*[A-Za-z0-9]/;

/** 'YYYY-MM-DD' · 'YYYY/M/D' · 'YYYY.M.D' · 'YYYY年M月D日' → YYYY-MM-DD. */
export function normalizeDate(text: string): string | null {
  const m = /(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function labelValue(sheet: EqSheet, r: number, c: number, labelRe: RegExp): string | null {
  const own = cell(sheet, r, c);
  const after = own.replace(labelRe, '').replace(/^[^:：]*[:：]/, '').trim();
  if (after !== '' && !/^[(（].*[)）][:：]?$/.test(after)) {
    const stripped = after.replace(/^[(（][^)）]*[)）]\s*[:：]?\s*/, '').trim();
    if (stripped !== '') return stripped;
  }
  for (let k = c + 1; k <= c + 4; k += 1) {
    const v = cell(sheet, r, k);
    if (v !== '') return v;
  }
  return null;
}

function readHeader(sheet: EqSheet, headerRow: number): { customerPartNo: string | null; factoryPartNo: string | null; issuedOn: string | null } {
  let customerPartNo: string | null = null;
  let factoryPartNo: string | null = null;
  let issuedOn: string | null = null;
  for (let r = 0; r < headerRow; r += 1) {
    const row = sheet.rows[r] ?? [];
    row.forEach((text, c) => {
      if (text === '' || text.length > 80) return;
      if (customerPartNo === null && CUSTOMER_PN_RE.test(text)) {
        const v = labelValue(sheet, r, c, CUSTOMER_PN_RE);
        customerPartNo = v === null ? null : (PART_TOKEN_RE.exec(v)?.[0] ?? null);
      } else if (factoryPartNo === null && FACTORY_PN_RE.test(text)) {
        const v = labelValue(sheet, r, c, FACTORY_PN_RE);
        factoryPartNo = v === null ? null : (PART_TOKEN_RE.exec(v)?.[0] ?? null);
      } else if (issuedOn === null && DATE_LABEL_RE.test(text)) {
        const v = labelValue(sheet, r, c, DATE_LABEL_RE);
        issuedOn = v === null ? null : normalizeDate(v);
      }
    });
  }
  return { customerPartNo, factoryPartNo, issuedOn };
}

// ── 본체 ───────────────────────────────────────────────────────────────────

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);

function parseSheet(x: EqExtract, sheet: EqSheet, warnings: string[]): EqTemplateResult | null {
  const header = findHeader(sheet);
  if (header === null) return null;
  const layout = buildLayout(sheet, header);
  if (layout === null) return null;
  const { columns } = layout;
  const qCol = columns.question ?? 0;
  const noCol = columns.no;
  const lastRow = sheet.rows.length - 1;

  // 블록 시작 — 번호 칸이 있으면 숫자 같은 번호, 없으면 질문 칸이 찬 행.
  const starts: number[] = [];
  for (let r = layout.headerRow + 1; r <= lastRow; r += 1) {
    if (noCol !== undefined) {
      if (NUM_LIKE_RE.test(cell(sheet, r, noCol))) starts.push(r);
    } else if (cell(sheet, r, qCol) !== '') {
      starts.push(r);
    }
  }
  if (starts.length === 0) return null;

  const mainImages = x.images.filter((i) => i.sheetName === sheet.name && i.anchor !== null);
  const items: PcbEqDraftType['items'] = [];
  const emptySlots: string[] = [];
  let firstItemDate: string | null = null;
  starts.forEach((start, idx) => {
    const nextStart = starts[idx + 1] ?? lastRow + 1;
    // 번호 칸 세로 병합이 있으면 그 끝이 블록 끝(뒤따르는 비고 줄이 블록에 섞이지 않게).
    const merge = sheet.merges.find((m) => m.s.row === start && (m.s.col === (noCol ?? qCol)) && m.e.row > m.s.row);
    const end = Math.min(merge?.e.row ?? nextStart - 1, nextStart - 1, start + 12);
    const factoryNo = noCol === undefined ? String(idx + 1) : cell(sheet, start, noCol).replace(/\.0+$/, '');
    const questionParts: string[] = [];
    for (let r = start; r <= end; r += 1) {
      const q = cell(sheet, r, qCol);
      if (q !== '' && !questionParts.includes(q)) questionParts.push(q);
    }
    const questionOrig = questionParts.join('\n');
    if (PLACEHOLDER_RE.test(questionOrig)) {
      emptySlots.push(factoryNo);
      return;
    }
    const { options: raw, keyless } = readOptions(sheet, layout, start, end);
    const options: PcbEqItemOptionType[] = raw
      .filter((o) => o.text !== '')
      .slice(0, 8)
      .map((o) => ({
        key: clip(o.key, 4),
        label: clip(o.text, 500),
        labelOrig: clip(o.text, 1000),
        recommended: RECOMMENDED_RE.test(o.text),
        requiresComment: REQUIRES_COMMENT_RE.test(o.text),
      }));
    if (keyless) warnings.push(`문항 ${factoryNo}: 선택지 기호가 없어 A·B… 를 붙였습니다`);
    if (options.length === 0) {
      warnings.push(`문항 ${factoryNo}: 선택지를 찾지 못해 '확인' 하나를 넣었습니다`);
      options.push({ key: 'A', label: '확인', labelOrig: null, recommended: false, requiresComment: false });
    }
    const typeText = columns.type === undefined ? '' : cell(sheet, start, columns.type);
    const category: PcbEqItemCategoryType = categoryFromText(typeText) ?? categoryFromText(questionOrig) ?? 'other';

    // 그림 — 첨부 칸의 시트 이름('图 1') → 그 시트 그림 + 블록 행에 걸친 메인 시트 그림.
    const refs = new Set<string>();
    const attachTexts: string[] = [];
    if (columns.attach !== undefined) {
      for (let r = start; r <= end; r += 1) {
        const t = cell(sheet, r, columns.attach);
        if (t !== '') attachTexts.push(t);
      }
    }
    if (attachTexts.length === 0) {
      // 첨부 칸이 없으면 질문 본문의 '如图3'·'fig.2' 를 본다.
      for (const m of questionOrig.matchAll(/(?:图|圖|fig(?:ure)?\.?)\s*(\d+)/gi)) attachTexts.push(`图${m[1] ?? ''}`);
    }
    for (const t of attachTexts) {
      for (const target of figureSheetsFor(t, x.sheets.filter((s) => s !== sheet))) {
        x.images.filter((i: EqImage) => i.sheetName === target.name).forEach((i) => refs.add(i.id));
      }
    }
    for (const img of mainImages) {
      if (img.anchor !== null && img.anchor.row >= start && img.anchor.row <= end) refs.add(img.id);
    }
    if (columns.date !== undefined && firstItemDate === null) firstItemDate = normalizeDate(cell(sheet, start, columns.date));
    items.push({
      factoryNo: clip(factoryNo, 32),
      category,
      question: clip(questionOrig, 4000),
      questionOrig: clip(questionOrig, 8000),
      options,
      figureRefs: [...refs].slice(0, 10),
    });
  });

  const head = readHeader(sheet, layout.headerRow);
  const candidate = {
    header: { ...head, issuedOn: head.issuedOn ?? firstItemDate },
    items: items.slice(0, 60),
  };
  const parsed = PcbEqDraft.safeParse(candidate);
  if (!parsed.success) {
    warnings.push(`템플릿 결과가 계약을 통과하지 못했습니다: ${parsed.error.issues[0]?.message ?? '?'}`);
    return { draft: null, layout, emptySlots, warnings };
  }
  return { draft: parsed.data, layout, emptySlots, warnings };
}

/** LLM 없이 표 구조만으로 PcbEqDraft 를 만든다. 실패하면 draft=null(이유는 warnings). */
export function parseEqTemplate(x: EqExtract): EqTemplateResult {
  const warnings: string[] = [];
  const main = pickMainSheet(x);
  const order = main === null ? x.sheets : [main, ...x.sheets.filter((s) => s !== main)];
  for (const sheet of order) {
    if (!sheet.rows.some((r) => r.some((c) => EQ_HEADER_HINT_RE.test(c)))) continue;
    const res = parseSheet(x, sheet, warnings);
    if (res !== null) return res;
  }
  warnings.push('EQ 머리글(질문·제안/답 칸)을 찾지 못했습니다 — 템플릿이 모르는 양식');
  return { draft: null, layout: null, emptySlots: [], warnings };
}
