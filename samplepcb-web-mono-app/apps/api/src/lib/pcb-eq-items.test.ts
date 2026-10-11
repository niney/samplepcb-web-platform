import type { SpFile, SpPcbEqReviewEvent, SpPcbEqReviewItem } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  eqFigureContentType,
  eqFigureMime,
  eqItemNo,
  countEqNumberedRounds,
  eqRoundNumbers,
  eqTextSimilarity,
  isEqReviewCustomerVisible,
  linkEqRevision,
  looseEqFigures,
  normalizeEqFactoryNo,
  normalizeEqOrigText,
  parseEqAiFlags,
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
  type EqRevisionSide,
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
  aiFlags: null,
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
      { id: 5n, poId: 1n, format: 'items', status: 'answered', sent: true },
      { id: 3n, poId: 1n, format: 'message', status: 'approved', sent: false },
      { id: 7n, poId: 1n, format: 'items', status: 'canceled', sent: false }, // 작성 중에 EQ 가 움직여 닫힘
      { id: 9n, poId: 1n, format: 'items', status: 'canceled', sent: true }, // 보낸 뒤 닫힘 — 고객이 봤다
      { id: 12n, poId: 1n, format: 'items', status: 'draft', sent: false }, // 지금 작성 중 — 다음 번호
    ]);
    expect(rounds.get('5')).toBe(1);
    expect(rounds.get('3')).toBeUndefined();
    expect(rounds.get('7')).toBeUndefined();
    expect(rounds.get('9')).toBe(2);
    expect(rounds.get('12')).toBe(3);
  });

  it('발주서마다 1부터 센다 — 목록이 여러 발주서의 회차를 한 번에 넘겨도 남의 회차가 번호를 밀지 않는다', () => {
    // 회귀: 통째로 세던 때 마이페이지에 "5차 확인"이 떴다(다른 발주서의 문항형 회차 넷이 앞에 있었다).
    const rounds = eqRoundNumbers([
      { id: 20n, poId: 1n, format: 'items', status: 'answered', sent: true },
      { id: 21n, poId: 2n, format: 'items', status: 'answered', sent: true },
      { id: 22n, poId: 3n, format: 'items', status: 'draft', sent: false },
      { id: 23n, poId: 2n, format: 'items', status: 'requested', sent: true },
      { id: 24n, poId: 1n, format: 'items', status: 'draft', sent: false },
    ]);
    expect([20, 21, 22, 23, 24].map((id) => rounds.get(String(id)))).toEqual([1, 1, 1, 2, 2]);
  });

  it('회차 수는 번호가 붙은 것만 발주서별로 센다 — 작업공간 탭 수와 같다', () => {
    // 발주 행 eqRoundCount: 추가 EQ 요청 뒤 다시 올라온 발주는 요약(eqReview)이 비어도 지난 회차가 남아 있다.
    const counts = countEqNumberedRounds([
      { id: 1n, poId: 1n, format: 'items', status: 'approved', sent: true }, // 승인으로 닫힌 1차
      { id: 2n, poId: 1n, format: 'items', status: 'canceled', sent: true }, // 보낸 뒤 취소 — 탭으로 남는다
      { id: 3n, poId: 1n, format: 'items', status: 'canceled', sent: false }, // 안 나간 채 닫힌 초안 — 번호도 탭도 없다
      { id: 4n, poId: 1n, format: 'items', status: 'draft', sent: false }, // 작성 중
      { id: 5n, poId: 1n, format: 'message', status: 'approved', sent: false }, // 문구형(D16)
      { id: 6n, poId: 2n, format: 'items', status: 'canceled', sent: false }, // 세면 문은 열리는데 안이 빈다
      { id: 7n, poId: 3n, format: 'items', status: 'answered', sent: true },
    ]);
    expect(counts.get('1')).toBe(3);
    expect(counts.has('2'), '안 나간 초안뿐이면 키가 없다(=0)').toBe(false);
    expect(counts.get('3')).toBe(1);
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
    aiFlags: [],
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

// ── D20 P2 — AI 초안의 개정 대조·검토 표시 ───────────────────────────────────

describe('개정 회차 대조(linkEqRevision) — 결정적, LLM 아님', () => {
  const side = (factoryNo: string | null, questionOrig: string | null, options = OPTIONS): EqRevisionSide => ({
    factoryNo,
    questionOrig,
    options,
  });
  const Q_UL = '是否需要在板上加UL标记？ Please confirm whether UL marking is required.';
  const Q_VIA = '0.2mm孔径加大到0.25mm可以吗？ Can we enlarge the 0.2mm via to 0.25mm?';
  const Q_OUTLINE = '外形公差按±0.15mm制作是否可以？ Is outline tolerance ±0.15mm acceptable?';
  const PREV = [side('1', Q_UL), side('2', Q_VIA), side('3', Q_OUTLINE)];

  it('번호·원문·선택지가 그대로면 동일 — 공백·구두점·전각 차이는 같은 글로 본다', () => {
    const next = [
      side('1.0', '是否需要在板上加 UL 标记?  Please confirm whether UL marking is required'),
      side('2', Q_VIA),
      side('3', Q_OUTLINE),
    ];
    expect(linkEqRevision(next, PREV)).toEqual([
      { prevIndex: 0, change: 'same' },
      { prevIndex: 1, change: 'same' },
      { prevIndex: 2, change: 'same' },
    ]);
  });

  it('원문의 수치가 바뀌면 변경 — 같은 번호에 잇되 이전 답을 미리 고르지 않는다', () => {
    const next = [side('1', Q_UL), side('2', Q_VIA.replaceAll('0.25mm', '0.3mm')), side('3', Q_OUTLINE)];
    expect(linkEqRevision(next, PREV).map((l) => l.change)).toEqual(['same', 'changed', 'same']);
    expect(linkEqRevision(next, PREV)[1]).toEqual({ prevIndex: 1, change: 'changed' });
  });

  it('소수점은 구두점으로 지우지 않는다 — 1.5mm 와 15mm 는 다른 글', () => {
    expect(normalizeEqOrigText('孔径 1.5mm。')).toBe('孔径1.5mm');
    expect(normalizeEqOrigText('孔径 1.5mm')).not.toBe(normalizeEqOrigText('孔径 15mm'));
    expect(normalizeEqOrigText('公差 -0.05 / +0.1')).toBe('公差-0.05+0.1');
    const prev = [side('1', '孔径按1.5mm制作是否可以？')];
    expect(linkEqRevision([side('1', '孔径按15mm制作是否可以？')], prev)).toEqual([
      { prevIndex: 0, change: 'changed' },
    ]);
  });

  it('번호가 당겨져도 원문이 같은 문항끼리 잇는다(문항 삭제 뒤 번호 바뀜)', () => {
    // 옛 2번이 빠지고 옛 3번이 2번이 됐다 — 번호로 이으면 옛 2번(다른 질문)의 답이 붙는다.
    const next = [side('1', Q_UL), side('2', Q_OUTLINE)];
    expect(linkEqRevision(next, PREV)).toEqual([
      { prevIndex: 0, change: 'same' },
      { prevIndex: 2, change: 'same' },
    ]);
  });

  it('짝이 없는 문항은 신규, 번호만 물려받은 딴 질문도 신규', () => {
    const next = [
      side('1', Q_UL),
      side('2', '阻焊桥宽度不足，是否允许开通窗？ Solder mask dam is too narrow, may we open the window?'),
      side('4', '表面处理改为沉金是否可以？ May we change the surface finish to ENIG?'),
    ];
    expect(linkEqRevision(next, PREV)).toEqual([
      { prevIndex: 0, change: 'same' },
      { prevIndex: null, change: 'new' },
      { prevIndex: null, change: 'new' },
    ]);
  });

  it('원문은 같은데 선택지가 바뀌면 변경(이전 답의 기호가 다른 뜻일 수 있다)', () => {
    const optionsV2 = [OPT_A, { ...OPT_B, labelOrig: '取消该要求' }];
    expect(linkEqRevision([side('1', Q_UL, optionsV2)], PREV)).toEqual([{ prevIndex: 0, change: 'changed' }]);
    expect(linkEqRevision([side('1', Q_UL, [OPT_A])], PREV)).toEqual([{ prevIndex: 0, change: 'changed' }]);
  });

  it('번호가 없어도 원문이 거의 같으면 변경으로 잇는다 — 조금 닮은 정도로는 잇지 않는다', () => {
    const prev = [side(null, Q_VIA)];
    expect(linkEqRevision([side(null, Q_VIA.replace('0.25mm?', '0.3mm?'))], prev)).toEqual([
      { prevIndex: 0, change: 'changed' },
    ]);
    expect(linkEqRevision([side(null, Q_OUTLINE)], prev)).toEqual([{ prevIndex: null, change: 'new' }]);
  });

  it('직전 문항에 원문이 없으면(손으로 쓴 문항) 번호를 믿고 변경 — 동일이라 하지 않는다', () => {
    expect(linkEqRevision([side('2', Q_VIA)], [side('1', null), side('2', null)])).toEqual([
      { prevIndex: 1, change: 'changed' },
    ]);
  });

  it('직전 문항 하나는 한 번만 이어진다', () => {
    const links = linkEqRevision([side('1', Q_UL), side('5', Q_UL)], [side('1', Q_UL)]);
    expect(links).toEqual([
      { prevIndex: 0, change: 'same' },
      { prevIndex: null, change: 'new' },
    ]);
  });

  it('번호 정규화·유사도', () => {
    expect(['1', '1.0', '01', '(1)', '1.', '１'].map(normalizeEqFactoryNo)).toEqual(['1', '1', '1', '1', '1', '1']);
    expect(normalizeEqFactoryNo('  ')).toBeNull();
    expect(normalizeEqFactoryNo(null)).toBeNull();
    expect(eqTextSimilarity('abcdef', 'abcdef')).toBe(1);
    expect(eqTextSimilarity('abcdef', 'uvwxyz')).toBe(0);
    expect(eqTextSimilarity('', '')).toBe(0);
  });
});

describe('AI 검토 표시', () => {
  it('깨진 원소는 버리고, 관리자 문항에만 실린다', () => {
    const flags = [{ code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' }, { code: 'nope', detail: 'x' }, 'x'];
    expect(parseEqAiFlags(flags)).toEqual([{ code: 'translation', detail: '원문의 0.25mm 가 번역에 없습니다' }]);
    expect(parseEqAiFlags(null)).toEqual([]);
    const row = item({ aiFlags: flags });
    expect(toAdminEqItem(row, FILES, null).aiFlags).toHaveLength(1);
    expect(JSON.stringify(toCustomerEqItem(row, FILES, null, false))).not.toContain('aiFlags');
    expect(JSON.stringify(toPartnerEqItem(row))).not.toContain('aiFlags');
  });
});
