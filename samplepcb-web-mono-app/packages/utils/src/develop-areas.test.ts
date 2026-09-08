import { describe, expect, it } from 'vitest';
import {
  DEVELOP_AREAS,
  DEVELOP_AREA_CODES,
  DEVELOP_DELEGATE_KEPT_CODES,
  DEVELOP_INDIVIDUAL_AREA_CODES,
  DEVELOP_SYSTEM_AREA_CODES,
  DEVELOP_SYSTEM_QUESTIONS,
  DevelopProductionPlan,
  DevelopRequestCreatePayload,
  MARKET_AREA_CODES,
  developAnswerIssues,
  developAnswerText,
  developAreaBadge,
  developProductionSummary,
  developQuestionsFor,
  developWishCode,
  isTextQuestion,
  keepDevelopDelegateAnswers,
  marketAreaBadge,
  normalizeDevelopProduction,
  parseDevelopAttachmentField,
  parseMarketAttachmentField,
  resolveDevelopServiceAreas,
} from '@sp/api-contract';

// 개발의뢰 분야 레지스트리(docs/DEVELOP_FLOW.md §7.2, 2026-09-08 위저드 v2) — 마켓 레지스트리와 같은 팩토리로 만든
// 별개 레지스트리의 계약. 마켓 쪽(market-areas.test.ts)은 바이트 무변경이 전제다.

describe('개발의뢰 레지스트리 정합성', () => {
  it('6분야(기구 포함)·개별 메뉴 4·시스템개발 = 전 분야', () => {
    expect(DEVELOP_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'mech', 'app', 'server']);
    expect(DEVELOP_INDIVIDUAL_AREA_CODES).toEqual(['pcb', 'mech', 'app', 'server']);
    expect(DEVELOP_SYSTEM_AREA_CODES).toEqual(DEVELOP_AREA_CODES);
    // 마켓 레지스트리는 그대로 5분야.
    expect(MARKET_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'app', 'server']);
  });

  it('질문 코드는 분야 접두를 갖고 유일하며, text 문항은 선택지가 없다', () => {
    const codes = [...DEVELOP_AREAS.flatMap((a) => a.questions), ...DEVELOP_SYSTEM_QUESTIONS].map((q) => q.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of DEVELOP_AREAS) for (const q of a.questions) expect(q.code.startsWith(`${a.code}.`)).toBe(true);
    for (const q of DEVELOP_SYSTEM_QUESTIONS) {
      expect(q.code.startsWith('system.')).toBe(true);
      // 서술 문항은 선택지가 없고, 협업 범위(선택지) 문항은 탈출구(unknown)를 갖는다.
      if (isTextQuestion(q)) expect(q.options).toEqual([]);
      else expect(q.options.some((o) => o.code === 'unknown')).toBe(true);
    }
    expect(DEVELOP_SYSTEM_QUESTIONS.filter(isTextQuestion).length).toBe(3);
    expect(DEVELOP_SYSTEM_QUESTIONS.filter((q) => q.askOnDelegate === true).length).toBe(2);
    // 회로·펌웨어는 개별 메뉴가 없으니 분야별 질문도 없다(시스템개발 3문항이 대신한다).
    expect(DEVELOP_AREAS.find((a) => a.code === 'circuit')?.questions).toEqual([]);
    expect(DEVELOP_AREAS.find((a) => a.code === 'firmware')?.questions).toEqual([]);
    expect(DEVELOP_AREAS.find((a) => a.code === 'mech')?.questions.length).toBe(7);
  });

  it('시스템개발(전 분야)이면 분야별 질문 대신 시스템 5문항(서술 3 + 디자인·기구 범위 2), 개별이면 고른 분야 문항만', () => {
    expect(developQuestionsFor(DEVELOP_SYSTEM_AREA_CODES).map((q) => q.code)).toEqual([
      'system.use', 'system.io', 'system.safety', 'system.product_design', 'system.mech_design',
    ]);
    // 전문가에게 맡김에서도 디자인·기구 범위는 남고, 서술·폐기된 협업 문항은 버려진다.
    expect(DEVELOP_DELEGATE_KEPT_CODES).toEqual(['system.product_design', 'system.mech_design']);
    expect(keepDevelopDelegateAnswers([
      { code: 'system.use' }, { code: 'system.collab' }, { code: 'system.product_design' }, { code: 'system.mech_design' },
    ]).map((a) => a.code)).toEqual(['system.product_design', 'system.mech_design']);
    // PCB 는 프로토타입처럼 설계 툴을 문항으로 묻는다(희망 툴 UI 는 개발의뢰에서 뺐다, 2026-09-08 간소화).
    expect(developQuestionsFor(['pcb']).map((q) => q.code)).toEqual([
      'pcb.type', 'pcb.tool', 'pcb.source', 'pcb.board', 'pcb.mech', 'pcb.signal', 'pcb.deliver',
    ]);
    const pcbApp = developQuestionsFor(['pcb', 'app']).map((q) => q.code);
    expect(pcbApp.every((c) => c.startsWith('pcb.') || c.startsWith('app.'))).toBe(true);
    expect(pcbApp.length).toBe(13);
    expect(developQuestionsFor([])).toEqual([]);
  });

  it('배지 — 전 분야는 시스템개발, 둘 이상은 " + ", 하나는 분야명', () => {
    expect(developAreaBadge(DEVELOP_SYSTEM_AREA_CODES)).toBe('시스템개발');
    expect(developAreaBadge(['app', 'pcb'])).toBe('PCB + 앱');
    expect(developAreaBadge(['mech'])).toBe('기구설계');
    expect(developAreaBadge([])).toBe('');
    // 마켓 배지는 그대로.
    expect(marketAreaBadge(MARKET_AREA_CODES)).toBe('풀 개발(회로·PCB·펌웨어·앱·서버)');
  });

  it('resolveDevelopServiceAreas — 시스템은 6분야, 개별은 개별 메뉴 안의 것만 레지스트리 순서로', () => {
    expect(resolveDevelopServiceAreas('system', ['pcb'])).toEqual(DEVELOP_SYSTEM_AREA_CODES);
    expect(resolveDevelopServiceAreas('individual', ['server', 'circuit', 'pcb'])).toEqual(['pcb', 'server']);
  });
});

