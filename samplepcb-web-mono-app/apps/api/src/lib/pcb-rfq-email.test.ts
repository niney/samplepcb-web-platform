import { describe, expect, it } from 'vitest';
import {
  buildPcbAsCaseSubmittedEmail,
  buildPcbEqDecisionEmail,
  buildPcbPoIssuedEmail,
  buildPcbRfqRequestEmail,
  buildPcbShipmentReceivedEmail,
  buildPcbShipmentTurnEmail,
} from './pcb-rfq-email';

// EQ 결정 메일의 포털 CTA 분기(재점검 #15) — 연결 계정 없는 조직에는 "포털에서
// [생산 시작]" 버튼이 실행 불가 CTA 라, 대행 안내로 치환된다.
describe('buildPcbEqDecisionEmail — 포털 CTA vs 무계정 대행 안내', () => {
  it('기본(계정 있음)은 발주서 딥링크 버튼 + 포털 진행 문구', () => {
    const mail = buildPcbEqDecisionEmail({
      partnerName: '협력2',
      projectName: 'arduino-uno.zip',
      approved: true,
      reason: null,
      poId: '356',
    });
    expect(mail.html).toContain('/app/partner/pcb/pos/356');
    expect(mail.html).toContain('발주서 바로 열기');
    expect(mail.html).toContain('포털에서 [생산 시작]');
    expect(mail.html).not.toContain('대행');
  });

  it('hasPortalAccount=false 승인 — 버튼 제거·대행 안내·문의처 메일 링크', () => {
    const mail = buildPcbEqDecisionEmail({
      partnerName: 'e2e한국협력',
      projectName: 'arduino-uno.zip',
      approved: true,
      reason: null,
      poId: '400',
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).not.toContain('발주서 바로 열기');
    expect(mail.html).not.toContain('[생산 시작]');
    expect(mail.html).toContain('담당자가 대행');
    expect(mail.html).toContain('mailto:info@samplepcb.co.kr');
  });

  it('hasPortalAccount=false 반려 — 재승인요청 대행 문구·사유 유지, 문의처 없으면 회신 안내', () => {
    const mail = buildPcbEqDecisionEmail({
      partnerName: 'e2e한국협력',
      projectName: 'arduino-uno.zip',
      approved: false,
      reason: '드릴 도면 누락',
      poId: '400',
      hasPortalAccount: false,
      inquiryEmail: null,
    });
    expect(mail.html).toContain('재승인요청은 담당자가 대행');
    expect(mail.html).toContain('드릴 도면 누락');
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).toContain('이 메일에 회신해 주세요');
  });
});

