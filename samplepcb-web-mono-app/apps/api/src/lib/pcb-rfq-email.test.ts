import { describe, expect, it } from 'vitest';
import { buildPcbEqDecisionEmail } from './pcb-rfq-email';

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
