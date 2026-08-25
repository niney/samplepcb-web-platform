import { z } from 'zod';

// ── PCB 고객 클레임(A/S 접수) — sp_pcb_claim 계약(P5) ────────────────────────
// 정본: docs/PCB_PARTNER_TRACK.md §9 A/S. BOM 클레임(D37, bom-claims.ts)의 PCB 미러:
// 배송·완료 후 고객이 제품 문제를 접수하면 관리자가 검토→판정(귀책·처리)하고, 처리
// 실행은 기존 수단으로 갈라진다 — 재생산이면 A/S 케이스(sp_pcb_as_case)로 핸드오프,
// 환불이면 주문 환불 기록 창구(od_refund_price), 안내면 회신으로 종결. 클레임은
// 고객↔자사 축이고 협력사 재생산 합의(자사↔협력사 축)는 기존 A/S 케이스가 맡는다.
// BOM 사전은 불변 — 값이 같아도 PCB 계약은 여기 따로 선다(트랙 간 어휘 격리 관례).

export const PCB_CLAIM_STATUSES = ['open', 'reviewing', 'resolved', 'rejected'] as const;
export type PcbClaimStatusType = (typeof PCB_CLAIM_STATUSES)[number];
export const PcbClaimStatus = z.enum(PCB_CLAIM_STATUSES);

export const PCB_CLAIM_STATUS_LABELS = {
  open: '접수됨',
  reviewing: '검토 중',
  resolved: '처리 완료',
  rejected: '처리 불가',
} as const satisfies Record<PcbClaimStatusType, string>;

/** 고객 신고 유형 — 접수 폼의 첫 질문(보드 1종 단위라 BOM 의 품목 축 대신 스칼라). */
export const PCB_CLAIM_KINDS = ['quality', 'damaged', 'spec_mismatch', 'shortage', 'other'] as const;
export type PcbClaimKindType = (typeof PCB_CLAIM_KINDS)[number];
export const PcbClaimKind = z.enum(PCB_CLAIM_KINDS);

export const PCB_CLAIM_KIND_LABELS = {
  quality: '품질·동작 이상',
  damaged: '파손',
  spec_mismatch: '사양 상이',
  shortage: '수량 부족',
  other: '기타',
} as const satisfies Record<PcbClaimKindType, string>;

/** 고객 희망 처리 — 참고값이다. 확정은 관리자 판정(resolutionKind)이 한다. */
export const PCB_CLAIM_REMEDIES = ['reproduce', 'refund', 'consult'] as const;
export type PcbClaimRemedyType = (typeof PCB_CLAIM_REMEDIES)[number];
export const PcbClaimRemedy = z.enum(PCB_CLAIM_REMEDIES);

export const PCB_CLAIM_REMEDY_LABELS = {
  reproduce: '재제작 희망',
  refund: '환불 희망',
  consult: '상담 요청',
} as const satisfies Record<PcbClaimRemedyType, string>;

/** 귀책 판정(2026-08-15 사용자 결정 4유형) — 협력사 구상·통계의 축. 판정 시 박제. */
export const PCB_CLAIM_FAULT_TYPES = [
  'manufacturing',
  'customer_data',
  'shipping_damage',
  'unknown',
] as const;
export type PcbClaimFaultTypeType = (typeof PCB_CLAIM_FAULT_TYPES)[number];
export const PcbClaimFaultType = z.enum(PCB_CLAIM_FAULT_TYPES);

export const PCB_CLAIM_FAULT_LABELS = {
  manufacturing: '제조 불량',
  customer_data: '고객 데이터 원인',
  shipping_damage: '운송 파손',
  unknown: '원인 불명',
} as const satisfies Record<PcbClaimFaultTypeType, string>;

/** 처리 확정 — reproduce 는 A/S 케이스(재생산 합의)로 핸드오프된다. */
export const PCB_CLAIM_RESOLUTIONS = ['reproduce', 'refund_coordination', 'guidance'] as const;
export type PcbClaimResolutionType = (typeof PCB_CLAIM_RESOLUTIONS)[number];
export const PcbClaimResolution = z.enum(PCB_CLAIM_RESOLUTIONS);

export const PCB_CLAIM_RESOLUTION_LABELS = {
  reproduce: '재생산(A/S 재발주)',
  refund_coordination: '환불 협의',
  guidance: '안내·상담 종결',
} as const satisfies Record<PcbClaimResolutionType, string>;

