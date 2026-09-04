import { z } from 'zod';
import { MarketBudgetRange, MarketContractPayment, MarketFileMeta } from './market';
import {
  EMPTY_MARKET_TOOLS,
  MarketAnswers,
  MarketAreaCodeLoose,
  MarketAreaCodes,
  MarketTools,
  marketAnswerIssues,
  marketToolIssues,
} from './market-areas';
import { MarketDevReview } from './market-dev-review';
import { MARKET_DEV_DIAGRAM_STATUSES, MarketDevDiagram } from './market-dev-diagram';

// ── 개발의뢰(sp-develop) 계약 — 정본 docs/DEVELOP_FLOW.md ───────────────────────────
// 의뢰자 ↔ 샘플피씨비 직접 개발 용역. 마켓(market.ts)과 **테이블·상태 어휘가 다르다**(전문가·입찰·공개 목록 없음,
// 관리자가 AI 를 돌리고 항목별 견적을 낸다). 분야·질문·툴·첨부 슬롯·검토서·구성도 JSON 은 마켓 레지스트리를 그대로 쓴다.
// 라벨 정본은 이 파일(DEVELOP_*_LABELS) — sp-develop·sp-vue·sp-node 메일 빌더가 공유한다.

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
const developEditableShape = {
  title: z.string().trim().min(2).max(200),
  serviceAreas: MarketAreaCodes,
  tools: MarketTools.default(EMPTY_MARKET_TOOLS),
  description: z.string().trim().min(10).max(20000),
  answers: MarketAnswers.default([]),
  budgetRange: MarketBudgetRange,
  ndaWanted: z.boolean().default(false), // 비밀유지 계약 희망 — 당사가 NDA 문서를 준비한다(오프라인)
} as const;

export const DevelopRequestCreatePayload = z
  .object({
    ...developEditableShape,
    // 참고 자료가 외부 LLM 으로 나간다 — 미동의면 관리자 AI 버튼이 잠긴다(사유 표시).
    aiConsent: z.boolean().default(false),
    contact: DevelopContact,
  })
  .superRefine((p, ctx) => {
    for (const issue of marketAnswerIssues(p.answers, p.serviceAreas)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['answers'] });
    }
    for (const issue of marketToolIssues(p.tools)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ['tools'] });
    }
  });
export type DevelopRequestCreatePayloadType = z.infer<typeof DevelopRequestCreatePayload>;

// 수정 — received·reviewing 에서만(409 NOT_EDITABLE). 바뀐 필드는 이벤트 `edited` 로 남고 AI 초안은 stale 배지.
export const DevelopRequestUpdateBody = z
  .object({
    title: developEditableShape.title,
    serviceAreas: developEditableShape.serviceAreas,
    tools: MarketTools,
    description: developEditableShape.description,
    answers: MarketAnswers,
    budgetRange: developEditableShape.budgetRange,
    ndaWanted: z.boolean(),
    contact: DevelopContact,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: '최소 한 개 필드가 필요합니다' });
export type DevelopRequestUpdateBodyType = z.infer<typeof DevelopRequestUpdateBody>;

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
  serviceAreas: z.array(MarketAreaCodeLoose),
  status: DevelopRequestStatus,
  budgetRange: MarketBudgetRange,
  createdAt: z.string(),
  updatedAt: z.string(),
  // 고객이 지금 할 일 — 서버 파생(견적 검토 · 결제 · 검수 · 확인 요청 답변). 없으면 null.
  nextAction: z.enum(['review_quote', 'pay', 'inspect', 'answer_review']).nullable(),
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

export const DevelopRequestDetail = DevelopRequestListItem.extend({
  description: z.string(),
  tools: MarketTools,
  answers: MarketAnswers,
  contact: DevelopContact,
  ndaWanted: z.boolean(),
  aiConsent: z.boolean(),
  files: z.array(DevelopFileMeta), // 의뢰 첨부(참고 자료·슬롯)
  review: MarketDevReview.nullable(), // **공개본만**
  reviewPublishedAt: z.string().nullable(),
  diagram: DevelopPublicDiagram.nullable(), // **공개본만**
  quotes: z.array(DevelopQuoteView), // draft 제외
  events: z.array(DevelopEventView), // visibleToCustomer 만
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
} as const satisfies Record<DevelopAdminTabType, string>;

export const AdminDevelopRequestListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: DevelopAdminTab.default('all'),
  q: z.string().trim().max(100).optional(), // 제목·의뢰인 mbId·연락처 이름·회사 contains
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

export const AdminDevelopRequestListItem = z.object({
  requestId: z.number(),
  title: z.string(),
  serviceAreas: z.array(MarketAreaCodeLoose),
  status: DevelopRequestStatus,
  budgetRange: MarketBudgetRange,
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
});
export type AdminDevelopRequestListItemType = z.infer<typeof AdminDevelopRequestListItem>;

export const AdminDevelopRequestListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminDevelopRequestListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminDevelopRequestCounts,
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
export const AdminDevelopReviewPutBody = z.object({ review: MarketDevReview });
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
