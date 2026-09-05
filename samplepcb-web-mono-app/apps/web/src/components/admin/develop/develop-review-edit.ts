import {
  DEV_REVIEW_SCHEDULE_MAX_PHASES,
  DEV_REVIEW_SCHEDULE_MAX_WEEKS,
  devReviewTimelineWishCode,
} from '@sp/api-contract';
import type { DevReviewScheduleType, MarketDevReviewType } from '@sp/api-contract';

// 검토서 구조 편집 보조 — 깊은 복사·행 상한·저장 전 검사.
// 상한은 계약(market-dev-review.ts)의 zod `.max()` 와 같아야 한다. 초과하면 PUT 이 400 으로 막힌다.
export const DEVELOP_REVIEW_LIMITS = {
  requirements: 5,
  openQuestions: 6,
  spec: 6,
  observations: 2,
  summaryLen: 200,
  areaSummaryLen: 160,
  factTextLen: 200,
  evidenceLen: 200,
  specItemLen: 30,
  questionLen: 120,
  whyLen: 120,
  resolutionLen: 500,
  adminCommentLen: 4000,
  // 개발 일정(예상) — 계약 DevReviewSchedule 과 같은 한도.
  schedulePhases: DEV_REVIEW_SCHEDULE_MAX_PHASES,
  scheduleWeeksMax: DEV_REVIEW_SCHEDULE_MAX_WEEKS,
  schedulePhaseNameLen: 40,
  schedulePhaseTextLen: 120,
  scheduleAssumptionsLen: 300,
} as const;

// 빈 일정·빈 단계 — 편집기가 "단계 추가"로 처음 만들 때 쓴다. wishCode 는 고객 답변에서만 온다
// (관리자가 고르는 값이 아니다 — 대조는 고객이 고른 완료 시점을 기준으로 해야 뜻이 있다).
export const emptyDevelopSchedulePhase = (): DevReviewScheduleType['phases'][number] => ({
  name: '',
  minWeeks: 1,
  maxWeeks: 1,
  output: '',
  prerequisite: '',
  note: '',
});

export const emptyDevelopSchedule = (review: MarketDevReviewType): DevReviewScheduleType => ({
  phases: [emptyDevelopSchedulePhase()],
  wishCode: devReviewTimelineWishCode(review.brief.answers),
  assumptions: '',
});

// 편집기 로컬 상태는 서버 응답과 객체를 공유하면 안 된다(미리보기가 저장 전 값으로 튄다).
// 구조가 계약으로 고정돼 있으므로 필드별로 새로 만든다 — structuredClone 은 reactive proxy 에서 던진다.
export function cloneDevelopReview(r: MarketDevReviewType): MarketDevReviewType {
  return {
    version: r.version,
    brief: {
      serviceAreas: [...r.brief.serviceAreas],
      answers: r.brief.answers.map((a) => ({
        code: a.code,
        choices: [...a.choices],
        ...(a.note === undefined ? {} : { note: a.note }),
      })),
    },
    summary: r.summary,
    requirements: r.requirements.map((f) => ({ text: f.text, evidence: f.evidence })),
    areas: r.areas.map((a) => ({
      area: a.area,
      summary: a.summary,
      spec: a.spec.map((s) => ({ item: s.item, text: s.text, evidence: s.evidence })),
      observations: a.observations.map((o) => ({ text: o.text, evidence: o.evidence })),
    })),
    openQuestions: r.openQuestions.map((q) => ({
      question: q.question,
      why: q.why,
      area: q.area,
      resolution: q.resolution ?? null,
    })),
    checks: r.checks.map((c) => ({ code: c.code, answer: c.answer, found: [...c.found], text: c.text })),
    meta: { ...r.meta },
    adminComment: r.adminComment ?? null,
    schedule:
      r.schedule === null || r.schedule === undefined
        ? null
        : {
            phases: r.schedule.phases.map((p) => ({ ...p })),
            wishCode: r.schedule.wishCode,
            assumptions: r.schedule.assumptions,
          },
  };
}

// 저장 전 검사 — 계약이 `min(1)` 인 자리가 비어 있으면 PUT 이 400 이라, 무엇이 비었는지 먼저 말한다.
// (빈 행을 조용히 버리면 관리자가 지운 줄 알 수 없다.)
export function developReviewIssues(r: MarketDevReviewType): string[] {
  const issues: string[] = [];
  r.requirements.forEach((f, i) => {
    if (f.text.trim() === '') issues.push(`핵심 요구사항 ${String(i + 1)}행이 비어 있습니다`);
  });
  r.areas.forEach((a) => {
    a.spec.forEach((s, i) => {
      if (s.item.trim() === '' || s.text.trim() === '') {
        issues.push(`${a.area} 명세 ${String(i + 1)}행의 항목명·내용을 채워 주세요`);
      }
    });
    a.observations.forEach((o, i) => {
      if (o.text.trim() === '') issues.push(`${a.area} 관찰 ${String(i + 1)}행이 비어 있습니다`);
    });
  });
  r.openQuestions.forEach((q, i) => {
    if (q.question.trim() === '') issues.push(`상의 항목 ${String(i + 1)}행이 비어 있습니다`);
  });
  // 개발 일정 — 계약이 name min(1)·주 1..104 라 그대로 보내면 400 이다. 무엇이 잘못됐는지 먼저 말한다.
  (r.schedule?.phases ?? []).forEach((p, i) => {
    const row = `개발 일정 ${String(i + 1)}단계`;
    if (p.name.trim() === '') issues.push(`${row}의 단계명이 비어 있습니다`);
    const bad = (n: number): boolean =>
      !Number.isInteger(n) || n < 1 || n > DEVELOP_REVIEW_LIMITS.scheduleWeeksMax;
    if (bad(p.minWeeks) || bad(p.maxWeeks)) {
      issues.push(`${row}의 기간은 1~${String(DEVELOP_REVIEW_LIMITS.scheduleWeeksMax)}주 사이의 정수여야 합니다`);
    } else if (p.minWeeks > p.maxWeeks) {
      issues.push(`${row}의 최소 주가 최대 주보다 큽니다`);
    }
  });
  return issues;
}
