import { z } from 'zod';

// ── BOM 마스터딜러 하위 발주 · 송금 원장 ─────────────────────────────────────
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §6.43(하위 발주)·§6.44(송금 원장).
//
// 하위 발주 — 마스터딜러가 샘플피씨비에게서 받은 발주서의 품목 가운데 하위 회신으로 견적한 것을
// 그 하위에 다시 발주한다. 샘플피씨비의 발주 원장과는 다른 문서다(물건은 마스터딜러에게 간다).
// 금액은 하위 통화가 정본이고, 단가는 마스터딜러가 하위 회신을 고를 때 굳힌 값이다.

export const BOM_MD_PO_STATUSES = ['issued', 'confirmed', 'shipped', 'received'] as const;
export type BomMdPoStatusType = (typeof BOM_MD_PO_STATUSES)[number];
export const BomMdPoStatus = z.enum(BOM_MD_PO_STATUSES);

/** 표시 라벨 — 화면·메일 공용. */
export const BOM_MD_PO_STATUS_LABELS: Record<BomMdPoStatusType, string> = {
  issued: '확인 대기',
  confirmed: '확인됨',
  shipped: '출고됨',
  received: '수령 완료',
};

export const BomMdPoItemView = z.object({
  itemId: z.number(),
  /** 상위 발주서(샘플피씨비 → 마스터딜러)의 품목. */
  poItemId: z.number(),
  quoteItemId: z.string(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  qty: z.number().int(),
  unitPrice: z.number(),
  lineTotal: z.number(),
  moq: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
});
export type BomMdPoItemViewType = z.infer<typeof BomMdPoItemView>;

export const BomMdPoView = z.object({
  mdPoId: z.number(),
  poId: z.number(),
  quoteTitle: z.string(),
  /** 발주처(마스터딜러). */
  parentPartnerId: z.number(),
  parentPartnerName: z.string(),
  /** 수주처(하위 협력사). */
  partnerId: z.number(),
  partnerName: z.string(),
  /** 하위에 포털 계정이 없으면 확인·출고는 마스터딜러가 대신 처리한다. */
  hasPortalAccount: z.boolean(),
  status: BomMdPoStatus,
  currency: z.string(),
  totalAmount: z.number(),
  memo: z.string().nullable(),
  carrier: z.string().nullable(),
  trackingNo: z.string().nullable(),
  issuedAt: z.string(),
  confirmedAt: z.string().nullable(),
  shippedAt: z.string().nullable(),
  receivedAt: z.string().nullable(),
  items: z.array(BomMdPoItemView),
});
export type BomMdPoViewType = z.infer<typeof BomMdPoView>;

/** 발주 계획의 한 묶음 — 상위 발주 품목을 하위별로 묶은 것. 아직 보내지 않았으면 mdPo 가 null. */
export const BomMdPoPlanGroup = z.object({
  partnerId: z.number(),
  partnerName: z.string(),
  currency: z.string(),
  hasPortalAccount: z.boolean(),
  contactEmail: z.string().nullable(),
  totalAmount: z.number(),
  items: z.array(BomMdPoItemView.omit({ itemId: true })),
  mdPo: BomMdPoView.nullable(),
});
export type BomMdPoPlanGroupType = z.infer<typeof BomMdPoPlanGroup>;

export const PartnerPoChildPosData = z.object({
  /** 지금 하위 발주를 보낼 수 있다(상위 발주서가 종결 전). */
  canIssue: z.boolean(),
  groups: z.array(BomMdPoPlanGroup),
  /** 하위 없이 내가 직접 조달하는 품목 수(참고). */
  directItemCount: z.number().int(),
});
export type PartnerPoChildPosDataType = z.infer<typeof PartnerPoChildPosData>;

export const PartnerPoChildPosResponse = z.object({
  result: z.literal(true),
  data: PartnerPoChildPosData,
});
export type PartnerPoChildPosResponseType = z.infer<typeof PartnerPoChildPosResponse>;

export const PartnerPoChildPosIssueBody = z.object({
  partnerIds: z.array(z.number().int().positive()).min(1).max(50),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type PartnerPoChildPosIssueBodyType = z.infer<typeof PartnerPoChildPosIssueBody>;

// 진행 — 하위(계정이 있으면)는 확인·출고까지, 발주처(마스터딜러)는 전부(대행 포함)·수령·되돌리기.
export const BOM_MD_PO_ACTIONS = ['confirm', 'ship', 'receive', 'revert'] as const;
export type BomMdPoActionType = (typeof BOM_MD_PO_ACTIONS)[number];

/** 보는 쪽 — parent=발주처(마스터딜러, 관리자 대리 접속 포함) · child=수주처(하위). */
export type BomMdPoViewerRoleType = 'parent' | 'child';

const BOM_MD_PO_PREVIOUS: Partial<Record<BomMdPoStatusType, BomMdPoStatusType>> = {
  confirmed: 'issued',
  shipped: 'confirmed',
  received: 'shipped',
};

/** 되돌리면 어느 상태가 되나 — 첫 상태(issued)는 undefined. */
export const bomMdPoPreviousStatus = (status: BomMdPoStatusType): BomMdPoStatusType | undefined =>
  BOM_MD_PO_PREVIOUS[status];

/**
 * 지금 이 사람이 누를 수 있는 동작 — 서버 판정과 화면 버튼이 같은 함수를 쓴다.
 * 하위는 자기 몫인 확인·출고까지, 발주처는 전부(계정 없는 하위를 대신해 확인·출고를 찍고 수령으로 닫는다).
 * 되돌리기 — 발주처는 어느 단계든 한 칸, 하위는 자기가 찍은 확인·출고만(수령은 발주처의 것).
 */
export const bomMdPoActionsFor = (
  status: BomMdPoStatusType,
  role: BomMdPoViewerRoleType,
): BomMdPoActionType[] => {
  const actions: BomMdPoActionType[] = [];
  if (status === 'issued') actions.push('confirm');
  if (status === 'confirmed') actions.push('ship');
  if (status === 'shipped' && role === 'parent') actions.push('receive');
  if (BOM_MD_PO_PREVIOUS[status] !== undefined && (role === 'parent' || status !== 'received')) {
    actions.push('revert');
  }
  return actions;
};

/** 출고 전에는 삭제할 수 있다 — 발주처만. */
export const bomMdPoCanDelete = (status: BomMdPoStatusType, role: BomMdPoViewerRoleType): boolean =>
  role === 'parent' && (status === 'issued' || status === 'confirmed');

export const PartnerMdPoAdvanceBody = z.object({
  action: z.enum(BOM_MD_PO_ACTIONS),
  carrier: z.string().trim().max(100).nullable().optional(),
  trackingNo: z.string().trim().max(100).nullable().optional(),
});
export type PartnerMdPoAdvanceBodyType = z.infer<typeof PartnerMdPoAdvanceBody>;

/** 내가 받은 하위 발주(하위로서) — 포털 '발주 관리'에 곁들인다. */
export const PartnerMdPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(BomMdPoView) }),
});
export type PartnerMdPoListResponseType = z.infer<typeof PartnerMdPoListResponse>;

