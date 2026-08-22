// ── DigiKey 3-legged OAuth 연결(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) ───────────────────
// Barcoding API 는 공식 문구 "Only 3-legged OAuth" — 파츠엔진의 client_credentials 토큰으로는 401.
// 관리자가 [DigiKey 연결]로 DigiKey 로그인·승인 → 콜백 code 교환 → access(≈10분)·refresh(90일, 갱신 시 회전)
// 토큰을 sp_config 에 보관하고 호출 전에 자동 갱신한다. 환경(로컬/운영)마다 각자 연결한다 — refresh 는
// 회전하므로 두 환경이 한 토큰을 나눠 쓰면 한쪽이 끊긴다.
import { randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { normalizeSupplierBarcode } from './supplier-barcode';

const CONFIG_KEY = 'digikey_oauth';
const STATE_KEY = 'digikey_oauth_state';
const STATE_TTL_MS = 10 * 60_000;
const ACCESS_SKEW_MS = 60_000;

const DIGIKEY_BASE_URL = (): string => process.env.DIGIKEY_BASE_URL ?? 'https://api.digikey.com';
const clientId = (): string => process.env.DIGIKEY_CLIENT_ID ?? '';
const clientSecret = (): string => process.env.DIGIKEY_CLIENT_SECRET ?? '';
const redirectUri = (): string => process.env.DIGIKEY_OAUTH_REDIRECT_URI ?? '';
const localeSite = (): string => process.env.DIGIKEY_LOCALE_SITE ?? 'KR';

export const digikeyOauthConfigured = (): boolean =>
  clientId() !== '' && clientSecret() !== '' && redirectUri() !== '';

export interface DigikeyOauthTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connectedAt: string;
  connectedBy: string;
  lastRefreshAt: string | null;
  lastError: string | null;
}

const readTokens = async (): Promise<DigikeyOauthTokens | null> => {
  const row = await prisma.spConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (row === null) return null;
  try {
    const parsed = JSON.parse(row.value) as Partial<DigikeyOauthTokens>;
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string') return null;
    return {
      accessToken: parsed.accessToken,
      accessExpiresAt: parsed.accessExpiresAt ?? new Date(0).toISOString(),
      refreshToken: parsed.refreshToken,
      refreshExpiresAt: parsed.refreshExpiresAt ?? new Date(0).toISOString(),
      connectedAt: parsed.connectedAt ?? new Date(0).toISOString(),
      connectedBy: parsed.connectedBy ?? '',
      lastRefreshAt: parsed.lastRefreshAt ?? null,
      lastError: parsed.lastError ?? null,
    };
  } catch {
    return null;
  }
};

const writeTokens = async (tokens: DigikeyOauthTokens): Promise<void> => {
  const value = JSON.stringify(tokens);
  await prisma.spConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value },
    update: { value },
  });
};

export interface DigikeyConnectionStatus {
  configured: boolean;
  redirectUri: string;
  connected: boolean;
  connectedAt: string | null;
  connectedBy: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  lastRefreshAt: string | null;
  lastError: string | null;
}

export const getDigikeyConnectionStatus = async (): Promise<DigikeyConnectionStatus> => {
  const tokens = await readTokens();
  return {
    configured: digikeyOauthConfigured(),
    redirectUri: redirectUri(),
    connected: tokens !== null && new Date(tokens.refreshExpiresAt).getTime() > Date.now(),
    connectedAt: tokens?.connectedAt ?? null,
    connectedBy: tokens?.connectedBy ?? null,
    accessExpiresAt: tokens?.accessExpiresAt ?? null,
    refreshExpiresAt: tokens?.refreshExpiresAt ?? null,
    lastRefreshAt: tokens?.lastRefreshAt ?? null,
    lastError: tokens?.lastError ?? null,
  };
};

export const disconnectDigikey = async (): Promise<void> => {
  await prisma.spConfig.deleteMany({ where: { key: { in: [CONFIG_KEY, STATE_KEY] } } });
};

