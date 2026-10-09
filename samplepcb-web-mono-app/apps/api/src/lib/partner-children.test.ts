import { describe, expect, it } from 'vitest';
import {
  ACT_AS_PARTNER_HEADER,
  AdminPartnerRelationAddBody,
  PartnerChildCreateBody,
} from '@sp/api-contract';
import { matchPartnerDuplicates } from './partner';
import { readActAsPartnerId } from './partner-act-as';
import { activeBomPairDocCount, activePairDocCount, partnerInviteStateOf } from './partner-children';

// 하위 협력사 직접 관리의 순수 판정 — DB 를 건드리는 흐름(등록·삭제·초대 수락)은 e2e 가 본다.

describe('activeBomPairDocCount', () => {
  it('회신 왕복 중인 견적요청과 수령 전 하위 발주를 센다', () => {
    expect(activeBomPairDocCount([{ status: 'requested' }, { status: 'quoted' }], [])).toBe(2);
    expect(activeBomPairDocCount([], [{ status: 'issued' }, { status: 'confirmed' }, { status: 'shipped' }])).toBe(3);
  });

  it('마감된 견적요청과 수령한 하위 발주는 세지 않는다 — 삭제·해제가 열린다', () => {
    expect(activeBomPairDocCount([{ status: 'closed' }], [{ status: 'received' }])).toBe(0);
    expect(activeBomPairDocCount([], [])).toBe(0);
  });
});

describe('activePairDocCount', () => {
  it('왕복 중인 견적과 미종결 발주를 센다', () => {
    expect(activePairDocCount([{ status: 'requested', reorderRound: 0 }], [])).toBe(1);
    expect(activePairDocCount([{ status: 'quoted', reorderRound: 0 }], [])).toBe(1);
    expect(activePairDocCount([], [{ status: 'issued', reorderRound: 0 }])).toBe(1);
    expect(activePairDocCount([], [{ status: 'produced', reorderRound: 0 }])).toBe(0);
  });

  it('선정된 견적은 같은 회차 발주가 아직 없을 때만 진행 중이다', () => {
    const selected = [{ status: 'selected', reorderRound: 0 }];
    expect(activePairDocCount(selected, [])).toBe(1);
    expect(activePairDocCount(selected, [{ status: 'produced', reorderRound: 0 }])).toBe(0);
    // 다른 회차의 발주는 이 견적을 닫지 못한다
    expect(activePairDocCount(selected, [{ status: 'produced', reorderRound: 1 }])).toBe(1);
  });

  it('종결된 문서만 있으면 0 이다 — 삭제·해제가 열린다', () => {
    expect(
      activePairDocCount(
        [{ status: 'unselected', reorderRound: 0 }, { status: 'closed', reorderRound: 0 }],
        [{ status: 'produced', reorderRound: 0 }],
      ),
    ).toBe(0);
  });
});

describe('partnerInviteStateOf', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  const later = new Date('2026-10-20T00:00:00Z');
  const earlier = new Date('2026-10-01T00:00:00Z');

  it('수락 전이고 기한이 남은 승인 조직의 초대만 유효하다', () => {
    expect(partnerInviteStateOf({ acceptedAt: null, expiresAt: later }, 'approved', now)).toBe('valid');
  });

  it('수락·만료·조직 정지를 구분한다(수락이 가장 먼저)', () => {
    expect(partnerInviteStateOf({ acceptedAt: earlier, expiresAt: earlier }, 'suspended', now)).toBe('accepted');
    expect(partnerInviteStateOf({ acceptedAt: null, expiresAt: earlier }, 'approved', now)).toBe('expired');
    expect(partnerInviteStateOf({ acceptedAt: null, expiresAt: later }, 'suspended', now)).toBe('unavailable');
    expect(partnerInviteStateOf({ acceptedAt: null, expiresAt: now }, 'approved', now)).toBe('expired');
  });
});

describe('readActAsPartnerId', () => {
  it('헤더가 없으면 null, 숫자면 조직 id, 그 밖은 invalid', () => {
    expect(readActAsPartnerId({})).toBeNull();
    expect(readActAsPartnerId({ [ACT_AS_PARTNER_HEADER]: '' })).toBeNull();
    expect(readActAsPartnerId({ [ACT_AS_PARTNER_HEADER]: '12' })).toBe(12n);
    expect(readActAsPartnerId({ [ACT_AS_PARTNER_HEADER]: ['7', '8'] })).toBe(7n);
    expect(readActAsPartnerId({ [ACT_AS_PARTNER_HEADER]: '12abc' })).toBe('invalid');
    expect(readActAsPartnerId({ [ACT_AS_PARTNER_HEADER]: '-1' })).toBe('invalid');
  });
});

describe('matchPartnerDuplicates', () => {
  const gap = { id: 1n, name: '갑', businessNo: '123-45-67890', contactEmail: 'a@x.com' };
  const blank = { id: 4n, name: '정', businessNo: '', contactEmail: null };
  const pool = [
    gap,
    { id: 2n, name: '을', businessNo: '123-45-67890', contactEmail: 'b@x.com' },
    { id: 3n, name: '병', businessNo: null, contactEmail: 'A@X.com ' },
    blank,
  ];

  it('사업자번호 또는 담당 이메일이 같으면 의심한다(대소문자·공백 무시, 자기 자신 제외)', () => {
    expect(matchPartnerDuplicates(gap, pool)).toEqual([
      { partnerId: 2, name: '을', matchedBy: 'businessNo' },
      { partnerId: 3, name: '병', matchedBy: 'contactEmail' },
    ]);
  });

  it('빈 값끼리는 같다고 보지 않는다', () => {
    expect(matchPartnerDuplicates(blank, pool)).toEqual([]);
  });
});

describe('계약 — 강제 전환·하위 등록', () => {
  it('강제 연결은 사유가 있어야 한다', () => {
    const base = { childPartnerId: 5, settlementCurrency: 'USD' as const };
    expect(AdminPartnerRelationAddBody.safeParse(base).success).toBe(true);
    expect(AdminPartnerRelationAddBody.safeParse({ ...base, force: true }).success).toBe(false);
    expect(AdminPartnerRelationAddBody.safeParse({ ...base, force: true, forceReason: '  ' }).success).toBe(false);
    expect(
      AdminPartnerRelationAddBody.safeParse({ ...base, force: true, forceReason: '발주가 끊이지 않음' }).success,
    ).toBe(true);
  });

  it('하위 등록은 국가·결제 통화가 필수이고 국가는 대문자로 정규화한다', () => {
    const parsed = PartnerChildCreateBody.safeParse({
      name: ' 하위상사 ',
      country: 'cn',
      settlementCurrency: 'CNY',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('하위상사');
      expect(parsed.data.country).toBe('CN');
    }
    expect(PartnerChildCreateBody.safeParse({ name: '하위', settlementCurrency: 'USD' }).success).toBe(false);
    expect(PartnerChildCreateBody.safeParse({ name: '하위', country: 'KOR', settlementCurrency: 'USD' }).success).toBe(false);
    expect(PartnerChildCreateBody.safeParse({ name: '하위', country: 'KR', settlementCurrency: 'EUR' }).success).toBe(false);
  });
});
