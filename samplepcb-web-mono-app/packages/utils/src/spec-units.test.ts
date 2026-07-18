// spec-units 골든 벡터 검증 — 케이스 표(spec-units.cases.json)가 요구사항 명세다.
import { describe, expect, it } from 'vitest';
import cases from './spec-units.cases.json';
import {
  normalizePackageCode,
  packageVariants,
  parseQuery,
  parseSpecToken,
  roundSig,
  siRange,
  variantsFor,
  type SpecInterpretation,
  type SpecKind,
} from './spec-units';

const relClose = (a: number, b: number): boolean =>
  a === b || Math.abs(a - b) <= Math.abs(b) * 1e-6;

interface ExpectedInterp {
  kind: string;
  si: number;
  confidence?: string;
  tolerancePct?: number;
}

function findMatch(result: SpecInterpretation[], exp: ExpectedInterp): SpecInterpretation | undefined {
  return result.find(
    (r) =>
      r.kind === exp.kind &&
      relClose(r.si, exp.si) &&
      (exp.confidence === undefined || r.confidence === exp.confidence) &&
      (exp.tolerancePct === undefined || r.tolerancePct === exp.tolerancePct),
  );
}

describe('parseSpecToken (골든 벡터)', () => {
  for (const c of cases.parse) {
    it(`"${c.input}"`, () => {
      const result = parseSpecToken(c.input);
      if (c.expect.length === 0) {
        expect(result).toEqual([]);
        return;
      }
      for (const exp of c.expect as ExpectedInterp[]) {
        expect(
          findMatch(result, exp),
          `기대 해석 누락: ${JSON.stringify(exp)} — 실제: ${JSON.stringify(result)}`,
        ).toBeDefined();
      }
    });
  }
});

describe('variantsFor (골든 벡터)', () => {
  for (const c of cases.variants) {
    it(`${c.kind} ${String(c.si)}`, () => {
      const result = variantsFor(c.kind as SpecKind, c.si);
      for (const v of c.includes) {
        expect(result, `변형 누락: "${v}" — 실제: ${JSON.stringify(result)}`).toContain(v);
      }
    });
  }
});

describe('normalizePackageCode (골든 벡터)', () => {
  for (const c of cases.packages) {
    it(`"${c.input}"`, () => {
      const result = normalizePackageCode(c.input);
      if (c.canon === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(new Set(result ?? [])).toEqual(new Set(c.canon));
      }
    });
  }
  for (const c of cases.packageVariants) {
    it(`variants ${c.imperial}`, () => {
      expect(new Set(packageVariants(c.imperial))).toEqual(new Set(c.expect));
    });
  }
});

describe('parseQuery', () => {
  it('스펙·패키지·텍스트 3뷰 분리 + 단위 띄어쓰기 결합', () => {
    const q = parseQuery('GRM155 2.2 pF 0402');
    expect(q.texts).toEqual(['GRM155', '2.2pF', '0402']);
    expect(q.packageCodes).toEqual(['0402']);
    expect(findMatch(q.specs, { kind: 'capacitance', si: 2.2e-12, confidence: 'high' })).toBeDefined();
  });

  it('중복 해석은 high 우선으로 병합된다', () => {
    const q = parseQuery('4.7k 4k7');
    const res = q.specs.filter((s) => s.kind === 'resistance' && relClose(s.si, 4700));
    expect(res).toHaveLength(1);
    expect(res[0]?.confidence).toBe('high');
  });

  it('빈 쿼리', () => {
    expect(parseQuery('  ')).toEqual({ specs: [], packageCodes: [], texts: [] });
  });
});

describe('roundSig / siRange', () => {
  it('색인·쿼리 정준화 일치: 0.0022uF ≈ 2200pF', () => {
    const a = roundSig(0.0022 * 1e-6);
    const b = roundSig(2200 * 1e-12);
    const r = siRange(a);
    expect(b).toBeGreaterThanOrEqual(r.gte);
    expect(b).toBeLessThanOrEqual(r.lte);
  });
});