// 접수 가능 판정 — BOM 미러(배송이 시작된 활성 주문행 + 열린 클레임 1건 규칙).
// 접수 기한은 두지 않는다(무기한 접수 + 관리자 판정으로 거름 — 사용자 결정 08-15).
export const PCB_CLAIM_ELIGIBILITY_REASONS = [
  'NO_ORDER',
  'ORDER_NOT_FOUND',
  'NOT_DELIVERED',
  'LINE_CLOSED',
  'ACTIVE_CLAIM',
] as const;
export type PcbClaimEligibilityReasonType = (typeof PCB_CLAIM_ELIGIBILITY_REASONS)[number];
export const PcbClaimEligibilityReason = z.enum(PCB_CLAIM_ELIGIBILITY_REASONS);

export const PCB_CLAIM_ELIGIBILITY_LABELS = {
  NO_ORDER: '주문이 완료된 뒤 A/S 를 접수할 수 있습니다.',
  ORDER_NOT_FOUND: '연결된 주문 정보를 찾을 수 없습니다. 고객센터에 문의해 주세요.',
  NOT_DELIVERED: '배송이 시작된 뒤 A/S 를 접수할 수 있습니다.',
  LINE_CLOSED: '취소·반품 처리된 주문 건에는 새 A/S 를 접수할 수 없습니다.',
  ACTIVE_CLAIM: '처리 중인 A/S 접수가 있습니다. 기존 접수 결과를 먼저 확인해 주세요.',
} as const satisfies Record<PcbClaimEligibilityReasonType, string>;

export const PCB_CLAIM_EVENT_ACTIONS = [
  'submitted',
  'review_started',
  'resolved',
  'rejected',
] as const;
export type PcbClaimEventActionType = (typeof PCB_CLAIM_EVENT_ACTIONS)[number];
export const PcbClaimEventAction = z.enum(PCB_CLAIM_EVENT_ACTIONS);

export const PcbClaimOrderSnapshot = z.object({
  odId: z.string(),
  odStatus: z.string(),
  ctStatus: z.string(),
  settleCase: z.string(),
  receiptPrice: z.number(),
});
export type PcbClaimOrderSnapshotType = z.infer<typeof PcbClaimOrderSnapshot>;

export const PcbClaimEvent = z.object({
  id: z.string(),
  action: PcbClaimEventAction,
  actorRole: z.enum(['customer', 'admin']),
  actorMbId: z.string(),
  fromStatus: PcbClaimStatus.nullable(),
  toStatus: PcbClaimStatus,
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type PcbClaimEventType = z.infer<typeof PcbClaimEvent>;

// 첨부 — sp_file refType 'sp_pcb_claim'. 고객 접수 사진(CUSTOMER)과 관리자 대리
// 첨부(ADMIN)를 uploadedBy 로 구분한다(A/S 케이스 첨부 규약과 동형).
export const PcbClaimFileView = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  uploadedBy: z.string().nullable(), // CUSTOMER|ADMIN
  uploadedAt: z.string(),
});
export type PcbClaimFileViewType = z.infer<typeof PcbClaimFileView>;

export const PcbClaimView = z.object({
  id: z.string(),
  specId: z.string(),
  projectName: z.string(),
  mbId: z.string(),
  odId: z.string(),
  ctId: z.number().int(),
  status: PcbClaimStatus,
  kind: PcbClaimKind,
  description: z.string(),
  orderedQty: z.number().int(),
  /** 불량(문제) 수량 — 전량이면 orderedQty 와 같다. */
  affectedQty: z.number().int(),
  requestedRemedy: PcbClaimRemedy,
  orderSnapshot: PcbClaimOrderSnapshot,
  version: z.number().int().positive(),
  /** 대리 접수 구분(여정 12호 byRole 관례) — customer=고객 직접, admin=관리자 대리. */
  createdByRole: z.enum(['customer', 'admin']),
  adminMbId: z.string().nullable(),
  /** 판정 회신(고객에게 그대로 노출·메일 동봉). */
  adminResponse: z.string().nullable(),
  faultType: PcbClaimFaultType.nullable(),
  resolutionKind: PcbClaimResolution.nullable(),
  /** 유상 처리 시 고객 청구액 기록(원) — 실청구는 별도(기록만, 사용자 결정 08-15). */
  chargeAmount: z.number().int().nullable(),
  /** 환불 협의 금액 기록(원) — 실집행 정본은 주문 환불 기록(od_refund_price). */
  refundAmount: z.number().int().nullable(),
  /** 불량품 회수 필요 여부·메모(운송장 등 자유 기록 — 정식 역물류 모델은 보류). */
  returnRequired: z.boolean(),
  returnNote: z.string().nullable(),
  /** 재생산 핸드오프 — resolve(reproduce)가 만든 A/S 케이스. */
  asCaseId: z.number().nullable(),
  submittedAt: z.string().datetime(),
  reviewStartedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  files: z.array(PcbClaimFileView),
  events: z.array(PcbClaimEvent),
});
export type PcbClaimViewType = z.infer<typeof PcbClaimView>;

