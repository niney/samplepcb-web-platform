import { z } from 'zod';

// ── PCB 파트너 트랙 — sp_pcb_rfq 계약 ───────────────────────────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md §5. BOM RFQ(bom-rfq.ts)와 달리 부품행 계층이
// 없는 **단일가 문서**(레거시 sp_pcb_partner_order 대응). 앵커는 sp_order_spec(specId).
// 통화 3종(결제·입력 분리)·MD 2단 중개는 1차 포함(§6 D1·D2, 2026-08-04 확정).
// 상태는 DB 영문 코드 + 이 사전의 한글 라벨(D4 — 레거시 한글 리터럴 오염 함정 회피).

export const PCB_RFQ_STATUSES = ['requested', 'quoted', 'selected', 'unselected'] as const;
export type PcbRfqStatusType = (typeof PCB_RFQ_STATUSES)[number];
export const PcbRfqStatus = z.enum(PCB_RFQ_STATUSES);

export const PCB_RFQ_STATUS_LABELS = {
  requested: '회신 대기',
  quoted: '회신 완료',
  selected: '선정',
  unselected: '미선정',
} as const satisfies Record<PcbRfqStatusType, string>;

// 링크별 결제통화(레거시 최종형 승계) — 한 링크(관리자↔협력사·MD↔하위) = 한 통화.
// 각 당사자는 자기 통화만 보고, 환율은 변환점(회신 환산·MD 마진·관리자 선정)에서만 박제.
export const PCB_CURRENCIES = ['KRW', 'USD', 'CNY'] as const;
export type PcbCurrencyType = (typeof PCB_CURRENCIES)[number];
export const PcbCurrency = z.enum(PCB_CURRENCIES);

export const PCB_CURRENCY_SYMBOLS = {
  KRW: '₩',
  USD: '$',
  CNY: '¥',
} as const satisfies Record<PcbCurrencyType, string>;

