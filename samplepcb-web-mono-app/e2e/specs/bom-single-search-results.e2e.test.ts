// 공급사 조회 완료 전 목록 비노출, 카탈로그 검색어와 다른 후보 보존, 재검색·실패 복구.
// BOM API는 모두 브라우저에서 대체한다. 공유 DB·공급사 호출·사용자 바구니를 변경하지 않는다.
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import type { Route } from 'playwright-core';
import type {
  BomPartHitType,
  BomPartSearchSupplementResponseType,
} from '../../packages/api-contract/src/schemas/parts';
import { closeBrowser, newSession, RUN, snap, type E2eSession } from '../helpers';

const QUERY = 'BLM15KD300SN1G';
const CANDIDATE = 'BLM15KD300SN1D';
const pricingContext = { targetCurrency: 'KRW' as const, usdKrwRate: 1400, rateDate: null, source: null, stale: false };

function part(id = '70790', mpn = CANDIDATE): BomPartHitType {
  const offer = {
    supplier: 'unikeyic', offerKind: 'supplier_offer' as const, supplierSku: `sku-${id}`,
    productUrl: null, stock: 1389, moq: 50, orderMultiple: null, packaging: 'Tape & Reel',
    leadTime: null, currency: 'USD', priceBreaks: [{ qty: 50, price: 0.0159 }],
    fetchedAt: '2026-09-17T07:23:40.000Z', derivedFrom: null,
  };
  const applied = {
    ...offer, currency: 'USD', unitPrice: 0.0159, unitPriceKrw: 22.26,
    lineTotalKrw: 1113, breakQty: 50, orderQty: 50, stockShort: false,
  };
  return {
    id, mpn, manufacturerName: 'Murata Manufacturing', description: 'Ferrite bead',
    category: 'Ferrite Beads', packageCode: '0402', lifecycle: null, imageUrl: null,
    specsSi: {}, suppliers: ['unikeyic'], offerCount: 1, minPrice: 0.0159,
    minPriceCurrency: 'USD', totalStock: 1389, offersFetchedAt: offer.fetchedAt,
    hasSpecConflict: false, hasCatalogInquiryOffer: false, hasPartnerStock: false,
    partnerStock: null, score: 0, source: 'supplier', searchMatch: 'review',
    inlineOffers: [offer], offerOptions: [{ ...offer, applied }], applied,
  };
}

