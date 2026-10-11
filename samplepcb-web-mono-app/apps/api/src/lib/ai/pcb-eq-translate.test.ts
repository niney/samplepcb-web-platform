import { beforeEach, describe, expect, it, vi } from 'vitest';

// 고객 의견 번역(D20 P4) — 프롬프트·답 해석(숫자 보존 검사)·무엇을 번역하고 무엇을 건너뛰는가. LLM·DB 는 가짜다.

interface ItemRow {
  id: bigint;
  seq: number;
  question: string;
  questionOrig: string | null;
  options: unknown;
  answerKey: string | null;
  answerComment: string | null;
  answerCommentI18n: unknown;
}

const h = vi.hoisted(() => {
  const state: {
    review: { id: bigint; format: string; items: ItemRow[] } | null;
    enabled: boolean;
    /** 발주 이력(Json 한 칸) — 사유 번역이 이 배열의 사건에 붙는다. */
    po: { eqHistory: unknown } | null;
  } = {
    review: null,
    enabled: true,
    po: null,
  };
  return { state };
});

vi.mock('../prisma', () => {
  const prisma = {
    // 사유 번역은 행을 잠그고 그 자리에서 다시 읽는다 — 가짜는 잠금 없이 같은 상태를 돌려준다.
    $queryRaw: () => Promise.resolve([]),
    $transaction: (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(prisma),
    spPcbPo: {
      findUnique: () => Promise.resolve(h.state.po === null ? null : { eqHistory: h.state.po.eqHistory }),
      update: (args: { data: { eqHistory: unknown } }) => {
        if (h.state.po !== null) h.state.po.eqHistory = args.data.eqHistory;
        return Promise.resolve({});
      },
    },
    spPcbEqReview: {
      findUnique: () => Promise.resolve(h.state.review),
    },
    spPcbEqReviewItem: {
      updateMany: (args: {
        where: { id: bigint; answerComment: string | null; answerCommentI18n?: unknown };
        data: { answerCommentI18n: unknown };
      }) => {
        const row = h.state.review?.items.find((i) => i.id === args.where.id && i.answerComment === args.where.answerComment);
        // 쓰기 가드(force 아님) — 아직 번역이 비어 있는 문항에만 쓴다.
        if (row === undefined || ('answerCommentI18n' in args.where && row.answerCommentI18n !== null)) {
          return Promise.resolve({ count: 0 });
        }
        row.answerCommentI18n = args.data.answerCommentI18n;
        return Promise.resolve({ count: 1 });
      },
    },
  };
  return { prisma };
});
vi.mock('./usecases', () => ({
  PCB_EQ_PARSE_USECASE: 'pcb.eq-parse',
  getAiUsecaseRuntime: () => Promise.resolve({ enabled: h.state.enabled, model: 'kimi-k3', think: 'low' }),
  getAiConnection: () => Promise.resolve({ baseUrl: 'http://x', apiKey: null }),
  toOllamaThink: (v: string) => v,
}));

import {
  buildEqCommentTranslatePrompt,
  buildEqNoteTranslatePrompt,
  parseEqCommentTranslations,
  translateEqComments,
  translateEqHistoryNote,
  type EqCommentSource,
} from './pcb-eq-translate';

const log = { info: vi.fn(), warn: vi.fn() };
const OPTIONS = [
  { key: 'A', label: '넣지 않음', labelOrig: '不加', recommended: true, requiresComment: false },
  { key: 'B', label: '위치를 지정하겠습니다', labelOrig: '贵司指示位置', recommended: false, requiresComment: true },
];
const row = (over: Partial<ItemRow>): ItemRow => ({
  id: 1n,
  seq: 0,
  question: 'UL 마킹을 넣을까요?',
  questionOrig: '是否加UL标记？',
  options: OPTIONS,
  answerKey: 'B',
  answerComment: '좌측 하단에 넣어 주세요',
  answerCommentI18n: null,
  ...over,
});
const source = (over: Partial<EqCommentSource> = {}): EqCommentSource => ({
  id: 1,
  question: '是否加UL标记？',
  chosen: 'B. 贵司指示位置',
  comment: '좌측 하단에 넣어 주세요',
  ...over,
});
const answer = (items: { id: number; en: string; zh: string }[]): string => JSON.stringify({ items });

beforeEach(() => {
  h.state.review = null;
  h.state.enabled = true;
  h.state.po = null;
  log.info.mockClear();
  log.warn.mockClear();
});

describe('buildEqCommentTranslatePrompt', () => {
  it('의견과 문맥(질문·고른 선택지)을 싣고, 번역만 하라고 못박는다', () => {
    const prompt = buildEqCommentTranslatePrompt([source()]);
    expect(prompt).toContain('좌측 하단에 넣어 주세요');
    expect(prompt).toContain('B. 贵司指示位置');
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).toContain('Do not omit anything');
    // 치수·방향이 이 번역의 급소다.
    expect(prompt).toContain('exactly as written');
    expect(prompt).toContain('left/right');
    expect(prompt).toContain('"id": 1');
  });
});