/** [연결] 클릭 — 단일 대기 state(10분)를 만들고 DigiKey 승인 URL 을 돌려준다. */
export const startDigikeyOauth = async (
  mbId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: 'NOT_CONFIGURED' }> => {
  if (!digikeyOauthConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
  const state = randomBytes(24).toString('hex');
  const value = JSON.stringify({ state, mbId, createdAt: new Date().toISOString() });
  await prisma.spConfig.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value },
    update: { value },
  });
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
  });
  return { ok: true, url: `${DIGIKEY_BASE_URL()}/v1/oauth2/authorize?${params.toString()}` };
};

const consumeOauthState = async (state: string): Promise<{ mbId: string } | null> => {
  const row = await prisma.spConfig.findUnique({ where: { key: STATE_KEY } });
  if (row === null) return null;
  await prisma.spConfig.delete({ where: { key: STATE_KEY } }).catch(() => undefined);
  try {
    const pending = JSON.parse(row.value) as { state?: string; mbId?: string; createdAt?: string };
    if (pending.state !== state || typeof pending.mbId !== 'string') return null;
    if (Date.now() - new Date(pending.createdAt ?? 0).getTime() > STATE_TTL_MS) return null;
    return { mbId: pending.mbId };
  } catch {
    return null;
  }
};

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

