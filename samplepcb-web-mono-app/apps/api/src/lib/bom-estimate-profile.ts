import type { BomEstimateContactType } from '@sp/api-contract';
import { getShopEstimateProfile, type ShopEstimateProfile } from './g5-db';
import { getBomEstimateContact, resolveBomEstimateContact } from './sp-config';

const EMPTY_PROFILE: ShopEstimateProfile = {
  name: '',
  owner: '',
  tel: '',
  zip: '',
  addr: '',
  managerName: '',
  managerEmail: '',
  bankAccount: '',
};

interface BomEstimateContactSettings {
  data: BomEstimateContactType;
  fallback: BomEstimateContactType;
  effective: BomEstimateContactType;
}

function contactOf(profile: ShopEstimateProfile): BomEstimateContactType {
  return {
    managerName: profile.managerName,
    managerEmail: profile.managerEmail,
  };
}

async function loadBomEstimateProfileContext(): Promise<{
  profile: ShopEstimateProfile;
  contact: BomEstimateContactSettings;
}> {
  const [profileRow, configured] = await Promise.all([
    getShopEstimateProfile(),
    getBomEstimateContact(),
  ]);
  const profile = profileRow ?? EMPTY_PROFILE;
  const fallback = contactOf(profile);
  return {
    profile,
    contact: {
      data: configured,
      fallback,
      effective: resolveBomEstimateContact(configured, fallback),
    },
  };
}

/** 관리자 설정 화면이 저장값·공통 폴백·실제 출력값을 함께 설명할 수 있게 한다. */
export async function getBomEstimateContactSettings(): Promise<BomEstimateContactSettings> {
  return (await loadBomEstimateProfileContext()).contact;
}

/**
 * 고객·관리자 BOM 견적서가 공유하는 공급자 프로필.
 * 회사 정보는 영카트 값을 유지하고 담당자 두 필드만 BOM 전용 설정으로 교체한다.
 */
export async function getBomEstimateSellerProfile(): Promise<ShopEstimateProfile> {
  const { profile, contact } = await loadBomEstimateProfileContext();
  return {
    ...profile,
    managerName: contact.effective.managerName,
    managerEmail: contact.effective.managerEmail,
  };
}
