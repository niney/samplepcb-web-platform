import type { FastifyBaseLogger } from 'fastify';
import { sendMail } from './mailer';

// ── 협력사 RFQ·발주 알림 메일 — 설계 docs/SMARTBOM_PARTNER_RFQ.md D11·D18 ───
// 알림만 보낸다(회신·확인 링크 = 로그인 포털). 매직링크 무로그인 처리는 후속.
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
  /** 매직링크 URL(§6.9) — 있으면 주 버튼(가입 없이 회신), 포털은 보조 링크로. */
  magicUrl?: string | null;
}

export function buildBomRfqRequestEmail(p: BomRfqRequestEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  const magicUrl = p.magicUrl ?? null;
  const cta =
    magicUrl === null
      ? `
      <div style="padding-top:20px;">
        <a href="${esc(portalUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 회신하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        회신은 파트너 계정으로 로그인한 뒤 진행됩니다. 계정 문의는 샘플피씨비 담당자에게 연락해 주세요.
      </p>`
      : `
      <div style="padding-top:20px;">
        <a href="${esc(magicUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          가입 없이 바로 회신하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        위 버튼은 이 견적요청 전용 링크입니다(로그인 불필요, 30일 유효 — 외부 공유는 삼가 주세요).
        파트너 계정이 있다면 <a href="${esc(portalUrl)}" style="color:#2563eb;">포털 로그인으로 회신</a>할 수도 있습니다.
      </p>`;
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
      </table>${cta}
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 스마트 BOM 견적요청 알림입니다.</td></tr>
  </table>
</div>`,
  };
}

/** 매직링크 회신 페이지 URL(§6.9) — 발송·재발급·[링크 복사]가 같은 조립을 쓴다. */
export const magicReplyUrl = (token: string): string => `${WEB_BASE_URL}/app/rfq-reply/${token}`;

export interface BomPoIssuedEmailParams {
  partnerName: string;
  quoteTitle: string;
  itemCount: number;
  totalAmount: number; // KRW, VAT 별도
}

// 발주서 발행 알림(D18-8) — 확인은 포털에서.
export function buildBomPoIssuedEmail(p: BomPoIssuedEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  const won = p.totalAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return {
    subject: `[샘플피씨비] 발주서 도착 — ${p.quoteTitle} (${String(p.itemCount)}개 품목)`,
    html: `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">발주서가 도착했습니다</div>
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, 아래 건의 발주를 요청드립니다. 포털에서 내용을 확인해 주세요.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">발주 건</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${esc(p.quoteTitle)}</td>
        </tr>
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">품목 / 합계</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${String(p.itemCount)}개 / ${esc(won)}원 (VAT 별도)</td>
        </tr>
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(portalUrl)}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 확인하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        발주 확인 후 포털의 선적 진행에서 발송 처리(해외 발송은 Invoice 첨부 + 선적 요청)까지 부탁드립니다.
      </p>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 스마트 BOM 발주 알림입니다.</td></tr>
  </table>
</div>`,
  };
}

// ── 선적 핑퐁 알림(D22) — 단계가 상대 차례로 넘어갈 때 발송(레거시엔 없던 개선) ──
// 협력사 수신처 = sp_partner.contactEmail, 관리자 수신처 = 영카트 운영자 메일
// (g5_shop_default.de_admin_info_email — getShopEstimateProfile().managerEmail 승격).

const shipmentShell = (title: string, bodyLines: string[], ctaLabel: string, ctaUrl: string) => `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">${title}</div>
      ${bodyLines.map((line) => `<p style="margin:0 0 10px;font-size:13px;color:#333;line-height:1.6;">${line}</p>`).join('')}
      <div style="padding-top:16px;">
        <a href="${esc(ctaUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${ctaLabel}</a>
      </div>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 스마트 BOM 물류 알림입니다.</td></tr>
  </table>