// ── 회신 입력(협력사 포털 · 관리자 대리 입력 · 매직링크 공용) ────────────────
// price 는 **입력통화 기준 원본**. 서버가 결제통화로 환산해 정본(priceOriginal)을 박제
// 하고, 입력≠결제일 때만 sub_*(원본 3종)를 남긴다(같으면 명시적 null 클리어 — 정정 시
// 잔존 방지, 레거시 승계). 납기(quotedDeliveryDate)는 **필수** — 선정 판단 신호.
export const PcbRfqReplyBody = z.object({
  price: z.number().positive(),
  /** 생략 = 결제통화 그대로 입력. 지정 시 서버가 입력→결제 환율로 환산 박제. */
  inputCurrency: PcbCurrency.optional(),
  quotedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type PcbRfqReplyBodyType = z.infer<typeof PcbRfqReplyBody>;

// ── 공용 뷰 — 견적행 1건(관리자·MD 화면 공유, 파트너 뷰는 아래 별도 축소판) ──
export const AdminPcbRfqView = z.object({
  rfqId: z.number(),
  specId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  /** 0=관리자 직접 트랙, 그 외=MD 조직 id(2단 중개). */
  parentPartnerId: z.number(),
  parentPartnerName: z.string().nullable(),
  reorderRound: z.number().int(),
  status: PcbRfqStatus,
  // 금액 3값 표시 로직(§7-5): main(currency, priceOriginal, krwAmount) + sub(입력 원본).
  currency: z.string(),
  priceOriginal: z.number().nullable(),
  exchangeRate: z.number().nullable(),
  krwAmount: z.number().nullable(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  // MD 변환점 박제 — priceOriginal = sourceAmount × sourceRate × (1+marginRate/100).
  selectedChildRfqId: z.number().nullable(),
  marginRate: z.number().nullable(),
  sourceCurrency: z.string().nullable(),
  sourceAmount: z.number().nullable(),
  sourceRate: z.number().nullable(),
  // 납기 신호 — 제시 vs 회신 불일치 = '변경됨' 배지, 과거 날짜 = 경고.
  suggestedDeliveryDate: z.string().nullable(),
  quotedDeliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  selectedAt: z.string().nullable(),
  /** 매직링크 토큰 — [링크 복사]용(관리자 트랙만, MD 하위 행은 null). */
  magicToken: z.string().nullable(),
  /** MD 행 전용 하위 집계(관리자 화면에서 "협력사 n · 회신 m" 배지). */
  childCount: z.number().int(),
  childQuotedCount: z.number().int(),
});
export type AdminPcbRfqViewType = z.infer<typeof AdminPcbRfqView>;

// ── 관리자: 스펙별 RFQ 현황 (/api/admin/pcb-projects/:id/rfqs) ───────────────
// 전 트랙 행을 평면 반환(직속 parent=0 + MD 하위) — 그룹핑은 프론트 표시 책임.
export const AdminPcbRfqListResponse = z.object({
  result: z.literal(true),
  data: z.object({ rfqs: z.array(AdminPcbRfqView) }),
});
export type AdminPcbRfqListResponseType = z.infer<typeof AdminPcbRfqListResponse>;

// diff 배정 — 선택 협력사 집합으로 수렴: 빠진 미회신(requested)만 삭제, 회신(quoted)
// 보존, 신규만 생성·메일(BOM §2.4 동형·레거시 addedMbNoList 승계). 0곳 = 미회신 전부 회수.
export const AdminPcbRfqSendBody = z.object({
  partnerIds: z.array(z.number().int().positive()).max(50),
  /** 제시 납기(하향 상속 prefill 원천) — 신규 생성분에만 박제. */
  suggestedDeliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type AdminPcbRfqSendBodyType = z.infer<typeof AdminPcbRfqSendBody>;

export const AdminPcbRfqSendResponse = z.object({
  result: z.literal(true),
  data: z.object({
    added: z.number().int(),
    kept: z.number().int(),
    removed: z.number().int(),
    rfqs: z.array(AdminPcbRfqView),
  }),
});
export type AdminPcbRfqSendResponseType = z.infer<typeof AdminPcbRfqSendResponse>;

export const AdminPcbRfqReplyResponse = z.object({
  result: z.literal(true),
  data: AdminPcbRfqView,
});
export type AdminPcbRfqReplyResponseType = z.infer<typeof AdminPcbRfqReplyResponse>;

// 관리자 선정 — 같은 트랙(parent=0) 1곳만.
// exchangeRate: 외화 행의 결제통화→KRW 박제 환율. **생략 시 당일 수출입은행 캐시를
//   서버가 자동 적용**(회신 환산·MD 마진과 같은 의미론 — 캐시 미준비면 400). 명시값은
//   오버라이드. KRW 행은 무시.
// finalPrice: 판매가(고객 확정가, VAT 포함 KRW). 주면 선정과 **한 번에** 등록한다
//   (레거시 선정 모달의 마진%↔판매가 통합 복원). 게이트는 확정가 PATCH 와 동일
//   (미담김·미주문 — 판매가 불변)이며 선정 전에 선검사해 부분 성공을 막는다.
//   생략 시 선정만(판매가는 기존 PATCH /admin/pcb-projects/:id/price 로 별도).
export const AdminPcbRfqSelectBody = z.object({
  exchangeRate: z.number().positive().optional(),
  finalPrice: z.number().int().positive().max(2_000_000_000).optional(),
});
export type AdminPcbRfqSelectBodyType = z.infer<typeof AdminPcbRfqSelectBody>;

export const AdminPcbRfqActionResponse = z.object({ result: z.literal(true) });
export type AdminPcbRfqActionResponseType = z.infer<typeof AdminPcbRfqActionResponse>;

// 선정 모달 prefill 용 당일 환율(수출입은행 캐시) — 미준비면 data null(수동 입력 유도).
export const AdminPcbExchangeRateResponse = z.object({
  result: z.literal(true),
  data: z.object({ rate: z.number(), rateDate: z.string().nullable() }).nullable(),
});
export type AdminPcbExchangeRateResponseType = z.infer<typeof AdminPcbExchangeRateResponse>;

// 매직링크 재발급 — 구 토큰 즉시 무효(회전 회수). [링크 복사]는 응답 토큰으로 즉시 조립.
export const AdminPcbRfqMagicLinkResponse = z.object({
  result: z.literal(true),
  data: z.object({ magicToken: z.string() }),
});
export type AdminPcbRfqMagicLinkResponseType = z.infer<typeof AdminPcbRfqMagicLinkResponse>;

// MD 하위 선정(포털) — childRfqId=null 은 해제(마진·source_* 초기화, 회신가 소거).
// 서버 계산: priceOriginal = 하위 결제금액 × getRate(하위통화→MD결제통화) × (1+마진%).
export const PcbRfqChildSelectBody = z.object({
  childRfqId: z.number().int().positive().nullable(),
  /** 정수 %(레거시 승계). 선정 시 필수 — 해제 시 무시. */
  marginRate: z.number().int().min(0).max(500).optional(),
});
export type PcbRfqChildSelectBodyType = z.infer<typeof PcbRfqChildSelectBody>;

// ── 원가 ↔ 판매가(마진) 환산 — 레거시 선정 모달 공식이 정본 ──────────────────
// 판매가 = 원가KRW × (1+마진%) × 1.1(VAT). 두 방향을 한 자리에 둔다: 선정 모달은
// 정방향(마진 입력 → 판매가), 목록은 역산(확정가 → 마진 배지)을 쓰는데, 각자 계산하면
// **같은 건이 화면마다 다른 마진을 말한다**. 특히 VAT 를 빠뜨린 역산은 마진을 10%p 가까이
// 부풀려 보고하므로(확정가는 VAT 포함 판매가) 이 나눗셈은 반드시 여기를 거쳐야 한다.
export const PCB_VAT_RATE = 1.1;

/** 원가 KRW + 마진% → 판매가(VAT 포함, 원 단위 반올림). */
export const pcbSellingPrice = (costKrw: number, marginPercent: number): number =>
  Math.round(costKrw * (1 + marginPercent / 100) * PCB_VAT_RATE);

/**
 * 판매가(VAT 포함) + 원가 KRW → 마진%(소수 첫째 자리). 원가가 0 이하면 나눌 수 없어 null.
 * 음수도 그대로 돌려준다 — 원가보다 싸게 판 건은 감출 게 아니라 보여야 할 신호다.
 */
export const pcbMarginPercent = (sellingPrice: number, costKrw: number): number | null =>
  costKrw <= 0 ? null : Math.round((sellingPrice / PCB_VAT_RATE / costKrw - 1) * 1000) / 10;

// ── 관리자: 횡단 워크큐 (/api/admin/pcb-rfqs) — 스펙(견적건) 단위 그룹 ────────
export const ADMIN_PCB_RFQ_TABS = ['pending', 'quoted', 'selected', 'all'] as const;
export type AdminPcbRfqTabType = (typeof ADMIN_PCB_RFQ_TABS)[number];

export const AdminPcbRfqCaseItem = z.object({
  specId: z.number(),
  projectName: z.string(),
  mbId: z.string().nullable(),
  /** 고객 표시명 — 주문 시점 od_name > 회원 mb_name(lib/pcb-customer 단일 사전), 없으면 ''. */
  customerName: z.string(),
  category: z.string(),
  orderCategory: z.string(),
  qty: z.number().int(),
  quoteStatus: z.string(), // priced|rfq|quoted — 스펙의 고객 견적 상태(확정가 게이트 표시)
  finalPrice: z.number().nullable(),
  rfqTotal: z.number().int(), // 직속(parent=0) 트랙 행 수
  rfqQuoted: z.number().int(), // 그중 회신 완료 수(quoted+selected)
  selectedPartnerName: z.string().nullable(),
  /** 선정가(우리 원가) — 선정 시점에 행에 박제된 값 그대로다: 결제통화 원값 + 그때 환율의
   *  KRW 환산. 오늘 환율로 다시 계산하지 않는다(선정 후 환율이 움직여도 원가는 그날 값).
   *  선정 전이면 셋 다 null. KRW 결제면 krwAmount 는 원값과 같다. */
  selectedCurrency: z.string().nullable(),
  selectedPrice: z.number().nullable(),
  selectedKrwAmount: z.number().nullable(),
  latestRequestedAt: z.string(),
  specCreatedAt: z.string(),
});
export type AdminPcbRfqCaseItemType = z.infer<typeof AdminPcbRfqCaseItem>;

export const AdminPcbRfqCaseListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbRfqCaseItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({
      pending: z.number().int(), // 회신 대기 행이 남은 스펙 수
      quoted: z.number().int(), // 회신은 모였고 선정 전(내 차례)
      selected: z.number().int(), // 선정 완료(확정가 등록 대기 포함)
      all: z.number().int(),
    }),
  }),
});
export type AdminPcbRfqCaseListResponseType = z.infer<typeof AdminPcbRfqCaseListResponse>;

// ── 협력사 포털 (/api/partner/pcb-rfqs, requirePartner) ──────────────────────
// 노출 범위: 스펙 사양·수량·요청사항·거버 파일과 자기 회신뿐 — 주문자 연락처·고객
// 가격(확정가/자동가)은 구조적으로 스키마에 없다(서버 PII 제거, §7-6).

export const PartnerPcbRfqListItem = z.object({
  rfqId: z.number(),
  projectName: z.string(),
  category: z.string(),
  qty: z.number().int(),
  status: PcbRfqStatus,
  /** 발주처 표시 — 관리자 트랙이면 자사명(SamplePCB), MD 하위 트랙이면 MD 조직명. */
  requesterName: z.string(),
  currency: z.string(), // 이 링크의 결제통화
  inputCurrency: z.string().nullable(), // 내 조직 입력통화 설정(토글 제안용)
  priceOriginal: z.number().nullable(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  suggestedDeliveryDate: z.string().nullable(),
  quotedDeliveryDate: z.string().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
});
export type PartnerPcbRfqListItemType = z.infer<typeof PartnerPcbRfqListItem>;

export const PartnerPcbRfqListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PartnerPcbRfqListItem), partnerName: z.string() }),
});
export type PartnerPcbRfqListResponseType = z.infer<typeof PartnerPcbRfqListResponse>;

