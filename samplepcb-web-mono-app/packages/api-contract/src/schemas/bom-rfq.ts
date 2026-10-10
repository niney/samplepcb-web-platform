import { z } from 'zod';
import { BomQuoteCandidateOffer } from './bom-quote';

// ── 스마트 BOM 협력사 RFQ — sp_bom_rfq* 계약 ────────────────────────────────
// 설계 정본: docs/SMARTBOM_PARTNER_RFQ.md §2. quote.status(굵은 단계)와 별개의
// 하위 상태 계층 — 같은 문자열을 겹쳐 쓰지 않는다(레거시 상태 3종 혼동 회피).
// 사람 협력사 전용 — 공급사 시세는 후보/구매 조건 원장 파생(RFQ 행 미물질화, D6).

export const BOM_RFQ_STATUSES = ['requested', 'quoted', 'closed'] as const;
export type BomRfqStatusType = (typeof BOM_RFQ_STATUSES)[number];
export const BomRfqStatus = z.enum(BOM_RFQ_STATUSES);

export const BOM_RFQ_STATUS_LABELS = {
  requested: '회신 대기',
  quoted: '회신 완료',
  closed: '마감',
} as const satisfies Record<BomRfqStatusType, string>;

// 회신 행 출처 — manual(포털 회신/관리자 대리 입력, 자동 동기화 불가침)|api(하이브리드 예약).
export const BOM_RFQ_ITEM_SOURCES = ['manual', 'api'] as const;
export type BomRfqItemSourceType = (typeof BOM_RFQ_ITEM_SOURCES)[number];
export const BomRfqItemSource = z.enum(BOM_RFQ_ITEM_SOURCES);

// ── 회신 입력(협력사 포털 저장 · 관리자 대리 입력 공용) ─────────────────────
// PUT = 문서 단위 replace-all(행 일괄). 단가 없는 행은 보내지 않는다(= 미회신).
// 합계(totalAmount)는 서버가 단가 × max(회신수량 ?? 주문수량, MOQ) 으로 재계산해 박제한다
// (`effectiveRfqReplyQty`, §6.38). 회신수량 < MOQ 는 모순이라 입력 단계에서 거부한다.

export const BomRfqItemReplyInput = z
  .object({
    quoteItemId: z.string().regex(/^\d+$/),
    unitPrice: z.number().nonnegative(),
    replyQty: z.number().int().positive().nullable(),
    moq: z.number().int().positive().nullable(),
    stock: z.number().int().nonnegative().nullable(),
    dateCode: z.string().trim().max(100).nullable(),
    leadTime: z.string().trim().max(64).nullable(),
    memo: z.string().trim().max(500).nullable(),
    /**
     * 마스터딜러 전용 — 이 품목을 맡길 하위의 견적요청(내가 보낸 재요청). 주면 단가는 서버가
     * 하위 회신가 × 환율 × (1 + 마진%) 로 산출하고 unitPrice 입력은 무시한다. 일반 협력사·매직링크
     * 회신에서는 받지 않는다.
     */
    childRfqId: z.number().int().positive().nullable().optional(),
    /** 하위 회신가에 얹는 마진(%) — childRfqId 와 함께 준다. */
    marginRate: z.number().min(0).max(1000).nullable().optional(),
  })
  .refine((item) => item.replyQty === null || item.moq === null || item.replyQty >= item.moq, {
    message: '회신수량은 MOQ 이상이어야 합니다.',
    path: ['replyQty'],
  });
export type BomRfqItemReplyInputType = z.infer<typeof BomRfqItemReplyInput>;

