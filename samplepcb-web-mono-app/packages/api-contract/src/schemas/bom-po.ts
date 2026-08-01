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
  /** 공급사 발주(D20) 실행용 SKU 스냅샷 — 협력사 발주는 null. */
  supplierSku: z.string().nullable(),
  qty: z.number().int(),
  unitPrice: z.number(), // 스냅샷 단가(VAT 별도)
  lineTotal: z.number().int(),
});
export type BomPoItemViewType = z.infer<typeof BomPoItemView>;

// 외부공급사 실행 결과 박제(D20) — Mouser=카트, DigiKey=single-use 리스트 URL(1회용).
export const BomPoExternalRef = z.object({
  state: z.enum(['ok', 'failed']),
  supplier: z.string(),
  executedAt: z.string(),
  skippedNoSku: z.number().int().optional(), // SKU 없어 제외된 행 수
  cartKey: z.string().optional(),
  cartWebUrl: z.string().optional(),
  listName: z.string().optional(),
  singleUseUrl: z.string().optional(),
  lineCount: z.number().int().optional(),
  merchandiseTotal: z.number().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  errors: z.array(z.string()).optional(), // 공급사 행 단위 거부(품절·SKU 오류)
  error: z.string().optional(),
});
export type BomPoExternalRefType = z.infer<typeof BomPoExternalRef>;

// ── 선적(D21) — 경량 모델: 1차는 발주서당 1건 ───────────────────────────────
// 모드는 생성 시 박제. 상태는 영문 코드 + 한글 라벨(D21-5 — 레거시 한글 리터럴 승계 안 함).

export const BOM_SHIPMENT_MODES = ['international', 'domestic'] as const;
export type BomShipmentModeType = (typeof BOM_SHIPMENT_MODES)[number];
export const BomShipmentMode = z.enum(BOM_SHIPMENT_MODES);

export const BOM_SHIPMENT_MODE_LABELS = {
  international: '국제',
  domestic: '국내',
} as const satisfies Record<BomShipmentModeType, string>;

// 국제 6단계(레거시 명칭 승계) / 국내 3단계.
export const BOM_SHIPMENT_INTL_STATUSES = [
  'preparing',
  'requested',
  'shipped',
  'arrived',
  'customs',
  'done',
] as const;
export const BOM_SHIPMENT_DOMESTIC_STATUSES = ['preparing', 'shipping', 'delivered'] as const;
export const BomShipmentStatus = z.enum([
  ...BOM_SHIPMENT_INTL_STATUSES,
  ...BOM_SHIPMENT_DOMESTIC_STATUSES,
]);
export type BomShipmentStatusType = z.infer<typeof BomShipmentStatus>;

export const BOM_SHIPMENT_STATUS_LABELS = {
  preparing: '선적 준비',
  requested: '선적 요청',
  shipped: '선적',
  arrived: '국내도착',
  customs: '통관',
  done: '완료',
  shipping: '배송중',
  delivered: '배송완료',
} as const satisfies Record<BomShipmentStatusType, string>;

/** domestic 모드의 preparing 라벨은 '배송준비'(레거시 국내 3단계) — 표시 시 모드로 분기. */
export const BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL = '배송준비';

// ── 핑퐁 전이(D22 — 레거시 절차 승계) ───────────────────────────────────────
// "해당 상태로 진입시키는 주체" 사전(레거시 actorForStatus 미러). 협력사는 자기 차례
// 전이만(서버 인가 — 레거시는 프론트만 검증한 취약점 교정), 관리자는 전 단계 임의 조작.

export type BomShipmentActorType = 'ADMIN' | 'PARTNER';

export const BOM_SHIPMENT_ACTORS: Record<
  BomShipmentModeType,
  Partial<Record<BomShipmentStatusType, BomShipmentActorType>>
