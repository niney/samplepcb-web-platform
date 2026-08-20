import { describe, expect, test } from 'vitest';
import { buildShipmentTurnAdminEmail, buildShipmentTurnPartnerEmail } from './rfq-email';

describe('BOM Case ID 선적 메일', () => {
  test('관리자 요청 메일에 Case ID 갈래와 이스케이프된 메모를 싣는다', () => {
    const mail = buildShipmentTurnAdminEmail({
      quoteId: '1074',
      quoteTitle: '국제 BOM',
      partnerName: '해외 협력사',
      statusLabel: '선적 요청',
      caseRefRequested: true,
      caseRefNote: '<해상 부킹 & 확인>',
    });

    expect(mail.subject).toContain('선적 요청');
    expect(mail.html).toContain('샘플피씨비 운송(Case ID)이 요청되었습니다.');
    expect(mail.html).toContain('&lt;해상 부킹 &amp; 확인&gt;');
    expect(mail.html).not.toContain('<해상 부킹 & 확인>');
  });

  test('협력사 안내 메일은 null 단계명 대신 Case ID와 라벨링 안내를 표시한다', () => {
    const mail = buildShipmentTurnPartnerEmail({
      partnerName: '해외 협력사',
      quoteTitle: '국제 BOM',
      statusLabel: '선적',
      nextLabel: null,
      caseRef: 'CASE-B-260819-1074',
    });

    expect(mail.subject).toContain('선적 진행 안내');
    expect(mail.html).toContain('샘플피씨비 운송 서류가 준비되었습니다');
    expect(mail.html).toContain('CASE-B-260819-1074');
    expect(mail.html).toContain('라벨링·인계');
    expect(mail.html).not.toContain("'null'");
  });
});
