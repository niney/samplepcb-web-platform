import { describe, expect, it, vi } from 'vitest';
import { SmartsmtEnvelope } from '@sp/api-contract';
import { buildSampleEnvelope, sampleFiles } from './smartsmt-sample';

// 순수 함수만 본다 — DB·파일서버는 붙이지 않는다.
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('./file-server', () => ({ uploadToFileServer: vi.fn(), deleteFromFileServer: vi.fn() }));

const { checkSmartsmtFiles, summarizeSmartsmtEnvelope } = await import('./smartsmt');

const summarize = (envelope: unknown) => summarizeSmartsmtEnvelope(SmartsmtEnvelope.parse(envelope));

describe('SmartSMT 견적서에서 목록용 값 뽑기', () => {
  it('최종 금액은 integrated.totals.total 이고, quote.total 은 SMT 작업비로 따로 둔다', () => {
    const summary = summarize(buildSampleEnvelope());
    expect(summary).toMatchObject({
      quoteId: 'Q-123456-123456-123abc',
      orderId: '123456789abc',
      envelopeVersion: '3',
      currency: 'KRW',
      lang: 'ko',
      strategy: 'SAMPLE',
      quoteStatus: 'CALCULATED',
      quantity: 20,
      smtTotal: 1042826,
      finalSupplyPrice: 1078393,
      finalVat: 107839,
      finalTotal: 1186232,
      blockedBy: [],
      ownerMbId: 'hong123',
      ownerName: '홍길동',
    });
    expect(summary.madeAt?.toISOString()).toBe('2026-10-20T07:36:32.603Z');
    expect(summary.manifest.map((entry) => entry.part)).toEqual(['gerber_archive', 'bom', 'cpl']);
  });

  it('합계가 막힌 견적 — 금액은 미정(null)으로 두고 0 으로 바꾸지 않는다', () => {
    const summary = summarize(buildSampleEnvelope({ blocked: true }));
    expect(summary.finalTotal).toBeNull();
    expect(summary.finalSupplyPrice).toBeNull();
    expect(summary.blockedBy).toEqual(['PCB']);
    expect(summary.smtTotal).toBe(1042826);
  });

  it('실제로 받은 모양(판 9) — 확정 금액은 미정이고 추정 금액을 따로 뽑는다', () => {
    const summary = summarize(buildSampleEnvelope({ review: true }));
    expect(summary).toMatchObject({
      envelopeVersion: '9',
      quoteStatus: 'REVIEW_REQUIRED',
      smtTotal: null,
      finalSupplyPrice: null,
      finalVat: null,
      finalTotal: null,
      smtEstimatedTotal: 396979,
      finalEstimatedTotal: 509575,
      blockedBy: ['PARTS', 'SHIPPING', 'DETAIL'],
    });
  });

  it('추정 금액이 없는 견적(양식 0.3)은 추정을 null 로 둔다 — 확정 금액을 추정 자리에 넣지 않는다', () => {
    const summary = summarize(buildSampleEnvelope());
    expect(summary.finalTotal).toBe(1186232);
    expect(summary.smtEstimatedTotal).toBeNull();
    expect(summary.finalEstimatedTotal).toBeNull();
  });

  it('0 은 0원이다 — 미정과 섞지 않는다', () => {
    const envelope = buildSampleEnvelope() as { quote: { total: number; integrated: { totals: Record<string, number> } } };
    envelope.quote.total = 0;
    envelope.quote.integrated.totals.total = 0;
    const summary = summarize(envelope);
    expect(summary.smtTotal).toBe(0);
    expect(summary.finalTotal).toBe(0);
  });

  it('꼭 있어야 하는 칸만 있어도 뽑는다 — 못 뽑은 칸은 null', () => {
    const summary = summarize({
      kind: 'smartsmt.quote',
      envelope_version: '4',
      header: { quote_id: 'Q-1', order_id: 'O-1', made_at: '날짜 아님' },
      quote: {},
    });
    expect(summary).toEqual({
      quoteId: 'Q-1',
      orderId: 'O-1',
      envelopeVersion: '4',
      madeAt: null,
      currency: null,
      lang: null,
      strategy: null,
      quoteStatus: null,
      quantity: null,
      smtTotal: null,
      finalSupplyPrice: null,
      finalVat: null,
      finalTotal: null,
      smtEstimatedTotal: null,
      finalEstimatedTotal: null,
      blockedBy: null,
      ownerMbId: null,
      ownerName: null,
      title: null,
      processes: null,
      manifest: [],
    });
  });

  it('모르는 코드 값은 그대로 받고, 숫자가 아닌 금액은 미정으로 둔다', () => {
    const envelope = buildSampleEnvelope() as { quote: Record<string, unknown> };
    envelope.quote.quote_status = 'SOMETHING_NEW';
    envelope.quote.total = '1,042,826';
    const summary = summarize(envelope);
    expect(summary.quoteStatus).toBe('SOMETHING_NEW');
    expect(summary.smtTotal).toBeNull();
  });

  it('user_edits · files 가 최상위에 놓여도 읽는다 (위치가 문서에 없다)', () => {
    const envelope = buildSampleEnvelope() as { header: Record<string, unknown> } & Record<string, unknown>;
    envelope.user_edits = envelope.header.user_edits;
    envelope.files = envelope.header.files;
    delete envelope.header.user_edits;
    delete envelope.header.files;
    const summary = summarize(envelope);
    expect(summary.ownerMbId).toBe('hong123');
    expect(summary.manifest).toHaveLength(3);
  });
});