export const BomRfqReplyBody = z.object({
  items: z.array(BomRfqItemReplyInput).max(500),
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(), // 회신 납기(KST 해석)
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type BomRfqReplyBodyType = z.infer<typeof BomRfqReplyBody>;

// ── 협력사 외화 회신 — 결제통화와 견적 고정 환율 ────────────────────────────
// 협력사는 자기 결제통화(링크 통화: KRW|USD|CNY)로 단가만 회신한다. 원화 환산은 견적마다 한 번
// 고정한 환율을 쓴다(docs/SMARTBOM_PARTNER_RFQ.md "외화 회신") — 한 견적 안에서 공급사 가격과
// 협력사 회신이 같은 환율로 비교되고, 고르는 날에 따라 값이 달라지지 않는다.
export const BOM_PARTNER_CURRENCIES = ['KRW', 'USD', 'CNY'] as const;
export type BomPartnerCurrencyType = (typeof BOM_PARTNER_CURRENCIES)[number];
export const BOM_PARTNER_FX_CURRENCIES = ['USD', 'CNY'] as const;
export type BomPartnerFxCurrencyType = (typeof BOM_PARTNER_FX_CURRENCIES)[number];

export const BomPartnerFxRate = z.object({
  /** 고객가 환산에 쓰는 환율(결제통화→KRW) — 안전 마진이 얹힌 값. */
  rate: z.number().positive(),
  /** 마진을 얹기 전 고시(또는 입력) 환율. */
  sourceRate: z.number().positive(),
  safetyMarginPercent: z.number().min(0),
  /** quote-usd = 견적이 공급사 달러 가격에 쓰는 환율을 그대로 따름 · koreaexim = 고시 환율 · manual = 관리자 입력. */
  source: z.enum(['quote-usd', 'koreaexim', 'manual']),
  rateDate: z.string().nullable(),
  frozenAt: z.string(),
});
export type BomPartnerFxRateType = z.infer<typeof BomPartnerFxRate>;

export const BomPartnerFxRates = z.object({
  USD: BomPartnerFxRate.nullable(),
  CNY: BomPartnerFxRate.nullable(),
});
export type BomPartnerFxRatesType = z.infer<typeof BomPartnerFxRates>;

// 관리자 환율 입력 — 고시 환율을 못 가져왔거나 다른 값으로 고정하고 싶을 때. 이미 그 통화로
// 선정된 품목은 새 환율로 다시 환산한다(견적 안의 환율은 통화마다 하나).
export const AdminBomPartnerFxBody = z.object({
  currency: z.enum(BOM_PARTNER_FX_CURRENCIES),
  rate: z.number().positive().max(100_000),
});
export type AdminBomPartnerFxBodyType = z.infer<typeof AdminBomPartnerFxBody>;

// ── 마스터딜러 중개(견적 단계) — docs/SMARTBOM_PARTNER_RFQ.md "마스터딜러 중개" ──
// 마스터딜러는 받은 견적요청을 하위 협력사에 재요청하고, 품목마다 하위 회신을 골라 마진을 얹어
// 자기 회신으로 올린다. 변환점(하위 통화 → 내 통화, 마진)은 그 품목의 회신 행에 남는다.
export const BomRfqChildSelection = z.object({
  /** 고른 하위의 견적요청 문서(품목은 같은 quoteItemId). */
  childRfqId: z.number(),
  childPartnerId: z.number(),
  childPartnerName: z.string(),
  marginRate: z.number(),
  /** 선정한 순간의 하위 회신가·통화·환율(하위 통화 → 내 결제통화). */
  sourceCurrency: z.string(),
  sourceUnitPrice: z.number(),
  sourceRate: z.number(),
  /** 선정 뒤 하위가 다시 회신해 단가가 달라졌다(또는 회신을 거뒀다) — 다시 골라야 반영된다. */
  stale: z.boolean(),
});
export type BomRfqChildSelectionType = z.infer<typeof BomRfqChildSelection>;

// ── 관리자: RFQ 발송·현황 (/api/admin/bom-quotes/:id/rfqs) ──────────────────

export const AdminBomRfqItemView = z.object({
  rfqItemId: z.number(),
  quoteItemId: z.string(),
  source: BomRfqItemSource,
  unitPrice: z.number().nullable(),
  currency: z.string(),
  /** 견적 고정 환율로 환산한 원화 단가 — 비교·선정의 기준. 환율이 아직 없으면 null. */
  unitPriceKrw: z.number().nullable().default(null),
  replyQty: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  memo: z.string().nullable(),
  /** 마스터딜러가 하위 회신을 골라 만든 행이면 그 근거. 직접 회신은 null. */
  childSelection: BomRfqChildSelection.nullable().default(null),
  updatedAt: z.string(),
});
export type AdminBomRfqItemViewType = z.infer<typeof AdminBomRfqItemView>;

/** 마스터딜러가 하위에 보낸 재요청 한 건 — 마스터딜러 포털과 관리자 Case 가 같이 본다. */
export const BomRfqChildItemView = z.object({
  rfqItemId: z.number(),
  quoteItemId: z.string(),
  unitPrice: z.number(),
  /** 상위(마스터딜러) 결제통화로 환산한 단가 — 지금 환율의 참고값. 선정하면 그 순간 값으로 굳는다. */
  unitPriceInParent: z.number().nullable(),
  replyQty: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  memo: z.string().nullable(),
});
export type BomRfqChildItemViewType = z.infer<typeof BomRfqChildItemView>;

export const BomRfqChildView = z.object({
  rfqId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  status: BomRfqStatus,
  /** 링크 통화(마스터딜러↔하위) — 하위는 이 통화로 회신한다. */
  currency: z.string(),
  /**
   * 하위 통화 → 상위(마스터딜러) 통화의 지금 환율. 화면 미리보기는 이 값으로 서버와 같은 식
   * (회신가 × 환율 × (1+마진), 끝에서 한 번 반올림)을 쓴다 — 환산 단가(unitPriceInParent)에 마진을
   * 곱하면 반올림이 두 번 들어가 작은 단가에서 어긋난다. 환율을 못 구했으면 null.
   */
  rateToParent: z.number().nullable().default(null),
  totalAmount: z.number().nullable(),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  repliedItemCount: z.number().int(),
  requestedItemIds: z.array(z.string()).nullable(),
  /** 계정 없는 하위는 매직링크로 회신한다 — 마스터딜러가 직접 전달할 수 있게 내준다. */
  magicToken: z.string().nullable(),
  hasPortalAccount: z.boolean(),
  items: z.array(BomRfqChildItemView),
});
export type BomRfqChildViewType = z.infer<typeof BomRfqChildView>;

export const AdminBomRfqView = z.object({
  rfqId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  status: BomRfqStatus,
  /** 회신 합계 — **결제통화** 금액(currency). */
  totalAmount: z.number().nullable(),
  currency: z.string(),
  /** 견적 고정 환율로 환산한 원화 합계 — 원화 회신이면 totalAmount 와 같다. 환율이 없으면 null. */
  totalAmountKrw: z.number().nullable().default(null),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  repliedItemCount: z.number().int(),
  /** 매직링크 토큰(§6.9) — [링크 복사]용. 구 데이터(발급 전)는 null → [재발급]으로 소급. */
  magicToken: z.string().nullable(),
  /** 부분 행 선택(§6.13) — 요청 부품행 id. null=전체(비교 모달 미요청 칸 구분용). */
  requestedItemIds: z.array(z.string()).nullable(),
  items: z.array(AdminBomRfqItemView),
  /** 이 협력사가 마스터딜러로서 하위에 보낸 재요청 — 관리자는 전부 본다(없으면 빈 배열). */
  children: z.array(BomRfqChildView).default([]),
});
export type AdminBomRfqViewType = z.infer<typeof AdminBomRfqView>;

export const AdminBomRfqListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    rfqs: z.array(AdminBomRfqView),
    /** 협력사 회신이 없어도 3사 시세 비교를 시작할 수 있는 선정 부품 수. */
    supplierComparisonTargetCount: z.number().int().nonnegative(),
    /** 이 견적에 고정된 협력사 외화 환율(통화별, 없으면 null). */
    partnerFx: BomPartnerFxRates.default({ USD: null, CNY: null }),
  }),
});
export type AdminBomRfqListResponseType = z.infer<typeof AdminBomRfqListResponse>;

