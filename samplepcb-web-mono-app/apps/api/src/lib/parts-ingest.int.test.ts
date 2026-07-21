// 부품 카탈로그 인제스트 통합 검증 — 실 DB(sp_part*) + 실 ES(sp-parts) 대상.
// 명시적 옵트인(PARTS_IT=1 + .env 로드)일 때만 실행 — turbo test/CI 에서는 자동 skip.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeMpn, parseSpecToken, siRange } from '@sp/utils';
import { prisma } from './prisma';
import { esClient } from '../es/client';
import {
  SP_PARTS_READ,
  SP_PARTS_WRITE,
  bootstrapPartsIndex,
  type SpPartDoc,
} from '../es/sp-parts-index';
import { drainIndexQueue, ingestSupplierSearchResult, ingestSupplierSearchResultOnce } from './parts-ingest';

const RUN = process.env.PARTS_IT === '1';
const MPN = 'SPINGEST-GRM155R71C104KA88D';
const MOUSER_SKU = '81-SPINGEST';
const DIGIKEY_SKU = '490-SPINGEST';

interface PriceBreakInput {
  quantity: number;
  unit_price: number;
  currency: string;
}

interface OfferInput {
  supplier: string;
  supplier_sku: string;
  stock: number;
  fetched_at: string;
  price_breaks: PriceBreakInput[];
}

function product(manufacturer: string, offers: OfferInput[]): unknown {
  return {
    supplier: offers[0]?.supplier ?? 'mouser',
    manufacturer_part_number: MPN,
    manufacturer,
    description: 'CAP CER 0.1UF 16V X7R 0402',
    category: 'Ceramic Capacitors',
    package: 'C1005',
    lifecycle_status: 'Active',
    normalized_specs: {
      capacitance_f: 1e-7,
      voltage_v: 16,
      tolerance_percent: 10,
      package: '0402',
      dielectric: 'X7R',
    },
    offers: offers.map((offer) => ({
      ...offer,
      moq: 1,
      order_multiple: 1,
      packaging: 'Cut Tape',
      fetched_at: offer.fetched_at,
    })),
  };
}

function envelope(products: unknown[]): unknown {
  return {
    search: {
      components: [{ candidates: products.map((item) => ({ product: item })) }],
    },
  };
}

async function cleanup(): Promise<void> {
  await prisma.spPartIngestRun.deleteMany({ where: { sourceJobId: 'parts-ingest-it' } });
  const part = await prisma.spPart.findFirst({ where: { mpnNorm: normalizeMpn(MPN) } });
  if (part === null) return;
  await prisma.spPartIndexQueue.deleteMany({ where: { partId: part.id } });
  await prisma.spPart.delete({ where: { id: part.id } });
  try {
    await esClient().delete({ index: SP_PARTS_WRITE, id: String(part.id) });
  } catch {
    // 문서 없으면 무시
  }
}

