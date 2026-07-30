// ── 외부공급사 발주 클라이언트(D20, docs/SMARTBOM_PARTNER_RFQ.md §6.3) ────────
// 범위 = "카트/리스트까지"(레거시 최종형 승계) — 실결제는 구매담당이 공급사 사이트에서.
//  - Mouser : POST {base}/api/v1/cart/items/insert?apiKey={주문키}  (주문 키는 검색 키와 별개)
//  - DigiKey: POST https://www.digikey.com/mylists/api/thirdparty  (무인증, single-use URL)
// 판단 없는 실행 1콜이라 sp-node 직접 호출(sp-engine 경계 무관).

export interface ExternalOrderLine {
  sku: string; // 공급사 part number(MouserPartNumber / requestedPartNumber)
  qty: number;
}

export type ExternalExecuteResult =
  | {
      ok: true;
      supplier: 'mouser';
      cartKey: string;
      cartWebUrl: string; // 구매담당 안내용(로그인 계정 카트)
      lineCount: number;
      merchandiseTotal: number | null;
      currencyCode: string | null;
      errors: string[]; // 공급사가 행 단위로 거부한 사유(품절·SKU 오류 등)
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

/** Mouser 카트 담기 — 새 카트 생성(우리 계정), 응답의 CartKey·합계·행 오류를 박제용으로 반환. */
export async function mouserCartInsert(lines: ExternalOrderLine[]): Promise<ExternalExecuteResult> {
  const apiKey = process.env.MOUSER_ORDER_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    return { ok: false, supplier: 'mouser', error: 'MOUSER_ORDER_API_KEY 미설정' };
  }
  try {
    const res = await fetch(
      `${MOUSER_BASE_URL}/api/v1/cart/items/insert?apiKey=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          CartItems: lines.map((line) => ({ MouserPartNumber: line.sku, Quantity: line.qty })),
        }),
      },
    );
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || body === null) {
      return { ok: false, supplier: 'mouser', error: `HTTP ${String(res.status)}` };
    }
    // Mouser 는 오류를 200 응답의 Errors 배열로도 준다(행 단위 거부 포함).
    const errors = Array.isArray(body.Errors)
      ? body.Errors.map((e) => JSON.stringify(e)).filter((msg) => msg !== '{}')
      : [];
    const cartKey = typeof body.CartKey === 'string' ? body.CartKey : null;
    if (cartKey === null) {
      return {
        ok: false,
        supplier: 'mouser',
        error: errors.length > 0 ? errors.join(' · ') : 'CartKey 없음(응답 형식 상이)',
      };
    }
    const cartItems = Array.isArray(body.CartItems) ? body.CartItems : [];
    return {
      ok: true,
      supplier: 'mouser',
      cartKey,
      cartWebUrl: 'https://www.mouser.kr/Cart/', // 계정 카트 — 로그인 후 확인
      lineCount: cartItems.length,
      merchandiseTotal:
        typeof body.MerchandiseTotal === 'number' ? body.MerchandiseTotal : null,
      currencyCode: typeof body.CurrencyCode === 'string' ? body.CurrencyCode : null,
      errors,
    };
  } catch (err) {
    return { ok: false, supplier: 'mouser', error: err instanceof Error ? err.message : '요청 실패' };
  }
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