// diff 발송 — 선택 협력사 집합으로 수렴: 빠진 미회신(requested) 문서만 삭제, 회신
// (quoted) 문서는 보존, 신규만 생성·메일. 재발송해도 유지분은 건드리지 않는다(§2.4).
export const AdminBomRfqSendBody = z.object({
  /** 0곳 허용 — 전부 해제 발송 = 미회신(requested) RFQ 전부 회수(quoted 는 보존). */
  partnerIds: z.array(z.number().int().positive()).max(50),
  /** 부분 행 선택(§6.13) — 요청 부품행 id. 생략=전체. 이번에 새로 생성되는 RFQ 에만
   * 적용된다(유지분의 기존 세트는 불변 — diff 보존 규칙 동일). 예외는 expandPartnerIds. */
  itemIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500).optional(),
  /** 행 추가(§6.13 개정) — 이미 보낸 **미회신** 요청에 이번 행(itemIds, 생략=전체)을 더할 협력사.
   * 줄이지는 않는다(합집합). partnerIds 안에 있어야 하고, 회신한 요청이면 409. */
  expandPartnerIds: z.array(z.number().int().positive()).max(50).optional(),
});
export type AdminBomRfqSendBodyType = z.infer<typeof AdminBomRfqSendBody>;

export const AdminBomRfqSendResponse = z.object({
  result: z.literal(true),
  data: z.object({
    added: z.number().int(),
    kept: z.number().int(),
    removed: z.number().int(),
    /** 행이 실제로 더해진 기존 요청 수(더할 행이 없던 곳은 세지 않는다). */
    expanded: z.number().int(),
    rfqs: z.array(AdminBomRfqView),
  }),
});
export type AdminBomRfqSendResponseType = z.infer<typeof AdminBomRfqSendResponse>;