describe('SmartSMT 동봉 파일 대조', () => {
  const files = sampleFiles();
  const manifest = summarize(buildSampleEnvelope({ files })).manifest;

  it('크기와 해시가 견적서와 같으면 match', () => {
    const result = checkSmartsmtFiles(manifest, files);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => [file.part, file.check])).toEqual([
      ['gerber_archive', 'match'],
      ['bom', 'match'],
      ['cpl', 'match'],
    ]);
    expect(result.files[0]?.sha256).toBe(manifest[0]?.sha256);
  });

  it('내용이 바뀐 파일은 거절한다 — 크기가 같아도 해시로 잡는다', () => {
    const [gerber, ...rest] = files;
    if (gerber === undefined) throw new Error('fixture');
    const sameSize = { ...gerber, buffer: Buffer.from(gerber.buffer.toString().replace('PK', 'XX')) };
    expect(checkSmartsmtFiles(manifest, [sameSize, ...rest])).toEqual({ ok: false, message: 'gerber_archive 파일의 해시가 견적서와 다릅니다' });
    const longer = { ...gerber, buffer: Buffer.concat([gerber.buffer, Buffer.from('!')]) };
    expect(checkSmartsmtFiles(manifest, [longer, ...rest])).toEqual({ ok: false, message: 'gerber_archive 파일의 크기가 견적서와 다릅니다' });
  });

  it('견적서 목록에 없는 파일은 unlisted, 오지 않은 파일은 missing 으로 적는다', () => {
    const onlyBom = files.filter((file) => file.part === 'bom');
    const withoutBomEntry = manifest.filter((entry) => entry.part !== 'bom');
    const result = checkSmartsmtFiles(withoutBomEntry, onlyBom);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => [file.part, file.check])).toEqual([
      ['bom', 'unlisted'],
      ['gerber_archive', 'missing'],
      ['cpl', 'missing'],
    ]);
  });

  it('파일 없이 온 견적(가져오기)은 목록 전부가 missing', () => {
    const result = checkSmartsmtFiles(manifest, []);
    expect(result.ok && result.files.every((file) => file.check === 'missing')).toBe(true);
  });
});

describe('SmartSMT 견적서 — 의뢰 이름 · 공정', () => {
  it('의뢰 이름(header.title)과 주문 공정(header.processes)을 뽑는다', () => {
    const envelope = buildSampleEnvelope({ review: true }) as { header: Record<string, unknown> };
    envelope.header.title = '  MULTI_MAIN_REV0  ';
    const summary = summarize(envelope);
    expect(summary.title).toBe('MULTI_MAIN_REV0');
    expect(summary.processes).toEqual(['pcb', 'parts', 'stencil', 'smt']);
  });

  it('이름이 없으면 null, 공정이 배열이 아니면 null — 문자열이 아닌 값은 뺀다', () => {
    const plain = summarize(buildSampleEnvelope());
    expect(plain.title).toBeNull();
    expect(plain.processes).toBeNull(); // 양식 0.3 견본은 processes: null
    const envelope = buildSampleEnvelope() as { header: Record<string, unknown> };
    envelope.header.processes = ['smt', 3, '', null];
    expect(summarize(envelope).processes).toEqual(['smt']);
  });
});

describe('SmartSMT 견
