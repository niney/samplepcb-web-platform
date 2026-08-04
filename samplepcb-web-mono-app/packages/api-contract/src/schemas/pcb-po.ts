import { z } from 'zod';
import { AdminPcbRfqView, PartnerPcbSpecFile } from './pcb-rfq';

// ── PCB 파트너 트랙 — sp_pcb_po 계약(P2) ─────────────────────────────────────
// 설계 정본: docs/PCB_PARTNER_TRACK.md §5.2-2·§5.2-3. 발주서 status 가 EQ·생산
// 5단계 진행 머신을 겸한다(레거시 승계 — 별도 컬럼 없음). 전이·되돌리기 사전이
// FE 라벨과 서버 검증의 단일 정본이다(레거시 pcbEqWorkflow.ts 대응, D4 영문 코드).

export const PCB_PO_STATUSES = [
  'issued',
  'eq_requested',
  'eq_done',
  'producing',
  'produced',
] as const;
export type PcbPoStatusType = (typeof PCB_PO_STATUSES)[number];
export const PcbPoStatus = z.enum(PCB_PO_STATUSES);

export const PCB_PO_STATUS_LABELS = {
  issued: '발주접수',
  eq_requested: 'EQ 승인요청',
  eq_done: 'EQ 완료',
  producing: '생산시작',
  produced: '생산완료',
} as const satisfies Record<PcbPoStatusType, string>;

// EQ 역할 — RECEIVER=수주 조직(MD 하위 트랙은 MD 가 fallback 대행 가능),
// ORDERER=항상 루트 관리자(§6 D3 — 레거시 실코드 승계, MD 는 승인자가 아니라 다리).
export const PCB_EQ_ROLES = ['RECEIVER', 'ORDERER'] as const;
export type PcbEqRoleType = (typeof PCB_EQ_ROLES)[number];
export const PCB_EQ_ROLE_LABELS = {
  RECEIVER: '수주 협력사',
  ORDERER: '관리자',
} as const satisfies Record<PcbEqRoleType, string>;

export interface PcbEqForwardAction {
  actor: PcbEqRoleType;
  to: PcbPoStatusType;
  label: string;
  /** eq-request 는 EQ·Working 파일이 먼저 올라와 있어야 한다(서버 검증). */
  needsEqFiles?: boolean;
  /** 반려 지원(ORDERER) — 반려 시 복귀 상태. */
  rejectTo?: PcbPoStatusType;
}

/** 정방향 전이 사전 — 종점(produced)은 null. */
export const PCB_EQ_FORWARD: Record<PcbPoStatusType, PcbEqForwardAction | null> = {
  issued: { actor: 'RECEIVER', to: 'eq_requested', label: 'EQ 승인요청', needsEqFiles: true },
  eq_requested: { actor: 'ORDERER', to: 'eq_done', label: 'EQ 승인', rejectTo: 'issued' },
  eq_done: { actor: 'RECEIVER', to: 'producing', label: '생산 시작' },
  producing: { actor: 'RECEIVER', to: 'produced', label: '생산 완료' },
  produced: null,
};

export interface PcbEqRevertAction {
  actor: PcbEqRoleType; // 그 상태로 진입시킨 주체만 한 칸 되돌릴 수 있다
  to: PcbPoStatusType;
  label: string;
}

/** 역방향(한 칸) 사전 — issued 는 시작 상태라 null. */
export const PCB_EQ_REVERT: Record<PcbPoStatusType, PcbEqRevertAction | null> = {
  issued: null,
  eq_requested: { actor: 'RECEIVER', to: 'issued', label: 'EQ 요청 취소' },
  eq_done: { actor: 'ORDERER', to: 'eq_requested', label: '승인 취소' },
  producing: { actor: 'RECEIVER', to: 'eq_done', label: '생산시작 취소' },
  produced: { actor: 'RECEIVER', to: 'producing', label: '생산완료 취소' },
};

// EQ 첨부 종류 — eq(질의서)·working(작업 파일). 저장은 sp_file(refType 'sp_pcb_po_eq').
export const PCB_EQ_FILE_TYPES = ['eq', 'working'] as const;
export type PcbEqFileTypeType = (typeof PCB_EQ_FILE_TYPES)[number];
export const PcbEqFileType = z.enum(PCB_EQ_FILE_TYPES);

export const PcbEqFileView = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  fileType: PcbEqFileType,
  uploadedBy: z.string().nullable(), // ADMIN|PARTNER|MASTER_DEALER
  uploadedAt: z.string(),
});
export type PcbEqFileViewType = z.infer<typeof PcbEqFileView>;

