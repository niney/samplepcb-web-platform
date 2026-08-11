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

/** 통화별 소계 — 목록 하단 합계와 협력사별 집계가 같은 모양을 쓴다.
 *  통화를 한 열에 섞어 놓으면 ₩와 $가 나란히 서서 합계를 읽을 수 없다(D15 ③). */
export const PcbRemittanceCurrencyTotal = z.object({
  currency: z.string(),
  poAmount: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  poCount: z.number().int().nonnegative(),
});
export type PcbRemittanceCurrencyTotalType = z.infer<typeof PcbRemittanceCurrencyTotal>;

/** 목록 행 — 발주서 1건 = 1행. 개별 송금 내역은 상세 조회로 따로 받는다(목록 경량화). */
export const AdminPcbRemittanceItem = z.object({
  poId: z.number(),
  specId: z.number(),
  projectName: z.string(),
  /** 이 지급이 누구 건인가 — 돈을 보내기 전 건을 특정하는 축(lib/pcb-customer 단일 사전). */
  mbId: z.string().nullable(),
  customerName: z.string(),
  partnerId: z.number(),
  partnerName: z.string(),
  poStatus: PcbPoStatus,
  paymentTerms: z.string().nullable(),
  issuedAt: z.string(),
  deliveryDate: z.string().nullable(),
  /** 0=원발주, 1..=A/S 회차. 같은 프로젝트가 회차만큼 여러 줄로 서므로 이 값이 없으면
   *  유상 회차와 원발주를 구분할 수 없다(둘 다 돈이 걸린다) — Case·파트너 홈과 같은 배지. */
  reorderRound: z.number().int(),
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
    /** 현재 탭·검색 조건 **전체**(페이지가 아니라)의 통화별 소계 — 화면 한 열에 ₩와 $가
     *  섞여 서므로 합계는 서버가 통화별로 나눠 낸다. 무상 A/S 회차는 빠진다. */
    byCurrency: z.array(PcbRemittanceCurrencyTotal),
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
export const AdminPcbRemittancePartnerCurrency = PcbRemittanceCurrencyTotal;
export type AdminPcbRemittancePartnerCurrencyType = z.infer<
  typeof AdminPcbRemittancePartnerCurrency
>;

export const AdminPcbRemittancePartnerRow = z.object({
  partnerId: z.number(),
  partnerName: z.string(),
  country: z.string().nullable(),
  byCurrency: z.array(AdminPcbRemittancePartnerCurrency),
  /** KRW 환산 합계(발주서 회계 박제 krwAmount 기준) — 통화별 값의 참고 총계일 뿐 정본이 아니다. */
  krwPoAmount: z.number(),
  /** **원장 실지급 KRW 합**(송금 건별 krwAmount) — 발주 회계의 비례배분 추정이 아니다.
   *  그래서 `krwPoAmount ≠ krwPaidAmount + krwBalance` 가 정상이며 그 차이가 환차손익이다. */
  krwPaidAmount: z.number(),
  /** 환율 미기입 송금이 섞여 실지급 합에서 빠진 건이 있음 — 캡션이 이 사실을 밝혀야 한다. */
  krwPaidRateMissing: z.boolean(),
  /** 잔액을 발주 회계 환율로 환산한 값(줄 돈) — 실지급과 기준이 다르다. */
  krwBalance: z.number(),
  /** **미착수** 발주 수(한 푼도 안 나간 건) — 부분 송금 건은 여기 없다. */
  unpaidPoCount: z.number().int().nonnegative(),
  /** **잔여** 발주 수(잔액>0 — 미착수 + 부분 송금) — "아직 줄 돈이 남은 건". */
  openPoCount: z.number().int().nonnegative(),
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
    /** 무상(free) A/S 회차 — **지급 대상이 아니다**. 목록과 같은 판정을 상세도 해야 한다:
     *  이 값이 없어 상세만 잔액을 그대로 주던 탓에 패널이 무상 회차에 금액을 프리필했다
     *  (재점검 08-11 확정 #1 — 돈 사고 직전까지 간 결함). true 면 summary.balance=0. */
    isFreeAs: z.boolean(),
    /** 발주서의 KRW 회계 박제(발주 시점 환율) — 원장 실지급 KRW 와 나란히 놓아야
     *  환차가 보인다. 외화 발주인데 환산이 없으면(MD 하위) null. */
    poKrwAmount: z.number().nullable(),
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
  /** 0=원발주, 1..=A/S 회차 — 같은 프로젝트가 두 줄로 서므로 회차 표기가 없으면
   *  협력사가 "이미 받은 그 건"과 새 회차를 구분할 수 없다(유상 회차면 둘 다 돈이다). */
  reorderRound: z.number().int(),
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
