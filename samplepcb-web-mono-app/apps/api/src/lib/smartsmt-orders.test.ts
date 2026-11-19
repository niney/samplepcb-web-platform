import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSampleEnvelope } from './smartsmt-sample';

// 의뢰 읽기 — 주인에게만, 마지막 견적 기준으로(docs/SMARTSMT_INTEGRATION.md §10). DB 는 붙이지 않는다.
const { db } = vi.hoisted(() => ({
  db: {
    spSmtOrder: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
    spSmtQuote: { findMany: vi.fn(), findFirst: vi.fn() },
    spFile: { findMany: vi.fn() },
  },
}));
vi.mock('./prisma', () => ({ prisma: db }));
vi.mock('./file-server', () => ({ uploadToFileServer: vi.fn(), deleteFromFileServer: vi.fn() }));

const { listSmtOrdersOf, loadSmtOrderOf, smartsmtOpenUrl, smtOrderTitle } = await import('./smartsmt-orders');

const at = (iso: string): Date => new Date(iso);
const checks = [
  { part: 'gerber_archive', name: 'MULTI_MAIN_REV0.Zip', bytes: 100, sha256: 'a'.repeat(64), check: 'match' },
  { part: 'bom', name: 'bom.xlsx', bytes: 50, sha256: 'b'.repeat(64), check: 'match' },
];
const latest = (over: Record<string, unknown> = {}) => ({
  id: 70n,
  quoteId: 'Q-KEPT',
  receivedAt: at('2026-11-18T15:57:01Z'),
  currency: 'KRW',
  processes: ['pcb', 'parts', 'smt'],
  files: checks,
  finalTotal: null,
  finalEstimatedTotal: new Prisma.Decimal(2138950),
  review: null,
  ...over,
});
const confirmedReview = {
  status: 'confirmed',
  total: new Prisma.Decimal(314116),
  lineAmounts: { 'SMT-P03': 30000 },
  blockAmounts: { SHIPPING: 5000 },
  customerNote: '배송비를 반영했습니다.',
  confirmedAt: at('2026-11-19T01:30:00Z'),
  updatedAt: at('2026-11-19T01:30:00Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  db.spSmtOrder.count.mockResolvedValue(0);
  db.spSmtOrder.findMany.mockResolvedValue([]);
  db.spSmtOrder.findFirst.mockResolvedValue(null);
  db.spSmtQuote.findMany.mockResolvedValue([]);
  db.spSmtQuote.findFirst.mockResolvedValue(null);
  db.spFile.findMany.mockResolvedValue([]);
});

describe('SMT 의뢰 이름', () => {
  it('보낸 이름 → 제조 파일 묶음의 이름 → 아무 파일의 이름 → 주문 번호 순으로 정한다', () => {
    expect(smtOrderTitle('  NM-CTRL-V2 ', checks, 'o1')).toBe('NM-CTRL-V2');
    expect(smtOrderTitle(null, checks, 'o1')).toBe('MULTI_MAIN_REV0');
    expect(smtOrderTitle('', [{ part: 'bom', name: 'only.bom.xlsx' }], 'o1')).toBe('only.bom');
    expect(smtOrderTitle(null, [{ part: 'bom', name: null }], 'o1')).toBe('o1');
    expect(smtOrderTitle(null, null, 'o1')).toBe('o1');
    expect(smtOrderTitle(null, [{ part: 'cpl', name: '.hidden' }], 'o1')).toBe('.hidden');
  });
});