// #15 확대 — 협력사향 포털 CTA 메일 전수의 무계정 분기(버튼 부재·대행 문구·문의처).
describe('buildPcbPoIssuedEmail — 발주서 도착', () => {
  const base = {
    partnerName: 'e2e한국협력',
    requesterName: '샘플피씨비',
    projectName: 'arduino-uno.zip',
    qty: 30,
    priceText: '₩100,000',
    deliveryText: '2026-08-20',
  };

  it('기본(계정 있음)은 포털 확인 버튼 + EQ 진행 안내', () => {
    const mail = buildPcbPoIssuedEmail(base);
    expect(mail.html).toContain('/app/partner');
    expect(mail.html).toContain('파트너 포털에서 확인하기');
    expect(mail.html).toContain('EQ 승인요청(EQ·Working 파일 첨부)');
    expect(mail.html).not.toContain('대행');
  });

  it('무계정 — 버튼 제거·파일 전달 대행 안내·문의처 메일 링크', () => {
    const mail = buildPcbPoIssuedEmail({
      ...base,
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).not.toContain('파트너 포털에서 확인하기');
    expect(mail.html).toContain('담당자가 대행');
    expect(mail.html).toContain('샘플피씨비 담당자에게 전달');
    expect(mail.html).toContain('mailto:info@samplepcb.co.kr');
  });
});

describe('buildPcbShipmentTurnEmail — 선적 차례', () => {
  const base = {
    recipientName: 'e2e한국협력',
    projectName: 'arduino-uno.zip',
    statusLabel: '배송 중',
    nextLabel: '입고 확인',
    targetUrl: 'https://local-web.samplepcb.co.kr/app/partner',
    targetLabel: '파트너 포털 열기',
  };

  it('기본(계정 있음)은 포털 버튼 + 다음 단계 처리 요청', () => {
    const mail = buildPcbShipmentTurnEmail(base);
    expect(mail.html).toContain('/app/partner');
    expect(mail.html).toContain('파트너 포털 열기');
    expect(mail.html).toContain('처리를 부탁드립니다');
    expect(mail.html).not.toContain('대행');
  });

  it('무계정 — 버튼 제거·다음 단계도 대행 문구·문의처', () => {
    const mail = buildPcbShipmentTurnEmail({
      ...base,
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).not.toContain('파트너 포털 열기');
    expect(mail.html).toContain("'<b>입고 확인</b>' 진행은 샘플피씨비 담당자가 대행");
    expect(mail.html).toContain('mailto:info@samplepcb.co.kr');
  });
});

describe('buildPcbShipmentReceivedEmail — 입고 확인(보내는측)', () => {
  const base = { partnerName: 'e2e한국협력', projectName: 'arduino-uno.zip', note: '외관 양호' };

  it('기본(계정 있음)은 포털 열기 버튼', () => {
    const mail = buildPcbShipmentReceivedEmail(base);
    expect(mail.html).toContain('/app/partner');
    expect(mail.html).toContain('파트너 포털 열기');
    expect(mail.html).not.toContain('대행');
  });

  it('무계정 — 버튼 제거·대행 안내·검수 메모 유지', () => {
    const mail = buildPcbShipmentReceivedEmail({
      ...base,
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).toContain('담당자가 대행');
    expect(mail.html).toContain('외관 양호');
    expect(mail.html).toContain('mailto:info@samplepcb.co.kr');
  });
});

describe('buildPcbAsCaseSubmittedEmail — A/S 검토 요청', () => {
  const base = {
    partnerName: 'e2e한국협력',
    projectName: 'arduino-uno.zip',
    caseTypeLabel: '제품 불량',
    chargeLabel: '무상',
    description: '쇼트 2건 재현',
  };

  it('기본(계정 있음)은 포털 회신 버튼', () => {
    const mail = buildPcbAsCaseSubmittedEmail(base);
    expect(mail.html).toContain('/app/partner');
    expect(mail.html).toContain('파트너 포털에서 회신하기');
    expect(mail.html).not.toContain('대행');
  });

  it('무계정 — 버튼 제거·관리자 대행 회신 안내·문의처', () => {
    const mail = buildPcbAsCaseSubmittedEmail({
      ...base,
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).not.toContain('파트너 포털에서 회신하기');
    expect(mail.html).toContain('관리자 대행 회신으로 처리됩니다');
    expect(mail.html).toContain('쇼트 2건 재현');
    expect(mail.html).toContain('mailto:info@samplepcb.co.kr');
  });
});

describe('buildPcbRfqRequestEmail — 견적요청(매직링크 유무 분기)', () => {
  const base = {
    partnerName: 'e2e한국협력',
    requesterName: '샘플피씨비',
    projectName: 'arduino-uno.zip',
    qty: 30,
    suggestedDeliveryDate: null,
  };

  it('매직링크가 있으면 무계정이어도 링크 CTA 유지(로그인 불필요 — 분기 미적용)', () => {
    const mail = buildPcbRfqRequestEmail({
      ...base,
      magicUrl: 'https://local-web.samplepcb.co.kr/app/pcb-rfq-reply/tok123',
      hasPortalAccount: false,
      inquiryEmail: 'info@samplepcb.co.kr',
    });
    expect(mail.html).toContain('/app/pcb-rfq-reply/tok123');
    expect(mail.html).toContain('가입 없이 바로 회신하기');
    expect(mail.html).not.toContain('대행 접수');
  });

  it('매직링크 null 폴백 — 계정 있으면 포털 버튼', () => {
    const mail = buildPcbRfqRequestEmail({ ...base, magicUrl: null });
    expect(mail.html).toContain('/app/partner');
    expect(mail.html).toContain('파트너 포털에서 회신하기');
    expect(mail.html).not.toContain('대행');
  });

  it('매직링크 null 폴백 + 무계정 — 버튼 제거·대행 접수 안내·문의처 없으면 회신 안내', () => {
    const mail = buildPcbRfqRequestEmail({
      ...base,
      magicUrl: null,
      hasPortalAccount: false,
      inquiryEmail: null,
    });
    expect(mail.html).not.toContain('/app/partner');
    expect(mail.html).not.toContain('파트너 포털에서 회신하기');
    expect(mail.html).toContain('담당자가 대행 접수');
    expect(mail.html).toContain('이 메일에 회신해 주세요');
  });
});
