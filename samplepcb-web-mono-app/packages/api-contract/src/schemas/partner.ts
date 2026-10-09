import { z } from 'zod';
import { PcbCurrency } from './pcb-rfq';

// 로그인 계정의 협력사 포털 노출 여부 — 조직 소속·승인 상태는 서버가 매 요청 판정한다.
// tracks(포털 재설계 R1) = 조직 capabilities 에서 파생한 참여 트랙 — 포털 모듈
// 스위처 노출·진입 리졸버의 단일 근거.
// `parts`(= part_sale, 2026-08-23)는 모듈이 아니라 **공통 영역**이다 — 수금과 같은 자리로,
// 모듈 스위처(bom·pcb)에는 등장하지 않고 사이드바 공통 그룹에만 뜬다.
// `canManageChildren` = 하위 협력사 메뉴 노출 근거(PCB 트랙 보유 ∧ 다른 마스터딜러의 하위가 아님).
// `actingAdmin` = 관리자 대리 접속 중(요청에 ACT_AS_PARTNER_HEADER 가 실렸다) — 셸이 띠를 그린다.
export const PartnerAccessResponse = z.object({
  result: z.literal(true),
  data: z.object({
    isPartner: z.boolean(),
    partnerName: z.string().nullable(),
    tracks: z.object({ bom: z.boolean(), pcb: z.boolean(), parts: z.boolean() }),
    canManageChildren: z.boolean().default(false),
    actingAdmin: z.boolean().default(false),
  }),
});
export type PartnerAccessResponseType = z.infer<typeof PartnerAccessResponse>;

// 관리자 대리 접속 — 관리자가 협력사 포털 API(`/api/partner/*`)를 **그 조직으로** 부를 때 싣는
// 요청 헤더(값 = 조직 id). 관리자 토큰이 아니면 서버가 403 으로 거절한다. 쓰기 요청은
// sp_partner_act_log 에 남고, 이력의 주체 표기는 관리자 대행(ADMIN) 관례를 따른다.
export const ACT_AS_PARTNER_HEADER = 'x-sp-act-as-partner';

// ── 공용 파트너(조직) — sp_partner* 계약 ───────────────────────────────────
// 설계 정본: docs/SMARTBOM_PARTNER_RFQ.md §1. 조직(sp_partner)/계정(sp_partner_member)/
// 자동화(supplierCode) 3축 분리 — 유형·상태·capability 코드 사전은 이 파일이 단일 정본.
// 레거시(g5_member 여분컬럼 협력사 + 가짜 회원 하드코딩 공급사)의 대체.

// 조직 유형 — partner(사람 협력사)|supplier(API 공급사)|house(자사).
export const PARTNER_TYPES = ['partner', 'supplier', 'house'] as const;
export type PartnerTypeType = (typeof PARTNER_TYPES)[number];
export const PartnerType = z.enum(PARTNER_TYPES);

export const PARTNER_TYPE_LABELS = {
  partner: '협력사',
  supplier: '공급사',
  house: '자사',
} as const satisfies Record<PartnerTypeType, string>;

// 승인 워크플로 상태(SpMarketExpert 어휘 축약) — rejected 없음: 등록 원천이 관리자/이관이라
// 반려 개념이 없고, 운영 배제는 suspended 로 통일한다.
export const PARTNER_STATUSES = ['pending', 'approved', 'suspended'] as const;
export type PartnerStatusType = (typeof PARTNER_STATUSES)[number];
export const PartnerStatus = z.enum(PARTNER_STATUSES);

export const PARTNER_STATUS_LABELS = {
  pending: '승인 대기',
  approved: '승인',
  suspended: '정지',
} as const satisfies Record<PartnerStatusType, string>;

// 계정 연결 역할 — 스키마는 1:N, 1차 운영은 owner 1행.
export const PARTNER_MEMBER_ROLES = ['owner', 'staff'] as const;
export type PartnerMemberRoleType = (typeof PARTNER_MEMBER_ROLES)[number];
export const PartnerMemberRole = z.enum(PARTNER_MEMBER_ROLES);

// capability — 레거시 partnerAuth 등급(A/B/C/부품판매)의 재해석: 참여 가능한 트랙.
export const PARTNER_CAPABILITIES = ['bom_rfq', 'pcb_rfq', 'part_sale'] as const;
export type PartnerCapabilityType = (typeof PARTNER_CAPABILITIES)[number];
export const PartnerCapability = z.enum(PARTNER_CAPABILITIES);

export const PARTNER_CAPABILITY_LABELS = {
  bom_rfq: 'BOM 견적',
  pcb_rfq: 'PCB 견적',
  part_sale: '부품 판매',
} as const satisfies Record<PartnerCapabilityType, string>;

