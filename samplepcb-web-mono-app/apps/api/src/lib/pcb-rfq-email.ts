import type { FastifyBaseLogger } from 'fastify';
import { sendMail } from './mailer';
import { errorReason, recordMailLog } from './mail-log';
import type { MailLogMeta } from './mail-log';

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

// ── 무계정 조직 대행 안내(재점검 #15) — 협력사향 포털 CTA 메일 공통 ───────────
// 연결 계정 0인 조직에 포털 버튼은 열어도 로그인에서 막히는 실행 불가 CTA 다.
// hasPortalAccount=false 면 각 빌더가 버튼을 이 대행 안내 박스로 치환한다(메일
// 자체는 정보 가치가 있어 유지). 판정·문의처 조회는 lib/pcb-portal-cta.ts.

/** 협력사향 포털 CTA 메일 공통 파라미터 — 기본 true(기존 호출부 무파손). */
export interface PcbPortalCtaParams {
  /** false=조직에 연결 계정이 없다 — 포털 CTA 를 대행 안내로 치환한다. */
  hasPortalAccount?: boolean;
  /** 대행 안내의 문의처(운영자 메일) — hasPortalAccount=false 일 때만 사용. */
  inquiryEmail?: string | null;
}

/** 포털 버튼 자리에 넣는 대행 안내 박스 — lead 는 하드코딩 안내문(비 esc). */
const proxyNoticeBox = (lead: string, inquiryEmail: string | null | undefined): string => `
      <div style="margin-top:16px;padding:12px 14px;background:#f8fafc;border-left:3px solid #64748b;font-size:13px;color:#334155;line-height:1.7;">
        ${lead}
        ${
          inquiryEmail === null || inquiryEmail === undefined || inquiryEmail === ''
            ? '이 메일에 회신해 주세요.'
            : `<a href="mailto:${esc(inquiryEmail)}" style="color:#2563eb;">${esc(inquiryEmail)}</a>`
        }
      </div>`;