describe('SMT 의뢰 목록 — 그 회원 것만', () => {
  it('주인 조건으로 찾고, 임시 저장은 확정으로 알리지 않는다', async () => {
    db.spSmtOrder.count.mockResolvedValue(3);
    db.spSmtOrder.findMany.mockResolvedValue([
      { orderId: 'o-confirmed', title: 'A', latestQuote: latest({ review: { status: 'confirmed', total: new Prisma.Decimal(314116) } }) },
      { orderId: 'o-draft', title: null, latestQuote: latest({ quoteId: 'Q-2', review: { status: 'draft', total: new Prisma.Decimal(999) } }) },
      { orderId: 'o-plain', title: null, latestQuote: latest({ quoteId: 'Q-3', finalEstimatedTotal: null, finalTotal: new Prisma.Decimal(1186232), processes: null, files: null }) },
    ]);
    const { total, items } = await listSmtOrdersOf('hong123', 2, 20);
    expect(total).toBe(3);
    const call = db.spSmtOrder.findMany.mock.calls[0]?.[0] as { where: unknown; skip: number; take: number };
    expect(call.where).toEqual({ ownerMbId: 'hong123', latestQuoteId: { not: null } });
    expect([call.skip, call.take]).toEqual([20, 20]);

    expect(items[0]).toMatchObject({ orderId: 'o-confirmed', title: 'A', confirmed: true, confirmedTotal: 314116, estimatedTotal: 2138950, processes: ['pcb', 'parts', 'smt'] });
    // 임시 저장 — 담당자가 고치는 중인 금액은 밖에 내보내지 않는다.
    expect(items[1]).toMatchObject({ orderId: 'o-draft', title: 'MULTI_MAIN_REV0', confirmed: false, confirmedTotal: null });
    // 추정 합계가 없으면 받은 합계를, 이름 · 공정이 없으면 주문 번호 · 빈 목록을.
    expect(items[2]).toMatchObject({ orderId: 'o-plain', title: 'o-plain', estimatedTotal: 1186232, processes: [] });
  });
});

describe('SMT 의뢰 한 건', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 7n,
    orderId: 'o1',
    title: null,
    latestQuote: latest({ envelope: JSON.stringify(buildSampleEnvelope({ review: true })), state: null, ...over }),
  });

  it('없거나 주인이 다르면 null — 주인은 DB 조건으로 대조한다', async () => {
    expect(await loadSmtOrderOf('someone-else', 'o1')).toBeNull();
    expect(db.spSmtOrder.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { orderId: 'o1', ownerMbId: 'someone-else' } });
  });

  it('확정 전 — 받은 견적서만 주고 확정 금액 · 안내 글은 비운다 (임시 저장도 같다)', async () => {
    db.spSmtOrder.findFirst.mockResolvedValue(order({ review: { ...confirmedReview, status: 'draft' } }));
    const detail = await loadSmtOrderOf('hong123', 'o1');
    expect(detail?.row.confirmed).toBe(false);
    expect(detail?.confirmedEnvelope).toBeNull();
    expect(detail?.confirmedAt).toBeNull();
    expect(detail?.customerNote).toBe('');
    expect(detail?.envelope).toMatchObject({ kind: 'smartsmt.quote', envelope_version: '9' });
  });

  it('확정 — 확정 금액을 채운 견적서와 안내 글을 준다', async () => {
    db.spSmtOrder.findFirst.mockResolvedValue(order({ review: confirmedReview }));
    const detail = await loadSmtOrderOf('hong123', 'o1');
    expect(detail?.row).toMatchObject({ confirmed: true, confirmedTotal: 314116 });
    expect(detail?.confirmedAt?.toISOString()).toBe('2026-11-19T01:30:00.000Z');
    expect(detail?.customerNote).toBe('배송비를 반영했습니다.');
    expect(detail?.confirmedEnvelope).toMatchObject({
      review_status: 'CONFIRMED',
      reviewed_at: '2026-11-19T01:30:00.000Z',
      quote: { quote_status: 'CALCULATED', integrated: { totals: { supply_price: 285560, vat: 28556, total: 314116 }, blocked_by: [] } },
    });
    // 받은 견적서는 그대로다.
    expect(detail?.envelope).toMatchObject({ quote: { quote_status: 'REVIEW_REQUIRED', integrated: { totals: { total: null } } } });
  });

  it('작업 상태 — 마지막 견적에 없으면 같은 주문에서 가장 최근에 받은 것, JSON 이 아니면 글자 그대로', async () => {
    db.spSmtOrder.findFirst.mockResolvedValue(order({ state: '{"step":"order","qty":5}' }));
    expect((await loadSmtOrderOf('hong123', 'o1'))?.state).toEqual({ step: 'order', qty: 5 });
    expect(db.spSmtQuote.findFirst).not.toHaveBeenCalled();

    db.spSmtOrder.findFirst.mockResolvedValue(order());
    db.spSmtQuote.findFirst.mockResolvedValue({ state: '[1,2,3]' });
    expect((await loadSmtOrderOf('hong123', 'o1'))?.state).toEqual([1, 2, 3]);
    expect(db.spSmtQuote.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { orderRefId: 7n, state: { not: null } }, orderBy: { id: 'desc' } });

    db.spSmtQuote.findFirst.mockResolvedValue({ state: 'not json' });
    expect((await loadSmtOrderOf('hong123', 'o1'))?.state).toBe('not json');
    db.spSmtQuote.findFirst.mockResolvedValue(null);
    expect((await loadSmtOrderOf('hong123', 'o1'))?.state).toBeNull();
  });

  it('원본 파일 — 파일을 보관한 가장 최근 견적의 것을 준다 (가져온 견적에는 파일이 없다)', async () => {
    db.spSmtOrder.findFirst.mockResolvedValue(order());
    // 71 = 가져온 견적(파일 없음), 70 = 고객이 보낸 견적(파일 2개), 60 = 더 앞선 견적(파일 1개)
    db.spSmtQuote.findMany.mockResolvedValue([
      { id: 71n, files: [{ part: 'gerber_archive', name: 'x.zip', sha256: 'z'.repeat(64), check: 'missing' }] },
      { id: 70n, files: checks },
      { id: 60n, files: checks },
    ]);
    db.spFile.findMany.mockResolvedValue([
      { refId: 60n, slot: 'gerber_archive', originFileName: 'old.zip', size: 9n, pathToken: 'tok-old' },
      { refId: 70n, slot: 'gerber_archive', originFileName: 'MULTI_MAIN_REV0.Zip', size: 100n, pathToken: 'tok-g' },
      { refId: 70n, slot: 'bom', originFileName: 'bom.xlsx', size: 50n, pathToken: 'tok-b' },
    ]);
    const detail = await loadSmtOrderOf('hong123', 'o1');
    expect(detail?.files).toEqual([
      { part: 'gerber_archive', name: 'MULTI_MAIN_REV0.Zip', bytes: 100, sha256: 'a'.repeat(64), pathToken: 'tok-g' },
      { part: 'bom', name: 'bom.xlsx', bytes: 50, sha256: 'b'.repeat(64), pathToken: 'tok-b' },
    ]);
    expect(db.spFile.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { refType: 'sp_smt_quote', refId: { in: [71n, 70n, 60n] } } });
  });

  it('보관한 견적서를 읽을 수 없어도 죽지 않는다 (빈 견적서)', async () => {
    db.spSmtOrder.findFirst.mockResolvedValue(order({ envelope: '{broken' }));
    const detail = await loadSmtOrderOf('hong123', 'o1');
    expect(detail?.envelope).toEqual({});
    expect(detail?.files).toEqual([]);
  });
});