// supplierCode 는 SpPartOffer.supplier 와 같은 자유 어휘(공급사 추가 = 행 추가, 스키마
// 무변경 — parts.ts 관례). 고정 enum 을 두지 않고 형식만 강제한다.
export const PartnerSupplierCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/);

// ── 관리자: 파트너 관리(/app/admin/partners) ────────────────────────────────

export const AdminPartnerListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['all', 'pending', 'approved', 'suspended']).default('all'),
  type: z.enum(['all', ...PARTNER_TYPES]).default('all'),
  // 등록 원천 — md = 마스터딜러가 포털에서 직접 등록한 조직(자동 승인이라 사후 감독 대상).
  origin: z.enum(['all', 'admin', 'md']).default('all'),
  q: z.string().optional(), // name·supplierCode·contactEmail·연결 mbId contains
});
export type AdminPartnerListQueryType = z.infer<typeof AdminPartnerListQuery>;

// 탭 카운트 — 검색어·유형 필터 반영, 탭 자체는 미반영(회원 관리 관례).
export const AdminPartnerCounts = z.object({
  all: z.number(),
  pending: z.number(),
  approved: z.number(),
  suspended: z.number(),
});
export type AdminPartnerCountsType = z.infer<typeof AdminPartnerCounts>;

export const AdminPartnerMemberItem = z.object({
  mbId: z.string(),
  role: PartnerMemberRole,
  createdAt: z.string(),
});
export type AdminPartnerMemberItemType = z.infer<typeof AdminPartnerMemberItem>;

export const AdminPartnerListItem = z.object({
  partnerId: z.number(),
  type: PartnerType,
  name: z.string(),
  supplierCode: z.string().nullable(),
  country: z.string().nullable(),
  defaultCurrency: z.string(),
  capabilities: z.array(PartnerCapability),
  status: PartnerStatus,
  contactEmail: z.string().nullable(),
  memberCount: z.number(), // 연결 계정 수(0=순수 공급사)
  // 마스터딜러가 포털에서 등록한 조직이면 그 소유 조직(null=관리자 등록).
  ownerPartnerId: z.number().nullable().default(null),
  ownerPartnerName: z.string().nullable().default(null),
  // 사업자번호·담당 이메일이 같은 다른 협력사 수 — 여러 마스터딜러가 같은 회사를 각각 등록한 흔적.
  duplicateCount: z.number().default(0),
  createdAt: z.string(),
});
export type AdminPartnerListItemType = z.infer<typeof AdminPartnerListItem>;

export const AdminPartnerListResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminPartnerListItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminPartnerCounts,
  }),
});
export type AdminPartnerListResponseType = z.infer<typeof AdminPartnerListResponse>;

// 같은 회사로 보이는 다른 협력사 — 판단은 사람이 한다(자동 병합 없음).
export const AdminPartnerDuplicate = z.object({
  partnerId: z.number(),
  name: z.string(),
  matchedBy: z.enum(['businessNo', 'contactEmail']),
});
export type AdminPartnerDuplicateType = z.infer<typeof AdminPartnerDuplicate>;

export const AdminPartnerDetail = AdminPartnerListItem.extend({
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  businessNo: z.string().nullable(),
  ownerName: z.string().nullable(),
  businessZip: z.string().nullable(),
  businessAddress: z.string().nullable(),
  businessType: z.string().nullable(),
  businessItem: z.string().nullable(),
  fax: z.string().nullable(),
  memo: z.string().nullable(), // 내부 메모 — 협력사 비노출
  statusReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdBy: z.string().nullable().default(null), // 포털 등록 계정(마스터딜러 등록분)
  ownerSuspended: z.boolean().default(false), // 소유 마스터딜러가 사용 중지한 상태
  duplicates: z.array(AdminPartnerDuplicate).default([]),
  members: z.array(AdminPartnerMemberItem),
});
export type AdminPartnerDetailType = z.infer<typeof AdminPartnerDetail>;

export const AdminPartnerDetailResponse = z.object({
  result: z.literal(true),
  data: AdminPartnerDetail,
});
export type AdminPartnerDetailResponseType = z.infer<typeof AdminPartnerDetailResponse>;

