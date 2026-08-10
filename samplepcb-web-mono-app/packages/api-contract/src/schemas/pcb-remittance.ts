import { z } from 'zod';
import { PcbPoStatus } from './pcb-po';

// ── PCB 송금 원장 계약(P3.11) — 설계 정본: docs/PCB_PARTNER_TRACK.md §5.4·D15 ──
// 발주서 1:N 송금. 상태 한 칸이 아니라 원장인 이유는 **부분·분할 송금이 실재**하기
// 때문이다(결제조건 '50% PRE-PAID' 를 고를 수 있는데 송금은 한 줄만 받던 모순).
//
// 통화 규율: 송금 통화는 **발주 통화로 고정**한다(서버가 발주서에서 가져오며 클라이언트가
// 정하지 않는다). 잔액을 같은 통화로만 빼기 위해서다 — 통화를 섞으면 합계가 거짓말을 한다.
// KRW 환산은 송금 건의 **실제 적용 환율**로 따로 박제한다(발주 시점 환율과 다르다).

export const PCB_REMITTANCE_STATUSES = ['unpaid', 'partial', 'paid', 'over'] as const;
export type PcbRemittanceStatusType = (typeof PCB_REMITTANCE_STATUSES)[number];
export const PcbRemittanceStatus = z.enum(PCB_REMITTANCE_STATUSES);

export const PCB_REMITTANCE_STATUS_LABELS = {
  unpaid: '송금 전',
  partial: '부분 송금',
  paid: '송금 완료',
  over: '과지급',
} as const satisfies Record<PcbRemittanceStatusType, string>;

/** 송금 증빙(이체 확인증) — sp_file refType 'sp_pcb_remittance'. */
export const PcbRemittanceFile = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  uploadedAt: z.string(),
});
export type PcbRemittanceFileType = z.infer<typeof PcbRemittanceFile>;

export const PcbRemittanceView = z.object({
  id: z.number(),
  poId: z.number(),
  remittedOn: z.string(),
  currency: z.string(),
  amount: z.number(),
  exchangeRate: z.number().nullable(),
  krwAmount: z.number().nullable(),
  memo: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  files: z.array(PcbRemittanceFile),
});
export type PcbRemittanceViewType = z.infer<typeof PcbRemittanceView>;

/** 발주서 1건의 지급 상태 — 잔액 = 발주가 − 송금 합계(같은 통화). */
export const PcbRemittanceSummary = z.object({
  currency: z.string(),
  poAmount: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  status: PcbRemittanceStatus,
  count: z.number().int().nonnegative(),
  lastRemittedOn: z.string().nullable(),
});
export type PcbRemittanceSummaryType = z.infer<typeof PcbRemittanceSummary>;

// ── 관리자 송금 워크큐 ───────────────────────────────────────────────────────
// 첫 탭 = 송금 대기(발주됐는데 한 푼도 안 나간 건) — 대기 큐 원칙 D12 그대로.
export const ADMIN_PCB_REMITTANCE_TABS = ['pending', 'partial', 'done', 'all'] as const;
export type AdminPcbRemittanceTabType = (typeof ADMIN_PCB_REMITTANCE_TABS)[number];
export const AdminPcbRemittanceTab = z.enum(ADMIN_PCB_REMITTANCE_TABS);

export const ADMIN_PCB_REMITTANCE_TAB_LABELS = {
  pending: '송금 대기',
  partial: '부분 송금',
  done: '송금 완료',
  all: '전체',
} as const satisfies Record<AdminPcbRemittanceTabType, string>;

/** 목록 행 — 발주서 1건 = 1행. 개별 송금 내역은 상세 조회로 따로 받는다(목록 경량화). */
export const AdminPcbRemittanceItem = z.object({
  poId: z.number(),
  specId: z.number(),
  projectName: z.string(),
  partnerId: z.number(),
  partnerName: z.string(),
  poStatus: PcbPoStatus,
  paymentTerms: z.string().nullable(),
  issuedAt: z.string(),
  deliveryDate: z.string().nullable(),
  /** 레거시 이관 견적 표시 — 대기 큐에서 제외되는 건과 같은 신호(D12). */
  isLegacy: z.boolean(),
  /** 무상(free) A/S 회차 발주 — 지급 대상이 아니다(잔액 0 취급·대기 큐 제외, 발주가는
   *  원가 회계 참고). 판정은 sp_pcb_as_case(chargeType=free)를 (specId, reorderRound)로 join. */
  isFreeAs: z.boolean(),
  summary: PcbRemittanceSummary,
});
export type AdminPcbRemittanceItemType = z.infer<typeof AdminPcbRemittanceItem>;

export const AdminPcbRemittanceListQuery = z.object({
  tab: AdminPcbRemittanceTab.default('pending'),
  q: z.string().trim().max(100).optional(),
  partnerId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminPcbRemittanceListQueryType = z.infer<typeof AdminPcbRemittanceListQuery>;

export const AdminPcbRemittanceListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbRemittanceItem),
    total: z.number().int().nonnegative(),
    counts: z.object({
      pending: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      done: z.number().int().nonnegative(),
      all: z.number().int().nonnegative(),
    }),
  }),
});
export type AdminPcbRemittanceListResponseType = z.infer<typeof AdminPcbRemittanceListResponse>;

