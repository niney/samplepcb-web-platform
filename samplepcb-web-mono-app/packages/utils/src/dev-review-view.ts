import {
  DEV_REVIEW_QUESTIONS,
  MARKET_SERVICE_AREA_LABELS,
  devReviewAnswerText,
  isDevReviewAnswerUnknown,
} from '@sp/api-contract';
import type {
  DevReviewAnswerType,
  DevReviewAreaType,
  DevReviewOpenQuestionType,
  DevReviewStatsType,
  MarketDevReviewType,
} from '@sp/api-contract';

// AI 사전 검토서 뷰 모델 — 저장하지 않는 파생값(브리프 행·결과물 목록·단계 순서·분야 배지)을
// 렌더 시 계산한다(docs/AI_DEV_REVIEW.md §1). 사전이 바뀌면 옛 검토서도 새 사전으로 보인다.
// LLM 없이 코드가 채우는 부분이라 애초에 "확인 필요"가 생기지 않는다.

const AREA_SHORT: Readonly<Record<DevReviewAreaType, string>> = {
  circuit: '회로',
  pcb: 'PCB',
  firmware: '펌웨어',
};
const AREA_ORDER: readonly DevReviewAreaType[] = ['circuit', 'pcb', 'firmware'];

const sortAreas = (areas: readonly DevReviewAreaType[]): DevReviewAreaType[] =>
  AREA_ORDER.filter((a) => areas.includes(a));

// 분야 배지 — 1개=분야명, 2개="회로 + PCB", 3개="풀 개발(회로·PCB·펌웨어)". 의뢰 유형
// 카드를 대체하는 유일한 "통합" 표기다(§4).
export function devReviewAreaBadge(areas: readonly DevReviewAreaType[]): string {
  const sorted = sortAreas(areas);
  if (sorted.length === AREA_ORDER.length) return `풀 개발(${sorted.map((a) => AREA_SHORT[a]).join('·')})`;
  if (sorted.length >= 2) return sorted.map((a) => AREA_SHORT[a]).join(' + ');
  const only = sorted[0];
  return only === undefined ? '' : MARKET_SERVICE_AREA_LABELS[only];
}

export interface DevReviewBriefRow {
  code: string;
  label: string;
  value: string;
  unknown: boolean; // "잘 모르겠어요" — 브리프에서 확인 필요 톤으로 표시
}

export function buildDevReviewBriefRows(answers: readonly DevReviewAnswerType[]): DevReviewBriefRow[] {
  const byCode = new Map(answers.map((a) => [a.code, a]));
  return DEV_REVIEW_QUESTIONS.flatMap((question) => {
    const answer = byCode.get(question.code);
    if (answer === undefined) return [];
    return [{
      code: question.code,
      label: question.short,
      value: devReviewAnswerText(answer),
      unknown: isDevReviewAnswerUnknown(answer),
    }];
  });
}

// ── 결과물 사전 — 분야 × 원하는 결과물 ─────────────────────────────────────────
interface DeliverableDef {
  readonly key: string;
  readonly label: string;
  readonly area: DevReviewAreaType;
  readonly choice: string; // deliverables 문항 선택지 코드
  readonly standard: boolean; // 분야를 골랐으면 요청 여부와 무관하게 통상 포함
}

const DELIVERABLES: readonly DeliverableDef[] = [
  { key: 'schematic', label: '회로도', area: 'circuit', choice: 'schematic', standard: true },
  { key: 'bom', label: 'BOM(부품 목록)', area: 'circuit', choice: 'bom', standard: true },
  { key: 'circuit-review', label: '회로 설계 검토 기록', area: 'circuit', choice: 'docs', standard: false },
  { key: 'artwork', label: 'PCB 아트웍·거버', area: 'pcb', choice: 'artwork', standard: true },
  { key: 'pnp', label: '좌표(P&P)·드릴 파일', area: 'pcb', choice: 'artwork', standard: true },
  { key: 'fab-spec', label: '제작 사양서(스택업·마감)', area: 'pcb', choice: 'docs', standard: true },
  { key: 'prototype', label: '시제품 조립·통전 검사', area: 'pcb', choice: 'prototype', standard: false },
  { key: 'fw-source', label: '펌웨어 소스·바이너리', area: 'firmware', choice: 'firmware', standard: true },
  { key: 'fw-doc', label: '펌웨어 기능 명세·시험 기록', area: 'firmware', choice: 'docs', standard: false },
];