// 생성 — 등록 원천이 관리자라 기본 approved(즉시 RFQ 대상). supplierCode 는
// supplier·house 에서만 의미가 있으며 라우트가 유형 정합을 검증한다.
const AdminPartnerCreateFields = z.object({
  type: PartnerType,
  name: z.string().trim().min(1).max(191),
  supplierCode: PartnerSupplierCode.nullish(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullish(), // ISO alpha-2
  defaultCurrency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default('KRW'),
  capabilities: z.array(PartnerCapability).default([]),
  status: PartnerStatus.default('approved'),
  contactName: z.string().trim().max(100).nullish(),
  contactPhone: z.string().trim().max(50).nullish(),
  contactEmail: z.string().trim().email().max(255).nullish(), // RFQ 알림 수신처
  businessNo: z.string().trim().max(30).nullish(),
  ownerName: z.string().trim().max(100).nullish(),
  businessZip: z.string().trim().max(10).nullish(),
  businessAddress: z.string().trim().max(500).nullish(),
  businessType: z.string().trim().max(100).nullish(),
  businessItem: z.string().trim().max(100).nullish(),
  fax: z.string().trim().max(50).nullish(),
  memo: z.string().max(5000).nullish(),
});
export const AdminPartnerCreateBody = AdminPartnerCreateFields.superRefine((value, ctx) => {
  if (value.type === 'partner' && value.status === 'approved' && value.country == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '승인 협력사는 국가가 필요합니다.',
      path: ['country'],
    });
  }
});
export type AdminPartnerCreateBodyType = z.infer<typeof AdminPartnerCreateBody>;

// 수정 — 부분 갱신. status 는 전용 엔드포인트(감사 기록)로만 변경한다.
export const AdminPartnerUpdateBody = AdminPartnerCreateFields.omit({ status: true }).partial();
export type AdminPartnerUpdateBodyType = z.infer<typeof AdminPartnerUpdateBody>;

// 상태 변경 — suspended 는 사유 필수(감사·통지).
export const AdminPartnerStatusBody = z
  .object({
    status: PartnerStatus,
    reason: z.string().trim().max(255).optional(),
  })
  .refine((v) => v.status !== 'suspended' || Boolean(v.reason?.length), {
    message: 'reason required to suspend',
    path: ['reason'],
  });
export type AdminPartnerStatusBodyType = z.infer<typeof AdminPartnerStatusBody>;

export const AdminPartnerMutationResponse = z.object({
  result: z.literal(true),
  data: AdminPartnerDetail,
});
export type AdminPartnerMutationResponseType = z.infer<typeof AdminPartnerMutationResponse>;

// 계정 연결 — 정상 가입한 g5_member 의 mbId 를 조직에 연결(가짜 회원 없음).
export const AdminPartnerMemberAddBody = z.object({
  mbId: z.string().trim().min(1).max(191),
  role: PartnerMemberRole.default('owner'),
});
export type AdminPartnerMemberAddBodyType = z.infer<typeof AdminPartnerMemberAddBody>;

export const AdminPartnerDeleteResponse = z.object({
  result: z.literal(true),
});
export type AdminPartnerDeleteResponseType = z.infer<typeof AdminPartnerDeleteResponse>;

// ── 마스터딜러(MD) 소속 — sp_partner_relation 관리 ──────────────────────────
// PCB 트랙 MD 2단 중개(docs/PCB_PARTNER_TRACK.md §1.4·D1)의 소속 링크 계약.
// 링크 통화(settlementCurrency)는 MD↔하위 결제통화 — 배정 시점에 RFQ 행으로
// 박제(resolveLinkCurrency)되므로 변경은 이후 배정부터 적용된다. null=런타임 USD.

// 소속 링크 1건 — 상대 조직 관점(parents 목록이면 상위 MD, children 목록이면 하위).
export const AdminPartnerRelationLink = z.object({
  partnerId: z.number(), // 상대 조직 id
  name: z.string(),
  country: z.string().nullable(),
  status: PartnerStatus,
  settlementCurrency: z.string().nullable(), // null=런타임 USD 폴백(레거시 승계)
  activeCount: z.number(), // 진행 중 문서 수(RFQ 왕복·발주 미종결) — 0일 때만 해제 가능
  createdBy: z.string().nullable().default(null), // 연결한 계정(관리자 또는 마스터딜러)
  forceNote: z.string().nullable().default(null), // 관리자 강제 전환 사유
  createdAt: z.string(),
});
export type AdminPartnerRelationLinkType = z.infer<typeof AdminPartnerRelationLink>;

// 하위 연결 후보 — 서버가 2단 규칙(자신·기존 하위·이미 MD 인 조직 제외)을 선반영.
export const AdminPartnerRelationCandidate = z.object({
  partnerId: z.number(),
  name: z.string(),
  country: z.string().nullable(),
  hasPcbRfq: z.boolean(), // pcb_rfq 능력 — 없으면 RFQ 배정 단계에서 거부되므로 UI 경고
});
export type AdminPartnerRelationCandidateType = z.infer<typeof AdminPartnerRelationCandidate>;

