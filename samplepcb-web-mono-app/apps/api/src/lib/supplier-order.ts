// ── 외부공급사 발주 클라이언트(D20 §6.3 · D41 §6.34, docs/SMARTBOM_PARTNER_RFQ.md) ──────
// 범위 = "카트/리스트까지"(레거시 최종형 승계) — 실결제는 구매담당이 공급사 사이트에서.
//  - Mouser : POST {base}/api/v1/cart/items/insert?apiKey={주문키}  새 카트(주문 키는 검색 키와 별개)
//             POST {base}/api/v1/cart?apiKey=                      전체 교체 — 같은 CartKey 재충전(D41)
//             GET  {base}/api/v1/cart?cartKey=&apiKey=             상태 확인(D41)
//  - DigiKey: POST https://www.digikey.com/mylists/api/thirdparty  (무인증, single-use URL)
// 판단 없는 실행 1콜이라 sp-node 직접 호출(sp-engine 경계 무관).
//
// D41 실측(2026-08-22): Mouser API 카트는 웹의 '현재 장바구니'가 아니라 계정의 별도 카트이고,
// 담긴 지 하루쯤 지나면 비어 있었다(PO 154·165). GET 은 **존재하지 않는 키에도 빈 카트를 200 으로
// 에코**하므로 "빈 카트" 응답은 존재 증명이 아니다 — 상태는 행 대조(bom-po-external)로 본다.
// POST /cart 는 임의·소멸 키에도 그 키로 카트를 (되)살리므로 발주서당 CartKey 를 고정할 수 있다.

export interface ExternalOrderLine {
  sku: string; // 공급사 part number(MouserPartNumber / requestedPartNumber)
  qty: number;
}

/** Mouser 카트 응답 요약 — 실행(insert/replace)·확인(get)이 같은 모양으로 본다. */
export interface MouserCartSnapshot {
  cartKey: string;
  lineCount: number;
  merchandiseTotal: number | null;
  currencyCode: string | null;
  items: ExternalOrderLine[]; // 실제 담긴 행(MouserPartNumber·Quantity)
  errors: string[]; // 공급사가 행 단위로 거부한 사유(품절·SKU 오류 등)
}

export type MouserCartResult = { ok: true; cart: MouserCartSnapshot } | { ok: false; error: string };

export type ExternalExecuteResult =
  | {
      ok: true;
      supplier: 'mouser';
      cartKey: string;
      cartWebUrl: string; // 구매담당 안내용(로그인 계정 장바구니 화면)
      lineCount: number;
      merchandiseTotal: number | null;
      currencyCode: string | null;
      items: ExternalOrderLine[];
      errors: string[];
    }
  | {
      ok: true;
      supplier: 'digikey';
      listName: string;
      singleUseUrl: string; // 1회용 — 열면 담당자 본인 계정 myLists 에 담김
      lineCount: number;
    }
  | { ok: false; supplier: string; error: string };

const MOUSER_BASE_URL = process.env.MOUSER_ORDER_BASE_URL ?? 'https://api.mouser.com';
/** 구매담당 안내용 — 로그인 계정의 장바구니 화면. API 카트는 여기의 '현재 장바구니'가 아니라
 *  '저장한 장바구니' 쪽에 선다(D41) — 화면이 CartKey 와 함께 안내한다. */
export const MOUSER_CART_WEB_URL = 'https://www.mouser.kr/Cart/';

const mouserApiKey = (): string | null => {
  const apiKey = process.env.MOUSER_ORDER_API_KEY;
  return apiKey === undefined || apiKey.trim() === '' ? null : apiKey;
};

const mouserErrors = (body: Record<string, unknown>): string[] =>
  Array.isArray(body.Errors)
    ? body.Errors.map((e) => JSON.stringify(e)).filter((msg) => msg !== '{}')
    : [];

const parseMouserCart = (body: Record<string, unknown>): MouserCartSnapshot | null => {
  const cartKey = typeof body.CartKey === 'string' ? body.CartKey : null;
  if (cartKey === null) return null;
  const rawItems = Array.isArray(body.CartItems) ? body.CartItems : [];
  const items: ExternalOrderLine[] = [];
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const sku = typeof item.MouserPartNumber === 'string' ? item.MouserPartNumber : '';
    const qty = typeof item.Quantity === 'number' ? item.Quantity : Number(item.Quantity);
    if (sku === '' || !Number.isFinite(qty)) continue;
    items.push({ sku, qty });
  }
  return {
    cartKey,
    lineCount: rawItems.length,
    merchandiseTotal: typeof body.MerchandiseTotal === 'number' ? body.MerchandiseTotal : null,
    currencyCode: typeof body.CurrencyCode === 'string' ? body.CurrencyCode : null,
    items,
    errors: mouserErrors(body),
  };
};

