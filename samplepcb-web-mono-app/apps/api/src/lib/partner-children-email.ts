import { esc, infoRow, shell } from './pcb-rfq-email';

// ── 하위 협력사 직접 관리 알림 메일 — docs/PARTNER_PORTAL.md "하위 협력사 직접 관리" ──
// 발송은 서버가 소유한다(비차단·sp_mail_log 기록) — PCB 트랙 메일과 같은 셸을 쓴다.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

export const partnerInviteUrl = (token: string): string =>
  `${WEB_BASE_URL}/app/partner-invite/${token}`;

export const adminPartnersUrl = (): string => `${WEB_BASE_URL}/app/admin/partners`;

export interface PartnerInviteEmailParams {
  partnerName: string;
  /** 초대한 조직(마스터딜러) — 관리자가 보냈으면 null. */
  inviterName: string | null;
  acceptUrl: string;
  ttlDays: number;
}

/** 포털 초대 — 받은 사람이 자기 계정으로 로그인해 수락하면 조직에 연결된다. */
export function buildPartnerInviteEmail(p: PartnerInviteEmailParams): {
  subject: string;
  html: string;
} {
  const lead =
    p.inviterName === null
      ? `${esc(p.partnerName)} 담당자님, 샘플피씨비 파트너 포털 이용 초대가 도착했습니다.`
      : `${esc(p.partnerName)} 담당자님, ${esc(p.inviterName)}에서 샘플피씨비 파트너 포털 이용을 초대했습니다.`;
  return {
    subject: `[샘플피씨비] 파트너 포털 초대 — ${p.partnerName}`,
    html: shell(
      '파트너 포털 초대가 도착했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        ${lead}
        포털에서는 견적 회신, 발주 확인, 제작 진행과 발송을 직접 처리할 수 있습니다.
      </p>
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        아래 버튼을 눌러 <b>본인 계정으로 로그인</b>(계정이 없으면 회원가입)한 뒤 초대를 수락해 주세요.
      </p>
      <div style="padding-top:8px;">
        <a href="${esc(p.acceptUrl)}"
           style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          초대 수락하기</a>
      </div>
      <p style="margin:14px 0 0;font-size:11px;color:#8593ab;">
        이 링크는 한 번만 쓸 수 있고 ${String(p.ttlDays)}일 뒤 닫힙니다(외부 공유는 삼가 주세요).
        포털 계정 없이도 견적요청 메일의 링크로 회신할 수 있습니다.
      </p>`,
      '본 메일은 샘플피씨비 파트너 포털 초대 알림입니다.',
    ),
  };
}

export interface PartnerChildRegisteredEmailParams {
  childName: string;
  country: string | null;
  contactEmail: string | null;
  /** 등록한 마스터딜러 조직. */
  ownerName: string;
  registeredBy: string;
  /** 진행 중 발주가 있는데 관리자가 강제로 전환했다면 그 사유. */
  forceNote: string | null;
  adminUrl: string;
}

/** 마스터딜러가 하위 협력사를 등록했다 → 운영자 통지(자동 승인이라 사후 감독의 출발점). */
export function buildPartnerChildRegisteredEmail(p: PartnerChildRegisteredEmailParams): {
  subject: string;
  html: string;
} {
  const rows = [
    infoRow('하위 협력사', esc(p.childName)),
    infoRow('국가', esc(p.country ?? '—')),
    infoRow('담당 이메일', esc(p.contactEmail ?? '—')),
    infoRow('등록한 조직', esc(p.ownerName)),
    infoRow('등록 계정', esc(p.registeredBy)),
    ...(p.forceNote === null ? [] : [infoRow('강제 전환 사유', esc(p.forceNote))]),
  ].join('');
  return {
    subject: `[샘플피씨비] 하위 협력사 등록 — ${p.ownerName} · ${p.childName}`,
    html: shell(
      '마스터딜러가 하위 협력사를 등록했습니다',
      `
      <p style="margin:0 0 12px;font-size:13px;color:#333;line-height:1.6;">
        포털 등록은 승인 절차 없이 바로 쓰입니다. 이 조직은 고객 도면·사양이 담긴 견적요청을 받게 되므로
        내용을 확인하고, 문제가 있으면 파트너 관리에서 정지해 주세요.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${rows}
      </table>
      <div style="padding-top:20px;">
        <a href="${esc(p.adminUrl)}"
           style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:10px 18px;border-radius:8px;">
          파트너 관리에서 확인</a>
      </div>`,
      '본 메일은 샘플피씨비 하위 협력사 등록 알림입니다.',
    ),
  };
}