export const PcbEqEvent = z.object({
  at: z.string(),
  byRole: z.string(), // ADMIN|PARTNER|MASTER_DEALER
  fromStatus: z.string(),
  toStatus: z.string(),
  note: z.string().nullable(),
});
export type PcbEqEventType = z.infer<typeof PcbEqEvent>;

// ── 공용 뷰(관리자·MD 하위 표시) ─────────────────────────────────────────────
export const AdminPcbPoView = z.object({
  poId: z.number(),
  specId: z.number(),
  partnerId: z.number(),
  partnerName: z.string(),
  parentPartnerId: z.number(),
  parentPartnerName: z.string().nullable(),
  reorderRound: z.number().int(),
  rfqId: z.number().nullable(),
  status: PcbPoStatus,
  currency: z.string(),
  priceOriginal: z.number(),
  exchangeRate: z.number().nullable(),
  krwAmount: z.number().nullable(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  destinationCountry: z.string().nullable(),
  paymentTerms: z.string().nullable(),
  remittedAt: z.string().nullable(),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  issuedAt: z.string(),
  eqHistory: z.array(PcbEqEvent),
  eqFiles: z.array(PcbEqFileView),
  /** MD 경유 상위 발주서의 EQ 위임 대상(하위 po). null=자체 진행. */
  eqDelegatePoId: z.number().nullable(),
  /** MD 조직 수주 발주서인데 하위 발주가 아직 없어 EQ 를 시작할 수 없음. */
  eqBlocked: z.boolean(),
  /** MD 경유 표시용 — 하위 발주 수. */
  childCount: z.number().int(),
});
export type AdminPcbPoViewType = z.infer<typeof AdminPcbPoView>;

export const AdminPcbPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ pos: z.array(AdminPcbPoView) }),
});
export type AdminPcbPoListResponseType = z.infer<typeof AdminPcbPoListResponse>;

// ── 발주 생성/수정(관리자) — paid 게이트는 서버(od isPaid, §5.2-2) ────────────
// rfqId 를 주면 선정 견적행 스냅샷(통화·금액·sub·환율) 프리필, body 값이 우선.
export const AdminPcbPoCreateBody = z.object({
  partnerId: z.number().int().positive(),
  rfqId: z.number().int().positive().nullable().optional(),
  /** 결제통화 기준 발주가 — rfq 생략 시 필수. */
  priceOriginal: z.number().positive().optional(),
  /** 외화 관리자 발주의 KRW 회계 환율 — 생략 시 rfq 선정 박제값 승계. */
  exchangeRate: z.number().positive().optional(),
  paymentTerms: z.string().trim().max(50).nullable().optional(),
  remitted: z.boolean().optional(), // true=송금 완료(now 박제)
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  destinationCountry: z.enum(['KR', 'CN', 'VN']).nullable().optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type AdminPcbPoCreateBodyType = z.infer<typeof AdminPcbPoCreateBody>;

// 조건 수정 — 금액·환율은 issued 상태에서만 서버가 허용.
export const AdminPcbPoPatchBody = AdminPcbPoCreateBody.omit({
  partnerId: true,
  rfqId: true,
}).partial();
export type AdminPcbPoPatchBodyType = z.infer<typeof AdminPcbPoPatchBody>;

export const AdminPcbPoMutationResponse = z.object({
  result: z.literal(true),
  data: AdminPcbPoView,
});
export type AdminPcbPoMutationResponseType = z.infer<typeof AdminPcbPoMutationResponse>;

export const PcbPoActionResponse = z.object({ result: z.literal(true) });
export type PcbPoActionResponseType = z.infer<typeof PcbPoActionResponse>;

export const PcbPoRejectBody = z.object({ reason: z.string().trim().min(1).max(1000) });
export type PcbPoRejectBodyType = z.infer<typeof PcbPoRejectBody>;

// ── 관리자 횡단 워크큐 (/api/admin/pcb-pos) ──────────────────────────────────
export const ADMIN_PCB_PO_TABS = ['eq_pending', 'producing', 'produced', 'all'] as const;
export type AdminPcbPoTabType = (typeof ADMIN_PCB_PO_TABS)[number];

export const AdminPcbPoWorkItem = z.object({
  poId: z.number(),
  specId: z.number(),
  projectName: z.string(),
  partnerName: z.string(),
  parentPartnerName: z.string().nullable(),
  reorderRound: z.number().int(),
  status: PcbPoStatus,
  currency: z.string(),
  priceOriginal: z.number(),
  krwAmount: z.number().nullable(),
  deliveryDate: z.string().nullable(),
  issuedAt: z.string(),
  /** 관리자 차례(EQ 승인 대기 — 미러 반영). */
  adminTurn: z.boolean(),
});
export type AdminPcbPoWorkItemType = z.infer<typeof AdminPcbPoWorkItem>;

export const AdminPcbPoWorkListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPcbPoWorkItem),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
    counts: z.object({
      eq_pending: z.number().int(),
      producing: z.number().int(),
      produced: z.number().int(),
      all: z.number().int(),
    }),
  }),
});
export type AdminPcbPoWorkListResponseType = z.infer<typeof AdminPcbPoWorkListResponse>;

