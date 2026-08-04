import { z } from 'zod';
import {
  type BomQuoteConfigType,
  type BomQuoteExchangeRateSnapshotType,
  type BomQuoteExchangeRateStatusType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { getBomQuoteConfig } from './sp-config';

const KOREAEXIM_URL = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';
const EXCHANGE_RATE_CACHE_KEY = 'bom_quote_exchange_rate_usd';
const API_SEARCH_DAYS = 10;
const API_TIMEOUT_MS = 10_000;
// 역탐색 전체 예산 — API가 응답 없이 매달려도 관리자 [지금 갱신]이 이 이상 붙잡히지 않는다.
// (평시 빈 배열 응답은 수백 ms — 예산은 장애 시에만 발동한다)
const API_TOTAL_BUDGET_MS = 15_000;

// 오류 행은 cur_unit 등이 비어 있으므로 전 필드 optional 로 받고 result 코드를 먼저 해석한다.
const KoreaEximRow = z.object({
  result: z.union([z.number(), z.string()]).optional(),
  cur_unit: z.string().optional(),
  deal_bas_r: z.string().optional(),
  tts: z.string().optional(),
}).passthrough();

// 수출입은행 result 코드: 1=성공, 2=DATA코드 오류, 3=인증코드 오류, 4=일일 호출 한도 마감
const KOREAEXIM_RESULT_ERRORS: Record<number, string> = {
  2: '수출입은행 환율 API 요청 형식 오류(result=2) — data 파라미터를 확인하세요.',
  3: '수출입은행 환율 API 인증 실패(result=3) — KOREAEXIM_API_KEY 값을 확인하세요.',
  4: '수출입은행 환율 API 일일 호출 한도 초과(result=4) — 내일 자동 갱신에서 재시도됩니다.',
};

const ExchangeRateCache = z.object({
  source: z.literal('koreaexim'),
  currency: z.literal('USD'),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dealBasR: z.number().positive(),
  tts: z.number().positive(),
  fetchedAt: z.string().datetime(),
});
export type ExchangeRateCacheType = z.infer<typeof ExchangeRateCache>;

export interface BomQuoteRuntimeConfig extends BomQuoteConfigType {
  /** 수동 설정값이 아니라 이번 계산에 실제 적용할 실효 환율. */
  usdKrwRate: number | null;
  exchangeRateSnapshot: BomQuoteExchangeRateSnapshotType | null;
}

export interface ExchangeRateRefreshResult {
  cache: ExchangeRateCacheType | null;
  error: string | null;
}

function formatKstDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) throw new Error('KST 날짜를 계산하지 못했습니다.');
  return `${year}-${month}-${day}`;
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function calendarAgeDays(rateDate: string, today: string): number {
  const rate = Date.parse(`${rateDate}T00:00:00.000Z`);
  const current = Date.parse(`${today}T00:00:00.000Z`);
  return Math.max(0, Math.floor((current - rate) / 86_400_000));
}

