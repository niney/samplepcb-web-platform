import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// ── SMTP 메일 전송 (sp-node 직송) ────────────────────────────────────────────
// 견적 메일 발송용 전송 계층. 로컬은 SMTP_HOST/PORT 미설정 시 127.0.0.1:25 = Mailpit 가
// 가로채 외부 0통(docs/LOCAL_MAIL_TESTING.md). 운영은 실제 릴레이를 env 로 지정한다.
// 코어 PHP mailer(무인증 SMTP 고정)와 달리 SMTP_USER/PASS 가 있으면 인증형 릴레이도 지원.
// sendMail 은 실패 시 throw 하며, 라우트가 잡아 채널 상태('failed')로 정직하게 매핑한다.

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter !== null) return transporter;
  const host = process.env.SMTP_HOST ?? '127.0.0.1';
  const port = Number(process.env.SMTP_PORT ?? 25);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465=implicit TLS · 그 외(25·587·Mailpit)=평문/STARTTLS
    // 로컬 Mailpit 은 무인증 — user/pass 둘 다 있을 때만 auth 를 붙인다(운영 릴레이 대비).
    ...(user !== undefined && user !== '' && pass !== undefined && pass !== ''
      ? { auth: { user, pass } }
      : {}),
  });
  return transporter;
}

export interface SendMailParams {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromAddress: string;
}

// 성공이면 정상 반환, 실패면 throw(nodemailer 가 reject). 라우트가 try/catch 로 잡아
// mail:'failed' 로 표면화한다. (전송 결과 상세는 서버 로그 계층에 맡기고 여기선 성패만.)
export async function sendMail(params: SendMailParams): Promise<void> {
  await getTransporter().sendMail({
    from: { name: params.fromName, address: params.fromAddress },
    to: params.to,
    subject: params.subject,
    html: params.html,
  });
}
