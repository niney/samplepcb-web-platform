import { z } from 'zod';
import { BomPoStatus } from './bom-po';

// ── 입고 스캔(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) — 공급사 봉투 라벨 2D 바코드로 입고 추적 ──
// DigiKey·Mouser 라벨은 ECIA(ISO/IEC 15434) 규격이라 API 없이 파싱한다. 스캔 1건 = 원장 1행
// (sp_bom_receiving_scan) — 매칭된 발주 품목이 없어도 남기고, 잘못 찍은 건 취소(void)한다.

export const BOM_RECEIVING_SUPPLIERS = ['digikey', 'mouser', 'unknown'] as const;
export const BomReceivingSupplier = z.enum(BOM_RECEIVING_SUPPLIERS);
export type BomReceivingSupplierType = z.infer<typeof BomReceivingSupplier>;

export const BomReceivingBarcodeFields = z.object({
  supplierSku: z.string().nullable(), // 30P ?? P
  mpn: z.string().nullable(), // 1P
  quantity: z.number().int().nullable(), // Q
  customerOrderNo: z.string().nullable(), // K
  supplierOrderNo: z.string().nullable(), // 1K(Mouser 는 K)
  invoiceNo: z.string().nullable(), // 10K
  packingListNo: z.string().nullable(), // 11K
  poLine: z.string().nullable(), // 4K / 14K
  lotCode: z.string().nullable(), // 1T
  dateCode: z.string().nullable(), // 9D / 10D
  countryOfOrigin: z.string().nullable(), // 4L
  manufacturer: z.string().nullable(), // 1V
});
export type BomReceivingBarcodeFieldsType = z.infer<typeof BomReceivingBarcodeFields>;

export const BomReceivingParsedBarcode = z.object({
  format: z.literal('ecia2d'),
  supplier: BomReceivingSupplier,
  identifiers: z.record(z.string(), z.string()),
  fields: BomReceivingBarcodeFields,
});
export type BomReceivingParsedBarcodeType = z.infer<typeof BomReceivingParsedBarcode>;

export const BOM_RECEIVING_MATCHED_BY = ['supplierSku', 'mpn'] as const;
export const BomReceivingCandidate = z.object({
  poItemId: z.number(),
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  partnerName: z.string(),
  supplierCode: z.string().nullable(),
  poStatus: BomPoStatus,
  mpn: z.string(),
  supplierSku: z.string().nullable(),
  orderedQty: z.number().int(),
  scannedQty: z.number().int(), // 취소 제외 누적
  matchedBy: z.enum(BOM_RECEIVING_MATCHED_BY),
  issuedAt: z.string(),
});
export type BomReceivingCandidateType = z.infer<typeof BomReceivingCandidate>;

export const AdminBomReceivingScanBody = z.object({
  barcode: z.string().trim().min(1).max(4000),
});
export type AdminBomReceivingScanBodyType = z.infer<typeof AdminBomReceivingScanBody>;

export const AdminBomReceivingScanResponse = z.object({
  result: z.literal(true),
  data: z.object({
    parsed: BomReceivingParsedBarcode.nullable(), // ECIA 가 아니면 null
    candidates: z.array(BomReceivingCandidate),
  }),
});
export type AdminBomReceivingScanResponseType = z.infer<typeof AdminBomReceivingScanResponse>;

export const BomReceivingScanRecord = z.object({
  scanId: z.number(),
  poItemId: z.number().nullable(),
  poId: z.number().nullable(),
  quoteId: z.string().nullable(),
  quoteTitle: z.string().nullable(),
  partnerName: z.string().nullable(),
  poItemMpn: z.string().nullable(),
  orderedQty: z.number().int().nullable(),
  supplierCode: z.string().nullable(),
  supplierSku: z.string().nullable(),
  mpn: z.string().nullable(),
  quantity: z.number().int(),
  lotCode: z.string().nullable(),
  dateCode: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  supplierOrderNo: z.string().nullable(),
  customerOrderNo: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  note: z.string().nullable(),
  scannedBy: z.string(),
  scannedAt: z.string(),
  voidedAt: z.string().nullable(),
});
export type BomReceivingScanRecordType = z.infer<typeof BomReceivingScanRecord>;

export const BomReceivingProgressItem = z.object({
  poItemId: z.number(),
  mpn: z.string(),
  supplierSku: z.string().nullable(),
  orderedQty: z.number().int(),
  scannedQty: z.number().int(),
  scanCount: z.number().int(),
});
export type BomReceivingProgressItemType = z.infer<typeof BomReceivingProgressItem>;

export const BomReceivingPoProgress = z.object({
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  partnerName: z.string(),
  supplierCode: z.string().nullable(),
  poStatus: BomPoStatus,
  items: z.array(BomReceivingProgressItem),
  orderedTotal: z.number().int(),
  scannedTotal: z.number().int(),
  /** 모든 품목의 누적 스캔 수량이 발주 수량 이상. */
  complete: z.boolean(),
  /** 어느 품목이든 발주 수량을 넘겨 찍혔다. */
  overReceived: z.boolean(),
});
export type BomReceivingPoProgressType = z.infer<typeof BomReceivingPoProgress>;

export const AdminBomReceivingRecordBody = z.object({
  barcode: z.string().trim().min(1).max(4000),
  /** 매칭할 발주 품목 — null 이면 미매칭 스캔으로 남긴다. */
  poItemId: z.number().int().positive().nullable(),
  /** 라벨 수량(Q) 대신 수기 수량. null 이면 라벨 Q(없으면 409 QUANTITY_REQUIRED). */
  quantity: z.number().int().positive().nullable(),
  note: z.string().trim().max(500).nullable(),
  /** 라벨 파싱 대신/위에 덮어쓸 필드 — 1D 바코드를 DigiKey 조회로 풀었을 때 등. 없으면 라벨값. */
  override: z
    .object({
      supplierCode: BomReceivingSupplier.nullable().optional(),
      supplierSku: z.string().trim().max(191).nullable().optional(),
      mpn: z.string().trim().max(191).nullable().optional(),
      lotCode: z.string().trim().max(100).nullable().optional(),
      dateCode: z.string().trim().max(100).nullable().optional(),
      countryOfOrigin: z.string().trim().max(16).nullable().optional(),
      supplierOrderNo: z.string().trim().max(64).nullable().optional(),
      invoiceNo: z.string().trim().max(64).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type AdminBomReceivingRecordBodyType = z.infer<typeof AdminBomReceivingRecordBody>;

export const AdminBomReceivingRecordResponse = z.object({
  result: z.literal(true),
  data: z.object({
    scan: BomReceivingScanRecord,
    progress: BomReceivingPoProgress.nullable(),
  }),
});
export type AdminBomReceivingRecordResponseType = z.infer<typeof AdminBomReceivingRecordResponse>;

export const AdminBomReceivingRecentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  poId: z.coerce.number().int().positive().optional(),
  includeVoided: z.enum(['0', '1']).default('0'),
});
export type AdminBomReceivingRecentQueryType = z.infer<typeof AdminBomReceivingRecentQuery>;

export const AdminBomReceivingRecentResponse = z.object({
  result: z.literal(true),
  data: z.object({ scans: z.array(BomReceivingScanRecord) }),
});
export type AdminBomReceivingRecentResponseType = z.infer<typeof AdminBomReceivingRecentResponse>;

export const AdminBomReceivingProgressResponse = z.object({
  result: z.literal(true),
  data: BomReceivingPoProgress,
});
export type AdminBomReceivingProgressResponseType = z.infer<typeof AdminBomReceivingProgressResponse>;