// ── 협력사 포털 (/api/partner/pcb-pos, requirePartner) ───────────────────────
export const PartnerPcbPoListItem = z.object({
  poId: z.number(),
  projectName: z.string(),
  qty: z.number().int(),
  status: PcbPoStatus,
  /** received=내 조직이 수주 / issued=내 조직(MD)이 하위에 발주. */
  direction: z.enum(['received', 'issued']),
  counterpartyName: z.string(), // received=발주처, issued=하위 협력사
  currency: z.string(),
  priceOriginal: z.number(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  deliveryDate: z.string().nullable(),
  remittedAt: z.string().nullable(),
  issuedAt: z.string(),
  /** 내 차례(수주 방향 RECEIVER 액션 — 위임·차단 반영). */
  myTurn: z.boolean(),
});
export type PartnerPcbPoListItemType = z.infer<typeof PartnerPcbPoListItem>;

export const PartnerPcbPoListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PartnerPcbPoListItem), partnerName: z.string() }),
});
export type PartnerPcbPoListResponseType = z.infer<typeof PartnerPcbPoListResponse>;

export const PartnerPcbPoDetail = z.object({
  poId: z.number(),
  specId: z.number(),
  status: PcbPoStatus,
  direction: z.enum(['received', 'issued']),
  requesterName: z.string(),
  currency: z.string(),
  priceOriginal: z.number(),
  subCurrency: z.string().nullable(),
  subPriceOriginal: z.number().nullable(),
  subExchangeRate: z.number().nullable(),
  paymentTerms: z.string().nullable(),
  remittedAt: z.string().nullable(),
  deliveryDate: z.string().nullable(),
  memo: z.string().nullable(),
  issuedAt: z.string(),
  eq: z.object({
    files: z.array(PcbEqFileView),
    history: z.array(PcbEqEvent),
    /** 이 발주서에서 내 EQ 역할 — null=차례 아님(관리자 몫 등). */
    myRole: z.enum(PCB_EQ_ROLES).nullable(),
    /** true=MD 가 하위 수주자 대신 진행(보조 스타일 표시). */
    fallback: z.boolean(),
    /** MD 경유 상위 — EQ 는 하위 발주서에서 진행(delegatePoId). */
    delegatePoId: z.number().nullable(),
    /** MD 수주인데 하위 발주 전 — "하위에 발주하면 EQ 가 시작됩니다". */
    blocked: z.boolean(),
  }),
  spec: z.object({
    projectName: z.string(),
    category: z.string(),
    orderCategory: z.string(),
    qty: z.number().int(),
    message: z.string().nullable(),
    specJson: z.record(z.string(), z.unknown()),
    files: z.array(PartnerPcbSpecFile),
  }),
  /** MD 전용 — 내가 발주한 하위 발주서. */
  children: z.array(AdminPcbPoView),
  /** MD 전용 — 하위 발주 프리필 후보(내 하위 트랙의 회신 견적행). */
  childRfqs: z.array(AdminPcbRfqView),
});
export type PartnerPcbPoDetailType = z.infer<typeof PartnerPcbPoDetail>;

export const PartnerPcbPoDetailResponse = z.object({
  result: z.literal(true),
  data: PartnerPcbPoDetail,
});
export type PartnerPcbPoDetailResponseType = z.infer<typeof PartnerPcbPoDetailResponse>;

// MD 하위 발주 — 하위 회신 견적행 기준(대상·통화·금액 유도, 수정 가능).
export const PartnerPcbChildPoCreateBody = z.object({
  childRfqId: z.number().int().positive(),
  priceOriginal: z.number().positive().optional(),
  paymentTerms: z.string().trim().max(50).nullable().optional(),
  remitted: z.boolean().optional(),
  deliveryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
});
export type PartnerPcbChildPoCreateBodyType = z.infer<typeof PartnerPcbChildPoCreateBody>;
