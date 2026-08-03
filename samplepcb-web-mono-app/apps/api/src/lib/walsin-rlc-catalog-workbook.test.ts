import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  catalogMigrationSuppliers,
  parseCatalogMigrationEnvelope,
} from './parts-catalog-migration';
import { partOfferKind } from './parts-offer-kind';
import {
  buildWalsinRlcCatalogEnvelope,
  WALSIN_RLC_SOURCE_SHA256,
  type WalsinRlcWorkbookStats,
} from './walsin-rlc-catalog-workbook';

const catalogFile = fileURLToPath(
  new URL('../../catalog-migrations/walsin/Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx', import.meta.url),
);

let envelope: unknown;
let stats: WalsinRlcWorkbookStats;

interface Product {
  supplier: string;
  manufacturer_part_number: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  datasheet_url: string | null;
  image_url: string | null;
  normalized_specs: Record<string, unknown>;
  catalog_metadata: Record<string, unknown>;
  offers: Record<string, unknown>[];
}

function products(): Product[] {
  const artifact = envelope as {
    search: { components: { candidates: { product: Product }[] }[] };
  };
  return artifact.search.components.flatMap((component) =>
    component.candidates.map((candidate) => candidate.product),
  );
}

function findProduct(mpn: string): Product {
  const found = products().find((product) => product.manufacturer_part_number === mpn);
  if (found === undefined) throw new Error(`품번을 찾지 못했습니다: ${mpn}`);
  return found;
}

beforeAll(async () => {
  const result = await buildWalsinRlcCatalogEnvelope(catalogFile);
  envelope = result.envelope;
  stats = result.stats;
}, 60_000);

describe('walsin R/C 카탈로그 워크북', () => {
  it('승인된 원본 해시만 받는다', () => {
    expect(stats.sourceSha256).toBe(WALSIN_RLC_SOURCE_SHA256);
  });

  it('저항·캐패시터 전 행을 부품으로 전개한다', () => {
    expect(stats.resistorRows).toBe(364);
    expect(stats.capacitorRows).toBe(377);
    expect(stats.parts).toBe(2628);
    expect(stats.resistorParts + stats.capacitorParts).toBe(stats.parts);
  });

  it('제조사 7사로 나뉜다', () => {
    expect(stats.manufacturerCounts).toEqual({
      KOA: 224,
      Murata: 232,
      Samsung: 456,
      TDK: 348,
      Vishay: 224,
      Walsin: 572,
      Yageo: 572,
    });
  });

  it('인덕터·페라이트(LFB) 시트는 적재하지 않는다', () => {
    // LFB MPN 열은 `Walsin_FB_0603_600Ω@100MHz_VERIFY` 형태의 자리표시자라 품번이 아니다.
    const placeholder = products().filter((product) =>
      product.manufacturer_part_number.includes('_VERIFY'),
    );
    expect(placeholder).toEqual([]);
    const partTypes = new Set(products().map((product) => product.normalized_specs.part_type));
    expect([...partTypes].sort()).toEqual(['capacitor', 'resistor']);
  });

  it('envelope는 마이그레이션 계약 검증을 통과한다', () => {
    const parsed = parseCatalogMigrationEnvelope(envelope);
    expect(parsed.records).toHaveLength(2628);
    expect(parsed.sourceSha256).toBe(WALSIN_RLC_SOURCE_SHA256);
    expect(catalogMigrationSuppliers(parsed)).toEqual([
      'koa',
      'murata',
      'samplepcb',
      'samsung',
      'tdk',
      'vishay',
      'walsin',
      'yageo',
    ]);
  });
});

