import type { FastifyBaseLogger } from 'fastify';
import { sendMail } from './mailer';

// ── 재능마켓 알림 메일 빌더 + 비차단 발송 (1차 4종) ──────────────────────────
// estimate-email.ts 의 매체 원칙 미러: 이메일 클라이언트 호환을 위해 table + inline
// style 만 쓰고, 동적 값은 전부 esc() 수동 이스케이프(HTML 인젝션 차단).
// 발송은 액션(등록·입찰·채택·심사)의 성패와 독립 — sendMarketMail 이 내부에서 잡아
// 로그만 남긴다(비차단). 로컬은 Mailpit(127.0.0.1:25)이 가로챈다.
// 알림톡(iwinv)은 템플릿 사전 심사가 필요해 2차(설계 §8).

const esc = (v: string | number | null | undefined): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// KRW 천단위 콤마(정수) — toLocaleString ICU 의존 회피(estimate-email 관례).
const won = (n: number): string => `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`;

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

export interface MarketEmail {
  subject: string;
  html: string;
}

// 공통 셸 — 브랜드 헤더 + 본문 카드 + 이동 버튼.
const shell = (title: string, bodyHtml: string, linkPath: string, linkLabel: string): string => `
<div style="margin:0;padding:24px 12px;background:#f5f7fb;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse;">
    <tr><td style="padding:0 4px 12px;font-size:15px;font-weight:800;color:#081226;">SAMPLEPCB 재능마켓</td></tr>
    <tr><td style="background:#ffffff;border:1px solid #e4eaf3;border-radius:12px;padding:24px;">
      <div style="font-size:17px;font-weight:700;color:#14243e;padding-bottom:12px;">${esc(title)}</div>
      ${bodyHtml}
      <div style="padding-top:20px;">
        <a href="${esc(`${WEB_BASE_URL}${linkPath}`)}"
           style="display:inline-block;background:#f06e1d;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          ${esc(linkLabel)}</a>
      </div>
    </td></tr>
    <tr><td style="padding:12px 4px 0;font-size:11px;color:#8593ab;">
      본 메일은 샘플피씨비 재능마켓 활동 알림입니다.</td></tr>
  </table>
</div>`;

const row = (label: string, value: string): string =>
  `<tr>
    <td style="padding:7px 10px;background:#f3f6f9;color:#555;font-size:13px;white-space:nowrap;border:1px solid #e1e6ea;">${esc(label)}</td>
    <td style="padding:7px 10px;color:#222;font-size:13px;border:1px solid #e1e6ea;">${esc(value)}</td>
  </tr>`;