> = {
  // 협력사: 선적 요청(출고예정일+인보이스)·국내도착 확인 / 관리자: 선적(AWB)·통관·완료
  international: {
    requested: 'PARTNER',
    shipped: 'ADMIN',
    arrived: 'PARTNER',
    customs: 'ADMIN',
    done: 'ADMIN',
  },
  // 협력사: 배송중(택배사+송장) / 관리자: 배송완료(수령확인)
  domestic: { shipping: 'PARTNER', delivered: 'ADMIN' },
};

export const bomShipmentStatusesOf = (
  mode: BomShipmentModeType,
): readonly BomShipmentStatusType[] =>
  mode === 'domestic' ? BOM_SHIPMENT_DOMESTIC_STATUSES : BOM_SHIPMENT_INTL_STATUSES;

export const bomShipmentNextStatus = (
  mode: BomShipmentModeType,
  current: BomShipmentStatusType,
): BomShipmentStatusType | null => {
  const chain = bomShipmentStatusesOf(mode);
  const idx = chain.indexOf(current);
  return idx >= 0 && idx < chain.length - 1 ? (chain[idx + 1] ?? null) : null;
};

export const bomShipmentPrevStatus = (
  mode: BomShipmentModeType,
  current: BomShipmentStatusType,
): BomShipmentStatusType | null => {
  const chain = bomShipmentStatusesOf(mode);
  const idx = chain.indexOf(current);
  return idx > 0 ? (chain[idx - 1] ?? null) : null;
};

export const bomShipmentActorOf = (
  mode: BomShipmentModeType,
  status: BomShipmentStatusType,
): BomShipmentActorType | null => BOM_SHIPMENT_ACTORS[mode][status] ?? null;

/** 모드 반영 상태 라벨(국내 preparing='배송준비' 분기 포함) — 화면·메일 공용. */
export const bomShipmentStatusLabel = (
  mode: BomShipmentModeType,
  status: BomShipmentStatusType,
): string =>
  mode === 'domestic' && status === 'preparing'
    ? BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL
    : BOM_SHIPMENT_STATUS_LABELS[status];

// ── 선적 첨부(D22) — sp_file(refType 'sp_bom_shipment'), 종류별 1건(재업로드=교체) ──

export const BOM_SHIPMENT_FILE_TYPES = ['invoice', 'airwaybill'] as const;
export type BomShipmentFileTypeType = (typeof BOM_SHIPMENT_FILE_TYPES)[number];
export const BomShipmentFileType = z.enum(BOM_SHIPMENT_FILE_TYPES);

/** 국제 라벨. 국내 모드는 레거시 라벨(거래명세서/송장내역)로 분기. */
export const BOM_SHIPMENT_FILE_LABELS = {
  invoice: 'Invoice',
  airwaybill: 'AWB',
} as const satisfies Record<BomShipmentFileTypeType, string>;
export const BOM_SHIPMENT_FILE_DOMESTIC_LABELS = {
  invoice: '거래명세서',
  airwaybill: '송장내역',
} as const satisfies Record<BomShipmentFileTypeType, string>;

export const BomShipmentFileMeta = z.object({
  fileId: z.number(),
  fileType: BomShipmentFileType,
  name: z.string(), // 원본 파일명
  size: z.number(),
  uploadedBy: z.enum(['ADMIN', 'PARTNER']).nullable(),
});
export type BomShipmentFileMetaType = z.infer<typeof BomShipmentFileMeta>;

/** 선적 그룹 소속 발주서(§6.10) — 같은 협력사의 묶음 표시·제외용. */
export const BomShipmentGroupPo = z.object({
  poId: z.number(),
  quoteTitle: z.string(),
  totalAmount: z.number().int(),
  /** 대표(생성) 발주서 — 묶음에서 제외 불가(선적 자체의 기준). */
  isPrimary: z.boolean(),
});
export type BomShipmentGroupPoType = z.infer<typeof BomShipmentGroupPo>;