describe('사양 정규화', () => {
  it('저항값을 SI 옴으로 만든다', () => {
    // WR04X1002FTL = Walsin 0402 10kΩ 1%
    const product = findProduct('WR04X1002FTL');
    expect(product.normalized_specs).toMatchObject({
      part_type: 'resistor',
      resistance_ohm: 10_000,
      tolerance_percent: 1,
      package: '0402',
    });
  });

  it('0Ω 점퍼도 저항값으로 남긴다', () => {
    expect(findProduct('WR04X0FTL').normalized_specs.resistance_ohm).toBe(0);
  });

  it('MΩ 배수를 처리한다', () => {
    expect(findProduct('WR06X1004FTL').normalized_specs.resistance_ohm).toBe(1_000_000);
  });

  it('정전용량을 SI 패럿으로 만든다', () => {
    // CL05B104KB5NNNC = Samsung 0402 100nF X7R 50V ±10%
    const product = findProduct('CL05B104KB5NNNC');
    expect(product.normalized_specs).toMatchObject({
      part_type: 'capacitor',
      capacitor_type: 'ceramic',
      capacitance_f: 1e-7,
      tolerance_percent: 10,
      voltage_v: 50,
      dielectric: 'X7R',
      package: '0402',
    });
  });

  it('pF·uF 배수를 처리한다', () => {
    expect(findProduct('GRM155R71H104KE14D').normalized_specs.capacitance_f).toBe(1e-7);
    expect(findProduct('0201B100J500CT').normalized_specs.capacitance_f).toBe(1e-11);
  });

  it('C 시트에는 description 열이 없어 사양에서 만든다', () => {
    expect(findProduct('CL05B104KB5NNNC').description).toBe(
      'Multilayer Ceramic Capacitor X7R 50V',
    );
  });

  it('복합 X5R/X7R 표기를 어느 한 유전체로 추정하지 않는다', () => {
    const ambiguous = products().filter(
      (product) => product.catalog_metadata.sourceDielectric === 'X5R/X7R',
    );
    expect(ambiguous).toHaveLength(624);
    for (const product of ambiguous) {
      expect(product.normalized_specs).not.toHaveProperty('dielectric');
      expect(product.catalog_metadata.dielectricAmbiguous).toBe(true);
    }
  });
});

describe('중복 해소', () => {
  it('같은 EIA를 가리키는 사이즈 표기는 한 부품으로 합친다', () => {
    // 1005 시트와 402 시트는 둘 다 EIA 0402다.
    expect(stats.mergedSizeAliases).toBe(285);
    const product = findProduct('WR04X1002FTL');
    expect(product.catalog_metadata.inputSizeCodes).toEqual(['1005', '402']);
    expect(product.catalog_metadata.sourceSheets).toEqual(['R_1005', 'R_402']);
  });

  it('잘못 배정된 사이즈만 버리고 품번은 보존한다', () => {
    // Samsung CL43·Murata GRM43은 metric 4532(=EIA 1812)인데 원본이 1808 시트에도 넣었다.
    expect(stats.crossSizeDrops).toBe(116);
    const product = findProduct('CL43C100JB5NNNC');
    expect(product.catalog_metadata.normalizedEia).toBe('1812');
    expect(product.catalog_metadata.inputSizeCodes).toEqual(['1812']);
  });

  it('교차 사이즈에서 버린 품번은 AVL 형제에도 남기지 않는다', () => {
    const affected = products().filter(
      (product) => product.catalog_metadata.componentGroup === 'C'
        && ['1808', '2010'].includes(String(product.catalog_metadata.normalizedEia)),
    );
    for (const product of affected) {
      const siblings = product.catalog_metadata.avlSiblings as { manufacturer: string }[];
      expect(siblings.some((sibling) =>
        ['Samsung', 'Murata'].includes(sibling.manufacturer))).toBe(false);
    }
  });

  it('한 품번이 두 EIA에 남아 있지 않다', () => {
    const eiaByKey = new Map<string, Set<string>>();
    for (const product of products()) {
      const key = `${product.supplier}:${product.manufacturer_part_number}`;
      const set = eiaByKey.get(key) ?? new Set<string>();
      set.add(String(product.catalog_metadata.normalizedEia));
      eiaByKey.set(key, set);
    }
    expect([...eiaByKey.values()].filter((set) => set.size > 1)).toEqual([]);
  });

  it('원본이 비워 둔 벤더 셀은 부품을 만들지 않는다', () => {
    expect(stats.emptyVendorCells).toBe(676);
    expect(stats.emptyRows).toBe(112);
    // R_1808·R_1812·R_2220·R_3025는 전 벤더가 공백이라 저항 부품이 없다.
    const resistorEias = new Set(
      products()
        .filter((product) => product.normalized_specs.part_type === 'resistor')
        .map((product) => product.catalog_metadata.normalizedEia),
    );
    for (const eia of ['1808', '1812', '2220', '3025']) expect(resistorEias.has(eia)).toBe(false);
  });
});

