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
  MarketDevReviewType,
} from '@sp/api-contract';

// AI 사전 검토서 뷰 모델 — 저장하지 않는 파생값(브리프 행·작업 항목·결과물·단계 순서·분야
// 배지)을 렌더 시 계산한다(docs/AI_DEV_REVIEW.md §12). 사전이 바뀌면 옛 검토서도 새 사전으로
// 보인다. LLM 없이 코드가 채우는 부분이라 애초에 근거 검증 대상이 아니다.

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
  unknown: boolean; // "잘 모르겠어요" — 브리프에서 상담 확정 톤으로 표시
}

// 답변한 문항만, 사전 순서로(옛 9문항 답변도 사전에 있어 그대로 보인다).
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

// ── 작업 항목·결과물 사전 — 분야를 골랐으면 통상 포함되는 것(요청 문항 없음) ─────────
interface WorkItemDef {
  readonly area: DevReviewAreaType;
  readonly label: string;
  readonly deliverables: readonly string[];
}

const WORK_ITEMS: readonly WorkItemDef[] = [
  { area: 'circuit', label: '회로 설계', deliverables: ['회로도', 'BOM(부품 목록)'] },
  { area: 'pcb', label: 'PCB 설계', deliverables: ['PCB 아트웍·거버', '좌표(P&P)·드릴 파일', '제작 사양서(스택업·마감)'] },
  { area: 'firmware', label: '펌웨어 개발', deliverables: ['펌웨어 소스·바이너리'] },
];

export interface DevReviewWorkItem {
  area: DevReviewAreaType;
  areaLabel: string;
  label: string;
  deliverables: string[];
}

export function buildDevReviewWorkItems(areas: readonly DevReviewAreaType[]): DevReviewWorkItem[] {
  const sorted = sortAreas(areas);
  return WORK_ITEMS.filter((w) => sorted.includes(w.area)).map((w) => ({
    area: w.area,
    areaLabel: MARKET_SERVICE_AREA_LABELS[w.area],
    label: w.label,
    deliverables: [...w.deliverables],
  }));
}

// ── 개발 단계 순서 — 기간 없음(전문가 입찰 durationDays 가 기간을 정한다) ────────
interface PhaseDef {
  readonly key: string;
  readonly label: string;
  readonly areas: readonly DevReviewAreaType[] | 'all';
  readonly note: string; // 이 단계에서 하는 일 한 줄
}

const PHASES: readonly PhaseDef[] = [
  { key: 'requirements', label: '요구사항 확정', areas: 'all', note: '전문가 상담으로 남은 항목 확정' },
  { key: 'circuit', label: '회로 설계', areas: ['circuit'], note: '회로도·BOM' },
  { key: 'artwork', label: 'PCB 설계', areas: ['pcb'], note: '아트웍·거버·제작 사양서' },
  { key: 'fabrication', label: 'PCB 제작·조립', areas: ['pcb'], note: '보드 제작 후 통전 확인' },
  { key: 'firmware', label: '펌웨어 개발', areas: ['firmware'], note: '기능 구현·단위 시험' },
  { key: 'verification', label: '검증·인수', areas: 'all', note: '통합 시험·결과물 전달' },
];

export interface DevReviewPhase {
  key: string;
  label: string;
  note: string;
}

export function buildDevReviewPhases(areas: readonly DevReviewAreaType[]): DevReviewPhase[] {
  const sorted = sortAreas(areas);
  return PHASES.flatMap((phase) => {
    const applies = phase.areas === 'all' ? sorted.length > 0 : phase.areas.some((a) => sorted.includes(a));
    return applies ? [{ key: phase.key, label: phase.label, note: phase.note }] : [];
  });
}

export interface DevReviewView {
  areaBadge: string;
  areaLabels: string[];
  briefRows: DevReviewBriefRow[];
  workItems: DevReviewWorkItem[];
  phases: DevReviewPhase[];
  openQuestions: DevReviewOpenQuestionType[];
  factCount: number; // 근거 붙은 확정 항목 수(핵심 요구 + 명세 행)
}

export function buildDevReviewView(review: MarketDevReviewType): DevReviewView {
  const areas = sortAreas(review.brief.serviceAreas);
  return {
    areaBadge: devReviewAreaBadge(areas),
    areaLabels: areas.map((a) => MARKET_SERVICE_AREA_LABELS[a]),
    briefRows: buildDevReviewBriefRows(review.brief.answers),
    workItems: buildDevReviewWorkItems(areas),
    phases: buildDevReviewPhases(areas),
    openQuestions: review.openQuestions,
    factCount: review.requirements.length + review.areas.reduce((sum, a) => sum + a.spec.length, 0),
  };
}
