// /api/pcb-pricing 라우트 파리티 테스트 (오프라인).
//
// 골든 fixture(legacy-pricing-goldens.json)의 레거시 body 를 라우트에 재생해, 레거시
// public 응답과의 동형성을 검증한다. 엔진 계산 자체의 파리티는 legacy-parity.test.ts 가
// 보증하고, 여기는 그 위의 "레거시 진입점 재현 + public 직렬화" 층을 고정한다.
//
// 일치 기준(파리티 테스트와 같은 계층):
//  - standard/metalMask(자동견적 메뉴) · advanceMetal/flexibleFPCB(하드코딩) → 응답 완전 일치
//  - 그 외(advanceFR4 등 미지원 메뉴) → 가격 의미('0원')만 일치. 레거시는 PHP Warning 을
//    내며 무게·eta 부산물을 채우지만 재현 대상이 아니다(docs/pricing-engine-parity.md).
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pcbPricingRoutes } from './pcb-pricing';
import fixture from '../pricing/__fixtures__/legacy-pricing-goldens.json';

// 라이브 가격표 조회를 번들 스냅샷으로 고정 — fixture 는 스냅샷과 같은 표 기준이고
// (legacy-parity.test.ts 첫 케이스가 sha 로 보증), 테스트는 네트워크를 타지 않는다.
vi.mock('../pricing/live-pricing', async () => {
  const { BUNDLED_PRICING } = await import('../pricing/engine');
  return { getFreshPricingData: () => Promise.resolve(BUNDLED_PRICING) };
});

interface FixtureCase {
  id: string;
  note: string;
  body: Record<string, string>;
  publicData: { result?: boolean; data?: Record<string, string> } | null;
}

const FULL_PARITY_MENUS = new Set(['standard', 'metalMask']);
const HARDCODED_MENUS = new Set(['advanceMetal', 'flexibleFPCB']);

// 레거시 calEta 는 서버(KST) 날짜 기준 → 캡처 당시로 Date 만 고정한다.
// (타이머류는 fake 하지 않는다 — fastify ready/inject 가 setImmediate 에 의존.)
const NOW = new Date(`${fixture.capturedDateKst}T09:00:00+09:00`);

const app = Fastify();
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
await app.register(pcbPricingRoutes, { prefix: '/api' });

const post = async (payload: unknown): Promise<{ status: number; json: unknown }> => {
  const res = await app.inject({ method: 'POST', url: '/api/pcb-pricing', payload: payload as object });
  return { status: res.statusCode, json: res.json() };
};

beforeAll(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
});
afterAll(async () => {
  vi.useRealTimers();
  await app.close();
});

describe('/api/pcb-pricing 레거시 응답 동형성 (fixture 실측 대조)', () => {
  const cases = fixture.cases as FixtureCase[];

  it.each(cases.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
    const { status, json } = await post(c.body);
    expect(status).toBe(200);

    const menu = c.body.menu ?? '';
    if (FULL_PARITY_MENUS.has(menu) || HARDCODED_MENUS.has(menu)) {
      expect(json, `${c.id}: ${c.note}`).toEqual(c.publicData);
      return;
    }
    // 미지원 메뉴 — 가격 의미만 고정
    const r = json as { result?: boolean; data?: Record<string, string> };
    expect(r.result, `${c.id}: result`).toBe(true);
    expect(r.data?.listPriceWithRate, `${c.id}: ${c.note}`).toBe(
      c.publicData?.data?.listPriceWithRate,
    );
  });
});

describe('레거시 엔트리 필수값·미지원 케이스 재현', () => {
  it('standard 에서 layers/width/length/qty 누락 → required param', async () => {
    const { json } = await post({ menu: 'standard', category: 'sample', width: '100', length: '100', qty: '5' });
    expect(json).toEqual({ result: false, message: 'required param' });
  });

  it('MetalMask 에서 frame/size 누락 → required param', async () => {
    const { json } = await post({ menu: 'MetalMask', size: '300x400', qty: '1' });
    expect(json).toEqual({ result: false, message: 'required param' });
  });

  it('MetalMask 해외 스텐실(placeOfOrigin)은 명시적 미지원 — 국내가로 조용히 계산하지 않는다', async () => {
    const { json } = await post({
      menu: 'MetalMask', frame: 'nonFramework', size: '300x400', qty: '1', placeOfOrigin: 'China',
    });
    const r = json as { result: boolean; message?: string };
    expect(r.result).toBe(false);
    expect(r.message).toContain('placeOfOrigin');
  });

  it('advanceMetal 은 필수값이 없어도 하드코딩 0원 (레거시 분기 순서 동형)', async () => {
    const { json } = await post({ menu: 'advanceMetal' });
    expect(json).toEqual({
      result: true,
      data: {
        buildTimeWithUnit: '0일', eta: '미정', listPriceWithRate: '0원',
        placeOfOrigin: '', weightWithUnit: '',
      },
    });
  });
});
