import { z } from 'zod';

// 고객 BOM 견적(스마트 BOM) — 업로드→파싱→매칭→검토→견적요청(RFQ) 계약.
// 설계: docs/BOM_QUOTE.md. 수량·금액의 단일 진실은 저장된 orderQty·selectedOffer
// 스냅샷이며(레거시 '박제' 원칙 보존), 합계는 항상 서버가 재계산한다(클라 금액 불신).

export const BomQuoteStatus = z.enum(['draft', 'requested', 'reviewing', 'answered', 'closed', 'canceled']);
export type BomQuoteStatusType = z.infer<typeof BomQuoteStatus>;

export const BomQuoteMatchStatus = z.enum(['auto', 'manual', 'none']);
export type BomQuoteMatchStatusType = z.infer<typeof BomQuoteMatchStatus>;

/** 라인에 박제되는 오퍼 스냅샷 — 견적요청 후 재선정하지 않는다(시점 고정). */
export const BomQuoteSelectedOffer = z.object({
  supplier: z.string(),
  supplierSku: z.string(),
  packaging: z.string().nullable(),
  /** 적용된 가격구간(주문수량 기준). */
  breakQty: z.number().int(),
  unitPrice: z.number(),
  currency: z.string(),
  /** KRW 환산 단가(예상) — 비KRW·환율 미설정이면 null(미환산). */
  unitPriceKrw: z.number().nullable(),
  moq: z.number().int().nullable(),
  orderMultiple: z.number().int().nullable(),
  stock: z.number().int().nullable(),
  /** 선택 시점의 가격구간 사다리 전체 — 수량 변경 시 구간 재계산의 근거(스냅샷). */
  priceBreaks: z.array(z.object({ qty: z.number().int(), price: z.number() })),
  fetchedAt: z.string(),
  /** 사용자가 명시 선택(고정) — 수량 변경 시 이 오퍼 안에서만 구간 재계산. */
  pinned: z.boolean(),
});
export type BomQuoteSelectedOfferType = z.infer<typeof BomQuoteSelectedOffer>;

/** 클라이언트 → 서버 항목(PATCH 는 draft 한정 replace-all — 레거시 문서 자동저장 방식). */
export const BomQuoteItemInput = z.object({
  rowIdx: z.number().int().min(0),
  /** 합계·견적요청에 포함 여부 — items 와 합계의 기준을 동일하게(레거시 결함 교정). */
  included: z.boolean(),
  mpn: z.string().min(1).max(191),
  manufacturerName: z.string().max(191).nullable(),
  description: z.string().max(1000).nullable(),
  bomQty: z.number().int().min(1),
  /** 박제된 주문수량(=max(BOM수량×세트, MOQ)→배수 올림) — 단일 진실. */
  orderQty: z.number().int().min(0),
  matchStatus: BomQuoteMatchStatus,
  /** 카탈로그(sp_part) 연결 — 매칭 안 됐으면 null. */
  partId: z.string().nullable(),
  selectedOffer: BomQuoteSelectedOffer.nullable(),
  /** 원본 행 근거(엑셀 셀 값들) — 검토·감사용. */
  sourceRow: z.record(z.string(), z.unknown()).nullable(),
});
export type BomQuoteItemInputType = z.infer<typeof BomQuoteItemInput>;

/** 서버 → 클라이언트 항목(서버 계산 필드 포함). */
export const BomQuoteItem = BomQuoteItemInput.extend({
  /** 단가×주문수량 KRW 환산(예상) — 미환산이면 null(화면 경고). */
  lineTotalKrw: z.number().nullable(),
});
export type BomQuoteItemType = z.infer<typeof BomQuoteItem>;

export const BomQuoteSummary = z.object({
  id: z.string(),
  title: z.string(),
  status: BomQuoteStatus,
  fileName: z.string().nullable(),
  itemCount: z.number().int(),
  includedCount: z.number().int(),
  matchedCount: z.number().int(),
  finalTotal: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  requestedAt: z.string().nullable(),
  answeredAt: z.string().nullable(),
});
export type BomQuoteSummaryType = z.infer<typeof BomQuoteSummary>;

export const BomQuoteDetail = BomQuoteSummary.extend({
  engineJobId: z.string().nullable(),
  setQty: z.number().int().min(1),
  spareQty: z.number().int().min(0),
  /** 부품 합계(KRW, included 라인) — 서버 재계산 스냅샷. */
  itemsTotal: z.number(),
  /** 예상 운송료·관리비(sp_config 기본값 스냅샷, 확정 시 변동 가능). */
  shippingFee: z.number(),
  managementFee: z.number(),
  finalTotal: z.number(),
  /** 환산에 사용한 USD→KRW 환율(미설정 null). */
  usdKrwRateUsed: z.number().nullable(),
  /** included 인데 금액 미산정(오퍼 없음·미환산) 라인 수. */
  uncostedCount: z.number().int(),
  customerMemo: z.string().nullable(),
  /** 관리자 확정 회신(answered 이후) — null 이면 미회신. */
  confirmedShippingFee: z.number().nullable(),
  confirmedManagementFee: z.number().nullable(),
  confirmedTotal: z.number().nullable(),
  /** 고객에게 보여줄 회신 메모(내부 adminMemo 와 분리). */
  answerNote: z.string().nullable(),
  items: z.array(BomQuoteItem),
});
export type BomQuoteDetailType = z.infer<typeof BomQuoteDetail>;

