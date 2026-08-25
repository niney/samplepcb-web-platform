import { z } from 'zod';

// ── PCB EQ 고객 확인 계약(P4.1) — 정본 docs/PCB_PARTNER_TRACK.md D16 ─────────
// 협력사 EQ(제조 확인 사항)를 **고객에게 물어보는** 축. EQ 전이 머신 옆에 붙으며
// 고객이 승인해도 eq_done 전이는 관리자 몫이다(고객 확인 = 관리자 승인의 근거).
//
// 고객은 발주서를 모른다 — 화면에는 "내 주문의 확인 요청"으로만 보이고 협력사명은
// 어디에도 나오지 않는다("제조사"로 표기). 공개 파일은 관리자가 고른 것만이다.

export const PCB_EQ_REVIEW_STATUSES = ['requested', 'approved', 'rejected', 'canceled'] as const;
export type PcbEqReviewStatusType = (typeof PCB_EQ_REVIEW_STATUSES)[number];
export const PcbEqReviewStatus = z.enum(PCB_EQ_REVIEW_STATUSES);

export const PCB_EQ_REVIEW_STATUS_LABELS = {
  requested: '확인 대기',
  approved: '고객 승인',
  rejected: '고객 반려',
  canceled: '요청 취소',
} as const satisfies Record<PcbEqReviewStatusType, string>;

/** 고객에게 공개된 첨부 — 관리자가 고른 것만. 협력사명이 든 파일은 애초에 안 담는다. */
export const PcbEqReviewFile = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
});
export type PcbEqReviewFileType = z.infer<typeof PcbEqReviewFile>;

/** 발주 행에 싣는 요약 — 모달을 열지 않아도 "보냈는지·답했는지"가 보이게(사용자 결정
 *  2026-08-07). 열린 요청이 있으면 그것, 없으면 마지막 결정. canceled 뿐이면 요약 없음
 *  (=미요청 취급 — 취소했으면 다시 물어봐야 한다). */
export const PcbPoEqReviewSummary = z.object({
  status: PcbEqReviewStatus,
  requestedAt: z.string(),
  dueOn: z.string().nullable(),
  overdue: z.boolean(),
  decidedAt: z.string().nullable(),
  /** 반려 사유 — 행 툴팁이 쓴다(관리자 화면 전용이라 원문 그대로). */
  decisionNote: z.string().nullable(),
});
export type PcbPoEqReviewSummaryType = z.infer<typeof PcbPoEqReviewSummary>;

/** 관리자 화면용 — 발주서 컨텍스트를 안다. */
export const AdminPcbEqReviewView = z.object({
  id: z.number(),
  poId: z.number(),
  specId: z.number(),
  status: PcbEqReviewStatus,
  message: z.string(),
  dueOn: z.string().nullable(),
  files: z.array(PcbEqReviewFile),
  requestedBy: z.string(),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /** 기한이 지났는데 아직 답이 없다 — 관리자가 재촉해야 하는 신호. */
  overdue: z.boolean(),
});
export type AdminPcbEqReviewViewType = z.infer<typeof AdminPcbEqReviewView>;

// ── 관리자: 확인 요청 보내기 ─────────────────────────────────────────────────
export const AdminPcbEqReviewCreateBody = z.object({
  /** 고객에게 보낼 확인 문구. 협력사 EQ 원문을 그대로 넘기지 않는다. */
  message: z.string().trim().min(2).max(2000),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  /** 공개할 EQ 첨부 id — 이 발주서의 첨부만 허용(서버 검증). 비우면 문구만 나간다. */
  sharedFileIds: z.array(z.number().int().positive()).max(20).default([]),
});
export type AdminPcbEqReviewCreateBodyType = z.infer<typeof AdminPcbEqReviewCreateBody>;

export const AdminPcbEqReviewListResponse = z.object({
  result: z.literal(true),
  data: z.object({ reviews: z.array(AdminPcbEqReviewView) }),
});
export type AdminPcbEqReviewListResponseType = z.infer<typeof AdminPcbEqReviewListResponse>;

