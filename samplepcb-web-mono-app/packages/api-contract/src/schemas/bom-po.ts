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

// 조달 차질·잔량 대체발주(D31) — 원 발주서는 박제 문서로 보존하고 부족 수량만 별도
// 감사 원장에 기록한다. recovery 는 부족분을 이어받은 새 발주 품목이며 고객 확정가는
// 바꾸지 않는다.
export const BOM_PO_SHORTAGE_REASONS = [
  'out_of_stock',
  'insufficient_stock',
  'quality_issue',
  'discontinued',
  'other',
] as const;
export const BomPoShortageReason = z.enum(BOM_PO_SHORTAGE_REASONS);
export type BomPoShortageReasonType = z.infer<typeof BomPoShortageReason>;

export const BOM_PO_SHORTAGE_REASON_LABELS = {
  out_of_stock: '재고 소진',
  insufficient_stock: '수량 부족',
  quality_issue: '품질 문제',
  discontinued: '단종·공급 중단',
  other: '기타',
} as const satisfies Record<BomPoShortageReasonType, string>;

export const BomPoShortageRecoveryView = z.object({
  poId: z.number(),
  poItemId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  qty: z.number().int().positive(),
  receivedAt: z.string().nullable(),
});
export type BomPoShortageRecoveryViewType = z.infer<typeof BomPoShortageRecoveryView>;

export const BomPoShortageView = z.object({
  shortageId: z.number(),
  shortageQty: z.number().int().positive(),
  /** 원 발주 수량 중 실제 공급하기로 남은 수량. */
  suppliedQty: z.number().int().nonnegative(),
  /** 원 발주 단가 × 실제 공급 수량(VAT 별도, 서버 계산). */
  suppliedAmount: z.number().int().nonnegative(),
  reason: BomPoShortageReason,
  note: z.string().nullable(),
  reportedAt: z.string(),
  recovery: BomPoShortageRecoveryView.nullable(),
});
export type BomPoShortageViewType = z.infer<typeof BomPoShortageView>;

export const BomPoRecoverySourceView = z.object({
  shortageId: z.number(),
  sourcePoId: z.number(),
  sourcePartnerName: z.string(),
  shortageQty: z.number().int().positive(),
});
export type BomPoRecoverySourceViewType = z.infer<typeof BomPoRecoverySourceView>;

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
  /** 이 원 발주 품목에 협력사가 신고한 공급 부족. */
  shortage: BomPoShortageView.nullable(),
  /** 이 품목이 어느 부족분을 회복하기 위해 추가 발주됐는지. */
  recoverySource: BomPoRecoverySourceView.nullable(),
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
  international: '국외 발송',
  domestic: '국내 발송',
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
  shipping: '배송 중',
  delivered: '입고 완료',
} as const satisfies Record<BomShipmentStatusType, string>;

/** domestic 모드의 preparing 라벨은 '배송 준비' — 표시 시 모드로 분기. */
export const BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL = '배송 준비';

// ── 핑퐁 전이(D22 — 레거시 절차 승계) ───────────────────────────────────────
// "해당 상태로 진입시키는 주체" 사전(레거시 actorForStatus 미러). 협력사는 자기 차례
// 전이만(서버 인가 — 레거시는 프론트만 검증한 취약점 교정), 관리자는 전 단계 임의 조작.

export type BomShipmentActorType = 'ADMIN' | 'PARTNER';

export const BOM_SHIPMENT_ACTORS: Record<
  BomShipmentModeType,
  Partial<Record<BomShipmentStatusType, BomShipmentActorType>>