function supplement(items: BomPartHitType[], incompleteSuppliers: string[] = []): BomPartSearchSupplementResponseType {
  return {
    result: true,
    data: {
      items, total: items.length, pricingContext,
      engine: { apiCalls: 0, cacheHits: 3, warnings: [], incompleteSuppliers },
      catalog: { status: 'completed', stats: { parts: 0, offers: 0, indexed: 0, queued: 0 } },
    },
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function gate() {
  let release = (): void => { throw new Error('gate not initialized'); };
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe.skipIf(!RUN)('단일 검색 — 공급사 확인 후 최종 목록', () => {
  let session: E2eSession | undefined;
  afterEach(async () => { await session?.close(); session = undefined; });
  afterAll(closeBrowser);

  async function setup(
    local: BomPartHitType[],
    handleSupplement: (route: Route) => Promise<void>,
    localStatus = 200,
  ): Promise<E2eSession> {
    session = await newSession({ mbId: 'e2e-single-search-readonly' });
    await session.context.route('**/api/bom/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/bom/parts-search/supplement') return handleSupplement(route);
      if (path === '/api/bom/parts-search') return json(route, {
        result: true,
        data: { items: local, total: local.length, searchMode: 'text', interpretedSpecCount: 0,
          pricingContext, page: 1, pageSize: 20, facets: { manufacturers: [], packages: [], suppliers: [] } },
      }, localStatus);
      if (path === '/api/bom/quotes') return json(route, {
        result: true, data: { items: [], total: 0, deletableCount: 0, page: 1, pageSize: 100 },
      });
      return json(route, { result: true, data: null });
    });
    return session;
  }

  test('원래 검색어가 0건이어도 공급사 후보를 표시하고 실제 partId로 담는다', async () => {
    let requests = 0;
    const { page, pageErrors } = await setup([], async (route) => {
      requests += 1;
      expect(route.request().postDataJSON()).toMatchObject({ q: QUERY, waitForCatalog: true });
      await json(route, supplement([part()]));
    });
    await page.goto(`/app/bom/search?q=${QUERY}`);
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    expect(await page.getByText('검색 결과 - 1개 부품', { exact: true }).count()).toBe(1);
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(1);
    expect(await page.getByText('일치 여부 확인 필요', { exact: true }).count()).toBe(1);
    const addRequest = page.waitForRequest((request) => request.url().endsWith('/api/bom/search-cart/items'));
    await page.getByRole('button', { name: '담기', exact: true }).click();
    expect((await addRequest).postDataJSON()).toMatchObject({
      partId: '70790', selection: { supplier: 'unikeyic', supplierSku: 'sku-70790' },
    });
    // 같은 검색어의 기본 검색 버튼도 새 공급사 확인을 수행한다.
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect.poll(() => requests).toBe(2);
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    expect(pageErrors).toEqual([]);
    await snap(page, 'bom-single-search-completed-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.getByRole('button', { name: '다시 검색', exact: true }).isVisible()).toBe(true);
    await snap(page, 'bom-single-search-completed-mobile');
  });

  test('가격 있는 로컬 결과도 공급사 완료까지 숨기고 중복 없이 합친다', async () => {
    const pending = gate();
    const started = gate();
    const local = part();
    const { page } = await setup([local, part('80000', 'LOCAL-ONLY')], async (route) => {
      started.release();
      await pending.promise;
      await json(route, supplement([part()]));
    });
    await page.goto(`/app/bom/search?q=${QUERY}`);
    await started.promise;
    await page.getByText('공급사에서 부품과 구매 조건을 확인하고 있습니다.', { exact: true }).waitFor();
    expect(await page.locator('table').count()).toBe(0);
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(0);
    pending.release();
    await page.getByText('조회 완료 · 2개 부품', { exact: true }).waitFor();
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(1);
    expect(await page.getByText('LOCAL-ONLY', { exact: true }).count()).toBe(1);
  });

  test('일부 공급사 실패와 전체 실패를 결과와 구분하고 재시도할 수 있다', async () => {
    let requests = 0;
    const { page } = await setup([part()], async (route) => {
      requests += 1;
      if (requests === 2) return json(route, { result: false, error: 'BOM_ENGINE_UNREACHABLE' }, 503);
      await json(route, supplement([part()], ['mouser']));
    });
    await page.goto(`/app/bom/search?q=${QUERY}`);
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    expect(await page.getByRole('status').filter({ hasText: 'Mouser' }).count()).toBe(1);
    await page.getByRole('button', { name: '다시 검색', exact: true }).click();
    await page.getByText('공급사 확인에 실패하여 저장된 카탈로그 결과를 표시합니다.', { exact: false }).waitFor();
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: '재시도', exact: true }).click();
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    expect(requests).toBe(3);
  });

  test('이전 검색의 늦은 응답이 새 검색 결과를 덮지 않는다', async () => {
    const oldResponse = gate();
    const oldStarted = gate();
    const oldFinished = gate();
    const { page } = await setup([], async (route) => {
      const body: unknown = route.request().postDataJSON();
      if (typeof body === 'object' && body !== null && 'q' in body && body.q === QUERY) {
        oldStarted.release();
        await oldResponse.promise;
        await json(route, supplement([part()]));
        oldFinished.release();
      } else {
        await json(route, supplement([part('80001', 'NEW-MPN')]));
      }
    });
    await page.goto(`/app/bom/search?q=${QUERY}`);
    await oldStarted.promise;
    await page.getByRole('searchbox', { name: '부품 검색어', exact: true }).fill('NEW-MPN');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    oldResponse.release();
    await oldFinished.promise;
    await page.waitForLoadState('networkidle');
    expect(await page.getByText('NEW-MPN', { exact: true }).count()).toBe(1);
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(0);
  });

  test('카탈로그 오류와 구매 조건 없는 후보도 완료된 공급사 결과를 지우지 않는다', async () => {
    const candidate = { ...part(), offerOptions: [], inlineOffers: [], applied: null };
    const { page } = await setup([], (route) => json(route, supplement([candidate])), 503);
    await page.goto(`/app/bom/search?q=${QUERY}`);
    await page.getByText('조회 완료 · 1개 부품', { exact: true }).waitFor();
    expect(await page.getByText('구매 조건 확인이 필요한 후보', { exact: true }).count()).toBe(1);
    expect(await page.getByText(CANDIDATE, { exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: '담기', exact: true }).count()).toBe(0);
  });
});
