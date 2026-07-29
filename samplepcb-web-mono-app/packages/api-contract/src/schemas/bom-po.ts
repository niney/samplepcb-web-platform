import { z } from 'zod';

// ── 스마트 BOM 협력사 발주 — sp_bom_po* 계약 (D18, docs/SMARTBOM_PARTNER_RFQ.md §6.1) ──
// 발주서 = 박제 문서(생성 시점 스냅샷·불변). Case × 협력사 1건, 결제 확인 후 발행.
// 상태는 quote.status·RFQ status 와 별개 계층(같은 문자열 겹침 금지 관례).

export const BOM_PO_STATUSES = ['issued', 'confirmed', 'closed'] as const;
export type BomPoStatusType = (typeof BOM_PO_STATUSES)[number];
export const BomPoStatus = z.enum(BOM_PO_STATUSES);

export const BOM_PO_STATUS_LABELS = {
  issued: '발행됨',
  confirmed: '협력사 확인',
  closed: '마감',
} as const satisfies Record<BomPoStatusType, string>;

export const BomPoItemView = z.object({
  poItemId: z.number(),
  quoteItemId: z.string(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  qty: z.number().int(),
  unitPrice: z.number(), // 스냅샷 단가(VAT 별도)
  lineTotal: z.number().int(),
});
export type BomPoItemViewType = z.infer<typeof BomPoItemView>;

// ── 관리자 (/api/admin/bom-quotes/:id/pos) ──────────────────────────────────

export const AdminBomPoView = z.object({
  poId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  status: BomPoStatus,
  totalAmount: z.number().int(), // KRW, VAT 별도
  currency: z.string(),
  memo: z.string().nullable(),
  itemCount: z.number().int(),
  issuedAt: z.string(),
  confirmedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  items: z.array(BomPoItemView),
});
export type AdminBomPoViewType = z.infer<typeof AdminBomPoView>;

export const AdminBomPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ pos: z.array(AdminBomPoView) }),
});
export type AdminBomPoListResponseType = z.infer<typeof AdminBomPoListResponse>;

// 발주서 생성 — 선택 협력사만. 대상 행(협력사 회신 선정)은 서버가 재집계·박제한다
// (클라 계산 불신 — server-single-truth).
export const AdminBomPoCreateBody = z.object({
  partnerIds: z.array(z.number().int().positive()).min(1).max(50),
  memo: z.string().trim().max(2000).nullish(), // 전 발주서 공통 메모(협력사 노출)
});
export type AdminBomPoCreateBodyType = z.infer<typeof AdminBomPoCreateBody>;

export const AdminBomPoCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({
    created: z.number().int(),
    pos: z.array(AdminBomPoView),
  }),
});
export type AdminBomPoCreateResponseType = z.infer<typeof AdminBomPoCreateResponse>;

export const AdminBomPoMutationResponse = z.object({
  result: z.literal(true),
  data: z.object({ pos: z.array(AdminBomPoView) }),
});
export type AdminBomPoMutationResponseType = z.infer<typeof AdminBomPoMutationResponse>;

// ── 협력사 포털 (/api/partner/pos, requirePartner) ──────────────────────────
// 노출 = 발주 품목·수량·단가(자기 발주서뿐). 고객 식별정보는 스키마에 없다.

export const PartnerPoListItem = z.object({
  poId: z.number(),
  quoteTitle: z.string(),
  status: BomPoStatus,
  totalAmount: z.number().int(),
  currency: z.string(),
  itemCount: z.number().int(),
  issuedAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type PartnerPoListItemType = z.infer<typeof PartnerPoListItem>;

export const PartnerPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PartnerPoListItem) }),
});
export type PartnerPoListResponseType = z.infer<typeof PartnerPoListResponse>;

export const PartnerPoDetail = z.object({
  poId: z.number(),
  quoteTitle: z.string(),
  status: BomPoStatus,
  totalAmount: z.number().int(),
  currency: z.string(),
  memo: z.string().nullable(),
  issuedAt: z.string(),
  confirmedAt: z.string().nullable(),
  items: z.array(BomPoItemView),
});
export type PartnerPoDetailType = z.infer<typeof PartnerPoDetail>;

export const PartnerPoDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerPoDetail,
});
export type PartnerPoDetailResponseType = z.infer<typeof PartnerPoDetailResponse>;