> = {
  // 협력사: 선적 요청(출고예정일+인보이스) 한 번뿐 / 관리자: 선적(AWB)·국내도착·통관·완료.
  // 국내도착은 레거시에선 협력사 차례였으나 운송 계약 주체=샘플피씨비(도착 정보도
  // 관리자에게 먼저 옴)라 협력사 추적 부담만 남아 ADMIN 으로 정정(2026-08-02, §6.5).
  international: {
    requested: 'PARTNER',
    shipped: 'ADMIN',
    arrived: 'ADMIN',
    customs: 'ADMIN',
    done: 'ADMIN',
  },
  // 협력사: 배송 중(택배사+송장) / 관리자: 입고 완료(수령확인 전용 API)
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

/** 모드 반영 상태 라벨(국내 preparing='배송 준비' 분기 포함) — 화면·메일 공용. */
export const bomShipmentStatusLabel = (
  mode: BomShipmentModeType,
  status: BomShipmentStatusType,
): string =>
  mode === 'domestic' && status === 'preparing'
    ? BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL
    : BOM_SHIPMENT_STATUS_LABELS[status];

/** 입고 확인 또는 최종 단계 이후 Invoice/AWB 편집을 막는 공용 판정. */
export const bomShipmentDocumentsLocked = (
  mode: BomShipmentModeType,
  status: BomShipmentStatusType,
  receivedAt: string | Date | null,
): boolean => receivedAt !== null || bomShipmentNextStatus(mode, status) === null;

// ── 선적 첨부(D22) — sp_file(refType 'sp_bom_shipment'), 종류별 1건(재업로드=교체) ──

export const BOM_SHIPMENT_FILE_TYPES = ['invoice', 'airwaybill', 'bill_of_lading'] as const;
export type BomShipmentFileTypeType = (typeof BOM_SHIPMENT_FILE_TYPES)[number];
export const BomShipmentFileType = z.enum(BOM_SHIPMENT_FILE_TYPES);

/** 국제 발송 전용 첨부 라벨. 국내 발송은 생성형 견적서·거래명세서를 사용한다.
 *  운송서류는 수단을 따른다 — 항공 AWB / 해상 B/L(2026-08-16). */
export const BOM_SHIPMENT_FILE_LABELS = {
  invoice: 'Invoice',
  airwaybill: 'AWB',
  bill_of_lading: 'B/L',
} as const satisfies Record<BomShipmentFileTypeType, string>;

// ── 운송수단(2026-08-16) — 국제 발송의 두 번째 축, **BOM·PCB 공용 사전** ─────
// mode(international|domestic)가 "국경을 넘는가"라면 transport 는 "무엇으로 나르는가"다.
// 두 축은 직교한다. 해상은 리드타임이 항공과 자릿수로 다르고 **운송서류가 아예 다른
// 문서**(AWB ↔ B/L)라 carrier 문자열 안에 녹일 수 없다 — "머스크"라고 적어도 시스템은
// 그게 해상인 줄 모르고, SF Express 처럼 양쪽 다 하는 회사에서 역추론은 깨진다.
// 국내 체인(택배)엔 이 축이 없다 — 저장은 서버가 국제에서만 한다(mode 게이트).
export const SHIPMENT_TRANSPORTS = ['air', 'sea'] as const;
export type ShipmentTransportType = (typeof SHIPMENT_TRANSPORTS)[number];
export const ShipmentTransport = z.enum(SHIPMENT_TRANSPORTS);
export const SHIPMENT_TRANSPORT_LABELS = {
  air: '항공',
  sea: '해상',
} as const satisfies Record<ShipmentTransportType, string>;

/** 표시 폴백 — null(사전 도입 전 데이터·미선택)은 항공으로 읽어 화면 분기를 2갈래로 유지.
 *  ⚠ **응답 직렬화에는 쓰지 않는다**: 거기서 접으면 "고른 적 없음"이 "항공을 골랐음"으로
 *  굳어 라디오가 처음부터 켜진 채 뜬다(트랙별 asXxxTransport 가 null 을 지킨다). */
export const shipmentTransportOf = (v: string | null | undefined): ShipmentTransportType =>
  v === 'sea' ? 'sea' : 'air';

/** 운송수단별 운송서류 — 항공 AWB(Air Waybill) / 해상 B/L(Bill of Lading). 전이 게이트와
 *  첨부 버튼이 **같은 사전에서** 유도해야 "첨부했는데 409" 가 안 난다. 두 트랙의 파일
 *  사전이 이 두 값을 공유하므로 반환은 리터럴 유니온이다. */
export const shipmentTransportDocType = (
  v: string | null | undefined,
): 'airwaybill' | 'bill_of_lading' =>
  shipmentTransportOf(v) === 'sea' ? 'bill_of_lading' : 'airwaybill';

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
  /** 운송수단 — 국제 전용. null = 미선택(구 데이터·국내). 운송서류(AWB/BL)·운송회사
   *  입력 방식·번호 라벨이 이 값 하나에서 갈린다(2026-08-16). */
  transport: ShipmentTransport.nullable(),
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

// ── 선적 리스트·실물 포장 QR 추적(D24) ─────────────────────────────────────
// 상업송장(invoiceData)의 편집 가능한 행과 분리한다. 발주 품목(poItemId)을 안정 원본으로
// 삼고 릴·트레이·튜브·봉투·박스 같은 실물 관리 단위마다 불투명 QR token 을 1개 발급.

export const BOM_PART_PACKAGE_STATUSES = [
  'prepared',
  'received',
  'inspected',
  'stored',
  'issued',
  'voided',
] as const;
export const BomPartPackageStatus = z.enum(BOM_PART_PACKAGE_STATUSES);
export type BomPartPackageStatusType = z.infer<typeof BomPartPackageStatus>;

export const BOM_PART_PACKAGE_STATUS_LABELS = {
  prepared: '발송 준비',
  received: '입고',
  inspected: '검수 완료',
  stored: '보관 중',
  issued: '자재 출고',
  voided: '무효',
} as const satisfies Record<BomPartPackageStatusType, string>;

export const BOM_PART_EVENT_TYPES = [
  'created',
  'updated',
  'printed',
  'received',
  'inspected',
  'stored',
  'issued',
  'voided',
] as const;
export const BomPartEventType = z.enum(BOM_PART_EVENT_TYPES);
export type BomPartEventTypeType = z.infer<typeof BomPartEventType>;

export const BOM_PART_EVENT_LABELS = {
  created: 'QR 포장 생성',
  updated: '포장 정보 수정',
  printed: '선적 리스트·라벨 인쇄',
  received: '입고 처리',
  inspected: '검수 완료',
  stored: '보관 위치 등록',
  issued: '자재 출고 처리',
  voided: 'QR 무효 처리',
} as const satisfies Record<BomPartEventTypeType, string>;

export const BomPartPackageEvent = z.object({
  eventId: z.number(),
  eventType: BomPartEventType,
  actorType: z.enum(['ADMIN', 'PARTNER', 'SYSTEM']),
  actorMbId: z.string().nullable(),
  fromStatus: BomPartPackageStatus.nullable(),
  toStatus: BomPartPackageStatus.nullable(),
  quantity: z.number().int().positive().nullable(),
  location: z.string().nullable(),
  note: z.string().nullable(),
  occurredAt: z.string(),
});
export type BomPartPackageEventType = z.infer<typeof BomPartPackageEvent>;

export const BomShipmentPackingPackage = z.object({
  /** 아직 저장되지 않은 자동 초안은 null. 저장 후 같은 ID·token 으로 재인쇄한다. */
  packageId: z.number().nullable(),
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  labelCode: z.string().max(24).nullable(),
  packageNo: z.number().int().positive(),
  quantity: z.number().int().positive(),
  lotNo: z.string().max(100).nullable(),
  dateCode: z.string().max(100).nullable(),
  status: BomPartPackageStatus,
  storageLocation: z.string().nullable(),
  receivedAt: z.string().nullable(),
  inspectedAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  events: z.array(BomPartPackageEvent),
});
export type BomShipmentPackingPackageType = z.infer<typeof BomShipmentPackingPackage>;

export const BomShipmentPackingItem = z.object({
  shipmentItemId: z.number().nullable(),
  poItemId: z.number(),
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  /** sp_part 느슨한 참조. 없으면 응용 계층에서 MPN 으로 추측하지 않는다. */
  partId: z.string().nullable(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  expectedQty: z.number().int().positive(),
  packages: z.array(BomShipmentPackingPackage).min(1),
});
export type BomShipmentPackingItemType = z.infer<typeof BomShipmentPackingItem>;

export const BomShipmentPackingList = z.object({
  shipmentId: z.number(),
  packingNo: z.string(),
  revision: z.number().int().nonnegative(),
  editable: z.boolean(),
  partnerName: z.string(),
  mode: BomShipmentMode,
  shipmentStatus: BomShipmentStatus,
  shipDate: z.string().nullable(),
  consigneeCompany: z.string(),
  consigneeAddress: z.string(),
  updatedAt: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  totalItems: z.number().int().nonnegative(),
  totalPackages: z.number().int().nonnegative(),
  totalQuantity: z.number().int().nonnegative(),
  items: z.array(BomShipmentPackingItem).max(200),
});
export type BomShipmentPackingListType = z.infer<typeof BomShipmentPackingList>;

export const BomShipmentPackingListResponse = z.object({
  result: z.literal(true),
  data: BomShipmentPackingList,
});
export type BomShipmentPackingListResponseType = z.infer<typeof BomShipmentPackingListResponse>;

export const BomShipmentPackingListSaveBody = z.object({
  items: z
    .array(
      z.object({
        poItemId: z.number().int().positive(),
        packages: z
          .array(
            z.object({
              packageId: z.number().int().positive().nullable(),
              quantity: z.number().int().positive(),
              lotNo: z.string().trim().max(100).nullable(),
              dateCode: z.string().trim().max(100).nullable(),
            }),
          )
          .min(1)
          .max(20),
      }),
    )
    .min(1)
    .max(200),
});
export type BomShipmentPackingListSaveBodyType = z.infer<typeof BomShipmentPackingListSaveBody>;

export const BOM_PART_PACKAGE_ACTIONS = ['receive', 'inspect', 'store', 'issue'] as const;
export const AdminBomPartPackageActionBody = z.object({
  action: z.enum(BOM_PART_PACKAGE_ACTIONS),
  location: z.string().trim().max(191).nullable(),
  note: z.string().trim().max(2000).nullable(),
});
export type AdminBomPartPackageActionBodyType = z.infer<typeof AdminBomPartPackageActionBody>;

export const AdminBomPartPackageDetail = z.object({
  packageId: z.number(),
  labelCode: z.string(),
  status: BomPartPackageStatus,
  quantity: z.number().int().positive(),
  lotNo: z.string().nullable(),
  dateCode: z.string().nullable(),
  storageLocation: z.string().nullable(),
  receivedAt: z.string().nullable(),
  inspectedAt: z.string().nullable(),
  issuedAt: z.string().nullable(),
  item: z.object({
    shipmentItemId: z.number(),
    poItemId: z.number(),
    partId: z.string().nullable(),
    mpn: z.string(),
    manufacturerName: z.string().nullable(),
    description: z.string().nullable(),
    expectedQty: z.number().int().positive(),
  }),
  po: z.object({
    poId: z.number(),
    quoteId: z.string(),
    quoteTitle: z.string(),
  }),
  shipment: z.object({
    shipmentId: z.number(),
    packingNo: z.string(),
    mode: BomShipmentMode,
    status: BomShipmentStatus,
    partnerName: z.string(),
    carrier: z.string().nullable(),
    trackingNumber: z.string().nullable(),
    shippedAt: z.string().nullable(),
    receivedAt: z.string().nullable(),
  }),
  events: z.array(BomPartPackageEvent),
});
export type AdminBomPartPackageDetailType = z.infer<typeof AdminBomPartPackageDetail>;

export const AdminBomPartPackageResponse = z.object({
  result: z.literal(true),
  data: AdminBomPartPackageDetail,
});
export type AdminBomPartPackageResponseType = z.infer<typeof AdminBomPartPackageResponse>;

// 관리자 등록/수정 — mode는 협력사 국가로 서버가 결정하므로 클라이언트가 보내지 않는다.
// 국내 최종 단계(delivered)는 이 요청이 아니라 입고 확인 전용 API로만 진입한다.
export const AdminBomShipmentUpsertBody = z.object({
  status: BomShipmentStatus.optional(),
  /** 운송수단 — 국제 전용(국내에서 오면 서버가 버린다). 바꾸면 앞서 박힌 운송회사·
   *  운송장이 함께 비워진다(남의 수단 값이 남지 않게). */
  transport: ShipmentTransport.nullish(),
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
  /** 운송수단 — '선적 요청'에 얹혀 박제된다(국제 전용). 바꾸려면 되돌리기로 준비
   *  단계에 복귀해 다시 보낸다. PCB 트랙과 같은 사전·같은 규칙이다. */
  transport: ShipmentTransport.nullish(),
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

// ── 협력사 거래 문서 — PO별 견적서 + 선적별 거래명세서 ─────────────────────
// 고객 BOM 견적서와 발행 방향이 반대다. 협력사가 발행자, 샘플피씨비가 수신자이며
// 관리자와 협력사 포털이 같은 서버 스냅샷을 조회·인쇄한다.

export const BomTradeParty = z.object({
  companyName: z.string(),
  businessNo: z.string(),
  ownerName: z.string(),
  zip: z.string(),
  address: z.string(),
  businessType: z.string(),
  businessItem: z.string(),
  contactName: z.string(),
  tel: z.string(),
  fax: z.string(),
  email: z.string(),
  country: z.string(),
});
export type BomTradePartyType = z.infer<typeof BomTradeParty>;

export const BomPartnerQuotationItem = z.object({
  poItemId: z.number(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  qty: z.number().int().positive(),
  unitPrice: z.number(),
  lineTotal: z.number().int(),
  moq: z.number().int().positive().nullable(),
  stock: z.number().int().nonnegative().nullable(),
  dateCode: z.string().nullable(),
  leadTime: z.string().nullable(),
  memo: z.string().nullable(),
});
export type BomPartnerQuotationItemType = z.infer<typeof BomPartnerQuotationItem>;

export const BomPartnerQuotation = z.object({
  kind: z.literal('quotation'),
  quotationNo: z.string(),
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  issuedAt: z.string(),
  deliveryDate: z.string().nullable(),
  currency: z.string(),
  issuer: BomTradeParty,
  recipient: BomTradeParty,
  items: z.array(BomPartnerQuotationItem).max(500),
  supplyAmount: z.number().int(),
  vatAmount: z.number().int(),
  totalAmount: z.number().int(),
  memo: z.string().nullable(),
  snapshotAt: z.string(),
});
export type BomPartnerQuotationType = z.infer<typeof BomPartnerQuotation>;

export const BomPartnerQuotationResponse = z.object({
  result: z.literal(true),
  data: BomPartnerQuotation,
});
export type BomPartnerQuotationResponseType = z.infer<typeof BomPartnerQuotationResponse>;

export const BomShipmentStatementItem = z.object({
  poId: z.number(),
  quoteId: z.string(),
  quoteTitle: z.string(),
  poItemId: z.number(),
  mpn: z.string(),
  manufacturerName: z.string().nullable(),
  description: z.string().nullable(),
  orderedQty: z.number().int().positive(),
  shippedQty: z.number().int().positive(),
  unitPrice: z.number(),
  lineTotal: z.number().int(),
  lotNos: z.array(z.string()),
  dateCodes: z.array(z.string()),
});
export type BomShipmentStatementItemType = z.infer<typeof BomShipmentStatementItem>;

export const BomShipmentStatement = z.object({
  kind: z.literal('statement'),
  statementNo: z.string(),
  shipmentId: z.number(),
  packingRevision: z.number().int().nonnegative(),
  isDraft: z.boolean(),
  issuedAt: z.string(),
  finalizedAt: z.string().nullable(),
  mode: BomShipmentMode,
  currency: z.string(),
  issuer: BomTradeParty,
  recipient: BomTradeParty,
  shipDate: z.string().nullable(),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
  items: z.array(BomShipmentStatementItem).max(500),
  totalQuantity: z.number().int().nonnegative(),
  supplyAmount: z.number().int(),
  vatAmount: z.number().int(),
  totalAmount: z.number().int(),
  snapshotAt: z.string(),
});
export type BomShipmentStatementType = z.infer<typeof BomShipmentStatement>;

export const BomShipmentStatementResponse = z.object({
  result: z.literal(true),
  data: BomShipmentStatement,
});
export type BomShipmentStatementResponseType = z.infer<typeof BomShipmentStatementResponse>;

export const BomTradeDocument = z.discriminatedUnion('kind', [
  BomPartnerQuotation,
  BomShipmentStatement,
]);
export type BomTradeDocumentType = z.infer<typeof BomTradeDocument>;

// ── 관리자 (/api/admin/bom-quotes/:id/pos) ──────────────────────────────────

export const AdminBomPoView = z.object({
  poId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  /** 공급사 발주면 코드(mouser|digikey|…), 사람 협력사면 null. */
  supplierCode: z.string().nullable(),
  /** 실제 발송 출발국의 단일 기준. 레거시 조직은 미입력일 수 있다. */
  partnerCountry: z.string().nullable(),
  /** 기존 선적 mode 또는 국가에서 서버가 파생한 신규 선적 mode. 국가 미입력은 null. */
  shipmentMode: BomShipmentMode.nullable(),
  /** 기존 박제 mode와 현재 등록 국가가 다른 레거시/운영 데이터 경고. */
  shipmentModeMismatch: z.boolean(),
  status: BomPoStatus,
  totalAmount: z.number().int(), // KRW, VAT 별도
  /** 공급 부족을 제외한 실제 공급 예정 합계(VAT 별도, 서버 계산). */
  actualSupplyAmount: z.number().int().nonnegative(),
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

export const AdminBomShortageCandidate = z.object({
  rfqItemId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  partnerCountry: z.string().nullable(),
  /** 국가에서 서버가 판정한 물류 방식. 국가 미등록 후보는 null. */
  shipmentMode: BomShipmentMode.nullable(),
  unitPrice: z.number(),
  stock: z.number().int().nullable(),
  leadTime: z.string().nullable(),
  dateCode: z.string().nullable(),
  memo: z.string().nullable(),
  eligible: z.boolean(),
  ineligibleReason: z.string().nullable(),
});
export type AdminBomShortageCandidateType = z.infer<typeof AdminBomShortageCandidate>;

export const AdminBomShortageCandidatesResponse = z.object({
  result: z.literal(true),
  data: z.object({
    shortageId: z.number(),
    quoteItemId: z.string(),
    mpn: z.string(),
    shortageQty: z.number().int().positive(),
    candidates: z.array(AdminBomShortageCandidate),
  }),
});
export type AdminBomShortageCandidatesResponseType = z.infer<
  typeof AdminBomShortageCandidatesResponse
>;

export const AdminBomShortageRecoverBody = z.object({
  rfqItemId: z.number().int().positive(),
  memo: z.string().trim().max(2000).nullish(),
});
export type AdminBomShortageRecoverBodyType = z.infer<typeof AdminBomShortageRecoverBody>;

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
  /** 선적 모드·상태(D22). 문서가 없고 국가도 미입력이면 둘 다 null이다. */
  shipmentMode: BomShipmentMode.nullable(),
  shipmentStatus: BomShipmentStatus.nullable(),
  /** 새 발송을 만들 수 있도록 협력사 국가가 등록됐거나 기존 선적이 이미 존재한다. */
  shipmentCountryReady: z.boolean(),
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
  /** 공급 부족을 제외한 실제 공급 예정 합계(VAT 별도, 서버 계산). */
  actualSupplyAmount: z.number().int().nonnegative(),
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

export const PartnerPoShortageCreateBody = z.object({
  poItemId: z.number().int().positive(),
  shortageQty: z.number().int().positive(),
  reason: BomPoShortageReason,
  note: z.string().trim().max(1000).nullish(),
});
export type PartnerPoShortageCreateBodyType = z.infer<typeof PartnerPoShortageCreateBody>;

export const PartnerPoShortageUpdateBody = PartnerPoShortageCreateBody.omit({ poItemId: true });
export type PartnerPoShortageUpdateBodyType = z.infer<typeof PartnerPoShortageUpdateBody>;

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