const table = (rows: string): string =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}</table>`;

// ① 지정견적 요청 도착 → 지정 전문가.
export function buildTargetedRequestEmail(p: {
  expertName: string;
  projectId: number;
  projectTitle: string;
  ownerName: string; // 마스킹된 표시명
  bidDeadlineAt: string; // 표시 문자열(YYYY-MM-DD HH:mm 등 — 호출측 포맷)
}): MarketEmail {
  return {
    subject: `[재능마켓] 지정견적 요청 — ${p.projectTitle}`,
    html: shell(
      `${p.expertName}님, 지정견적 요청이 도착했습니다.`,
      table(
        row('프로젝트', p.projectTitle) +
          row('의뢰인', p.ownerName) +
          row('견적 마감', p.bidDeadlineAt),
      ),
      `/market/projects/${String(p.projectId)}`,
      '프로젝트 확인하고 견적 제출',
    ),
  };
}

// ② 새 입찰(견적) 도착 → 의뢰인. (의뢰인은 블라인드 예외 — 금액을 그대로 안내)
export function buildNewBidEmail(p: {
  projectId: number;
  projectTitle: string;
  expertDisplayName: string;
  amount: number;
  durationDays: number;
  bidCount: number;
}): MarketEmail {
  return {
    subject: `[재능마켓] 새 견적 도착 — ${p.projectTitle}`,
    html: shell(
      `'${p.projectTitle}'에 새 견적이 도착했습니다.`,
      table(
        row('전문가', p.expertDisplayName) +
          row('견적 금액', won(p.amount)) +
          row('작업 기간', `${String(p.durationDays)}일`) +
          row('받은 견적', `${String(p.bidCount)}건`),
      ),
      `/market/projects/${String(p.projectId)}`,
      '견적 비교하기',
    ),
  };
}

// ③ 채택 통지 → 채택된 전문가.
export function buildAwardEmail(p: {
  expertName: string;
  projectId: number;
  projectTitle: string;
  amount: number;
}): MarketEmail {
  return {
    subject: `[재능마켓] 견적 채택 — ${p.projectTitle}`,
    html: shell(
      `${p.expertName}님, 제출하신 견적이 채택되었습니다!`,
      table(row('프로젝트', p.projectTitle) + row('채택 금액', won(p.amount))) +
        `<p style="padding-top:12px;margin:0;font-size:13px;color:#52627d;">
          계약·결제 절차는 샘플피씨비가 순차 안내드립니다. 문의 070-8667-1080</p>`,
      `/market/projects/${String(p.projectId)}`,
      '프로젝트 확인',
    ),
  };
}

// ④ 전문가 심사 결과(승인/반려) → 신청자.
export function buildExpertDecisionEmail(p: {
  displayName: string;
  approved: boolean;
  reason?: string;
}): MarketEmail {
  if (p.approved) {
    return {
      subject: '[재능마켓] 전문가 승인 완료 — 지금부터 활동할 수 있습니다',
      html: shell(
        `${p.displayName}님, 전문가 등록이 승인되었습니다.`,
        `<p style="margin:0;font-size:13px;color:#52627d;">
          이제 공개 프로젝트에 견적을 제출하고, 지정견적 요청을 받을 수 있습니다.</p>`,
        '/market/projects',
        '프로젝트 둘러보기',
      ),
    };
  }
  return {
    subject: '[재능마켓] 전문가 등록 심사 결과 안내',
    html: shell(
      `${p.displayName}님, 전문가 등록이 반려되었습니다.`,
      table(row('반려 사유', p.reason ?? '-')) +
        `<p style="padding-top:12px;margin:0;font-size:13px;color:#52627d;">
          내용을 보완해 마이페이지에서 다시 제출하실 수 있습니다.</p>`,
      '/market/me',
      '내 프로필 보완하기',
    ),
  };
}

// ── 계약(2차) 알림 4종 ───────────────────────────────────────────────────────
// 결제 확인·납품·검수 확정·정산 완료. 발송은 전부 조건부 updateMany count===1 게이트 뒤
// (lazy 승격 동시 조회의 중복 발송 방지 — 설계 §6·M3). 1차 4종과 같은 shell/table/esc 미러.

// ① 결제 확인 → 전문가(작업 시작 + 실수령 안내).
export function buildContractPaidEmail(p: {
  expertName: string;
  projectId: number;
  projectTitle: string;
  amount: number;
  payoutAmount: number;
}): MarketEmail {
  return {
    subject: `[재능마켓] 결제 확인 — ${p.projectTitle}`,
    html: shell(
      `${p.expertName}님, 결제가 확인되었습니다. 작업을 시작해 주세요.`,
      table(
        row('프로젝트', p.projectTitle) +
          row('계약 금액', won(p.amount)) +
          row('정산 예정액', won(p.payoutAmount)),
      ) +
        `<p style="padding-top:12px;margin:0;font-size:13px;color:#52627d;">
          작업 완료 후 [작업 완료 보고]로 산출물을 전달하시면 의뢰인 검수가 진행됩니다.</p>`,
      `/market/projects/${String(p.projectId)}`,
      '프로젝트 확인',
    ),
  };
}

// ② 납품 보고 → 의뢰인(검수 요청 + 7일 자동확정 고지). ownerName 은 마스킹 표시명.
export function buildContractDeliveredEmail(p: {
  ownerName: string;
  projectId: number;
  projectTitle: string;
  autoConfirmAt: string; // 표시 문자열(YYYY-MM-DD 등 — 호출측 포맷)
}): MarketEmail {
  return {
    subject: `[재능마켓] 작업물 도착 — ${p.projectTitle}`,
    html: shell(
      `${p.ownerName}님, 작업물이 도착했습니다. 검수해 주세요.`,
      table(row('프로젝트', p.projectTitle) + row('자동 확정 예정', p.autoConfirmAt)) +
        `<p style="padding-top:12px;margin:0;font-size:13px;color:#52627d;">
          기한 내 미확정 시 자동으로 검수 확정되어 정산이 진행됩니다.</p>`,
      `/market/projects/${String(p.projectId)}`,
      '작업물 확인하고 검수',
    ),
  };
}

// ③ 검수 확정 → 전문가(정산 예정). 수동 확정·7일 자동확정 공용.
export function buildContractConfirmedEmail(p: {
  expertName: string;
  projectId: number;
  projectTitle: string;
  payoutAmount: number;
}): MarketEmail {
  return {
    subject: `[재능마켓] 검수 확정 — ${p.projectTitle}`,
    html: shell(
      `${p.expertName}님, 작업물 검수가 확정되었습니다.`,
      table(row('프로젝트', p.projectTitle) + row('정산 예정액', won(p.payoutAmount))) +
        `<p style="padding-top:12px;margin:0;font-size:13px;color:#52627d;">
          정산은 샘플피씨비가 순차 처리합니다. 문의 070-8667-1080</p>`,
      `/market/projects/${String(p.projectId)}`,
      '프로젝트 확인',
    ),
  };
}

// ④ 정산 완료 → 전문가.
export function buildContractSettledEmail(p: {
  expertName: string;
  projectId: number;
  projectTitle: string;
  payoutAmount: number;
}): MarketEmail {
  return {
    subject: `[재능마켓] 정산 완료 — ${p.projectTitle}`,
    html: shell(
      `${p.expertName}님, 정산이 완료되었습니다.`,
      table(row('프로젝트', p.projectTitle) + row('정산액', won(p.payoutAmount))),
      `/market/projects/${String(p.projectId)}`,
      '프로젝트 확인',
    ),
  };
}

// 비차단 발송 — 실패는 로그만(액션 성패와 독립). to 가 없으면 조용히 스킵.
export async function sendMarketMail(
  log: FastifyBaseLogger,
  to: string | undefined,
  mail: MarketEmail,
): Promise<void> {
  if (to === undefined || to.trim() === '') return;
  try {
    await sendMail({
      to,
      subject: mail.subject,
      html: mail.html,
      fromName: '샘플피씨비 재능마켓',
      fromAddress: process.env.MAIL_FROM ?? 'sales@samplepcb.co.kr',
    });
  } catch (err) {
    log.error({ err, to, subject: mail.subject }, 'market mail send failed');
  }
}