export interface PcbRfqRequestEmailParams extends PcbPortalCtaParams {
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
  // 매직링크는 무계정도 실행 가능한 CTA 다(로그인 불필요) — 무계정 대행 분기는
  // 링크 없이 포털 폴백 버튼을 쓰던 경우에만 적용한다(재점검 #15).
  const cta =
    p.magicUrl === null
      ? p.hasPortalAccount === false
        ? proxyNoticeBox(
            '견적 회신은 샘플피씨비 담당자가 대행 접수합니다 — 견적가·예상 배송일 회신·문의:',
            p.inquiryEmail,
          )
        : `
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

// 발송 시도는 성패·스킵 불문 sp_mail_log 에 남긴다(이력관리 — 기록 실패는 발송에 무영향).
export async function sendPcbMail(
  log: FastifyBaseLogger,
  to: string | null | undefined,
  mail: { subject: string; html: string },
  meta: MailLogMeta,
): Promise<void> {
  const recipient = (to ?? '').trim();
  if (recipient === '') {
    await recordMailLog(log, meta, {
      channel: 'email',
      status: 'skipped',
      reason: 'missing_recipient',
      recipient: '',
      subject: mail.subject,
    });
    return;
  }
  try {
    await sendMail({
      to: recipient,
      subject: mail.subject,
      html: mail.html,
      fromName: '샘플피씨비',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
    await recordMailLog(log, meta, {
      channel: 'email',
      status: 'sent',
      recipient,
      subject: mail.subject,
    });
  } catch (err) {
    log.error({ err, to: recipient, subject: mail.subject }, 'pcb rfq mail send failed');
    await recordMailLog(log, meta, {
      channel: 'email',
      status: 'failed',
      reason: errorReason(err),
      recipient,
      subject: mail.subject,
    });
  }
}

// ── P2 발주·EQ 알림 — docs/PCB_PARTNER_TRACK.md §5.4 ─────────────────────────

export interface PcbPoIssuedEmailParams extends PcbPortalCtaParams {
  partnerName: string;
  requesterName: string;
  projectName: string;
  qty: number;
  priceText: string;
  deliveryText: string | null;
}

/** 발주서 발행 → 수주 협력사 통지(확인·EQ 진행은 포털 — 무계정이면 대행 안내). */
export function buildPcbPoIssuedEmail(p: PcbPoIssuedEmailParams): {
  subject: string;
  html: string;
} {
  const noAccount = p.hasPortalAccount === false;
  const rows = [
    infoRow('발주 건', esc(p.projectName)),
    infoRow('수량', `${String(p.qty)} 매`),
    infoRow('발주가', `<b>${esc(p.priceText)}</b>`),
    ...(p.deliveryText === null ? [] : [infoRow('납기', esc(p.deliveryText))]),
  ].join('');
  const guide = noAccount
    ? '내용 확인 후 생산용 <b>Working 파일이 있으면</b> 샘플피씨비 담당자에게 전달해 주세요. EQ 자료는 필요한 경우 함께 전달하면 됩니다 — EQ 승인요청 등 포털 진행은 담당자가 대행합니다.'
    : '포털에서 내용을 확인하고 생산용 <b>Working 파일이 있으면 업로드를 권장</b>합니다. EQ 파일은 선택이며, 파일 없이도 EQ 승인요청을 진행할 수 있습니다.';
  const cta = noAccount
    ? proxyNoticeBox(
        '포털 진행(EQ·생산 상태 처리)은 샘플피씨비 담당자가 대행합니다 — 파일 전달·문의:',
        p.inquiryEmail,
      )
    : `
      <div style="padding-top:20px;">
        <a href="${esc(pcbPartnerPortalUrl())}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 확인하기</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB 발주서 도착 — ${p.projectName}`,
    html: shell(
      'PCB 발주서가 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, ${esc(p.requesterName)}에서 아래 건을 발주드립니다.
        ${guide}
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>${cta}`,
      '본 메일은 샘플피씨비 PCB 발주 알림입니다.',
    ),
  };
}

// ── 송금 완납 통지(P3.11 · 여정 8호 결정) ────────────────────────────────────
// ⚠ **회차마다 보내지 않는다.** 송금 원장은 정정·삭제되는 기록이라(여정 30호 실측:
//   100→50 정정, 행 삭제까지) 부분 송금마다 알리면 알림이 사실보다 앞서 나간다.
//   잔액 0 은 큐를 가르는 명확한 경계이고, 협력사가 실제로 알고 싶은 것도 그 지점이다.

export interface PcbRemittanceSettledEmailParams extends PcbPortalCtaParams {
  partnerName: string;
  projectName: string;
  amountText: string; // 총 지급액 — pcbPriceText 조립
  lastRemittedText: string | null; // 마지막 송금일 YYYY-MM-DD
  count: number; // 송금 회차 수(1=한 번에)
}

/** 발주 대금 완납 → 수주 협력사 통지(무계정이면 포털 버튼 대신 대행 안내). */
export function buildPcbRemittanceSettledEmail(p: PcbRemittanceSettledEmailParams): {
  subject: string;
  html: string;
} {
  const rows = [
    infoRow('발주 건', esc(p.projectName)),
    infoRow('지급 총액', `<b>${esc(p.amountText)}</b>`),
    ...(p.count > 1 ? [infoRow('송금 횟수', `${String(p.count)}회 분할`)] : []),
    ...(p.lastRemittedText === null ? [] : [infoRow('마지막 송금일', esc(p.lastRemittedText))]),
  ].join('');
  const cta =
    p.hasPortalAccount === false
      ? proxyNoticeBox('입금 확인·정산 문의는 샘플피씨비 담당자에게 주세요:', p.inquiryEmail)
      : `
      <div style="padding-top:16px;">
        <a href="${esc(pcbPartnerPortalUrl())}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 확인하기</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB 대금 지급 완료 — ${p.projectName}`,
    html: shell(
      '발주 대금 지급이 완료되었습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, <b>${esc(p.projectName)}</b> 발주 건의 대금을 전액 송금했습니다.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>
      <p style="margin:12px 0 0;font-size:12px;color:#8593ab;line-height:1.6;">
        은행 처리 사정에 따라 실제 입금까지 시차가 있을 수 있습니다.
        입금 내역이 다르면 회신해 주세요.
      </p>${cta}`,
      '본 메일은 샘플피씨비 PCB 대금 지급 알림입니다.',
    ),
  };
}

export interface PcbEqTurnEmailParams {
  partnerName: string; // 전이한 협력사(또는 수신 협력사)
  projectName: string;
  statusLabel: string;
  targetUrl: string;
  targetLabel: string;
}

/** EQ 승인요청 도착 → 관리자(또는 MD) 통지 — 다음 차례 안내. */
export function buildPcbEqRequestedEmail(p: PcbEqTurnEmailParams): {
  subject: string;
  html: string;
} {
  return {
    subject: `[샘플피씨비] PCB EQ 승인요청 — ${p.projectName} · ${p.partnerName}`,
    html: shell(
      'EQ 승인요청이 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 협력사가 <b>${esc(p.projectName)}</b> 발주 건의 EQ 승인을 요청했습니다.
        첨부된 EQ·Working 파일이 있으면 함께 확인한 뒤 승인 또는 반려해 주세요.
      </p>
      <div style="padding-top:16px;">
        <a href="${esc(p.targetUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(p.targetLabel)}</a>
      </div>`,
      '본 메일은 샘플피씨비 PCB EQ 알림입니다.',
    ),
  };
}