// ── 고객: 내 주문의 확인 요청 ────────────────────────────────────────────────
// 발주서·협력사·회차 어느 것도 노출하지 않는다. 고객이 아는 것은 자기 주문과 프로젝트뿐.
export const CustomerPcbEqReviewView = z.object({
  id: z.number(),
  projectName: z.string(),
  /** 주문 항목 식별 — sp-php 주문내역 상세가 행을 맞추는 키. */
  ctId: z.number().nullable(),
  status: PcbEqReviewStatus,
  message: z.string(),
  dueOn: z.string().nullable(),
  files: z.array(PcbEqReviewFile),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  overdue: z.boolean(),
});
export type CustomerPcbEqReviewViewType = z.infer<typeof CustomerPcbEqReviewView>;

export const CustomerPcbEqReviewListQuery = z.object({
  /** 주문번호 — 이 주문에 묶인 견적의 확인 요청만. 소유권은 서버가 판정한다. */
  odId: z.string().trim().min(1).max(32),
});
export type CustomerPcbEqReviewListQueryType = z.infer<typeof CustomerPcbEqReviewListQuery>;

export const CustomerPcbEqReviewListResponse = z.object({
  result: z.literal(true),
  data: z.object({ reviews: z.array(CustomerPcbEqReviewView) }),
});
export type CustomerPcbEqReviewListResponseType = z.infer<typeof CustomerPcbEqReviewListResponse>;

// ── 고객: 주문을 가로지르는 "내 확인 요청" 목록(마이페이지 진입점) ───────────
// 주문 상세 목록(위)과 모수가 다르다: 그쪽은 odId 한 건, 이쪽은 **회원의 전 주문**이다.
// 고객이 "지금 내가 답해야 할 게 있나"를 주문을 하나씩 열지 않고 알게 하는 것이 목적이라,
// 기본 모수는 열린 요청(open)이고 이력은 요청해야 나온다.
//
// 결정 UI 는 여기 없다 — 행은 주문 상세 딥링크로 보낸다. 승인·반려 폼이 두 벌이 되면
// 첨부·기한·경고(반려 후 새 파일 없음)까지 두 곳에서 갈린다.
export const CustomerPcbEqReviewMineQuery = z.object({
  /** open=확인 대기만(기본) · all=이력 포함. 배지 모수는 언제나 open 이다. */
  scope: z.enum(['open', 'all']).default('open'),
});
export type CustomerPcbEqReviewMineQueryType = z.infer<typeof CustomerPcbEqReviewMineQuery>;

/** 목록 행 — 주문번호가 붙는다(딥링크 대상). 주문이 지워진 건은 null 이라 링크가 없다. */
export const CustomerPcbEqReviewMineView = CustomerPcbEqReviewView.extend({
  odId: z.string().nullable(),
});
export type CustomerPcbEqReviewMineViewType = z.infer<typeof CustomerPcbEqReviewMineView>;

export const CustomerPcbEqReviewMineResponse = z.object({
  result: z.literal(true),
  data: z.object({
    reviews: z.array(CustomerPcbEqReviewMineView),
    /** scope 와 무관하게 열린 요청 수 — 사이드바 배지와 같은 수. */
    openCount: z.number().int(),
  }),
});
export type CustomerPcbEqReviewMineResponseType = z.infer<typeof CustomerPcbEqReviewMineResponse>;

// ── 고객 주문 상세의 PCB 진행 단계(P4.13) — od 상태와 별개의 협력 트랙 파생 표시 ──
// od 는 '입금'에 머물러도 실제 제작은 EQ→생산→입고로 움직인다(D6 1차 수동 유지 —
// od 를 안 바꾸고 sp 축을 그대로 보여준다). 협력사명·발주 정보는 노출하지 않는다.
// 라벨은 서버가 완성한다(PHP·화면은 그대로 출력).
// 확인(EQ) 구간은 세 칸이다(2026-08-25 실측 교정) — issued(협력사가 아직 안 올림)·
// eq_requested(검토 중)·eq_done(확인 끝, 생산 대기)이 한 문구로 뭉치면 고객은 몇 주를
// 같은 글자로 본다. 순서는 배열 순서가 곧 진행 순서다(느린 줄 판정에 쓴다).
export const PCB_PROGRESS_STAGES = [
  'eq_pending',
  'eq',
  'eq_done',
  'producing',
  'produced',
  'shipping',
  'received',
] as const;
export type PcbProgressStageType = (typeof PCB_PROGRESS_STAGES)[number];