export const AdminBomRfqReplyResponse = z.object({
  result: z.literal(true),
  data: AdminBomRfqView,
});
export type AdminBomRfqReplyResponseType = z.infer<typeof AdminBomRfqReplyResponse>;

// 행별 공급사 선정 — 사람 협력사 회신과 선정 MPN API 공급사 구매조건을
// 같은 비교 표에서 선정한다. 가격·합계는 클라이언트 값을 받지 않고 서버 스냅샷으로
// 재계산한다(snapshot-freeze). partner의 rfqItemId=null 은 기존 선정 해제 호환.
export const AdminBomRfqPartnerSelection = z.object({
  kind: z.literal('partner'),
  itemId: z.string().regex(/^\d+$/),
  rfqItemId: z.number().int().positive().nullable(),
});

export const AdminBomRfqSupplierSelection = z.object({
  kind: z.literal('supplier'),
  itemId: z.string().regex(/^\d+$/),
  candidateKey: z.string().min(1).max(64),
  offerKey: z.string().min(1).max(64),
});

export const AdminBomRfqSelectionBody = z.discriminatedUnion('kind', [
  AdminBomRfqPartnerSelection,
  AdminBomRfqSupplierSelection,
]);
export type AdminBomRfqSelectionBodyType = z.infer<typeof AdminBomRfqSelectionBody>;

export const AdminBomRfqSelectionResponse = z.object({ result: z.literal(true) });
export type AdminBomRfqSelectionResponseType = z.infer<typeof AdminBomRfqSelectionResponse>;

// ── 관리자 회신 비교용 선정 부품 MPN 공급사 강제 최신조회 ──────────

export const ADMIN_BOM_LIVE_SUPPLIERS = ['digikey', 'mouser', 'unikeyic'] as const;
export const AdminBomLiveSupplier = z.enum(ADMIN_BOM_LIVE_SUPPLIERS);
export type AdminBomLiveSupplierType = z.infer<typeof AdminBomLiveSupplier>;

export const AdminBomSupplierRefreshStatus = z.enum([
  'idle',
  'running',
  'completed',
  'failed',
]);
export type AdminBomSupplierRefreshStatusType = z.infer<
  typeof AdminBomSupplierRefreshStatus
>;

export const AdminBomSupplierAttemptOutcome = z.enum([
  'pending',
  'results',
  'partial_error',
  'empty',
  'error',
  'skipped',
]);
export type AdminBomSupplierAttemptOutcomeType = z.infer<
  typeof AdminBomSupplierAttemptOutcome
