import { z } from 'zod';
import { MarketContractPayment, MarketFileMeta } from './market';
import { EMPTY_MARKET_TOOLS, MarketAnswers, MarketAreaCodeLoose, MarketTools } from './market-areas';
import {
  DEVELOP_INDIVIDUAL_AREA_CODES,
  DEVELOP_SYSTEM_AREA_CODES,
  applyDevelopAppServerScope,
  applyDevelopCircuitPcb,
  developAnswerIssues,
  developNeedsStages,
  developToolIssues,
  sortDevelopAreas,
} from './develop-areas';
import { DEV_REVIEW_TIMELINE_WISH_CODES, DevReviewSchedule, MarketDevReview } from './market-dev-review';
import { DevelopAiQuestions, DevelopFollowupAnswersInput, DevelopFollowupAnswersPatch } from './develop-followup';
import type { DevReviewTimelineWishCodeType } from './market-dev-review';
import { MARKET_DEV_DIAGRAM_STATUSES, MarketDevDiagram } from './market-dev-diagram';
import { AdminDevelopDocumentView, DevelopDocumentView, DevelopProgressView, DevelopTaskPhase } from './develop-docs';

// ── 개발의뢰(sp-develop) 계약 — 정본 docs/DEVELOP_FLOW.md ───────────────────────────
// 의뢰자 ↔ 샘플피씨비 직접 개발 용역. 마켓(market.ts)과 **테이블·상태 어휘가 다르다**(전문가·입찰·공개 목록 없음,
// 관리자가 AI 를 돌리고 항목별 견적을 낸다). 분야·질문·툴·첨부 슬롯은 개발의뢰 전용 레지스트리(develop-areas.ts),
// 검토서·구성도 JSON 은 마켓 스키마를 그대로 쓴다.
// 라벨 정본은 이 파일(DEVELOP_*_LABELS) — sp-develop·sp-vue·sp-node 메일 빌더가 공유한다.

// ── 위저드 v2 사전(2026-09-08, 프로토타입 samplepcb-development-request 기준) ─────────────
// 의뢰 방식 — 시스템개발(6분야 통합) / 개별 견적(회로·PCB·펌웨어·역설계·앱·서버 복수, 2026-10-30 메뉴 6장).
export const DEVELOP_REQUEST_MODES = ['system', 'individual'] as const;
export type DevelopRequestModeType = (typeof DEVELOP_REQUEST_MODES)[number];
export const DevelopRequestMode = z.enum(DEVELOP_REQUEST_MODES);
export const DEVELOP_REQUEST_MODE_LABELS = {
  system: '시스템 개발',
  individual: '개별 견적',
} as const satisfies Record<DevelopRequestModeType, string>;

// 예산 구간 — 마켓 사전(500만 단위)과 분리(개발 용역 실무 구간). 저장은 코드.
// PCB 설계만 고른 의뢰는 낮은 구간을 보인다(설계 단독은 대개 1천만원 미만이라 기본 구간으론 정보가 안 된다 — 2026-11-02).
export const DEVELOP_BUDGET_RANGES = [
  'under1000', 'r1000_3000', 'r3000_5000', 'r5000_10000', 'over10000',
  'under100', 'r100_300', 'r300_500', 'r500_1000', 'over1000',
  'after_quote',
] as const;
export type DevelopBudgetRangeType = (typeof DEVELOP_BUDGET_RANGES)[number];
export const DevelopBudgetRange = z.enum(DEVELOP_BUDGET_RANGES);
export const DEVELOP_BUDGET_RANGE_LABELS = {
  under1000: '1천만원 미만',
  r1000_3000: '1천만~3천만원',
  r3000_5000: '3천만~5천만원',
  r5000_10000: '5천만~1억원',
  over10000: '1억원 이상',
  under100: '100만원 미만',
  r100_300: '100만~300만원',
  r300_500: '300만~500만원',
  r500_1000: '500만~1천만원',
  over1000: '1천만원 이상',
  after_quote: '견적 후 결정',
} as const satisfies Record<DevelopBudgetRangeType, string>;
// 위저드 선택지 — 기본 / PCB 설계만(developPcbMaterialsMode). 서버는 어느 쪽 코드든 받는다(표시는 라벨 사전 하나).
const DEVELOP_BUDGET_OPTIONS: readonly DevelopBudgetRangeType[] = ['under1000', 'r1000_3000', 'r3000_5000', 'r5000_10000', 'over10000', 'after_quote'];
const DEVELOP_PCB_BUDGET_OPTIONS: readonly DevelopBudgetRangeType[] = ['under100', 'r100_300', 'r300_500', 'r500_1000', 'over1000', 'after_quote'];
export const developBudgetOptions = (pcbOnly: boolean): readonly DevelopBudgetRangeType[] =>
  pcbOnly ? DEVELOP_PCB_BUDGET_OPTIONS : DEVELOP_BUDGET_OPTIONS;

export const DEVELOP_CURRENT_STAGES = ['idea', 'requirements', 'design', 'prototype', 'testing', 'mass_prep'] as const;
export type DevelopCurrentStageType = (typeof DEVELOP_CURRENT_STAGES)[number];
export const DevelopCurrentStage = z.enum(DEVELOP_CURRENT_STAGES);
export const DEVELOP_CURRENT_STAGE_LABELS = {
  idea: '아이디어',
  requirements: '요구사항 정리',
  design: '설계 진행',
  prototype: '시제품 제작',
  testing: '시험·검증',
  mass_prep: '양산 준비',
} as const satisfies Record<DevelopCurrentStageType, string>;

export const DEVELOP_TARGET_STAGES = ['spec_fixed', 'function_verified', 'prototype_done', 'mass_ready', 'first_production'] as const;
export type DevelopTargetStageType = (typeof DEVELOP_TARGET_STAGES)[number];
export const DevelopTargetStage = z.enum(DEVELOP_TARGET_STAGES);
export const DEVELOP_TARGET_STAGE_LABELS = {
  spec_fixed: '사양 확정',
  function_verified: '기능 검증',
  prototype_done: '시제품 완성',
  mass_ready: '양산 준비 완료',
  first_production: '초도 생산',
} as const satisfies Record<DevelopTargetStageType, string>;

// 희망 완료 시기 — 날짜(YYYY-MM-DD) **또는** 자유문("계약 후 3개월") 중 하나 이상. (제작 계획의 희망 제조 일정도 같은 날짜 형식)
export const DEVELOP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DevelopWishDate = z.string().regex(DEVELOP_DATE_RE, 'YYYY-MM-DD');

// 시제품·생산 계획(4스텝) — 당사 PCB/BOM 트랙과 직결되는 정보라 견적서 '별도 실비' 의 근거가 된다.
export const DEVELOP_PROTOTYPE_MODES = ['none', 'undecided', 'count'] as const;
export type DevelopPrototypeModeType = (typeof DEVELOP_PROTOTYPE_MODES)[number];
export const DevelopPrototypeMode = z.enum(DEVELOP_PROTOTYPE_MODES);
export const DEVELOP_PROTOTYPE_MODE_LABELS = {
  none: '제작 없음',
  undecided: '수량 미정',
  count: '직접 입력',
} as const satisfies Record<DevelopPrototypeModeType, string>;

export const DEVELOP_PRODUCTION_SCOPES = ['pcb_fab', 'parts', 'smt', 'assembly', 'negotiate'] as const;
export type DevelopProductionScopeType = (typeof DEVELOP_PRODUCTION_SCOPES)[number];
export const DevelopProductionScope = z.enum(DEVELOP_PRODUCTION_SCOPES);
export const DEVELOP_PRODUCTION_SCOPE_LABELS = {
  pcb_fab: 'PCB 제작',
  parts: '부품 구매',
  smt: 'SMT·수삽',
  assembly: '완제품 조립',
  negotiate: '범위 협의',
} as const satisfies Record<DevelopProductionScopeType, string>;

export const DEVELOP_PRIORITIES = ['cost', 'schedule', 'size_weight', 'performance', 'durability', 'certification', 'manufacturability'] as const;
export type DevelopPriorityType = (typeof DEVELOP_PRIORITIES)[number];
export const DevelopPriority = z.enum(DEVELOP_PRIORITIES);
export const DEVELOP_PRIORITY_LABELS = {
  cost: '비용',
  schedule: '일정',
  size_weight: '크기·무게',
  performance: '성능',
  durability: '내구성·사용환경',
  certification: '인증',
  manufacturability: '양산성·부품수급',
} as const satisfies Record<DevelopPriorityType, string>;

export const DEVELOP_SOURCING_MODES = ['samplepcb_all', 'partial_customer', 'customer_all', 'negotiate'] as const;
export type DevelopSourcingModeType = (typeof DEVELOP_SOURCING_MODES)[number];
export const DevelopSourcingMode = z.enum(DEVELOP_SOURCING_MODES);
export const DEVELOP_SOURCING_MODE_LABELS = {
  samplepcb_all: '샘플피씨비 일괄 조달',
  partial_customer: '일부 고객 지급',
  customer_all: '전량 고객 지급',
  negotiate: '협의 필요',
} as const satisfies Record<DevelopSourcingModeType, string>;

export const DEVELOP_DELIVERY_FORMS = ['pcb', 'parts_separate', 'pcba', 'finished', 'negotiate'] as const;
export type DevelopDeliveryFormType = (typeof DEVELOP_DELIVERY_FORMS)[number];
export const DevelopDeliveryForm = z.enum(DEVELOP_DELIVERY_FORMS);
export const DEVELOP_DELIVERY_FORM_LABELS = {
  pcb: 'PCB',
  parts_separate: '부품 별도',
  pcba: 'PCBA',
  finished: '완제품',
  negotiate: '협의 필요',
} as const satisfies Record<DevelopDeliveryFormType, string>;

// ── PCB 설계만 의뢰의 4스텝 = 'PCB 제작 · 부품 구매 · SMT 조립'(2026-11-03, 의뢰서 시안 'PCB 설계 의뢰서' 04, 사용자 결정) ──
// 저장은 같은 제작 계획(JSON)이다 — 서비스 = 제작 범위 코드(PCB 제작·부품 구매·SMT 조립, '아직 결정하지 않음' = 범위 협의),
// '필요 없음(설계만)' = 시제품 제작 없음. 수량은 PCB·SMT 를 따로 받고(시제품 수량은 비운다) 제조 목적이 양산이면 연간
// 생산수량, 납품 형태는 묻지 않는다(고른 서비스로 정해진다). 사전 견적 = 설계와 제작 견적을 함께 미리 받고 싶다는 요청.
export const DEVELOP_PCB_FAB_SERVICES = ['pcb_fab', 'parts', 'smt'] as const satisfies readonly DevelopProductionScopeType[];
export const DEVELOP_PCB_FAB_SERVICE_LABELS = {
  pcb_fab: 'PCB 제작',
  parts: '부품 구매',
  smt: 'SMT 조립',
} as const satisfies Record<(typeof DEVELOP_PCB_FAB_SERVICES)[number], string>;
export const DEVELOP_FAB_PURPOSES = ['prototype', 'mass', 'undecided'] as const;
export type DevelopFabPurposeType = (typeof DEVELOP_FAB_PURPOSES)[number];
export const DevelopFabPurpose = z.enum(DEVELOP_FAB_PURPOSES);
export const DEVELOP_FAB_PURPOSE_LABELS = {
  prototype: '시제품',
  mass: '양산',
  undecided: '미정',
} as const satisfies Record<DevelopFabPurposeType, string>;
// SMT 조립을 고르면 묻는 추가 작업 — 없음은 혼자만 고른다.
export const DEVELOP_FAB_EXTRA_WORKS = ['tht', 'inspection', 'programming', 'cleaning', 'packing', 'other', 'none'] as const;
export type DevelopFabExtraWorkType = (typeof DEVELOP_FAB_EXTRA_WORKS)[number];
export const DevelopFabExtraWork = z.enum(DEVELOP_FAB_EXTRA_WORKS);
export const DEVELOP_FAB_EXTRA_WORK_LABELS = {
  tht: '수삽',
  inspection: '검사',
  programming: '프로그래밍',
  cleaning: '세척',
  packing: '포장',
  other: '기타',
  none: '없음',
} as const satisfies Record<DevelopFabExtraWorkType, string>;

