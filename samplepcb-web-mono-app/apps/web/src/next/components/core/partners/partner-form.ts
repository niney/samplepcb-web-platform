import type {
  AdminPartnerCreateBodyType,
  AdminPartnerDetailType,
  AdminPartnerUpdateBodyType,
  PartnerCapabilityType,
  PartnerStatusType,
  PartnerTypeType,
} from '@sp/api-contract';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// 파트너(조직) 등록·수정 폼 — 옛 pages/admin/AdminPartners.vue 의 emptyForm·toNullable·요청 본문을 그대로 옮겼다.
// 등록과 수정이 같은 칸을 쓰고(수정만 담당자·전화·메모를 더 보인다), 빈 칸은 null 로 보낸다.

export interface PartnerForm {
  type: PartnerTypeType;
  name: string;
  supplierCode: string;
  country: string;
  defaultCurrency: string;
  capabilities: PartnerCapabilityType[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  businessNo: string;
  ownerName: string;
  businessZip: string;
  businessAddress: string;
  businessType: string;
  businessItem: string;
  fax: string;
  memo: string;
}

export const emptyPartnerForm = (): PartnerForm => ({
  type: 'partner',
  name: '',
  supplierCode: '',
  country: '',
  defaultCurrency: 'KRW',
  capabilities: ['bom_rfq'],
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  businessNo: '',
  ownerName: '',
  businessZip: '',
  businessAddress: '',
  businessType: '',
  businessItem: '',
  fax: '',
  memo: '',
});

export const partnerFormFromDetail = (d: AdminPartnerDetailType): PartnerForm => ({
  type: d.type,
  name: d.name,
  supplierCode: d.supplierCode ?? '',
  country: d.country ?? '',
  defaultCurrency: d.defaultCurrency,
  capabilities: [...d.capabilities],
  contactName: d.contactName ?? '',
  contactPhone: d.contactPhone ?? '',
  contactEmail: d.contactEmail ?? '',
  businessNo: d.businessNo ?? '',
  ownerName: d.ownerName ?? '',
  businessZip: d.businessZip ?? '',
  businessAddress: d.businessAddress ?? '',
  businessType: d.businessType ?? '',
  businessItem: d.businessItem ?? '',
  fax: d.fax ?? '',
  memo: d.memo ?? '',
});

const toNullable = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** 등록 본문 — 등록은 즉시 승인(status approved), 통화를 비우면 KRW. */
export const partnerCreateBody = (f: PartnerForm): AdminPartnerCreateBodyType => ({
  type: f.type,
  name: f.name.trim(),
  supplierCode: toNullable(f.supplierCode),
  country: toNullable(f.country),
  defaultCurrency: f.defaultCurrency.trim() === '' ? 'KRW' : f.defaultCurrency.trim(),
  capabilities: f.capabilities,
  status: 'approved',
  contactName: toNullable(f.contactName),
  contactPhone: toNullable(f.contactPhone),
  contactEmail: toNullable(f.contactEmail),
  businessNo: toNullable(f.businessNo),
  ownerName: toNullable(f.ownerName),
  businessZip: toNullable(f.businessZip),
  businessAddress: toNullable(f.businessAddress),
  businessType: toNullable(f.businessType),
  businessItem: toNullable(f.businessItem),
  fax: toNullable(f.fax),
  memo: toNullable(f.memo),
});

export const partnerUpdateBody = (f: PartnerForm): AdminPartnerUpdateBodyType => ({
  type: f.type,
  name: f.name.trim(),
  supplierCode: toNullable(f.supplierCode),
  country: toNullable(f.country),
  defaultCurrency: f.defaultCurrency.trim(),
  capabilities: f.capabilities,
  contactName: toNullable(f.contactName),
  contactPhone: toNullable(f.contactPhone),
  contactEmail: toNullable(f.contactEmail),
  businessNo: toNullable(f.businessNo),
  ownerName: toNullable(f.ownerName),
  businessZip: toNullable(f.businessZip),
  businessAddress: toNullable(f.businessAddress),
  businessType: toNullable(f.businessType),
  businessItem: toNullable(f.businessItem),
  fax: toNullable(f.fax),
  memo: toNullable(f.memo),
});

/** 조직 상태 배지 — 승인=끝남(success), 승인 대기=기다림(warning), 정지=문제(danger). */
export const partnerStatusVariant = (s: PartnerStatusType): BadgeVariant =>
  s === 'approved' ? 'success' : s === 'pending' ? 'warning' : 'danger';
