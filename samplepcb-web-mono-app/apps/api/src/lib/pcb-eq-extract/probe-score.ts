// EQ 분석 프로빙 채점(docs/PCB_EQ_AI_PROBE.md §방법) — 정답(gold) 대비 결정적 점수. 번역 품질은 숫자로
// 재지 않는다(용어집 준수만) — 사람이 보도록 프로브가 나란히 저장한다.
import { PcbEqDraft, type PcbEqDraftType, type PcbEqItemCategoryType } from '@sp/api-contract';
import { glossaryHonored, glossaryMatches } from './glossary';

/** 픽스처 정답 — 생성기가 사양에서 만든다(구조 정답은 구성상 확정, 한국어는 참조 번역). */
export interface EqGold {
  id: string;
  /** gold json 기준 상대 경로. */
  file: string;
  label: string;
  draft: PcbEqDraftType;
  /** factoryNo → 함께 정답으로 치는 유형(공장 분류와 내용 분류가 갈리는 문항). */
  categoryAlt: Record<string, PcbEqItemCategoryType[]>;
  /** 버려야 하는 빈 슬롯 번호. */
  emptySlots: string[];
  notes: string;
}

export const normNo = (s: string | null): string =>
  (s ?? '')
    .trim()
    .replace(/\.0+$/, '')
    .replace(/^0+(?=\d)/, '')
    .toUpperCase();

/** 비교용 정규화 — 공백·⏎·구두점 제거, 소문자. */
export const normText = (s: string): string =>
  s
    .toLowerCase()
    .replace(/⏎/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

const grams = (s: string, n: number): string[] => {
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i += 1) out.push(s.slice(i, i + n));
  return out;
};

/** pred 의 3글자 조각 중 source 에 있는 비율 — 원문 복사 충실도(지어내기 검사). 짧으면 포함 여부. */
export function coverage(pred: string, source: string): number {
  const p = normText(pred);
  const s = normText(source);
  if (p === '') return 0;
  if (p.length < 6) return s.includes(p) ? 1 : 0;
  const set = new Set(grams(s, 3));
  const g = grams(p, 3);
  return g.filter((x) => set.has(x)).length / g.length;
}

/** 두 문자열의 2글자 조각 Dice 유사도. */
export function dice(a: string, b: string): number {
  const x = grams(normText(a), 2);
  const y = grams(normText(b), 2);
  if (x.length === 0 && y.length === 0) return normText(a) === normText(b) ? 1 : 0;
  if (x.length === 0 || y.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of y) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of x) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hit += 1;
      counts.set(g, c - 1);
    }
  }
  return (2 * hit) / (x.length + y.length);
}

export interface EqItemScore {
  goldNo: string;
  predNo: string | null;
  category: boolean;
  optionKeys: boolean;
  optionCount: boolean;
  requiresComment: number;
  recommended: number;
  figureRefs: boolean;
  questionOrigSim: number;
  labelOrigSim: number;
  glossary: { expected: number; honored: number; missed: string[] };
}

export interface EqDraftScore {
  schemaRaw: boolean;
  schemaCoerced: boolean;
  goldItems: number;
  predItems: number;
  matched: number;
  recall: number;
  precision: number;
  categoryAcc: number;
  optionKeysAcc: number;
  optionCountAcc: number;
  requiresCommentAcc: number;
  recommendedAcc: number;
  figureAcc: number;
  emptySlotsDropped: boolean;
  /** 예측 questionOrig 의 원문 충실도 평균(1=그대로 복사). */
  faithfulness: number;
  /** 원문과 겹침이 0.5 미만인 문항 수 — 지어냈을 가능성. */
  fabricated: number;
  questionOrigSim: number;
  glossaryRate: number;
  headerAcc: number;
  /** 0~100 종합 — 문서의 산식. 계약을 못 통과하면 0. */
  total: number;
  items: EqItemScore[];
  extraPredNos: string[];
}

const rate = (num: number, den: number): number => (den === 0 ? 1 : num / den);
const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function headerEq(gold: string | null, pred: string | null): boolean {
  if (gold === null || pred === null) return gold === pred;
  const g = normText(gold);
  const p = normText(pred);
  return g === p || (g !== '' && p !== '' && (g.includes(p) || p.includes(g)));
}

/**
 * @param pred 정리(coerce)한 초안 — null 이면 계약 실패.
 * @param schemaRaw 정리 전 원출력이 계약을 통과했나.
 * @param sourceText LLM 에 준 직렬화 텍스트(원문 충실도 기준).
 */
