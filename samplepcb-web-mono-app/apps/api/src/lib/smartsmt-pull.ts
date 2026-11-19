import type { FastifyBaseLogger } from 'fastify';
import { SmartsmtEnvelope } from '@sp/api-contract';
import type { SmartsmtPullError } from '@sp/api-contract';
import {
  SMARTSMT_MAX_ENVELOPE_BYTES,
  checkSmartsmtFiles,
  findSmartsmtSameContent,
  saveSmartsmtQuote,
  smartsmtQuoteExists,
  summarizeSmartsmtEnvelope,
} from './smartsmt';
import { SMARTSMT_PEER, SMARTSMT_SELF, signSmartsmtToken, smartsmtSecret } from './smartsmt-token';

// SmartSMT 견적서 가져오기 — 우리가 SmartSMT 를 부른다 (docs/SMARTSMT_INTEGRATION.md §3 · §4.5).
//   GET {SMARTSMT_BASE_URL}/api/pricing/envelope?orderId=…   Authorization: Bearer (iss=samplepcb, aud=smartsmt)
//
// 전송(SmartSMT → 우리)을 놓쳤을 때의 보완 수단이다. 견적서만 오고 파일은 오지 않으며,
// SmartSMT 의 보관 기간(24시간)이 지나면 가져올 수 없다.
//
// SmartSMT 의 답(원문 문서 「API 요청 주소 0.1」): 200 견적서 / 403 키 불일치 / 404 주문 없음·만료 /
// 409 NO_INPUTS(담당자 계산 전) · NOT_PUBLISHABLE(확정 전) / 503 서버 키 미설정. 실패 본문은 {"detail":{"reason","message"}}.

const DEFAULT_TIMEOUT_MS = 10_000;

export type SmartsmtPullResult =
  | { ok: true; quoteId: string; orderId: string; duplicate: boolean }
  | { ok: false; status: 404 | 409 | 502 | 503; error: SmartsmtPullError; message: string };

const fail = (
  status: 404 | 409 | 502 | 503,
  error: SmartsmtPullError,
  message: string,
): SmartsmtPullResult => ({ ok: false, status, error, message });

/** 설정된 SmartSMT 주소(끝의 / 제거). 없거나 http(s) 주소가 아니면 null. */
export function smartsmtBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = (env.SMARTSMT_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/]+/i.test(value) ? value : null;
}

/** SmartSMT 를 부를 때 기다리는 시간(ms). 1초~2분 밖의 값은 기본값(10초)으로 본다. */
export const smartsmtTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const value = Number(env.SMARTSMT_TIMEOUT_MS);
  return Number.isFinite(value) && value >= 1_000 && value <= 120_000 ? value : DEFAULT_TIMEOUT_MS;
};

/** SmartSMT 실패 본문의 사유({"detail":{"reason"}}). 읽지 못하면 null. */
function peerReason(text: string): string | null {
  try {
    const body = JSON.parse(text) as { detail?: { reason?: unknown } } | null;
    const reason = body?.detail?.reason;
    return typeof reason === 'string' && reason !== '' ? reason.slice(0, 64) : null;
  } catch {
    return null;
  }
}

/**
 * 주문 번호로 견적서를 가져와 저장한다. 이미 갖고 있는 견적이면 저장하지 않고 duplicate 로 답한다.
 * SmartSMT 는 읽을 때마다 견적번호를 새로 만들므로(docs §8) 번호가 달라도 **그 주문의 마지막 견적과 내용이 같으면**
 * 이미 가진 견적으로 본다 — 그때 돌려주는 quoteId 는 우리가 보관한 번호다.
 * `fetchImpl` 은 테스트용 — 기본은 전역 fetch.
 */