export const PcbClaimEligibility = z.object({
  canSubmit: z.boolean(),
  reason: PcbClaimEligibilityReason.nullable(),
  activeClaimId: z.string().nullable(),
});
export type PcbClaimEligibilityType = z.infer<typeof PcbClaimEligibility>;

// ── 고객(주문 축 — sp-php 주문내역 상세가 소비) ─────────────────────────────
// 한 주문의 PCB 스펙(카트행)마다 접수 가능 여부와 클레임 이력을 함께 내린다.

export const CustomerPcbClaimSpecView = z.object({
  specId: z.string(),
  ctId: z.number().int(),
  projectName: z.string(),
  qty: z.number().int(),
  eligibility: PcbClaimEligibility,
  claims: z.array(PcbClaimView),
});
export type CustomerPcbClaimSpecViewType = z.infer<typeof CustomerPcbClaimSpecView>;

export const CustomerPcbClaimListResponse = z.object({
  result: z.literal(true),
  data: z.object({ specs: z.array(CustomerPcbClaimSpecView) }),
});
export type CustomerPcbClaimListResponseType = z.infer<typeof CustomerPcbClaimListResponse>;

// ── 고객: 주문을 가로지르는 "내 A/S"(마이페이지 /shop/as) ───────────────────
// 위 목록은 주문 하나(odId)의 스펙별 뷰다. 이쪽은 **회원 전체**를 본다 — 접수할 수 있는
// 배송 완료 주문과 이미 낸 접수 내역을 한 화면에 세워, 고객이 주문을 하나씩 열어보지
// 않고도 "낼 수 있는 것·낸 것"을 알게 한다. 접수 폼은 여기 없다(주문 상세 한 곳).
export const CustomerPcbClaimMineQuery = z.object({
  /** open=진행 중(open|reviewing)만(기본) · all=종결 포함. openCount 는 언제나 진행 중. */
  scope: z.enum(['open', 'all']).default('open'),
});
export type CustomerPcbClaimMineQueryType = z.infer<typeof CustomerPcbClaimMineQuery>;

/** 접수할 주문 — 배송·완료 주문행 중 스펙이 있고 진행 중 접수가 없는 것. */
export const CustomerPcbClaimableRow = z.object({
  specId: z.string(),
  ctId: z.number().int(),
  odId: z.string(),
  projectName: z.string(),
  qty: z.number().int(),
  /** 주문 시각(od_time) — 목록 정렬·표기용. */
  orderedAt: z.string(),
});
export type CustomerPcbClaimableRowType = z.infer<typeof CustomerPcbClaimableRow>;

export const CustomerPcbClaimMineResponse = z.object({
  result: z.literal(true),
  data: z.object({
    claimable: z.array(CustomerPcbClaimableRow),
    /** 후보를 최근 주문행 N건에서만 골랐다 — 그보다 오래된 주문은 주문내역에서 찾게 안내. */
    claimableTruncated: z.boolean(),
    claims: z.array(PcbClaimView),
    openCount: z.number().int(),
  }),
});
export type CustomerPcbClaimMineResponseType = z.infer<typeof CustomerPcbClaimMineResponse>;

/** 고객 접수 — multipart(사진 동반 1회 제출)라 필드는 서버가 문자열로 받아 검증한다. */
export const PcbClaimCreateFields = z.object({
  specId: z.coerce.bigint(),
  kind: PcbClaimKind,
  affectedQty: z.coerce.number().int().min(1),
  description: z.string().trim().min(5).max(2000),
  requestedRemedy: PcbClaimRemedy,
  /** 접수가 주문 취소·환불을 자동 실행하지 않는다는 명시 확인(BOM D37 미러). */
  acknowledge: z.literal('1'),
});
export type PcbClaimCreateFieldsType = z.infer<typeof PcbClaimCreateFields>;