// 제작 범위를 하나라도 고르면 조달·납품 형태를 묻는다(프로토타입 "제조 연계 확인"). 아니면 둘 다 null.
// pcbQty ~ preQuote 는 PCB 설계만 의뢰의 4스텝 칸이다(그 밖의 의뢰는 비어 있다 — normalizeDevelopProduction).
export const DevelopProductionPlan = z
  .object({
    prototype: DevelopPrototypeMode,
    prototypeQty: z.number().int().min(1).max(1_000_000).nullable().default(null),
    scopes: z.array(DevelopProductionScope).max(DEVELOP_PRODUCTION_SCOPES.length).default([]),
    annualQty: z.number().int().min(0).max(100_000_000).nullable().default(null),
    priority: DevelopPriority.nullable().default(null),
    sourcing: DevelopSourcingMode.nullable().default(null),
    delivery: DevelopDeliveryForm.nullable().default(null),
    pcbQty: z.number().int().min(1).max(1_000_000).nullable().default(null),
    smtQty: z.number().int().min(1).max(1_000_000).nullable().default(null),
    purpose: DevelopFabPurpose.nullable().default(null),
    fabWishDate: DevelopWishDate.nullable().default(null),
    extraWork: z.array(DevelopFabExtraWork).max(DEVELOP_FAB_EXTRA_WORKS.length).default([]),
    extraWorkNote: z.string().trim().max(200).nullable().default(null),
    preQuote: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    if (p.prototype === 'count' && p.prototypeQty === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PROTOTYPE_QTY_REQUIRED', path: ['prototypeQty'] });
    }
    if (new Set(p.scopes).size !== p.scopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_SCOPE', path: ['scopes'] });
    }
    if (new Set(p.extraWork).size !== p.extraWork.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_EXTRA_WORK', path: ['extraWork'] });
    }
  });
export type DevelopProductionPlanType = z.infer<typeof DevelopProductionPlan>;
// PCB 설계만 의뢰의 칸 — 그 밖의 의뢰는 늘 이 값이다(배열을 나눠 쓰지 않게 새로 만든다).
type DevelopPcbFabFields = Pick<DevelopProductionPlanType, 'pcbQty' | 'smtQty' | 'purpose' | 'fabWishDate' | 'extraWork' | 'extraWorkNote' | 'preQuote'>;
const noPcbFab = (): DevelopPcbFabFields => ({
  pcbQty: null,
  smtQty: null,
  purpose: null,
  fabWishDate: null,
  extraWork: [],
  extraWorkNote: null,
  preQuote: false,
});
export const EMPTY_DEVELOP_PRODUCTION: DevelopProductionPlanType = {
  prototype: 'undecided',
  prototypeQty: null,
  scopes: [],
  annualQty: null,
  priority: null,
  sourcing: null,
  delivery: null,
  ...noPcbFab(),
};
// 제작 계획을 묻지 않는 의뢰(펌웨어·앱·서버만 — developNeedsProduction)의 저장값 = 시제품 제작 없음.
export const DEVELOP_NO_PRODUCTION: DevelopProductionPlanType = { ...EMPTY_DEVELOP_PRODUCTION, prototype: 'none' };
// 저장 정규화 — count 가 아니면 수량을 비우고, 제작 범위가 없으면 조달·납품 형태를 비운다.
// pcbFab(PCB 설계만 의뢰, developPcbMaterialsMode) 이면 4스텝이 서비스 칩 모양이다 — 필요 없음(설계만)이면 다 비우고,
// '아직 결정하지 않음'(범위 협의)은 혼자만, 수량·제조 목적·일정은 PCB 제작·SMT 조립을, 조달은 부품 구매·SMT 조립을,
// 추가 작업은 SMT 조립을 골랐을 때만 남긴다. 연간 생산수량은 양산일 때만, 시제품 수량·납품 형태는 묻지 않는다.
export function normalizeDevelopProduction(p: DevelopProductionPlanType, pcbFab = false): DevelopProductionPlanType {
  const scopes = [...new Set(p.scopes)];
  if (!pcbFab) {
    return {
      prototype: p.prototype,
      prototypeQty: p.prototype === 'count' ? p.prototypeQty : null,
      scopes,
      annualQty: p.annualQty,
      priority: p.priority,
      sourcing: scopes.length === 0 ? null : p.sourcing,
      delivery: scopes.length === 0 ? null : p.delivery,
      ...noPcbFab(),
    };
  }
  if (p.prototype === 'none') return { ...DEVELOP_NO_PRODUCTION, scopes: [], ...noPcbFab(), priority: p.priority };
  const services: DevelopProductionScopeType[] = scopes.includes('negotiate')
    ? ['negotiate']
    : scopes.filter((s) => (DEVELOP_PCB_FAB_SERVICES as readonly string[]).includes(s));
  const has = (s: DevelopProductionScopeType): boolean => services.includes(s);
  const making = has('pcb_fab') || has('smt');
  const purpose = making ? p.purpose : null;
  const extraWork: DevelopFabExtraWorkType[] = !has('smt') ? [] : p.extraWork.includes('none') ? ['none'] : [...new Set(p.extraWork)];
  const note = p.extraWorkNote?.trim() ?? '';
  return {
    prototype: 'undecided',
    prototypeQty: null,
    scopes: services,
    annualQty: purpose === 'mass' ? p.annualQty : null,
    priority: p.priority,
    sourcing: has('parts') || has('smt') ? p.sourcing : null,
    delivery: null,
    pcbQty: has('pcb_fab') ? p.pcbQty : null,
    smtQty: has('smt') ? p.smtQty : null,
    purpose,
    fabWishDate: making ? p.fabWishDate : null,
    extraWork,
    extraWorkNote: extraWork.includes('other') && note !== '' ? note : null,
    preQuote: p.preQuote,
  };
}
// PCB 설계만 의뢰의 한 줄 — "PCB 제작 10개 · 부품 구매 · SMT 조립 5보드(수삽·검사) · 양산(연간 5,000개) · 제조 희망 2026-12-01 · 사전 견적 요청".
function pcbFabSummary(p: DevelopProductionPlanType): string {
  if (p.prototype === 'none') return '제작·조립 없음(설계만)';
  const qty = (n: number | null, unit: string): string => (n === null ? '' : ` ${n.toLocaleString('ko-KR')}${unit}`);
  const works = p.extraWork
    .filter((w) => w !== 'none')
    .map((w) => (w === 'other' && p.extraWorkNote !== null ? `기타: ${p.extraWorkNote}` : DEVELOP_FAB_EXTRA_WORK_LABELS[w]));
  const services = p.scopes.includes('negotiate')
    ? ['제작·조립 미정']
    : DEVELOP_PCB_FAB_SERVICES.filter((s) => p.scopes.includes(s)).map((s) => {
      if (s === 'pcb_fab') return `${DEVELOP_PCB_FAB_SERVICE_LABELS[s]}${qty(p.pcbQty, '개')}`;
      if (s === 'smt') return `${DEVELOP_PCB_FAB_SERVICE_LABELS[s]}${qty(p.smtQty, '보드')}${works.length > 0 ? `(${works.join('·')})` : ''}`;
      return DEVELOP_PCB_FAB_SERVICE_LABELS[s];
    });
  const purpose =
    p.purpose === null
      ? null
      : p.purpose === 'mass' && p.annualQty !== null
        ? `양산(연간 ${p.annualQty.toLocaleString('ko-KR')}개)`
        : p.purpose === 'undecided'
          ? '제조 목적 미정'
          : DEVELOP_FAB_PURPOSE_LABELS[p.purpose];
  const date = p.fabWishDate === null ? null : `제조 희망 ${p.fabWishDate}`;
  const preQuote = p.preQuote ? '사전 견적 요청' : null;
  return [...(services.length === 0 ? ['제작·조립 범위 없음'] : services), purpose, date, preQuote]
    .filter((s): s is string => s !== null)
    .join(' · ');
}
// 표시용 한 줄 — "시제품 5개 · PCB 제작, SMT·수삽 · 연간 5,000" (검토 카드·관리자·메일이 같은 문자열).
// pcbFab(PCB 설계만 의뢰)이면 4스텝 모양대로 서비스·수량·제조 목적을 읽는다.
export function developProductionSummary(p: DevelopProductionPlanType | null, pcbFab = false): string {
  if (p === null) return '';
  if (pcbFab) return pcbFabSummary(p);
  const proto =
    p.prototype === 'count'
      ? `시제품 ${p.prototypeQty === null ? '?' : p.prototypeQty.toLocaleString('ko-KR')}개`
      : `시제품 ${DEVELOP_PROTOTYPE_MODE_LABELS[p.prototype]}`;
  const scopes = p.scopes.length === 0 ? '제작 범위 없음' : p.scopes.map((s) => DEVELOP_PRODUCTION_SCOPE_LABELS[s]).join(', ');
  const annual = p.annualQty === null ? null : `연간 ${p.annualQty.toLocaleString('ko-KR')}개`;
  return [proto, scopes, annual].filter((s): s is string => s !== null).join(' · ');
}

// 검토서 일정 대조(devReviewScheduleFit)가 쓰는 희망 시점 코드를 날짜에서 파생한다 — 접수일 기준 주 수:
// ≤4 within_1m · ≤13 m2_3 · ≤26 m4_6 · 그 밖 over_6m. 날짜가 없거나(자유문만) 지났으면 null(= unknown).
export function developWishCode(wishDate: string | null, from: Date | string): DevReviewTimelineWishCodeType | null {
  if (wishDate === null || !DEVELOP_DATE_RE.test(wishDate)) return null;
  const target = Date.parse(`${wishDate}T00:00:00+09:00`);
  const start = typeof from === 'string' ? Date.parse(from) : from.getTime();
  if (!Number.isFinite(target) || !Number.isFinite(start)) return null;
  const weeks = Math.ceil((target - start) / (7 * 24 * 60 * 60 * 1000));
  if (weeks < 0) return null;
  const code: DevReviewTimelineWishCodeType = weeks <= 4 ? 'within_1m' : weeks <= 13 ? 'm2_3' : weeks <= 26 ? 'm4_6' : 'over_6m';
  return DEV_REVIEW_TIMELINE_WISH_CODES.includes(code) ? code : null;
}
export const developWishLabel = (wishDate: string | null, wishNote: string | null): string =>
  wishDate !== null && wishNote !== null && wishNote !== '' ? `${wishDate} · ${wishNote}` : (wishDate ?? wishNote ?? '');

// 의뢰 방식에 따른 저장 분야 — 시스템개발은 6분야, 개별은 고른 것(개별 메뉴 밖 코드는 버린다). '앱 및 서버'는
// 3스텝 범위 답(appserver.scope)대로 앱·서버를 줄이고, 회로 설계만 고른 의뢰는 'PCB 설계도 필요함'(circuit.pcb)이면
// PCB 설계를 더한다(2026-11-03) — 위저드와 서버가 같은 답으로 같은 분야를 얻는다.
export function resolveDevelopServiceAreas(
  mode: DevelopRequestModeType,
  areas: readonly string[],
  answers: readonly { code: string; choices: readonly string[] }[] = [],
): string[] {
  if (mode === 'system') return [...DEVELOP_SYSTEM_AREA_CODES];
  const picked = sortDevelopAreas(areas).filter((c) => DEVELOP_INDIVIDUAL_AREA_CODES.includes(c));
  return applyDevelopCircuitPcb(applyDevelopAppServerScope(picked, answers), answers);
}

// ── 의뢰 상태 ─────────────────────────────────────────────────────────────────
export const DEVELOP_REQUEST_STATUSES = [
  'received',
  'reviewing',
  'quoted',
  'accepted',
  'in_progress',
  'delivered',
  'completed',
  'cancelled',
  'declined',
] as const;
export type DevelopRequestStatusType = (typeof DEVELOP_REQUEST_STATUSES)[number];
export const DevelopRequestStatus = z.enum(DEVELOP_REQUEST_STATUSES);

