// 라이브 가격표 조회 — 견적 계산 직전에 운영 gerber_api/pricing_data.json 을 그대로
// 가져와 쓴다. 이 파일이 가격의 단일 진실이다: 레거시 관리자 도구(adm/price_adjust.php)가
// 예고 없이 덮어쓰고, 레거시 PHP 가격 API(PcbPriceBase)는 매 요청 이 파일을 읽는다.
// sp-node 만 번들 스냅샷에 멈춰 있으면 거버 뷰어 표시가와 저장가가 어긋난다(실측 최대 10%).
//
// 폴백 사다리: 라이브 → 마지막 성공본 → 번들 스냅샷. 가격표 서버가 죽어도 견적 계산은
// 절대 실패하지 않는다. 어느 표로 계산했는지는 version(→ sp_quote.priceVersion)에 남는다.
import type { FastifyBaseLogger } from 'fastify';
import { BUNDLED_PRICING, type PricingData, type PricingSource } from './engine';

const DEFAULT_URL = 'https://www.samplepcb.co.kr/gerber_api/pricing_data.json';
const FETCH_TIMEOUT_MS = 5_000;
// 성공 후 60초는 재조회 없이 재사용(같은 화면 연속 저장 대비), 실패 후 60초는 재시도
// 없이 폴백 즉답(장애 중 매 계산이 5초 타임아웃을 물지 않게).
const TTL_MS = 60_000;

let cached: PricingSource | null = null;
let fetchedAt = 0;
let failedAt = 0;

// 형태 검증은 느슨하게 — 목적은 HTML 에러 페이지·잘린 JSON 차단이지 전체 스키마 검증이
// 아니다(파일 구조의 정본은 레거시 쪽이고, 엔진은 없는 키를 0 취급으로 견딘다).
const isPricingData = (v: unknown): v is PricingData => {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.menus)) return false;
  if (typeof o.transferCost !== 'object' || o.transferCost === null) return false;
  const std = o.menus.find((m: unknown): m is Record<string, unknown> => {
    if (typeof m !== 'object' || m === null) return false;
    const name = (m as { name?: unknown }).name;
    return typeof name === 'string' && name.toLowerCase() === 'standard';
  });
  if (std === undefined || !Array.isArray(std.setPrice)) return false;
  const rate = std.rate;
  return (
    (typeof rate === 'string' || typeof rate === 'number') &&
    !Number.isNaN(parseFloat(String(rate)))
  );
};

const kstToday = (): string =>
  new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * 지금 계산에 쓸 가격표. 라이브를 우선 시도하고 실패하면 물러난다 — 항상 값을 돌려준다.
 * 라우트 핸들러의 request.log 를 넘기면 실패가 pino 로그로 남는다.
 */
export const getFreshPricingData = async (
  log?: Pick<FastifyBaseLogger, 'warn'>,
): Promise<PricingSource> => {
  const now = Date.now();
  if (cached !== null && now - fetchedAt < TTL_MS) return cached;
  if (now - failedAt < TTL_MS) return cached ?? BUNDLED_PRICING;
  try {
    const url = process.env.PRICING_DATA_URL ?? DEFAULT_URL;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    const json: unknown = await res.json();
    if (!isPricingData(json)) throw new Error('pricing_data.json 형태가 예상과 다름');
    cached = { data: json, version: `live-${kstToday()}` };
    fetchedAt = now;
    return cached;
  } catch (err) {
    failedAt = now;
    log?.warn(
      { err },
      `라이브 가격표 조회 실패 — ${cached !== null ? '마지막 성공본' : '번들 스냅샷'}으로 계산`,
    );
    return cached ?? BUNDLED_PRICING;
  }
};