/** 포털 발주 상세 딥링크 — 반려 메일에서 홈이 아니라 그 발주로 바로(사용성 잔여 해소). */
export const pcbPartnerPoUrl = (poId: string): string =>
  `${WEB_BASE_URL}/app/partner/pcb/pos/${poId}`;

export interface PcbEqDecisionEmailParams extends PcbPortalCtaParams {
  partnerName: string; // 수주 협력사
  projectName: string;
  approved: boolean;
  reason: string | null; // 반려 사유
  /** 대상 발주 — 있으면 버튼이 발주 상세로 간다(없으면 포털 홈 폴백). */
  poId?: string;
}

/** EQ 승인/반려 → 수주 협력사 통지. */
export function buildPcbEqDecisionEmail(p: PcbEqDecisionEmailParams): {
  subject: string;
  html: string;
} {
  const noAccount = p.hasPortalAccount === false;
  const title = p.approved
    ? noAccount
      ? 'EQ가 승인되었습니다 — 생산을 진행해 주세요'
      : 'EQ가 승인되었습니다 — 생산을 시작해 주세요'
    : 'EQ가 반려되었습니다';
  const lines = p.approved
    ? `<p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, <b>${esc(p.projectName)}</b> 건의 EQ가 승인되었습니다.
        ${noAccount ? '생산을 진행해 주세요.' : '포털에서 [생산 시작]을 진행해 주세요.'}</p>`
    : `<p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, <b>${esc(p.projectName)}</b> 건의 EQ가 반려되었습니다.
        ${
          noAccount
            ? '사유 확인 후 보완 파일을 샘플피씨비 담당자에게 전달해 주세요 — 재승인요청은 담당자가 대행합니다.'
            : '사유 확인 후 파일 보완 → 다시 승인요청해 주세요.'
        }</p>
      ${p.reason === null ? '' : `<p style="margin:0 0 12px;font-size:13px;color:#b91c1c;line-height:1.6;">반려 사유: <b>${esc(p.reason)}</b></p>`}`;
  const target = p.poId === undefined ? pcbPartnerPortalUrl() : pcbPartnerPoUrl(p.poId);
  // 계정 없는 조직 — 포털 버튼 대신 대행 안내(열어도 로그인 화면에서 막히는 CTA 를 없앤다).
  const cta = noAccount
    ? proxyNoticeBox(
        '포털 진행(상태 처리)은 샘플피씨비 담당자가 대행합니다 — 진행 상황 회신·문의:',
        p.inquiryEmail,
      )
    : `
      <div style="padding-top:16px;">
        <a href="${esc(target)}"
           style="display:inline-block;background:${p.approved ? '#059669' : '#b91c1c'};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${p.poId === undefined ? '파트너 포털 열기' : '발주서 바로 열기'}</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB EQ ${p.approved ? '승인' : '반려'} — ${p.projectName}`,
    html: shell(
      title,
      `${lines}${cta}`,
      '본 메일은 샘플피씨비 PCB EQ 알림입니다.',
    ),
  };
}

