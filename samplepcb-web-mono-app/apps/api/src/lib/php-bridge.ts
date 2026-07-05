// ── PHP 알림 브리지 클라이언트 (sp-node → sp-php) ────────────────────────────
// 주문 상태 전이 성공 건의 메일/SMS 를 Node 에서 재구현하지 않고 그누보드/영카트의 커스텀된
// 주문 메일 템플릿(ordermail.inc.php·ordermail.mail.php — 견적 건별 표시 커스텀)을 그대로 쓰기
// 위해, spcb/api/order-notify.php 에 서비스 JWT(HS256, svc:'sp-node', 짧은 exp)로 POST 한다.
// 발송 실패는 전이 실패로 만들지 않는다 — throw 하지 않고 'failed' 를 돌려준다(라우트가 notify 에 기록).

export type NotifyStatus = 'sent' | 'failed' | 'skipped';

export interface NotifyOrderEventParams {
  odId: string;
  event: '입금' | '준비' | '배송' | '완료';
  mail: boolean;
  sms: boolean;
  dryRun?: boolean;
}

export interface NotifyOrderEventOptions {
  token: string; // 라우트가 fastify.jwt.sign({svc:'sp-node'}, {expiresIn}) 로 서명
  baseUrl?: string; // 기본 SPCB_BRIDGE_URL(env) → http://127.0.0.1:8888
  timeoutMs?: number; // 기본 10s
}

export interface NotifyOrderEventResult {
  mail?: NotifyStatus;
  sms?: NotifyStatus;
}

const asStatus = (v: unknown): NotifyStatus | undefined =>
  v === 'sent' || v === 'failed' || v === 'skipped' ? v : undefined;

// 요청한 채널(mail/sms)만 결과에 담는다(exactOptionalPropertyTypes — undefined 미할당).
function buildResult(
  params: NotifyOrderEventParams,
  mail: NotifyStatus | undefined,
  sms: NotifyStatus | undefined,
): NotifyOrderEventResult {
  const out: NotifyOrderEventResult = {};
  if (params.mail) out.mail = mail ?? 'failed';
  if (params.sms) out.sms = sms ?? 'failed';
  return out;
}

export async function notifyOrderEvent(
  params: NotifyOrderEventParams,
  opts: NotifyOrderEventOptions,
): Promise<NotifyOrderEventResult> {
  if (!params.mail && !params.sms) return {}; // 보낼 채널 없음
  const baseUrl = opts.baseUrl ?? process.env.SPCB_BRIDGE_URL ?? 'http://127.0.0.1:8888';
  const url = `${baseUrl.replace(/\/$/, '')}/spcb/api/order-notify`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify({
        odId: params.odId,
        event: params.event,
        mail: params.mail,
        sms: params.sms,
        dryRun: params.dryRun ?? false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return buildResult(params, 'failed', 'failed');
    const json: unknown = await res.json();
    const body = (json ?? {}) as { mail?: unknown; sms?: unknown };
    return buildResult(params, asStatus(body.mail), asStatus(body.sms));
  } catch {
    // 타임아웃·네트워크 오류 — 전이는 이미 성공했으므로 failed 만 기록하고 삼킨다.
    return buildResult(params, 'failed', 'failed');
  } finally {
    clearTimeout(timer);
  }
}