</div>`;

export interface ShipmentTurnAdminEmailParams {
  quoteId: string;
  quoteTitle: string;
  partnerName: string;
  statusLabel: string; // 협력사가 진입시킨 단계 라벨
}

/** 협력사 전이 → 관리자 알림(다음 차례가 관리자). */
export function buildShipmentTurnAdminEmail(p: ShipmentTurnAdminEmailParams): {
  subject: string;
  html: string;
} {
  const caseUrl = `${WEB_BASE_URL}/app/admin/smartbom/cases/${p.quoteId}`;
  return {
    subject: `[샘플피씨비] 선적 진행 — ${p.quoteTitle} · ${p.partnerName} → ${p.statusLabel}`,
    html: shipmentShell(
      `선적이 '${esc(p.statusLabel)}' 단계로 진행되었습니다`,
      [
        `${esc(p.partnerName)} 협력사가 <b>${esc(p.quoteTitle)}</b> 발주 건의 선적을 '${esc(p.statusLabel)}' 단계로 진행했습니다.`,
        `다음 단계 처리는 샘플피씨비 차례입니다 — Case 상세의 [선적 관리]에서 진행해 주세요.`,
      ],
      'Case 상세 열기',
      caseUrl,
    ),
  };
}

export interface ShipmentTurnPartnerEmailParams {
  partnerName: string;
  quoteTitle: string;
  statusLabel: string; // 현재(관리자가 진입시킨) 단계 라벨
  nextLabel: string; // 협력사에게 요청하는 다음 단계 라벨
}

/** 관리자 전이 → 협력사 알림(다음 차례가 협력사). */
export function buildShipmentTurnPartnerEmail(p: ShipmentTurnPartnerEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  return {
    subject: `[샘플피씨비] 선적 진행 요청 — ${p.quoteTitle} · ${p.nextLabel}`,
    html: shipmentShell(
      `'${esc(p.nextLabel)}' 처리를 부탁드립니다`,
      [
        `${esc(p.partnerName)} 담당자님, <b>${esc(p.quoteTitle)}</b> 발주 건의 선적이 '${esc(p.statusLabel)}' 단계가 되었습니다.`,
        `다음 단계인 '${esc(p.nextLabel)}' 처리를 파트너 포털에서 진행해 주세요.`,
      ],
      '파트너 포털 열기',
      portalUrl,
    ),
  };
}

export interface ShipmentReceivedEmailParams {
  partnerName: string;
  quoteTitle: string;
  note: string | null; // 편차 메모 — 있으면 재발송 협의 근거로 전달
}

/** 입고 확인(검수) → 협력사 통지. */
export function buildShipmentReceivedEmail(p: ShipmentReceivedEmailParams): {
  subject: string;
  html: string;
} {
  const portalUrl = `${WEB_BASE_URL}/app/partner`;
  const lines = [
    `${esc(p.partnerName)} 담당자님, <b>${esc(p.quoteTitle)}</b> 발주 건의 물품 입고 확인(검수)이 완료되었습니다.`,
  ];
  if (p.note !== null && p.note.trim() !== '') {
    lines.push(`검수 메모: <b>${esc(p.note)}</b> — 확인 후 회신 부탁드립니다.`);
  }
  return {
    subject: `[샘플피씨비] 입고 확인 — ${p.quoteTitle}`,
    html: shipmentShell('입고 확인이 완료되었습니다', lines, '파트너 포털 열기', portalUrl),
  };
}

// ── 고객 회신 알림(백로그 회수) — 견적이 answered 로 전이되는 순간 1회 발송 ────
// 인지 장치 시리즈의 마지막 조각: 관리자(배지)·협력사(칩)는 있는데 고객만 접속해야
// 회신 여부를 알 수 있었다. 확정가 유무로 내용 분기(확정가 = 고객 [주문하기] 게이트).

export interface BomQuoteAnsweredEmailParams {
  customerName: string; // 비면 '고객'
  quoteTitle: string;
  quoteId: string;
  confirmedTotal: number | null; // 확정가(VAT 별도) — null 이면 회신만 안내
}

export function buildBomQuoteAnsweredEmail(p: BomQuoteAnsweredEmailParams): {
  subject: string;
  html: string;
} {
  const detailUrl = `${WEB_BASE_URL}/app/bom/${p.quoteId}`;
  const name = p.customerName.trim() === '' ? '고객' : p.customerName;
  const won =
    p.confirmedTotal === null
      ? null
      : p.confirmedTotal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return {
    subject: `[샘플피씨비] 부품 견적 회신 — ${p.quoteTitle}`,
    html: `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 스마트 BOM</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">견적 회신이 도착했습니다</div>
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(name)}님, 요청하신 부품 견적의 검토가 완료되었습니다.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">견적 건</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${esc(p.quoteTitle)}</td>
        </tr>
        ${
          won === null
            ? ''
            : `<tr>
          <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">확정 견적가</td>
          <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;"><b>${esc(won)}원</b> (VAT 별도)</td>
        </tr>`
        }
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(detailUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${won === null ? '회신 내용 확인하기' : '견적 확인하고 주문하기'}</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        ${
          won === null
            ? '상세 회신 내용은 로그인 후 견적 상세에서 확인하실 수 있습니다.'
            : '확정가로 바로 주문하실 수 있습니다. 문의는 회신 메모를 참고해 주세요.'
        }
      </p>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 스마트 BOM 견적 회신 알림입니다.</td></tr>
  </table>
</div>`,
  };
}

/** 회원 기본 주소보다 관리자가 이번 발송에 입력한 주소를 우선한다. */
export function resolveBomAnswerRecipient(
  memberEmail: string | null | undefined,
  recipientOverride?: string,
): string | null {
  return (recipientOverride ?? memberEmail ?? '').trim() || null;
}

export async function sendBomRfqMail(
  log: FastifyBaseLogger,
  to: string | null | undefined,
  mail: { subject: string; html: string },
): Promise<boolean> {
  if (to === null || to === undefined || to.trim() === '') return false;
  try {
    await sendMail({
      to,
      subject: mail.subject,
      html: mail.html,
      fromName: '샘플피씨비 스마트 BOM',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
    return true;
  } catch (err) {
    log.error({ err, to, subject: mail.subject }, 'bom rfq mail send failed');
    return false;
  }
}
