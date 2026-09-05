import { marketAreaLabel } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';

// AI 사전 검토서 두 판의 **구조 비교**(docs/DEVELOP_FLOW.md §6.2) — 글자 diff 가 아니라 항목 단위다.
// 검토서는 구조화 JSON 이라 "요구사항 한 줄이 빠졌다", "명세 '전원' 행의 문장이 바뀌었다"처럼 말해야
// 관리자가 읽는다. 매칭 규칙:
//   summary·adminComment·schedule.assumptions = 단일 텍스트(다르면 changed)
//   requirements = text 정확 일치로 짝, 남는 것은 removed/added
//   areas = area 코드로 짝(없으면 분야 통째 added/removed) → summary 텍스트 · spec 은 item 으로 짝 · observations 는 text 일치
//   openQuestions = question 텍스트로 짝 → resolution 변화도 changed(라벨 "확인 결과")
//   schedule = phases 를 name 으로 짝 → 주·산출물·선행 조건·비고 · wishCode 변화 · 한쪽만 있으면 단계 전부 added/removed
//   checks·meta·brief 는 비교하지 않는다(파생값·생성 메타).
// 라벨은 사람이 읽는 위치("회로 개발 › 명세 › 전원") — 유틸은 i18n 이 없어 한국어 하드코딩.

export type DevReviewDiffOp = 'added' | 'removed' | 'changed';
export type DevReviewDiffSection = 'summary' | 'requirements' | 'areas' | 'openQuestions' | 'schedule' | 'adminComment';

export interface DevReviewDiffEntry {
  section: DevReviewDiffSection;
  label: string;
  op: DevReviewDiffOp;
  before: string | null;
  after: string | null;
}

export interface DevReviewDiff {
  entries: DevReviewDiffEntry[];
  changedSections: DevReviewDiffSection[];
  isEmpty: boolean;
}

export const DEV_REVIEW_DIFF_SECTION_LABELS: Record<DevReviewDiffSection, string> = {
  summary: '요약',
  requirements: '핵심 요구사항',
  areas: '분야별 검토·명세',
  openQuestions: '상의 항목',
  schedule: '개발 일정(예상)',
  adminComment: '담당자 의견',
};

const text = (v: string | null | undefined): string => (v ?? '').trim();

/** 같은 키로 두 목록을 짝짓는다 — 순서는 b(after) 기준, 빠진 것은 뒤에. 키가 겹치면 첫 것만 짝. */
function pairByKey<T>(a: readonly T[], b: readonly T[], keyOf: (x: T) => string): { key: string; a: T | null; b: T | null }[] {
  const remainingA = new Map<string, T>();
  for (const x of a) if (!remainingA.has(keyOf(x))) remainingA.set(keyOf(x), x);
  const out: { key: string; a: T | null; b: T | null }[] = [];
  const seenB = new Set<string>();
  for (const y of b) {
    const key = keyOf(y);
    if (seenB.has(key)) continue;
    seenB.add(key);
    const x = remainingA.get(key) ?? null;
    if (x !== null) remainingA.delete(key);
    out.push({ key, a: x, b: y });
  }
  for (const [key, x] of remainingA) out.push({ key, a: x, b: null });
  return out;
}

