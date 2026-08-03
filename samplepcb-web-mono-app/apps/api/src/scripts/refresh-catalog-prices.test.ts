import { describe, expect, it } from 'vitest';
import {
  YEONHO_PRICE_SNAPSHOT_DEFINITION,
  buildCatalogPriceSnapshotArtifact,
  catalogPriceSnapshotIngestEnvelope,
  exactCatalogPriceSnapshotRecord,
  validateCatalogPriceSnapshotCoverage,
  type CatalogPriceSnapshotTarget,
} from '../lib/catalog-price-snapshot';
import {
  buildWalsinPriceSnapshotArtifact,
  exactWalsinPriceSnapshotRecord,
  summarizeWalsinPriceSnapshotRecords,
  validateWalsinPriceSnapshotCoverage,
  walsinSnapshotBlockingErrors,
  walsinSnapshotSupplierErrors,
  walsinPriceSnapshotIngestEnvelope,
  type WalsinPriceSnapshotTarget,
} from '../lib/walsin-catalog-price-snapshot';
import type { CatalogMigrationRecord } from '../lib/parts-catalog-migration';
import { supplierSearchIngestFingerprint } from '../lib/parts-ingest';
import {
  mergeCatalogPriceRefreshRecord,
  orderCatalogPriceSnapshotTargets,
  parseCatalogPriceRefreshOptions,
} from './refresh-catalog-prices';
import { parseCatalogImportOptions } from './import-parts-catalog';

const target: WalsinPriceSnapshotTarget = {
  key: 'walsin:WR04X1001FTL',
  mpn: 'WR04X1001FTL',
  mpnNorm: 'WR04X1001FTL',
  manufacturerName: 'Walsin',
  manufacturerNorm: 'walsin',
};

const yeonhoTarget: CatalogPriceSnapshotTarget = {
  key: 'yeonho:12505WS08',
  mpn: '12505WS-08',
  mpnNorm: '12505WS08',
  manufacturerName: 'YEONHO ELECTRONICS',
  manufacturerNorm: 'yeonho',
};

function product(
  mpn: string,
  manufacturer: string,
  priceBreaks: { quantity: number; unit_price: number; currency: string }[],
  supplier = 'digikey',
): Record<string, unknown> {
  return {
    supplier,
    manufacturer_part_number: mpn,
    manufacturer,
    offers: [
      {
        supplier,
        supplier_sku: `1292-${mpn}CT-ND`,
        stock: 100,
        moq: 0,
        order_multiple: 0,
        price_breaks: priceBreaks,
        fetched_at: '2026-07-26T00:00:00.000Z',
      },
    ],
  };
}

function catalogRecord(
  key = target.key,
  mpn = target.mpn,
): CatalogMigrationRecord {
  return {
    key,
    mpn,
    mpnNorm: mpn,
    manufacturerName: target.manufacturerName,
    manufacturerNorm: target.manufacturerNorm,
    product: {
      supplier: 'walsin',
      manufacturer_part_number: mpn,
      manufacturer: 'Walsin',
      normalized_specs: { part_type: 'resistor' },
      catalog_metadata: {
        sourceDataset: 'Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
        sourceRecordIds: [1],
        imageStatus: '없음',
        catalogOnly: true,
        generatedMpn: false,
        commercialDataAvailable: false,
      },
      offers: [
        {
          supplier: 'walsin',
          supplier_sku: mpn,
          price_breaks: [],
          fetched_at: '2026-07-06T00:00:00.000Z',
        },
      ],
    },
    offers: [{ supplier: 'walsin', supplierSku: mpn }],
  };
}

function yeonhoCatalogRecord(): CatalogMigrationRecord {
  return {
    key: yeonhoTarget.key,
    mpn: yeonhoTarget.mpn,
    mpnNorm: yeonhoTarget.mpnNorm,
    manufacturerName: yeonhoTarget.manufacturerName,
    manufacturerNorm: yeonhoTarget.manufacturerNorm,
    product: {
      supplier: 'yeonho',
      manufacturer_part_number: yeonhoTarget.mpn,
      manufacturer: yeonhoTarget.manufacturerName,
      normalized_specs: { part_type: 'connector' },
      catalog_metadata: {
        sourceDataset:
          '연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
        sourceRecordIds: [1],
        imageStatus: '수집완료',
        catalogOnly: true,
        generatedMpn: false,
        commercialDataAvailable: false,
        samplepcbPreferred: true,
      },
      offers: [
        {
          supplier: 'yeonho',
          supplier_sku: yeonhoTarget.mpn,
          price_breaks: [],
          fetched_at: '2026-07-26T00:00:00.000Z',
        },
        {
          supplier: 'samplepcb',
          supplier_sku: yeonhoTarget.mpn,
          price_breaks: [],
          fetched_at: '2026-07-26T00:00:00.000Z',
        },
      ],
    },
    offers: [
      { supplier: 'yeonho', supplierSku: yeonhoTarget.mpn },
      { supplier: 'samplepcb', supplierSku: yeonhoTarget.mpn },
    ],
  };
}

