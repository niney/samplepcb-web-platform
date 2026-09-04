import type { FastifyBaseLogger } from 'fastify';
import { DEVELOP_REQUEST_STATUS_LABELS, marketAreaBadge } from '@sp/api-contract';
import type { DevelopRequestStatusType } from '@sp/api-contract';
import { sendMail } from './mailer';
import { errorReason, recordMailLog } from './mail-log';
import type { MailLogMeta } from './mail-log';

// ── 개발의뢰 알림 메일(docs/DEVELOP_FLOW.md §9) — 비차단, sp_mail_log 기록 ─────────────────
// market-email.ts 매체 원칙 미러: table + inline style, 동적 값 esc(). 발송은 액션 성패와 독립(로그만).
// 고객: 접수 확인 · 견적 발송 · 결제 확인 · 납품 · 검수 확정 · 진행 불가/취소 · 문의 답변
// 관리자(settings.notifyEmails): 새 의뢰 · 수락 · 결제 확인 · 고객 문의 · 검수 확정

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const won = (n: number): string => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

export interface DevelopEmail {
  subject: string;
  html: string;
}

const shell = (title: string, bodyHtml: string, linkPath: string, linkLabel: string): string => `
<div style="margin:0;padding:24px 12px;background:#f4f6f8;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#0b1220;">SAMPLEPCB 개발의뢰</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#0f172a;padding-bottom:12px;">${esc(title)}</div>
      ${bodyHtml}
      <div style="padding-top:20px;">
        <a href="${esc(`${WEB_BASE_URL}${linkPath}`)}"
           style="display:inline-block;background:#1b6ef3;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(linkLabel)}</a>
      </div>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#64748b;">
      본 메일은 샘플피씨비 개발의뢰 진행 알림입니다.</td></tr>
  </table>
</div>`;

const row = (label: string, value: string): string =>
  `<tr>
    <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">${esc(label)}</td>
    <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${esc(value)}</td>
  </tr>`;