export function diffDevReview(a: MarketDevReviewType, b: MarketDevReviewType): DevReviewDiff {
  const entries: DevReviewDiffEntry[] = [];
  const push = (section: DevReviewDiffSection, label: string, before: string | null, after: string | null): void => {
    const x = text(before);
    const y = text(after);
    if (x === y) return;
    if (x === '') entries.push({ section, label, op: 'added', before: null, after: y });
    else if (y === '') entries.push({ section, label, op: 'removed', before: x, after: null });
    else entries.push({ section, label, op: 'changed', before: x, after: y });
  };

  // 요약
  push('summary', '요약', a.summary, b.summary);

  // 핵심 요구사항 — text 일치
  for (const p of pairByKey(a.requirements, b.requirements, (r) => text(r.text))) {
    if (p.a === null) push('requirements', '요구사항', null, p.b?.text ?? null);
    else if (p.b === null) push('requirements', '요구사항', p.a.text, null);
  }

  // 분야별 — area 코드
  for (const area of pairByKey(a.areas, b.areas, (x) => x.area)) {
    const name = marketAreaLabel(area.key);
    if (area.a === null && area.b !== null) {
      push('areas', `${name} › 분야`, null, area.b.summary === '' ? '(분야 추가)' : area.b.summary);
      for (const s of area.b.spec) push('areas', `${name} › 명세 › ${s.item}`, null, s.text);
      continue;
    }
    if (area.b === null && area.a !== null) {
      push('areas', `${name} › 분야`, area.a.summary === '' ? '(분야 삭제)' : area.a.summary, null);
      for (const s of area.a.spec) push('areas', `${name} › 명세 › ${s.item}`, s.text, null);
      continue;
    }
    if (area.a === null || area.b === null) continue;
    push('areas', `${name} › 한 줄 요약`, area.a.summary, area.b.summary);
    for (const s of pairByKey(area.a.spec, area.b.spec, (r) => text(r.item))) {
      push('areas', `${name} › 명세 › ${s.key}`, s.a?.text ?? null, s.b?.text ?? null);
    }
    for (const o of pairByKey(area.a.observations, area.b.observations, (r) => text(r.text))) {
      if (o.a === null) push('areas', `${name} › 관찰`, null, o.b?.text ?? null);
      else if (o.b === null) push('areas', `${name} › 관찰`, o.a.text, null);
    }
  }

  // 상의 항목 — question 일치, 확인 결과 변화도 본다
  const questions = pairByKey(a.openQuestions, b.openQuestions, (q) => text(q.question));
  questions.forEach((q, i) => {
    const label = `상의 항목 ${String(i + 1)}`;
    if (q.a === null) push('openQuestions', label, null, q.b?.question ?? null);
    else if (q.b === null) push('openQuestions', label, q.a.question, null);
    else push('openQuestions', `${label} › 확인 결과`, q.a.resolution ?? null, q.b.resolution ?? null);
  });

  // 개발 일정 — name 일치
  const sa = a.schedule ?? null;
  const sb = b.schedule ?? null;
  if (sa !== null || sb !== null) {
    for (const p of pairByKey(sa?.phases ?? [], sb?.phases ?? [], (x) => text(x.name))) {
      const label = `일정 › ${p.key}`;
      if (p.a === null && p.b !== null) push('schedule', label, null, `${String(p.b.minWeeks)}~${String(p.b.maxWeeks)}주`);
      else if (p.b === null && p.a !== null) push('schedule', label, `${String(p.a.minWeeks)}~${String(p.a.maxWeeks)}주`, null);
      else if (p.a !== null && p.b !== null) {
        push('schedule', `${label} › 기간`, `${String(p.a.minWeeks)}~${String(p.a.maxWeeks)}주`, `${String(p.b.minWeeks)}~${String(p.b.maxWeeks)}주`);
        push('schedule', `${label} › 산출물`, p.a.output, p.b.output);
        push('schedule', `${label} › 선행 조건`, p.a.prerequisite, p.b.prerequisite);
        push('schedule', `${label} › 비고`, p.a.note, p.b.note);
      }
    }
    push('schedule', '일정 › 희망 완료 시점', sa?.wishCode ?? null, sb?.wishCode ?? null);
    push('schedule', '일정 › 전제', sa?.assumptions ?? null, sb?.assumptions ?? null);
  }

  // 담당자 의견
  push('adminComment', '담당자 의견', a.adminComment ?? null, b.adminComment ?? null);

  const changedSections = Array.from(new Set(entries.map((e) => e.section)));
  return { entries, changedSections, isEmpty: entries.length === 0 };
}

// ── 단어 단위 하이라이트(LCS) — 변경된 문장을 보여줄 때 어디가 달라졌는지 표시 ─────────
export interface DiffWordToken {
  text: string;
  op: 'same' | 'added' | 'removed';
}

const tokenize = (s: string): string[] => s.split(/(\s+)/).filter((t) => t !== '');

export function diffWords(a: string, b: string): DiffWordToken[] {
  const x = tokenize(a);
  const y = tokenize(b);
  // LCS 표 — 검토서 문장은 짧아(≤ 수백 토큰) O(n·m) 이 충분하다.
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffWordToken[] = [];
  let i = 0;
  let j = 0;
  const emit = (op: DiffWordToken['op'], t: string): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.op === op) last.text += t;
    else out.push({ text: t, op });
  };
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      emit('same', x[i]!);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      emit('removed', x[i]!);
      i += 1;
    } else {
      emit('added', y[j]!);
      j += 1;
    }
  }
  while (i < x.length) emit('removed', x[i++]!);
  while (j < y.length) emit('added', y[j++]!);
  return out;
}