export const BomShipmentView = z.object({
  shipmentId: z.number(),
  mode: BomShipmentMode,
  status: BomShipmentStatus,
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  shipDate: z.string().nullable(), // 출고예정일(협력사 '선적 요청' 입력, D22)
  shippedAt: z.string().nullable(),
  receivedAt: z.string().nullable(), // 입고 확인(검수 ⑩)
  receivedNote: z.string().nullable(),
  completedAt: z.string().nullable(),
  files: z.array(BomShipmentFileMeta),
  /** 묶음 소속 전체(대표 포함, §6.10) — 1건이면 단독 선적. */
  groupPos: z.array(BomShipmentGroupPo),
});
export type BomShipmentViewType = z.infer<typeof BomShipmentView>;

// 관리자 등록/수정 — mode 는 생성 시에만 반영(이후 무시), status 모드 정합은 서버 검증.
export const AdminBomShipmentUpsertBody = z.object({
  mode: BomShipmentMode.optional(),
  status: BomShipmentStatus.optional(),
  carrier: z.string().trim().max(50).nullish(),
  trackingNumber: z.string().trim().max(100).nullish(),
  trackingUrl: z.string().trim().max(500).nullish(),
  shipDate: z.string().trim().max(10).nullish(), // 'YYYY-MM-DD'
});
export type AdminBomShipmentUpsertBodyType = z.infer<typeof AdminBomShipmentUpsertBody>;

export const AdminBomShipmentReceiveBody = z.object({
  note: z.string().trim().max(2000).nullish(), // 편차 메모(수량 부족·불량)
});
export type AdminBomShipmentReceiveBodyType = z.infer<typeof AdminBomShipmentReceiveBody>;

// 협력사 포털 [다음 단계 진행](D22) — 자기 차례 전이만. 단계별 필수는 서버 검증:
// requested=출고예정일+Invoice 첨부 / shipping=택배사+송장번호. 나머지 전이는 입력 없음.
export const PartnerShipmentAdvanceBody = z.object({
  shipDate: z.string().trim().max(10).nullish(), // 'YYYY-MM-DD'
  carrier: z.string().trim().max(50).nullish(),
  trackingNumber: z.string().trim().max(100).nullish(),
  trackingUrl: z.string().trim().max(500).nullish(),
  /** 함께 발송할 발주서(§6.10 — 같은 박스). 최초 발송 전이에서만 유효, 같은 협력사·
   * 미소속 발주서만(서버 검증). */
  withPoIds: z.array(z.number().int().positive()).max(50).optional(),
});
export type PartnerShipmentAdvanceBodyType = z.infer<typeof PartnerShipmentAdvanceBody>;

// ── 상업송장 생성기(D23) — 레거시 InvoiceEditorModal 필드 승계 ───────────────
// 자동 초안(발주 스냅샷·사업자정보)을 편집해 PDF(프론트 캡처)/엑셀(서버 렌더)로
// 생성·첨부한다. 편집본은 sp_bom_shipment.invoiceData 에 영속(다음 열기 프리필).
// qty 는 문자열(레거시 — "1 SET" 같은 표기 허용), 금액·통화는 자유 편집.

export const BomInvoiceItem = z.object({
  description: z.string().max(500),
  hsCode: z.string().max(50),
  qty: z.string().max(50),
  currency: z.string().max(8),
  unitValue: z.number().nullable(),
  totalValue: z.number().nullable(),
});
export type BomInvoiceItemType = z.infer<typeof BomInvoiceItem>;

export const BomInvoiceData = z.object({
  companyName: z.string().max(191), // 발송인 회사(문서 헤더)
  shipperName: z.string().max(100),
  shipperAddress: z.string().max(500),
  shipperTel: z.string().max(50),
  countryOfOrigin: z.string().max(50),
  countryOfDestination: z.string().max(50),
  consigneeCompany: z.string().max(191),
  consigneeContact: z.string().max(100),
  consigneeAddress: z.string().max(500),
  consigneeTel: z.string().max(50),
  consigneeFax: z.string().max(50),
  consigneeEmail: z.string().max(255),
  countryOfManufacture: z.string().max(50),
  invoiceNo: z.string().max(100),
  netWeight: z.string().max(50), // 자유 표기("17.05KG")
  grossWeight: z.string().max(50),
  currency: z.string().max(8),
  invoiceDate: z.string().max(10), // 'YYYY-MM-DD'
  items: z.array(BomInvoiceItem).max(200),
  totalValue: z.number(),
});
export type BomInvoiceDataType = z.infer<typeof BomInvoiceData>;

