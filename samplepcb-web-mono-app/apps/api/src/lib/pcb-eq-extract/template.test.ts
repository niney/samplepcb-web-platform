import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { PcbEqDraftType } from '@sp/api-contract';
import { extractEqWorkbook } from './extract';
import type { EqGold } from './probe-score';
import { normalizeDate, parseEqTemplate, parseInlineOptions } from './template';

// 템플릿 파서(LLM 없는 기준선). a~j 는 파서와 함께 만든 양식이라 구조가 정답과 같아야 하고(회귀 방지),
// 홀드아웃 k~n 은 파서를 고정한 뒤 만든 양식이라 결과를 단정하지 않는다(throw 만 안 하면 된다).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '__fixtures__');
const REAL_GOLD = path.resolve(HERE, '../../../../../../.tmp/eq-probe/real/EQ-L050AKM1001.gold.json');

const load = (dir: string, f: string): { gold: EqGold; dir: string } => ({
  gold: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as EqGold,
  dir,
});
const all = readdirSync(FIX)
  .filter((f) => f.endsWith('.gold.json'))
  .sort()
  .map((f) => load(FIX, f));
const tuned = all.filter(({ gold }) => /^[a-j]-/.test(gold.id));
const holdout = all.filter(({ gold }) => /^[k-n]-/.test(gold.id));
if (existsSync(REAL_GOLD)) tuned.push(load(path.dirname(REAL_GOLD), path.basename(REAL_GOLD)));

// 구조 지문 — 번호·원문 질문·선택지(기호·원문·의견필수·권장)·그림.
const structure = (d: PcbEqDraftType): unknown =>
  d.items.map((it) => ({
    no: it.factoryNo,
    q: it.questionOrig,
    opts: it.options.map((o) => [o.key, o.labelOrig, o.requiresComment, o.recommended]),
    figs: [...it.figureRefs].sort(),
  }));

describe('parseInlineOptions', () => {
  it('줄바꿈 구분', () => {
    expect(parseInlineOptions('A.接受\nB.按原稿制作\nC.请贵司指示')).toEqual([
      { key: 'A', text: '接受' },
      { key: 'B', text: '按原稿制作' },
      { key: 'C', text: '请贵司指示' },
    ]);
  });
  it('같은 줄 「A、… B、…」 · 숫자 문구(1.6mm)는 기호가 아니다', () => {
    expect(parseInlineOptions('A、同意 Agree  B、不同意 Disagree').map((o) => o.key)).toEqual(['A', 'B']);
    expect(parseInlineOptions('A.1.6mm B.1.0mm')).toEqual([
      { key: 'A', text: '1.6mm' },
      { key: 'B', text: '1.0mm' },
    ]);
  });
  it('기호가 A 부터 이어지지 않거나 하나뿐이면 빈 배열', () => {
    expect(parseInlineOptions('B.only')).toEqual([]);
    expect(parseInlineOptions('Accept the change')).toEqual([]);
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2026-09-04', '2026-09-04'],
    ['2026/9/18', '2026-09-18'],
    ['2026.10.5', '2026-10-05'],
    ['2026年10月5日', '2026-10-05'],
    ['DD-MM-YYYY', null],
  ])('%s → %s', (input, want) => {
    expect(normalizeDate(input)).toBe(want);
  });
});

describe('템플릿 파서 — 함께 만든 양식(a~j)과 실샘플은 구조가 정답과 같다', () => {
  it.each(tuned.map(({ gold, dir }) => [gold.id, gold, dir] as const))('%s', (_id, gold, dir) => {
    const x = extractEqWorkbook(readFileSync(path.resolve(dir, gold.file)), gold.file);
    const res = parseEqTemplate(x);
    expect(res.draft).not.toBeNull();
    if (res.draft === null) return;
    expect(structure(res.draft)).toEqual(structure(gold.draft));
    expect(res.draft.header).toEqual(gold.draft.header);
    expect(res.emptySlots).toEqual(gold.emptySlots);
    // 유형은 공장 유형 칸이 있으면 맞힌다(d 는 '孔 Hole'·'半孔'·'金手指' 처럼 사전에 없는 칸이 있어 제외).
    if (gold.id !== 'd-inline-figures') {
      for (const [i, it] of res.draft.items.entries()) {
        const g = gold.draft.items[i];
        expect([g?.category, ...(gold.categoryAlt[g?.factoryNo ?? ''] ?? [])]).toContain(it.category);
      }
    }
  });
});

describe('템플릿 파서 — 홀드아웃(k~n)은 실패해도 throw 하지 않는다', () => {
  it.each(holdout.map(({ gold }) => [gold.id, gold] as const))('%s', (_id, gold) => {
    const x = extractEqWorkbook(readFileSync(path.join(FIX, gold.file)), gold.file);
    const res = parseEqTemplate(x);
    expect(res.warnings.length + (res.draft?.items.length ?? 0)).toBeGreaterThan(0);
  });
});
