import { z } from 'zod';

// 로그인 계정의 협력사 포털 노출 여부 — 조직 소속·승인 상태는 서버가 매 요청 판정한다.
export const PartnerAccessResponse = z.object({
  result: z.literal(true),
  data: z.object({
    isPartner: z.boolean(),
    partnerName: z.string().nullable(),
  }),
});
export type PartnerAccessResponseType = z.infer<typeof PartnerAccessResponse>;

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