export const PartnerMdPoDetailResponse = z.object({
  result: z.literal(true),
  data: BomMdPoView.extend({
    /** 보는 쪽 — parent=발주처(마스터딜러), child=수주처(하위). 누를 수 있는 동작이 갈린다. */
    viewerRole: z.enum(['parent', 'child']),
    actions: z.array(z.enum(BOM_MD_PO_ACTIONS)),
    canDelete: z.boolean(),
  }),
});
export type PartnerMdPoDetailResponseType = z.infer<typeof PartnerMdPoDetailResponse>;

export const PartnerMdPoDeleteResponse = z.object({ result: z.literal(true) });

// ── 송금 원장(샘플피씨비 → 협력사) ───────────────────────────────────────────
// 발주서 1:N 송금. 송금 통화 = 발주 통화(서버 강제). 외화면 **송금한 날의 실제 환율**과 원화 환산을
// 함께 남긴다 — 발주서의 장부 환율과의 차이가 환차다.
export const BOM_REMITTANCE_STATUSES = ['unpaid', 'partial', 'paid', 'over'] as const;
export type BomRemittanceStatusType = (typeof BOM_REMITTANCE_STATUSES)[number];

export const BOM_REMITTANCE_STATUS_LABELS: Record<BomRemittanceStatusType, string> = {
  unpaid: '미지급',
  partial: '일부 지급',
  paid: '지급 완료',
  over: '초과 지급',
};

export const BomRemittanceView = z.object({
  id: z.number(),
  poId: z.number(),
  remittedOn: z.string(),
  currency: z.string(),
  amount: z.number(),
  /** 외화 송금의 실제 적용 환율(결제통화→KRW). 원화면 null. */
  exchangeRate: z.number().nullable(),
  krwAmount: z.number().nullable(),
  /** 환차(원) = 실제 원화 − 발주서 장부 환율로 본 원화. 양수 = 장부보다 더 나갔다. 원화면 null. */
  fxDiffKrw: z.number().nullable(),
  memo: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type BomRemittanceViewType = z.infer<typeof BomRemittanceView>;

export const BomRemittanceSummary = z.object({
  currency: z.string(),
  /** 지급할 금액(결제통화) — 공급 부족 신고가 있으면 실제 공급 금액. */
  poAmount: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  status: z.enum(BOM_REMITTANCE_STATUSES),
  count: z.number().int(),
  lastRemittedOn: z.string().nullable(),
  /** 지금까지의 환차 합(원) — 외화 발주만. */
  fxDiffKrw: z.number().nullable(),
});
export type BomRemittanceSummaryType = z.infer<typeof BomRemittanceSummary>;

export const AdminBomRemittanceCreateBody = z.object({
  remittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive().max(1_000_000_000_000),
  /** 외화 송금의 실제 환율 — 생략하면 그날 고시 환율(없으면 발주서 장부 환율). 원화 발주에서는 무시한다. */
  exchangeRate: z.number().positive().max(100_000).nullable().optional(),
  memo: z.string().trim().max(500).nullable().optional(),
});
export type AdminBomRemittanceCreateBodyType = z.infer<typeof AdminBomRemittanceCreateBody>;

export const AdminBomRemittanceListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    summary: BomRemittanceSummary,
    /** 발주서 장부 환율 — 환차의 기준. 원화 발주는 null. */
    bookedRate: z.number().nullable(),
    items: z.array(BomRemittanceView),
  }),
});
export type AdminBomRemittanceListResponseType = z.infer<typeof AdminBomRemittanceListResponse>;
