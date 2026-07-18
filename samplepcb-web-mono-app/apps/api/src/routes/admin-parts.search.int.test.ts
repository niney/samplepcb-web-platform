// 부품 검색 쿼리 빌더 통합 검증 — 실 ES 대상, 단위·패키지·필터·정렬·페이지 C 게이트.
// 명시적 옵트인(PARTS_IT=1)일 때만 실행 — turbo test/CI 에서는 자동 skip.
// 실행(bash): cd apps/api && export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" \
//             && PARTS_IT=1 pnpm exec vitest run admin-parts.search.int
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartSearchQuery, type PartSearchQueryType } from '@sp/api-contract';
import { normalizeMpn } from '@sp/utils';
import { prisma } from '../lib/prisma';
import { esClient } from '../es/client';
import {
  F,
  SP_PARTS_READ,
  SP_PARTS_WRITE,
  bootstrapPartsIndex,
  type SpPartDoc,
} from '../es/sp-parts-index';
import { ingestSupplierSearchResult } from '../lib/parts-ingest';
import { buildPartSort, buildSearchQuery } from './admin-parts';

const RUN = process.env.PARTS_IT === '1';
const R_MPN = 'SPTEST-RC0402FR-074K7L'; // 4.7kΩ 0402 저항
const C_MPN = 'SPTEST-GRM155R71C104KA88D'; // 100nF 0402 커패시터
const L_MPN = 'SPTEST-MLZ1608M4R7WT000'; // 4.7uH 0603 인덕터
const TEST_MPN_PREFIX = 'SPTEST';
const TEST_MPNS = [R_MPN, C_MPN, L_MPN] as const;

interface ProductOptions {
  supplier: string;
  packageCode: string;
  stock: number;
  unitPrice: number;
}

function product(
  mpn: string,
  manufacturer: string,
  description: string,
  specs: Record<string, unknown>,
  options: ProductOptions,
): unknown {
  return {
    supplier: options.supplier,
    manufacturer_part_number: mpn,
    manufacturer,
    description,
    category: null,
    package: options.packageCode,
    normalized_specs: { ...specs, package: options.packageCode },
    offers: [
      {
        supplier: options.supplier,
        supplier_sku: `SKU-${mpn}`,
        stock: options.stock,
        moq: 1,
        price_breaks: [{ quantity: 1, unit_price: options.unitPrice, currency: 'USD' }],
        fetched_at: new Date().toISOString(),
      },
    ],
  };
}

async function searchDocs(input: string | Partial<PartSearchQueryType>): Promise<SpPartDoc[]> {
  const params: PartSearchQueryType = PartSearchQuery.parse(
    typeof input === 'string' ? { q: input } : input,
  );
  const res = await esClient().search<SpPartDoc>({
    index: SP_PARTS_READ,
    from: (params.page - 1) * params.pageSize,
    size: params.pageSize,
    query: {
      bool: {
        must: [buildSearchQuery(params)],
        // 실 카탈로그가 커져도 상위 N개에 밀리지 않도록 테스트 픽스처를 ES 단계에서 격리한다.
        filter: [{ prefix: { [F.mpnNormKeyword]: { value: TEST_MPN_PREFIX } } }],
      },
    },
    sort: buildPartSort(params.sort),
  });
  return res.hits.hits.flatMap((h) => (h._source === undefined ? [] : [h._source]));
}

async function search(input: string | Partial<PartSearchQueryType>): Promise<string[]> {
  return (await searchDocs(input)).map((doc) => doc.mpnNorm);
}