describe('Walsin 전체 가격 스냅샷 옵션', () => {
  it('기본 실행은 API를 호출하지 않는 dry-run이다', () => {
    expect(parseCatalogPriceRefreshOptions([])).toMatchObject({
      mode: 'dry-run',
      resume: false,
      retryMisses: false,
      retrySupplierErrors: false,
      concurrency: 1,
      batchSize: 100,
      maxCalls: 12,
      jobTimeoutSeconds: 300,
      suppliers: ['digikey', 'mouser', 'unikeyic'],
      limit: null,
    });
  });

  it('resume은 prepare 없이 사용할 수 없다', () => {
    expect(() => parseCatalogPriceRefreshOptions(['--resume'])).toThrow(
      '--resume, --retry-misses, --retry-supplier-errors는 --prepare에서만 사용할 수 있습니다',
    );
  });

  it('전 공급사 완료 강제 검증은 verify 전용이다', () => {
    expect(parseCatalogPriceRefreshOptions([
      '--verify',
      '--require-all-suppliers',
    ]).requireAllSuppliers).toBe(true);
    expect(() => parseCatalogPriceRefreshOptions([
      '--prepare',
      '--require-all-suppliers',
    ])).toThrow('--require-all-suppliers는 --verify와 함께 사용해야 합니다');
  });

  it('prepare는 제한된 병렬도와 부분 실행을 지원한다', () => {
    expect(parseCatalogPriceRefreshOptions([
      '--prepare',
      '--resume',
      '--limit',
      '100',
      '--concurrency',
      '4',
      '--batch-size',
      '20',
      '--job-timeout-seconds',
      '240',
      '--suppliers',
      'mouser,unikeyic',
    ])).toMatchObject({
      mode: 'prepare',
      resume: true,
      limit: 100,
      concurrency: 4,
      batchSize: 20,
      jobTimeoutSeconds: 240,
      suppliers: ['mouser', 'unikeyic'],
    });
  });

  it('연호 원본은 독립된 상태와 스냅샷 기본 경로를 사용한다', () => {
    const options = parseCatalogPriceRefreshOptions([
      '--source',
      'yeonho',
    ]);
    expect(options).toMatchObject({
      source: 'yeonho',
    });
    expect(options.sourceFile).toContain('yeonho-connectors-2026-07-17');
    expect(options.stateFile).toContain(
      'yeonho-connectors-2026-07-17\\prepared-prices\\work-state.json',
    );
    expect(options.snapshotFile).toContain(
      'yeonho-price-snapshot-v1.json.gz',
    );
  });

  it('재개 시 미시도 대상을 오류 재시도보다 먼저 처리한다', () => {
    const retryTarget = { ...target, key: 'walsin:RETRY', mpn: 'RETRY' };
    const doneTarget = { ...target, key: 'walsin:DONE', mpn: 'DONE' };
    const unseenTarget = { ...target, key: 'walsin:UNSEEN', mpn: 'UNSEEN' };

    expect(orderCatalogPriceSnapshotTargets(
      [retryTarget, doneTarget, unseenTarget],
      {
        [retryTarget.key]: {
          status: 'error',
          warnings: ['공급사 검색이 작업 시간 상한 60초를 초과했습니다.'],
        },
        [doneTarget.key]: { status: 'priced', warnings: [] },
      },
      false,
    ).map((value) => value.key)).toEqual([
      unseenTarget.key,
      retryTarget.key,
    ]);
  });

  it('공급사별 오류는 명시한 경우에만 재시도하고 전체 미완료는 항상 재시도한다', () => {
    const supplierError = {
      ...target,
      key: 'walsin:SUPPLIER',
      mpn: 'SUPPLIER',
    };
    const timeout = { ...target, key: 'walsin:TIMEOUT', mpn: 'TIMEOUT' };
    const records = {
      [supplierError.key]: {
        status: 'not_found' as const,
        warnings: ['digikey: http_429'],
      },
      [timeout.key]: {
        status: 'not_found' as const,
        warnings: ['공급사 검색이 작업 시간 상한 300초를 초과했습니다.'],
      },
    };

    expect(orderCatalogPriceSnapshotTargets(
      [supplierError, timeout],
      records,
      false,
    ).map((value) => value.key)).toEqual([timeout.key]);
    expect(orderCatalogPriceSnapshotTargets(
      [supplierError, timeout],
      records,
      false,
      true,
      ['mouser', 'unikeyic'],
    ).map((value) => value.key)).toEqual([timeout.key]);
    expect(orderCatalogPriceSnapshotTargets(
      [supplierError, timeout],
      records,
      false,
      true,
    ).map((value) => value.key)).toEqual([
      supplierError.key,
      timeout.key,
    ]);
  });

  it('공급사별 분할 수집은 기존 구매 조건을 보존하고 재조회 공급사만 교체한다', () => {
    const mouser = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 2,
          components: [{
            candidates: [{
              product: product(
                target.mpn,
                'Walsin',
                [{ quantity: 1, unit_price: 160, currency: 'KRW' }],
                'mouser',
              ),
            }],
            warnings: [],
          }],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );
    const digikey = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{
            candidates: [{
              product: product(
                target.mpn,
                'Walsin',
                [{ quantity: 1, unit_price: 150, currency: 'KRW' }],
              ),
            }],
            warnings: [],
          }],
        },
      },
      target,
      '2026-07-27T00:00:00.000Z',
    );

    const merged = mergeCatalogPriceRefreshRecord(
      digikey,
      {
        ...mouser,
        warnings: [
          'digikey: not_requested_for_snapshot',
          'unikeyic: not_requested_for_snapshot',
        ],
        attemptedSuppliers: ['mouser'],
        attempts: 1,
        error: null,
      },
      ['digikey'],
    );

    expect(merged.products.map((value) => value.supplier)).toEqual([
      'digikey',
      'mouser',
    ]);
    expect(merged.apiCalls).toBe(5);
    expect(merged.warnings).toEqual([
      'unikeyic: not_requested_for_snapshot',
    ]);
  });

  it('새 공급사만 추가 조회할 때 앞선 검색 미완료 경고를 숨기지 않는다', () => {
    const incompleteWarning =
      '공급사 검색이 작업 시간 상한 300초를 초과했습니다.';
    const digikey = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 1,
          components: [{
            candidates: [],
            warnings: [],
          }],
        },
      },
      target,
      '2026-07-27T00:00:00.000Z',
    );

    const merged = mergeCatalogPriceRefreshRecord(
      digikey,
      {
        ...digikey,
        warnings: [
          incompleteWarning,
          'digikey: not_requested_for_snapshot',
        ],
        attemptedSuppliers: ['mouser', 'unikeyic'],
        attempts: 1,
        error: 'supplier_partial_error',
        status: 'error',
      },
      ['digikey'],
    );

    expect(merged.warnings).toContain(incompleteWarning);
  });

  it('앞서 시도한 공급사를 전부 재조회하면 지난 검색 미완료 경고를 제거한다', () => {
    const incompleteWarning =
      '공급사 검색이 작업 시간 상한 300초를 초과했습니다.';
    const current = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 2,
          components: [{
            candidates: [],
            warnings: [],
          }],
        },
      },
      target,
      '2026-07-27T00:00:00.000Z',
    );

    const merged = mergeCatalogPriceRefreshRecord(
      current,
      {
        ...current,
        warnings: [incompleteWarning],
        attemptedSuppliers: ['mouser', 'unikeyic'],
        attempts: 1,
        error: 'supplier_partial_error',
        status: 'error',
      },
      ['mouser', 'unikeyic'],
    );

    expect(merged.warnings).not.toContain(incompleteWarning);
  });
});