>;

export const AdminBomSupplierAttemptSummary = z.object({
  supplier: AdminBomLiveSupplier,
  outcome: AdminBomSupplierAttemptOutcome,
  apiCalls: z.number().int().nonnegative(),
  resultCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
});
export type AdminBomSupplierAttemptSummaryType = z.infer<
  typeof AdminBomSupplierAttemptSummary
>;

export const AdminBomSupplierComparisonOffer = z.object({
  candidateKey: z.string(),
  candidateMpn: z.string(),
  candidateManufacturerName: z.string().nullable(),
  candidateManualSelectable: z.boolean(),
  offer: BomQuoteCandidateOffer,
});
export type AdminBomSupplierComparisonOfferType = z.infer<
  typeof AdminBomSupplierComparisonOffer
>;

export const AdminBomSupplierComparisonRow = z.object({
  itemId: z.string().regex(/^\d+$/),
  offers: z.array(AdminBomSupplierComparisonOffer),
});
export type AdminBomSupplierComparisonRowType = z.infer<
  typeof AdminBomSupplierComparisonRow
>;

export const AdminBomSupplierRefreshView = z.object({
  runId: z.string().regex(/^\d+$/).nullable(),
  status: AdminBomSupplierRefreshStatus,
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  error: z.string().nullable(),
  selectedItemCount: z.number().int().nonnegative(),
  suppliers: z.array(AdminBomSupplierAttemptSummary),
  rows: z.array(AdminBomSupplierComparisonRow),
});
export type AdminBomSupplierRefreshViewType = z.infer<
  typeof AdminBomSupplierRefreshView
>;

export const AdminBomSupplierRefreshResponse = z.object({
  result: z.literal(true),
  data: AdminBomSupplierRefreshView,
});
export type AdminBomSupplierRefreshResponseType = z.infer<
  typeof AdminBomSupplierRefreshResponse
>;

// ── 협력사 포털 (/api/partner/rfqs, requirePartner) ─────────────────────────
// 노출 범위: 부품행(MPN·제조사·설명·필요수량)과 자신의 회신뿐 — 고객 식별정보·목표
// 단가(현재 선정 단가)는 구조적으로 스키마에 없다(D8).

export const PartnerRfqListItem = z.object({
  rfqId: z.number(),
  quoteTitle: z.string(),
  status: BomRfqStatus,
  itemCount: z.number().int(), // 요청 부품행 수(견적의 included 행 파생)
  repliedItemCount: z.number().int(),
  totalAmount: z.number().nullable(),
  currency: z.string(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  /** 누가 요청했나 — 마스터딜러가 보낸 재요청이면 그 조직명, 샘플피씨비 직접 요청이면 null. */
  requesterName: z.string().nullable().default(null),
  /** 내가 마스터딜러로서 이 건으로 하위에 보낸 재요청 수 · 그중 회신 온 수. */
  childRfqCount: z.number().int().default(0),
  childRepliedCount: z.number().int().default(0),
});
export type PartnerRfqListItemType = z.infer<typeof PartnerRfqListItem>;

export const PartnerRfqListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PartnerRfqListItem), partnerName: z.string() }),
});
export type PartnerRfqListResponseType = z.infer<typeof PartnerRfqListResponse>;