export const AdminPartnerRelationsData = z.object({
  parents: z.array(AdminPartnerRelationLink), // 이 조직이 소속된 상위 MD
  children: z.array(AdminPartnerRelationLink), // 이 조직의 하위 협력사
  candidates: z.array(AdminPartnerRelationCandidate),
  // 첫 하위 연결(마스터딜러 전환)이 지금 막히는 조직이면 진행 중 직속 발주 수 — 화면이 미리
  // 알리고, 관리자는 사유를 적어 강제로 넘을 수 있다. null=막히지 않는다.
  conversionBlock: z.object({ activePoCount: z.number() }).nullable().default(null),
});
export type AdminPartnerRelationsDataType = z.infer<typeof AdminPartnerRelationsData>;

export const AdminPartnerRelationsResponse = z.object({
  result: z.literal(true),
  data: AdminPartnerRelationsData,
});
export type AdminPartnerRelationsResponseType = z.infer<typeof AdminPartnerRelationsResponse>;

// force — 진행 중 직속 발주가 있어도 첫 하위를 연결한다(관리자 전용). 발주 방식은 발주서마다
// 박제돼 있어 진행 건은 바뀌지 않는다. 2단 제한·승인 상태 같은 구조 제약은 강제로도 못 넘는다.
export const AdminPartnerRelationAddBody = z
  .object({
    childPartnerId: z.number().int().positive(),
    settlementCurrency: PcbCurrency.default('USD'),
    force: z.boolean().default(false),
    forceReason: z.string().trim().max(255).optional(),
  })
  .refine((v) => !v.force || Boolean(v.forceReason?.length), {
    message: 'forceReason required to force',
    path: ['forceReason'],
  });
export type AdminPartnerRelationAddBodyType = z.infer<typeof AdminPartnerRelationAddBody>;

export const AdminPartnerRelationCurrencyBody = z.object({
  settlementCurrency: PcbCurrency,
});
export type AdminPartnerRelationCurrencyBodyType = z.infer<typeof AdminPartnerRelationCurrencyBody>;

// ── 관리자 대리 접속 이력 — sp_partner_act_log ───────────────────────────────
export const AdminPartnerActLogItem = z.object({
  id: z.number(),
  adminMbId: z.string(),
  method: z.string(),
  path: z.string(),
  statusCode: z.number(),
  createdAt: z.string(),
});
export type AdminPartnerActLogItemType = z.infer<typeof AdminPartnerActLogItem>;

export const AdminPartnerActLogResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(AdminPartnerActLogItem) }),
});
export type AdminPartnerActLogResponseType = z.infer<typeof AdminPartnerActLogResponse>;

// ── 포털: 하위 협력사 직접 관리(/app/partner/children) ───────────────────────
// 마스터딜러가 자기 하위 협력사를 등록·수정·삭제한다(docs/PARTNER_PORTAL.md "하위 협력사
// 직접 관리"). 등록은 자동 승인이고 회원 계정은 만들지 않는다 — 하위는 매직링크로 견적을
// 회신하고 이후 단계는 마스터딜러가 대행한다. 계정이 필요하면 초대 링크로 본인이 연결한다.

// 지금 하위를 등록할 수 없는 이유 — 화면은 폼을 열기 전에 이 값으로 안내한다.
//  · NO_PCB_TRACK    PCB 견적 능력이 없는 조직(마스터딜러 중개는 PCB 트랙에만 있다)
//  · PARENT_IS_CHILD 다른 마스터딜러의 하위(2단 제한)
//  · ACTIVE_POS      진행 중 직속 발주가 있어 첫 하위 등록(마스터딜러 전환)이 보류된다
export const PARTNER_CHILD_BLOCK_REASONS = ['NO_PCB_TRACK', 'PARENT_IS_CHILD', 'ACTIVE_POS'] as const;
export type PartnerChildBlockReasonType = (typeof PARTNER_CHILD_BLOCK_REASONS)[number];

export const PartnerChildEligibility = z.object({
  allowed: z.boolean(),
  reason: z.enum(PARTNER_CHILD_BLOCK_REASONS).nullable(),
  activePoCount: z.number(),
  // ACTIVE_POS 안내용 — 어느 발주가 끝나야 하는지(최대 10건).
  activePos: z.array(z.object({ poId: z.number(), projectName: z.string() })),
  // 관리자 대리 접속이면 ACTIVE_POS 를 사유와 함께 넘을 수 있다.
  canForce: z.boolean(),
});
export type PartnerChildEligibilityType = z.infer<typeof PartnerChildEligibility>;