// ── 요청 바디 ──────────────────────────────────────────────────────────────

/** draft 자동저장(디바운스) — items 는 replace-all. draft 상태에서만 허용. */
export const BomQuotePatchBody = z.object({
  title: z.string().trim().min(1).max(191).optional(),
  setQty: z.number().int().min(1).max(100000).optional(),
  spareQty: z.number().int().min(0).max(100000).optional(),
  customerMemo: z.string().max(2000).nullable().optional(),
  items: z.array(BomQuoteItemInput).max(2000).optional(),
});
export type BomQuotePatchBodyType = z.infer<typeof BomQuotePatchBody>;

/** 카탈로그 매칭 — 기본은 미매칭 라인만(수동 선택 pinned 보존). */
export const BomQuoteCatalogMatchBody = z.object({
  onlyUnmatched: z.boolean().default(true),
});
export type BomQuoteCatalogMatchBodyType = z.infer<typeof BomQuoteCatalogMatchBody>;

export const BomQuoteRequestBody = z.object({
  title: z.string().trim().min(1).max(191),
});
export type BomQuoteRequestBodyType = z.infer<typeof BomQuoteRequestBody>;

// ── 응답 ──────────────────────────────────────────────────────────────────

export const BomQuoteOkResponse = z.object({ result: z.literal(true) });
export type BomQuoteOkResponseType = z.infer<typeof BomQuoteOkResponse>;

export const BomQuoteCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ quoteId: z.string(), jobId: z.string() }),
});
export type BomQuoteCreateResponseType = z.infer<typeof BomQuoteCreateResponse>;

export const BomQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(BomQuoteSummary),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});
export type BomQuoteListResponseType = z.infer<typeof BomQuoteListResponse>;

export const BomQuoteDetailResponse = z.object({ result: z.literal(true), data: BomQuoteDetail });
export type BomQuoteDetailResponseType = z.infer<typeof BomQuoteDetailResponse>;

// ── 관리자 ────────────────────────────────────────────────────────────────

export const AdminBomQuoteSummary = BomQuoteSummary.extend({
  mbId: z.string(),
});
export type AdminBomQuoteSummaryType = z.infer<typeof AdminBomQuoteSummary>;

export const AdminBomQuoteDetail = BomQuoteDetail.extend({
  mbId: z.string(),
  /** 내부 메모 — 고객 응답에는 싣지 않는다. */
  adminMemo: z.string().nullable(),
  /** 원본 파일 다운로드 URL(서명) — 없으면 null. */
  fileUrl: z.string().nullable(),
});
export type AdminBomQuoteDetailType = z.infer<typeof AdminBomQuoteDetail>;

export const AdminBomQuoteListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminBomQuoteSummary),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});
export type AdminBomQuoteListResponseType = z.infer<typeof AdminBomQuoteListResponse>;

export const AdminBomQuoteDetailResponse = z.object({
  result: z.literal(true),
  data: AdminBomQuoteDetail,
});
export type AdminBomQuoteDetailResponseType = z.infer<typeof AdminBomQuoteDetailResponse>;

/** 관리자 검토 — 상태 전이(requested→reviewing→answered→closed)와 확정가 입력. */
export const AdminBomQuotePatchBody = z.object({
  status: BomQuoteStatus.optional(),
  adminMemo: z.string().max(4000).nullable().optional(),
  answerNote: z.string().max(4000).nullable().optional(),
  confirmedShippingFee: z.number().int().min(0).nullable().optional(),
  confirmedManagementFee: z.number().int().min(0).nullable().optional(),
  confirmedTotal: z.number().int().min(0).nullable().optional(),
});
export type AdminBomQuotePatchBodyType = z.infer<typeof AdminBomQuotePatchBody>;

// ── 설정(sp_config bom_quote — 관리자 편집) ────────────────────────────────

export const BomQuoteConfig = z.object({
  /** 예상 운송료 기본값(KRW) — 레거시 하드코딩 30000 의 승격. */
  defaultShippingFee: z.number().int().min(0),
  /** 예상 관리비 기본값(KRW) — 레거시 하드코딩 25000 의 승격. */
  defaultManagementFee: z.number().int().min(0),
  /** USD→KRW 환산 환율(수동 설정, null=미환산 표시). */
  usdKrwRate: z.number().positive().nullable(),
  /** 공급사 검색 1회 최대 외부 호출 수(엔진 max_calls 상한). */
  supplierSearchMaxCalls: z.number().int().min(1).max(200),
  /** 회원별 1일 공급사 검색 횟수 제한. */
  memberDailySearchLimit: z.number().int().min(1).max(1000),
});
export type BomQuoteConfigType = z.infer<typeof BomQuoteConfig>;

export const BomQuoteConfigResponse = z.object({ result: z.literal(true), data: BomQuoteConfig });
export type BomQuoteConfigResponseType = z.infer<typeof BomQuoteConfigResponse>;
