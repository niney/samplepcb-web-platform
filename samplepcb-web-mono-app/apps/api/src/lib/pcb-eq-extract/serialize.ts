// 추출 결과 → LLM 입력 텍스트. 목표는 "표를 잃지 않는 가장 짧은 글" — 실샘플(셀 220행×65열·병합 133)이
// 수천 토큰 안에 들어가야 한다. 규칙:
//  · 빈 행 제거, 행 표기 `R8 A:… | D:…`(빈 셀 생략), 셀 안 줄바꿈은 ⏎, 연속 공백은 하나로
//  · 병합은 힌트만 — 세로 병합은 행 구간별로 묶고(문항 블록이 보인다), 가로 병합은 앞 20개
//  · 메인 시트(EQ 머리글 낱말이 가장 많은 시트)를 먼저 전부, 그림 전용 시트는 자리표시만,
//    메인 시트가 이름으로 부르는 시트는 전부(상한), 나머지 시트는 앞 몇 행만 엿보기
//  · 그림은 그 행 바로 뒤에 `[IMG img-2 sheet="图 1" at=C1]`
import type { EqExtract, EqImage, EqSheet } from './types';

export const SERIALIZE_DEFAULTS = {
  maxChars: 40_000,
  maxCellChars: 1_500,
  referencedSheetChars: 4_000,
  shortSheetChars: 1_500,
  peekRows: 6,
  peekChars: 600,
} as const;

export interface SerializeOptions {
  maxChars?: number;
}

export function colLetter(col: number): string {
  let n = col + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const cellRef = (row: number, col: number): string => `${colLetter(col)}${String(row + 1)}`;

export function cleanCell(text: string, maxChars: number = SERIALIZE_DEFAULTS.maxCellChars): string {
  const s = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\u3000]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join(' ⏎ ');
  return s.length > maxChars ? `${s.slice(0, maxChars)}…(${String(s.length - maxChars)}자 생략)` : s;
}

// EQ 표 머리글에 흔한 낱말 — 메인 시트 고르기·템플릿 파서 머리글 찾기 공용.
export const EQ_HEADER_HINT_RE =
  /序号|问题|描述|建议|答复|回复|附件|工程|问客|Problem|Description|Recommendation|Suggestion|Proposal|Query|Question|Answer|Reply|Customer|EQ/i;

const nonEmptyCount = (s: EqSheet): number => s.rows.reduce((n, r) => n + r.filter((c) => c !== '').length, 0);

/** 메인 시트 — 앞 40행 머리글 낱말 수(동률이면 셀 수·앞 시트). 셀이 하나도 없으면 null. */
export function pickMainSheet(x: EqExtract): EqSheet | null {
  let best: { sheet: EqSheet; score: number; cells: number } | null = null;
  for (const sheet of x.sheets) {
    const cells = nonEmptyCount(sheet);
    if (cells === 0) continue;
    let score = 0;
    for (const row of sheet.rows.slice(0, 40)) {
      for (const c of row) if (c !== '' && c.length < 200 && EQ_HEADER_HINT_RE.test(c)) score += 1;
    }
    if (best === null || score > best.score || (score === best.score && cells > best.cells * 2)) {
      best = { sheet, score, cells };
    }
  }
  return best?.sheet ?? null;
}

const imgTag = (img: EqImage): string =>
  `[IMG ${img.id} sheet="${img.sheetName}"${img.anchor === null ? '' : ` at=${cellRef(img.anchor.row, img.anchor.col)}`}]`;

function rowLine(row: string[], r: number): string | null {
  const cells: string[] = [];
  row.forEach((c, i) => {
    if (c === '') return;
    cells.push(`${colLetter(i)}:${cleanCell(c)}`);
  });
  return cells.length === 0 ? null : `R${String(r + 1)} ${cells.join(' | ')}`;
}

function mergeHints(sheet: EqSheet): string[] {
  const vertical = new Map<string, Set<string>>();
  const horizontal: string[] = [];
  for (const m of sheet.merges) {
    if (m.e.row > m.s.row) {
      const key = `R${String(m.s.row + 1)}~R${String(m.e.row + 1)}`;
      const cols = vertical.get(key) ?? new Set<string>();
      for (let c = m.s.col; c <= m.e.col; c += 1) cols.add(colLetter(c));
      vertical.set(key, cols);
    } else if (m.e.col > m.s.col) {
      horizontal.push(`${cellRef(m.s.row, m.s.col)}:${cellRef(m.e.row, m.e.col)}`);
    }
  }
  const out: string[] = [];
  const keys = [...vertical.keys()].sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
  if (keys.length > 0) {
    out.push(`세로 병합(같은 블록): ${keys.map((k) => `${k}[${[...(vertical.get(k) ?? [])].join('')}]`).join(' ')}`);
  }
  if (horizontal.length > 0) {
    out.push(`가로 병합: ${horizontal.slice(0, 20).join(' ')}${horizontal.length > 20 ? ` …외 ${String(horizontal.length - 20)}` : ''}`);
  }
  return out;
}

