import { z } from 'zod';
import { MarketContractPayment, MarketFileMeta } from './market';
import { EMPTY_MARKET_TOOLS, MarketAnswers, MarketAreaCodeLoose, MarketTools } from './market-areas';
import {
  DEVELOP_INDIVIDUAL_AREA_CODES,
  DEVELOP_SYSTEM_AREA_CODES,
  developAnswerIssues,
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
// 의뢰 방식 — 시스템개발(전 분야 통합, 회로·펌웨어 포함) / 개별 견적(PCB·기구·앱·서버 복수).
export const DEVELOP_REQUEST_MODES = ['system', 'individual'] as const;
export type DevelopRequestModeType = (typeof DEVELOP_REQUEST_MODES)[number];
export const DevelopRequestMode = z.enum(DEVELOP_REQUEST_MODES);
export const DEVELOP_REQUEST_MODE_LABELS = {
  system: '시스템개발',
  individual: '개별 견적',
} as const satisfies Record<DevelopRequestModeType, string>;

// 예산 구간 — 마켓 사전(500만 단위)과 분리(개발 용역 실무 구간). 저장은 코드.
export const DEVELOP_BUDGET_RANGES = ['under1000', 'r1000_3000', 'r3000_5000', 'r5000_10000', 'over10000', 'after_quote'] as const;
export type DevelopBudgetRangeType = (typeof DEVELOP_BUDGET_RANGES)[number];
export const DevelopBudgetRange = z.enum(DEVELOP_BUDGET_RANGES);
export const DEVELOP_BUDGET_RANGE_LABELS = {
  under1000: '1천만원 미만',
  r1000_3000: '1천만~3천만원',
  r3000_5000: '3천만~5천만원',
  r5000_10000: '5천만~1억원',
  over10000: '1억원 이상',
  after_quote: '견적 후 결정',
} as const satisfies Record<DevelopBudgetRangeType, string>;

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

// 제작 범위를 하나라도 고르면 조달·납품 형태를 묻는다(프로토타입 "제조 연계 확인"). 아니면 둘 다 null.
export const DevelopProductionPlan = z
  .object({
    prototype: DevelopPrototypeMode,
    prototypeQty: z.number().int().min(1).max(1_000_000).nullable().default(null),
    scopes: z.array(DevelopProductionScope).max(DEVELOP_PRODUCTION_SCOPES.length).default([]),
    annualQty: z.number().int().min(0).max(100_000_000).nullable().default(null),
    priority: DevelopPriority.nullable().default(null),
    sourcing: DevelopSourcingMode.nullable().default(null),
    delivery: DevelopDeliveryForm.nullable().default(null),
  })
  .superRefine((p, ctx) => {
    if (p.prototype === 'count' && p.prototypeQty === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PROTOTYPE_QTY_REQUIRED', path: ['prototypeQty'] });
    }
    if (new Set(p.scopes).size !== p.scopes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'DUPLICATE_SCOPE', path: ['scopes'] });
    }
  });
export type DevelopProductionPlanType = z.infer<typeof DevelopProductionPlan>;
export const EMPTY_DEVELOP_PRODUCTION: DevelopProductionPlanType = {
  prototype: 'undecided',
  prototypeQty: null,
  scopes: [],
  annualQty: null,
  priority: null,
  sourcing: null,
  delivery: null,
};
// 저장 정규화 — count 가 아니면 수량을 비우고, 제작 범위가 없으면 조달·납품 형태를 비운다.
export function normalizeDevelopProduction(p: DevelopProductionPlanType): DevelopProductionPlanType {
  const scopes = [...new Set(p.scopes)];
  return {
    prototype: p.prototype,
    prototypeQty: p.prototype === 'count' ? p.prototypeQty : null,
    scopes,
    annualQty: p.annualQty,
    priority: p.priority,
    sourcing: scopes.length === 0 ? null : p.sourcing,
    delivery: scopes.length === 0 ? null : p.delivery,
  };
}
// 표시용 한 줄 — "시제품 5개 · PCB 제작, SMT·수삽 · 연간 5,000" (검토 카드·관리자·메일이 같은 문자열).
export function developProductionSummary(p: DevelopProductionPlanType | null): string {
  if (p === null) return '';
  const proto =
    p.prototype === 'count'
      ? `시제품 ${p.prototypeQty === null ? '?' : p.prototypeQty.toLocaleString('ko-KR')}개`
      : `시제품 ${DEVELOP_PROTOTYPE_MODE_LABELS[p.prototype]}`;
  const scopes = p.scopes.length === 0 ? '제작 범위 없음' : p.scopes.map((s) => DEVELOP_PRODUCTION_SCOPE_LABELS[s]).join(', ');
  const annual = p.annualQty === null ? null : `연간 ${p.annualQty.toLocaleString('ko-KR')}개`;
  return [proto, scopes, annual].filter((s): s is string => s !== null).join(' · ');
}

// 희망 완료 시기 — 날짜(YYYY-MM-DD) **또는** 자유문("계약 후 3개월") 중 하나 이상.
export const DEVELOP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DevelopWishDate = z.string().regex(DEVELOP_DATE_RE, 'YYYY-MM-DD');
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

