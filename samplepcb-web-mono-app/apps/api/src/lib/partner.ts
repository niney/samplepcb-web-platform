import type { SpPartner, SpPartnerMember } from '@prisma/client';
import { PARTNER_CAPABILITIES } from '@sp/api-contract';
import type {
  AdminPartnerDetailType,
  AdminPartnerListItemType,
  AdminPartnerMemberItemType,
  PartnerCapabilityType,
  PartnerMemberRoleType,
  PartnerStatusType,
  PartnerTypeType,
} from '@sp/api-contract';
import { normalizePartnerCountry } from './bom-shipment-policy';

// ── 스마트 BOM 파트너 직렬화·내로잉 — 설계 docs/SMARTBOM_PARTNER_RFQ.md §1 ──
// DB 는 String/Json 저장(sp_* 관례), 응답 직전 계약 유니온으로 내로잉한다.

export const asPartnerType = (v: string): PartnerTypeType =>
  v === 'supplier' ? 'supplier' : v === 'house' ? 'house' : 'partner';

export const asPartnerStatus = (v: string): PartnerStatusType =>
  v === 'approved' ? 'approved' : v === 'suspended' ? 'suspended' : 'pending';

export const asPartnerMemberRole = (v: string): PartnerMemberRoleType =>
  v === 'staff' ? 'staff' : 'owner';

const CAPABILITY_SET: ReadonlySet<string> = new Set(PARTNER_CAPABILITIES);

export const toCapabilities = (v: unknown): PartnerCapabilityType[] =>
  Array.isArray(v)
    ? v.filter((c): c is PartnerCapabilityType => typeof c === 'string' && CAPABILITY_SET.has(c))
    : [];

export const toAdminPartnerItem = (p: SpPartner, memberCount: number): AdminPartnerListItemType => ({
  partnerId: Number(p.id),
  type: asPartnerType(p.type),
  name: p.name,
  supplierCode: p.supplierCode,
  country: p.country,
  defaultCurrency: p.defaultCurrency,
  capabilities: toCapabilities(p.capabilities),
  status: asPartnerStatus(p.status),
  contactEmail: p.contactEmail,
  memberCount,
  createdAt: p.createdAt.toISOString(),
});

export const toAdminPartnerMemberItem = (m: SpPartnerMember): AdminPartnerMemberItemType => ({
  mbId: m.mbId,
  role: asPartnerMemberRole(m.role),
  createdAt: m.createdAt.toISOString(),
});

export const toAdminPartnerDetail = (
  p: SpPartner & { members: SpPartnerMember[] },
): AdminPartnerDetailType => ({
  ...toAdminPartnerItem(p, p.members.length),
  contactName: p.contactName,
  contactPhone: p.contactPhone,
  businessNo: p.businessNo,
  ownerName: p.ownerName,
  businessZip: p.businessZip,
  businessAddress: p.businessAddress,
  businessType: p.businessType,
  businessItem: p.businessItem,
  fax: p.fax,
  memo: p.memo,
  statusReason: p.statusReason,
  decidedBy: p.decidedBy,
  decidedAt: p.decidedAt?.toISOString() ?? null,
  members: p.members.map(toAdminPartnerMemberItem),
});

// supplierCode 는 supplier(필수)·house(선택)만 보유 — partner(사람 협력사)는 금지.
// SpPartOffer.supplier 와 같은 어휘라 사람 조직에 붙으면 오퍼 원장과 의미가 충돌한다.
export const validateSupplierCode = (
  type: PartnerTypeType,
  supplierCode: string | null,
): string | null => {
  if (type === 'partner' && supplierCode !== null) {
    return '협력사(partner)는 supplierCode 를 가질 수 없습니다.';
  }
  if (type === 'supplier' && supplierCode === null) {
    return '공급사(supplier)는 supplierCode 가 필요합니다.';
  }
  return null;
};

// 실제 발송 구분은 조직 국가에서만 파생한다. 승인된 사람 협력사는 국가 없이 운영에
// 진입할 수 없고, 공급사/자사 레거시 행은 PO 발행 시 별도 게이트가 막는다.
export const validatePartnerCountry = (
  type: PartnerTypeType,
  status: PartnerStatusType,
  country: string | null,
): string | null =>
  type === 'partner' && status === 'approved' && normalizePartnerCountry(country) === null
    ? '승인 협력사는 국가(ISO 2)를 등록해야 합니다.'
    : null;