describe('SamplePCB 판매 카탈로그 적재', () => {
  it('제조사 원천 정보와 SamplePCB 문의 견적 채널을 함께 만들고 상업 데이터는 비운다', () => {
    for (const product of products()) {
      expect(product.offers).toHaveLength(2);
      expect(product.offers.map((offer) => offer.supplier)).toEqual([
        product.supplier,
        'samplepcb',
      ]);
      for (const offer of product.offers) {
        expect(offer.offer_kind).toBe('manufacturer_catalog');
        expect(offer.price_breaks).toEqual([]);
        expect(offer.stock).toBeNull();
        expect(offer.moq).toBeNull();
      }
      expect(product.catalog_metadata.catalogOnly).toBe(true);
      expect(product.catalog_metadata.commercialDataAvailable).toBe(false);
      expect(product.catalog_metadata.autoQuoteEligible).toBe(true);
      expect(product.catalog_metadata.apiVerificationRequired).toBe(false);
      expect(product.catalog_metadata.samplepcbPreferred).toBe(true);
    }
  });

  it('DB 구매 조건 종류 판정에서도 제조사 카탈로그로 해소된다', () => {
    // 인제스트 후 rawJson으로 다시 판정해도 가격 선정 경로에 오르지 않아야 한다.
    for (const product of products().slice(0, 50)) {
      expect(partOfferKind(product)).toBe('manufacturer_catalog');
    }
  });

  it('표본 검증 행만 생성 품번이 아니다', () => {
    expect(stats.sampleVerifiedParts).toBe(10);
    const generated = products().filter(
      (product) => product.catalog_metadata.generatedMpn === true,
    );
    expect(generated).toHaveLength(2628 - 10);
    // 0402 10kΩ 1%는 제조사 스펙시트 근거가 있는 표본이다.
    expect(findProduct('RC0402FR-0710KL').catalog_metadata).toMatchObject({
      generatedMpn: false,
      verificationStatus: 'SAMPLE_VERIFIED_FOR_ALT_VENDOR_SET',
      samplepcbPreferenceRank: 1,
    });
  });

  it('가격·이미지·데이터시트 근거가 없으므로 비운다', () => {
    for (const product of products()) {
      expect(product.datasheet_url).toBeNull();
      expect(product.image_url).toBeNull();
    }
  });
});

describe('AVL 대체품 축', () => {
  it('같은 사양의 벤더들을 한 그룹으로 묶는다', () => {
    const product = findProduct('WR04X1002FTL');
    expect(product.catalog_metadata.avlGroupId).toBe('walsin-rlc:R:0402:10kΩ:1%');
    expect(product.catalog_metadata.avlRole).toBe('primary');
    expect(product.catalog_metadata.samplepcbPreferenceRank).toBe(0);
    const siblings = product.catalog_metadata.avlSiblings as { manufacturer: string; mpn: string }[];
    expect(siblings.map((sibling) => sibling.manufacturer)).toEqual([
      'Yageo', 'Samsung', 'Vishay', 'KOA',
    ]);
    expect(siblings.map((sibling) => sibling.mpn)).toContain('RC0402FR-0710KL');
  });

  it('대체품은 같은 그룹을 가리키고 주선정을 형제로 갖는다', () => {
    const alt = findProduct('RC0402FR-0710KL');
    expect(alt.catalog_metadata.avlGroupId).toBe('walsin-rlc:R:0402:10kΩ:1%');
    expect(alt.catalog_metadata.avlRole).toBe('alt1');
    const siblings = alt.catalog_metadata.avlSiblings as { role: string; mpn: string }[];
    expect(siblings.find((sibling) => sibling.role === 'primary')?.mpn).toBe('WR04X1002FTL');
  });

  it('그룹 수가 부품 있는 행 수와 같다', () => {
    expect(stats.avlGroups).toBe(572);
  });
});