// 고객 어휘 — 다음에 "누가 무엇을" 해야 하는지가 읽히게.
export const DEVELOP_REQUEST_STATUS_LABELS = {
  received: '접수됨',
  reviewing: '검토 중',
  quoted: '견적 도착',
  accepted: '착수금 대기',
  in_progress: '개발 진행 중',
  delivered: '납품 · 검수 중',
  completed: '완료',
  cancelled: '취소',
  declined: '진행 불가',
} as const satisfies Record<DevelopRequestStatusType, string>;

// 진행 스텝퍼(고객 상세) — 종결 상태(cancelled·declined)는 스텝이 아니라 배지.
export const DEVELOP_PROGRESS_STEPS = [
  'received',
  'reviewing',
  'quoted',
  'accepted',
  'in_progress',
  'delivered',
  'completed',
] as const satisfies readonly DevelopRequestStatusType[];

export const isDevelopClosed = (s: DevelopRequestStatusType): boolean => s === 'cancelled' || s === 'declined';
// 끝난 의뢰(완료 + 종결) — 고객 '진행 사항'(내 의뢰 scope=active)이 빼는 상태.
export const DEVELOP_ENDED_STATUSES = ['completed', 'cancelled', 'declined'] as const satisfies readonly DevelopRequestStatusType[];
export const DEVELOP_MY_LIST_SCOPES = ['all', 'active'] as const;
export type DevelopMyListScopeType = (typeof DEVELOP_MY_LIST_SCOPES)[number];
// 고객 의뢰 수정 창 — 견적이 나가기 전까지만(그 뒤 원천이 바뀌면 견적의 전제가 달라진다).
export const isDevelopEditable = (s: DevelopRequestStatusType): boolean => s === 'received' || s === 'reviewing';
// 고객 취소 창 — 착수(첫 결제) 전까지. 그 뒤는 관리자 운영 취소만.
export const isDevelopCustomerCancellable = (s: DevelopRequestStatusType): boolean =>
  s === 'received' || s === 'reviewing' || s === 'quoted' || s === 'accepted';

// ── 견적서 ───────────────────────────────────────────────────────────────────
export const DEVELOP_QUOTE_KINDS = ['initial', 'revision', 'change'] as const;
export type DevelopQuoteKindType = (typeof DEVELOP_QUOTE_KINDS)[number];
export const DevelopQuoteKind = z.enum(DEVELOP_QUOTE_KINDS);
export const DEVELOP_QUOTE_KIND_LABELS = {
  initial: '견적',
  revision: '수정 견적',
  change: '추가 견적',
} as const satisfies Record<DevelopQuoteKindType, string>;

export const DEVELOP_QUOTE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
  'superseded',
  'withdrawn',
] as const;
export type DevelopQuoteStatusType = (typeof DEVELOP_QUOTE_STATUSES)[number];
export const DevelopQuoteStatus = z.enum(DEVELOP_QUOTE_STATUSES);
export const DEVELOP_QUOTE_STATUS_LABELS = {
  draft: '작성 중',
  sent: '발송',
  accepted: '수락',
  declined: '거절',
  expired: '기한 만료',
  superseded: '새 견적으로 대체',
  withdrawn: '철회',
} as const satisfies Record<DevelopQuoteStatusType, string>;

// VAT 표기 — separate(공급가 + VAT 10%) 가 국내 B2B 기본. included 는 합계에서 역산, exempt 는 VAT 0.
export const DEVELOP_VAT_MODES = ['separate', 'included', 'exempt'] as const;
export type DevelopVatModeType = (typeof DEVELOP_VAT_MODES)[number];
export const DevelopVatMode = z.enum(DEVELOP_VAT_MODES);
export const DEVELOP_VAT_MODE_LABELS = {
  separate: 'VAT 별도',
  included: 'VAT 포함',
  exempt: '면세',
} as const satisfies Record<DevelopVatModeType, string>;
export const DEVELOP_VAT_RATE_BP = 1000; // 10%
// 견적 편집기가 고르게 하는 VAT 방식 — '포함'은 표 금액이 VAT 포함이 되어 산출 내역 서식(공급가 → 부가세 → 합계)과
// 맞지 않고 공급가 역산이 끝자리를 다시 만든다(2026-11-04). 값은 남겨 두어 옛 견적·설정은 그대로 읽힌다.
export const DEVELOP_QUOTE_EDITABLE_VAT_MODES = ['separate', 'exempt'] as const satisfies readonly DevelopVatModeType[];

// ── 견적 산출 내역(2026-11-04, 참고 견적서 '개발견적서' 서식) ─────────────────────────
// 항목 = 구분(인건비·직접비) × 단가 × 수량. 인건비는 **일일 노임비(원/일) × 참여 일수(일)**, 직접비는 단가 × 수량(식·회·EA)
// — 같은 날 저녁 개월 단가를 일 단위로 바꿨다(참고 자동견적 HTML). 그 뒤 간접비 → 제경비(일반관리비)
// → 기업이윤이 **앞 합계 × 비율**로 계단식으로 붙는다. 가산 세 행은 각각 천 원 미만을 버린다 — 단가가 천 원 단위면
// 공급가도 천 원 단위로 끝나고, 표의 행을 더한 값이 그대로 공급가다(따로 '단수 정리' 행이 없다).
export const DEVELOP_QUOTE_ITEM_CATEGORIES = ['labor', 'direct'] as const;
export type DevelopQuoteItemCategoryType = (typeof DEVELOP_QUOTE_ITEM_CATEGORIES)[number];
export const DevelopQuoteItemCategory = z.enum(DEVELOP_QUOTE_ITEM_CATEGORIES);
export const DEVELOP_QUOTE_ITEM_CATEGORY_LABELS = {
  labor: '인건비',
  direct: '직접비',
} as const satisfies Record<DevelopQuoteItemCategoryType, string>;
// 인건비 단위는 '일' 고정 — 편집기에 단위 칸이 없고 새 줄이 이 값을 쓴다. 저장된 옛 '개월' 줄은 그 단위 그대로 읽는다
// (서버가 고쳐 쓰지 않는다 — 금액은 같아도 '원/일'이라는 뜻이 바뀌므로).
export const DEVELOP_QUOTE_LABOR_UNIT = '일';
// 직접비 단위 — 자유 글(20자)이고 편집기 입력칸이 이 목록을 제안한다.
export const DEVELOP_QUOTE_DIRECT_UNIT_SUGGESTIONS = ['식', '회', 'EA', '세트'] as const;
export const DEVELOP_QUOTE_DEFAULT_UNIT = { labor: DEVELOP_QUOTE_LABOR_UNIT, direct: '식' } as const satisfies Record<DevelopQuoteItemCategoryType, string>;
// 기술등급 — 자유 글(50자)이고 인건비 기본값·편집기 입력칸이 이 목록을 제안한다.
export const DEVELOP_QUOTE_GRADE_SUGGESTIONS = ['특급', '고급', '중급', '일반'] as const;
// 월 단가 → 일일 노임비 환산 안내(1개월 ≈ 20일, 참고 자동견적 HTML 의 예시 환산). 안내 문구에만 쓰고 계산엔 안 쓴다.
export const DEVELOP_QUOTE_WORKDAYS_PER_MONTH = 20;
export const DEVELOP_QUOTE_QTY_MAX = 9999.99; // 소수 둘째 자리까지(0.5일)
export const DEVELOP_QUOTE_RATE_MAX_BP = 5000; // 가산율 한 칸 상한 50%
export const DEVELOP_QUOTE_AMOUNT_MAX = 2_000_000_000; // 항목·합계 상한(정수 컬럼)
export const DEVELOP_QUOTE_SURCHARGES = ['indirect', 'overhead', 'profit'] as const;
export type DevelopQuoteSurchargeType = (typeof DEVELOP_QUOTE_SURCHARGES)[number];
export const DEVELOP_QUOTE_SURCHARGE_LABELS = {
  indirect: '간접비',
  overhead: '제경비',
  profit: '기업이윤',
} as const satisfies Record<DevelopQuoteSurchargeType, string>;
// 가산 행의 근거 문구 — 비율 뒤에 붙는다('15% (인건비+직접비)').
export const DEVELOP_QUOTE_SURCHARGE_BASIS = {
  indirect: '(인건비+직접비)',
  overhead: '일반관리비 (인건비+직접비+간접비)',
  profit: '(인건비+직접비+간접비+제경비)',
} as const satisfies Record<DevelopQuoteSurchargeType, string>;

// 견적서 발신처 — 2026-11-04 사용자 결정 '일단 고정'(참고 견적서 원본 값). 회사 정보 API·설정 화면으로 옮길 때 여기 한 곳만 바꾼다.
// 고객 인쇄·관리자 미리보기·엑셀이 같은 값을 쓴다. 의뢰 출력물 표지의 '개인 연락처를 내보내지 않는다' 규칙과 달리 견적서는 담당자 연락처를 싣는다.
export const DEVELOP_QUOTE_SUPPLIER = {
  name: '㈜ 샘플피시비',
  owner: '오혜영',
  managerName: '박승한 상무',
  managerPhone: '010-5254-4490',
  managerEmail: 'james@samplepcb.co.kr',
  address: '경기도 광명시 하안로 60 광명테크노파크 A동 1303, 1407호',
  tel: '070-8667-1080',
  fax: '02-6455-4490',
  email: 'info@samplepcb.co.kr',
} as const;
// Remark 마지막 줄(고정 문구) — 단계 승인(프로젝트 문서 stage_review)과 같은 약속.
export const DEVELOP_QUOTE_APPROVAL_REMARK = '단계별 설계 및 개발 과정은 모두 발주처 승인 후 진행합니다.';

// ── 마일스톤(결제 단위) ────────────────────────────────────────────────────────
export const DEVELOP_MILESTONE_TRIGGERS = ['on_accept', 'on_delivery', 'on_completion', 'manual'] as const;
export type DevelopMilestoneTriggerType = (typeof DEVELOP_MILESTONE_TRIGGERS)[number];
export const DevelopMilestoneTrigger = z.enum(DEVELOP_MILESTONE_TRIGGERS);
export const DEVELOP_MILESTONE_TRIGGER_LABELS = {
  on_accept: '견적 수락 시',
  on_delivery: '납품 시',
  on_completion: '검수 확정 시',
  manual: '담당자가 청구할 때',
} as const satisfies Record<DevelopMilestoneTriggerType, string>;

export const DEVELOP_MILESTONE_STATUSES = ['draft', 'pending', 'paid', 'cancelled'] as const;
export type DevelopMilestoneStatusType = (typeof DEVELOP_MILESTONE_STATUSES)[number];
export const DevelopMilestoneStatus = z.enum(DEVELOP_MILESTONE_STATUSES);
export const DEVELOP_MILESTONE_STATUS_LABELS = {
  draft: '작성 중',
  pending: '결제 대기',
  paid: '결제 완료',
  cancelled: '취소',
} as const satisfies Record<DevelopMilestoneStatusType, string>;