async function cleanup(): Promise<void> {
  for (const mpn of TEST_MPNS) {
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
              {
                product: product(
                  R_MPN,
                  'Yageo',
                  'RES 4.7K OHM 1% 1/16W 0402',
                  { resistance_ohm: 4700, tolerance_percent: 1, power_w: 0.0625 },
                  { supplier: 'mouser', packageCode: '0402', stock: 500, unitPrice: 0.01 },
                ),
              },
              {
                product: product(
                  C_MPN,
                  'Murata Electronics',
                  'CAP CER 0.1UF 16V X7R 0402',
                  { capacitance_f: 1e-7, voltage_v: 16, tolerance_percent: 10 },
                  { supplier: 'mouser', packageCode: '0402', stock: 1_000, unitPrice: 0.03 },
                ),
              },
              {
                product: product(
                  L_MPN,
                  'TDK',
                  'IND 4.7UH 20% 800MA 0603',
                  { inductance_h: 4.7e-6, current_a: 0.8, tolerance_percent: 20 },
                  { supplier: 'digikey', packageCode: '0603', stock: 0, unitPrice: 0.02 },
                ),
              },
            ],
          },
        ],
      },
    };
    const stats = await ingestSupplierSearchResult(envelope);
    expect(stats).toMatchObject({ parts: 3, indexed: 3 });
    await esClient().indices.refresh({ index: SP_PARTS_READ });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const R = normalizeMpn(R_MPN);
  const C = normalizeMpn(C_MPN);
  const L = normalizeMpn(L_MPN);

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
    expect(await search('1005')).toEqual(expect.arrayContaining([R, C]));
  });

  it.each([
    ['4.7KΩ', R, '저항 단위·대소문자'],
    ['4.7uH', L, '인덕턴스 SI 단위'],
    ['4u7', L, '인덕턴스 관행 소수점 표기'],
    ['155R71C', C, 'MPN 중간 문자열'],
  ] as const)('"%s" → %s 히트 (%s)', async (query, expected, label) => {
    expect(await search(query), label).toContain(expected);
  });

  it('0603↔1608 패키지 등가 검색은 인덕터만 남긴다', async () => {
    expect(await search('0603')).toEqual([L]);
    expect(await search('1608')).toEqual([L]);
  });

  it('검색어의 알려진 패키지는 배타 필터 — 4k7 0603에서 0402 저항 제외', async () => {
    expect(await search('4k7 0603')).not.toContain(R);
  });

  it('제조사·공급사 구조화 필터가 정확한 부품만 반환한다', async () => {
    expect(await search({ q: '', manufacturer: 'TDK' })).toEqual([L]);
    expect(await search({ q: '', supplier: 'digikey' })).toEqual([L]);
    expect(await search({ q: '', supplier: 'mouser' })).toEqual(expect.arrayContaining([R, C]));
  });

  it('재고 있음 필터는 재고 0인 인덕터를 제외한다', async () => {
    const hits = await search({ q: '', inStockOnly: true });
    expect(hits).toEqual(expect.arrayContaining([R, C]));
    expect(hits).not.toContain(L);
  });

  it('저항·커패시턴스·인덕턴스·전압 SI 범위 필터가 종류를 교차 오염시키지 않는다', async () => {
    expect(await search({ q: '', resistanceMin: 4_000, resistanceMax: 5_000 })).toEqual([R]);
    expect(await search({ q: '', capacitanceMin: 9e-8, capacitanceMax: 1.1e-7 })).toEqual([C]);
    expect(await search({ q: '', inductanceMin: 4e-6, inductanceMax: 5e-6 })).toEqual([L]);
    expect(await search({ q: '', voltageMin: 15, voltageMax: 17 })).toEqual([C]);
  });

  it('가격 오름차순·재고 내림차순이 ES 요약 필드를 따른다', async () => {
    expect(await search({ q: '', sort: 'price' })).toEqual([R, L, C]);
    expect(await search({ q: '', sort: 'stock' })).toEqual([C, R, L]);
  });

  it('페이지네이션은 정렬 이후 안정적으로 적용된다', async () => {
    expect(await search({ q: '', sort: 'price', page: 1, pageSize: 1 })).toEqual([R]);
    expect(await search({ q: '', sort: 'price', page: 2, pageSize: 1 })).toEqual([L]);
    expect(await search({ q: '', sort: 'price', page: 3, pageSize: 1 })).toEqual([C]);
  });

  it('다른 용량 1uF는 100nF 커패시터를 반환하지 않는다', async () => {
    expect(await search('1uF')).not.toContain(C);
  });
});
