import type { FastifyBaseLogger } from 'fastify';
import { sendMail } from './mailer';

// ── 협력사 RFQ 알림 메일 — 설계 docs/SMARTBOM_PARTNER_RFQ.md D11 ────────────
// 알림만 보낸다(회신 링크 = 로그인 포털). 매직링크 무로그인 회신은 후속.
// market-email 과 같은 원칙: table + inline style, 동적 값 전부 esc().

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export interface BomRfqRequestEmailParams {
  partnerName: string;
  quoteTitle: string;
  itemCount: number;
}

export function buildBomRfqRequestEmail(p: BomRfqRequestEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  return {
    subject: `[샘플피씨비] 부품 견적요청 — ${p.quoteTitle} (${String(p.itemCount)}개 품목)`,
    html: `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">부품 견적요청이 도착했습니다</div>
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, 아래 건의 부품 견적을 요청드립니다.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">견적 건</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${esc(p.quoteTitle)}</td>
        </tr>
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">요청 품목</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${String(p.itemCount)}개</td>
        </tr>
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(portalUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 회신하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        회신은 파트너 계정으로 로그인한 뒤 진행됩니다. 계정 문의는 샘플피씨비 담당자에게 연락해 주세요.
      </p>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 스마트 BOM 견적요청 알림입니다.</td></tr>
  </table>
</div>`,
  };
}

export async function sendBomRfqMail(
  log: FastifyBaseLogger,
  to: string | null | undefined,
  mail: { subject: string; html: string },
): Promise<void> {
  if (to === null || to === undefined || to.trim() === '') return;
  try {
    await sendMail({
      to,
      subject: mail.subject,
      html: mail.html,
      fromName: '샘플피씨비 스마트 BOM',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
  } catch (err) {
    log.error({ err, to, subject: mail.subject }, 'bom rfq mail send failed');
  }
}
