// Mouser 카트 클라이언트(D20·D41) — fetch 를 막고 요청 모양·응답 해석·실패 접기를 고정한다.
// 실 API 는 e2e(bom-mouser-cart-handoff, MOUSER_E2E=1)가 맡는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mouserCartGet, mouserCartInsert, mouserCartReplace } from './supplier-order';

const cartBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  Errors: [],
  CartKey: 'ck-0001',
  CurrencyCode: 'KRW',
  CartItems: [
    { MouserPartNumber: '791-WR04X101JTL', Quantity: 2, UnitPrice: 156, ExtendedPrice: 312 },
    { MouserPartNumber: '791-WR04X103JTL', Quantity: 1, UnitPrice: 156, ExtendedPrice: 156 },
  ],
  TotalItemCount: 2,
  MerchandiseTotal: 468,
  ...over,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const lines = [
  { sku: '791-WR04X101JTL', qty: 2 },
  { sku: '791-WR04X103JTL', qty: 1 },
];

describe('supplier-order — Mouser 카트 클라이언트', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('MOUSER_ORDER_API_KEY', 'test-order-key');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('insert — 새 카트: items/insert 에 CartItems 만 싣고 CartKey·행·합계·items 를 돌려준다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(cartBody()));
    const result = await mouserCartInsert(lines);
    expect(result).toMatchObject({
      ok: true,
      supplier: 'mouser',
      cartKey: 'ck-0001',
      cartWebUrl: 'https://www.mouser.kr/Cart/',
      lineCount: 2,
      merchandiseTotal: 468,
      currencyCode: 'KRW',
      items: lines,
      errors: [],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/cart/items/insert?apiKey=test-order-key');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      CartItems: [
        { MouserPartNumber: '791-WR04X101JTL', Quantity: 2 },
        { MouserPartNumber: '791-WR04X103JTL', Quantity: 1 },
      ],
    });
  });

  it('replace — 같은 CartKey 전체 교체: POST /api/v1/cart 에 CartKey 를 싣는다(D41 재충전)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(cartBody()));
    const result = await mouserCartReplace('ck-0001', lines);
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/cart\?apiKey=test-order-key$/);
    expect(JSON.parse(init.body as string)).toMatchObject({ CartKey: 'ck-0001' });
  });

  it('get — GET /api/v1/cart?cartKey= 로 내용(items)을 읽는다', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(cartBody()));
    const result = await mouserCartGet('ck-0001');
    expect(result).toEqual({
      ok: true,
      cart: {
        cartKey: 'ck-0001',
        lineCount: 2,
        merchandiseTotal: 468,
        currencyCode: 'KRW',
        items: lines,
        errors: [],
      },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/cart?cartKey=ck-0001&apiKey=test-order-key');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('get — 없는 키도 Mouser 는 빈 카트 200 을 주므로 ok+0행으로 읽힌다(존재 증명 아님)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(cartBody({ CartItems: [], TotalItemCount: 0, MerchandiseTotal: 0 })),
    );
    const result = await mouserCartGet('ck-gone');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cart.lineCount).toBe(0);
      expect(result.cart.items).toEqual([]);
    }
  });

  it('insert/replace — 키만 오고 담긴 행이 0 이면 실패로 접는다(행 거부 사유를 잇는다)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        cartBody({
          CartItems: [],
          TotalItemCount: 0,
          MerchandiseTotal: 0,
          Errors: [{ Code: 'InvalidPartNumber', Message: '999-NOPE not found' }],
        }),
      ),
    );
    const result = await mouserCartInsert([{ sku: '999-NOPE', qty: 1 }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('999-NOPE not found');
  });

  it('CartKey 없는 응답 — Errors 를 실패 사유로, 없으면 형식 상이', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ Errors: [{ Code: 'Unauthorized', Message: 'bad key' }] }),
    );
    const bad = await mouserCartInsert(lines);
    expect(bad).toMatchObject({ ok: false, supplier: 'mouser' });
    if (!bad.ok) expect(bad.error).toContain('bad key');

    fetchMock.mockResolvedValueOnce(jsonResponse({ hello: 'world' }));
    const odd = await mouserCartInsert(lines);
    expect(odd.ok).toBe(false);
    if (!odd.ok) expect(odd.error).toBe('CartKey 없음(응답 형식 상이)');
  });

  it('HTTP 오류·네트워크 예외 — HTTP n / 예외 메시지', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ Errors: [] }, 500));
    const http = await mouserCartGet('ck');
    expect(http).toEqual({ ok: false, error: 'HTTP 500' });

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    const net = await mouserCartReplace('ck', lines);
    expect(net).toEqual({ ok: false, supplier: 'mouser', error: 'ECONNRESET' });
  });

  it('주문 키 미설정 — 호출 없이 실패', async () => {
    vi.stubEnv('MOUSER_ORDER_API_KEY', '');
    const result = await mouserCartInsert(lines);
    expect(result).toEqual({ ok: false, supplier: 'mouser', error: 'MOUSER_ORDER_API_KEY 미설정' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
