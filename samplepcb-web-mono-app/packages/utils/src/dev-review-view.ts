import { DEV_REVIEW_GENERAL_AREA, MARKET_REGISTRY, isMarketAnswerUnknown } from '@sp/api-contract';
import type {
  AreaRegistry,
  DevReviewCheckType,
  DevReviewObservationType,
  DevReviewOpenQuestionType,
  MarketAnswerType,
  MarketDevReviewType,
} from '@sp/api-contract';

// AI 사전 검토서 뷰 모델 — 저장하지 않는 파생값(브리프 행·분야 배지·분야 카드)을 렌더 시 계산한다
// (docs/AI_DEV_REVIEW.md §13). 분야·질문 사전은 레지스트리라 사전이 바뀌면 옛 검토서도 새 사전으로 보인다.
// LLM 없이 코드가 채우는 부분이라 애초에 근거 검증 대상이 아니다.
// 레지스트리는 호출자가 고른다 — 마켓은 생략(MARKET_REGISTRY), 개발의뢰는 DEVELOP_REGISTRY(기구 분야·시스템개발 문항).

// 분야 배지 — 레지스트리 areaBadge 의 별칭(옛 이름 호환).
export const devReviewAreaBadge = (areas: readonly string[], reg: AreaRegistry = MARKET_REGISTRY): string => reg.areaBadge(areas);

export interface DevReviewBriefRow {
  code: string;
  area: string | null; // 분야별 질문이면 분야 코드, 공통 질문이면 null
  label: string;
  value: string;
  unknown: boolean; // "잘 모르겠어요" — 브리프에서 상담 확정 톤으로 표시
}

// 답변한 문항만, 사전 순서로(공통 → 분야). 사전에서 사라진 문항은 코드를 라벨로 그대로 보인다.
export function buildDevReviewBriefRows(answers: readonly MarketAnswerType[], reg: AreaRegistry = MARKET_REGISTRY): DevReviewBriefRow[] {
  const byCode = new Map(answers.map((a) => [a.code, a]));
  const ordered = reg.questions.filter((q) => byCode.has(q.code)).map((q) => q.code);
  const leftovers = answers.map((a) => a.code).filter((c) => !ordered.includes(c));
  return [...ordered, ...leftovers].flatMap((code) => {
    const answer = byCode.get(code);
    if (answer === undefined) return [];
    const question = reg.question(code);
    return [{
      code,
      area: reg.questionArea(code),
      label: question?.short ?? code,
      value: reg.answerText(answer),
      unknown: isMarketAnswerUnknown(answer),
    }];
  });
}

// ── 기술개발 검토 결과 카드 — "이 분야가 얼마나 준비됐고 무엇이 남았나"(§12.10) ──────────
export interface DevReviewAreaCard {
  area: string;
  label: string;
  summary: string;
  factCount: number; // 이 분야 명세 확정 행
  openCount: number; // 이 분야로 분류된 상의 항목
  observations: DevReviewObservationType[];
}

export function buildDevReviewAreaCards(review: MarketDevReviewType, reg: AreaRegistry = MARKET_REGISTRY): DevReviewAreaCard[] {
  const byArea = new Map(review.areas.map((a) => [a.area, a]));
  return reg.sortAreas(review.brief.serviceAreas).map((area) => {
    const src = byArea.get(area);
    return {
      area,
      label: reg.areaLabel(area),
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

export function buildDevReviewView(review: MarketDevReviewType, reg: AreaRegistry = MARKET_REGISTRY): DevReviewView {
  const areas = reg.sortAreas(review.brief.serviceAreas);
  return {
    areaBadge: reg.areaBadge(areas),
    areaLabels: areas.map(reg.areaLabel),
    briefRows: buildDevReviewBriefRows(review.brief.answers, reg),
    openQuestions: review.openQuestions,
    factCount: review.requirements.length + review.areas.reduce((sum, a) => sum + a.spec.length, 0),
    areaCards: buildDevReviewAreaCards(review, reg),
    generalOpenCount: review.openQuestions.filter((q) => q.area === DEV_REVIEW_GENERAL_AREA).length,
    checks: review.checks,
  };
}
