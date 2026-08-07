// 레거시 가격 API 패리티 테스트 (오프라인).
//
// __fixtures__/legacy-pricing-goldens.json 은 docs/samplepcb-pricing-api-body-cases.md 의
// 실캡처 body 매트릭스를 라이브 레거시 API 에 재생해 저장한 골든이다(pnpm pricing:capture).
// 이 테스트는 각 케이스의 레거시 body 를 신규 QuoteInput 으로 변환해 calculateQuote 를
// 돌리고, 판매가·제작일·무게·eta 가 레거시 실측과 일치하는지 검증한다.
//
// 가격이 어긋나면: fixture 의 detail(레거시 중간값 usd/netTotal/transferCost/marginRate)과
// 엔진 계산을 단계별로 대조해 갈라지는 지점을 특정할 것.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateQuote } from './engine';
import { legacyBodyToQuoteInput } from './legacy-body-adapter';
import fixture from './__fixtures__/legacy-pricing-goldens.json';

// 레거시 body → QuoteInput 매핑은 legacy-body-adapter.ts 가 정본이다 — /api/pcb-pricing
// 라우트와 공유하므로, 이 테스트의 green 이 곧 라우트 입력 변환의 보증이 된다.

interface FixtureCase {
  id: string;
  note: string;
  body: Record<string, string>;
  publicData: { result?: boolean; data?: Record<string, string> } | null;
}

const parseWon = (s: string): number => parseInt(s.replaceAll(',', '').replace('원', ''), 10);

// 자동견적 지원 메뉴 — 이 메뉴들은 가격뿐 아니라 제작일/무게/eta 까지 전항목 대조.
// 그 외(advance*/flexible*)는 레거시도 가격표에 메뉴가 없어 0원 → 엔진 rfq(null)만 확인.
const FULL_PARITY_MENUS = new Set(['standard', 'metalMask']);

// 레거시 calEta 는 서버(KST) 날짜 기준 → 캡처 당시 KST 날짜로 now 를 고정해야 eta 가 맞다.
const NOW = new Date(`${fixture.capturedDateKst}T09:00:00+09:00`);

describe('레거시 가격 API 패리티 (fixture 실측 대조)', () => {
  it('가격표 스냅샷이 fixture 캡처 시점과 동일하다 (다르면 sync+capture 재실행)', () => {
    const snapshot = readFileSync(new URL('./pricing-data.json', import.meta.url), 'utf8');
    const sha = createHash('sha256').update(snapshot).digest('hex');
    expect(sha).toBe(fixture.source.pricingSnapshotSha256);
  });

  const cases = fixture.cases as FixtureCase[];

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const pub = c.publicData;
    expect(pub?.result, `${c.id}: 레거시 응답이 result=true 가 아님`).toBe(true);
    const data = pub?.data;
    if (data === undefined) throw new Error(`${c.id}: 레거시 public data 없음`);

    const r = calculateQuote(legacyBodyToQuoteInput(c.body, NOW));
    const legacyPrice = parseWon(data.listPriceWithRate ?? '0원');

    // 판매가: 레거시 0원(견적요청 유도) ↔ 엔진 rfq(null)
    if (legacyPrice === 0) {
      expect(r.listPrice, `${c.id}: 레거시 0원인데 엔진이 가격을 냄`).toBeNull();
    } else {
      expect(r.listPrice, `${c.id}: ${c.note}`).toBe(legacyPrice);
    }

    if (!FULL_PARITY_MENUS.has(c.body.menu ?? '')) return;

    expect(`${String(r.buildTimeDays)}일`, `${c.id}: 제작일`).toBe(data.buildTimeWithUnit);
    expect(`${r.weightKg}kg`, `${c.id}: 무게`).toBe(data.weightWithUnit);
    expect(r.eta, `${c.id}: eta`).toBe(data.eta);
  });
});
