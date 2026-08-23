import { z } from 'zod';

// 협력사 보유 부품 — 정본 docs/PARTNER_PARTS.md
//
// 협력사가 올린 재고표를 **부품 카탈로그(sp_part)와 분리한** 원장에 저장하고, 고객 BOM
// 분석에서는 기존 공급사와 같은 자리(후보)에서 다만 **뒤순위**로 경쟁시킨다.
// 여기 값(재고·단가·납기)은 협력사의 주장이며 가격 판단에 쓰지 않는다 — 견적은 RFQ 회신이
// 정본이고, 이 원장은 "이 품번을 이 협력사가 갖고 있다"는 사실만 말한다.
//
// 만료·RFQ 제한은 두지 않는다(사용자 결정 2026-08-23) — 정보가 낡거나 틀려도 관리자가
// 운영으로 뒤처리한다. 그 대신 나이를 어디서나 보이게 하고 뒤처리 도구를 갖춘다.

// ── 열 역할 사전 — 엔진 inventory 프로필과 같은 어휘(engine routes.py `_INVENTORY_ROLES`)
export const PARTNER_PART_COLUMN_ROLES = [
  'part_number',
  'manufacturer',
  'stock_qty',
  'date_code',
  'lead_time',
  'unit_price',
  'currency',
  'moq',
  'packaging',
  'description',
  'no',
  'ignore',
] as const;
export type PartnerPartColumnRoleType = (typeof PARTNER_PART_COLUMN_ROLES)[number];
export const PartnerPartColumnRole = z.enum(PARTNER_PART_COLUMN_ROLES);

export const PARTNER_PART_COLUMN_ROLE_LABELS = {
  part_number: '품번',
  manufacturer: '제조사',
  stock_qty: '재고 수량',
  date_code: '데이트 코드',
  lead_time: '납기',
  unit_price: '단가',
  currency: '통화',
  moq: '최소 주문',
  packaging: '포장',
  description: '설명',
  no: '순번',
  ignore: '사용 안 함',
} as const satisfies Record<PartnerPartColumnRoleType, string>;

// ── 업로드 회차 상태
export const PARTNER_PART_UPLOAD_STATUSES = [
  'parsing',
  'preview',
  'applied',
  'failed',
  'superseded',
] as const;
export type PartnerPartUploadStatusType = (typeof PARTNER_PART_UPLOAD_STATUSES)[number];
export const PartnerPartUploadStatus = z.enum(PARTNER_PART_UPLOAD_STATUSES);

export const PARTNER_PART_UPLOAD_STATUS_LABELS = {
  parsing: '분석 중',
  preview: '확인 대기',
  applied: '반영됨',
  failed: '실패',
  superseded: '대체됨',
} as const satisfies Record<PartnerPartUploadStatusType, string>;

// 전체 교체가 기본 — 협력사가 올린 표가 그 시점 보유 전량이라는 실무 의미.
export const PARTNER_PART_UPLOAD_MODES = ['replace', 'merge'] as const;
export type PartnerPartUploadModeType = (typeof PARTNER_PART_UPLOAD_MODES)[number];
export const PartnerPartUploadMode = z.enum(PARTNER_PART_UPLOAD_MODES);

export const PARTNER_PART_UPLOAD_MODE_LABELS = {
  replace: '전체 교체',
  merge: '추가 병합',
} as const satisfies Record<PartnerPartUploadModeType, string>;

// 엔진이 남기는 행 플래그 — 사람이 읽을 문구는 화면 사전이 아니라 여기가 정본.
export const PARTNER_PART_FLAG_LABELS: Record<string, string> = {
  part_number_missing: '품번 없음',
  mpn_needs_review: '품번 확인 필요',
  mpn_replacement_char: '깨진 문자 포함',
  mpn_brand_suffix_stripped: '제조사 병기',
  mpn_quantity_suffix_stripped: '수량 병기',
  mpn_comma_suffix_alternative: '포장 코드 병기',
  manufacturer_from_part_number: '제조사를 품번에서 추정',
};

// 별도 배지가 이미 말하는 플래그는 칩으로 두 번 말하지 않는다(수정됨 배지 ↔ manually_edited).
const PARTNER_PART_SILENT_FLAGS = new Set<string>(['manually_edited']);