function parseRate(value: string): number | null {
  const parsed = Number(value.replaceAll(',', '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}

// 통화 단위별 행 추출 공용부 — USD(BOM·PCB 공용)와 CNH(PCB 트랙 D2)가 같은 AP01
// 응답을 쓴다. 반환 shape 는 통화 리터럴만 다르므로 제네릭 파서로 뽑고 각 캐시
// 스키마가 리터럴을 못박는다.
async function fetchKoreaEximRateForDate(
  authKey: string,
  rateDate: string,
  curUnit: 'USD' | 'CNH',
  fetcher: typeof fetch,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<{ rateDate: string; dealBasR: number; tts: number; fetchedAt: string } | null> {
  const url = new URL(KOREAEXIM_URL);
  url.searchParams.set('authkey', authKey);
  url.searchParams.set('searchdate', rateDate.replaceAll('-', ''));
  url.searchParams.set('data', 'AP01');
  const response = await fetcher(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`수출입은행 환율 API HTTP ${String(response.status)}`);
  const payload: unknown = await response.json();
  const rows = z.array(KoreaEximRow).safeParse(payload);
  if (!rows.success) throw new Error('수출입은행 환율 API 응답 형식이 올바르지 않습니다.');
  // 인증 실패·한도 초과는 데이터 부재("고시 없음")로 오진되지 않게 코드로 먼저 판별한다.
  for (const row of rows.data) {
    const code = Number(row.result ?? 1);
    const message = KOREAEXIM_RESULT_ERRORS[code];
    if (message !== undefined) throw new Error(message);
  }
  const hit = rows.data.find((row) => (row.cur_unit ?? '').trim().toUpperCase() === curUnit);
  if (hit === undefined) return null; // 주말·공휴일·당일 고시 전에는 빈 배열 또는 해당 행 없음.
  const dealBasR = hit.deal_bas_r === undefined ? null : parseRate(hit.deal_bas_r);
  const tts = hit.tts === undefined ? null : parseRate(hit.tts);
  if (dealBasR === null || tts === null)
    throw new Error(`수출입은행 ${curUnit} 환율 값이 올바르지 않습니다.`);
  return { rateDate, dealBasR, tts, fetchedAt: new Date().toISOString() };
}

async function fetchKoreaEximUsdForDate(
  authKey: string,
  rateDate: string,
  fetcher: typeof fetch,
  timeoutMs: number = API_TIMEOUT_MS,
): Promise<ExchangeRateCacheType | null> {
  const parsed = await fetchKoreaEximRateForDate(authKey, rateDate, 'USD', fetcher, timeoutMs);
  if (parsed === null) return null;
  return { source: 'koreaexim', currency: 'USD', ...parsed };
}

export async function getCachedUsdExchangeRate(): Promise<ExchangeRateCacheType | null> {
  const row = await prisma.spConfig.findUnique({ where: { key: EXCHANGE_RATE_CACHE_KEY } });
  if (row === null) return null;
  try {
    const parsed = ExchangeRateCache.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function storeUsdExchangeRate(cache: ExchangeRateCacheType): Promise<void> {
  const value = JSON.stringify(cache);
  await prisma.spConfig.upsert({
    where: { key: EXCHANGE_RATE_CACHE_KEY },
    create: { key: EXCHANGE_RATE_CACHE_KEY, value },
    update: { value },
  });
}

/** 오늘(KST)부터 최근 영업일까지 역탐색해 USD 고시 환율을 캐시한다. */
export async function refreshKoreaEximUsdExchangeRate(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<ExchangeRateCacheType> {
  const authKey = process.env.KOREAEXIM_API_KEY?.trim();
  if (authKey === undefined || authKey === '') throw new Error('KOREAEXIM_API_KEY가 설정되지 않았습니다.');
  const today = formatKstDate(now);
  const deadline = Date.now() + API_TOTAL_BUDGET_MS;
  for (let offset = 0; offset < API_SEARCH_DAYS; offset += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`수출입은행 환율 API 응답 지연 — ${String(API_TOTAL_BUDGET_MS / 1_000)}초 예산을 초과했습니다. 마지막 정상 환율로 계속 동작합니다.`);
    }
    const cache = await fetchKoreaEximUsdForDate(
      authKey,
      shiftDate(today, -offset),
      fetcher,
      Math.min(API_TIMEOUT_MS, remainingMs),
    );
    if (cache !== null) {
      await storeUsdExchangeRate(cache);
      return cache;
    }
  }
  throw new Error(`최근 ${String(API_SEARCH_DAYS)}일 내 USD 고시 환율이 없습니다.`);
}

export function resolveUsdExchangeRate(
  config: BomQuoteConfigType,
  cache: ExchangeRateCacheType | null,
  today = formatKstDate(),
): BomQuoteExchangeRateSnapshotType | null {
  if (config.usdKrwRateMode === 'manual') {
    return config.usdKrwRate === null
      ? null
      : {
          mode: 'manual',
          source: 'manual',
          rateType: 'manual',
          sourceRate: config.usdKrwRate,
          safetyMarginPercent: 0,
          appliedRate: config.usdKrwRate,
          rateDate: null,
          fetchedAt: null,
          stale: false,
          fallbackReason: null,
        };
  }

  const stale = cache === null || calendarAgeDays(cache.rateDate, today) > config.usdKrwMaxAgeDays;
  if (stale && config.usdKrwRate !== null) {
    return {
      mode: 'auto',
      source: 'manual',
      rateType: 'manual',
      sourceRate: config.usdKrwRate,
      safetyMarginPercent: 0,
      appliedRate: config.usdKrwRate,
      rateDate: null,
      fetchedAt: null,
      stale: false,
      fallbackReason: 'manual-rate',
    };
  }
  if (cache === null) return null;

  const sourceRate = config.usdKrwAutoRateType === 'tts' ? cache.tts : cache.dealBasR;
  const appliedRate = roundRate(sourceRate * (1 + config.usdKrwSafetyMarginPercent / 100));
  return {
    mode: 'auto',
    source: 'koreaexim',
    rateType: config.usdKrwAutoRateType,
    sourceRate,
    safetyMarginPercent: config.usdKrwSafetyMarginPercent,
    appliedRate,
    rateDate: cache.rateDate,
    fetchedAt: cache.fetchedAt,
    stale,
    fallbackReason: stale ? 'stale-cache' : null,
  };
}

export async function getBomQuoteRuntimeConfig(): Promise<BomQuoteRuntimeConfig> {
  const [config, cache] = await Promise.all([getBomQuoteConfig(), getCachedUsdExchangeRate()]);
  const exchangeRateSnapshot = resolveUsdExchangeRate(config, cache);
  return {
    ...config,
    usdKrwRate: exchangeRateSnapshot?.appliedRate ?? null,
    exchangeRateSnapshot,
  };
}

export async function getBomQuoteExchangeRateStatus(
  config: BomQuoteConfigType,
  lastRefreshError: string | null = null,
): Promise<BomQuoteExchangeRateStatusType> {
  const cache = await getCachedUsdExchangeRate();
  return {
    apiConfigured: (process.env.KOREAEXIM_API_KEY?.trim().length ?? 0) > 0,
    cache: cache === null
      ? null
      : {
          rateDate: cache.rateDate,
          dealBasR: cache.dealBasR,
          tts: cache.tts,
          fetchedAt: cache.fetchedAt,
        },
    effective: resolveUsdExchangeRate(config, cache),
    lastRefreshError,
  };
}

function msUntilNextKstRefresh(now = new Date()): number {
  // 매일 12:10 KST(03:10 UTC): 당일 고시 전 빈 응답 가능성을 줄이고 호출량을 제한한다.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  let target = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 3, 10);
  if (target <= now.getTime()) target += 86_400_000;
  return target - now.getTime();
}

interface ExchangeRateLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** 서버 시작 시 1회 갱신하고 이후 매일 12:10 KST에 갱신한다. 실패는 캐시를 지우지 않는다. */
export function scheduleKoreaEximExchangeRateRefresh(log: ExchangeRateLogger): void {
  if ((process.env.KOREAEXIM_API_KEY?.trim().length ?? 0) === 0) {
    log.info('KOREAEXIM_API_KEY 미설정 — BOM 자동 환율은 캐시/수동값으로 동작합니다.');
    return;
  }
  const refresh = async (): Promise<void> => {
    try {
      const cache = await refreshKoreaEximUsdExchangeRate();
      log.info(`BOM USD 환율 갱신: ${cache.rateDate} / 기준 ${String(cache.dealBasR)} / TTS ${String(cache.tts)}`);
    } catch (error: unknown) {
      log.warn(`BOM USD 환율 갱신 실패 — 마지막 정상값 유지: ${error instanceof Error ? error.message : String(error)}`);
    }
    // PCB 트랙 CNH(위안화) — USD 실패와 독립(각자 마지막 정상값 유지, D2).
    try {
      const cnh = await refreshKoreaEximCnhExchangeRate();
      log.info(`PCB CNH 환율 갱신: ${cnh.rateDate} / 기준 ${String(cnh.dealBasR)} / TTS ${String(cnh.tts)}`);
    } catch (error: unknown) {
      log.warn(`PCB CNH 환율 갱신 실패 — 마지막 정상값 유지: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  void refresh();
  const scheduleNext = (): void => {
    const timer = setTimeout(() => {
      void refresh().finally(scheduleNext);
    }, msUntilNextKstRefresh());
    timer.unref();
  };
  scheduleNext();
}

// ═══════════════════════════════════════════════════════════════════════════
// PCB 파트너 트랙 통화쌍(KRW/USD/CNY) — docs/PCB_PARTNER_TRACK.md §6 D2.
// 정본 환율원은 위와 같은 수출입은행 AP01(CNH=역외위안 행)이고, 캐시는 sp_config 에
// USD 와 별도 키로 영속한다. 교차는 KRW 경유(tts 기준 — 송금 관점, 레거시 xpse 승계).
// 여기 환율은 "그 시점 제안값"이다 — 회신 환산·선정 박제로 행에 동결되면 그 값이 정본.
// ═══════════════════════════════════════════════════════════════════════════

const PCB_CNH_CACHE_KEY = 'pcb_exchange_rate_cnh';

const CnhExchangeRateCache = z.object({
  source: z.literal('koreaexim'),
  currency: z.literal('CNH'),
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dealBasR: z.number().positive(),
  tts: z.number().positive(),
  fetchedAt: z.string().datetime(),
});
export type CnhExchangeRateCacheType = z.infer<typeof CnhExchangeRateCache>;

export async function getCachedCnhExchangeRate(): Promise<CnhExchangeRateCacheType | null> {
  const row = await prisma.spConfig.findUnique({ where: { key: PCB_CNH_CACHE_KEY } });
  if (row === null) return null;
  try {
    const parsed = CnhExchangeRateCache.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function storeCnhExchangeRate(cache: CnhExchangeRateCacheType): Promise<void> {
  const value = JSON.stringify(cache);
  await prisma.spConfig.upsert({
    where: { key: PCB_CNH_CACHE_KEY },
    create: { key: PCB_CNH_CACHE_KEY, value },
    update: { value },
  });
}

/** 오늘(KST)부터 최근 영업일까지 역탐색해 CNH 고시 환율을 캐시한다(USD 흐름 미러). */
export async function refreshKoreaEximCnhExchangeRate(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<CnhExchangeRateCacheType> {
  const authKey = process.env.KOREAEXIM_API_KEY?.trim();
  if (authKey === undefined || authKey === '') throw new Error('KOREAEXIM_API_KEY가 설정되지 않았습니다.');
  const today = formatKstDate(now);
  const deadline = Date.now() + API_TOTAL_BUDGET_MS;
  for (let offset = 0; offset < API_SEARCH_DAYS; offset += 1) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`수출입은행 환율 API 응답 지연 — ${String(API_TOTAL_BUDGET_MS / 1_000)}초 예산을 초과했습니다. 마지막 정상 환율로 계속 동작합니다.`);
    }
    const parsed = await fetchKoreaEximRateForDate(
      authKey,
      shiftDate(today, -offset),
      'CNH',
      fetcher,
      Math.min(API_TIMEOUT_MS, remainingMs),
    );
    if (parsed !== null) {
      const cache: CnhExchangeRateCacheType = { source: 'koreaexim', currency: 'CNH', ...parsed };
      await storeCnhExchangeRate(cache);
      return cache;
    }
  }
  throw new Error(`최근 ${String(API_SEARCH_DAYS)}일 내 CNH 고시 환율이 없습니다.`);
}

/** PCB 통화쌍 교차 계산(순수) — KRW 경유, tts 기준, 소수 6자리 HALF_UP. 미준비 통화는 null. */
export function computePcbCrossRate(
  usdKrwTts: number | null,
  cnhKrwTts: number | null,
  from: 'KRW' | 'USD' | 'CNY',
  to: 'KRW' | 'USD' | 'CNY',
): number | null {
  if (from === to) return 1;
  const krwPer = { KRW: 1, USD: usdKrwTts, CNY: cnhKrwTts } as const;
  const fromKrw = krwPer[from];
  const toKrw = krwPer[to];
  if (fromKrw === null || toKrw === null) return null;
  return Math.round((fromKrw / toKrw) * 1_000_000) / 1_000_000;
}

export interface PcbExchangeRateResult {
  rate: number;
  /** 사용된 고시일(양쪽 쓰면 더 오래된 쪽 — 표시용). KRW↔KRW 는 null. */
  rateDate: string | null;
}

/** PCB 통화쌍 환율 조회 — 수출입은행 캐시 기반. 캐시 미준비(키 미설정 등)면 null. */
export async function getPcbExchangeRate(
  from: 'KRW' | 'USD' | 'CNY',
  to: 'KRW' | 'USD' | 'CNY',
): Promise<PcbExchangeRateResult | null> {
  if (from === to) return { rate: 1, rateDate: null };
  const needUsd = from === 'USD' || to === 'USD';
  const needCnh = from === 'CNY' || to === 'CNY';
  const [usd, cnh] = await Promise.all([
    needUsd ? getCachedUsdExchangeRate() : Promise.resolve(null),
    needCnh ? getCachedCnhExchangeRate() : Promise.resolve(null),
  ]);
  const rate = computePcbCrossRate(usd?.tts ?? null, cnh?.tts ?? null, from, to);
  if (rate === null) return null;
  const dates = [usd?.rateDate, cnh?.rateDate].filter((d): d is string => d !== undefined);
  const rateDate = dates.length === 0 ? null : (dates.sort()[0] ?? null);
  return { rate, rateDate };
}

/**
 * PCB 금액 반올림 — KRW 0자리·USD/CNY 2자리, HALF_UP(양수 전제).
 * ×100 후 부동소수 표현 오차(1.005×100=100.4999…)로 HALF_UP 이 깨지는 것을
 * 12자리 유효숫자 정규화로 보정한다(견적 금액 규모 ≪ 10^10 전제 — Decimal(15,2) 내).
 */
export function roundPcbAmount(amount: number, currency: 'KRW' | 'USD' | 'CNY'): number {
  const scale = currency === 'KRW' ? 1 : 100;
  return Math.round(Number((amount * scale).toPrecision(12))) / scale;
}