// 의뢰 방식에 따른 저장 분야 — 시스템개발은 전 분야, 개별은 고른 것(개별 메뉴 밖 코드는 버린다).
export function resolveDevelopServiceAreas(mode: DevelopRequestModeType, areas: readonly string[]): string[] {
  if (mode === 'system') return [...DEVELOP_SYSTEM_AREA_CODES];
  return sortDevelopAreas(areas).filter((c) => DEVELOP_INDIVIDUAL_AREA_CODES.includes(c));
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
  currentStage: DevelopCurrentStage,
  targetStage: DevelopTargetStage,
  wishDate: DevelopWishDate.nullable().default(null),
  wishNote: z.string().trim().max(200).nullable().default(null),
  budgetRange: DevelopBudgetRange,
  // 시스템개발에서 "전문가에게 맡김" — 3스텝 질문을 건너뛴다(개별 견적에선 언제나 false).
  expertDelegate: z.boolean().default(false),
  production: DevelopProductionPlan,
  ndaWanted: z.boolean().default(false), // 비밀유지 계약 희망 — 당사가 NDA 문서를 준비한다(오프라인)
} as const;
// 시스템개발 AI 후속 질문 답(§7.2.2) — 잡 id + 답. 서버가 잡에서 질문을 되읽어 박제한다. 폴백(고정 3문항)이면 null.
const developAiQuestionsInput = DevelopFollowupAnswersInput.nullable().default(null);

interface DevelopEditableCheck {
  requestMode: DevelopRequestModeType;
  serviceAreas: string[];
  answers: z.infer<typeof MarketAnswers>;
  tools: z.infer<typeof MarketTools>;
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
  const areas = resolveDevelopServiceAreas(p.requestMode, p.serviceAreas);
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
    currentStage: developEditableShape.currentStage,
    targetStage: developEditableShape.targetStage,
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
  title: z.string(),
  description: z.string().nullable(),
  amount: z.number().int(), // 공급가(원)
  durationDays: z.number().int().nullable(),
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

// ── 견적 순수 함수(붙여넣기 파싱·금액 계산·마일스톤 분배) — FE·서버 공유 ─────────────
export interface DevelopQuoteLineParsed {
  title: string;
  amount: number;
}
export interface DevelopQuoteLinesResult {
  items: DevelopQuoteLineParsed[];
  rejected: string[]; // 금액을 못 읽은 줄(그대로 남겨 관리자가 고친다)
}

// `H/W 회로·PCB 설계 3,600,000원` · `펌웨어 320만원` · `Android 앱  2800000` — 줄 끝의 금액 토큰을 뗀다.
// "만원" 단위는 ×10,000. 금액이 없거나 0 이하이면 rejected.
export function parseDevelopQuoteLines(text: string): DevelopQuoteLinesResult {
  const items: DevelopQuoteLineParsed[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, ' ').trim();
    if (line === '') continue;
    const m = /^(.*?)[\s:：\-–—]*([\d][\d,]*)(?:\s*(만\s*원|만|원|KRW|₩))?\s*$/i.exec(line);
    if (m === null) {
      rejected.push(line);
      continue;
    }
    const title = (m[1] ?? '').replace(/[\s:：\-–—]+$/, '').trim();
    const digits = (m[2] ?? '').replace(/,/g, '');
    const unit = (m[3] ?? '').replace(/\s/g, '');
    let amount = Number(digits);
    if (unit === '만원' || unit === '만') amount *= 10_000;
    if (title === '' || !Number.isFinite(amount) || amount <= 0 || amount > 2_000_000_000) {
      rejected.push(line);
      continue;
    }
    items.push({ title, amount: Math.round(amount) });
  }
  return { items, rejected };
}

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
  quotes: z.array(DevelopQuoteView.extend({ internalNote: z.string().nullable() })),
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

export const DevelopQuoteItemInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().default(null),
  amount: z.number().int().min(0).max(2_000_000_000),
  durationDays: z.number().int().positive().max(3650).nullable().default(null),
});
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
  data: DevelopQuoteView.extend({ internalNote: z.string().nullable() }),
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
export const AdminDevelopSettings = z.object({
  defaultTerms: z.string().max(20000),
  defaultExclusions: z.string().max(4000),
  defaultWarrantyDays: z.number().int().min(0).max(3650),
  defaultReviewDays: z.number().int().min(1).max(90),
  defaultValidDays: z.number().int().min(1).max(365),
  defaultVatMode: DevelopVatMode,
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
  '6. PCB 제작·부품 구매·인증 시험 등 실비는 본 견적에 포함되지 않으며 별도 안내합니다.',
].join('\n');

export const DEVELOP_DEFAULT_EXCLUSIONS = 'PCB 제작비 · 부품 구매비 · SMT/조립비 · 인증(KC·CE 등) 시험비 · 양산 비용은 별도이며, 당사 PCB/부품 주문으로 진행할 수 있습니다.';

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