export const BomInvoiceDraftResponse = z.object({
  result: z.literal(true),
  data: BomInvoiceData,
});
export type BomInvoiceDraftResponseType = z.infer<typeof BomInvoiceDraftResponse>;

// ── 관리자 (/api/admin/bom-quotes/:id/pos) ──────────────────────────────────

export const AdminBomPoView = z.object({
  poId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  /** 공급사 발주면 코드(mouser|digikey|…), 사람 협력사면 null. */
  supplierCode: z.string().nullable(),
  status: BomPoStatus,
  totalAmount: z.number().int(), // KRW, VAT 별도
  currency: z.string(),
  memo: z.string().nullable(),
  /** 외부 실행 결과(D20) — 자동화 대상 공급사 발주에만. */
  externalRef: BomPoExternalRef.nullable(),
  /** 선적(D21) — 발주서당 1건, 없으면 null. */
  shipment: BomShipmentView.nullable(),
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

// ── 발주 워크큐(/api/admin/bom-pos) — 전 Case 횡단 발주서 목록(관리자 메뉴 재편) ──
// 발주 담당의 큐: 확인 대기(issued)→진행 중(confirmed)→마감(closed). "발주 대기"
// (결제 완료+미발주)는 PO 가 없어 주문 축(/admin/bom-orders?tab=paid_unissued)이 담당.

export const AdminBomPoCrossItem = z.object({
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  partnerId: z.number(),
  partnerName: z.string(),
  supplierCode: z.string().nullable(),
  status: BomPoStatus,
  totalAmount: z.number().int(),
  currency: z.string(),
  itemCount: z.number().int(),
  issuedAt: z.string(),
  confirmedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  /** 소속 선적(경량, §6.10 조인 기반) — 없으면 null. */
  shipment: z
    .object({
      shipmentId: z.number(),
      mode: BomShipmentMode,
      status: BomShipmentStatus,
      receivedAt: z.string().nullable(),
    })
    .nullable(),
});
export type AdminBomPoCrossItemType = z.infer<typeof AdminBomPoCrossItem>;

export const AdminBomPoCrossCounts = z.object({
  issued: z.number().int(),
  confirmed: z.number().int(),
  closed: z.number().int(),
});
export type AdminBomPoCrossCountsType = z.infer<typeof AdminBomPoCrossCounts>;

export const AdminBomPoCrossListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['issued', 'confirmed', 'closed']).default('issued'),
});
export type AdminBomPoCrossListQueryType = z.infer<typeof AdminBomPoCrossListQuery>;

export const AdminBomPoCrossListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomPoCrossItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: AdminBomPoCrossCounts,
  }),
});
export type AdminBomPoCrossListResponseType = z.infer<typeof AdminBomPoCrossListResponse>;

// ── 선적 워크큐(/api/admin/bom-shipments) — 전 Case 횡단 선적 목록 ────────────
// 물류 담당의 큐: 내 차례(관리자 액션 필요)→진행 중(입고 전)→입고 완료. 고객 배송
// 처리는 주문 축(/admin/bom-orders?tab=to_ship|shipping)이 담당(같은 화면 하단).

export const AdminBomShipmentCrossItem = BomShipmentView.extend({
  partnerId: z.number(),
  partnerName: z.string(),
  /** 대표 발주서의 Case — 상세 이동용(묶음 전체는 groupPos). */
  quoteId: z.string(),
  quoteTitle: z.string(),
  /** 다음 단계가 관리자 차례(D22) — 큐 강조. */
  adminPending: z.boolean(),
});
export type AdminBomShipmentCrossItemType = z.infer<typeof AdminBomShipmentCrossItem>;