export function scoreEqDraft(gold: EqGold, pred: PcbEqDraftType | null, schemaRaw: boolean, sourceText: string): EqDraftScore {
  const goldItems = gold.draft.items;
  const empty: EqDraftScore = {
    schemaRaw,
    schemaCoerced: false,
    goldItems: goldItems.length,
    predItems: 0,
    matched: 0,
    recall: 0,
    precision: 0,
    categoryAcc: 0,
    optionKeysAcc: 0,
    optionCountAcc: 0,
    requiresCommentAcc: 0,
    recommendedAcc: 0,
    figureAcc: 0,
    emptySlotsDropped: false,
    faithfulness: 0,
    fabricated: 0,
    questionOrigSim: 0,
    glossaryRate: 0,
    headerAcc: 0,
    total: 0,
    items: [],
    extraPredNos: [],
  };
  if (pred === null || !PcbEqDraft.safeParse(pred).success) return empty;
  const predItems = pred.items;

  // 짝짓기 — 번호가 같으면 짝, 남은 것은 원문 유사도 0.5 이상으로.
  const pairs: [number, number][] = [];
  const usedPred = new Set<number>();
  goldItems.forEach((g, gi) => {
    const pi = predItems.findIndex((p, i) => !usedPred.has(i) && normNo(p.factoryNo) !== '' && normNo(p.factoryNo) === normNo(g.factoryNo));
    if (pi >= 0) {
      pairs.push([gi, pi]);
      usedPred.add(pi);
    }
  });
  goldItems.forEach((g, gi) => {
    if (pairs.some(([x]) => x === gi)) return;
    let best = -1;
    let bestSim = 0.5;
    predItems.forEach((p, pi) => {
      if (usedPred.has(pi)) return;
      const sim = dice(g.questionOrig ?? g.question, p.questionOrig ?? p.question);
      if (sim > bestSim) {
        bestSim = sim;
        best = pi;
      }
    });
    if (best >= 0) {
      pairs.push([gi, best]);
      usedPred.add(best);
    }
  });

  const items: EqItemScore[] = pairs.map(([gi, pi]) => {
    const g = goldItems[gi];
    const p = predItems[pi];
    if (g === undefined || p === undefined) throw new Error('pair out of range');
    const alt = gold.categoryAlt[normNo(g.factoryNo)] ?? [];
    const gKeys = g.options.map((o) => o.key.toUpperCase()).sort();
    const pKeys = p.options.map((o) => o.key.toUpperCase()).sort();
    const byKey = g.options.map((go) => ({ go, po: p.options.find((po) => po.key.toUpperCase() === go.key.toUpperCase()) }));
    const glossaryEntries = glossaryMatches(`${g.questionOrig ?? ''} ${g.options.map((o) => o.labelOrig ?? '').join(' ')}`);
    const korean = `${p.question} ${p.options.map((o) => o.label).join(' ')}`;
    const missed = glossaryEntries.filter((e) => !glossaryHonored(e, korean)).map((e) => e.ko);
    return {
      goldNo: g.factoryNo ?? '',
      predNo: p.factoryNo,
      category: p.category === g.category || alt.includes(p.category),
      optionKeys: gKeys.join(',') === pKeys.join(','),
      optionCount: g.options.length === p.options.length,
      requiresComment: rate(byKey.filter(({ go, po }) => po?.requiresComment === go.requiresComment).length, byKey.length),
      recommended: rate(byKey.filter(({ go, po }) => po?.recommended === go.recommended).length, byKey.length),
      figureRefs: [...g.figureRefs].sort().join(',') === [...p.figureRefs].sort().join(','),
      questionOrigSim: dice(g.questionOrig ?? '', p.questionOrig ?? ''),
      labelOrigSim: avg(byKey.map(({ go, po }) => (po === undefined ? 0 : dice(go.labelOrig ?? go.label, po.labelOrig ?? po.label)))),
      glossary: { expected: glossaryEntries.length, honored: glossaryEntries.length - missed.length, missed },
    };
  });

  const matched = items.length;
  const faith = predItems.map((p) => coverage(p.questionOrig ?? '', sourceText));
  const emptySet = new Set(gold.emptySlots.map(normNo));
  const extraPredNos = predItems.filter((_, i) => !usedPred.has(i)).map((p) => p.factoryNo ?? '?');
  const glossaryExpected = items.reduce((n, i) => n + i.glossary.expected, 0);
  const glossaryHonoredN = items.reduce((n, i) => n + i.glossary.honored, 0);
  const headerFields: [string | null, string | null][] = [
    [gold.draft.header.customerPartNo, pred.header.customerPartNo],
    [gold.draft.header.factoryPartNo, pred.header.factoryPartNo],
    [gold.draft.header.issuedOn, pred.header.issuedOn],
  ];
  const s: EqDraftScore = {
    schemaRaw,
    schemaCoerced: true,
    goldItems: goldItems.length,
    predItems: predItems.length,
    matched,
    recall: rate(matched, goldItems.length),
    precision: rate(matched, predItems.length),
    categoryAcc: rate(items.filter((i) => i.category).length, matched),
    optionKeysAcc: rate(items.filter((i) => i.optionKeys).length, matched),
    optionCountAcc: rate(items.filter((i) => i.optionCount).length, matched),
    requiresCommentAcc: avg(items.map((i) => i.requiresComment)),
    recommendedAcc: avg(items.map((i) => i.recommended)),
    figureAcc: rate(items.filter((i) => i.figureRefs).length, matched),
    emptySlotsDropped: !predItems.some((p) => emptySet.has(normNo(p.factoryNo))),
    faithfulness: avg(faith.map((f) => Math.min(1, f / 0.9))),
    fabricated: faith.filter((f) => f < 0.5).length,
    questionOrigSim: avg(items.map((i) => i.questionOrigSim)),
    glossaryRate: rate(glossaryHonoredN, glossaryExpected),
    headerAcc: headerFields.filter(([g, p]) => headerEq(g, p)).length / headerFields.length,
    total: 0,
    items,
    extraPredNos,
  };
  // 종합 = 100 × [0.7×구조 + 0.15×원문 충실 + 0.15×용어집] × (원출력 계약 통과 1 / 정리 후에만 통과 0.9)
  //  구조 = 0.3 재현 + 0.2 정밀 + 0.15 유형 + 0.2 선택지(기호 0.5·의견필수 0.3·권장 0.2) + 0.15 그림
  const optionScore = matched === 0 ? 0 : avg(items.map((i) => (i.optionKeys ? 0.5 : 0) + 0.3 * i.requiresComment + 0.2 * i.recommended));
  const structure = 0.3 * s.recall + 0.2 * s.precision + 0.15 * s.categoryAcc + 0.2 * optionScore + 0.15 * s.figureAcc;
  s.total = Math.round(100 * (0.7 * structure + 0.15 * s.faithfulness + 0.15 * s.glossaryRate) * (schemaRaw ? 1 : 0.9) * 10) / 10;
  return s;
}
