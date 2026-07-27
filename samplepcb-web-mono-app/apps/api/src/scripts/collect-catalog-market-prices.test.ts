import { describe, expect, it } from 'vitest';
import { parseCatalogMarketPriceOptions } from './collect-catalog-market-prices';

describe('collect-catalog-market-prices CLI', () => {
  it('네트워크 실행은 site를 요구하고 기본 최소 간격은 500ms다', () => {
    expect(() => parseCatalogMarketPriceOptions(['--run']))
      .toThrow('--site');

    const options = parseCatalogMarketPriceOptions([
      '--run',
      '--site',
      'eleparts',
    ]);
    expect(options.delayMs).toBe(500);
    expect(options.jitterMs).toBe(0);
    expect(options.site).toBe('eleparts');
    expect(options.source).toBe('walsin-rlc');
  });

  it('500ms보다 짧은 간격과 merge의 site 혼용을 거부한다', () => {
    expect(() => parseCatalogMarketPriceOptions([
      '--run',
      '--site',
      'icbanq',
      '--delay-ms',
      '499',
    ])).toThrow('--delay-ms');
    expect(() => parseCatalogMarketPriceOptions([
      '--merge',
      '--site',
      'eleparts',
    ])).toThrow('--site');
  });

  it('7개 제조사 별칭을 리포 정규키로 접는다', () => {
    const options = parseCatalogMarketPriceOptions([
      '--site',
      'eleparts',
      '--manufacturers',
      'Walsin,Yageo,Samsung,TDK,Murata,Vishay Dale,KOA Speer',
    ]);
    expect(options.manufacturerNorms).toEqual([
      'koa',
      'murata',
      'samsung',
      'tdk',
      'vishay',
      'walsin',
      'yageo',
    ]);
  });

  it('연호 소스는 전용 워크북·v1·v2 경로를 선택한다', () => {
    const options = parseCatalogMarketPriceOptions([
      '--source',
      'yeonho',
      '--site',
      'icbanq',
    ]);
    expect(options.source).toBe('yeonho');
    expect(options.sourceFile).toContain(
      'yeonho-connectors-2026-07-17',
    );
    expect(options.baseSnapshotFile).toContain(
      'yeonho-price-snapshot-v1.json.gz',
    );
    expect(options.mergedSnapshotFile).toContain(
      'yeonho-price-snapshot-v2.json.gz',
    );
    expect(options.outputDir).toContain('prepared-prices');
    expect(options.outputDir).toContain('v2');
    expect(() => parseCatalogMarketPriceOptions([
      '--source',
      'unknown',
    ])).toThrow('--source');
  });
});