export const CustomerPcbProgressItem = z.object({
  specId: z.number(),
  /** 이 스펙의 카트 줄 — 주문 상세가 줄 배지에 진행을 겹쳐 그릴 때의 조인 키. */
  ctId: z.number().nullable(),
  projectName: z.string(),
  reorderRound: z.number().int(), // 0=원주문, 1..=A/S 재생산 회차
  stage: z.enum(PCB_PROGRESS_STAGES),
  label: z.string(), // 예: '제조 확인(EQ) 진행 중' · 'A/S 재생산 — 생산 진행 중'
  /** 배지용 짧은 문구(목록·줄 상태 칸) — 긴 라벨은 상태 칸에서 잘린다(여정 10호 X7 실측). */
  shortLabel: z.string(),
  /**
   * 좌표파일(메탈마스크) — **통보 없는 열람**(사용자 결정 2026-08-16). 메일도 확인 요청도
   * 만들지 않고, 고객이 주문내역을 열면 여기 있다. 요청하는 고객이 종종 있어서다.
   *
   * 세 가지 제약이 붙는다:
   *  ① **관리자 확인(eq_done) 뒤에만** 뜬다 — 그 전엔 보완 요청으로 파일이 바뀔 수 있고,
   *     반려된 좌표로 고객이 SMT 설비를 잡는 것이 이 기능의 최악이다. 확인 뒤로는 첨부가
   *     영구 잠기므로(canEditPcbEqFile) 내려받은 것이 나중에 달라지지 않는다.
   *  ② **최신 1건만** — 보완 왕복이 있었으면 옛 회차 좌표는 고객이 볼 이유가 없다.
   *  ③ 이름은 **중립화**해 내려준다 — 협력사가 올린 원본 파일명에 협력사명이 박혀 있을 수
   *     있고, 고객 화면에 공급망을 드러내지 않는 것이 이 트랙의 관례다(여정 43호).
   */
  coordFile: z
    .object({ fileId: z.number(), name: z.string(), size: z.number() })
    .nullable()
    .default(null),
});
export type CustomerPcbProgressItemType = z.infer<typeof CustomerPcbProgressItem>;

// ── 주문내역 **목록**용 일괄 요약 — 주문마다 가장 느린 줄의 단계 하나 ─────────────
// 목록 배지가 od_status('입금완료')만 찍으면 협력 트랙이 입고까지 가도 고객은 몇 주를
// '입금완료'로 본다(2026-08-25 실측). 진행이 있는 주문만 돌려주고, 없는 주문은 od 매핑.
export const CustomerPcbProgressBatchBody = z.object({
  odIds: z.array(z.string().min(1).max(32)).min(1).max(50),
});
export type CustomerPcbProgressBatchBodyType = z.infer<typeof CustomerPcbProgressBatchBody>;

export const CustomerPcbProgressOrderSummary = z.object({
  odId: z.string(),
  stage: z.enum(PCB_PROGRESS_STAGES),
  label: z.string(),
  shortLabel: z.string(),
  /** 진행 카드가 있는 줄 수 — 여러 줄이면 목록 배지는 가장 느린 줄을 따른다. */
  lineCount: z.number().int(),
});
export type CustomerPcbProgressOrderSummaryType = z.infer<typeof CustomerPcbProgressOrderSummary>;

export const CustomerPcbProgressBatchResponse = z.object({
  result: z.literal(true),
  data: z.object({ orders: z.array(CustomerPcbProgressOrderSummary) }),
});
export type CustomerPcbProgressBatchResponseType = z.infer<typeof CustomerPcbProgressBatchResponse>;

export const CustomerPcbProgressResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(CustomerPcbProgressItem) }),
});
export type CustomerPcbProgressResponseType = z.infer<typeof CustomerPcbProgressResponse>;

/** 고객 결정 — 반려는 사유가 있어야 협력사에 되돌릴 근거가 된다. */
export const CustomerPcbEqDecisionBody = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision === 'approve' || (v.note !== undefined && v.note.length >= 2), {
    message: '반려 사유를 입력해 주세요.',
    path: ['note'],
  });
export type CustomerPcbEqDecisionBodyType = z.infer<typeof CustomerPcbEqDecisionBody>;

export const CustomerPcbEqDecisionResponse = z.object({
  result: z.literal(true),
  data: z.object({ review: CustomerPcbEqReviewView }),
});
export type CustomerPcbEqDecisionResponseType = z.infer<typeof CustomerPcbEqDecisionResponse>;