/** 공통 호출 — 키 미설정·HTTP 오류·형식 상이를 한 모양의 실패로 접는다. */
async function mouserCartCall(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string },
): Promise<MouserCartResult> {
  const apiKey = mouserApiKey();
  if (apiKey === null) return { ok: false, error: 'MOUSER_ORDER_API_KEY 미설정' };
  const sep = path.includes('?') ? '&' : '?';
  try {
    const res = await fetch(
      `${MOUSER_BASE_URL}${path}${sep}apiKey=${encodeURIComponent(apiKey)}`,
      {
        method: init.method,
        headers: {
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      },
    );
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || body === null) {
      return { ok: false, error: `HTTP ${String(res.status)}` };
    }
    // Mouser 는 오류를 200 응답의 Errors 배열로도 준다(행 단위 거부 포함).
    const cart = parseMouserCart(body);
    if (cart === null) {
      const errors = mouserErrors(body);
      return {
        ok: false,
        error: errors.length > 0 ? errors.join(' · ') : 'CartKey 없음(응답 형식 상이)',
      };
    }
    return { ok: true, cart };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '요청 실패' };
  }
}

const toExecuteResult = (result: MouserCartResult): ExternalExecuteResult => {
  if (!result.ok) return { ok: false, supplier: 'mouser', error: result.error };
  const { cart } = result;
  // 키는 받았는데 담긴 행이 0 이면 실패로 본다 — "카트 담김 0행"은 구매담당에게 성공이 아니다.
  if (cart.lineCount === 0) {
    return {
      ok: false,
      supplier: 'mouser',
      error:
        cart.errors.length > 0 ? cart.errors.join(' · ') : '담긴 행이 없습니다(공급사가 전 행을 거부)',
    };
  }
  return {
    ok: true,
    supplier: 'mouser',
    cartKey: cart.cartKey,
    cartWebUrl: MOUSER_CART_WEB_URL,
    lineCount: cart.lineCount,
    merchandiseTotal: cart.merchandiseTotal,
    currencyCode: cart.currencyCode,
    items: cart.items,
    errors: cart.errors,
  };
};

const toCartItems = (lines: ExternalOrderLine[]): { MouserPartNumber: string; Quantity: number }[] =>
  lines.map((line) => ({ MouserPartNumber: line.sku, Quantity: line.qty }));

/** Mouser 카트 담기 — 새 카트 생성(우리 계정), 응답의 CartKey·합계·행 오류를 박제용으로 반환. */
export async function mouserCartInsert(lines: ExternalOrderLine[]): Promise<ExternalExecuteResult> {
  return toExecuteResult(
    await mouserCartCall('/api/v1/cart/items/insert', {
      method: 'POST',
      body: JSON.stringify({ CartItems: toCartItems(lines) }),
    }),
  );
}

/** Mouser 카트 재충전(D41) — 같은 CartKey 의 내용을 발주 품목으로 **전체 교체**한다(POST /cart,
 *  "요청에 없는 품번은 삭제"). 사라진 키도 같은 키로 되살아나므로 발주서당 CartKey 가 고정된다. */
export async function mouserCartReplace(
  cartKey: string,
  lines: ExternalOrderLine[],
): Promise<ExternalExecuteResult> {
  return toExecuteResult(
    await mouserCartCall('/api/v1/cart', {
      method: 'POST',
      body: JSON.stringify({ CartKey: cartKey, CartItems: toCartItems(lines) }),
    }),
  );
}

/** Mouser 카트 조회(D41) — ⚠ 없는 키도 빈 카트를 200 으로 돌려주므로 "존재"가 아니라 "내용"을 본다. */
export async function mouserCartGet(cartKey: string): Promise<MouserCartResult> {
  return mouserCartCall(`/api/v1/cart?cartKey=${encodeURIComponent(cartKey)}`, { method: 'GET' });
}

/** DigiKey third-party 리스트 — 무인증. single-use URL 을 발급한다(1회용 — 재발급 가능). */
export async function digikeyThirdPartyList(
  lines: ExternalOrderLine[],
): Promise<ExternalExecuteResult> {
  const listName = `SmartBOM-${new Date().toISOString().slice(0, 19).replaceAll(/[-:T]/g, '')}`;
  try {
    const res = await fetch(
      `https://www.digikey.com/mylists/api/thirdparty?listName=${encodeURIComponent(listName)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          lines.map((line) => ({
            requestedPartNumber: line.sku,
            quantities: [{ quantity: line.qty }],
          })),
        ),
      },
    );
    const bodyStr = await res.text();
    if (!res.ok) {
      return { ok: false, supplier: 'digikey', error: `HTTP ${String(res.status)} ${bodyStr.slice(0, 200)}` };
    }
    // 응답이 "url" JSON 문자열 또는 {singleUseUrl:...} 등으로 섞여 와 http 부터 추출(레거시 검증 방식).
    const idx = bodyStr.indexOf('http');
    if (idx < 0) {
      return { ok: false, supplier: 'digikey', error: `URL 없음: ${bodyStr.slice(0, 200)}` };
    }
    const singleUseUrl = bodyStr.slice(idx).replace(/["}\s]+$/, '');
    return { ok: true, supplier: 'digikey', listName, singleUseUrl, lineCount: lines.length };
  } catch (err) {
    return { ok: false, supplier: 'digikey', error: err instanceof Error ? err.message : '요청 실패' };
  }
}
