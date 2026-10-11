import type { SpFile, SpPcbEqReviewEvent, SpPcbEqReviewItem } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  eqFigureContentType,
  eqFigureMime,
  eqItemNo,
  eqRoundNumbers,
  isEqReviewCustomerVisible,
  looseEqFigures,
  parseEqItemFigures,
  parseEqItemOptions,
  planEqItemCopyLink,
  summarizeEqAnswers,
  toAdminEqItem,
  toCustomerEqItem,
  toEqEvent,
  toEqPrevItem,
  toPartnerEqItem,
  validateEqAnswers,
  validateEqDraftItems,
  type AdminEqItemInput,
} from './pcb-eq-items';

// D20 문항형 회차의 규칙 — 회차 번호·고객 노출·개정 연결·답 검증·뷰 조립(공급망 미노출).

const OPT_A = { key: 'A', label: '공장 제안대로', labelOrig: '按我司建议', recommended: true, requiresComment: false };
const OPT_B = { key: 'B', label: '지시하겠습니다', labelOrig: '贵司指示', recommended: false, requiresComment: true };
const OPTIONS = [OPT_A, OPT_B];

const item = (over: Partial<SpPcbEqReviewItem> = {}): SpPcbEqReviewItem => ({
  id: 11n,
  reviewId: 1n,
  seq: 0,
  factoryNo: '1',
  category: 'marking',
  question: 'UL 마킹을 넣을까요?',
  questionOrig: '是否加UL标记?',
  options: OPTIONS,
  figures: [
    { fileId: 501, shared: true },
    { fileId: 502, shared: false },
  ],
  prevItemId: null,
  change: null,
  answerKey: null,
  answerComment: null,
  createdAt: new Date('2026-10-11T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
  ...over,
});

const file = (id: bigint, name: string): SpFile => ({
  id,
  refType: 'sp_pcb_eq_review',
  refId: 1n,
  uploadFileName: name,
  originFileName: name,
  pathToken: `tok-${String(id)}`,
  size: 1234n,
  writeDate: new Date('2026-10-11T00:00:00Z'),
  fileType: 'figure',
  uploadedBy: 'ADMIN',
  area: null,
  slot: null,
});

const FILES = new Map([
  ['501', file(501n, 'ul-mark.png')],
  ['502', file(502n, 'factory-logo.png')],
]);

describe('회차 번호·고객 노출', () => {
  it('문항형 회차만 id 순으로 세고, 안 나간 채 닫힌 초안은 번호가 없다', () => {
    const rounds = eqRoundNumbers([
      { id: 5n, format: 'items', status: 'answered', sent: true },
      { id: 3n, format: 'message', status: 'approved', sent: false },
      { id: 7n, format: 'items', status: 'canceled', sent: false }, // 작성 중에 EQ 가 움직여 닫힘
      { id: 9n, format: 'items', status: 'canceled', sent: true }, // 보낸 뒤 닫힘 — 고객이 봤다
      { id: 12n, format: 'items', status: 'draft', sent: false }, // 지금 작성 중 — 다음 번호
    ]);
    expect(rounds.get('5')).toBe(1);
    expect(rounds.get('3')).toBeUndefined();
    expect(rounds.get('7')).toBeUndefined();
    expect(rounds.get('9')).toBe(2);
    expect(rounds.get('12')).toBe(3);
  });

  it('draft 와 안 나간 채 닫힌 문항형 초안은 고객에게 없다 — 문구형은 취소 이력까지 보인다', () => {
    expect(isEqReviewCustomerVisible({ format: 'items', status: 'draft', sent: false })).toBe(false);
    expect(isEqReviewCustomerVisible({ format: 'items', status: 'canceled', sent: false })).toBe(false);
    expect(isEqReviewCustomerVisible({ format: 'items', status: 'canceled', sent: true })).toBe(true);
    expect(isEqReviewCustomerVisible({ format: 'items', status: 'requested', sent: true })).toBe(true);
    expect(isEqReviewCustomerVisible({ format: 'message', status: 'canceled', sent: false })).toBe(true);
  });
});

describe('개정 회차 연결(fromPrevious)', () => {
  it('고객에게 나간 회차를 복사하면 그 문항에 잇고 동일로 표시한다', () => {
    expect(planEqItemCopyLink(item({ id: 40n, prevItemId: 20n, change: 'changed' }), true)).toEqual({
      prevItemId: 40n,
      change: 'same',
    });
  });

  it('안 나간 채 닫힌 초안을 복사하면 그 초안이 잇던 문항(고객이 본 회차)에 잇는다', () => {
    expect(planEqItemCopyLink(item({ id: 40n, prevItemId: 20n, change: 'changed' }), false)).toEqual({
      prevItemId: 20n,
      change: 'changed',
    });
    // 첫 회차 초안이었다면 이을 곳이 없다.
    expect(planEqItemCopyLink(item({ id: 40n, prevItemId: null, change: null }), false)).toEqual({
      prevItemId: null,
      change: null,
    });
  });
});

describe('초안 저장 검증', () => {
  const input = (over: Partial<AdminEqItemInput> = {}): AdminEqItemInput => ({
    factoryNo: '1',
    category: 'marking',
    question: '질문',
    questionOrig: null,
    options: OPTIONS,
    figures: [],
    prevItemId: null,
    change: null,
    ...over,
  });
  const ctx = {
    itemIds: new Set(['11', '12']),
    figureIds: new Set(['501']),
    prevItemIds: new Set(['7']),
  };

  it('통과 — 새 문항·기존 문항·이 회차 그림·직전 회차 문항', () => {
    expect(
      validateEqDraftItems(
        [input({ id: 11, figures: [{ fileId: 501, shared: true }], prevItemId: 7 }), input()],
        ctx,
      ),
    ).toBeNull();
  });

  it('남의 문항 id·같은 id 두 번은 BAD_ITEM', () => {
    expect(validateEqDraftItems([input({ id: 99 })], ctx)).toBe('BAD_ITEM');
    expect(validateEqDraftItems([input({ id: 11 }), input({ id: 11 })], ctx)).toBe('BAD_ITEM');
  });

  it('이 회차에 올리지 않은 그림·같은 그림 두 번은 BAD_FIGURES', () => {
    expect(validateEqDraftItems([input({ figures: [{ fileId: 777, shared: false }] })], ctx)).toBe(
      'BAD_FIGURES',
    );
    expect(
      validateEqDraftItems(
        [input({ figures: [{ fileId: 501, shared: false }, { fileId: 501, shared: true }] })],
        ctx,
      ),
    ).toBe('BAD_FIGURES');
  });

  it('직전 회차 밖 문항 연결은 BAD_PREV_ITEM, 겹치는 선택지 기호는 DUPLICATE_OPTION_KEY', () => {
    expect(validateEqDraftItems([input({ prevItemId: 8 })], ctx)).toBe('BAD_PREV_ITEM');
    expect(
      validateEqDraftItems([input({ options: [OPT_A, { ...OPT_A, label: '다른 말' }] })], ctx),
    ).toBe('DUPLICATE_OPTION_KEY');
  });
});

describe('답 검증(고객·대리 공용)', () => {
  const items = [item({ id: 11n, seq: 0, factoryNo: '1' }), item({ id: 12n, seq: 1, factoryNo: null })];

  it('전 문항에 그 문항의 기호로 답하면 통과 — 의견은 다듬고 비면 null', () => {
    const r = validateEqAnswers(items, [
      { itemId: 11, key: 'A', comment: '   ' },
      { itemId: 12, key: 'B', comment: ' 좌측으로 ' },
    ]);
    expect(r).toEqual({
      ok: true,
      decisions: [
        { itemId: 11n, key: 'A', comment: null },
        { itemId: 12n, key: 'B', comment: '좌측으로' },
      ],
    });
    if (r.ok) expect(summarizeEqAnswers(items, r.decisions)).toBe('1:A · 2:B');
  });

  it('누락·없는 문항·중복·없는 기호·의견 필수를 각각 가른다', () => {
    expect(validateEqAnswers(items, [{ itemId: 11, key: 'A' }])).toMatchObject({
      ok: false,
      error: 'ANSWERS_INCOMPLETE',
      itemId: 12,
    });
    expect(
      validateEqAnswers(items, [
        { itemId: 11, key: 'A' },
        { itemId: 99, key: 'A' },
      ]),
    ).toMatchObject({ ok: false, error: 'ANSWER_UNKNOWN_ITEM', itemId: 99 });
    expect(
      validateEqAnswers(items, [
        { itemId: 11, key: 'A' },
        { itemId: 11, key: 'B', comment: '두 번' },
      ]),
    ).toMatchObject({ ok: false, error: 'ANSWER_DUPLICATE' });
    expect(
      validateEqAnswers(items, [
        { itemId: 11, key: 'Z' },
        { itemId: 12, key: 'A' },
      ]),
    ).toMatchObject({ ok: false, error: 'ANSWER_BAD_KEY', itemId: 11 });
    expect(
      validateEqAnswers(items, [
        { itemId: 11, key: 'A' },
        { itemId: 12, key: 'B', comment: '네' }, // 한 글자 — 공장이 읽을 수 없다
      ]),
    ).toMatchObject({ ok: false, error: 'COMMENT_REQUIRED', itemId: 12 });
  });
});

describe('뷰 조립 — 화면마다 보이는 것이 다르다', () => {
  const answered = item({ answerKey: 'B', answerComment: '좌측 하단에 넣어 주세요', change: 'same', prevItemId: 7n });
  const prev = toEqPrevItem(item({ id: 7n, question: '이전 질문', answerKey: 'A', answerComment: null }));

  it('직전 문항은 질문·답·답 라벨을 싣는다', () => {
    expect(prev).toEqual({
      itemId: 7,
      question: '이전 질문',
      answer: { key: 'A', comment: null },
      answerLabel: '공장 제안대로',
    });
  });

  it('붙지 않은 그림 — 이 회차에 올렸는데 어느 문항에도 없는 것만, 올린 순으로, 비공개로', () => {
    const files = new Map([
      ...FILES,
      ['504', file(504n, 'later.png')],
      ['503', file(503n, 'loose.png')],
      ['601', { ...file(601n, 'other-round.png'), refId: 2n }], // 다른 회차의 그림(묶음 조회에 섞여 온다)
    ]);
    expect(looseEqFigures(1n, [item()], files)).toEqual([
      { fileId: 503, name: 'loose.png', size: 1234, shared: false },
      { fileId: 504, name: 'later.png', size: 1234, shared: false },
    ]);
    // 문항에 붙이면 빠진다 — 공개 여부와 무관하게.
    const attached = item({ id: 12n, figures: [{ fileId: 503, shared: true }] });
    expect(looseEqFigures(1n, [item(), attached], files).map((f) => f.fileId)).toEqual([504]);
    // 문항이 없으면 올린 그림이 전부 남는다(AI 분석이 그림부터 올리는 순간).
    expect(looseEqFigures(1n, [], files).map((f) => f.fileId)).toEqual([501, 502, 503, 504]);
    expect(looseEqFigures(2n, [], files).map((f) => f.fileId)).toEqual([601]);
  });

  it('관리자는 원문·전체 그림(공개 여부)·연결을 본다', () => {
    const v = toAdminEqItem(answered, FILES, prev);
    expect(v.questionOrig).toBe('是否加UL标记?');
    expect(v.options[1]?.labelOrig).toBe('贵司指示');
    expect(v.figures.map((f) => [f.fileId, f.shared])).toEqual([
      [501, true],
      [502, false],
    ]);
    expect(v.prevItemId).toBe(7);
    expect(v.change).toBe('same');
    expect(v.answer).toEqual({ key: 'B', comment: '좌측 하단에 넣어 주세요' });
  });

  it('고객은 원문·공장 원문 선택지·비공개 그림을 못 본다', () => {
    const v = toCustomerEqItem(answered, FILES, prev, false);
    const raw = JSON.stringify(v);
    expect(raw).not.toContain('是否加UL标记');
    expect(raw).not.toContain('贵司指示');
    expect(raw).not.toContain('labelOrig');
    expect(raw).not.toContain('factory-logo.png');
    expect(v.figures).toEqual([{ fileId: 501, name: 'ul-mark.png', size: 1234 }]);
    expect(v.change).toBe('same');
  });

  it('고객이 본 적 없는 이전 회차면 이전 답도 변화 표시도 비운다', () => {
    const v = toCustomerEqItem(answered, FILES, null, true);
    expect(v.prev).toBeNull();
    expect(v.change).toBeNull();
  });

  it('잇는 문항이 없는 신규 문항은 신규 표시가 그대로 간다', () => {
    const v = toCustomerEqItem(item({ prevItemId: null, change: 'new' }), FILES, null, false);
    expect(v.change).toBe('new');
    expect(v.prev).toBeNull();
  });

  it('협력사는 원문 질문·기호·고객 답을 보고 그림·권장 표시는 받지 않는다', () => {
    const v = toPartnerEqItem(answered);
    expect(v.questionOrig).toBe('是否加UL标记?');
    expect(v.options).toEqual([
      { key: 'A', label: '공장 제안대로', labelOrig: '按我司建议' },
      { key: 'B', label: '지시하겠습니다', labelOrig: '贵司指示' },
    ]);
    expect(v.answer).toEqual({ key: 'B', comment: '좌측 하단에 넣어 주세요' });
    expect(JSON.stringify(v)).not.toContain('figures');
  });

  it('문항 번호는 공장 원문 번호 우선, 없으면 순번', () => {
    expect(eqItemNo({ factoryNo: '2.0', seq: 0 })).toBe('2.0');
    expect(eqItemNo({ factoryNo: null, seq: 3 })).toBe('4');
  });

  it('이벤트는 사전 밖 행을 싣지 않는다', () => {
    const ev = (action: string): SpPcbEqReviewEvent => ({
      id: 1n,
      reviewId: 1n,
      action,
      actorRole: 'admin',
      actorMbId: 'admin',
      channel: 'phone',
      note: null,
      createdAt: new Date('2026-10-11T00:00:00Z'),
    });
    expect(toEqEvent(ev('proxy_answered'))).toMatchObject({ action: 'proxy_answered', channel: 'phone' });
    expect(toEqEvent(ev('mystery'))).toBeNull();
  });
});

describe('Json 방어·그림 파일 형식', () => {
  it('깨진 선택지·그림 원소는 버린다', () => {
    expect(parseEqItemOptions([OPT_A, { key: '' }, 'x', null])).toHaveLength(1);
    expect(parseEqItemFigures([{ fileId: 3, shared: true }, { fileId: '4' }, { fileId: -1 }, 'x'])).toEqual([
      { fileId: 3n, shared: true },
      { fileId: 4n, shared: false },
    ]);
  });

  it('이미지 확장자만 받고, 응답 타입은 확장자 MIME 이다(서버 값을 믿지 않는다)', () => {
    expect(eqFigureMime('fig.PNG', 'image/png')).toBe('image/png');
    expect(eqFigureMime('fig.jpg', 'application/octet-stream')).toBe('image/jpeg');
    expect(eqFigureMime('fig.svg', 'image/svg+xml')).toBeNull();
    expect(eqFigureMime('fig.png', 'text/html')).toBeNull();
    expect(eqFigureMime('fig.xls', 'application/vnd.ms-excel')).toBeNull();
    expect(eqFigureContentType('a.webp')).toBe('image/webp');
    expect(eqFigureContentType('a.html')).toBe('application/octet-stream');
  });
});