/** 원장 화면이 칩으로 그릴 플래그만 — 데이터에는 남기고 화면에서만 접는다. */
export function partnerPartVisibleFlags(flags: readonly string[]): string[] {
  return flags.filter((flag) => !PARTNER_PART_SILENT_FLAGS.has(flag));
}

// ── 운영 설정 ──────────────────────────────────────────────────────────────
// 만료를 두지 않기로 했으므로(P4) '낡음'은 삭제 기준이 아니라 **표시 기준**이다.
// 협력사·품목군마다 재고표 갱신 주기가 달라 운영에서 조정할 수 있어야 한다.
export const PartnerPartConfig = z.object({
  staleAfterDays: z.number().int().min(1).max(3650),
});
export type PartnerPartConfigType = z.infer<typeof PartnerPartConfig>;

export const PartnerPartConfigResponse = z.object({
  result: z.literal(true),
  data: PartnerPartConfig,
});

// ── 미리보기(커밋 전) ──────────────────────────────────────────────────────
export const PartnerPartPreviewColumn = z.object({
  column1Based: z.number().int().positive(),
  rawHeader: z.string(),
  role: PartnerPartColumnRole,
  // label=헤더 이름으로 판정 · content=내용 추정 · override=사람이 고침 · none=미정
  source: z.enum(['label', 'content', 'override', 'none']),
});
export type PartnerPartPreviewColumnType = z.infer<typeof PartnerPartPreviewColumn>;

export const PartnerPartPreviewSheet = z.object({
  sheetIndex: z.number().int().nonnegative(),
  sheetName: z.string(),
  status: z.enum(['parsed', 'not_inventory', 'error']),
  rowCount: z.number().int().nonnegative(),
  headerRow1Based: z.number().int().positive().nullable(),
  columns: z.array(PartnerPartPreviewColumn),
  warnings: z.array(z.string()),
  unparsedReason: z.string().nullable(),
});
export type PartnerPartPreviewSheetType = z.infer<typeof PartnerPartPreviewSheet>;

export const PartnerPartPreviewRow = z.object({
  rowId: z.string(),
  sheetName: z.string(),
  sourceRow: z.number().int().positive().nullable(),
  mpn: z.string(),
  mpnRaw: z.string(),
  alternatives: z.array(z.string()),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  stockQty: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  unitPrice: z.number().nullable(),
  currency: z.string().nullable(),
  moq: z.number().int().nullable(),
  flags: z.array(z.string()),
});
export type PartnerPartPreviewRowType = z.infer<typeof PartnerPartPreviewRow>;

export const PartnerPartUploadStats = z.object({
  rowCount: z.number().int().nonnegative(),
  distinctMpnCount: z.number().int().nonnegative(),
  withManufacturer: z.number().int().nonnegative(),
  withStock: z.number().int().nonnegative(),
  withPrice: z.number().int().nonnegative(),
  flagCounts: z.record(z.string(), z.number().int().nonnegative()),
  /** 플래그가 **하나라도** 달린 행 수 — 발생 수 합계와 다르다(한 행이 여러 개를 단다). */
  flaggedRowCount: z.number().int().nonnegative().default(0),
  processingMs: z.number().nonnegative().nullable(),
});
export type PartnerPartUploadStatsType = z.infer<typeof PartnerPartUploadStats>;

export const PartnerPartUploadView = z.object({
  uploadId: z.number().int().positive(),
  partnerId: z.number().int().positive(),
  partnerName: z.string().nullable(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  status: PartnerPartUploadStatus,
  mode: PartnerPartUploadMode,
  stats: PartnerPartUploadStats.nullable(),
  sheets: z.array(PartnerPartPreviewSheet),
  error: z.string().nullable(),
  uploadedBy: z.string(),
  uploadedById: z.string().nullable(),
  appliedAt: z.string().nullable(),
  createdAt: z.string(),
  // 반영된 회차가 지금 원장에 살아 있는 행 수(교체되면 0)
  activePartCount: z.number().int().nonnegative(),
});
export type PartnerPartUploadViewType = z.infer<typeof PartnerPartUploadView>;

export const PartnerPartUploadDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({
    upload: PartnerPartUploadView,
    // 미리보기 표본(커밋 전 확인용) — 전량이 아니라 상단 N행
    rows: z.array(PartnerPartPreviewRow),
    rowSampleLimit: z.number().int().positive(),
  }),
});
export type PartnerPartUploadDetailResponseType = z.infer<
  typeof PartnerPartUploadDetailResponse