// ── 타임라인 이벤트 ───────────────────────────────────────────────────────────
export const DEVELOP_EVENT_TYPES = [
  'status_changed',
  'edited',
  'note',
  'comment',
  'review_request',
  'review_approved',
  'review_changes',
  'deliverable',
  'quote_sent',
  'quote_accepted',
  'quote_declined',
  'payment_confirmed',
  'ai_drafted',
  'published',
  'tax_invoice',
  'as_request',
  'document_sent', // 프로젝트 문서 발송(§13) — payload {documentId,type,seq,version,docNo,replyDueOn}
  'document_decided', // 고객 문서 결정 — payload {documentId,docNo,decision}
  'milestone_opened', // 수동 청구 열기(2026-09-10, G milestone.open 이식) — payload {milestoneId,quoteId,title,amount}. 열림 판정은 이 이벤트가 진실
  'schedule_changed', // 프로젝트 일정 변경(2026-09-11, 옛 plan 문서 대신) — payload {from:{baseStartOn,plannedEndOn,expectedEndOn}, to:{…}}
] as const;
export type DevelopEventTypeType = (typeof DEVELOP_EVENT_TYPES)[number];
export const DevelopEventType = z.enum(DEVELOP_EVENT_TYPES);
export const DEVELOP_EVENT_TYPE_LABELS = {
  status_changed: '상태 변경',
  edited: '의뢰 수정',
  note: '진행 메모',
  comment: '문의',
  review_request: '확인 요청',
  review_approved: '확인 승인',
  review_changes: '수정 요청',
  deliverable: '산출물',
  quote_sent: '견적 발송',
  quote_accepted: '견적 수락',
  quote_declined: '견적 거절',
  payment_confirmed: '결제 확인',
  ai_drafted: 'AI 초안',
  published: '공개',
  tax_invoice: '세금계산서',
  as_request: 'A/S 요청',
  document_sent: '문서 발송',
  document_decided: '문서 회신',
  milestone_opened: '청구 열기',
  schedule_changed: '일정 변경',
} as const satisfies Record<DevelopEventTypeType, string>;

// 관리자가 직접 만드는 이벤트(나머지는 서버가 전이·행동의 부수효과로 쓴다).
export const DEVELOP_ADMIN_EVENT_TYPES = ['note', 'comment', 'review_request', 'deliverable', 'tax_invoice'] as const;
export const DevelopAdminEventType = z.enum(DEVELOP_ADMIN_EVENT_TYPES);

export const DEVELOP_DIAGRAM_SOURCES = ['ai', 'upload'] as const;
export const DevelopDiagramSource = z.enum(DEVELOP_DIAGRAM_SOURCES);

// ── 연락처(3스텝) — 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무라 필수 ─────────
export const DevelopContact = z.object({
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().max(200).nullable().default(null),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]{9,50}$/, '전화번호 형식이 아닙니다'),
  email: z.string().trim().email().max(191),
  hours: z.string().trim().max(100).nullable().default(null), // 통화 가능 시간(자유)
});
export type DevelopContactType = z.infer<typeof DevelopContact>;

// 연락처 칸 이름 — 관리자 연락처 수정(2026-11-04)의 타임라인 기록·화면이 같은 말을 쓴다(고객 등록 폼과 같은 낱말).
export const DEVELOP_CONTACT_FIELDS = ['name', 'company', 'phone', 'email', 'hours'] as const;
export type DevelopContactFieldType = (typeof DEVELOP_CONTACT_FIELDS)[number];
export const DEVELOP_CONTACT_FIELD_LABELS = {
  name: '담당자 이름',
  company: '회사',
  phone: '연락처',
  email: '이메일',
  hours: '연락 가능 시간',
} as const satisfies Record<DevelopContactFieldType, string>;

const blankToNull = (v: string | null): string | null => (v === null || v.trim() === '' ? null : v.trim());

/** 연락처 정리 — 앞뒤 공백을 걷고, 빈 회사·연락 가능 시간은 null(저장·비교가 같은 모양을 쓴다). */
export const normalizeDevelopContact = (c: DevelopContactType): DevelopContactType => ({
  name: c.name.trim(),
  company: blankToNull(c.company),
  phone: c.phone.trim(),
  email: c.email.trim(),
  hours: blankToNull(c.hours),
});

/** 두 연락처에서 바뀐 칸(DEVELOP_CONTACT_FIELDS 순서). 둘 다 정리한 뒤 견준다 — 공백만 다른 값은 그대로로 본다. */
export const developContactChanges = (before: DevelopContactType, after: DevelopContactType): DevelopContactFieldType[] => {
  const a = normalizeDevelopContact(before);
  const b = normalizeDevelopContact(after);
  return DEVELOP_CONTACT_FIELDS.filter((f) => a[f] !== b[f]);
};

// ── 의뢰 등록·수정 (multipart payload 파트 — 파일 파트는 마켓과 같은 `attachment` · `attachment:<area>:<slot>`) ──
// serviceAreas 는 **개별 견적일 때만** 뜻이 있다(개별 메뉴 코드 1개 이상). 시스템개발이면 서버가 전 분야로 채운다
// (resolveDevelopServiceAreas). 답변·툴 검증은 그렇게 확정된 분야 목록으로 한다.
const developEditableShape = {
  requestMode: DevelopRequestMode,
  title: z.string().trim().min(2).max(200),
  serviceAreas: z.array(MarketAreaCodeLoose).max(16).default([]),
  tools: MarketTools.default(EMPTY_MARKET_TOOLS),
  description: z.string().trim().min(10).max(20000),
  answers: MarketAnswers.default([]),
  // 역설계·PCB 만 고른 의뢰는 묻지 않는다(null) — 그 밖에는 필수(STAGE_REQUIRED, developNeedsStages).
  currentStage: DevelopCurrentStage.nullable().default(null),
  targetStage: DevelopTargetStage.nullable().default(null),
  wishDate: DevelopWishDate.nullable().default(null),
  wishNote: z.string().trim().max(200).nullable().default(null),
  budgetRange: DevelopBudgetRange,
  // 시스템개발에서 "전문가에게 맡김" — 3스텝 질문을 건너뛴다(개별 견적에선 언제나 false).
  expertDelegate: z.boolean().default(false),
  production: DevelopProductionPlan,
  ndaWanted: z.boolean().default(false), // 비밀유지 계약 희망 — 당사가 NDA 문서를 준비한다(오프라인)
} as const;
// AI 질문 답 — 잡 id + 답. 서버가 잡에서 질문을 되읽어 박제한다. 폴백(고정 문항)이면 null.
// 시스템개발 = 후속 질문(§7.2.2)의 답 · 개별 메뉴 = 맞춤 질문(§7.2.4) 중 새 질문의 답(고쳐 물은 기본 질문의 답은 answers 로 온다).
const developAiQuestionsInput = DevelopFollowupAnswersInput.nullable().default(null);

interface DevelopEditableCheck {
  requestMode: DevelopRequestModeType;
  serviceAreas: string[];
  answers: z.infer<typeof MarketAnswers>;
  tools: z.infer<typeof MarketTools>;
  currentStage: string | null;
  targetStage: string | null;
  wishDate: string | null;
  wishNote: string | null;
}
function developEditableIssues(p: DevelopEditableCheck, ctx: z.RefinementCtx): void {
  if (p.requestMode === 'individual') {
    const bad = p.serviceAreas.filter((c) => !DEVELOP_INDIVIDUAL_AREA_CODES.includes(c));
    if (bad.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'UNKNOWN_AREA', path: ['serviceAreas'] });
    if (new Set(p.serviceAreas).size !== p.serviceAreas.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_AREA', path: ['serviceAreas'] });
    if (p.serviceAreas.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AREA_REQUIRED', path: ['serviceAreas'] });
  }
  const areas = resolveDevelopServiceAreas(p.requestMode, p.serviceAreas, p.answers);
  if (developNeedsStages(areas) && (p.currentStage === null || p.targetStage === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'STAGE_REQUIRED', path: ['currentStage'] });
  }
  for (const issue of developAnswerIssues(p.answers, areas)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['answers'] });
  }
  for (const issue of developToolIssues(p.tools)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['tools'] });
  }
  if (p.wishDate === null && (p.wishNote === null || p.wishNote === '')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'WISH_REQUIRED', path: ['wishDate'] });
  }
}

export const DevelopRequestCreatePayload = z
  .object({
    ...developEditableShape,
    aiQuestions: developAiQuestionsInput,
    // 참고 자료가 외부 LLM 으로 나간다 — 미동의면 관리자 AI 버튼이 잠긴다(사유 표시).
    aiConsent: z.boolean().default(false),
    contact: DevelopContact,
  })
  .superRefine((p, ctx) => {
    developEditableIssues(p, ctx);
  });
export type DevelopRequestCreatePayloadType = z.infer<typeof DevelopRequestCreatePayload>;

