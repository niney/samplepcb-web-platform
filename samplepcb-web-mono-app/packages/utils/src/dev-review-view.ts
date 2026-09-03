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

export interface DevReviewView {
  areaBadge: string;
  areaLabels: string[];
  briefRows: DevReviewBriefRow[];
  openQuestions: DevReviewOpenQuestionType[];
  factCount: number; // 근거 붙은 확정 항목 수(핵심 요구 + 명세 행)
}

export function buildDevReviewView(review: MarketDevReviewType): DevReviewView {
  const areas = sortAreas(review.brief.serviceAreas);
  return {
    areaBadge: devReviewAreaBadge(areas),
    areaLabels: areas.map((a) => MARKET_SERVICE_AREA_LABELS[a]),
    briefRows: buildDevReviewBriefRows(review.brief.answers),
    openQuestions: review.openQuestions,
    factCount: review.requirements.length + review.areas.reduce((sum, a) => sum + a.spec.length, 0),
  };
}
