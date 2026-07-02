import { describe, expect, it } from 'vitest';
import { calEta, calculateQuote } from './engine';

// ── PHP 골든 값 ─────────────────────────────────────────────────────────────
// 레거시 pcb_price*.lib.php 를 PHP 8.2 CLI 로 직접 실행해 얻은 기대값(2026-07-02).
// 재생성 절차: 레거시 lib + pricing_data.json 복사 → 하드코딩 경로/그누보드 세션/
// 휴일 API 의존만 패치 → harness 로 케이스 실행. 값이 다르면 이식 버그다.
const NOW = new Date('2026-07-02T09:00:00+09:00');

describe('calculateQuote — Standard (PHP 골든 대조)', () => {
  it('c1: 소형 고정가 70.2x70.2 2L qty5 → 35,000원 (int 캐스팅 70 포함)', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'sample',
      qty: 5,
      now: NOW,
      spec: {
        layers: '2',
        width: '70.200',
        length: '70.200',
        pcbThickness: '1.6',
        surfaceFinish: 'hasl',
        copperWeights: '1oz',
        solderMask: 'green',
        minTraceSpacing: '6/6mil',
        minHole: '0.3mm',
        halfHole: 'no',
        goldFingers: 'no',
        diffDesign: '1',
        edgeRail: 'no',
      },
    });
    expect(r.listPrice).toBe(35_000);
    expect(r.buildTimeDays).toBe(4);
    expect(r.weightKg).toBe('0.08');
    expect(r.eta).toBe('2026.07.13');
    expect(r.placeOfOrigin).toBe('중국');
  });

  it('c2: 150x150 2L qty20 panel 2x2(실수량 80) 옵션다수 → 547,000원', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'sample',
      qty: 20,
      now: NOW,
      spec: {
        layers: '2',
        width: '150',
        length: '150',
        panel: '2x2',
        pcbThickness: '1.6',
        surfaceFinish: 'enig',
        copperWeights: '1oz',
        solderMask: 'blue',
        minTraceSpacing: '5/5mil',
        minHole: '0.25mm',
        halfHole: 'yes',
        goldFingers: 'yes',
        diffDesign: '3',
        edgeRail: 'yes',
      },
    });
    expect(r.listPrice).toBe(547_000);
    expect(r.buildTimeDays).toBe(6);
    expect(r.weightKg).toBe('5.94');
  });

  it('c3: 4층 소형 고정가 87,000 + 옵션(내부동박 포함) → 257,000원', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'sample',
      qty: 5,
      now: NOW,
      spec: {
        layers: '4',
        width: '80',
        length: '90',
        pcbThickness: '0.8',
        surfaceFinish: 'osp',
        copperWeights: '2oz',
        solderMask: 'red',
        minTraceSpacing: '4/4mil',
        minHole: '0.2mm',
        finishedCopperAdvance: '2oz',
        diffDesign: '2',
      },
    });
    expect(r.listPrice).toBe(257_000);
    expect(r.buildTimeDays).toBe(6);
    expect(r.weightKg).toBe('0.12');
  });

  it('c4: diffDesign 부재 → 레거시 버그 재현으로 가격 0원 = rfq(null)', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'sample',
      qty: 50,
      now: NOW,
      spec: {
        layers: '6',
        width: '200',
        length: '250',
        pcbThickness: '2.0',
        surfaceFinish: 'haslLf',
        copperWeights: '0.5oz',
        solderMask: 'white',
        minTraceSpacing: '6/6mil',
        minHole: '0.3mm',
        impedance: '50',
      },
    });
    expect(r.listPrice).toBeNull();
    expect(r.buildTimeDays).toBe(10);
    expect(r.weightKg).toBe('8.25');
  });

  it('양산(mass)은 가격 미표시 → rfq(null)', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'mass',
      qty: 1000,
      now: NOW,
      spec: { layers: '2', width: '100', length: '100', diffDesign: '1' },
    });
    expect(r.listPrice).toBeNull();
  });
});

describe('calculateQuote — MetalMask 국내가 (PHP 골든 대조)', () => {
  it('c5: framework 400x320 + Both Side, qty2 → 220,000원 (국내, 1일)', () => {
    const r = calculateQuote({
      category: 'metalMask',
      orderCategory: 'sample',
      qty: 2,
      now: NOW,
      spec: { framework: 'framework', size: '400x320', stencilSide: 'Both Side' },
    });
    expect(r.listPrice).toBe(220_000);
    expect(r.buildTimeDays).toBe(1);
    expect(r.eta).toBe('2026.07.08');
    expect(r.placeOfOrigin).toBe('국내');
  });

  it('c6: 논프레임 미지정 사이즈 → 기본 85,000원', () => {
    const r = calculateQuote({
      category: 'metalMask',
      orderCategory: 'sample',
      qty: 1,
      now: NOW,
      spec: { framework: 'nonframework', size: 'customXY', stencilSide: 'Top Side' },
    });
    expect(r.listPrice).toBe(85_000);
  });
});

describe('calculateQuote — 미지원 메뉴는 rfq', () => {
  it.each(['advance', 'flexible', 'flexibleFPCB', 'flexibleRigid'])('%s → null', (category) => {
    const r = calculateQuote({
      category,
      orderCategory: 'sample',
      qty: 1,
      now: NOW,
      spec: {},
    });
    expect(r.listPrice).toBeNull();
    expect(r.eta).toBe('');
  });
});

describe('calEta — 주말 스킵 (제작일 + 배송 3일)', () => {
  it('수요일 기준 4+3 영업일 → 다다음주 월요일', () => {
    expect(calEta(4, NOW)).toBe('2026.07.13');
  });
  it('금요일 시작이면 주말 건너뜀 (1+3 영업일 → 목요일)', () => {
    expect(calEta(1, new Date('2026-07-03T09:00:00+09:00'))).toBe('2026.07.09');
  });
});