// 수정 — received·reviewing 에서만(409 NOT_EDITABLE). 바뀐 필드는 이벤트 `edited` 로 남고 AI 초안은 stale 배지.
// 분야·답변·툴·희망 시기의 교차 검증은 저장분과 합친 뒤 라우트가 한다(부분 본문만으로는 못 본다).
export const DevelopRequestUpdateBody = z
  .object({
    requestMode: developEditableShape.requestMode,
    title: developEditableShape.title,
    serviceAreas: z.array(MarketAreaCodeLoose).max(16),
    tools: MarketTools,
    description: developEditableShape.description,
    answers: MarketAnswers,
    currentStage: DevelopCurrentStage.nullable(),
    targetStage: DevelopTargetStage.nullable(),
    wishDate: DevelopWishDate.nullable(),
    wishNote: z.string().trim().max(200).nullable(),
    budgetRange: developEditableShape.budgetRange,
    expertDelegate: z.boolean(),
    production: DevelopProductionPlan,
    ndaWanted: z.boolean(),
    contact: DevelopContact,
    aiQuestions: DevelopFollowupAnswersPatch, // 저장된 AI 질문의 답만(질문 불변). 저장분이 없으면 409 NO_AI_QUESTIONS
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' });
export type DevelopRequestUpdateBodyType = z.infer<typeof DevelopRequestUpdateBody>;

// 수정 본문을 저장분과 합친 뒤의 교차 검증 — 라우트가 부른다. 반환은 이슈 문자열(빈 배열 = 통과).
export function developMergedIssues(merged: DevelopEditableCheck): string[] {
  const issues: string[] = [];
  const ctx: Pick<z.RefinementCtx, 'addIssue'> = {
    addIssue: (issue) => {
      issues.push(`${(issue.path ?? []).join('.')}: ${issue.message ?? 'INVALID'}`);
    },
  };
  developEditableIssues(merged, ctx as z.RefinementCtx);
  return issues;
}

export const DevelopCancelBody = z.object({ reason: z.string().trim().max(500).optional() });
export type DevelopCancelBodyType = z.infer<typeof DevelopCancelBody>;

// ── 파일(산출물 잠금 표시 포함) ──────────────────────────────────────────────────
// locked = 잔금(unlocksDeliverables 마일스톤) 전이라 다운로드 403 LOCKED_UNTIL_PAID — 파일명·크기는 보인다.
export const DevelopFileMeta = MarketFileMeta.extend({ locked: z.boolean().default(false) });
export type DevelopFileMetaType = z.infer<typeof DevelopFileMeta>;

// ── 견적 항목·마일스톤·견적서(뷰) ────────────────────────────────────────────────
export const DevelopQuoteItemView = z.object({
  itemId: z.number(),
  seq: z.number(),
  category: DevelopQuoteItemCategory,
  title: z.string(), // 직무(인건비) · 항목(직접비)
  grade: z.string().nullable(), // 기술등급(인건비, 선택)
  description: z.string().nullable(), // 담당업무 · 규격
  unitPrice: z.number().int(),
  qty: z.number(), // 소수 둘째 자리까지
  unit: z.string(),
  amount: z.number().int(), // 공급가(원) = 단가 × 수량
  durationDays: z.number().int().nullable(), // 옛 항목별 기간 — 새 편집기는 쓰지 않는다
});
export type DevelopQuoteItemViewType = z.infer<typeof DevelopQuoteItemView>;

export const DevelopMilestoneView = z.object({
  milestoneId: z.number(),
  quoteId: z.number(),
  seq: z.number(),
  title: z.string(),
  ratioBp: z.number().int().nullable(),
  amount: z.number().int(), // VAT 포함 결제액(원)
  trigger: DevelopMilestoneTrigger,
  status: DevelopMilestoneStatus,
  payable: z.boolean(), // 서버 파생 — pending ∧ trigger 조건 충족
  unlocksDeliverables: z.boolean(),
  paidAt: z.string().nullable(),
  paidBy: z.enum(['lazy', 'admin']).nullable(), // 결제 확인 주체 — 영카트 라인 검증(lazy) / 관리자 수동 확인(admin)
  payment: MarketContractPayment.nullable(), // 영카트 주문이 있을 때만(od 파생, 저장 아님)
});
export type DevelopMilestoneViewType = z.infer<typeof DevelopMilestoneView>;

export const DevelopQuoteView = z.object({
  quoteId: z.number(),
  requestId: z.number(),
  version: z.number(),
  kind: DevelopQuoteKind,
  status: DevelopQuoteStatus,
  title: z.string(),
  vatMode: DevelopVatMode,
  // 산출 내역 — 비율은 견적마다 저장, 가산 금액은 저장 때 계산해 박제한다(규칙이 바뀌어도 나간 견적은 그대로).
  indirectBp: z.number().int(),
  overheadBp: z.number().int(),
  profitBp: z.number().int(),
  breakdown: z.object({
    laborSubtotal: z.number().int(),
    directSubtotal: z.number().int(),
    indirectAmount: z.number().int(),
    overheadAmount: z.number().int(),
    profitAmount: z.number().int(),
  }),
  recipientDept: z.string().nullable(), // 견적서 수신 부서(의뢰 연락처엔 없다)
  supplyAmount: z.number().int(),
  vatAmount: z.number().int(),
  totalAmount: z.number().int(),
  durationDays: z.number().int().nullable(),
  scheduleNote: z.string().nullable(),
  deliverables: z.array(z.string()),
  exclusions: z.string().nullable(),
  terms: z.string(),
  warrantyDays: z.number().int().nullable(),
  reviewDays: z.number().int(),
  validUntil: z.string(), // YYYY-MM-DD(KST)
  note: z.string().nullable(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  acceptedName: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  items: z.array(DevelopQuoteItemView),
  milestones: z.array(DevelopMilestoneView),
  poFile: MarketFileMeta.nullable(), // 고객이 수락 때 붙인 발주서
});
export type DevelopQuoteViewType = z.infer<typeof DevelopQuoteView>;

// 관리자 견적 — 고객 뷰 + 내부 메모(고객 응답·인쇄·엑셀엔 없다). 항목 내부 원가는 2026-11-04 저녁 사용자 결정으로 뺐다.
export const AdminDevelopQuoteView = DevelopQuoteView.extend({
  internalNote: z.string().nullable(),
});
export type AdminDevelopQuoteViewType = z.infer<typeof AdminDevelopQuoteView>;

// ── 타임라인 이벤트(뷰) ────────────────────────────────────────────────────────
export const DevelopEventView = z.object({
  eventId: z.number(),
  type: DevelopEventType,
  byAdmin: z.boolean(),
  actorName: z.string(), // 고객 화면: 담당자 표기 통일 · 관리자 화면: 실명
  visibleToCustomer: z.boolean(),
  title: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  files: z.array(DevelopFileMeta),
  createdAt: z.string(),
});
export type DevelopEventViewType = z.infer<typeof DevelopEventView>;

// ── AI 산출물 상태(고객·관리자 공용 조각) ───────────────────────────────────────
export const DEVELOP_AI_REVIEW_STATES = ['none', 'running', 'ready', 'published', 'error'] as const;
export type DevelopAiReviewStateType = (typeof DEVELOP_AI_REVIEW_STATES)[number];
export const DevelopAiReviewState = z.enum(DEVELOP_AI_REVIEW_STATES);

// ── 고객 목록·상세 ────────────────────────────────────────────────────────────
export const DevelopRequestListItem = z.object({
  requestId: z.number(),
  title: z.string(),
  requestMode: DevelopRequestMode,
  serviceAreas: z.array(MarketAreaCodeLoose),
  status: DevelopRequestStatus,
  budgetRange: DevelopBudgetRange,
  createdAt: z.string(),
  updatedAt: z.string(),
  // 고객이 지금 할 일 — 서버 파생(견적 검토 · 결제 · 검수 · 확인 요청 답변). 없으면 null.
  nextAction: z.enum(['review_quote', 'pay', 'inspect', 'answer_document', 'answer_review']).nullable(),
  reviewPublished: z.boolean(),
  diagramPublished: z.boolean(),
});
export type DevelopRequestListItemType = z.infer<typeof DevelopRequestListItem>;

export const DevelopRequestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  scope: z.enum(DEVELOP_MY_LIST_SCOPES).default('all'), // active = 끝난 의뢰(DEVELOP_ENDED_STATUSES) 제외
});
export type DevelopRequestListQueryType = z.infer<typeof DevelopRequestListQuery>;

export const DevelopRequestListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(DevelopRequestListItem), total: z.number(), page: z.number(), pageSize: z.number() }),
});
export type DevelopRequestListResponseType = z.infer<typeof DevelopRequestListResponse>;

// 공개 구성도 — 완성본만 고객에게(메타는 done 만, html 은 공개 스냅샷).
export const DevelopPublicDiagram = z.object({
  html: z.string(),
  publishedAt: z.string(),
  source: DevelopDiagramSource,
  meta: MarketDevDiagram.nullable(),
});
export type DevelopPublicDiagramType = z.infer<typeof DevelopPublicDiagram>;

// 위저드 v2 필드(2026-09-08) — 옛 저장분(v1 위저드)은 단계·계획이 null 이다.
export const DevelopWizardFields = z.object({
  currentStage: DevelopCurrentStage.nullable(),
  targetStage: DevelopTargetStage.nullable(),
  wishDate: z.string().nullable(),
  wishNote: z.string().nullable(),
  expertDelegate: z.boolean(),
  production: DevelopProductionPlan.nullable(),
  aiQuestions: DevelopAiQuestions.nullable(), // 시스템개발 AI 후속 질문·답(§7.2.2). 폴백·맡김·개별 견적은 null
});
export type DevelopWizardFieldsType = z.infer<typeof DevelopWizardFields>;

export const DevelopRequestDetail = DevelopRequestListItem.extend({
  ...DevelopWizardFields.shape,
  description: z.string(),
  tools: MarketTools,
  answers: MarketAnswers,
  contact: DevelopContact,
  ndaWanted: z.boolean(),
  aiConsent: z.boolean(),
  files: z.array(DevelopFileMeta), // 의뢰 첨부(참고 자료·슬롯)
  review: MarketDevReview.nullable(), // **공개본만**
  reviewPublishedAt: z.string().nullable(),
  reviewPublicSeq: z.number().int().nullable(), // 지금 공개본과 같은 최근 published 버전의 seq(§6.2) — 고객 화면 "v3" 라벨
  diagram: DevelopPublicDiagram.nullable(), // **공개본만**
  quotes: z.array(DevelopQuoteView), // draft 제외
  events: z.array(DevelopEventView), // visibleToCustomer 만
  documents: z.array(DevelopDocumentView), // 프로젝트 문서(§13) — 발송된 것만(draft 제외)
  progress: DevelopProgressView, // 진행 현황(§13) — 공개 업무 행만
  reviewDays: z.number().int(),
  startedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  declinedReason: z.string().nullable(),
  // 배정 담당자 이름 — 출력물 표지에만 쓴다(사용자 결정 2026-10-22). 미배정·이름 없음·관리자 기본 이름이면 null.
  // 진행 기록은 여전히 '담당자'로만 보인다(누가 썼는지 가르지 않는다).
  assigneeName: z.string().nullable(),
  viewer: z.object({
    canEdit: z.boolean(),
    canCancel: z.boolean(),
    deliverablesLocked: z.boolean(), // 잔금 전이라 최종 산출물이 잠겨 있다
  }),
});
export type DevelopRequestDetailType = z.infer<typeof DevelopRequestDetail>;

export const DevelopRequestDetailResponse = z.object({ result: z.literal(true), data: DevelopRequestDetail });
export type DevelopRequestDetailResponseType = z.infer<typeof DevelopRequestDetailResponse>;

export const DevelopRequestCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ requestId: z.number(), status: DevelopRequestStatus, aiQueued: z.boolean() }),
});
export type DevelopRequestCreateResponseType = z.infer<typeof DevelopRequestCreateResponse>;

export const DevelopRequestStatusResponse = z.object({
  result: z.literal(true),
  data: z.object({ requestId: z.number(), status: DevelopRequestStatus }),
});
export type DevelopRequestStatusResponseType = z.infer<typeof DevelopRequestStatusResponse>;

export const DevelopFilesResponse = z.object({
  result: z.literal(true),
  data: z.object({ files: z.array(DevelopFileMeta) }),
});
export type DevelopFilesResponseType = z.infer<typeof DevelopFilesResponse>;

// ── 고객 행동(P2·P3) ─────────────────────────────────────────────────────────
export const DevelopQuoteAcceptBody = z.object({
  agree: z.literal(true), // 표준 조건 동의 — 기록(시각·IP·이름)이 계약 갈음
  name: z.string().trim().min(1).max(100),
});
export type DevelopQuoteAcceptBodyType = z.infer<typeof DevelopQuoteAcceptBody>;

export const DevelopQuoteDeclineBody = z.object({ reason: z.string().trim().max(1000).optional() });
export type DevelopQuoteDeclineBodyType = z.infer<typeof DevelopQuoteDeclineBody>;

export const DevelopCommentBody = z.object({ body: z.string().trim().min(1).max(5000), asRequest: z.boolean().default(false) });
export type DevelopCommentBodyType = z.infer<typeof DevelopCommentBody>;

export const DevelopReviewDecisionBody = z.object({ note: z.string().trim().max(2000).optional() });
export type DevelopReviewDecisionBodyType = z.infer<typeof DevelopReviewDecisionBody>;

export const DevelopQuoteResponse = z.object({ result: z.literal(true), data: DevelopQuoteView });
export type DevelopQuoteResponseType = z.infer<typeof DevelopQuoteResponse>;

export const DevelopEventResponse = z.object({ result: z.literal(true), data: DevelopEventView });
export type DevelopEventResponseType = z.infer<typeof DevelopEventResponse>;

export const DevelopCheckoutResponse = z.object({
  result: z.literal(true),
  data: z.object({ redirectUrl: z.string() }),
});
export type DevelopCheckoutResponseType = z.infer<typeof DevelopCheckoutResponse>;

// ── 견적 순수 함수(금액 계산·마일스톤 분배) — FE·서버 공유 ─────────────
// (붙여넣기 파서 parseDevelopQuoteLines 는 2026-11-04 저녁 '붙여넣기로 채우기' 기능과 함께 뺐다.)
export interface DevelopQuoteAmounts {
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
}

// 항목 금액은 공급가. included 는 항목 합계를 "VAT 포함 합계"로 보고 공급가를 역산한다(레거시 견적서 관례).
export function computeDevelopQuoteAmounts(itemAmounts: readonly number[], vatMode: DevelopVatModeType): DevelopQuoteAmounts {
  const sum = itemAmounts.reduce((a, b) => a + Math.max(0, Math.round(b)), 0);
  if (vatMode === 'exempt') return { supplyAmount: sum, vatAmount: 0, totalAmount: sum };
  if (vatMode === 'included') {
    const supply = Math.round((sum * 10_000) / (10_000 + DEVELOP_VAT_RATE_BP));
    return { supplyAmount: supply, vatAmount: sum - supply, totalAmount: sum };
  }
  const vat = Math.round((sum * DEVELOP_VAT_RATE_BP) / 10_000);
  return { supplyAmount: sum, vatAmount: vat, totalAmount: sum + vat };
}

// 마일스톤 금액 = 합계 × 비율, 반올림 차액은 마지막 마일스톤이 흡수한다(합이 정확히 total).
export function splitDevelopMilestoneAmounts(totalAmount: number, ratiosBp: readonly number[]): number[] {
  if (ratiosBp.length === 0) return [];
  const out = ratiosBp.map((bp) => Math.round((totalAmount * bp) / 10_000));
  const diff = totalAmount - out.reduce((a, b) => a + b, 0);
  const last = out.length - 1;
  out[last] = (out[last] ?? 0) + diff;
  return out;
}

// ── 산출 내역 순수 함수(FE·서버·엑셀 공유) ──────────────────────────────────────
/** 항목 금액 = 단가 × 수량(소수 둘째 자리). 정수 연산으로 부동소수 오차를 피하고 원 단위 반올림. */
export function developQuoteItemAmount(unitPrice: number, qty: number): number {
  const hundredths = Math.round(qty * 100);
  return Math.round((Math.max(0, Math.round(unitPrice)) * Math.max(0, hundredths)) / 100);
}

