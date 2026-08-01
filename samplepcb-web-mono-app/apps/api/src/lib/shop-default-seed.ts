// 영카트 초기 쇼핑몰 기본설정의 판단 로직.
// 사업자정보와 계좌정보는 사이트·주문·견적서에 공개되는 운영 기본값이며,
// 로컬 g5_shop_default 값을 초기 설치 정본으로 고정한다.
// 실제 DB 쓰기는 scripts/seed-initial-data.ts가 담당한다.

export interface ShopBusinessInfo {
  companyName: string;
  businessNo: string;
  ownerName: string;
  tel: string;
  fax: string;
  mailOrderNo: string;
  bugaNo: string;
  zip: string;
  addr: string;
  infoManagerName: string;
  infoManagerEmail: string;
}

export const INITIAL_SHOP_BUSINESS_INFO: ShopBusinessInfo = {
  companyName: '주식회사 샘플피씨비',
  businessNo: '331-88-01750',
  ownerName: '오혜영',
  tel: '02-123-4567',
  fax: '02-123-4568',
  mailOrderNo: '제 2020-서울금천-0497 호',
  bugaNo: '12345호',
  zip: '14322',
  addr: '경기도 광명시 하안로 60 광명SK테크노파크 A동 1303, 1407호',
  infoManagerName: '오혜영',
  infoManagerEmail: 'info@samplepcb.co.kr',
};

export const GNUBOARD_INSTALLER_BUSINESS_INFO: ShopBusinessInfo = {
  companyName: '회사명',
  businessNo: '123-45-67890',
  ownerName: '대표자명',
  tel: '02-123-4567',
  fax: '02-123-4568',
  mailOrderNo: '제 OO구 - 123호',
  bugaNo: '12345호',
  zip: '123-456',
  addr: 'OO도 OO시 OO구 OO동 123-45',
  infoManagerName: '정보책임자명',
  infoManagerEmail: '정보책임자 E-mail',
};

export type ShopBusinessInfoKey = keyof ShopBusinessInfo;
export type ShopBusinessInfoColumn =
  | 'de_admin_company_name'
  | 'de_admin_company_saupja_no'
  | 'de_admin_company_owner'
  | 'de_admin_company_tel'
  | 'de_admin_company_fax'
  | 'de_admin_tongsin_no'
  | 'de_admin_buga_no'
  | 'de_admin_company_zip'
  | 'de_admin_company_addr'
  | 'de_admin_info_name'
  | 'de_admin_info_email';

export const SHOP_BUSINESS_INFO_FIELDS: readonly {
  key: ShopBusinessInfoKey;
  column: ShopBusinessInfoColumn;
}[] = [
  { key: 'companyName', column: 'de_admin_company_name' },
  { key: 'businessNo', column: 'de_admin_company_saupja_no' },
  { key: 'ownerName', column: 'de_admin_company_owner' },
  { key: 'tel', column: 'de_admin_company_tel' },
  { key: 'fax', column: 'de_admin_company_fax' },
  { key: 'mailOrderNo', column: 'de_admin_tongsin_no' },
  { key: 'bugaNo', column: 'de_admin_buga_no' },
  { key: 'zip', column: 'de_admin_company_zip' },
  { key: 'addr', column: 'de_admin_company_addr' },
  { key: 'infoManagerName', column: 'de_admin_info_name' },
  { key: 'infoManagerEmail', column: 'de_admin_info_email' },
];

export const INITIAL_SHOP_BANK_ACCOUNT = [
  '기업은행  568-040438-04-017',
  '예금주명: 주식회사 샘플피씨비',
].join('\n');

export const GNUBOARD_INSTALLER_BANK_ACCOUNT = 'OO은행 12345-67-89012 예금주명';

export interface ShopDefaultSettings extends ShopBusinessInfo {
  bankUse: number;
  bankAccount: string;
}

type ShopBankUpdateReason = 'empty' | 'installer-placeholder' | 'disabled' | 'forced';
type ShopBankSkipReason = 'already-seeded' | 'configured-different';

export type ShopBankSeedDecision =
  | {
      action: 'update';
      reason: ShopBankUpdateReason;
      bankUse: 1;
      bankAccount: string;
    }
  | {
      action: 'skip';
      reason: ShopBankSkipReason;
    };

export interface ShopBusinessSeedDecision {
  updates: Partial<ShopBusinessInfo>;
  alreadySeeded: ShopBusinessInfoKey[];
  preservedDifferent: ShopBusinessInfoKey[];
}

export interface ShopDefaultSeedDecision {
  business: ShopBusinessSeedDecision;
  bank: ShopBankSeedDecision;
}

export function normalizeShopBusinessValue(value: string): string {
  return value.trim();
}

export function normalizeShopBankAccount(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

export function planShopBusinessInfoSeed(
  current: ShopBusinessInfo,
  force = false,
): ShopBusinessSeedDecision {
  const updates: Partial<ShopBusinessInfo> = {};
  const alreadySeeded: ShopBusinessInfoKey[] = [];
  const preservedDifferent: ShopBusinessInfoKey[] = [];

  for (const field of SHOP_BUSINESS_INFO_FIELDS) {
    const key = field.key;
    const currentValue = normalizeShopBusinessValue(current[key]);
    const targetValue = normalizeShopBusinessValue(INITIAL_SHOP_BUSINESS_INFO[key]);
    const installerValue = normalizeShopBusinessValue(GNUBOARD_INSTALLER_BUSINESS_INFO[key]);

    if (currentValue === targetValue) {
      alreadySeeded.push(key);
    } else if (force || currentValue === '' || currentValue === installerValue) {
      updates[key] = INITIAL_SHOP_BUSINESS_INFO[key];
    } else {
      preservedDifferent.push(key);
    }
  }

  return { updates, alreadySeeded, preservedDifferent };
}

export function planShopBankSeed(
  current: Pick<ShopDefaultSettings, 'bankUse' | 'bankAccount'>,
  force = false,
): ShopBankSeedDecision {
  const currentAccount = normalizeShopBankAccount(current.bankAccount);
  const targetAccount = normalizeShopBankAccount(INITIAL_SHOP_BANK_ACCOUNT);

  if (currentAccount === targetAccount && current.bankUse === 1) {
    return { action: 'skip', reason: 'already-seeded' };
  }

  if (force) {
    return {
      action: 'update',
      reason: 'forced',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    };
  }

  if (currentAccount === targetAccount) {
    return {
      action: 'update',
      reason: 'disabled',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    };
  }

  if (currentAccount === '') {
    return {
      action: 'update',
      reason: 'empty',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    };
  }

  if (currentAccount === GNUBOARD_INSTALLER_BANK_ACCOUNT) {
    return {
      action: 'update',
      reason: 'installer-placeholder',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    };
  }

  return { action: 'skip', reason: 'configured-different' };
}

export function planShopDefaultSeed(
  current: ShopDefaultSettings,
  force = false,
): ShopDefaultSeedDecision {
  return {
    business: planShopBusinessInfoSeed(current, force),
    bank: planShopBankSeed(current, force),
  };
}
