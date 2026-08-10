import { z } from 'zod';

// ── PCB A/S 케이스 — sp_pcb_as_case 계약(P4) ────────────────────────────────
// 정본: docs/PCB_PARTNER_TRACK.md §9 A/S. 완료·출고된 발주의 재생산(회차 재발주)
// 접수 헤더다. 케이스는 합의(접수→회신→진행)만 담고, 재생산 자체는 [재발주 진행]이
// 만드는 회차 발주서(sp_pcb_po reorderRound>0)가 기존 EQ·선적 파이프를 그대로 탄다.
// 회차는 proceed 시점에 채번(초안이 회차를 점유하지 않는다 — 레거시 규칙 승계).

export const PCB_AS_CASE_STATUSES = [
  'draft', // 관리자 초안 — 협력사 미노출
  'submitted', // 접수 전송 — 협력사 회신 대기
  'accepted', // 협력사: 재생산 가능(제시 비용 조건 승인)
  'rejected', // 협력사: 재생산 불가 — 종결(같은 건은 새 케이스로)
  'proceeded', // 재발주 진행 — 회차 부여 + 회차 발주서 생성, 종결
] as const;
export type PcbAsCaseStatusType = (typeof PCB_AS_CASE_STATUSES)[number];
export const PcbAsCaseStatus = z.enum(PCB_AS_CASE_STATUSES);

export const PCB_AS_CASE_STATUS_LABELS = {
  draft: '작성',
  submitted: '접수',
  accepted: '재생산 가능',
  rejected: '재생산 불가',
  proceeded: '재발주 진행',
} as const satisfies Record<PcbAsCaseStatusType, string>;

export const PCB_AS_CASE_TYPES = ['admin_fault', 'product_defect'] as const;
export type PcbAsCaseTypeType = (typeof PCB_AS_CASE_TYPES)[number];
export const PcbAsCaseType = z.enum(PCB_AS_CASE_TYPES);

export const PCB_AS_CASE_TYPE_LABELS = {
  admin_fault: '관리자 실수',
  product_defect: '제품 불량',
} as const satisfies Record<PcbAsCaseTypeType, string>;

export const PCB_AS_CHARGE_TYPES = ['paid', 'free'] as const;
export type PcbAsChargeTypeType = (typeof PCB_AS_CHARGE_TYPES)[number];
export const PcbAsChargeType = z.enum(PCB_AS_CHARGE_TYPES);

export const PCB_AS_CHARGE_LABELS = {
  paid: '유상',
  free: '무상',
} as const satisfies Record<PcbAsChargeTypeType, string>;

/** 유형별 기본 비용 — 관리자 실수=유상(협력사가 재작업 대가를 받는다) / 제품 불량=무상.
 *  등록 화면 프리필과 서버의 생략 기본값이 같은 규칙을 쓴다(레거시 resolveCharge 승계). */
export const defaultPcbAsCharge = (caseType: PcbAsCaseTypeType): PcbAsChargeTypeType =>
  caseType === 'product_defect' ? 'free' : 'paid';

// 첨부 — sp_file refType 'sp_pcb_as_case'. 관리자 접수 자료와 협력사 회신 자료
// (불량 사진 등)를 uploadedBy 로 구분한다(레거시는 회신이 관리자 첨부를 덮어쓰는
// 결함 — 여기서는 역할별로 자기 것만 교체·삭제).
export const PcbAsCaseFileView = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  uploadedBy: z.string().nullable(), // ADMIN|PARTNER
  uploadedAt: z.string(),
});
export type PcbAsCaseFileViewType = z.infer<typeof PcbAsCaseFileView>;

// 대상(재생산 협력사) 후보 — 이 스펙의 원주문(round 0) 발주를 보유한 협력사.
// 트랙(직거래/MD 경유)은 그 발주에서 도출된다 — 화면이 따로 고르지 않는다.
export const PcbAsCandidateView = z.object({
  partnerId: z.number(),
  partnerName: z.string(),
  parentPartnerId: z.number(), // 0=직거래, 그 외=MD 조직 id
  parentPartnerName: z.string().nullable(),
  poId: z.number(), // 원주문 발주서(회차 발주의 조건 prefill 근거)
});
export type PcbAsCandidateViewType = z.infer<typeof PcbAsCandidateView>;

