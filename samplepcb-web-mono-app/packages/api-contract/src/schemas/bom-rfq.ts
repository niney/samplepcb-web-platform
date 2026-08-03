import { z } from 'zod';

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
// 합계(totalAmount)는 서버가 단가 × (회신수량 ?? 주문수량) 으로 재계산해 박제한다.

export const BomRfqItemReplyInput = z.object({
  quoteItemId: z.string().regex(/^\d+$/),
  unitPrice: z.number().nonnegative(),
  replyQty: z.number().int().positive().nullable(),
  moq: z.number().int().positive().nullable(),
  stock: z.number().int().nonnegative().nullable(),
  dateCode: z.string().trim().max(100).nullable(),
  leadTime: z.string().trim().max(64).nullable(),
  memo: z.string().trim().max(500).nullable(),
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

// ── 관리자: RFQ 발송·현황 (/api/admin/bom-quotes/:id/rfqs) ──────────────────

export const AdminBomRfqItemView = z.object({
  rfqItemId: z.number(),
  quoteItemId: z.string(),
  source: BomRfqItemSource,
  unitPrice: z.number().nullable(),
  currency: z.string(),
  replyQty: z.number().int().nullable(),
  moq: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  memo: z.string().nullable(),
  updatedAt: z.string(),
});
export type AdminBomRfqItemViewType = z.infer<typeof AdminBomRfqItemView>;

export const AdminBomRfqView = z.object({
  rfqId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  status: BomRfqStatus,
  totalAmount: z.number().nullable(),
  currency: z.string(),
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
});
export type AdminBomRfqViewType = z.infer<typeof AdminBomRfqView>;

export const AdminBomRfqListResponse = z.object({
  result: z.literal(true),
  data: z.object({ rfqs: z.array(AdminBomRfqView) }),
});
export type AdminBomRfqListResponseType = z.infer<typeof AdminBomRfqListResponse>;

// diff 발송 — 선택 협력사 집합으로 수렴: 빠진 미회신(requested) 문서만 삭제, 회신
// (quoted) 문서는 보존, 신규만 생성·메일. 재발송해도 유지분은 건드리지 않는다(§2.4).
export const AdminBomRfqSendBody = z.object({
  /** 0곳 허용 — 전부 해제 발송 = 미회신(requested) RFQ 전부 회수(quoted 는 보존). */
  partnerIds: z.array(z.number().int().positive()).max(50),
  /** 부분 행 선택(§6.13) — 요청 부품행 id. 생략=전체. 이번에 새로 생성되는 RFQ 에만
   * 적용된다(유지분의 기존 세트는 불변 — diff 보존 규칙 동일). */
  itemIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500).optional(),
});
export type AdminBomRfqSendBodyType = z.infer<typeof AdminBomRfqSendBody>;

export const AdminBomRfqSendResponse = z.object({
  result: z.literal(true),
  data: z.object({
    added: z.number().int(),
    kept: z.number().int(),
    removed: z.number().int(),
    rfqs: z.array(AdminBomRfqView),
  }),
});
export type AdminBomRfqSendResponseType = z.infer<typeof AdminBomRfqSendResponse>;

export const AdminBomRfqReplyResponse = z.object({
  result: z.literal(true),
  data: AdminBomRfqView,
});
export type AdminBomRfqReplyResponseType = z.infer<typeof AdminBomRfqReplyResponse>;

// 행별 협력사 회신 선정 — selectionSource='partner' + selectedOffer 스냅샷 박제 +
// 서버 재계산(snapshot-freeze). rfqItemId=null 은 선정 해제(미선정 복귀).
export const AdminBomRfqSelectionBody = z.object({
  itemId: z.string().regex(/^\d+$/),
  rfqItemId: z.number().int().positive().nullable(),
});
export type AdminBomRfqSelectionBodyType = z.infer<typeof AdminBomRfqSelectionBody>;

export const AdminBomRfqSelectionResponse = z.object({ result: z.literal(true) });
export type AdminBomRfqSelectionResponseType = z.infer<typeof AdminBomRfqSelectionResponse>;

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
  }).nullable(),
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
});
export type PartnerRfqDetailType = z.infer<typeof PartnerRfqDetail>;

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