export interface DevReviewDeliverable {
  key: string;
  label: string;
  area: DevReviewAreaType;
  requested: boolean; // 고객이 결과물 문항에서 직접 고른 것
}

export function buildDevReviewDeliverables(
  areas: readonly DevReviewAreaType[],
  answers: readonly DevReviewAnswerType[],
): DevReviewDeliverable[] {
  const requested = new Set(answers.find((a) => a.code === 'deliverables')?.choices ?? []);
  return DELIVERABLES
    .filter((d) => areas.includes(d.area) && (d.standard || requested.has(d.choice)))
    .map((d) => ({ key: d.key, label: d.label, area: d.area, requested: requested.has(d.choice) }));
}

// ── 개발 단계 순서 — 기간 없음(전문가 입찰 durationDays 가 기간을 정한다) ────────
interface PhaseDef {
  readonly key: string;
  readonly label: string;
  readonly areas: readonly DevReviewAreaType[] | 'all';
  readonly deliverableKeys: readonly string[];
  readonly requiresDeliverable?: string; // 이 결과물이 포함될 때만 단계 노출
}

const PHASES: readonly PhaseDef[] = [
  { key: 'requirements', label: '요구사항 확정', areas: 'all', deliverableKeys: [] },
  { key: 'circuit', label: '회로 설계', areas: ['circuit'], deliverableKeys: ['schematic', 'bom', 'circuit-review'] },
  { key: 'artwork', label: 'PCB 아트웍', areas: ['pcb'], deliverableKeys: ['artwork', 'pnp', 'fab-spec'] },
  { key: 'fabrication', label: 'PCB 제작·조립', areas: ['pcb'], deliverableKeys: ['prototype'], requiresDeliverable: 'prototype' },
  { key: 'firmware', label: '펌웨어 개발', areas: ['firmware'], deliverableKeys: ['fw-source', 'fw-doc'] },
  { key: 'verification', label: '통합 검증·인수', areas: 'all', deliverableKeys: [] },
];

export interface DevReviewPhase {
  key: string;
  label: string;
  areas: DevReviewAreaType[];
  deliverables: string[]; // 이 단계에서 나오는 결과물 라벨
}

export function buildDevReviewPhases(
  areas: readonly DevReviewAreaType[],
  deliverables: readonly DevReviewDeliverable[],
): DevReviewPhase[] {
  const included = new Map(deliverables.map((d) => [d.key, d.label]));
  return PHASES.flatMap((phase) => {
    const phaseAreas = phase.areas === 'all' ? sortAreas(areas) : phase.areas.filter((a) => areas.includes(a));
    if (phaseAreas.length === 0) return [];
    if (phase.requiresDeliverable !== undefined && !included.has(phase.requiresDeliverable)) return [];
    return [{
      key: phase.key,
      label: phase.label,
      areas: phaseAreas,
      deliverables: phase.deliverableKeys.flatMap((k) => {
        const label = included.get(k);
        return label === undefined ? [] : [label];
      }),
    }];
  });
}

export interface DevReviewView {
  areaBadge: string;
  areaLabels: string[];
  briefRows: DevReviewBriefRow[];
  deliverables: DevReviewDeliverable[];
  phases: DevReviewPhase[];
  openQuestions: DevReviewOpenQuestionType[];
  stats: DevReviewStatsType;
}

export function buildDevReviewView(review: MarketDevReviewType): DevReviewView {
  const areas = sortAreas(review.brief.serviceAreas);
  const deliverables = buildDevReviewDeliverables(areas, review.brief.answers);
  return {
    areaBadge: devReviewAreaBadge(areas),
    areaLabels: areas.map((a) => MARKET_SERVICE_AREA_LABELS[a]),
    briefRows: buildDevReviewBriefRows(review.brief.answers),
    deliverables,
    phases: buildDevReviewPhases(areas, deliverables),
    openQuestions: review.openQuestions,
    stats: review.stats,
  };
}
