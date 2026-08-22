// DigiKey 3-legged OAuth(D42) — prisma(sp_config)·fetch 를 막고 state·교환·갱신·만료·2D 인코딩을 고정한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('./prisma', () => ({
  prisma: {
    spConfig: {
      findUnique: ({ where }: { where: { key: string } }) =>
        Promise.resolve(store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null),
      upsert: ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        store.set(where.key, create.value);
        return Promise.resolve({ key: where.key, value: create.value });
      },
      delete: ({ where }: { where: { key: string } }) => {
        store.delete(where.key);
        return Promise.resolve({});
      },
      deleteMany: ({ where }: { where: { key: { in: string[] } } }) => {
        for (const key of where.key.in) store.delete(key);
        return Promise.resolve({ count: 1 });
      },
    },
  },
}));

import {
  completeDigikeyOauth,
  digikeyBarcodeLookup,
  digikeyOauthConfigured,
  encodeDigikey2dBarcode,
  getDigikeyAccessToken,
  getDigikeyConnectionStatus,
  startDigikeyOauth,
} from './digikey-oauth';

const RS = String.fromCharCode(0x1e);
const GS = String.fromCharCode(0x1d);
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('digikey-oauth — 3-legged 연결', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    store.clear();
    vi.stubEnv('DIGIKEY_CLIENT_ID', 'cid-test');
    vi.stubEnv('DIGIKEY_CLIENT_SECRET', 'sec-test');
    vi.stubEnv('DIGIKEY_OAUTH_REDIRECT_URI', 'https://local-web.samplepcb.co.kr/api/admin/digikey/oauth/callback');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('설정 없으면 시작 불가, 있으면 authorize URL(client_id·redirect_uri·state)과 단일 대기 state', async () => {
    vi.stubEnv('DIGIKEY_CLIENT_ID', '');
    expect(digikeyOauthConfigured()).toBe(false);
    expect(await startDigikeyOauth('admin1')).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
    vi.stubEnv('DIGIKEY_CLIENT_ID', 'cid-test');
    const started = await startDigikeyOauth('admin1');
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe('https://api.digikey.com/v1/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-test');
    expect(url.searchParams.get('redirect_uri')).toBe('https://local-web.samplepcb.co.kr/api/admin/digikey/oauth/callback');
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{48}$/);
    expect((await getDigikeyConnectionStatus()).connected).toBe(false);
  });

  it('콜백 — 잘못된 state 는 INVALID_STATE(교환 호출 없음), 맞으면 code 교환·토큰 보관·state 소진', async () => {
    const started = await startDigikeyOauth('admin1');
    if (!started.ok) throw new Error('start');
    const state = new URL(started.url).searchParams.get('state') ?? '';
    expect(await completeDigikeyOauth('code-x', 'wrong')).toEqual({ ok: false, error: 'INVALID_STATE' });
    expect(fetchMock).not.toHaveBeenCalled();
    // state 는 한 번 검사되면 소진 — 다시 시작해야 한다
    const again = await startDigikeyOauth('admin1');
    if (!again.ok) throw new Error('start2');
    const state2 = new URL(again.url).searchParams.get('state') ?? '';
    expect(state2).not.toBe(state);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 599, refresh_token_expires_in: 7776000, token_type: 'Bearer' }),
    );
    const done = await completeDigikeyOauth('code-1', state2);
    expect(done).toEqual({ ok: true, mbId: 'admin1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.digikey.com/v1/oauth2/token');
    const form = new URLSearchParams(init.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('redirect_uri')).toBe('https://local-web.samplepcb.co.kr/api/admin/digikey/oauth/callback');
    const status = await getDigikeyConnectionStatus();
    expect(status).toMatchObject({ configured: true, connected: true, connectedBy: 'admin1', lastError: null });
    expect(await getDigikeyAccessToken()).toEqual({ ok: true, accessToken: 'acc-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // 유효한 access 는 갱신 없이 그대로
  });

  it('갱신 — access 만료면 refresh 로 새 토큰(회전) 보관, refresh 만료면 REFRESH_EXPIRED, 실패는 lastError', async () => {
    const connected = {
      accessToken: 'acc-old', accessExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: 'ref-old', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      connectedAt: new Date().toISOString(), connectedBy: 'admin1', lastRefreshAt: null, lastError: null,
    };
    store.set('digikey_oauth', JSON.stringify(connected));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ access_token: 'acc-new', refresh_token: 'ref-new', expires_in: 599, refresh_token_expires_in: 7776000 }),
    );
    expect(await getDigikeyAccessToken()).toEqual({ ok: true, accessToken: 'acc-new' });
    const form = new URLSearchParams((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('ref-old');
    expect(JSON.parse(store.get('digikey_oauth') ?? '{}')).toMatchObject({ accessToken: 'acc-new', refreshToken: 'ref-new', connectedBy: 'admin1' });

    store.set('digikey_oauth', JSON.stringify({ ...connected, refreshExpiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(await getDigikeyAccessToken()).toEqual({ ok: false, error: 'REFRESH_EXPIRED' });

    store.set('digikey_oauth', JSON.stringify(connected));
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant', error_description: 'revoked' }, 400));
    const failed = await getDigikeyAccessToken();
    expect(failed).toEqual({ ok: false, error: 'REFRESH_FAILED', detail: 'revoked' });
    expect((await getDigikeyConnectionStatus()).lastError).toBe('refresh: revoked');
  });

  it('Barcoding 조회 — 미연결은 NOT_CONNECTED, 2D 는 RS/GS 를 ␞/␝ 로 인코딩해 Product2DBarcodes, 1D 는 ProductBarcodes', async () => {
    expect(await digikeyBarcodeLookup('296-LM358BIDDFRCT-ND')).toEqual({ ok: false, error: 'NOT_CONNECTED' });
    store.set('digikey_oauth', JSON.stringify({
      accessToken: 'acc-1', accessExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      refreshToken: 'ref-1', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      connectedAt: new Date().toISOString(), connectedBy: 'admin1', lastRefreshAt: null, lastError: null,
    }));
    const label = `[)>${RS}06${GS}P296-LM358BIDDFRCT-ND${GS}1PLM358BIDDFR${GS}Q10`;
    expect(encodeDigikey2dBarcode(label)).toBe('[)>␞06␝P296-LM358BIDDFRCT-ND␝1PLM358BIDDFR␝Q10');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ DigiKeyPartNumber: '296-LM358BIDDFRCT-ND', ManufacturerPartNumber: 'LM358BIDDFR', ManufacturerName: 'Texas Instruments', ProductDescription: 'IC OPAMP', Quantity: 10, SalesorderId: 72991337, InvoiceId: 85781337, PurchaseOrder: '', CountryOfOrigin: 'PH', LotCode: null, DateCode: '2534' }),
    );
    const two = await digikeyBarcodeLookup(label);
    expect(two).toMatchObject({ ok: true, lookup: { kind: '2d', digiKeyPartNumber: '296-LM358BIDDFRCT-ND', manufacturerPartNumber: 'LM358BIDDFR', quantity: 10, salesorderId: 72991337, invoiceId: 85781337, purchaseOrder: null, countryOfOrigin: 'PH', lotCode: null, dateCode: '2534' } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.digikey.com/Barcoding/v3/Product2DBarcodes/${encodeURIComponent('[)>␞06␝P296-LM358BIDDFRCT-ND␝1PLM358BIDDFR␝Q10')}`);
    expect((init.headers as Record<string, string>)['x-digikey-client-id']).toBe('cid-test');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer acc-1');

    fetchMock.mockResolvedValueOnce(jsonResponse({ DigiKeyPartNumber: '296-LM358BIDDFRCT-ND', ManufacturerPartNumber: 'LM358BIDDFR', Quantity: 25 }));
    const one = await digikeyBarcodeLookup('296-LM358BIDDFRCT-ND');
    expect(one).toMatchObject({ ok: true, lookup: { kind: '1d', quantity: 25, salesorderId: null } });
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe('https://api.digikey.com/Barcoding/v3/ProductBarcodes/296-LM358BIDDFRCT-ND');

    fetchMock.mockResolvedValueOnce(jsonResponse({ ErrorMessage: 'Invalid barcode' }, 404));
    expect(await digikeyBarcodeLookup('nope')).toEqual({ ok: false, error: 'LOOKUP_FAILED', detail: 'Invalid barcode' });
  });
});