export const PartnerRfqLineItem = z.object({
  quoteItemId: z.string(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  orderQty: z.number().int(), // 필요수량(주문수량 정본)
  reply: AdminBomRfqItemView.pick({
    unitPrice: true,
    replyQty: true,
    moq: true,
    stock: true,
    dateCode: true,
    leadTime: true,
    memo: true,
    childSelection: true,
  }).nullable(),
  /**
   * 이 협력사가 올려 둔 보유 부품과 같은 품번일 때의 자기 원장 값(docs/PARTNER_PARTS.md).
   * 회신 폼 프리필 **제안**일 뿐 저장값이 아니다 — 회신은 사람이 확정한다.
   * 포털·매직링크 공용이며 다른 협력사의 값은 절대 들어가지 않는다.
   */
  myStock: z
    .object({
      stockQty: z.number().int().nullable(),
      dateCode: z.string().nullable(),
      leadTime: z.string().nullable(),
      unitPrice: z.number().nullable(),
      currency: z.string().nullable(),
      moq: z.number().int().nullable(),
      uploadedAt: z.string(),
    })
    .nullable()
    .optional(),
});
export type PartnerRfqLineItemType = z.infer<typeof PartnerRfqLineItem>;

export const PartnerRfqDetail = z.object({
  rfqId: z.number(),
  quoteTitle: z.string(),
  status: BomRfqStatus,
  currency: z.string(),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  totalAmount: z.number().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  items: z.array(PartnerRfqLineItem),
  /** 누가 요청했나 — 마스터딜러가 보낸 재요청이면 그 조직명, 샘플피씨비 직접 요청이면 null. */
  requesterName: z.string().nullable().default(null),
  /** 이 견적요청을 하위 협력사에 재요청할 수 있다(내가 마스터딜러이고 샘플피씨비가 직접 보낸 건). */
  canFanOut: z.boolean().default(false),
});
export type PartnerRfqDetailType = z.infer<typeof PartnerRfqDetail>;

// ── 마스터딜러 포털: 하위 재요청 (/api/partner/rfqs/:rfqId/children) ─────────
export const PartnerRfqChildCandidate = z.object({
  partnerId: z.number(),
  name: z.string(),
  /** 링크 통화 — 이 하위는 이 통화로 회신한다. */
  currency: z.string(),
  contactEmail: z.string().nullable(),
  hasPortalAccount: z.boolean(),
});
export type PartnerRfqChildCandidateType = z.infer<typeof PartnerRfqChildCandidate>;

export const PartnerRfqChildrenData = z.object({
  /** 내 결제통화 — 하위 회신가는 이 통화로 환산해 비교한다. */
  myCurrency: z.string(),
  /** 재요청을 보낼 수 있는 내 하위(승인·부품 조달 트랙). */
  candidates: z.array(PartnerRfqChildCandidate),
  rfqs: z.array(BomRfqChildView),
});
export type PartnerRfqChildrenDataType = z.infer<typeof PartnerRfqChildrenData>;

export const PartnerRfqChildrenResponse = z.object({
  result: z.literal(true),
  data: PartnerRfqChildrenData,
});
export type PartnerRfqChildrenResponseType = z.infer<typeof PartnerRfqChildrenResponse>;

// diff 발송 — 관리자 발송과 같은 규칙(빠진 미회신만 회수, 회신 온 문서는 보존, 신규만 메일).
// requestedItemIds 는 내가 받은 범위의 부분집합만(생략하면 내가 받은 범위 전체).
export const PartnerRfqChildrenSendBody = z.object({
  partnerIds: z.array(z.number().int().positive()).max(50),
  requestedItemIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500).nullable().optional(),
});
export type PartnerRfqChildrenSendBodyType = z.infer<typeof PartnerRfqChildrenSendBody>;

export const PartnerRfqChildrenSendResponse = z.object({
  result: z.literal(true),
  data: PartnerRfqChildrenData.extend({
    added: z.number().int(),
    kept: z.number().int(),
    removed: z.number().int(),
  }),
});
export type PartnerRfqChildrenSendResponseType = z.infer<typeof PartnerRfqChildrenSendResponse>;

export const PartnerRfqDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerRfqDetail,
});
export type PartnerRfqDetailResponseType = z.infer<typeof PartnerRfqDetailResponse>;

// ── 매직링크 무로그인 회신(§6.9) — 메일함 소유 = 신원, 권한은 RFQ 1건 스코프 ──
// 상세는 포털 DTO 재사용(고객 정보 없음이 이미 보장) + 인사용 협력사명만 추가.
export const MagicRfqResponse = z.object({
  result: z.literal(true),
  data: z.object({
    partnerName: z.string(),
    rfq: PartnerRfqDetail,
  }),
});
export type MagicRfqResponseType = z.infer<typeof MagicRfqResponse>;