/** 생산 완료 → 발주 주체(관리자/MD) 통지 — P3 선적 준비 신호. */
export function buildPcbProducedEmail(p: PcbEqTurnEmailParams): {
  subject: string;
  html: string;
} {
  return {
    subject: `[샘플피씨비] PCB 생산완료 — ${p.projectName} · ${p.partnerName}`,
    html: shell(
      '생산이 완료되었습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 협력사가 <b>${esc(p.projectName)}</b> 발주 건의 생산을 완료했습니다.
        발송(선적) 준비를 진행해 주세요.
      </p>
      <div style="padding-top:16px;">
        <a href="${esc(p.targetUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(p.targetLabel)}</a>
      </div>`,
      '본 메일은 샘플피씨비 PCB 생산 알림입니다.',
    ),
  };
}

// ── P3 선적 알림 — 상대 차례로 넘어갈 때(BOM D22 인지 장치 승계) ──────────────

export interface PcbShipmentTurnEmailParams extends PcbPortalCtaParams {
  recipientName: string;
  projectName: string;
  statusLabel: string; // 진입한 단계 라벨
  nextLabel: string | null; // 상대에게 요청하는 다음 단계(null=확인만)
  targetUrl: string;
  targetLabel: string;
  /** 묶음 구성 발주서 수(1=단건). 대표 프로젝트명만 적으면 함께 실린 건이 안 보인다. */
  poCount?: number;
}

/**
 * 묶음 발송의 제목 표기 — 대표 프로젝트명 하나만 쓰면 "내 다른 발주는 어디 갔나"가 된다.
 * 동반 건의 **프로젝트명은 쓰지 않는다**: 발송은 고객(Case) 경계를 넘어 묶이므로
 * 남의 건 이름이 될 수 있다(여정 9호). 건수만 밝히는 것이 안전하면서 충분하다.
 */
const batchLabel = (projectName: string, poCount: number | undefined): string =>
  poCount !== undefined && poCount > 1
    ? `${projectName} 외 ${String(poCount - 1)}건`
    : projectName;

const batchNoteHtml = (poCount: number | undefined): string =>
  poCount !== undefined && poCount > 1
    ? `<p style="margin:0 0 12px;font-size:13px;color:#4338ca;line-height:1.6;">
        이 발송은 발주 <b>${String(poCount)}건</b>이 함께 담긴 묶음입니다 — 포털에서 구성을 확인해 주세요.
      </p>`
    : '';

/** 선적 상대 차례 통지 — 수신자가 협력사/MD 조직이고 무계정이면 대행 안내(관리자
 *  수신분은 호출부가 분기 없이 기본값으로 보낸다). */
export function buildPcbShipmentTurnEmail(p: PcbShipmentTurnEmailParams): {
  subject: string;
  html: string;
} {
  const noAccount = p.hasPortalAccount === false;
  const nextLine =
    p.nextLabel === null
      ? '내용을 확인해 주세요.'
      : noAccount
        ? `다음 단계인 '<b>${esc(p.nextLabel)}</b>' 진행은 샘플피씨비 담당자가 대행합니다.`
        : `다음 단계인 '<b>${esc(p.nextLabel)}</b>' 처리를 부탁드립니다.`;
  const cta = noAccount
    ? proxyNoticeBox(
        '포털 진행(선적 상태 처리)은 샘플피씨비 담당자가 대행합니다 — 진행 상황 회신·문의:',
        p.inquiryEmail,
      )
    : `
      <div style="padding-top:16px;">
        <a href="${esc(p.targetUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(p.targetLabel)}</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB 선적 진행 — ${batchLabel(p.projectName, p.poCount)} · ${p.statusLabel}`,
    html: shell(
      `선적이 '${esc(p.statusLabel)}' 단계가 되었습니다`,
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.recipientName)} 담당자님, <b>${esc(batchLabel(p.projectName, p.poCount))}</b> 건의 발송이
        '${esc(p.statusLabel)}' 단계로 진행되었습니다.
        ${nextLine}
      </p>${batchNoteHtml(p.poCount)}${cta}`,
      '본 메일은 샘플피씨비 PCB 물류 알림입니다.',
    ),
  };
}

export interface PcbShipmentReceivedEmailParams extends PcbPortalCtaParams {
  partnerName: string; // 보내는측(수신자)
  projectName: string;
  note: string | null;
  /** 묶음 구성 발주서 수(1=단건) — 입고확인 1회가 여러 발주를 닫는다. */
  poCount?: number;
}

/** 입고확인(검수) → 보내는측 통지(무계정이면 포털 버튼 대신 대행 안내). */
export function buildPcbShipmentReceivedEmail(p: PcbShipmentReceivedEmailParams): {
  subject: string;
  html: string;
} {
  const noteHtml =
    p.note === null || p.note.trim() === ''
      ? ''
      : `<p style="margin:0 0 12px;font-size:13px;color:#b45309;line-height:1.6;">검수 메모: <b>${esc(p.note)}</b> — 확인 후 회신 부탁드립니다.</p>`;
  const cta =
    p.hasPortalAccount === false
      ? proxyNoticeBox(
          '포털 확인·후속 처리는 샘플피씨비 담당자가 대행합니다 — 회신·문의:',
          p.inquiryEmail,
        )
      : `
      <div style="padding-top:16px;">
        <a href="${esc(pcbPartnerPortalUrl())}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털 열기</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB 입고 확인 — ${batchLabel(p.projectName, p.poCount)}`,
    html: shell(
      '입고 확인이 완료되었습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, <b>${esc(batchLabel(p.projectName, p.poCount))}</b> 건의 물품 입고 확인(검수)이
        완료되었습니다.
      </p>${batchNoteHtml(p.poCount)}${noteHtml}${cta}`,
      '본 메일은 샘플피씨비 PCB 물류 알림입니다.',
    ),
  };
}

// ── EQ 고객 확인(P4.1) — docs/PCB_PARTNER_TRACK.md D16 ───────────────────────
// ⚠ 이 메일에는 **승인 버튼을 넣지 않는다**. 메일 보안 게이트웨이(O365 ATP·프루프포인트
//   등)가 링크를 자동 GET 하므로, 링크 하나로 상태가 바뀌면 고객이 열어보기도 전에
//   승인된다. 버튼은 주문내역 화면을 열 뿐이고 결정은 그 화면 안에서 POST 로만 한다.
// ⚠ 협력사명·발주서 정보는 넣지 않는다 — 고객에게 공급망을 드러내지 않는다.

/** 주문내역 상세 딥링크 — 해당 확인 요청 항목으로 바로 스크롤(#eq-{reviewId}). */
export const customerOrderViewUrl = (odId: string, reviewId: number): string =>
  `${WEB_BASE_URL}/shop/orderinquiryview.php?od_id=${encodeURIComponent(odId)}#eq-${String(reviewId)}`;

export interface PcbEqCustomerRequestEmailParams {
  projectName: string;
  odId: string;
  reviewId: number;
  message: string;
  dueText: string | null;
  fileCount: number;
}

export function buildPcbEqCustomerRequestEmail(p: PcbEqCustomerRequestEmailParams): {
  subject: string;
  html: string;
} {
  const rows = [
    infoRow('주문번호', esc(p.odId)),
    infoRow('건', esc(p.projectName)),
    ...(p.dueText === null ? [] : [infoRow('회신 기한', `<b>${esc(p.dueText)}</b>`)]),
    ...(p.fileCount === 0 ? [] : [infoRow('첨부', `${String(p.fileCount)}개 (주문내역에서 확인)`)]),
  ].join('');
  return {
    subject: `[샘플피씨비] 제조 확인 요청 — ${p.projectName}`,
    html: shell(
      '제조 확인 사항이 있습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        주문하신 <b>${esc(p.projectName)}</b> 건에 제조 전 확인이 필요한 사항이 있습니다.
        아래 내용을 보시고 <b>주문내역 상세</b>에서 승인 또는 반려해 주세요.
      </p>
      <div style="margin:0 0 14px;padding:12px 14px;background:#f8fafc;border-left:3px solid #0ea5e9;font-size:13px;color:#0f172a;line-height:1.7;white-space:pre-wrap;">${esc(p.message)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(customerOrderViewUrl(p.odId, p.reviewId))}"
           style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          주문내역에서 확인하기</a>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#94a3b8;line-height:1.6;">
        이 버튼은 주문내역 화면을 열 뿐이며, 누르는 것만으로는 승인되지 않습니다.
      </p>`,
      '본 메일은 샘플피씨비 제조 확인 알림입니다.',
    ),
  };
}

// ── A/S 케이스(P4) — 접수 전송 → 재생산 협력사 통지 ─────────────────────────

export interface PcbAsCaseSubmittedEmailParams extends PcbPortalCtaParams {
  partnerName: string;
  projectName: string;
  caseTypeLabel: string; // '관리자 실수' | '제품 불량'
  chargeLabel: string; // '유상' | '무상'
  description: string | null;
}

/** A/S 접수 전송 → 대상 협력사(무계정이면 "포털에서 회신" 대신 대행 회신 안내). */
export function buildPcbAsCaseSubmittedEmail(p: PcbAsCaseSubmittedEmailParams): {
  subject: string;
  html: string;
} {
  const noAccount = p.hasPortalAccount === false;
  const rows = [
    infoRow('대상 건', esc(p.projectName)),
    infoRow('유형', esc(p.caseTypeLabel)),
    infoRow('비용 조건', `<b>${esc(p.chargeLabel)}</b>`),
  ].join('');
  const descHtml =
    p.description === null || p.description.trim() === ''
      ? ''
      : `<div style="margin:12px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #f59e0b;font-size:13px;color:#0f172a;line-height:1.7;white-space:pre-wrap;">${esc(p.description)}</div>`;
  const guide = noAccount
    ? '내용 확인 후 <b>재생산 가능 / 재생산 불가</b> 여부를 회신해 주세요.'
    : '포털에서 내용 확인 후 <b>재생산 가능 / 재생산 불가</b>를 회신해 주세요.';
  const cta = noAccount
    ? proxyNoticeBox(
        '포털 회신은 관리자 대행 회신으로 처리됩니다 — 회신 내용(재생산 가능/불가와 사유)을 보내 주세요:',
        p.inquiryEmail,
      )
    : `
      <div style="padding-top:20px;">
        <a href="${esc(pcbPartnerPortalUrl())}"
           style="display:inline-block;background:#d97706;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 포털에서 회신하기</a>
      </div>`;
  return {
    subject: `[샘플피씨비] PCB A/S 재생산 검토 요청 — ${p.projectName}`,
    html: shell(
      'A/S 재생산 검토 요청이 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 담당자님, 아래 건의 재생산(A/S) 가능 여부 검토를 요청드립니다.
        ${guide}
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>${descHtml}${cta}`,
      '본 메일은 샘플피씨비 PCB A/S 알림입니다.',
    ),
  };
}

export interface PcbAsCaseRepliedEmailParams {
  partnerName: string; // 회신한 협력사
  projectName: string;
  accepted: boolean;
  reason: string | null;
  targetUrl: string; // Case 상세
}

/** 협력사가 A/S 재생산 가능/불가를 회신 → 관리자 통지(놓치면 진행이 멈춘다). */
export function buildPcbAsCaseRepliedEmail(p: PcbAsCaseRepliedEmailParams): {
  subject: string;
  html: string;
} {
  const noteHtml =
    p.reason === null || p.reason.trim() === ''
      ? ''
      : `<p style="margin:0 0 12px;font-size:13px;color:${p.accepted ? '#334155' : '#b91c1c'};line-height:1.6;">회신 사유: <b>${esc(p.reason)}</b></p>`;
  return {
    subject: `[샘플피씨비] A/S ${p.accepted ? '재생산 가능' : '재생산 불가'} — ${p.projectName} · ${p.partnerName}`,
    html: shell(
      `협력사가 A/S 를 '${p.accepted ? '재생산 가능' : '재생산 불가'}'으로 회신했습니다`,
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${esc(p.partnerName)} 협력사가 <b>${esc(p.projectName)}</b> 건의 A/S 접수에 회신했습니다.
        ${p.accepted ? '[재발주 진행]으로 회차 발주서를 만들어 주세요.' : '사유 확인 후 조건을 조정해 다시 접수하거나 종결해 주세요.'}
      </p>${noteHtml}
      <div style="padding-top:16px;">
        <a href="${esc(p.targetUrl)}"
           style="display:inline-block;background:${p.accepted ? '#059669' : '#b91c1c'};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          Case 상세 열기</a>
      </div>`,
      '본 메일은 샘플피씨비 PCB A/S 알림입니다.',
    ),
  };
}

export interface PcbEqCustomerDecisionEmailParams {
  projectName: string;
  approved: boolean;
  note: string | null;
  customerId: string;
}

/** 고객이 답했다 → 관리자에게. 놓치면 생산이 멈추므로 알림이 필요하다. */
export function buildPcbEqCustomerDecisionEmail(p: PcbEqCustomerDecisionEmailParams): {
  subject: string;
  html: string;
} {
  const noteHtml =
    p.note === null || p.note === ''
      ? ''
      : `<p style="margin:0 0 12px;font-size:13px;color:${p.approved ? '#334155' : '#b91c1c'};line-height:1.6;">고객 의견: <b>${esc(p.note)}</b></p>`;
  return {
    subject: `[샘플피씨비] 고객 ${p.approved ? '승인' : '반려'} — ${p.projectName}`,
    html: shell(
      `고객이 제조 확인을 ${p.approved ? '승인' : '반려'}했습니다`,
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        <b>${esc(p.projectName)}</b> 건을 고객(${esc(p.customerId)})이
        ${p.approved ? '승인했습니다. EQ 승인을 진행해 주세요.' : '반려했습니다. 사유를 확인해 협력사에 전달해 주세요.'}
      </p>${noteHtml}`,
      '본 메일은 샘플피씨비 PCB EQ 알림입니다.',
    ),
  };
}
