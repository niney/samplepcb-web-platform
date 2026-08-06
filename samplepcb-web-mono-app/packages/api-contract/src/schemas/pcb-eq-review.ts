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