export const PartnerChildInvite = z.object({
  email: z.string(),
  expiresAt: z.string(),
  pending: z.boolean(), // 아직 수락 전이고 기한이 남았다
});
export type PartnerChildInviteType = z.infer<typeof PartnerChildInvite>;

export const PartnerChildItem = z.object({
  partnerId: z.number(),
  name: z.string(),
  country: z.string().nullable(),
  status: PartnerStatus,
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  settlementCurrency: z.string().nullable(), // 링크 통화(null=런타임 USD)
  owned: z.boolean(), // 내가 등록한 조직 — 수정·삭제 가능. false=관리자가 연결(읽기 전용)
  ownerSuspended: z.boolean(), // 내가 사용 중지했다 — 다시 사용으로 되돌릴 수 있다
  activeCount: z.number(), // 진행 중 견적·발주 — 0일 때만 삭제·사용 중지
  hasHistory: z.boolean(), // 이력이 있으면 삭제 대신 사용 중지된다
  hasPortalAccount: z.boolean(),
  invite: PartnerChildInvite.nullable(), // 가장 최근 초대
  createdAt: z.string(),
});
export type PartnerChildItemType = z.infer<typeof PartnerChildItem>;

export const PartnerChildListData = z.object({
  eligibility: PartnerChildEligibility,
  items: z.array(PartnerChildItem),
});
export type PartnerChildListDataType = z.infer<typeof PartnerChildListData>;

export const PartnerChildListResponse = z.object({
  result: z.literal(true),
  data: PartnerChildListData,
});
export type PartnerChildListResponseType = z.infer<typeof PartnerChildListResponse>;

const PartnerChildFields = z.object({
  name: z.string().trim().min(1).max(191),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/), // 승인 협력사는 국가가 있어야 한다(발송 구분의 근거)
  settlementCurrency: PcbCurrency,
  contactName: z.string().trim().max(100).nullish(),
  contactPhone: z.string().trim().max(50).nullish(),
  contactEmail: z.string().trim().email().max(255).nullish(), // 견적요청 메일·초대 수신처
});

// forceReason — 관리자 대리 접속에서만 받는다(ACTIVE_POS 강제 전환 사유).
export const PartnerChildCreateBody = PartnerChildFields.extend({
  forceReason: z.string().trim().min(1).max(255).optional(),
});
export type PartnerChildCreateBodyType = z.infer<typeof PartnerChildCreateBody>;

export const PartnerChildUpdateBody = PartnerChildFields.partial();
export type PartnerChildUpdateBodyType = z.infer<typeof PartnerChildUpdateBody>;

// 삭제 결과 — 이력이 없으면 실제로 지우고(deleted), 있으면 사용 중지(suspended)로 남긴다.
export const PartnerChildDeleteResponse = z.object({
  result: z.literal(true),
  data: PartnerChildListData.extend({ outcome: z.enum(['deleted', 'suspended']) }),
});
export type PartnerChildDeleteResponseType = z.infer<typeof PartnerChildDeleteResponse>;

// 초대 — email 생략 시 조직의 담당 이메일로 보낸다.
export const PartnerChildInviteBody = z.object({
  email: z.string().trim().email().max(255).optional(),
});
export type PartnerChildInviteBodyType = z.infer<typeof PartnerChildInviteBody>;

// ── 포털 초대 수락(/app/partner-invite/:token) ───────────────────────────────
// 링크를 받은 사람이 **자기 계정으로** 로그인해 수락하면 그 계정이 조직에 연결된다.
// unavailable = 조직이 정지·미승인이라 지금은 수락할 수 없다.
export const PARTNER_INVITE_STATES = ['valid', 'expired', 'accepted', 'unavailable'] as const;
export type PartnerInviteStateType = (typeof PARTNER_INVITE_STATES)[number];

export const PartnerInviteInfoResponse = z.object({
  result: z.literal(true),
  data: z.object({
    partnerName: z.string(),
    inviterName: z.string().nullable(), // 초대한 조직(마스터딜러) — 관리자가 보냈으면 null
    state: z.enum(PARTNER_INVITE_STATES),
  }),
});
export type PartnerInviteInfoResponseType = z.infer<typeof PartnerInviteInfoResponse>;

export const PartnerInviteAcceptResponse = z.object({
  result: z.literal(true),
  data: z.object({ partnerName: z.string() }),
});
export type PartnerInviteAcceptResponseType = z.infer<typeof PartnerInviteAcceptResponse>;