export interface DevelopQuoteRates {
  indirectBp: number;
  overheadBp: number;
  profitBp: number;
}

export interface DevelopQuoteBreakdown extends DevelopQuoteAmounts {
  laborSubtotal: number;
  directSubtotal: number;
  indirectAmount: number;
  overheadAmount: number;
  profitAmount: number;
}

// 가산 한 행 = floor(앞 합계 × 비율, 천 원 단위). base·bp 가 정수라 곱은 정확하고, 몫이 정수면 나눗셈도 정확하다.
const developSurcharge = (base: number, bp: number): number => {
  if (bp <= 0 || base <= 0) return 0;
  const raw = Math.floor((base * Math.round(bp)) / 10_000);
  return Math.floor(raw / 1000) * 1000;
};

/**
 * 산출 내역 — 인건비·직접비 소계 → 간접비(인건비+직접비) → 제경비(+간접비) → 기업이윤(+제경비) → 공급가 → VAT.
 * 비율이 모두 0 이면 공급가 = 항목 합계라 옛 견적과 같다. VAT 방식은 가산까지 더한 합에 지금 규칙(computeDevelopQuoteAmounts)을 쓴다.
 */
export function computeDevelopQuoteBreakdown(
  items: readonly { category: DevelopQuoteItemCategoryType; amount: number }[],
  rates: DevelopQuoteRates,
  vatMode: DevelopVatModeType,
): DevelopQuoteBreakdown {
  const sumOf = (category: DevelopQuoteItemCategoryType): number =>
    items.filter((it) => it.category === category).reduce((a, it) => a + Math.max(0, Math.round(it.amount)), 0);
  const laborSubtotal = sumOf('labor');
  const directSubtotal = sumOf('direct');
  const base = laborSubtotal + directSubtotal;
  const indirectAmount = developSurcharge(base, rates.indirectBp);
  const overheadAmount = developSurcharge(base + indirectAmount, rates.overheadBp);
  const profitAmount = developSurcharge(base + indirectAmount + overheadAmount, rates.profitBp);
  const amounts = computeDevelopQuoteAmounts([base + indirectAmount + overheadAmount + profitAmount], vatMode);
  return { laborSubtotal, directSubtotal, indirectAmount, overheadAmount, profitAmount, ...amounts };
}

/** 1500 → '15', 250 → '2.5' (퍼센트 숫자만). */
export const developBpPercent = (bp: number): string => {
  const pct = Math.round(bp) / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

/** 가산 행 문구 — '15% (인건비+직접비)'. */
export const developQuoteSurchargeText = (kind: DevelopQuoteSurchargeType, bp: number): string =>
  `${developBpPercent(bp)}% ${DEVELOP_QUOTE_SURCHARGE_BASIS[kind]}`;

/** 수량 표기 — 0.5 → '0.5', 3 → '3'. 단위가 영문이면 한 칸 띄운다('10일', '3회', '2 EA'). */
export function developQuoteQtyText(qty: number, unit: string): string {
  const n = Math.round(qty * 100) / 100;
  const num = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '');
  const u = unit.trim();
  if (u === '') return num;
  return /^[A-Za-z]/.test(u) ? `${num} ${u}` : `${num}${u}`;
}

/** 견적번호 — 의뢰·판에서 만든다(별도 채번 없음). */
export const developQuoteNo = (requestId: number, version: number): string => `Q${String(requestId)}-v${String(version)}`;

/** 견적서 파일 이름 — '{제목} 견적서 {견적번호}.{확장자}'(참고 견적서 파일 이름 관례). 경로·예약 문자는 지운다
 * (서버 헤더·화면 저장 공용 — 엑셀과 PDF 가 같은 이름을 쓴다). 80자는 **글자(코드 포인트) 단위**로 자른다 — UTF-16
 * 단위로 자르면 이모지가 반으로 쪼개져 encodeURIComponent 가 URIError 를 던지고 엑셀 라우트가 500 이 된다
 * (2026-11-04 리뷰). 짝 없는 서로게이트도 미리 지운다. 견적번호 자리는 발송 전 미리보기면 '발송 전' 같은 글이 온다. */
export function developQuoteFileName(title: string, quoteNo: string, ext: 'xlsx' | 'pdf'): string {
  const clean = (v: string): string =>
    v
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const t = Array.from(clean(title)).slice(0, 80).join('').trim();
  return `${t === '' ? '' : `${t} `}견적서 ${clean(quoteNo)}.${ext}`;
}

/** 엑셀 파일 이름 — '{제목} 견적서 Q12-v1.xlsx'. */
export const developQuoteXlsxName = (q: { title: string; requestId: number; version: number }): string =>
  developQuoteFileName(q.title, developQuoteNo(q.requestId, q.version), 'xlsx');

/** PDF 파일 이름 — '{제목} 견적서 Q12-v1.pdf'(엑셀과 같은 규칙). */
export const developQuotePdfName = (q: { title: string; requestId: number; version: number }): string =>
  developQuoteFileName(q.title, developQuoteNo(q.requestId, q.version), 'pdf');

export interface DevelopQuoteRemark {
  label: string | null;
  text: string;
}

/**
 * 견적서 Remark — 이미 있는 칸에서 문장을 만든다(인쇄 시트·관리자 미리보기·엑셀 공용). 납기 · 견적 유효기간 · 결제 조건 ·
 * 산출물 · 별도 실비 · 승인 후 진행(고정). 결제 조건은 마일스톤마다 '명칭 비율%(청구 시점)', 산출물은 ' · '로 잇는다.
 * 산출물·별도 실비는 비어 있으면 줄을 뺀다(2026-11-04 사용자 요청 — 1쪽에서 바로 보이게, 자세한 것은 별지에도 그대로).
 */
export function developQuoteRemarks(q: {
  durationDays: number | null;
  scheduleNote: string | null;
  validUntil: string;
  milestones: readonly { title: string; ratioBp: number | null; trigger: DevelopMilestoneTriggerType }[];
  deliverables: readonly string[];
  exclusions: string | null;
}): DevelopQuoteRemark[] {
  const note = (q.scheduleNote ?? '').trim();
  const days = q.durationDays === null ? '' : `착수 후 ${String(q.durationDays)}일`;
  const delivery = [days, note].filter((s) => s !== '').join(' · ');
  // '명칭 비율%(청구 시점)' — 문자열 치환 없이 조립한다(명칭 안의 ' (' 를 건드리지 않게, 2026-11-04 리뷰).
  const payment = q.milestones
    .map((m) => {
      const head = [m.title.trim(), m.ratioBp === null ? '' : `${developBpPercent(m.ratioBp)}%`].filter((s) => s !== '').join(' ');
      return `${head}(${DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger]})`;
    })
    .join(', ');
  const deliverables = q.deliverables
    .map((d) => d.trim())
    .filter((d) => d !== '')
    .join(' · ');
  const exclusions = (q.exclusions ?? '').trim();
  return [
    { label: '납기', text: delivery === '' ? '협의' : delivery },
    { label: '견적 유효기간', text: `${q.validUntil}까지` },
    { label: '결제 조건', text: payment === '' ? '협의' : payment },
    ...(deliverables === '' ? [] : [{ label: '산출물', text: deliverables }]),
    ...(exclusions === '' ? [] : [{ label: '별도 실비', text: exclusions }]),
    { label: null, text: DEVELOP_QUOTE_APPROVAL_REMARK },
  ];
}

// ── 견적서 1쪽 표의 행 — 인쇄 시트(@sp/ui)와 서버 엑셀이 같은 행을 그린다 ─────────────────
// 순위 = 나타난 구분 순서(인건비 1 · 직접비 2 · 간접비 3 …, 없는 구분은 건너뛴다). 순위 칸은 구분 항목 + 소계 행을,
// 구분 칸은 항목 행만 묶는다(참고 견적서 병합 그대로). 가산 행은 비율이 0 이면 빠진다.
export interface DevelopQuoteSheetRecipient {
  company: string | null;
  dept: string | null;
  name: string;
  phone: string;
  email: string;
}

// 인쇄 시트가 받는 견적 — 저장된 견적(DevelopQuoteView)과 관리자 편집기의 미리보기(폼에서 만든 것)가 둘 다 맞춘다.
export type DevelopQuoteSheetQuote = Pick<
  DevelopQuoteViewType,
  | 'title'
  | 'vatMode'
  | 'items'
  | 'breakdown'
  | 'indirectBp'
  | 'overheadBp'
  | 'profitBp'
  | 'supplyAmount'
  | 'vatAmount'
  | 'totalAmount'
  | 'durationDays'
  | 'scheduleNote'
  | 'validUntil'
  | 'note'
  | 'deliverables'
  | 'exclusions'
> & { milestones: readonly { title: string; ratioBp: number | null; trigger: DevelopMilestoneTriggerType }[] };

export type DevelopQuoteSheetRow =
  | {
      kind: 'item';
      rank: number;
      category: DevelopQuoteItemCategoryType;
      groupLabel: string;
      groupFirst: boolean; // 구분의 첫 행 — 순위·구분 칸을 여기서 그린다
      groupSize: number; // 그 구분의 항목 수
      title: string;
      grade: string | null;
      description: string | null;
      unitPrice: number;
      qtyText: string;
      amount: number;
    }
  | { kind: 'subtotal'; category: DevelopQuoteItemCategoryType; label: string; amount: number }
  | { kind: 'surcharge'; rank: number; surcharge: DevelopQuoteSurchargeType; label: string; text: string; amount: number };

export function developQuoteSheetRows(
  q: Pick<DevelopQuoteViewType, 'items' | 'breakdown' | 'indirectBp' | 'overheadBp' | 'profitBp'>,
): DevelopQuoteSheetRow[] {
  const rows: DevelopQuoteSheetRow[] = [];
  let rank = 0;
  for (const category of DEVELOP_QUOTE_ITEM_CATEGORIES) {
    const items = q.items.filter((it) => it.category === category);
    if (items.length === 0) continue;
    rank += 1;
    const groupLabel = DEVELOP_QUOTE_ITEM_CATEGORY_LABELS[category];
    items.forEach((it, i) => {
      rows.push({
        kind: 'item',
        rank,
        category,
        groupLabel,
        groupFirst: i === 0,
        groupSize: items.length,
        title: it.title,
        grade: category === 'labor' ? it.grade : null, // 기술등급은 인건비만(직접비 줄엔 칸이 없다)
        description: it.description,
        unitPrice: it.unitPrice,
        qtyText: developQuoteQtyText(it.qty, it.unit),
        amount: it.amount,
      });
    });
    const amount = category === 'labor' ? q.breakdown.laborSubtotal : q.breakdown.directSubtotal;
    rows.push({ kind: 'subtotal', category, label: `${groupLabel} 소계`, amount });
  }
  const surcharges: { surcharge: DevelopQuoteSurchargeType; bp: number; amount: number }[] = [
    { surcharge: 'indirect', bp: q.indirectBp, amount: q.breakdown.indirectAmount },
    { surcharge: 'overhead', bp: q.overheadBp, amount: q.breakdown.overheadAmount },
    { surcharge: 'profit', bp: q.profitBp, amount: q.breakdown.profitAmount },
  ];
  for (const s of surcharges) {
    if (s.bp <= 0) continue;
    rank += 1;
    rows.push({
      kind: 'surcharge',
      rank,
      surcharge: s.surcharge,
      label: DEVELOP_QUOTE_SURCHARGE_LABELS[s.surcharge],
      text: developQuoteSurchargeText(s.surcharge, s.bp),
      amount: s.amount,
    });
  }
  return rows;
}