describe('SmartSMT 화면으로 가는 주소', () => {
  it('열기 주소 설정이 있으면 그것을, 없으면 SmartSMT 의 견적서 화면을, 주소가 없으면 null', () => {
    const base = { SMARTSMT_BASE_URL: 'https://smteyes.samplepcb.co.kr/' };
    expect(smartsmtOpenUrl('a b/1', base)).toBe('https://smteyes.samplepcb.co.kr/quote?order=a%20b%2F1');
    expect(
      smartsmtOpenUrl('o1', { ...base, SMARTSMT_OPEN_URL_TEMPLATE: 'https://smteyes.samplepcb.co.kr/open?order={order_id}' }),
    ).toBe('https://smteyes.samplepcb.co.kr/open?order=o1');
    // 자리 표시가 없거나 http(s) 주소가 아닌 설정은 쓰지 않는다.
    expect(smartsmtOpenUrl('o1', { ...base, SMARTSMT_OPEN_URL_TEMPLATE: 'https://x.test/open' })).toBe('https://smteyes.samplepcb.co.kr/quote?order=o1');
    expect(smartsmtOpenUrl('o1', { ...base, SMARTSMT_OPEN_URL_TEMPLATE: 'javascript:alert({order_id})' })).toBe('https://smteyes.samplepcb.co.kr/quote?order=o1');
    expect(smartsmtOpenUrl('o1', {})).toBeNull();
  });
});