describe('parseEqCommentTranslations', () => {
  it('물은 의견의 답만 받는다 — 모르는 id·빈 번역은 버린다', () => {
    const out = parseEqCommentTranslations(
      answer([
        { id: 1, en: 'Please place it at the lower left.', zh: '请放在左下角。' },
        { id: 9, en: 'x', zh: 'y' },
        { id: 2, en: '', zh: '空' },
      ]),
      [source(), source({ id: 2, comment: '빈 번역' })],
    );
    expect([...out.keys()]).toEqual([1]);
    expect(out.get(1)).toEqual({ en: 'Please place it at the lower left.', zh: '请放在左下角。' });
  });

  it('원문의 숫자가 번역문에 그대로 없으면 그 번역은 버린다(치수·공차가 바뀐 번역은 틀린 지시다)', () => {
    const src = [source({ comment: '비아를 0.25mm 로, 공차 ±0.05' })];
    expect(parseEqCommentTranslations(answer([{ id: 1, en: 'Via 0.25mm, tolerance ±0.05', zh: '过孔 0.25mm，公差 ±0.05' }]), src).size).toBe(1);
    // 영어에서 0.25 가 0.2 로 바뀌었다.
    expect(parseEqCommentTranslations(answer([{ id: 1, en: 'Via 0.2mm, tolerance ±0.05', zh: '过孔 0.25mm，公差 ±0.05' }]), src).size).toBe(0);
    // 중국어에서 공차가 빠졌다.
    expect(parseEqCommentTranslations(answer([{ id: 1, en: 'Via 0.25mm, tolerance ±0.05', zh: '过孔 0.25mm' }]), src).size).toBe(0);
  });

  it('천 단위 쉼표를 뗀 숫자는 같은 숫자다', () => {
    const src = [source({ comment: '1,000매로 진행' })];
    expect(parseEqCommentTranslations(answer([{ id: 1, en: 'Proceed with 1000 pcs', zh: '按 1,000 片进行' }]), src).size).toBe(1);
  });

  it('JSON 이 아니면 아무것도 받지 않는다', () => {
    expect(parseEqCommentTranslations('죄송합니다, 번역할 수 없습니다.', [source()]).size).toBe(0);
  });
});