describe.skipIf(!RUN)('parts ingest (integration — 실 DB·ES)', () => {
  beforeAll(async () => {
    await bootstrapPartsIndex({ info: () => undefined, warn: () => undefined });
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('잘못된 envelope는 저장 없이 0 통계로 안전하게 거부한다', async () => {
    expect(await ingestSupplierSearchResult({ invalid: true })).toEqual({
      parts: 0,
      offers: 0,
      indexed: 0,
      queued: 0,
      skippedParts: 0,
      skippedOffers: 0,
    });
    expect(await prisma.spPart.count({ where: { mpnNorm: normalizeMpn(MPN) } })).toBe(0);
  });

  it('별칭 제조사·다중 공급사·최신 오퍼를 하나의 부품으로 저장하고 ES에서 검색한다', async () => {
    const initial = envelope([
      product('Murata Electronics', [
        {
          supplier: 'mouser',
          supplier_sku: MOUSER_SKU,
          stock: 100,
          fetched_at: '2026-07-18T01:00:00.000Z',
          price_breaks: [{ quantity: 1, unit_price: 0.02, currency: 'USD' }],
        },
      ]),
      product('muRata', [
        {
          supplier: 'mouser',
          supplier_sku: MOUSER_SKU,
          stock: 1_000,
          fetched_at: '2026-07-18T02:00:00.000Z',
          price_breaks: [
            { quantity: 1, unit_price: 0.0123, currency: 'USD' },
            { quantity: 100, unit_price: 0.008, currency: 'USD' },
          ],
        },
      ]),
      product('Murata Manufacturing', [
        {
          supplier: 'digikey',
          supplier_sku: DIGIKEY_SKU,
          stock: 200,
          fetched_at: '2026-07-18T02:30:00.000Z',
          price_breaks: [{ quantity: 1, unit_price: 0.013, currency: 'USD' }],
        },
      ]),
    ]);

    const stats = await ingestSupplierSearchResult(initial);
    expect(stats).toMatchObject({ parts: 1, offers: 2, indexed: 1, queued: 0 });
    expect(await ingestSupplierSearchResult(initial)).toMatchObject({
      parts: 0,
      offers: 0,
      indexed: 0,
      skippedParts: 1,
      skippedOffers: 2,
    });

    const part = await prisma.spPart.findFirst({
      where: { mpnNorm: normalizeMpn(MPN) },
      include: { offers: { include: { priceBreaks: true } } },
    });
    expect(part).not.toBeNull();
    if (part === null) return;
    expect(part.manufacturerNorm).toBe('murata');
    expect(part.packageCode).toBe('0402');
    // 실공급사 2 + 자체(samplepcb) 파생 1 — applyPartFacts 가 항상 재생성한다
    expect(part.offers).toHaveLength(3);
    const mouser = part.offers.find((offer) => offer.supplier === 'mouser');
    const digikey = part.offers.find((offer) => offer.supplier === 'digikey');
    const own = part.offers.find((offer) => offer.supplier === 'samplepcb');
    expect(mouser?.stock).toBe(1_000);
    expect(mouser?.priceBreaks.map((price) => price.qty).sort((a, b) => a - b)).toEqual([1, 100]);
    expect(digikey?.stock).toBe(200);
    // 파생 오퍼: 원천 통째 복사 + derivedFrom 추적(둘 다 USD·재고>0 → 최소구간 단가 mouser 0.0123 < digikey 0.013)
    expect(own).toBeDefined();
    expect((own?.rawJson as { derivedFrom?: { supplier?: string } }).derivedFrom?.supplier).toBe('mouser');
    expect(own?.stock).toBe(mouser?.stock);

    // 같은 오퍼의 새 스냅샷은 가격구간 replace-all, 다른 공급사 오퍼는 보존한다.
    const updated = envelope([
      product('Murata', [
        {
          supplier: 'mouser',
          supplier_sku: MOUSER_SKU,
          stock: 1_500,
          fetched_at: '2026-07-18T03:00:00.000Z',
          price_breaks: [{ quantity: 10, unit_price: 0.009, currency: 'USD' }],
        },
      ]),
    ]);
    expect(await ingestSupplierSearchResult(updated)).toMatchObject({
      parts: 1,
      offers: 1,
      indexed: 1,
    });

    // 뒤늦게 도착한 과거 결과는 최신 재고·가격을 되돌리면 안 된다.
    const stale = envelope([
      product('Murata', [
        {
          supplier: 'mouser',
          supplier_sku: MOUSER_SKU,
          stock: 1,
          fetched_at: '2026-07-18T00:30:00.000Z',
          price_breaks: [{ quantity: 1, unit_price: 99, currency: 'USD' }],
        },
      ]),
    ]);
    await ingestSupplierSearchResult(stale);

    const refreshed = await prisma.spPart.findUnique({
      where: { id: part.id },
      include: { offers: { include: { priceBreaks: true } } },
    });
    expect(refreshed?.offers).toHaveLength(3); // 실공급사 2 + samplepcb 파생
    const refreshedMouser = refreshed?.offers.find((offer) => offer.supplier === 'mouser');
    expect(refreshedMouser?.stock).toBe(1_500);
    expect(refreshedMouser?.priceBreaks.map((price) => [price.qty, Number(price.price)])).toEqual([
      [10, 0.009],
    ]);
    // 파생 오퍼도 최신 원천으로 추종(mouser 0.009 < digikey 0.013)
    const refreshedOwn = refreshed?.offers.find((offer) => offer.supplier === 'samplepcb');
    expect((refreshedOwn?.rawJson as { derivedFrom?: { supplier?: string } }).derivedFrom?.supplier).toBe('mouser');
    expect(refreshedOwn?.stock).toBe(1_500);

    const [firstLedgerRun, concurrentLedgerRun] = await Promise.all([
      ingestSupplierSearchResultOnce(initial, 'parts-ingest-it'),
      ingestSupplierSearchResultOnce(initial, 'parts-ingest-it'),
    ]);
    const reusedLedgerRun = await ingestSupplierSearchResultOnce(initial, 'parts-ingest-it');
    expect(firstLedgerRun.reused).toBe(false);
    expect(concurrentLedgerRun).toEqual(firstLedgerRun);
    expect(reusedLedgerRun).toMatchObject({ runId: firstLedgerRun.runId, reused: true });

    await esClient().indices.refresh({ index: SP_PARTS_READ });
    const indexed = await esClient().get<SpPartDoc>({ index: SP_PARTS_READ, id: String(part.id) });
    expect(indexed._source).toMatchObject({
      mpnNorm: normalizeMpn(MPN),
      manufacturerNorm: 'murata',
      packageCode: '0402',
      offerCount: 2,
      totalStock: 1_700,
      minPrice: 0.009,
      minPriceCurrency: 'USD',
    });
    expect(indexed._source?.suppliers).toEqual(expect.arrayContaining(['mouser', 'digikey']));

    // DB fingerprint는 최신인 채 ES만 stale bulk에 덮였다고 가정한다. 큐 드레인은 fingerprint
    // 단락 없이 현재 DB 문서를 강제 색인해야 한다.
    if (indexed._source === undefined) throw new Error('integration test document missing');
    await esClient().index({
      index: SP_PARTS_WRITE,
      id: String(part.id),
      document: { ...indexed._source, totalStock: -1 },
    });
    await prisma.spPartIndexQueue.create({ data: { partId: part.id, reason: 'stale-ordering-regression' } });
    await expect(drainIndexQueue()).resolves.toMatchObject({ drained: 1 });
    await esClient().indices.refresh({ index: SP_PARTS_READ });
    const recovered = await esClient().get<SpPartDoc>({ index: SP_PARTS_READ, id: String(part.id) });
    expect(recovered._source?.totalStock).toBe(1_700);

    // Track A: "104K" 표기 → SI 정준(100nF) range 히트
    const cap = parseSpecToken('104K').find(
      (spec) => spec.kind === 'capacitance' && spec.confidence === 'high',
    );
    expect(cap).toBeDefined();
    if (cap === undefined) return;
    const trackA = await esClient().search({
      index: SP_PARTS_READ,
      query: {
        bool: {
          must: [{ range: { capacitanceF: siRange(cap.si) } }],
          filter: [
            { term: { manufacturerNorm: 'murata' } },
            { term: { 'mpnNorm.keyword': normalizeMpn(MPN) } },
          ],
        },
      },
    });
    expect(trackA.hits.hits).toHaveLength(1);

    // Track B: 관행 표기 variants — "104"·"0.1uf"·패키지 메트릭 코드 1005
    const trackB = await esClient().search({
      index: SP_PARTS_READ,
      query: {
        bool: {
          must: [{ term: { specVariants: '104' } }],
          filter: [
            { term: { specVariants: '0.1uf' } },
            { terms: { packageVariants: ['1005'] } },
            { term: { 'mpnNorm.keyword': normalizeMpn(MPN) } },
          ],
        },
      },
    });
    expect(trackB.hits.hits).toHaveLength(1);
  });
});
