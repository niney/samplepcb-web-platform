import type { AdminNotifyChannelStatusType } from '@sp/api-contract';

// ── 카카오 알림톡 발송 (iwinv) ───────────────────────────────────────────────
// 레거시 shop/alimtalk_api.php 의 sendCompleteEstimate(견적완료 알림, templateCode 13067)를
// Node 로 포팅. vendor 는 정적 AUTH 헤더 + JSON POST 한 방이라 이식이 가볍다. 하드코딩돼 있던
// AUTH 토큰은 env(ALIMTALK_AUTH_TOKEN)로 옮겼다(보안). 레거시가 무조건 붙이던 테스트성 SMS
// resend 폴백(resendTitle:"테스트" 등)은 제거했다.
//
// 로컬 안전(핵심): ALIMTALK_ENABLED!=='true' 면 실발송 없이 'skipped'(로그만) — 명시적으로
// 켜지 않는 한 절대 외부로 나가지 않는다(fail-safe). 비회원/무효 번호도 'skipped'(vendor 미호출).

const IWINV_DEFAULT_URL = 'https://alimtalk.bizservice.iwinv.kr/api/v2/send/';

export interface CompleteEstimateParams {
  phone: string; // 수신자 휴대폰(원문, 하이픈 포함 가능)
  name: string; // 수신자 이름
  filename: string; // 견적 식별 라벨(프로젝트명 등) — 레거시 파일명 자리
  date: string; // YYYY.MM.DD
}

export interface AlimtalkPayload {
  templateCode: string;
  list: { phone: string; templateParam: string[] }[];
}

// iwinv 페이로드(템플릿 13067 파라미터 순서: [이름, 파일명, 날짜]). 순수 함수(테스트 대상).
export function buildCompleteEstimatePayload(
  p: CompleteEstimateParams,
  phoneDigits: string,
): AlimtalkPayload {
  return {
    templateCode: '13067',
    list: [{ phone: phoneDigits, templateParam: [p.name, p.filename, p.date] }],
  };
}

const normalizePhone = (raw: string): string => raw.replace(/[^0-9]/g, '');
// 레거시 isValidPhoneNumber 미러(01X + 7~8자리). 정규화 후 판정.
const isValidKrMobile = (digits: string): boolean => /^01[016789][0-9]{7,8}$/.test(digits);

type LogFn = (obj: Record<string, unknown>, msg: string) => void;

// 견적완료 알림톡 발송. 성공(HTTP 2xx)=sent · 그 외/예외=failed · 비활성/무효번호=skipped.
export async function sendCompleteEstimate(
  p: CompleteEstimateParams,
  log: LogFn,
): Promise<AdminNotifyChannelStatusType> {
  const phone = normalizePhone(p.phone);
  if (!isValidKrMobile(phone)) {
    log({ phone: p.phone }, 'alimtalk skipped: invalid or missing phone');
    return 'skipped';
  }

  const payload = buildCompleteEstimatePayload(p, phone);

  // 로컬/비활성 안전장치 — 명시적으로 켜지 않으면 실발송하지 않는다(fail-safe).
  if (process.env.ALIMTALK_ENABLED !== 'true') {
    log(
      { templateCode: payload.templateCode, phone, param: payload.list[0]?.templateParam },
      'alimtalk would send (disabled — local no-op)',
    );
    return 'skipped';
  }

  const token = process.env.ALIMTALK_AUTH_TOKEN ?? '';
  if (token === '') {
    log({}, 'alimtalk failed: ALIMTALK_AUTH_TOKEN missing while enabled');
    return 'failed';
  }
  const url = process.env.ALIMTALK_URL ?? IWINV_DEFAULT_URL;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { AUTH: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      log({ status: res.status }, 'alimtalk failed: non-2xx response');
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    log({ err }, 'alimtalk failed: request error');
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}
