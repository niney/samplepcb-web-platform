// 부품 검색 쿼리 빌더 통합 검증 — 실 ES 대상, C 게이트 케이스(4k7·0.0047M·104K·2p 프리픽스·0402).
// 명시적 옵트인(PARTS_IT=1)일 때만 실행 — turbo test/CI 에서는 자동 skip.
// 실행(bash): cd apps/api && export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" \
//             && PARTS_IT=1 pnpm exec vitest run admin-parts.search.int
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartSearchQuery, type PartSearchQueryType } from '@sp/api-contract';
import { normalizeMpn } from '@sp/utils';
import { prisma } from '../lib/prisma';
import { esClient } from '../es/client';
import { SP_PARTS_READ, SP_PARTS_WRITE, bootstrapPartsIndex, type SpPartDoc } from '../es/sp-parts-index';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';
import { buildSearchQuery } from './admin-parts';

const RUN = process.env.PARTS_IT === '1';
const R_MPN = 'SPTEST-RC0402FR-074K7L'; // 4.7kΩ 0402 저항
const C_MPN = 'SPTEST-GRM155R71C104KA88D'; // 100nF 0402 커패시터

function product(mpn: string, manufacturer: string, description: string, specs: Record<string, unknown>): unknown {
  return {
    supplier: 'mouser',
    manufacturer_part_number: mpn,
    manufacturer,
    description,
    category: null,
    package: '0402',
    normalized_specs: { ...specs, package: '0402' },
    offers: [
      {
        supplier: 'mouser',
        supplier_sku: `SKU-${mpn}`,
        stock: 500,
        moq: 1,
        price_breaks: [{ quantity: 1, unit_price: 0.01, currency: 'USD' }],
        fetched_at: new Date().toISOString(),
      },
    ],
  };
}

async function search(q: string): Promise<string[]> {
  const params: PartSearchQueryType = PartSearchQuery.parse({ q });
  const res = await esClient().search<SpPartDoc>({
    index: SP_PARTS_READ,
    size: 10,
    query: buildSearchQuery(params),
  } as never);
  // 테스트 부품만 관찰(기존 카탈로그 데이터와 격리)
  return res.hits.hits
    .flatMap((h) => (h._source === undefined ? [] : [h._source.mpnNorm]))
    .filter((m) => m.startsWith('SPTEST'));
}

async function cleanup(): Promise<void> {
  for (const mpn of [R_MPN, C_MPN]) {
    const part = await prisma.spPart.findFirst({ where: { mpnNorm: normalizeMpn(mpn) } });
    if (part !== null) {
      await prisma.spPartIndexQueue.deleteMany({ where: { partId: part.id } });
      await prisma.spPart.delete({ where: { id: part.id } });
      try {
        await esClient().delete({ index: SP_PARTS_WRITE, id: String(part.id) });
      } catch {
        // 문서 없으면 무시
      }
    }
  }
}

describe.skipIf(!RUN)('parts search (integration — 실 ES, C 게이트)', () => {
  beforeAll(async () => {
    await bootstrapPartsIndex({ info: () => undefined, warn: () => undefined });
    await cleanup();
    const envelope = {
      search: {
        components: [
          {
            candidates: [
              { product: product(R_MPN, 'Yageo', 'RES 4.7K OHM 1% 1/16W 0402', { resistance_ohm: 4700, tolerance_percent: 1, power_w: 0.0625 }) },
              { product: product(C_MPN, 'Murata Electronics', 'CAP CER 0.1UF 16V X7R 0402', { capacitance_f: 1e-7, voltage_v: 16, tolerance_percent: 10 }) },
            ],
          },
        ],
      },
    };
    const stats = await ingestSupplierSearchResult(envelope);
    expect(stats).toMatchObject({ parts: 2, indexed: 2 });
    await esClient().indices.refresh({ index: SP_PARTS_READ });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const R = normalizeMpn(R_MPN);
  const C = normalizeMpn(C_MPN);

  it('"4k7" → 저항 히트(SI + 변형)', async () => {
    expect(await search('4k7')).toContain(R);
  });

  it('"0.0047M" → 접두 환산으로 같은 저항 히트 (Track A)', async () => {
    expect(await search('0.0047M')).toContain(R);
  });

  it('"4700" 바닥 숫자 → 저항 히트', async () => {
    expect(await search('4700')).toContain(R);
  });

  it('"104K" → EIA 코드+톨러런스 → 커패시터 히트', async () => {
    expect(await search('104K')).toContain(C);
  });

  it('"0.1u" 프리픽스 → 커패시터 히트 (Track B prefix)', async () => {
    expect(await search('0.1u')).toContain(C);
  });

  it('"2200p"(=2.2nF) 는 100nF 와 불일치 — 오검색 없음', async () => {
    expect(await search('2200p')).not.toContain(C);
  });

  it('"GRM155" MPN 프리픽스 → 커패시터 히트', async () => {
    expect(await search('GRM155')).toContain(C);
  });

  it('"4k7 0402" → 저항이 1위 — 캡은 설명 텍스트("0402") 매칭으로 후순위 포함 가능(랭킹이 결정)', async () => {
    const hits = await search('4k7 0402');
    expect(hits[0]).toBe(R);
  });

  it('"1005"(메트릭) → 0402 와 등가 — 두 부품 다 패키지 매칭 범위 안', async () => {
    const params = PartSearchQuery.parse({ q: '1005 SPTEST' });
    const res = await esClient().search<SpPartDoc>({
      index: SP_PARTS_READ,
      size: 10,
      query: buildSearchQuery(params),
    } as never);
    const mpns = res.hits.hits.flatMap((h) => (h._source === undefined ? [] : [h._source.mpnNorm]));
    expect(mpns).toEqual(expect.arrayContaining([R, C]));
  });
});