describe('translateEqComments', () => {
  it('의견이 있고 번역이 없는 문항만 번역해 저장한다(by=ai)', async () => {
    h.state.review = {
      id: 5n,
      format: 'items',
      items: [
        row({ id: 1n }),
        row({ id: 2n, answerKey: 'A', answerComment: null }),
        row({ id: 3n, answerComment: '   ' }),
        row({ id: 4n, answerComment: '기존 번역 있음', answerCommentI18n: { en: 'kept', 'zh-CN': '保留', by: 'admin', at: 'x' } }),
      ],
    };
    const chat = vi.fn((prompt: string) => {
      // 번역 대상은 1번뿐이다 — 의견 없는 문항·이미 번역된 문항은 프롬프트에 없다.
      expect(prompt).toContain('"id": 1');
      expect(prompt).not.toContain('"id": 2');
      expect(prompt).not.toContain('"id": 4');
      return Promise.resolve(answer([{ id: 1, en: 'Lower left, please.', zh: '请放在左下角。' }]));
    });
    const result = await translateEqComments(5n, { force: false, log, chat });
    expect(result).toEqual({ ok: true, translated: 1, failed: 0 });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(h.state.review.items[0]?.answerCommentI18n).toMatchObject({ en: 'Lower left, please.', 'zh-CN': '请放在左下角。', by: 'ai' });
    // 관리자가 고친 번역은 그대로다.
    expect(h.state.review.items[3]?.answerCommentI18n).toMatchObject({ en: 'kept', by: 'admin' });
  });

  it('모델을 기다리는 사이 관리자가 번역문을 적었으면 덮지 않는다', async () => {
    h.state.review = { id: 5n, format: 'items', items: [row({})] };
    const chat = vi.fn(() => {
      // 답이 오기 전에 사람이 먼저 적었다.
      const first = h.state.review?.items[0];
      if (first !== undefined) first.answerCommentI18n = { en: 'by hand', 'zh-CN': '手写', by: 'admin', at: 'x' };
      return Promise.resolve(answer([{ id: 1, en: 'by AI', zh: 'AI 译' }]));
    });
    expect(await translateEqComments(5n, { force: false, log, chat })).toEqual({ ok: true, translated: 0, failed: 1 });
    expect(h.state.review.items[0]?.answerCommentI18n).toMatchObject({ en: 'by hand', by: 'admin' });
  });

  it('번역할 것이 없으면 모델을 부르지 않는다', async () => {
    h.state.review = { id: 5n, format: 'items', items: [row({ answerComment: null, answerKey: 'A' })] };
    const chat = vi.fn(() => Promise.resolve('{}'));
    expect(await translateEqComments(5n, { force: false, log, chat })).toEqual({ ok: true, translated: 0, failed: 0 });
    expect(chat).not.toHaveBeenCalled();
  });

  it('force 면 관리자가 고친 번역까지 다시 번역한다', async () => {
    h.state.review = {
      id: 5n,
      format: 'items',
      items: [row({ answerCommentI18n: { en: 'old', 'zh-CN': '旧', by: 'admin', at: 'x' } })],
    };
    const chat = vi.fn(() => Promise.resolve(answer([{ id: 1, en: 'new', zh: '新' }])));
    expect(await translateEqComments(5n, { force: true, log, chat })).toEqual({ ok: true, translated: 1, failed: 0 });
    expect(h.state.review.items[0]?.answerCommentI18n).toMatchObject({ en: 'new', by: 'ai' });
  });

  it('일부만 통과하면 통과한 것만 저장하고 나머지는 원문만 남긴다', async () => {
    h.state.review = {
      id: 5n,
      format: 'items',
      items: [row({ id: 1n }), row({ id: 2n, answerComment: '0.3mm 로 키워 주세요' })],
    };
    const chat = vi.fn(() =>
      Promise.resolve(
        answer([
          { id: 1, en: 'Lower left.', zh: '左下角。' },
          { id: 2, en: 'Enlarge to 0.5mm', zh: '加大到 0.3mm' }, // 영어의 숫자가 틀렸다
        ]),
      ),
    );
    expect(await translateEqComments(5n, { force: false, log, chat })).toEqual({ ok: true, translated: 1, failed: 1 });
    expect(h.state.review.items[1]?.answerCommentI18n).toBeNull();
  });

  it('모델이 실패하거나 쓸 답이 하나도 없으면 AI_FAILED — 아무것도 바꾸지 않는다', async () => {
    h.state.review = { id: 5n, format: 'items', items: [row({})] };
    const boom = vi.fn(() => Promise.reject(new Error('HTTP 503')));
    expect(await translateEqComments(5n, { force: false, log, chat: boom })).toEqual({ ok: false, error: 'AI_FAILED' });
    const junk = vi.fn(() => Promise.resolve('not json'));
    expect(await translateEqComments(5n, { force: false, log, chat: junk })).toEqual({ ok: false, error: 'AI_FAILED' });
    expect(h.state.review.items[0]?.answerCommentI18n).toBeNull();
  });

  it("'PCB EQ 분석'이 꺼져 있으면 AI_DISABLED — 번역만을 위한 스위치는 없다", async () => {
    h.state.review = { id: 5n, format: 'items', items: [row({})] };
    h.state.enabled = false;
    expect(await translateEqComments(5n, { force: false, log })).toEqual({ ok: false, error: 'AI_DISABLED' });
  });

  it('없는 회차·문구형 회차는 REVIEW_NOT_FOUND', async () => {
    expect(await translateEqComments(5n, { force: false, log })).toEqual({ ok: false, error: 'REVIEW_NOT_FOUND' });
    h.state.review = { id: 5n, format: 'message', items: [] };
    expect(await translateEqComments(5n, { force: false, log })).toEqual({ ok: false, error: 'REVIEW_NOT_FOUND' });
  });
});

