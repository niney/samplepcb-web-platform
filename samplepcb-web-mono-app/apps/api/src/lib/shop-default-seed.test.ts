import { describe, expect, it } from 'vitest';
import {
  GNUBOARD_INSTALLER_BUSINESS_INFO,
  INITIAL_SHOP_BANK_ACCOUNT,
  INITIAL_SHOP_BUSINESS_INFO,
  planShopBankSeed,
  planShopBusinessInfoSeed,
} from './shop-default-seed';
import type { ShopBusinessInfo } from './shop-default-seed';

describe('planShopBusinessInfoSeed', () => {
  it('영카트 설치 예시값을 로컬 사업자정보로 초기화한다', () => {
    const result = planShopBusinessInfoSeed(GNUBOARD_INSTALLER_BUSINESS_INFO);

    expect(result.updates).toMatchObject({
      companyName: INITIAL_SHOP_BUSINESS_INFO.companyName,
      businessNo: INITIAL_SHOP_BUSINESS_INFO.businessNo,
      ownerName: INITIAL_SHOP_BUSINESS_INFO.ownerName,
      mailOrderNo: INITIAL_SHOP_BUSINESS_INFO.mailOrderNo,
      zip: INITIAL_SHOP_BUSINESS_INFO.zip,
      addr: INITIAL_SHOP_BUSINESS_INFO.addr,
      infoManagerName: INITIAL_SHOP_BUSINESS_INFO.infoManagerName,
      infoManagerEmail: INITIAL_SHOP_BUSINESS_INFO.infoManagerEmail,
    });
    // tel/fax/bugaNo는 로컬 정본과 영카트 예시값이 우연히 같아 이미 정합한 값이다.
    expect(result.alreadySeeded).toEqual(expect.arrayContaining(['tel', 'fax', 'bugaNo']));
    expect(result.preservedDifferent).toEqual([]);
  });

  it('빈 필드는 11개 모두 초기화한다', () => {
    const empty: ShopBusinessInfo = {
      companyName: '',
      businessNo: '',
      ownerName: '',
      tel: '',
      fax: '',
      mailOrderNo: '',
      bugaNo: '',
      zip: '',
      addr: '',
      infoManagerName: '',
      infoManagerEmail: '',
    };

    expect(Object.keys(planShopBusinessInfoSeed(empty).updates)).toHaveLength(11);
  });

  it('이미 설정된 다른 필드는 보존하고 빈 필드만 채운다', () => {
    const result = planShopBusinessInfoSeed({
      ...INITIAL_SHOP_BUSINESS_INFO,
      companyName: '운영에서 변경한 회사명',
      fax: '',
    });

    expect(result.preservedDifferent).toEqual(['companyName']);
    expect(result.updates).toEqual({ fax: INITIAL_SHOP_BUSINESS_INFO.fax });
  });

  it('force이면 다른 운영값도 로컬 정본으로 교체한다', () => {
    const result = planShopBusinessInfoSeed(
      { ...INITIAL_SHOP_BUSINESS_INFO, companyName: '운영에서 변경한 회사명' },
      true,
    );

    expect(result.updates).toEqual({ companyName: INITIAL_SHOP_BUSINESS_INFO.companyName });
    expect(result.preservedDifferent).toEqual([]);
  });

  it('앞뒤 공백만 다른 값은 이미 같은 설정으로 본다', () => {
    const result = planShopBusinessInfoSeed({
      ...INITIAL_SHOP_BUSINESS_INFO,
      addr: `${INITIAL_SHOP_BUSINESS_INFO.addr}  `,
    });

    expect(result.updates).toEqual({});
    expect(result.alreadySeeded).toHaveLength(11);
  });
});

describe('planShopBankSeed', () => {
  it('빈 계좌는 로컬 기준값으로 초기화한다', () => {
    expect(planShopBankSeed({ bankUse: 0, bankAccount: '' })).toEqual({
      action: 'update',
      reason: 'empty',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    });
  });

  it('영카트 설치 예시 계좌를 실제 초기값으로 교체한다', () => {
    expect(
      planShopBankSeed({
        bankUse: 1,
        bankAccount: 'OO은행 12345-67-89012 예금주명',
      }),
    ).toMatchObject({ action: 'update', reason: 'installer-placeholder' });
  });

  it('같은 계좌가 비활성화된 경우 사용만 다시 켠다', () => {
    expect(
      planShopBankSeed({ bankUse: 0, bankAccount: INITIAL_SHOP_BANK_ACCOUNT }),
    ).toMatchObject({ action: 'update', reason: 'disabled', bankUse: 1 });
  });

  it('CRLF 차이는 같은 설정으로 보고 재실행을 건너뛴다', () => {
    expect(
      planShopBankSeed({
        bankUse: 1,
        bankAccount: INITIAL_SHOP_BANK_ACCOUNT.replace(/\n/g, '\r\n'),
      }),
    ).toEqual({ action: 'skip', reason: 'already-seeded' });
  });

  it('이미 설정된 다른 실계좌는 기본 실행에서 보존한다', () => {
    expect(planShopBankSeed({ bankUse: 1, bankAccount: '다른은행 123 예금주' })).toEqual({
      action: 'skip',
      reason: 'configured-different',
    });
  });

  it('force이면 다른 실계좌도 기준값으로 교체한다', () => {
    expect(planShopBankSeed({ bankUse: 0, bankAccount: '다른은행 123 예금주' }, true)).toEqual({
      action: 'update',
      reason: 'forced',
      bankUse: 1,
      bankAccount: INITIAL_SHOP_BANK_ACCOUNT,
    });
  });

  it('force 재실행도 이미 같은 설정이면 건너뛴다', () => {
    expect(
      planShopBankSeed({ bankUse: 1, bankAccount: INITIAL_SHOP_BANK_ACCOUNT }, true),
    ).toEqual({ action: 'skip', reason: 'already-seeded' });
  });
});