describe('답변 검증·표시', () => {
  it('text 문항은 note 만, choice 문항은 선택지 1개 이상', () => {
    const areas = ['pcb', 'app'];
    expect(developAnswerIssues([{ code: 'app.flow', choices: [], note: '로그인 → 제어' }], areas)).toEqual([]);
    expect(developAnswerIssues([{ code: 'app.flow', choices: ['x'], note: '' }], areas)).toEqual(['answers[0]: INVALID_CHOICE', 'answers[0]: NOTE_REQUIRED']);
    expect(developAnswerIssues([{ code: 'pcb.type', choices: [] }], areas)).toEqual(['answers[0]: EMPTY_CHOICES']);
    expect(developAnswerIssues([{ code: 'pcb.type', choices: ['new', 'modify'] }], areas)).toEqual(['answers[0]: SINGLE_CHOICE']);
    // 분야 밖·사전 밖 문항.
    expect(developAnswerIssues([{ code: 'mech.type', choices: ['new'] }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
    expect(developAnswerIssues([{ code: 'timeline', choices: ['m2_3'] }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
    // 시스템개발 문항은 전 분야일 때만 허용.
    expect(developAnswerIssues([{ code: 'system.use', choices: [], note: '공장' }], DEVELOP_SYSTEM_AREA_CODES)).toEqual([]);
    expect(developAnswerIssues([{ code: 'system.use', choices: [], note: '공장' }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
  });

  it('답변 문자열 — 선택지 라벨(+메모), text 문항은 서술 그대로', () => {
    expect(developAnswerText({ code: 'pcb.signal', choices: ['usb', 'rf'] })).toBe('USB, RF·안테나');
    expect(developAnswerText({ code: 'pcb.board', choices: ['fpcb'], note: '4층 50×30×0.2' })).toBe('FPCB (4층 50×30×0.2)');
    expect(developAnswerText({ code: 'system.io', choices: [], note: '온도 → 펌프 정지' })).toBe('온도 → 펌프 정지');
  });

  it('첨부 슬롯 — 기구 슬롯은 개발의뢰 레지스트리에만 있다', () => {
    expect(parseDevelopAttachmentField('attachment:mech:step')).toEqual({ area: 'mech', slot: 'step' });
    expect(parseMarketAttachmentField('attachment:mech:step')).toBeUndefined();
    expect(parseDevelopAttachmentField('attachment:pcb:gerber')).toEqual({ area: 'pcb', slot: 'gerber' });
    expect(parseDevelopAttachmentField('attachment')).toBeNull();
  });
});

describe('등록 payload·생산 계획·희망 시기', () => {
  const contact = { name: '홍길동', company: null, phone: '010-1234-5678', email: 'a@b.co', hours: null };
  const base = {
    requestMode: 'individual' as const,
    title: '디스펜서',
    serviceAreas: ['pcb'],
    description: '열 글자 넘는 설명입니다 정말로',
    currentStage: 'idea' as const,
    targetStage: 'prototype_done' as const,
    wishDate: null,
    wishNote: '계약 후 3개월',
    budgetRange: 'r1000_3000' as const,
    production: { prototype: 'count' as const, prototypeQty: 5, scopes: ['pcb_fab' as const], sourcing: 'negotiate' as const },
    contact,
  };

  it('개별 견적은 개별 메뉴 코드 1개 이상, 희망 시기는 날짜·자유문 중 하나', () => {
    expect(DevelopRequestCreatePayload.safeParse(base).success).toBe(true);
    const messages = (r: ReturnType<typeof DevelopRequestCreatePayload.safeParse>): string[] =>
      r.success ? [] : r.error.issues.map((i) => i.message);
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, serviceAreas: [] }))).toContain('AREA_REQUIRED');
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, serviceAreas: ['circuit'] }))).toContain('UNKNOWN_AREA');
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, wishNote: null }))).toContain('WISH_REQUIRED');
    // 시스템개발은 분야를 비워도 된다(서버가 전 분야로 채운다) — 시스템 문항 답변 허용.
    const sys = DevelopRequestCreatePayload.safeParse({
      ...base, requestMode: 'system', serviceAreas: [], answers: [{ code: 'system.use', choices: [], note: '공장' }],
    });
    expect(sys.success).toBe(true);
  });

  it('생산 계획 — 직접입력이면 수량 필수, 정규화는 범위 없으면 조달·납품을 비운다', () => {
    expect(DevelopProductionPlan.safeParse({ prototype: 'count', prototypeQty: null }).success).toBe(false);
    const p = DevelopProductionPlan.parse({ prototype: 'none', prototypeQty: 3, scopes: [], sourcing: 'negotiate', delivery: 'pcba' });
    expect(normalizeDevelopProduction(p)).toEqual({ prototype: 'none', prototypeQty: null, scopes: [], annualQty: null, priority: null, sourcing: null, delivery: null });
    expect(developProductionSummary({ prototype: 'count', prototypeQty: 5, scopes: ['pcb_fab', 'smt'], annualQty: 5000, priority: null, sourcing: null, delivery: null }))
      .toBe('시제품 5개 · PCB 제작, SMT·수삽 · 연간 5,000개');
    expect(developProductionSummary(null)).toBe('');
  });

  it('희망 완료일 → 검토서 일정 대조 코드(주 수 경계), 없거나 지났으면 null', () => {
    const from = '2026-09-08T00:00:00.000Z';
    expect(developWishCode('2026-10-01', from)).toBe('within_1m'); // 4주 이내
    expect(developWishCode('2026-11-30', from)).toBe('m2_3'); // 12주
    expect(developWishCode('2027-02-20', from)).toBe('m4_6'); // 24주
    expect(developWishCode('2027-06-01', from)).toBe('over_6m');
    expect(developWishCode(null, from)).toBeNull();
    expect(developWishCode('2026-01-01', from)).toBeNull();
    expect(developWishCode('not-a-date', from)).toBeNull();
  });
});