// ── 관리자 ───────────────────────────────────────────────────────────────────
export const DEVELOP_ADMIN_TABS = [
  'all',
  'received',
  'reviewing',
  'quoted',
  'accepted',
  'in_progress',
  'delivered',
  'completed',
  'closed', // cancelled + declined
  // 개발 모듈 워크큐(§14, 2026-09-09) — 두 상태를 한 큐로 본다. 접수·검토 = received+reviewing · 견적·계약 = quoted+accepted.
  'intake',
  'contract',
] as const;
export type DevelopAdminTabType = (typeof DEVELOP_ADMIN_TABS)[number];
export const DevelopAdminTab = z.enum(DEVELOP_ADMIN_TABS);
export const DEVELOP_ADMIN_TAB_LABELS = {
  all: '전체',
  received: '접수',
  reviewing: '검토 중',
  quoted: '견적 발송',
  accepted: '결제 대기',
  in_progress: '진행 중',
  delivered: '납품·검수',
  completed: '완료',
  closed: '종결',
  intake: '접수·검토',
  contract: '견적·계약',
} as const satisfies Record<DevelopAdminTabType, string>;

// 워크큐 신호(§14) — 상태가 아니라 "지금 관리자 차례"인 조건. 목록 query `signal` 로 거르고, 응답 `signals` 가 모듈 배지 수.
export const DEVELOP_ADMIN_SIGNALS = ['docs_awaiting', 'inquiries_open', 'reply_overdue'] as const;
export type DevelopAdminSignalType = (typeof DEVELOP_ADMIN_SIGNALS)[number];
export const DevelopAdminSignal = z.enum(DEVELOP_ADMIN_SIGNALS);
export const DEVELOP_ADMIN_SIGNAL_LABELS = {
  docs_awaiting: '고객 회신 대기',
  inquiries_open: '미답변 문의',
  reply_overdue: '회신 기한 초과',
} as const satisfies Record<DevelopAdminSignalType, string>;

export const AdminDevelopRequestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: DevelopAdminTab.default('all'),
  q: z.string().trim().max(100).optional(), // 제목·의뢰인 mbId·연락처 이름·회사 contains
  // 신호 필터(§14) — 지정하면 탭 안에서 그 신호가 켜진 건만(서버가 전 행을 계산한 뒤 메모리에서 페이지를 자른다).
  signal: DevelopAdminSignal.optional(),
});
export type AdminDevelopRequestListQueryType = z.infer<typeof AdminDevelopRequestListQuery>;

export const AdminDevelopRequestCounts = z.object(
  Object.fromEntries(DEVELOP_ADMIN_TABS.map((t) => [t, z.number()])) as Record<DevelopAdminTabType, z.ZodNumber>,
);
export type AdminDevelopRequestCountsType = z.infer<typeof AdminDevelopRequestCounts>;

export const AdminDevelopAiSummary = z.object({
  review: DevelopAiReviewState,
  reviewStale: z.boolean(), // 초안 생성 뒤 원천이 바뀌었다
  diagram: z.enum(MARKET_DEV_DIAGRAM_STATUSES).nullable(),
  diagramPublished: z.boolean(),
});
export type AdminDevelopAiSummaryType = z.infer<typeof AdminDevelopAiSummary>;

// 운영 신호(§14) — 목록 행마다 서버가 파생. 진행률·단계는 업무표, 회신 대기·기한은 sent 승인형 문서, 문의는 comment/as_request 이벤트에서.
export const AdminDevelopOps = z.object({
  progressPct: z.number().int(),
  currentPhase: DevelopTaskPhase.nullable(),
  taskCount: z.number().int(),
  pendingApprovals: z.number().int(), // sent 승인형 문서 수(고객 회신 대기)
  nextReplyDueOn: z.string().nullable(), // 가장 이른 회신 요청일(YYYY-MM-DD)
  replyOverdue: z.boolean(), // 회신 요청일이 오늘(KST)보다 앞선 대기 문서가 있다
  openInquiries: z.number().int(), // 마지막 담당자 답변 뒤에 온 고객 문의·A/S 수
  lastInquiry: z.object({ at: z.string(), type: z.enum(['comment', 'as_request']), excerpt: z.string() }).nullable(),
  // 2026-09-10 G 이식 — 지연 작업 수(완료일 경과 ∧ 미완료) · 수락 견적 마일스톤의 수납/미수납(VAT 포함, 원) · 열어야 할 수동 청구 수.
  overdueTasks: z.number().int(),
  paidAmount: z.number().int(),
  pendingAmount: z.number().int(),
  openableMilestones: z.number().int(), // trigger=manual ∧ pending ∧ 아직 안 열림 — 담당자가 '고객 결제 열기'를 눌러야 결제 가능
});
export type AdminDevelopOpsType = z.infer<typeof AdminDevelopOps>;

export const AdminDevelopRequestListItem = z.object({
  requestId: z.number(),
  title: z.string(),
  requestMode: DevelopRequestMode,
  serviceAreas: z.array(MarketAreaCodeLoose),
  status: DevelopRequestStatus,
  budgetRange: DevelopBudgetRange,
  owner: z.object({ mbId: z.string(), name: z.string(), email: z.string().nullable() }),
  contact: DevelopContact,
  assigneeMbId: z.string().nullable(),
  aiConsent: z.boolean(),
  // 역설계 권리 확인 답이 '유지보수 목적'·'상담' — 담당자가 견적 전에 작업 가능 여부를 확인해야 한다(목록 배지·상세 첫 줄).
  rightsCheck: z.boolean(),
  // PCB 설계만 의뢰에서 '설계와 제작 견적을 함께 미리 받고 싶어요'(2026-11-03) — 담당자가 제작 예상가도 같이 안내한다(목록 배지).
  preQuote: z.boolean(),
  ai: AdminDevelopAiSummary,
  quoteCount: z.number(),
  latestQuote: z
    .object({ quoteId: z.number(), version: z.number(), kind: DevelopQuoteKind, status: DevelopQuoteStatus, totalAmount: z.number() })
    .nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ops: AdminDevelopOps,
});
export type AdminDevelopRequestListItemType = z.infer<typeof AdminDevelopRequestListItem>;

// 모듈 배지 수(§14) — 검색어와 무관하게 활성 의뢰(completed·cancelled·declined 제외) 전체에서 센다.
export const AdminDevelopSignals = z.object({
  docsAwaiting: z.number().int(),
  inquiriesOpen: z.number().int(),
  replyOverdue: z.number().int(),
});
export type AdminDevelopSignalsType = z.infer<typeof AdminDevelopSignals>;

export const AdminDevelopRequestListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminDevelopRequestListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminDevelopRequestCounts,
    signals: AdminDevelopSignals,
  }),
});
export type AdminDevelopRequestListResponseType = z.infer<typeof AdminDevelopRequestListResponse>;

// 검토서 3층 — 초안(AI 원본) · 작업본(편집) · 공개본(스냅샷).
export const AdminDevelopReviewState = z.object({
  draft: MarketDevReview.nullable(),
  draftAt: z.string().nullable(),
  draftJobId: z.string().nullable(),
  draftRunning: z.boolean(),
  draftError: z.string().nullable(),
  stale: z.boolean(), // 초안 입력 해시 ≠ 현재 원천 해시
  working: MarketDevReview.nullable(),
  editedAt: z.string().nullable(),
  editedBy: z.string().nullable(),
  publicReview: MarketDevReview.nullable(),
  publishedAt: z.string().nullable(),
  publishedStale: z.boolean(), // 공개 뒤 작업본이 바뀌었다
});
export type AdminDevelopReviewStateType = z.infer<typeof AdminDevelopReviewState>;

export const AdminDevelopDiagramState = z.object({
  meta: MarketDevDiagram.nullable(),
  html: z.string().nullable(), // 현재본(AI 또는 업로드)
  source: DevelopDiagramSource.nullable(),
  published: z.boolean(),
  publishedAt: z.string().nullable(),
  publishedStale: z.boolean(), // 공개 뒤 현재본이 바뀌었다
});
export type AdminDevelopDiagramStateType = z.infer<typeof AdminDevelopDiagramState>;

export const AdminDevelopRequestDetail = AdminDevelopRequestListItem.extend({
  ...DevelopWizardFields.shape,
  description: z.string(),
  tools: MarketTools,
  answers: MarketAnswers,
  ndaWanted: z.boolean(),
  internalMemo: z.string().nullable(),
  aiSupplement: z.string().nullable(),
  files: z.array(DevelopFileMeta),
  review: AdminDevelopReviewState,
  diagram: AdminDevelopDiagramState,
  quotes: z.array(AdminDevelopQuoteView),
  events: z.array(DevelopEventView),
  documents: z.array(AdminDevelopDocumentView), // 프로젝트 문서(§13) — draft·이전 버전·메일 확인본 포함
  progress: DevelopProgressView, // 전 업무 행
  reviewDays: z.number().int(),
  startedAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  declinedReason: z.string().nullable(),
});
export type AdminDevelopRequestDetailType = z.infer<typeof AdminDevelopRequestDetail>;

export const AdminDevelopRequestDetailResponse = z.object({ result: z.literal(true), data: AdminDevelopRequestDetail });
export type AdminDevelopRequestDetailResponseType = z.infer<typeof AdminDevelopRequestDetailResponse>;

export const AdminDevelopRequestPatchBody = z
  .object({
    assigneeMbId: z.string().trim().max(191).nullable(),
    internalMemo: z.string().trim().max(20000).nullable(),
    // AI 보충 메모 — 코퍼스에 "담당자 보충 자료"로 합류한다(전화 상담으로 알게 된 사양 등). 고객 비노출.
    aiSupplement: z.string().trim().max(20000).nullable(),
    reviewDays: z.number().int().min(1).max(90),
    // 연락처(2026-11-04) — 고객은 접수·검토 중에만 고치지만 관리자는 상태와 상관없이 고친다(담당자 교체·오타).
    // 검사는 등록과 같은 스키마. 바뀐 칸이 있으면 서버가 타임라인에 두 줄을 남긴다(고객용 = 바뀐 칸 이름만, 관리자용 = 이전 → 이후).
    contact: DevelopContact,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' });
export type AdminDevelopRequestPatchBodyType = z.infer<typeof AdminDevelopRequestPatchBody>;

// 관리자 상태 전이 — 나머지 전이(quoted·accepted·paid→in_progress·delivered)는 견적·결제·납품 행동의 부수효과.
export const AdminDevelopStatusBody = z.object({
  to: z.enum(['reviewing', 'in_progress', 'completed', 'cancelled', 'declined']),
  reason: z.string().trim().max(1000).optional(), // declined·cancelled 는 필수(라우트 검사)
});
export type AdminDevelopStatusBodyType = z.infer<typeof AdminDevelopStatusBody>;

// 작업본 저장 — 관리자가 고친 검토서 전체를 보낸다(구조 편집). 서버가 meta.editedAt/By 를 찍는다.
// 관리자 입력은 **엄격하게** 받는다 — 저장분 읽기용 MarketDevReview 는 schedule 을 `.catch(null)` 로
// 관대하게 받지만(옛/깨진 저장분을 살려 두려고), 편집기가 보낸 잘못된 주(0·200)를 조용히 null 로 삼키면
// 관리자가 지운 줄 모른다. 여기서만 catch 를 벗겨 400 을 낸다.
export const AdminDevelopReviewPutBody = z.object({
  review: MarketDevReview.extend({ schedule: DevReviewSchedule.nullable().optional() }),
});
export type AdminDevelopReviewPutBodyType = z.infer<typeof AdminDevelopReviewPutBody>;

export const AdminDevelopAiRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string().nullable(), cached: z.boolean(), skipped: z.string().nullable() }),
});
export type AdminDevelopAiRunResponseType = z.infer<typeof AdminDevelopAiRunResponse>;