// ── 협력사별 집계 — "이 협력사에 줄 돈이 남았나" 한 줄 ────────────────────────
// 통화는 **뭉치지 않는다**. 협력사마다 KRW/USD/CNY 가 섞이므로 통화별로 나눠 내고
// KRW 환산 합계를 따로 병기한다(집계에서 통화를 섞으면 숫자가 거짓말을 한다).
export const AdminPcbRemittancePartnerCurrency = z.object({
  currency: z.string(),
  poAmount: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  poCount: z.number().int().nonnegative(),
});
export type AdminPcbRemittancePartnerCurrencyType = z.infer<
  typeof AdminPcbRemittancePartnerCurrency
>;

export const AdminPcbRemittancePartnerRow = z.object({
  partnerId: z.number(),
  partnerName: z.string(),
  country: z.string().nullable(),
  byCurrency: z.array(AdminPcbRemittancePartnerCurrency),
  /** KRW 환산 합계(회계 박제 기준) — 통화별 값의 참고 총계일 뿐 정본이 아니다. */
  krwPoAmount: z.number(),
  krwPaidAmount: z.number(),
  krwBalance: z.number(),
  unpaidPoCount: z.number().int().nonnegative(),
  lastRemittedOn: z.string().nullable(),
});
export type AdminPcbRemittancePartnerRowType = z.infer<typeof AdminPcbRemittancePartnerRow>;

export const AdminPcbRemittancePartnerResponse = z.object({
  result: z.literal(true),
  data: z.object({ rows: z.array(AdminPcbRemittancePartnerRow) }),
});
export type AdminPcbRemittancePartnerResponseType = z.infer<
  typeof AdminPcbRemittancePartnerResponse
>;

// ── 발주서별 송금 내역(관리자 Case 상세·송금 상세 패널) ──────────────────────
export const AdminPcbRemittanceDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({
    poId: z.number(),
    specId: z.number(),
    projectName: z.string(),
    partnerName: z.string(),
    summary: PcbRemittanceSummary,
    remittances: z.array(PcbRemittanceView),
  }),
});
export type AdminPcbRemittanceDetailResponseType = z.infer<
  typeof AdminPcbRemittanceDetailResponse
>;

// ── 기록·수정 ────────────────────────────────────────────────────────────────
// currency 는 받지 않는다 — 서버가 발주서에서 가져온다(잔액 계산의 전제).
export const PcbRemittanceCreateBody = z.object({
  remittedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  /** 외화 송금의 실제 적용 환율. KRW 발주면 무시된다. */
  exchangeRate: z.number().positive().nullable().optional(),
  memo: z.string().trim().max(500).nullable().optional(),
});
export type PcbRemittanceCreateBodyType = z.infer<typeof PcbRemittanceCreateBody>;

export const PcbRemittancePatchBody = PcbRemittanceCreateBody.partial();
export type PcbRemittancePatchBodyType = z.infer<typeof PcbRemittancePatchBody>;

export const PcbRemittanceMutationResponse = z.object({
  result: z.literal(true),
  data: z.object({
    summary: PcbRemittanceSummary,
    remittances: z.array(PcbRemittanceView),
  }),
});
export type PcbRemittanceMutationResponseType = z.infer<typeof PcbRemittanceMutationResponse>;

// ── 협력사 수금 현황 ─────────────────────────────────────────────────────────
// 관리자 [송금] 워크큐의 협력사 버전. **내 조직이 수주한 발주서(received)만** 센다 —
// MD 가 하위에 지급하는 돈은 성격이 다르고 기록 창구도 관리자 쪽이다.
// 협력사 포털 홈이 "받을 돈이 남았나"를 먼저 알려주려면 발주서 상세만으로는 부족하다
// (완료된 발주서는 홈의 '진행할 발주'에 뜨지 않아 진입 경로 자체가 없었다 — 2026-08-06).
export const PartnerPcbRemittanceItem = z.object({
  poId: z.number(),
  projectName: z.string(),
  /** 발주처(우리 또는 상위 MD) 이름. */
  ordererName: z.string(),
  poStatus: PcbPoStatus,
  issuedAt: z.string(),
  /** 무상(free) A/S 회차 발주 — 수금 대상이 아니다(미수금 0 취급·총계 제외). */
  isFreeAs: z.boolean(),
  summary: PcbRemittanceSummary,
  /** 입금 건별 내역 — 증빙 파일은 내부 자료라 싣지 않는다. */
  remittances: z.array(
    z.object({
      id: z.number(),
      remittedOn: z.string(),
      currency: z.string(),
      amount: z.number(),
      memo: z.string().nullable(),
    }),
  ),
});
export type PartnerPcbRemittanceItemType = z.infer<typeof PartnerPcbRemittanceItem>;

/** 통화별 미수금 총계 — 통화를 뭉치면 숫자가 거짓말을 한다(관리자 집계와 같은 규율). */
export const PartnerPcbRemittanceTotal = z.object({
  currency: z.string(),
  poAmount: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  poCount: z.number().int().nonnegative(),
});
export type PartnerPcbRemittanceTotalType = z.infer<typeof PartnerPcbRemittanceTotal>;

export const PartnerPcbRemittanceListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PartnerPcbRemittanceItem),
    totals: z.array(PartnerPcbRemittanceTotal),
    /** 미수금이 남은 발주 수 — 홈 배지·요약 문구가 쓴다. */
    unpaidCount: z.number().int().nonnegative(),
  }),
});
export type PartnerPcbRemittanceListResponseType = z.infer<
  typeof PartnerPcbRemittanceListResponse
>;