// 스펙 사양 뷰 — specJson 은 카테고리별 자유 키라 passthrough 로 전달하되, 서버가
// 언더스코어 예약키(_legacy 등 내부 메타)를 strip 한 뒤 직렬화한다(§7-6 함정).
export const PartnerPcbSpecFile = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  fileType: z.string().nullable(), // gerber|drawing|…(thumbnail 제외)
});
export type PartnerPcbSpecFileType = z.infer<typeof PartnerPcbSpecFile>;

export const PartnerPcbRfqDetail = z.object({
  rfqId: z.number(),
  status: PcbRfqStatus,
  requesterName: z.string(),
  currency: z.string(),
  inputCurrency: z.string().nullable(),
  priceOriginal: z.number().nullable(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  suggestedDeliveryDate: z.string().nullable(),
  quotedDeliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  requestedAt: z.string(),
  respondedAt: z.string().nullable(),
  spec: z.object({
    projectName: z.string(),
    category: z.string(),
    orderCategory: z.string(),
    qty: z.number().int(),
    message: z.string().nullable(), // 고객 요청사항(제작 요구 — 노출)
    specJson: z.record(z.string(), z.unknown()),
    files: z.array(PartnerPcbSpecFile),
  }),
  /** MD 전용 — 내가 하위에 재요청한 트랙(내 조직이 parent). 일반 협력사는 빈 배열. */
  children: z.array(AdminPcbRfqView),
  /** MD 전용 — 배정 후보(내 소속 하위 조직). */
  myChildPartners: z.array(
    z.object({
      partnerId: z.number(),
      name: z.string(),
      settlementCurrency: z.string().nullable(), // null=기본 USD(런타임)
    }),
  ),
});
export type PartnerPcbRfqDetailType = z.infer<typeof PartnerPcbRfqDetail>;

export const PartnerPcbRfqDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerPcbRfqDetail,
});
export type PartnerPcbRfqDetailResponseType = z.infer<typeof PartnerPcbRfqDetailResponse>;

// ── 매직링크 무로그인 회신 — BOM §6.9 동형(토큰=신원, RFQ 1건 스코프) ─────────
// MD 확장(children 등)은 싣지 않는다 — 매직링크는 단순 회신 전용.
export const MagicPcbRfqResponse = z.object({
  result: z.literal(true),
  data: z.object({
    partnerName: z.string(),
    rfq: PartnerPcbRfqDetail.omit({ children: true, myChildPartners: true }),
  }),
});
export type MagicPcbRfqResponseType = z.infer<typeof MagicPcbRfqResponse>;
