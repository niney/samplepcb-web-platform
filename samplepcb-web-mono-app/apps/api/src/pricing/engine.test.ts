import { describe, expect, it } from 'vitest';
import { calEta, calculateQuote } from './engine';

// ── 골든 값 ─────────────────────────────────────────────────────────────────
// 기대값은 라이브 레거시 API(samplepcb_pricing_api.php) 실측(2026-07-03 캡처,
// __fixtures__/legacy-pricing-goldens.json 의 g-c* 케이스)이다. 값이 다르면 이식 버그.
// 가격표(pricing-data.json)를 재동기화하면 `pnpm pricing:capture` 로 골든도 재캡처할 것.
// 전 케이스 매트릭스 대조는 legacy-parity.test.ts 가 담당하고, 여기는 대표 케이스만 둔다.
const NOW = new Date('2026-07-02T09:00:00+09:00');

describe('calculateQuote — Standard (레거시 실측 골든)', () => {
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
        differentDesign: '1',
        edgeRail: 'no',
      },
    });
    expect(r.listPrice).toBe(35_000);
    expect(r.buildTimeDays).toBe(4);
    expect(r.weightKg).toBe('0.08');
    expect(r.eta).toBe('2026.07.09');
    expect(r.placeOfOrigin).toBe('중국');
  });

  it('c2: 150x150 2L qty20 panel 2x2(실수량 80) 옵션다수 + differentDesign 3 → 643,000원', () => {
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
        differentDesign: '3',
        edgeRail: 'yes',
        cutting: 'Single', // 캡처 케이스(g-c2)와 동일 — 새 표는 컷팅에도 옵션가(+2 USD)가 있다
      },
    });
    expect(r.listPrice).toBe(643_000);
    expect(r.buildTimeDays).toBe(6);
    expect(r.weightKg).toBe('5.94');
  });

  it('c3: 4층 소형 고정가 87,000 + 옵션(내부동박 포함) + differentDesign 2 → 280,000원', () => {
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
        differentDesign: '2',
      },
    });
    expect(r.listPrice).toBe(280_000);
    expect(r.buildTimeDays).toBe(6);
    expect(r.weightKg).toBe('0.12');
  });

  it('differentDesign 가산금: N개 디자인 → 1개 대비 개당 25,000 × (N-1) 만큼만 증가', () => {
    const base = {
      category: 'standard' as const,
      orderCategory: 'sample' as const,
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
        edgeRail: 'yes',
      },
    };
    const one = calculateQuote({ ...base, spec: { ...base.spec, differentDesign: '1' } });
    const three = calculateQuote({ ...base, spec: { ...base.spec, differentDesign: '3' } });
    expect(one.listPrice).not.toBeNull();
    expect(three.listPrice).not.toBeNull();
    expect((three.listPrice ?? 0) - (one.listPrice ?? 0)).toBe(25_000 * (3 - 1));
  });

  it('c4: differentDesign 부재 → 가격 0원 = rfq(null) (주문버튼 숨김 → 견적요청 유도)', () => {
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
    expect(r.buildTimeDays).toBe(14);
    expect(r.weightKg).toBe('8.25');
  });

  it('panel 과도기 값("yes")은 레거시 getPanel 재현으로 수량 0 → 무게 0', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'sample',
      qty: 5,
      now: NOW,
      spec: {
        layers: '2',
        width: '160',
        length: '156',
        panel: 'yes',
        edgeRail: '7mm',
        differentDesign: '1',
      },
    });
    expect(r.weightKg).toBe('0');
  });

  it('양산(mass)은 가격 미표시 → rfq(null)', () => {
    const r = calculateQuote({
      category: 'standard',
      orderCategory: 'mass',
      qty: 1000,
      now: NOW,
      spec: { layers: '2', width: '100', length: '100', differentDesign: '1' },
    });
    expect(r.listPrice).toBeNull();
  });
});

describe('calculateQuote — MetalMask 국내가 (레거시 실측 골든)', () => {
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
    expect(r.eta).toBe('2026.07.06');
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

// 레거시 EtaLib 실동작: 달력일로 (제작일+배송 3일) 가산, 종료일이 토요일이면 +2 / 일요일이면 +1.
describe('calEta — 달력일 가산 + 종료일 주말 보정', () => {
  it('평일 종료면 보정 없음 (목 + 4+3일 → 다음주 목요일)', () => {
    expect(calEta(4, NOW)).toBe('2026.07.09');
  });
  it('토요일 종료면 +2일 → 월요일', () => {
    expect(calEta(6, NOW)).toBe('2026.07.13'); // 07-11(토) → 07-13(월)
  });
  it('일요일 종료면 +1일 → 월요일', () => {
    expect(calEta(7, NOW)).toBe('2026.07.13'); // 07-12(일) → 07-13(월)
  });
});