// ── 관리자가 쓴 사유(반려·대행 추가 EQ 요청) — 발주 이력의 그 사건에 번역을 붙인다 ──────────────
const hist = (at: string, byRole: string, fromStatus: string, toStatus: string, note: string | null = null) => ({
  at,
  byRole,
  fromStatus,
  toStatus,
  note,
});
const T = (n: number): string => `2026-10-11T00:0${String(n)}:00.000Z`;
const events = (): Record<string, unknown>[] => (h.state.po?.eqHistory ?? []) as Record<string, unknown>[];

describe('buildEqNoteTranslatePrompt', () => {
  it('구매자가 공장에 쓴 사유라고 말하고, 번역만 하라고 못박는다', () => {
    const prompt = buildEqNoteTranslatePrompt('도면 번호가 다릅니다. 0.25mm 로 고쳐 주세요.');
    expect(prompt).toContain('the buyer');
    expect(prompt).toContain('도면 번호가 다릅니다');
    expect(prompt).toContain('Do not omit anything');
    expect(prompt).toContain('exactly as written');
  });
});

describe('translateEqHistoryNote', () => {
  it('가장 최근의 관리자 반려 사유를 번역해 그 사건에만 붙인다 — 다른 사건과 다른 키는 그대로', async () => {
    h.state.po = {
      eqHistory: [
        hist(T(1), 'PARTNER', 'issued', 'eq_requested'),
        { ...hist(T(2), 'ADMIN', 'eq_requested', 'issued', '옛 반려'), noteI18n: { en: 'old', 'zh-CN': '旧', by: 'ai', at: 'x' } },
        hist(T(3), 'PARTNER', 'issued', 'eq_requested'),
        { ...hist(T(4), 'ADMIN', 'eq_requested', 'issued', '홀 지름을 0.25mm 로 고쳐 주세요'), extra: 'keep-me' },
      ],
    };
    const chat = vi.fn((prompt: string) => {
      expect(prompt).toContain('홀 지름을 0.25mm 로 고쳐 주세요');
      return Promise.resolve(answer([{ id: 1, en: 'Please change the hole diameter to 0.25mm.', zh: '请将孔径改为 0.25mm。' }]));
    });
    const result = await translateEqHistoryNote(7n, { log, chat });
    expect(result).toMatchObject({ ok: true, translation: { en: 'Please change the hole diameter to 0.25mm.', by: 'ai' } });
    expect(events()[3]).toMatchObject({ note: '홀 지름을 0.25mm 로 고쳐 주세요', extra: 'keep-me', noteI18n: { 'zh-CN': '请将孔径改为 0.25mm。' } });
    expect(events()[1]?.noteI18n, '이미 번역된 옛 사유는 그대로').toMatchObject({ en: 'old' });
    expect(events()[0]?.noteI18n).toBeUndefined();
    expect(events()).toHaveLength(4);
  });

  it('협력사가 직접 쓴 추가 EQ 요청 사유는 자기 말이라 번역하지 않는다 — 관리자 대행이 쓴 것만', async () => {
    h.state.po = { eqHistory: [hist(T(1), 'PARTNER', 'eq_done', 'issued', '阻抗条位置需再确认')] };
    const chat = vi.fn(() => Promise.resolve(answer([{ id: 1, en: 'x', zh: 'y' }])));
    expect(await translateEqHistoryNote(7n, { log, chat })).toEqual({ ok: true, translation: null });
    expect(chat).not.toHaveBeenCalled();

    h.state.po = { eqHistory: [hist(T(1), 'ADMIN', 'eq_done', 'issued', '적층 구조를 다시 확인해야 합니다')] };
    const proxy = vi.fn(() => Promise.resolve(answer([{ id: 1, en: 'The stack-up must be re-confirmed.', zh: '需要重新确认叠层结构。' }])));
    expect(await translateEqHistoryNote(7n, { log, chat: proxy })).toMatchObject({ ok: true, translation: { by: 'ai' } });
    expect(events()[0]?.noteI18n).toMatchObject({ en: 'The stack-up must be re-confirmed.' });
  });

  it('사유가 아닌 것은 번역하지 않는다 — 요청 취소·레거시 되돌리기 표식·승인', async () => {
    h.state.po = {
      eqHistory: [
        hist(T(1), 'ADMIN', 'eq_requested', 'issued'),
        hist(T(2), 'ADMIN', 'eq_requested', 'issued', '되돌리기'),
        hist(T(3), 'ADMIN', 'eq_requested', 'eq_done', '메모'),
      ],
    };
    const chat = vi.fn(() => Promise.resolve('{}'));
    expect(await translateEqHistoryNote(7n, { log, chat })).toEqual({ ok: true, translation: null });
    expect(chat).not.toHaveBeenCalled();
  });

  it('모델을 기다리는 사이 이력이 늘어도 새 사건을 지우지 않는다(그 자리에서 다시 읽어 붙인다)', async () => {
    h.state.po = { eqHistory: [hist(T(1), 'ADMIN', 'eq_requested', 'issued', '도면 번호가 다릅니다')] };
    const chat = vi.fn(() => {
      // 답이 오기 전에 협력사가 다시 승인요청을 올렸다.
      if (h.state.po !== null) h.state.po.eqHistory = [...events(), hist(T(2), 'PARTNER', 'issued', 'eq_requested')];
      return Promise.resolve(answer([{ id: 1, en: 'The drawing number is different.', zh: '图纸编号不一致。' }]));
    });
    expect(await translateEqHistoryNote(7n, { log, chat })).toMatchObject({ ok: true, translation: { by: 'ai' } });
    expect(events()).toHaveLength(2);
    expect(events()[0]?.noteI18n).toMatchObject({ en: 'The drawing number is different.' });
    expect(events()[1]).toMatchObject({ byRole: 'PARTNER', toStatus: 'eq_requested' });
  });

  it('숫자가 어긋난 번역은 붙이지 않는다 — AI_FAILED, 이력은 그대로', async () => {
    h.state.po = { eqHistory: [hist(T(1), 'ADMIN', 'eq_requested', 'issued', '0.25mm 로 고쳐 주세요')] };
    const chat = vi.fn(() => Promise.resolve(answer([{ id: 1, en: 'Change to 0.2mm', zh: '改为 0.25mm' }])));
    expect(await translateEqHistoryNote(7n, { log, chat })).toEqual({ ok: false, error: 'AI_FAILED' });
    expect(events()[0]?.noteI18n).toBeUndefined();
  });

  it("'PCB EQ 분석'이 꺼져 있으면 AI_DISABLED, 없는 발주서는 PO_NOT_FOUND", async () => {
    expect(await translateEqHistoryNote(7n, { log })).toEqual({ ok: false, error: 'PO_NOT_FOUND' });
    h.state.po = { eqHistory: [hist(T(1), 'ADMIN', 'eq_requested', 'issued', '사유')] };
    h.state.enabled = false;
    expect(await translateEqHistoryNote(7n, { log })).toEqual({ ok: false, error: 'AI_DISABLED' });
  });
});