const postToken = async (
  form: Record<string, string>,
): Promise<{ ok: true; body: TokenResponse } | { ok: false; error: string }> => {
  try {
    const res = await fetch(`${DIGIKEY_BASE_URL()}/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
    });
    const body = (await res.json().catch(() => null)) as TokenResponse | null;
    if (!res.ok || body === null || typeof body.access_token !== 'string') {
      const detail = body?.error_description ?? body?.error ?? `HTTP ${String(res.status)}`;
      return { ok: false, error: detail };
    }
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '요청 실패' };
  }
};

const tokensFromResponse = (
  body: TokenResponse,
  previous: Pick<DigikeyOauthTokens, 'connectedAt' | 'connectedBy'> | null,
  now: number,
): DigikeyOauthTokens => ({
  accessToken: body.access_token ?? '',
  accessExpiresAt: new Date(now + (body.expires_in ?? 600) * 1000).toISOString(),
  refreshToken: body.refresh_token ?? '',
  refreshExpiresAt: new Date(now + (body.refresh_token_expires_in ?? 90 * 86_400) * 1000).toISOString(),
  connectedAt: previous?.connectedAt ?? new Date(now).toISOString(),
  connectedBy: previous?.connectedBy ?? '',
  lastRefreshAt: previous === null ? null : new Date(now).toISOString(),
  lastError: null,
});

export type OauthCallbackResult =
  | { ok: true; mbId: string }
  | { ok: false; error: 'NOT_CONFIGURED' | 'INVALID_STATE' | 'EXCHANGE_FAILED'; detail?: string };

/** 콜백 — state 검증 후 code 를 토큰으로 교환해 보관한다. */
export const completeDigikeyOauth = async (code: string, state: string): Promise<OauthCallbackResult> => {
  if (!digikeyOauthConfigured()) return { ok: false, error: 'NOT_CONFIGURED' };
  const pending = await consumeOauthState(state);
  if (pending === null) return { ok: false, error: 'INVALID_STATE' };
  const result = await postToken({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  if (!result.ok) return { ok: false, error: 'EXCHANGE_FAILED', detail: result.error };
  const now = Date.now();
  const tokens = tokensFromResponse(result.body, null, now);
  tokens.connectedBy = pending.mbId;
  await writeTokens(tokens);
  return { ok: true, mbId: pending.mbId };
};

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: 'NOT_CONNECTED' | 'REFRESH_EXPIRED' | 'REFRESH_FAILED'; detail?: string };

/** 호출용 access token — 만료(1분 여유) 전이면 그대로, 아니면 refresh 로 갱신해 보관. */
export const getDigikeyAccessToken = async (): Promise<AccessTokenResult> => {
  const tokens = await readTokens();
  if (tokens === null) return { ok: false, error: 'NOT_CONNECTED' };
  const now = Date.now();
  if (new Date(tokens.accessExpiresAt).getTime() - ACCESS_SKEW_MS > now) {
    return { ok: true, accessToken: tokens.accessToken };
  }
  if (new Date(tokens.refreshExpiresAt).getTime() <= now) {
    return { ok: false, error: 'REFRESH_EXPIRED' };
  }
  const result = await postToken({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  if (!result.ok) {
    await writeTokens({ ...tokens, lastError: `refresh: ${result.error}` });
    return { ok: false, error: 'REFRESH_FAILED', detail: result.error };
  }
  const next = tokensFromResponse(result.body, tokens, now);
  if (next.refreshToken === '') next.refreshToken = tokens.refreshToken; // 회전 안 주면 유지
  await writeTokens(next);
  return { ok: true, accessToken: next.accessToken };
};

// ── Barcoding API v3 — 2D(ECIA) 는 RS/GS/EOT 를 U+241E/U+241D/U+2404 로 바꿔 경로에 싣는다 ──
export interface DigikeyBarcodeLookup {
  kind: '2d' | '1d';
  digiKeyPartNumber: string | null;
  manufacturerPartNumber: string | null;
  manufacturerName: string | null;
  productDescription: string | null;
  quantity: number | null;
  salesorderId: number | null;
  invoiceId: number | null;
  purchaseOrder: string | null;
  countryOfOrigin: string | null;
  lotCode: string | null;
  dateCode: string | null;
}

export type DigikeyLookupResult =
  | { ok: true; lookup: DigikeyBarcodeLookup }
  | {
      ok: false;
      error: 'NOT_CONNECTED' | 'REFRESH_EXPIRED' | 'REFRESH_FAILED' | 'LOOKUP_FAILED';
      detail?: string;
    };

const RS = String.fromCharCode(0x1e);
const GS = String.fromCharCode(0x1d);
const EOT = String.fromCharCode(0x04);

/** DigiKey 가 요구하는 2D 인코딩 — 제어문자 → 제어 그림 문자. */
export const encodeDigikey2dBarcode = (normalized: string): string =>
  normalized.split(RS).join('␞').split(GS).join('␝').split(EOT).join('␄');

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const digikeyBarcodeLookup = async (rawBarcode: string): Promise<DigikeyLookupResult> => {
  const token = await getDigikeyAccessToken();
  if (!token.ok) return token;
  const normalized = normalizeSupplierBarcode(rawBarcode);
  const is2d = normalized.startsWith(`[)>${RS}06${GS}`) || normalized.startsWith(`>[)>06${GS}`);
  const path = is2d
    ? `/Barcoding/v3/Product2DBarcodes/${encodeURIComponent(encodeDigikey2dBarcode(normalized))}`
    : `/Barcoding/v3/ProductBarcodes/${encodeURIComponent(normalized)}`;
  try {
    const res = await fetch(`${DIGIKEY_BASE_URL()}${path}`, {
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        'x-digikey-client-id': clientId(),
        'x-digikey-locale-site': localeSite(),
        accept: 'application/json',
      },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || body === null) {
      const detail =
        typeof body?.ErrorMessage === 'string' ? body.ErrorMessage : `HTTP ${String(res.status)}`;
      return { ok: false, error: 'LOOKUP_FAILED', detail };
    }
    return {
      ok: true,
      lookup: {
        kind: is2d ? '2d' : '1d',
        digiKeyPartNumber: str(body.DigiKeyPartNumber),
        manufacturerPartNumber: str(body.ManufacturerPartNumber),
        manufacturerName: str(body.ManufacturerName),
        productDescription: str(body.ProductDescription),
        quantity: int(body.Quantity),
        salesorderId: int(body.SalesorderId),
        invoiceId: int(body.InvoiceId),
        purchaseOrder: str(body.PurchaseOrder),
        countryOfOrigin: str(body.CountryOfOrigin),
        lotCode: str(body.LotCode),
        dateCode: str(body.DateCode),
      },
    };
  } catch (err) {
    return { ok: false, error: 'LOOKUP_FAILED', detail: err instanceof Error ? err.message : '요청 실패' };
  }
};