export const AdminPcbAsCaseView = z.object({
  id: z.number(),
  specId: z.number(),
  reorderRound: z.number().nullable(), // proceed 전 null
  caseType: PcbAsCaseType,
  chargeType: PcbAsChargeType,
  description: z.string().nullable(),
  status: PcbAsCaseStatus,
  targetPartnerId: z.number(),
  targetPartnerName: z.string(),
  parentPartnerId: z.number(),
  parentPartnerName: z.string().nullable(),
  replyReason: z.string().nullable(),
  createdBy: z.string(),
  submittedAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
  proceededAt: z.string().nullable(),
  createdAt: z.string(),
  /** proceeded 후 회차 최상위 발주서 id(딥링크) — 레거시는 못 내려줘 사용자가 길을
   *  잃던 갭. 직거래=대상 협력사 발주, MD 경유=관리자→MD 발주(A). */
  roundPoId: z.number().nullable(),
  files: z.array(PcbAsCaseFileView),
});
export type AdminPcbAsCaseViewType = z.infer<typeof AdminPcbAsCaseView>;

// 협력사 포털 뷰 — 관리자 식별자(createdBy)는 뺀다. MD 열람(중계 트랙)도 이 뷰.
export const PartnerPcbAsCaseView = z.object({
  id: z.number(),
  specId: z.number(),
  projectName: z.string(), // 스펙 표시(포털은 스펙 컨텍스트 밖에서 본다)
  reorderRound: z.number().nullable(),
  caseType: PcbAsCaseType,
  chargeType: PcbAsChargeType,
  description: z.string().nullable(),
  status: PcbAsCaseStatus,
  targetPartnerId: z.number(),
  targetPartnerName: z.string(), // MD 열람에서 "누가 회신 주체인지"
  parentPartnerId: z.number(),
  replyReason: z.string().nullable(),
  submittedAt: z.string().nullable(),
  repliedAt: z.string().nullable(),
  proceededAt: z.string().nullable(),
  files: z.array(PcbAsCaseFileView),
});
export type PartnerPcbAsCaseViewType = z.infer<typeof PartnerPcbAsCaseView>;

export const AdminPcbAsCaseCreateBody = z.object({
  targetPartnerId: z.number().int().positive(),
  caseType: PcbAsCaseType,
  /** 생략 시 유형 기본(defaultPcbAsCharge). */
  chargeType: PcbAsChargeType.optional(),
  description: z.string().max(4000).optional(),
});
export type AdminPcbAsCaseCreateBodyType = z.infer<typeof AdminPcbAsCaseCreateBody>;

// 수정(draft 만) — 대상 협력사 변경 시 트랙도 서버가 다시 도출한다.
export const AdminPcbAsCaseUpdateBody = AdminPcbAsCaseCreateBody;
export type AdminPcbAsCaseUpdateBodyType = z.infer<typeof AdminPcbAsCaseUpdateBody>;

export const PartnerPcbAsCaseReplyBody = z.object({
  /** 거절 시 권장, 수락 시 선택 — 강제하지 않는다(레거시 관례). */
  reason: z.string().max(4000).optional(),
});
export type PartnerPcbAsCaseReplyBodyType = z.infer<typeof PartnerPcbAsCaseReplyBody>;

export const AdminPcbAsCaseListResponse = z.object({
  result: z.literal(true),
  data: z.object({ cases: z.array(AdminPcbAsCaseView) }),
});
export type AdminPcbAsCaseListResponseType = z.infer<typeof AdminPcbAsCaseListResponse>;

export const AdminPcbAsCaseCandidatesResponse = z.object({
  result: z.literal(true),
  data: z.object({ candidates: z.array(PcbAsCandidateView) }),
});
export type AdminPcbAsCaseCandidatesResponseType = z.infer<typeof AdminPcbAsCaseCandidatesResponse>;

export const AdminPcbAsCaseMutateResponse = z.object({
  result: z.literal(true),
  data: z.object({ asCase: AdminPcbAsCaseView }),
});
export type AdminPcbAsCaseMutateResponseType = z.infer<typeof AdminPcbAsCaseMutateResponse>;

export const AdminPcbAsCaseProceedResponse = z.object({
  result: z.literal(true),
  data: z.object({
    asCase: AdminPcbAsCaseView,
    poId: z.number(), // 생성된 회차 최상위 발주서 — 화면이 바로 발주 패널로 안내
    reorderRound: z.number(),
  }),
});
export type AdminPcbAsCaseProceedResponseType = z.infer<typeof AdminPcbAsCaseProceedResponse>;

export const PartnerPcbAsCaseListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    cases: z.array(PartnerPcbAsCaseView),
    /** 요청 파트너 자신 — 화면이 "회신 주체가 나인지"(target)와 "중계 열람"(MD)을 가른다. */
    partnerId: z.number(),
    partnerName: z.string(),
  }),
});
export type PartnerPcbAsCaseListResponseType = z.infer<typeof PartnerPcbAsCaseListResponse>;

export const PartnerPcbAsCaseDetailResponse = z.object({
  result: z.literal(true),
  data: z.object({ asCase: PartnerPcbAsCaseView }),
});
export type PartnerPcbAsCaseDetailResponseType = z.infer<typeof PartnerPcbAsCaseDetailResponse>;
