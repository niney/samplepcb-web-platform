import {
  DEV_REVIEW_QUESTIONS,
  MARKET_SERVICE_AREA_LABELS,
  devReviewAnswerText,
  isDevReviewAnswerUnknown,
} from '@sp/api-contract';
import type {
  DevReviewAnswerType,
  DevReviewAreaType,
  DevReviewCheckType,
  DevReviewObservationType,
  DevReviewOpenQuestionType,
  MarketDevReviewType,
} from '@sp/api-contract';

// AI 사전 검토서 뷰 모델 — 저장하지 않는 파생값(브리프 행·분야
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

// ── 기술개발 검토 결과 카드 — "이 분야가 얼마나 준비됐고 무엇이 남았나"(§12.10) ──────────
// 명세서(무엇이 확정됐나)·상의 항목(무엇을 물어야 하나)과 겹치지 않게, 분야별 확정 수·상담에서 정할 수·
// 검토 관찰만 싣는다. 전부 저장된 검토서에서 결정적으로 센다.
export interface DevReviewAreaCard {
  area: DevReviewAreaType;
  label: string;
  summary: string;
  factCount: number; // 이 분야 명세 확정 행
  openCount: number; // 이 분야로 분류된 상의 항목
  observations: DevReviewObservationType[];
}

export function buildDevReviewAreaCards(review: MarketDevReviewType): DevReviewAreaCard[] {
  const byArea = new Map(review.areas.map((a) => [a.area, a]));
  return sortAreas(review.brief.serviceAreas).map((area) => {
    const src = byArea.get(area);
    return {
      area,
      label: MARKET_SERVICE_AREA_LABELS[area],
      summary: src?.summary ?? '',
      factCount: src?.spec.length ?? 0,
      openCount: review.openQuestions.filter((q) => q.area === area).length,
      observations: src?.observations ?? [],
    };
  });
}

export interface DevReviewView {
  areaBadge: string;
  areaLabels: string[];
  briefRows: DevReviewBriefRow[];
  openQuestions: DevReviewOpenQuestionType[];
  factCount: number; // 근거 붙은 확정 항목 수(핵심 요구 + 명세 행)
  areaCards: DevReviewAreaCard[];
  generalOpenCount: number; // 분야에 안 속하는 상의 항목(불일치·정합·공통)
  checks: DevReviewCheckType[]; // 답변↔자료 정합 알림
}

export function buildDevReviewView(review: MarketDevReviewType): DevReviewView {
  const areas = sortAreas(review.brief.serviceAreas);
  return {
    areaBadge: devReviewAreaBadge(areas),
    areaLabels: areas.map((a) => MARKET_SERVICE_AREA_LABELS[a]),
    briefRows: buildDevReviewBriefRows(review.brief.answers),
    openQuestions: review.openQuestions,
    factCount: review.requirements.length + review.areas.reduce((sum, a) => sum + a.spec.length, 0),
    areaCards: buildDevReviewAreaCards(review),
    generalOpenCount: review.openQuestions.filter((q) => q.area === 'general').length,
    checks: review.checks,
  };
}