>;

export const PartnerPartUploadListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartnerPartUploadView),
    total: z.number().int().nonnegative(),
  }),
});
export type PartnerPartUploadListResponseType = z.infer<
  typeof PartnerPartUploadListResponse
>;

// 미리보기 열 역할 교정 — 엔진을 같은 파일로 다시 돌린다(응용 계층은 셀을 재해석하지 않음).
export const PartnerPartUploadRemapBody = z.object({
  roleOverrides: z
    .array(
      z.object({
        sheetIndex: z.number().int().nonnegative(),
        column1Based: z.number().int().positive(),
        role: PartnerPartColumnRole,
      }),
    )
    .max(200),
  headerRowOverrides: z
    .array(
      z.object({
        sheetIndex: z.number().int().nonnegative(),
        headerRow1Based: z.number().int().positive(),
      }),
    )
    .max(50)
    .optional(),
});
export type PartnerPartUploadRemapBodyType = z.infer<typeof PartnerPartUploadRemapBody>;

export const PartnerPartUploadCommitBody = z.object({
  mode: PartnerPartUploadMode.default('replace'),
});
export type PartnerPartUploadCommitBodyType = z.infer<typeof PartnerPartUploadCommitBody>;

// ── 원장 조회(협력사 포털·관리자 뒤처리 도구 공용) ─────────────────────────
export const PartnerPartRow = z.object({
  partId: z.number().int().positive(),
  partnerId: z.number().int().positive(),
  partnerName: z.string().nullable(),
  uploadId: z.number().int().positive(),
  mpn: z.string(),
  mpnRaw: z.string(),
  manufacturer: z.string().nullable(),
  description: z.string().nullable(),
  stockQty: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  unitPrice: z.number().nullable(),
  currency: z.string().nullable(),
  moq: z.number().int().nullable(),
  sourceSheetName: z.string().nullable(),
  sourceRow: z.number().int().nullable(),
  flags: z.array(z.string()),
  isActive: z.boolean(),
  // 데이터 나이 — 만료를 두지 않는 대신 어디서나 보인다
  uploadedAt: z.string(),
  /** 업로드 뒤 사람이 고친 행이면 시각·주체. 원문(`mpnRaw`)은 그대로 남는다. */
  editedAt: z.string().nullable(),
  editedBy: z.string().nullable(),
});
export type PartnerPartRowType = z.infer<typeof PartnerPartRow>;

// 행 수정 — 전체 재업로드 없이 한 줄만 고친다(오타 품번·빠진 제조사·바뀐 재고).
// 보낸 필드만 바꾼다(부분 수정). 원문 `mpnRaw` 는 건드리지 않는다 — 파일에 뭐라 적혀
// 있었는지는 계속 남아야 하고, 고친 값과의 차이가 곧 "무엇을 고쳤는지"다.
// ⚠ 전체 교체 업로드는 원장을 비우므로 수정본도 함께 사라진다(화면이 그렇게 안내한다).
export const PartnerPartUpdateBody = z
  .object({
    mpn: z.string().trim().min(1).max(191),
    manufacturer: z.string().trim().max(191).nullable(),
    description: z.string().trim().max(500).nullable(),
    stockQty: z.number().int().min(0).nullable(),
    dateCode: z.string().trim().max(100).nullable(),
    leadTime: z.string().trim().max(100).nullable(),
    unitPrice: z.number().min(0).nullable(),
    currency: z.string().trim().max(8).nullable(),
    moq: z.number().int().min(1).nullable(),
  })
  .partial();
export type PartnerPartUpdateBodyType = z.infer<typeof PartnerPartUpdateBody>;

export const PartnerPartUpdateResponse = z.object({
  result: z.literal(true),
  data: z.object({ part: PartnerPartRow }),
});
export type PartnerPartUpdateResponseType = z.infer<typeof PartnerPartUpdateResponse>;