export async function pullSmartsmtQuote(
  orderId: string,
  log: FastifyBaseLogger,
  fetchImpl: typeof fetch = fetch,
): Promise<SmartsmtPullResult> {
  const baseUrl = smartsmtBaseUrl();
  const secret = smartsmtSecret();
  if (baseUrl === null || secret === null) {
    return fail(503, 'SMARTSMT_NOT_CONFIGURED', 'SmartSMT 주소 또는 공유 비밀이 설정되지 않았습니다');
  }

  let status: number;
  let text: string;
  try {
    const res = await fetchImpl(`${baseUrl}/api/pricing/envelope?orderId=${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${signSmartsmtToken(secret, { iss: SMARTSMT_SELF, aud: SMARTSMT_PEER })}`,
        accept: 'application/json',
      },
      // 다른 주소로 넘기는 응답은 따라가지 않는다 — 토큰이 엉뚱한 곳으로 가지 않게.
      redirect: 'manual',
      signal: AbortSignal.timeout(smartsmtTimeoutMs()),
    });
    status = res.status;
    text = await res.text();
  } catch (err) {
    log.warn({ err }, 'smartsmt: 견적서 가져오기 — 접속 실패');
    return fail(502, 'SMARTSMT_UNREACHABLE', 'SmartSMT 에 접속하지 못했습니다 (연결 실패 또는 응답 시간 초과)');
  }

  if (status !== 200) {
    const reason = peerReason(text);
    const tail = reason === null ? ` (HTTP ${String(status)})` : ` (HTTP ${String(status)} · ${reason})`;
    if (status === 401 || status === 403) {
      return fail(502, 'SMARTSMT_AUTH_REJECTED', `SmartSMT 가 인증을 받아들이지 않았습니다${tail}`);
    }
    if (status === 404) {
      return fail(404, 'SMARTSMT_NOT_FOUND', 'SmartSMT 에 그 주문이 없거나 보관 기간(24시간)이 지났습니다');
    }
    if (status === 409) {
      return fail(
        409,
        'SMARTSMT_NOT_READY',
        reason === 'NO_INPUTS'
          ? '아직 SmartSMT 담당자가 계산하지 않은 주문입니다'
          : reason === 'NOT_PUBLISHABLE'
            ? '아직 확정되지 않은 견적입니다'
            : `SmartSMT 가 아직 견적서를 내줄 수 없습니다${tail}`,
      );
    }
    log.warn({ status, reason }, 'smartsmt: 견적서 가져오기 — 예상하지 못한 응답');
    return fail(502, 'SMARTSMT_BAD_RESPONSE', `SmartSMT 가 예상하지 못한 응답을 했습니다${tail}`);
  }

  if (Buffer.byteLength(text) > SMARTSMT_MAX_ENVELOPE_BYTES) {
    return fail(502, 'SMARTSMT_BAD_RESPONSE', 'SmartSMT 가 준 견적서가 허용 크기를 넘습니다');
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(502, 'SMARTSMT_BAD_RESPONSE', 'SmartSMT 의 응답이 JSON 이 아닙니다');
  }
  const parsed = SmartsmtEnvelope.safeParse(json);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    return fail(502, 'SMARTSMT_BAD_RESPONSE', `SmartSMT 의 응답이 견적서가 아닙니다${where === '' ? '' : ` (${where})`}`);
  }

  const summary = summarizeSmartsmtEnvelope(parsed.data);
  // 물어본 주문의 견적서가 맞는지 — 다른 주문의 견적이 엉뚱한 주문으로 저장되는 것을 막는다.
  if (summary.orderId !== orderId) {
    return fail(502, 'SMARTSMT_BAD_RESPONSE', 'SmartSMT 가 다른 주문의 견적서를 주었습니다');
  }
  const ids = { quoteId: summary.quoteId, orderId: summary.orderId };
  if (await smartsmtQuoteExists(summary.quoteId)) return { ok: true, ...ids, duplicate: true };
  const sameAs = await findSmartsmtSameContent(orderId, json);
  if (sameAs !== null) return { ok: true, quoteId: sameAs, orderId: summary.orderId, duplicate: true };

  // 파일은 오지 않는다 — 견적서의 파일 목록은 전부 missing 으로 적힌다.
  const files = checkSmartsmtFiles(summary.manifest, []);
  const saved = await saveSmartsmtQuote(
    {
      summary,
      envelopeText: text, // 받은 글자 그대로
      source: 'pull',
      files: [],
      fileChecks: files.ok ? files.files : [],
      receivedAt: new Date(),
    },
    log,
  );
  if (saved.saved) return { ok: true, ...ids, duplicate: false };
  if (saved.reason === 'duplicate') return { ok: true, ...ids, duplicate: true };
  // 파일이 없으므로 파일 저장 실패는 일어나지 않는다 — 타입을 닫기 위한 자리.
  return fail(502, 'SMARTSMT_BAD_RESPONSE', saved.message);
}