describe('카탈로그 가격 스냅샷 적용 옵션', () => {
  it('연호 원본에도 검증된 가격 스냅샷을 함께 적용할 수 있다', () => {
    const options = parseCatalogImportOptions([
      '--dry-run',
      '--source',
      'yeonho',
      '--price-snapshot',
      'yeonho-price-snapshot-v1.json.gz',
    ]);
    expect(options).toMatchObject({
      mode: 'dry-run',
      source: 'yeonho',
    });
    expect(options.priceSnapshot).toContain(
      'yeonho-price-snapshot-v1.json.gz',
    );
  });

  it('가격 스냅샷과 일방향 교체를 한 실행에서 섞지 않는다', () => {
    expect(() => parseCatalogImportOptions([
      '--replace',
      '--source',
      'yeonho',
      '--retire-source-sha',
      'a'.repeat(64),
      '--price-snapshot',
      'yeonho-price-snapshot-v1.json.gz',
    ])).toThrow('--price-snapshot은 --replace/--rollback과 함께 사용할 수 없습니다');
  });
});

describe('Walsin 전체 가격 스냅샷 데이터', () => {
  it('정확 MPN과 제조사 후보만 보존한다', () => {
    const record = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 4,
          components: [
            {
              candidates: [
                {
                  product: product(
                    'WR04X1001FTL',
                    'Walsin Technology Corporation',
                    [{ quantity: 1, unit_price: 155, currency: 'KRW' }],
                  ),
                },
                {
                  product: product(
                    'RC0402FR-071KL',
                    'Yageo',
                    [{ quantity: 1, unit_price: 120, currency: 'KRW' }],
                  ),
                },
                {
                  product: product(
                    'WR04X1001FTL',
                    'Other',
                    [{ quantity: 1, unit_price: 100, currency: 'KRW' }],
                  ),
                },
              ],
              warnings: [],
            },
          ],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );

    expect(record.status).toBe('priced');
    expect(record.products).toHaveLength(1);
    expect(record.products[0]?.manufacturer_part_number).toBe('WR04X1001FTL');
    expect(record.products[0]?.manufacturer).toBe('Walsin Technology Corporation');
    expect(record.apiCalls).toBe(4);
  });

  it('exact 후보가 없으면 정상 not_found 레코드로 남긴다', () => {
    const record = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{ candidates: [], warnings: ['no exact result'] }],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );

    expect(record).toMatchObject({
      status: 'not_found',
      products: [],
      warnings: ['no exact result'],
      apiCalls: 3,
    });
  });

  it('배치 응답은 대상 component의 후보·경고·호출 수만 사용한다', () => {
    const otherTarget = {
      ...target,
      key: 'walsin:WR04X1002FTL',
      mpn: 'WR04X1002FTL',
      mpnNorm: 'WR04X1002FTL',
    };
    const envelope = {
      search: {
        api_calls: 7,
        components: [
          {
            component_id: target.key,
            api_calls: 3,
            candidates: [{
              product: product(
                target.mpn,
                'Walsin',
                [{ quantity: 1, unit_price: 155, currency: 'KRW' }],
              ),
            }],
            warnings: [],
          },
          {
            component_id: otherTarget.key,
            api_calls: 4,
            candidates: [],
            warnings: ['digikey: upstream_timeout'],
          },
        ],
      },
    };

    expect(exactWalsinPriceSnapshotRecord(
      envelope,
      target,
      '2026-07-26T00:00:00.000Z',
      target.key,
    )).toMatchObject({
      status: 'priced',
      warnings: [],
      apiCalls: 3,
    });
    expect(exactWalsinPriceSnapshotRecord(
      envelope,
      otherTarget,
      '2026-07-26T00:00:00.000Z',
      otherTarget.key,
    )).toMatchObject({
      status: 'not_found',
      warnings: ['digikey: upstream_timeout'],
      apiCalls: 4,
    });
  });

  it('공급사 오류 경고는 후보 유무와 무관하게 재시도 대상으로 식별한다', () => {
    expect(walsinSnapshotSupplierErrors([
      '공급사별 기술 상위 후보만 유지했습니다.',
      'digikey: upstream_timeout',
      'mouser: quota_exhausted',
      '공급사 검색이 작업 시간 상한 60초를 초과했습니다.',
      '실시간 공급사 갱신이 작업 시간 상한을 초과해 사용 가능한 캐시 결과를 사용했습니다.',
      '공급사 검색 작업을 완료하지 못했습니다.',
    ])).toEqual([
      'digikey: upstream_timeout',
      'mouser: quota_exhausted',
      '공급사 검색이 작업 시간 상한 60초를 초과했습니다.',
      '실시간 공급사 갱신이 작업 시간 상한을 초과해 사용 가능한 캐시 결과를 사용했습니다.',
      '공급사 검색 작업을 완료하지 못했습니다.',
    ]);
    expect(walsinSnapshotBlockingErrors([
      'digikey: http_429',
      '공급사 검색이 작업 시간 상한 60초를 초과했습니다.',
    ])).toEqual([
      '공급사 검색이 작업 시간 상한 60초를 초과했습니다.',
    ]);
  });

  it('공급사별 제한은 감사 경고로 허용하고 전체 미완료는 확정 스냅샷에서 거부한다', () => {
    const supplierLimited = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{
            candidates: [],
            warnings: ['digikey: not_requested_for_snapshot'],
          }],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );
    const accepted = buildWalsinPriceSnapshotArtifact(
      'Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
      [supplierLimited],
      '2026-07-26T00:00:00.000Z',
    );

    expect(validateWalsinPriceSnapshotCoverage(
      accepted,
      [catalogRecord()],
    ).summary.supplierErrorRecords).toBe(1);

    const timedOut = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{
            candidates: [],
            warnings: ['공급사 검색이 작업 시간 상한 300초를 초과했습니다.'],
          }],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );
    const rejected = buildWalsinPriceSnapshotArtifact(
      'Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
      [timedOut],
      '2026-07-26T00:00:00.000Z',
    );

    expect(() => validateWalsinPriceSnapshotCoverage(
      rejected,
      [catalogRecord()],
    )).toThrow('가격 스냅샷에 미완료 검색이 남았습니다');
  });

  it('확정 스냅샷은 공급사 구매 조건 인제스트 envelope로 결정적으로 변환한다', () => {
    const record = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 4,
          components: [
            {
              candidates: [{
                product: product(
                  'WR04X1001FTL',
                  'Walsin Technology Corporation',
                  [{ quantity: 1, unit_price: 155, currency: 'KRW' }],
                ),
              }],
              warnings: [],
            },
          ],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );
    const artifact = buildWalsinPriceSnapshotArtifact(
      'Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
      [record],
      '2026-07-26T00:00:00.000Z',
    );
    const envelope = walsinPriceSnapshotIngestEnvelope(artifact) as {
      search: {
        components: {
          component_id: string;
          candidates: { product: { offers: unknown[] } }[];
        }[];
      };
    };

    expect(summarizeWalsinPriceSnapshotRecords([record])).toMatchObject({
      targets: 1,
      priced: 1,
      exactProducts: 1,
      supplierOffers: 1,
      pricedOffers: 1,
      priceBreaks: 1,
      apiCalls: 4,
    });
    expect(envelope.search.components).toHaveLength(1);
    expect(envelope.search.components[0]?.component_id).toBe(
      'walsin-price:walsin:WR04X1001FTL',
    );
    expect(envelope.search.components[0]?.candidates[0]?.product.offers).toHaveLength(1);
    expect(validateWalsinPriceSnapshotCoverage(
      artifact,
      [catalogRecord()],
    ).summary.targets).toBe(1);
    expect(() => validateWalsinPriceSnapshotCoverage(
      artifact,
      [
        catalogRecord(),
        catalogRecord('walsin:WR04X1002FTL', 'WR04X1002FTL'),
      ],
    )).toThrow('가격 스냅샷 대상이 부족합니다');
  });

  it('가격구간을 DB 저장 규칙으로 정준화하고 상태 변조를 거부한다', () => {
    const record = exactWalsinPriceSnapshotRecord(
      {
        search: {
          api_calls: 1,
          components: [{
            candidates: [{
              product: product(
                'WR04X1001FTL',
                'Walsin',
                [
                  { quantity: 10, unit_price: 90, currency: 'KRW' },
                  { quantity: 1, unit_price: 155, currency: 'KRW' },
                  { quantity: 10, unit_price: 80, currency: 'KRW' },
                ],
              ),
            }],
            warnings: [],
          }],
        },
      },
      target,
      '2026-07-26T00:00:00.000Z',
    );
    const artifact = buildWalsinPriceSnapshotArtifact(
      'Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
      [record],
      '2026-07-26T00:00:00.000Z',
    );

    expect(
      artifact.records[0]?.products[0]?.offers[0]?.price_breaks,
    ).toEqual([
      { quantity: 1, unit_price: 155, currency: 'KRW' },
      { quantity: 10, unit_price: 80, currency: 'KRW' },
    ]);
    const tampered: unknown = {
      ...artifact,
      records: artifact.records.map((value) => ({
        ...value,
        status: 'not_found',
      })),
    };
    expect(() => validateWalsinPriceSnapshotCoverage(
      tampered,
      [catalogRecord()],
    )).toThrow('상태와 구매 조건의 가격이 다릅니다');
  });
});