// 관리자 이벤트(multipart: payload + file[]) — note(진행 메모) · comment(문의 답) · review_request(확인 요청) ·
// deliverable(산출물, final=납품 전이 · locked=잔금 후 공개) · tax_invoice(발행 사실).
export const AdminDevelopEventPayload = z.object({
  type: DevelopAdminEventType,
  title: z.string().trim().max(200).default(''),
  body: z.string().trim().max(10000).default(''),
  visibleToCustomer: z.boolean().default(true),
  final: z.boolean().default(false),
  locked: z.boolean().default(false),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AdminDevelopEventPayloadType = z.infer<typeof AdminDevelopEventPayload>;

// 항목 입력 — 금액은 서버가 단가 × 수량으로 다시 계산한다. unitPrice 가 없으면 amount 를 단가로(수량 1) 읽는다
// (옛 호출 호환). 둘 다 없으면 400.
export const DevelopQuoteItemInput = z
  .object({
    category: DevelopQuoteItemCategory.default('labor'),
    title: z.string().trim().min(1).max(200),
    grade: z.string().trim().max(50).nullable().default(null),
    description: z.string().trim().max(2000).nullable().default(null),
    unitPrice: z.number().int().min(0).max(DEVELOP_QUOTE_AMOUNT_MAX).optional(),
    qty: z
      .number()
      .positive()
      .max(DEVELOP_QUOTE_QTY_MAX)
      .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, { message: '수량은 소수 둘째 자리까지입니다' })
      .default(1),
    unit: z.string().trim().min(1).max(20).default('식'),
    amount: z.number().int().min(0).max(DEVELOP_QUOTE_AMOUNT_MAX).optional(),
    durationDays: z.number().int().positive().max(3650).nullable().default(null),
  })
  .refine((it) => it.unitPrice !== undefined || it.amount !== undefined, { message: '단가가 필요합니다', path: ['unitPrice'] });

export type DevelopQuoteItemInputType = z.infer<typeof DevelopQuoteItemInput>;

export const DevelopMilestoneInput = z.object({
  title: z.string().trim().min(1).max(100),
  ratioBp: z.number().int().min(1).max(10_000),
  trigger: DevelopMilestoneTrigger,
  unlocksDeliverables: z.boolean().default(false),
});
export type DevelopMilestoneInputType = z.infer<typeof DevelopMilestoneInput>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const AdminDevelopQuoteBody = z
  .object({
    kind: DevelopQuoteKind.default('initial'),
    title: z.string().trim().min(1).max(200),
    vatMode: DevelopVatMode.default('separate'),
    indirectBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP).default(0),
    overheadBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP).default(0),
    profitBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP).default(0),
    recipientDept: z.string().trim().max(100).nullable().default(null),
    durationDays: z.number().int().positive().max(3650).nullable().default(null),
    scheduleNote: z.string().trim().max(4000).nullable().default(null),
    deliverables: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
    exclusions: z.string().trim().max(4000).nullable().default(null),
    terms: z.string().trim().max(20000).default(''),
    warrantyDays: z.number().int().min(0).max(3650).nullable().default(null),
    reviewDays: z.number().int().min(1).max(90).default(7),
    validUntil: z.string().regex(DATE_RE),
    note: z.string().trim().max(4000).nullable().default(null),
    internalNote: z.string().trim().max(4000).nullable().default(null),
    items: z.array(DevelopQuoteItemInput).min(1).max(100),
    milestones: z.array(DevelopMilestoneInput).min(1).max(10),
  })
  .superRefine((q, ctx) => {
    const sum = q.milestones.reduce((a, m) => a + m.ratioBp, 0);
    if (sum !== 10_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '마일스톤 비율 합이 100% 여야 합니다', path: ['milestones'] });
    }
    if (q.milestones.filter((m) => m.unlocksDeliverables).length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '산출물 해제 마일스톤은 하나만', path: ['milestones'] });
    }
  });
export type AdminDevelopQuoteBodyType = z.infer<typeof AdminDevelopQuoteBody>;

export const AdminDevelopQuoteResponse = z.object({
  result: z.literal(true),
  data: AdminDevelopQuoteView,
});
export type AdminDevelopQuoteResponseType = z.infer<typeof AdminDevelopQuoteResponse>;

export const AdminDevelopMilestoneMarkPaidBody = z.object({ note: z.string().trim().max(500).optional() });
export type AdminDevelopMilestoneMarkPaidBodyType = z.infer<typeof AdminDevelopMilestoneMarkPaidBody>;

// 데이터 없이 성공만 돌려주는 관리자 액션(견적 초안 삭제 · 마일스톤 수동 입금 확인)의 응답.
export const DevelopOkResponse = z.object({ result: z.literal(true) });
export type DevelopOkResponseType = z.infer<typeof DevelopOkResponse>;

// 설정 싱글턴 — 견적 생성 시 복사되는 기본값과 알림 수신자·AI 자동 초안.
export const DevelopMilestonePreset = z.object({
  title: z.string().trim().min(1).max(100),
  ratioBp: z.number().int().min(1).max(10_000),
  trigger: DevelopMilestoneTrigger,
});
// 인건비 기본값(노임 단가표, 2026-11-04) — 설정에서 고치고 편집기 '기본값에서 추가'가 인건비 줄로 **복사**한다
// (나중에 기본값을 고쳐도 이미 만든 견적은 그대로). 직무 → 항목 title · 등급 → grade · 담당 업무 → description ·
// 일일 노임비 → unitPrice(원/일). 설정에 저장한 적이 없으면(null) 아래 처음 값으로 답한다.
export const DEVELOP_LABOR_PRESETS_MAX = 50;
export const DevelopLaborPreset = z.object({
  role: z.string().trim().min(1).max(100), // 직무
  grade: z.string().trim().max(50), // 등급(빈 값 허용)
  task: z.string().trim().max(200), // 담당 업무(빈 값 허용)
  dailyRate: z.number().int().min(0).max(DEVELOP_QUOTE_AMOUNT_MAX), // 일일 노임비(원/일)
});
export type DevelopLaborPresetType = z.infer<typeof DevelopLaborPreset>;
// 처음 값 — 참고 자동견적 HTML 의 예시 5줄(옛 월 단가를 1개월 = 20일로 나눈 예시라 실제 단가는 관리자가 확인해 고친다).
export const DEVELOP_DEFAULT_LABOR_PRESETS: readonly DevelopLaborPresetType[] = [
  { role: 'PM', grade: '특급', task: '시스템 설계', dailyRate: 400_000 },
  { role: '회로개발자', grade: '고급', task: 'RF 및 디지털 회로', dailyRate: 350_000 },
  { role: 'PCB설계자', grade: '고급', task: 'MLB, RF PCB 설계', dailyRate: 150_000 },
  { role: '펌웨어', grade: '중급', task: '기본 구동 드라이버', dailyRate: 325_000 },
  { role: 'QC', grade: '중급', task: '디버깅 테스트', dailyRate: 225_000 },
];

export const AdminDevelopSettings = z.object({
  defaultTerms: z.string().max(20000),
  defaultExclusions: z.string().max(4000),
  defaultWarrantyDays: z.number().int().min(0).max(3650),
  defaultReviewDays: z.number().int().min(1).max(90),
  defaultValidDays: z.number().int().min(1).max(365),
  defaultVatMode: DevelopVatMode,
  // 견적 산출 내역 가산율 기본값(bp) — 새 견적이 복사한다(참고 견적서 표기: 간접비 15% · 일반관리비 5% · 기업이윤 10%).
  defaultIndirectBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP),
  defaultOverheadBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP),
  defaultProfitBp: z.number().int().min(0).max(DEVELOP_QUOTE_RATE_MAX_BP),
  laborPresets: z.array(DevelopLaborPreset).max(DEVELOP_LABOR_PRESETS_MAX),
  defaultMilestones: z.array(DevelopMilestonePreset).min(1).max(10),
  notifyEmails: z.array(z.string().trim().email()).max(20),
  aiAutoDraft: z.boolean(),
  aiDiagramAutoDraft: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AdminDevelopSettingsType = z.infer<typeof AdminDevelopSettings>;

export const AdminDevelopSettingsResponse = z.object({ result: z.literal(true), data: AdminDevelopSettings });
export type AdminDevelopSettingsResponseType = z.infer<typeof AdminDevelopSettingsResponse>;

export const AdminDevelopSettingsUpdate = AdminDevelopSettings.omit({ updatedAt: true })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' });
export type AdminDevelopSettingsUpdateType = z.infer<typeof AdminDevelopSettingsUpdate>;

// 표준 조건 기본 문구 — 설정이 비어 있을 때 견적 생성이 복사한다(관리자가 설정 화면에서 바꾼다).
export const DEVELOP_DEFAULT_TERMS = [
  '1. 산출물(회로도·거버·BOM·펌웨어 소스·앱/서버 소스·문서)의 소유권은 잔금 입금과 동시에 의뢰자에게 이관됩니다.',
  '2. 하자보수는 납품 후 견적서에 적힌 기간 동안 무상으로 제공하며, 요구사항 변경에 따른 수정은 별도 견적입니다.',
  '3. 개발 범위·사양의 변경은 추가 견적서로 합의한 뒤 진행합니다.',
  '4. 착수 후 의뢰자 사유로 취소하는 경우 착수금은 반환되지 않으며, 진행분에 대한 비용이 정산될 수 있습니다.',
  '5. 검수 기간 안에 의견이 없으면 납품이 확정된 것으로 봅니다.',
  '6. 견적서 직접비에 적지 않은 PCB 제작·부품 구매·인증 시험 등 실비는 본 견적에 포함되지 않으며 별도 안내합니다.',
].join('\n');

// 2026-11-04 — PCB 제작·재료비·SMT 를 견적서 직접비로 넣을 수 있게 되어 '별도 실비'는 직접비에 적지 않은 것만 안내한다.
export const DEVELOP_DEFAULT_EXCLUSIONS = '견적서 직접비에 적지 않은 PCB 제작비 · 부품 구매비 · SMT/조립비 · 인증(KC·CE 등) 시험비 · 양산 비용은 별도이며, 당사 PCB/부품 주문으로 진행할 수 있습니다.';

// ── 검토서 버전 원장(docs/DEVELOP_FLOW.md §6.2) ─────────────────────────────────
// 3층(초안·작업본·공개본)은 현재 포인터, 원장은 이력. AI 초안 완성·관리자 저장·공개의 세 순간에 한 판씩.
export const DEVELOP_REVIEW_VERSION_KINDS = ['ai_draft', 'working', 'published'] as const;
export type DevelopReviewVersionKindType = (typeof DEVELOP_REVIEW_VERSION_KINDS)[number];
export const DevelopReviewVersionKind = z.enum(DEVELOP_REVIEW_VERSION_KINDS);
export const DEVELOP_REVIEW_VERSION_KIND_LABELS = {
  ai_draft: 'AI 초안',
  working: '작업본',
  published: '공개',
} as const satisfies Record<DevelopReviewVersionKindType, string>;

// 목록 행 — 본문 JSON 은 싣지 않는다(가볍게). 본문은 단건 조회.
export const DevelopReviewVersionMeta = z.object({
  seq: z.number().int(),
  kind: DevelopReviewVersionKind,
  author: z.string(), // ai_draft=모델명, 그 외=관리자 mbId
  model: z.string(), // review.meta.model
  jobId: z.string().nullable(),
  parentSeq: z.number().int().nullable(), // 복원 원본
  note: z.string().nullable(),
  contentHash: z.string(),
  createdAt: z.string(),
  summary: z.string(), // review.summary 앞 80자
  counts: z.object({ requirements: z.number().int(), questions: z.number().int(), phases: z.number().int() }),
});
export type DevelopReviewVersionMetaType = z.infer<typeof DevelopReviewVersionMeta>;

export const AdminDevelopReviewVersionListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(DevelopReviewVersionMeta), // 최신 먼저
    // 현재 3층 JSON 과 contentHash 가 같은 가장 최근 버전 — 화면의 "지금 초안/작업본/공개" 배지 근거
    current: z.object({
      draftSeq: z.number().int().nullable(),
      workingSeq: z.number().int().nullable(),
      publicSeq: z.number().int().nullable(),
    }),
  }),
});
export type AdminDevelopReviewVersionListResponseType = z.infer<typeof AdminDevelopReviewVersionListResponse>;

export const AdminDevelopReviewVersionResponse = z.object({
  result: z.literal(true),
  data: z.object({ meta: DevelopReviewVersionMeta, review: MarketDevReview }),
});
export type AdminDevelopReviewVersionResponseType = z.infer<typeof AdminDevelopReviewVersionResponse>;
