import type { FastifyBaseLogger } from 'fastify';
import { sendMail } from './mailer';

// ── PCB 파트너 트랙 알림 메일(P1) — docs/PCB_PARTNER_TRACK.md §5.4 ────────────
// 레거시 결함 교정(L6): 발송을 프론트가 아니라 서버가 소유한다(비차단·실패 로그).
// rfq-email.ts(BOM)와 같은 원칙 — table + inline style, 동적 값 전부 esc().

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** 매직링크 회신 페이지 URL — 발송·재발급·[링크 복사]가 같은 조립을 쓴다. */
export const magicPcbReplyUrl = (token: string): string =>
  `${WEB_BASE_URL}/app/pcb-rfq-reply/${token}`;

export const pcbAdminCaseUrl = (specId: string): string =>
  `${WEB_BASE_URL}/app/admin/pcb/cases/${specId}`;

export const pcbPartnerPortalUrl = (): string => `${WEB_BASE_URL}/app/partner`;

/** 회신가 표시 조립 — "US$1,080.86 (¥7,200)" (메일·로그 공용, 화면은 웹 유틸 사용). */
export const pcbPriceText = (
  currency: string,
  priceOriginal: number | null,
  subCurrency: string | null,
  subPriceOriginal: number | null,
): string => {
  if (priceOriginal === null) return '-';
  const sym: Record<string, string> = { KRW: '₩', USD: 'US$', CNY: '¥' };
  const fmt = (ccy: string, v: number): string =>
    `${sym[ccy] ?? `${ccy} `}${v.toLocaleString('en-US', {
      minimumFractionDigits: ccy === 'KRW' ? 0 : 2,
      maximumFractionDigits: ccy === 'KRW' ? 0 : 2,
    })}`;
  const main = fmt(currency, priceOriginal);
  return subCurrency !== null && subPriceOriginal !== null
    ? `${main} (${fmt(subCurrency, subPriceOriginal)})`
    : main;
};

const shell = (title: string, bodyHtml: string, footer: string): string => `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB · PCB 협력</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">${title}</div>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">${footer}</td></tr>
  </table>
</div>`;

const infoRow = (label: string, value: string): string => `
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">${esc(label)}</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${value}</td>
        </tr>`;

export interface PcbRfqRequestEmailParams {
  partnerName: string;
  /** 발주처 표시 — 관리자 트랙=자사명, MD 하위 트랙=MD 조직명. */
  requesterName: string;
  projectName: string;
  qty: number;
  suggestedDeliveryDate: string | null; // YYYY-MM-DD 표시용
  magicUrl: string | null;
}

export function buildPcbRfqRequestEmail(p: PcbRfqRequestEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  const cta =
    p.magicUrl === null
      ? `
      <div style="padding-top:20px;">
        <a href="${esc(portalUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 회신하기</a>
      </div>`
      : `
      <div style="padding-top:20px;">
        <a href="${esc(p.magicUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          가입 없이 바로 회신하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        위 버튼은 이 견적요청 전용 링크입니다(로그인 불필요, 30일 유효 — 외부 공유는 삼가 주세요).
        파트너 계정이 있다면 <a href="${esc(portalUrl)}" style="color:#2563eb;">포털 로그인으로 회신</a>할 수도 있습니다.
      </p>`;
  const rows = [
    infoRow('견적 건', esc(p.projectName)),
    infoRow('수량', `${String(p.qty)} 매`),
    ...(p.suggestedDeliveryDate === null
      ? []
      : [infoRow('희망 납기', esc(p.suggestedDeliveryDate))]),
  ].join('');
  return {
    subject: `[샘플피씨비] PCB 견적요청 — ${p.projectName}`,
    html: shell(
      'PCB 견적요청이 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, ${esc(p.requesterName)}에서 아래 건의 제작 견적을 요청드립니다.
        <b>견적가와 예상 배송일</b>을 회신해 주세요.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>${cta}`,
      '본 메일은 샘플피씨비 PCB 견적요청 알림입니다.',
    ),
  };
}

export interface PcbRfqRepliedEmailParams {
  partnerName: string; // 회신한 협력사
  projectName: string;
  specId: string;
  priceText: string; // "US$1,080.86 (¥7,200)" — 조립은 호출측
  deliveryText: string | null; // YYYY-MM-DD
  /** 수신자가 관리자면 Case 상세, MD 면 포털 상세로 안내. */
  targetUrl: string;
  targetLabel: string;
}

/** 협력사 회신 도착 → 요청 주체(관리자/MD) 통지. */
export function buildPcbRfqRepliedEmail(p: PcbRfqRepliedEmailParams): {
  subject: string;
  html: string;
} {
  const rows = [
    infoRow('견적 건', esc(p.projectName)),
    infoRow('회신 견적가', `<b>${esc(p.priceText)}</b>`),
    ...(p.deliveryText === null ? [] : [infoRow('예상 배송일', esc(p.deliveryText))]),
  ].join('');
  return {
    subject: `[샘플피씨비] PCB 견적 회신 — ${p.projectName} · ${p.partnerName}`,
    html: shell(
      'PCB 견적 회신이 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 협력사가 견적을 회신했습니다. 비교 후 선정을 진행해 주세요.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(p.targetUrl)}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(p.targetLabel)}</a>
      </div>`,
      '본 메일은 샘플피씨비 PCB 견적 회신 알림입니다.',
    ),
  };
}

export async function sendPcbMail(
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
      fromName: '샘플피씨비',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
  } catch (err) {
    log.error({ err, to, subject: mail.subject }, 'pcb rfq mail send failed');
  }
}