const table = (rows: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>`;

const para = (text: string): string => `<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155;">${esc(text)}</p>`;

const customerPath = (requestId: number): string => `/develop/requests/${String(requestId)}`;
const adminPath = (requestId: number): string => `/app/admin/develop/requests/${String(requestId)}`;

interface RequestBrief { requestId: number; title: string; serviceAreas: readonly string[] }

// 고객 — 접수 확인.
export function buildRequestReceivedEmail(p: RequestBrief & { contactName: string }): DevelopEmail {
  return {
    subject: `[샘플피씨비 개발의뢰] 접수되었습니다 — ${p.title}`,
    html: shell(
      '개발의뢰가 접수되었습니다',
      para(`${p.contactName} 님, 의뢰 내용을 담당자가 검토한 뒤 영업일 2~3일 안에 연락드립니다. 필요하면 전화로 요구사항을 함께 정리합니다.`) +
        table(row('의뢰', p.title) + row('개발 분야', marketAreaBadge(p.serviceAreas)) + row('상태', DEVELOP_REQUEST_STATUS_LABELS.received)),
      customerPath(p.requestId),
      '의뢰 확인',
    ),
  };
}

// 관리자 — 새 의뢰.
export function buildAdminNewRequestEmail(p: RequestBrief & { contactName: string; contactCompany: string | null; contactPhone: string; budgetLabel: string }): DevelopEmail {
  return {
    subject: `[개발의뢰 접수] ${p.title}`,
    html: shell(
      '새 개발의뢰가 들어왔습니다',
      table(
        row('의뢰', p.title) +
          row('개발 분야', marketAreaBadge(p.serviceAreas)) +
          row('연락처', `${p.contactName}${p.contactCompany === null ? '' : ` · ${p.contactCompany}`} · ${p.contactPhone}`) +
          row('예산', p.budgetLabel),
      ),
      adminPath(p.requestId),
      '관리자에서 열기',
    ),
  };
}

// 고객 — 상태 변경(진행 불가·취소·착수 등). 사유가 있으면 함께.
export function buildStatusChangedEmail(p: RequestBrief & { status: DevelopRequestStatusType; reason: string | null }): DevelopEmail {
  const label = DEVELOP_REQUEST_STATUS_LABELS[p.status];
  return {
    subject: `[샘플피씨비 개발의뢰] ${label} — ${p.title}`,
    html: shell(
      `의뢰 상태가 "${label}" 로 바뀌었습니다`,
      table(row('의뢰', p.title) + row('상태', label) + (p.reason === null ? '' : row('안내', p.reason))),
      customerPath(p.requestId),
      '의뢰 확인',
    ),
  };
}

// 고객 — 견적 발송.
export function buildQuoteSentEmail(p: RequestBrief & { version: number; totalAmount: number; validUntil: string; itemCount: number }): DevelopEmail {
  return {
    subject: `[샘플피씨비 개발의뢰] 견적서가 도착했습니다 — ${p.title}`,
    html: shell(
      '견적서를 보내드립니다',
      para('항목별 금액과 결제 조건·산출물·표준 조건을 확인하시고, 수락하시면 착수금 결제 안내로 이어집니다. 조정이 필요하면 의뢰 화면의 문의로 남겨 주세요.') +
        table(
          row('의뢰', p.title) +
            row('견적', `v${String(p.version)} · 항목 ${String(p.itemCount)}개`) +
            row('합계(VAT 포함)', won(p.totalAmount)) +
            row('유효기간', `${p.validUntil} 까지`),
        ),
      customerPath(p.requestId),
      '견적서 보기',
    ),
  };
}

// 관리자 — 견적 수락.
export function buildAdminQuoteAcceptedEmail(p: RequestBrief & { version: number; totalAmount: number; acceptedName: string }): DevelopEmail {
  return {
    subject: `[개발의뢰 수락] ${p.title} — v${String(p.version)}`,
    html: shell(
      '고객이 견적을 수락했습니다',
      table(row('의뢰', p.title) + row('견적', `v${String(p.version)} · ${won(p.totalAmount)}`) + row('수락자', p.acceptedName)),
      adminPath(p.requestId),
      '관리자에서 열기',
    ),
  };
}

// 고객 — 결제 확인(마일스톤).
export function buildPaymentConfirmedEmail(p: RequestBrief & { milestoneTitle: string; amount: number; started: boolean }): DevelopEmail {
  return {
    subject: `[샘플피씨비 개발의뢰] ${p.milestoneTitle} 결제가 확인되었습니다 — ${p.title}`,
    html: shell(
      `${p.milestoneTitle} 결제가 확인되었습니다`,
      para(p.started ? '개발에 착수합니다. 진행 상황은 의뢰 화면의 타임라인으로 알려드립니다.' : '결제 내용이 반영되었습니다.') +
        table(row('의뢰', p.title) + row('결제', `${p.milestoneTitle} · ${won(p.amount)}`)),
      customerPath(p.requestId),
      '의뢰 확인',
    ),
  };
}

// 고객 — 납품(검수 안내).
export function buildDeliveredEmail(p: RequestBrief & { reviewDays: number; autoConfirmAt: string }): DevelopEmail {
  return {
    subject: `[샘플피씨비 개발의뢰] 납품되었습니다 — 검수를 부탁드립니다 (${p.title})`,
    html: shell(
      '산출물이 납품되었습니다',
      para(`의뢰 화면에서 산출물을 확인하시고 검수 결과를 알려 주세요. ${String(p.reviewDays)}일(${p.autoConfirmAt}) 안에 의견이 없으면 납품이 확정된 것으로 봅니다.`) +
        table(row('의뢰', p.title)),
      customerPath(p.requestId),
      '산출물 확인',
    ),
  };
}

// 고객·관리자 — 검수 확정.
export function buildCompletedEmail(p: RequestBrief & { confirmedBy: 'client' | 'auto' | 'admin'; forAdmin: boolean }): DevelopEmail {
  const how = p.confirmedBy === 'auto' ? '검수 기간 경과로 자동 확정' : p.confirmedBy === 'admin' ? '담당자 확인' : '고객 확정';
  return {
    subject: `[샘플피씨비 개발의뢰] 검수가 확정되었습니다 — ${p.title}`,
    html: shell(
      '검수가 확정되었습니다',
      table(row('의뢰', p.title) + row('확정', how)),
      p.forAdmin ? adminPath(p.requestId) : customerPath(p.requestId),
      '의뢰 확인',
    ),
  };
}

// 문의 — 고객 → 관리자 / 관리자 → 고객.
export function buildCommentEmail(p: RequestBrief & { forAdmin: boolean; excerpt: string }): DevelopEmail {
  return {
    subject: `[샘플피씨비 개발의뢰] ${p.forAdmin ? '고객 문의' : '담당자 답변'} — ${p.title}`,
    html: shell(
      p.forAdmin ? '고객이 문의를 남겼습니다' : '담당자가 답변을 남겼습니다',
      table(row('의뢰', p.title) + row('내용', p.excerpt)),
      p.forAdmin ? adminPath(p.requestId) : customerPath(p.requestId),
      '문의 보기',
    ),
  };
}

// 비차단 발송 — 실패는 로그만. 발송 시도는 성패·스킵 불문 sp_mail_log 에 남긴다.
export async function sendDevelopMail(
  log: FastifyBaseLogger,
  to: string | undefined,
  mail: DevelopEmail,
  meta: MailLogMeta,
): Promise<void> {
  const recipient = (to ?? '').trim();
  if (recipient === '') {
    await recordMailLog(log, meta, { channel: 'email', status: 'skipped', reason: 'missing_recipient', recipient: '', subject: mail.subject });
    return;
  }
  try {
    await sendMail({
      to: recipient,
      subject: mail.subject,
      html: mail.html,
      fromName: '샘플피씨비 개발의뢰',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
    await recordMailLog(log, meta, { channel: 'email', status: 'sent', recipient, subject: mail.subject });
  } catch (err) {
    log.error({ err, to: recipient, subject: mail.subject }, 'develop mail send failed');
    await recordMailLog(log, meta, { channel: 'email', status: 'failed', reason: errorReason(err), recipient, subject: mail.subject });
  }
}

// 관리자 수신자 여러 명 — 각각 기록(수신자별 실패가 갈리게).
export async function sendDevelopMailToAdmins(
  log: FastifyBaseLogger,
  emails: readonly string[],
  mail: DevelopEmail,
  meta: MailLogMeta,
): Promise<void> {
  for (const email of emails) await sendDevelopMail(log, email, mail, meta);
}