export const AdminBomShipmentCrossCounts = z.object({
  adminPending: z.number().int(),
  active: z.number().int(), // 입고 전 전체(preparing 포함)
  received: z.number().int(),
});
export type AdminBomShipmentCrossCountsType = z.infer<typeof AdminBomShipmentCrossCounts>;

export const AdminBomShipmentCrossListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['admin_pending', 'active', 'received']).default('admin_pending'),
});
export type AdminBomShipmentCrossListQueryType = z.infer<typeof AdminBomShipmentCrossListQuery>;

export const AdminBomShipmentCrossListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomShipmentCrossItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: AdminBomShipmentCrossCounts,
  }),
});
export type AdminBomShipmentCrossListResponseType = z.infer<
  typeof AdminBomShipmentCrossListResponse
>;

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
  /** 선적 모드·상태(D22) — 문서가 없으면 국가 기본 모드 + 'preparing'(표시 동일). */
  shipmentMode: BomShipmentMode,
  shipmentStatus: BomShipmentStatus,
  /** 입고 확인(검수) 완료 여부. */
  shipmentReceived: z.boolean(),
  /** 다음 선적 단계가 협력사 차례(D22) — 발주 확인(issued) 전·검수 후는 false. */
  shipmentMyTurn: z.boolean(),
  /** 선적(그룹)에 소속됨(§6.10) — "함께 발송" 후보 필터(미소속만 후보). */
  shipmentAttached: z.boolean(),
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
  /** 선적(D21·D22·§6.10) — 핑퐁 진행에 필요한 전부(입고·편차 메모·묶음 소속 포함). */
  shipment: BomShipmentView.pick({
    mode: true,
    status: true,
    carrier: true,
    trackingNumber: true,
    trackingUrl: true,
    shipDate: true,
    shippedAt: true,
    receivedAt: true,
    receivedNote: true,
    files: true,
    groupPos: true,
  }).nullable(),
  items: z.array(BomPoItemView),
});
export type PartnerPoDetailType = z.infer<typeof PartnerPoDetail>;

export const PartnerPoDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerPoDetail,
});
export type PartnerPoDetailResponseType = z.infer<typeof PartnerPoDetailResponse>;

// ── 발송(1급 개념, §6.11) — 포털의 "박스" 단위 뷰. 조작은 대표 발주서(primaryPoId)
// 경유로 기존 poId 라우트를 재사용한다(신규 표면 최소화).

export const PartnerShipmentView = BomShipmentView.extend({
  primaryPoId: z.number(),
  /** 다음 단계가 협력사 차례(검수 전) — 홈 "내 차례" 강조. */
  myTurn: z.boolean(),
});
export type PartnerShipmentViewType = z.infer<typeof PartnerShipmentView>;

// 협력사 관점 완료 = 최종 상태(done|delivered) 도달 또는 입고 확인 — 완료는 양이
// 누적되므로 별도 페이지(페이지네이션)로 분리, 홈은 active(할 일)만 본다.
export const PartnerShipmentListQuery = z.object({
  tab: z.enum(['active', 'done']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(50),
});
export type PartnerShipmentListQueryType = z.infer<typeof PartnerShipmentListQuery>;

export const PartnerShipmentListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartnerShipmentView),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({ active: z.number().int(), done: z.number().int() }),
  }),
});
export type PartnerShipmentListResponseType = z.infer<typeof PartnerShipmentListResponse>;

/** [보내기] 담기(§6.11) — 선택 발주서로 발송(preparing 선적+조인) 생성. 첫 번째가 대표. */
export const PartnerShipmentCreateBody = z.object({
  poIds: z.array(z.number().int().positive()).min(1).max(50),
});
export type PartnerShipmentCreateBodyType = z.infer<typeof PartnerShipmentCreateBody>;

export const PartnerShipmentCreateResponse = z.object({
  result: z.literal(true),
  data: PartnerShipmentView,
});
export type PartnerShipmentCreateResponseType = z.infer<typeof PartnerShipmentCreateResponse>;