export const PcbClaimCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({ claim: PcbClaimView }),
});
export type PcbClaimCreateResponseType = z.infer<typeof PcbClaimCreateResponse>;

// ── 관리자 ───────────────────────────────────────────────────────────────────

export const AdminPcbClaimListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['all', 'pending', 'open', 'reviewing', 'resolved', 'rejected']).default('pending'),
  search: z.string().trim().max(100).optional(),
});
export type AdminPcbClaimListQueryType = z.infer<typeof AdminPcbClaimListQuery>;

export const AdminPcbClaimCounts = z.object({
  all: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  reviewing: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
});
export type AdminPcbClaimCountsType = z.infer<typeof AdminPcbClaimCounts>;

export const AdminPcbClaimListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(PcbClaimView),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    counts: AdminPcbClaimCounts,
  }),
});
export type AdminPcbClaimListResponseType = z.infer<typeof AdminPcbClaimListResponse>;

export const AdminPcbClaimDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({ claim: PcbClaimView }),
});
export type AdminPcbClaimDetailResponseType = z.infer<typeof AdminPcbClaimDetailResponse>;

/** 관리자 대리 접수(전화·메일 건) — 첨부는 생성 후 파일 라우트로(케이스 규약과 동형). */
export const AdminPcbClaimCreateBody = z.object({
  kind: PcbClaimKind,
  affectedQty: z.number().int().min(1),
  description: z.string().trim().min(5).max(2000),
  requestedRemedy: PcbClaimRemedy,
});
export type AdminPcbClaimCreateBodyType = z.infer<typeof AdminPcbClaimCreateBody>;

const ExpectedClaimVersion = z.number().int().positive();

// 판정 전이 — BOM 미러(낙관적 잠금) + PCB 고유: 귀책(faultType)과 처리별 연결값.
// resolve(reproduce)+targetPartnerId 는 A/S 케이스 초안을 함께 만들어 연결한다.
export const AdminPcbClaimTransitionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start_review'), expectedVersion: ExpectedClaimVersion }),
  z.object({
    action: z.literal('resolve'),
    expectedVersion: ExpectedClaimVersion,
    resolutionKind: PcbClaimResolution,
    faultType: PcbClaimFaultType,
    response: z.string().trim().min(5).max(2000),
    /** resolutionKind=reproduce 일 때 — 지정하면 A/S 케이스 초안 생성+연결까지 한 번에. */
    targetPartnerId: z.number().int().positive().optional(),
    chargeAmount: z.number().int().min(0).optional(),
    refundAmount: z.number().int().min(0).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    expectedVersion: ExpectedClaimVersion,
    faultType: PcbClaimFaultType.optional(),
    response: z.string().trim().min(5).max(2000),
  }),
]);
export type AdminPcbClaimTransitionBodyType = z.infer<typeof AdminPcbClaimTransitionBody>;

export const AdminPcbClaimMutateResponse = z.object({
  result: z.literal(true),
  data: z.object({ claim: PcbClaimView }),
});
export type AdminPcbClaimMutateResponseType = z.infer<typeof AdminPcbClaimMutateResponse>;

/** 회수 기록(자유 메모) — 상태 전이가 아니라 검토 노트라 버전 잠금 없이 최종쓰기 우선. */
export const AdminPcbClaimReturnBody = z.object({
  returnRequired: z.boolean(),
  returnNote: z.string().trim().max(500).optional(),
});
export type AdminPcbClaimReturnBodyType = z.infer<typeof AdminPcbClaimReturnBody>;

// A/S 케이스에 노출되는 연결 클레임 요약 — 협력사가 증상·수량·고객 사진을 본다
// (첨부 실물 복사 없이 참조 노출 — 다운로드는 케이스 경유 라우트가 검증).
export const PcbAsCaseClaimBrief = z.object({
  claimId: z.string(),
  kind: PcbClaimKind,
  description: z.string(),
  orderedQty: z.number().int(),
  affectedQty: z.number().int(),
  files: z.array(PcbClaimFileView),
});
export type PcbAsCaseClaimBriefType = z.infer<typeof PcbAsCaseClaimBrief>;
