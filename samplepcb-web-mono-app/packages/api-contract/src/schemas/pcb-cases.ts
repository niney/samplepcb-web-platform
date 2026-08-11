import { z } from 'zod';

// ── PCB 진행현황·대기 큐 (/api/admin/pcb-cases) ──────────────────────────────
// 스펙(견적건) 축의 단일 절단면. 두 가지를 한 엔드포인트가 공급한다:
//   ① 진행현황(총괄 조감) — 구간 탭. 전 견적건이 모수(이관분 포함).
//   ② 대기 큐(역할별 "시작 전") — todo_rfq(견적요청)·todo_po(발주·EQ).
// 대기 큐를 별도로 만든 이유: 워크큐 3종(견적요청·발주·선적)이 모두 "이미 시작된
// 것"(RFQ 행·PO 행·선적 행)만 모수로 잡고 있어, 각 역할이 **자기가 시작해야 할 일**을
// 자기 화면에서 볼 수 없었다. SmartBOM 이 각 워크큐 첫 탭을 "대기"로 둔 것과 같은 해법
// (docs/SMARTBOM_PARTNER_RFQ.md §6.12) 이되 구현은 PCB 전용·분리(D9).

export const ADMIN_PCB_CASE_TABS = [
  'quoting', // 견적 — 미주문(비담김·담김·유령)
  'unpaid', // 주문·결제 — 주문됐고 미입금
  'production', // 발주·생산 — 결제 완료·진행 중(완료/취소 아님)
  'closed', // 완료·취소
  'all',
  'todo_rfq', // 대기 큐 — 협력사 견적요청 0건 + RFQ 게이트 통과 가능
  'todo_po', // 대기 큐 — 결제 완료·진행 중 + 발주서 0건
] as const;
export type AdminPcbCaseTabType = (typeof ADMIN_PCB_CASE_TABS)[number];

export const ADMIN_PCB_CASE_TAB_LABELS: Record<AdminPcbCaseTabType, string> = {
  quoting: '견적',
  unpaid: '주문·결제',
  production: '발주·생산',
  closed: '완료·취소',
  all: '전체',
  todo_rfq: '요청 대기',
  todo_po: '발주 대기',
};

// 진행 단계(1~12) — **저장 상태가 아니라 파생 표시 타임라인**이다(SmartBOM 12단계와
// 같은 성격, 단계 정의는 PCB 트랙 고유). 서버가 계산해 내려주고 FE 는 라벨만 붙인다
// — 판정에 필요한 원장(RFQ·PO·선적·od)이 전부 서버에 있기 때문.
export const PCB_STEPS = [
  '견적요청', // ① 스펙 생성(거버 업로드)
  '협력사 견적요청', // ② RFQ 발송
  '협력사 회신', // ③ 회신 도착
  '협력사 선정', // ④ 선정
  '확정가 등록', // ⑤ 고객 견적 확정(finalPrice)
  '주문 접수', // ⑥ 주문 성립
  '결제', // ⑦ 입금 확인
  '발주', // ⑧ 발주서 발행
  'EQ 승인', // ⑨ EQ 승인 완료
  '생산완료', // ⑩ 생산 완료
  '선적·입고', // ⑪ 발송 생성 이후
  '배송·완료', // ⑫ od 배송/완료
] as const;
export type PcbStepType = (typeof PCB_STEPS)[number];

export const AdminPcbCaseItem = z.object({
  specId: z.number(),
  projectName: z.string(),
  mbId: z.string().nullable(),
  /** 고객 표시명 — 주문 시점 od_name > 회원 mb_name, 둘 다 없으면 ''(화면이 '이름 없음'을
   *  대신 쓴다). 해석은 lib/pcb-customer.resolvePcbCustomerName 단일 사전. */
  customerName: z.string(),
  category: z.string(),
  qty: z.number().int(),
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  finalPrice: z.number().nullable(),
  /** 이관분(specJson._legacy) — 대기 큐에서 제외되는 모수. 행에도 표시한다. */
  isLegacy: z.boolean(),
  cartState: z.enum(['none', 'cart', 'ordered']),
  odId: z.string().nullable(),
  odStatus: z.string().nullable(),
  isPaid: z.boolean(),
  orderedAt: z.string().nullable(),
  /** 협력사 RFQ 진행(관리자 직속 트랙만) — 없으면 total=0. */
  rfqTotal: z.number().int(),
  rfqQuoted: z.number().int(),
  rfqSelected: z.boolean(),
  /** 관리자 직속 발주서 수(전 회차). */
  poCount: z.number().int(),
  /** 선적 문서 1건 이상 존재. */
  hasShipment: z.boolean(),
  /** 최상위(parentPartnerId 0) 발주의 최신 회차 — 0=원발주만, 1..=A/S 재생산 회차. */
  asRound: z.number().int(),
  /**
   * A/S 회차(>0) 진행 중 — 최신 회차 발주의 선적이 종결(done/delivered/입고확인) 전.
   * true 면 od 가 완료·취소여도 구간은 '발주·생산'(진행)으로 선다(판정 축 = 최상위
   * 발주의 최신 회차, 정책 확정 08-10 — lib/pcb-customer-progress 와 동일 규칙).
   */
  asOpen: z.boolean(),
  /** 파생 단계 1~12(PCB_STEPS 인덱스+1). 취소 주문은 단계 계산에서 제외되지 않는다. */
  step: z.number().int().min(1).max(12),
  createdAt: z.string(),
});
export type AdminPcbCaseItemType = z.infer<typeof AdminPcbCaseItem>;

export const AdminPcbCaseListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(ADMIN_PCB_CASE_TABS).default('all'),
  q: z.string().optional(), // 프로젝트명·회원ID·주문번호 contains
});
export type AdminPcbCaseListQueryType = z.infer<typeof AdminPcbCaseListQuery>;

export const AdminPcbCaseCounts = z.object({
  quoting: z.number().int(),
  unpaid: z.number().int(),
  production: z.number().int(),
  closed: z.number().int(),
  all: z.number().int(),
  todoRfq: z.number().int(),
  todoPo: z.number().int(),
});
export type AdminPcbCaseCountsType = z.infer<typeof AdminPcbCaseCounts>;

export const AdminPcbCaseListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbCaseItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: AdminPcbCaseCounts,
  }),
});
export type AdminPcbCaseListResponseType = z.infer<typeof AdminPcbCaseListResponse>;