export const PartnerPartListQuery = z.object({
  q: z.string().max(191).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  includeInactive: z.coerce.boolean().default(false),
  partnerId: z.coerce.number().int().positive().optional(), // 관리자 전용
});
export type PartnerPartListQueryType = z.infer<typeof PartnerPartListQuery>;

export const PartnerPartListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartnerPartRow),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  }),
});
export type PartnerPartListResponseType = z.infer<typeof PartnerPartListResponse>;

// 협력사별 원장 요약 — 관리자 뒤처리 화면·포털 배너가 같은 값을 본다.
export const PartnerPartSummary = z.object({
  partnerId: z.number().int().positive(),
  partnerName: z.string(),
  activeCount: z.number().int().nonnegative(),
  inactiveCount: z.number().int().nonnegative(),
  lastUploadedAt: z.string().nullable(),
  lastUploadFileName: z.string().nullable(),
  // 마지막 업로드로부터 지난 날짜 — 경고 임계(관리자 설정)와 비교해 표시만 한다
  ageDays: z.number().int().nonnegative().nullable(),
  stale: z.boolean(),
});
export type PartnerPartSummaryType = z.infer<typeof PartnerPartSummary>;

export const PartnerPartSummaryResponse = z.object({
  result: z.literal(true),
  data: z.object({
    summary: PartnerPartSummary.nullable(),
    staleAfterDays: z.number().int().positive(),
  }),
});
export type PartnerPartSummaryResponseType = z.infer<typeof PartnerPartSummaryResponse>;

export const AdminPartnerPartSummaryListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartnerPartSummary),
    staleAfterDays: z.number().int().positive(),
    totalActiveParts: z.number().int().nonnegative(),
  }),
});
export type AdminPartnerPartSummaryListResponseType = z.infer<
  typeof AdminPartnerPartSummaryListResponse
>;

// ── 견적 품목 × 보유 협력사 (관리자 전용) ──────────────────────────────────
// "이 행을 누가 갖고 있나" — 견적요청을 누구에게 보낼지 정하는 근거다. 조직 이름이
// 들어가므로 **관리자 전용**이며, 고객 DTO(`matchEvidence.partnerStock`)는 곳 수·기준일까지만
// 노출한다(docs/PARTNER_PARTS.md §5).
export const AdminBomQuoteItemPartnerHolder = z.object({
  partnerId: z.number().int().positive(),
  partnerName: z.string(),
  /** 이 협력사가 알린 재고 합계(같은 품번 여러 lot 합산). 검증되지 않은 주장이다. */
  stockQty: z.number().int().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  uploadedAt: z.string(),
  /** bom_rfq 트랙이 없으면 견적요청 대상이 못 된다(보유 사실은 그대로 보여준다). */
  rfqEligible: z.boolean(),
});
export type AdminBomQuoteItemPartnerHolderType = z.infer<typeof AdminBomQuoteItemPartnerHolder>;

export const AdminBomQuotePartnerStockResponse = z.object({
  result: z.literal(true),
  data: z.object({
    /** quoteItemId → 보유 협력사(최신 업로드 순). 보유가 없는 행은 키 자체가 없다. */
    itemHolders: z.record(z.string(), z.array(AdminBomQuoteItemPartnerHolder)),
    /** 발송 모달용 역방향 색인 — partnerId → 보유 중인 quoteItemId. */
    partnerItems: z.record(z.string(), z.array(z.string())),
  }),
});
export type AdminBomQuotePartnerStockResponseType = z.infer<
  typeof AdminBomQuotePartnerStockResponse
>;

// 관리자 뒤처리 — 협력사 원장 통째 활성/비활성, 행 단위 비활성, 회차 비우기.
export const AdminPartnerPartToggleBody = z.object({
  isActive: z.boolean(),
});
export type AdminPartnerPartToggleBodyType = z.infer<typeof AdminPartnerPartToggleBody>;

export const AdminPartnerPartBulkBody = z.object({
  partIds: z.array(z.number().int().positive()).min(1).max(500),
  isActive: z.boolean(),
});
export type AdminPartnerPartBulkBodyType = z.infer<typeof AdminPartnerPartBulkBody>;

export const PartnerPartMutationResponse = z.object({
  result: z.literal(true),
  data: z.object({ affected: z.number().int().nonnegative() }),
});
export type PartnerPartMutationResponseType = z.infer<typeof PartnerPartMutationResponse>;