// 행·그림을 행 순서로 섞어 쓴다 — 그림은 걸친 행 바로 뒤(그 행이 비었으면 그림 줄만).
function sheetBody(sheet: EqSheet, images: EqImage[], maxRows: number | null): { lines: string[]; omitted: number } {
  const byRow = new Map<number, EqImage[]>();
  const floating: EqImage[] = [];
  for (const img of images) {
    if (img.anchor === null) floating.push(img);
    else byRow.set(img.anchor.row, [...(byRow.get(img.anchor.row) ?? []), img]);
  }
  const lines: string[] = [];
  let written = 0;
  let omitted = 0;
  const lastRow = Math.max(sheet.rows.length - 1, ...[...byRow.keys()]);
  for (let r = 0; r <= lastRow; r += 1) {
    const line = rowLine(sheet.rows[r] ?? [], r);
    const imgs = byRow.get(r) ?? [];
    if (line === null && imgs.length === 0) continue;
    if (maxRows !== null && written >= maxRows) {
      omitted += 1;
      continue;
    }
    if (line !== null) lines.push(line);
    for (const img of imgs) lines.push(`  ${imgTag(img)}`);
    written += 1;
  }
  for (const img of floating) lines.push(`  ${imgTag(img)} (위치 정보 없음)`);
  return { lines, omitted };
}

const normName = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/** LLM 입력 텍스트. 이미지 바이트는 싣지 않는다(자리표시만). */
export function serializeForLlm(x: EqExtract, options: SerializeOptions = {}): string {
  const maxChars = options.maxChars ?? SERIALIZE_DEFAULTS.maxChars;
  const main = pickMainSheet(x);
  const imagesOf = (name: string): EqImage[] => x.images.filter((i) => i.sheetName === name);
  const head = [
    `# EQ 통합문서: ${x.fileName}${x.innerName === null ? '' : ` (zip 안 ${x.innerName})`} · 형식 ${x.format ?? '?'} · 시트 ${String(x.sheets.length)} · 그림 ${String(x.images.length)}`,
  ];
  if (main === null) return [...head, '(셀이 있는 시트가 없습니다)'].join('\n');

  const mainText = main.rows.flat().map(normName).join('|');
  const blocks: string[] = [];
  const mainBody = sheetBody(main, imagesOf(main.name), null);
  blocks.push(
    [
      `## 메인 시트 "${main.name}"`,
      ...mergeHints(main),
      ...mainBody.lines,
    ].join('\n'),
  );

  const figureOnly: string[] = [];
  const trivial: string[] = [];
  const others: string[] = [];
  for (const sheet of x.sheets) {
    if (sheet === main) continue;
    const imgs = imagesOf(sheet.name);
    const texts = sheet.rows.flat().filter((c) => c !== '');
    // 짧은 문구 3개 이하(예 '返回问客主页' = 메인으로 돌아가기 링크)는 내용이 아니다.
    const isTrivial = texts.length <= 3 && texts.every((t) => t.length <= 20);
    if (isTrivial && imgs.length > 0) {
      figureOnly.push(`- 시트 "${sheet.name}": ${imgs.map(imgTag).join(' ')}`);
      continue;
    }
    if (isTrivial) {
      trivial.push(`"${sheet.name}"`);
      continue;
    }
    // 짧은 시트는 통째로(문항마다 시트 하나인 양식 — 목차·EQ1·EQ2 …), 긴 시트는 메인이 이름으로 부를 때만
    // 상한까지, 아니면 앞 몇 행만(적층표 템플릿 같은 덩어리가 입력을 잡아먹지 않게).
    const whole = sheetBody(sheet, imgs, null);
    const short = whole.lines.join('\n').length <= SERIALIZE_DEFAULTS.shortSheetChars;
    const referenced = mainText.includes(normName(sheet.name));
    const full = short || referenced;
    const body = full ? whole : sheetBody(sheet, imgs, SERIALIZE_DEFAULTS.peekRows);
    const limit = short ? Number.POSITIVE_INFINITY : referenced ? SERIALIZE_DEFAULTS.referencedSheetChars : SERIALIZE_DEFAULTS.peekChars;
    let text = body.lines.join('\n');
    let cut = body.omitted;
    if (text.length > limit) {
      const kept: string[] = [];
      let len = 0;
      for (const line of body.lines) {
        if (len + line.length > limit) break;
        kept.push(line);
        len += line.length + 1;
      }
      cut += body.lines.length - kept.length;
      text = kept.join('\n');
    }
    others.push(
      [
        `## ${full ? '시트' : '보조 시트(앞부분만)'} "${sheet.name}"`,
        text,
        ...(cut > 0 ? [`…(이하 ${String(cut)}행 생략)`] : []),
      ].join('\n'),
    );
  }
  if (figureOnly.length > 0) blocks.push(['## 그림 전용 시트', ...figureOnly].join('\n'));
  if (trivial.length > 0) blocks.push(`## 그림·내용 없는 시트: ${trivial.join(', ')}`);
  blocks.push(...others);

  let out = [...head, ...blocks].join('\n\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n…(입력 상한 ${String(maxChars)}자에서 잘림)`;
  return out;
}