describe('연호 전체 가격 스냅샷 데이터', () => {
  it('정확 MPN과 연호 제조사가 함께 맞는 외부 상품만 보존한다', () => {
    const record = exactCatalogPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{
            component_id: yeonhoTarget.key,
            api_calls: 3,
            candidates: [
              {
                product: product(
                  yeonhoTarget.mpn,
                  'YEONHO ELECTRONICS',
                  [{ quantity: 1, unit_price: 320, currency: 'KRW' }],
                ),
              },
              {
                product: product(
                  yeonhoTarget.mpn,
                  'JST',
                  [{ quantity: 1, unit_price: 100, currency: 'KRW' }],
                ),
              },
            ],
            warnings: [],
          }],
        },
      },
      yeonhoTarget,
      '2026-07-27T00:00:00.000Z',
      yeonhoTarget.key,
    );

    expect(record.status).toBe('priced');
    expect(record.products).toHaveLength(1);
    expect(record.products[0]?.manufacturer).toBe('YEONHO ELECTRONICS');
  });

  it('연호 버전·원본 해시·component prefix를 함께 고정한다', () => {
    const record = exactCatalogPriceSnapshotRecord(
      {
        search: {
          api_calls: 1,
          components: [{
            candidates: [{
              product: product(
                yeonhoTarget.mpn,
                'YEONHO ELECTRONICS',
                [{ quantity: 1, unit_price: 320, currency: 'KRW' }],
              ),
            }],
            warnings: [],
          }],
        },
      },
      yeonhoTarget,
      '2026-07-27T00:00:00.000Z',
    );
    const artifact = buildCatalogPriceSnapshotArtifact(
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
      '연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
      [record],
      '2026-07-27T00:00:00.000Z',
    );
    const verified = validateCatalogPriceSnapshotCoverage(
      artifact,
      [yeonhoCatalogRecord()],
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
    );
    const envelope = catalogPriceSnapshotIngestEnvelope(
      verified,
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
    ) as {
      search: { components: { component_id: string }[] };
    };

    expect(verified.schemaVersion).toBe(
      'yeonho-catalog-price-snapshot/v1',
    );
    expect(verified.source.sha256).toBe(
      YEONHO_PRICE_SNAPSHOT_DEFINITION.sourceSha256,
    );
    expect(envelope.search.components[0]?.component_id).toBe(
      `yeonho-price:${yeonhoTarget.key}`,
    );
    expect(() => validateCatalogPriceSnapshotCoverage(
      artifact,
      [yeonhoCatalogRecord()],
      {
        ...YEONHO_PRICE_SNAPSHOT_DEFINITION,
        source: 'walsin-rlc',
        artifactVersion: 'walsin-catalog-price-snapshot/v1',
        manifestVersion: 'walsin-catalog-price-snapshot-manifest/v1',
        componentIdPrefix: 'walsin-price',
      },
    )).toThrow('선택한 카탈로그와 다릅니다');
  });

  it('전 공급사 exact 결과가 없어도 coverage와 빈 인제스트 입력은 유효하다', () => {
    const record = exactCatalogPriceSnapshotRecord(
      {
        search: {
          api_calls: 3,
          components: [{ candidates: [], warnings: [] }],
        },
      },
      yeonhoTarget,
      '2026-07-27T00:00:00.000Z',
    );
    const artifact = buildCatalogPriceSnapshotArtifact(
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
      '연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
      [record],
      '2026-07-27T00:00:00.000Z',
    );
    const envelope = catalogPriceSnapshotIngestEnvelope(
      artifact,
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
    );

    expect(artifact.summary).toMatchObject({
      targets: 1,
      exactProducts: 0,
      supplierOffers: 0,
      notFound: 1,
    });
    expect(supplierSearchIngestFingerprint(envelope)).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(validateCatalogPriceSnapshotCoverage(
      artifact,
      [yeonhoCatalogRecord()],
      YEONHO_PRICE_SNAPSHOT_DEFINITION,
    ).summary.targets).toBe(1);
  });
});
