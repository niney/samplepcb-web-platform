import { describe, expect, it } from 'vitest';
import {
  DEVELOP_AREAS,
  DEVELOP_AREA_CODES,
  DEVELOP_DELEGATE_KEPT_CODES,
  DEVELOP_INDIVIDUAL_AREA_CODES,
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_MENU_CARDS,
  DEVELOP_PCB_MATERIALS,
  DEVELOP_PCB_MATERIAL_AREA,
  DEVELOP_PCB_MATERIAL_CODES,
  DEVELOP_QUESTIONS,
  DEVELOP_SYSTEM_AREA_CODES,
  DEVELOP_SYSTEM_QUESTIONS,
  DevelopProductionPlan,
  DevelopRequestCreatePayload,
  MARKET_AREA_CODES,
  developAnswerIssues,
  developAnswerText,
  developAreaBadge,
  developBudgetOptions,
  developNeedsProduction,
  developNeedsStages,
  developPcbMaterialsMode,
  developProductionSummary,
  developQuestion,
  developQuestionsFor,
  developRequiredMissing,
  developReverseRightsCheckNeeded,
  developSlotLabel,
  developVisibleQuestionsFor,
  developWishCode,
  isDevelopSystemAreas,
  isTextQuestion,
  keepDevelopDelegateAnswers,
  marketAreaBadge,
  normalizeDevelopProduction,
  parseDevelopAttachmentField,
  parseMarketAttachmentField,
  pruneDevelopHiddenAnswers,
  resolveDevelopServiceAreas,
} from '@sp/api-contract';

// 개발의뢰 분야 레지스트리(docs/DEVELOP_FLOW.md §7.2, 2026-09-08 위저드 v2 → 2026-10-30 메뉴 6장) — 마켓 레지스트리와 같은
// 팩토리로 만든 별개 레지스트리의 계약. 마켓 쪽(market-areas.test.ts)은 바이트 무변경이 전제다.

describe('개발의뢰 레지스트리 정합성', () => {
  it('7분야(역설계·기구 포함)·개별 메뉴 6분야·시스템개발 = 역설계 뺀 6분야', () => {
    expect(DEVELOP_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'reverse', 'mech', 'app', 'server']);
    expect(DEVELOP_INDIVIDUAL_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'reverse', 'app', 'server']);
    expect(DEVELOP_SYSTEM_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'mech', 'app', 'server']);
    // 메뉴 카드 5장(시스템 제외) — '앱 및 서버'는 두 분야.
    expect(DEVELOP_MENU_CARDS.map((c) => c.code)).toEqual(['circuit', 'pcb', 'firmware', 'reverse', 'appserver']);
    expect(DEVELOP_MENU_CARDS.find((c) => c.code === 'appserver')?.areas).toEqual(['app', 'server']);
    // 마켓 레지스트리는 그대로 5분야.
    expect(MARKET_AREA_CODES).toEqual(['circuit', 'pcb', 'firmware', 'app', 'server']);
  });

  it('질문 코드는 사전에서 유일하고, 분야 질문은 분야 접두 또는 공유 접두(hw·appserver)', () => {
    const codes = DEVELOP_QUESTIONS.map((q) => q.code);
    expect(new Set(codes).size).toBe(codes.length);
    const SHARED = ['hw.', 'appserver.'];
    for (const a of DEVELOP_AREAS) {
      for (const q of a.questions) expect(q.code.startsWith(`${a.code}.`) || SHARED.some((p) => q.code.startsWith(p))).toBe(true);
    }
    for (const q of DEVELOP_SYSTEM_QUESTIONS) {
      expect(q.code.startsWith('system.')).toBe(true);
      if (isTextQuestion(q)) expect(q.options).toEqual([]);
      else expect(q.options.some((o) => o.code === 'unknown')).toBe(true);
    }
    expect(DEVELOP_SYSTEM_QUESTIONS.filter((q) => q.askOnDelegate === true).length).toBe(2);
    // 기구는 개별 메뉴가 없으니 분야별 질문도 없다(시스템개발 외관·기구 2문항이 대신한다).
    expect(DEVELOP_AREAS.find((a) => a.code === 'mech')?.questions).toEqual([]);
    // 탈출구 없는 choice 문항은 역설계 권리 확인(필수) 하나뿐이다. 필수는 그것과 PCB 회로도·BOM(탈출구 있음, 2026-11-02).
    const noEscape = DEVELOP_QUESTIONS.filter((q) => !isTextQuestion(q) && !q.options.some((o) => o.code === 'unknown')).map((q) => q.code);
    expect(noEscape).toEqual(['reverse.rights']);
    expect(DEVELOP_QUESTIONS.filter((q) => q.required === true).map((q) => q.code)).toEqual(['pcb.schematic', 'pcb.bom', 'reverse.rights']);
  });

  it('PCB 설계 설계 자료(2026-11-02) — 2스텝 질문 다섯·질문 옆 첨부 칸·기존 원본 조건·필수 회로도·BOM', () => {
    expect(DEVELOP_PCB_MATERIAL_CODES).toEqual(['pcb.type', 'pcb.original', 'pcb.schematic', 'pcb.bom', 'pcb.size']);
    for (const m of DEVELOP_PCB_MATERIALS) {
      const q = developQuestion(m.code);
      expect(q?.code.startsWith(`${DEVELOP_PCB_MATERIAL_AREA}.`)).toBe(true);
      // 첨부 칸을 여는 선택지는 그 질문의 선택지다.
      const options = q?.options.map((o) => o.code) ?? [];
      expect(m.fileFor.every((c) => options.includes(c))).toBe(true);
      // 첨부 칸은 서버가 받는 분야별 첨부 슬롯이다.
      if (m.slot !== null) expect(parseDevelopAttachmentField(`attachment:pcb:${m.slot}`)).toEqual({ area: 'pcb', slot: m.slot });
    }
    // BOM 슬롯은 개발의뢰에만 더했다 — 마켓 레지스트리는 그대로.
    expect(developSlotLabel('pcb', 'bom')).toBe('BOM');
    expect(parseMarketAttachmentField('attachment:pcb:bom')).toBeUndefined();
    // 필수 = 회로도·BOM('잘 모르겠어요'도 답이다). 시스템개발은 PCB 질문을 묻지 않으니 필수도 없다.
    expect(developRequiredMissing([], ['pcb'])).toEqual(['pcb.schematic', 'pcb.bom']);
    expect(developRequiredMissing([{ code: 'pcb.schematic', choices: ['unknown'] }, { code: 'pcb.bom', choices: ['none'] }], ['pcb'])).toEqual([]);
    expect(developRequiredMissing([], DEVELOP_SYSTEM_AREA_CODES)).toEqual([]);
    // 기존 원본은 작업 범위가 수정·배선만일 때만.
    const originalShown = (choice: string): boolean =>
      developVisibleQuestionsFor(['pcb'], [{ code: 'pcb.type', choices: [choice] }]).some((q) => q.code === 'pcb.original');
    expect(['new', 'modify', 'placement', 'routing', 'unknown'].map(originalShown)).toEqual([false, true, false, true, false]);
    // 모드 — PCB 하나만 고른 개별 의뢰만.
    expect(developPcbMaterialsMode('individual', ['pcb'])).toBe(true);
    expect(developPcbMaterialsMode('individual', ['pcb', 'circuit'])).toBe(false);
    expect(developPcbMaterialsMode('system', ['pcb'])).toBe(false);
    expect(developPcbMaterialsMode(null, ['pcb'])).toBe(false);
  });

  it('예산 선택지 — PCB 설계만이면 낮은 구간, 라벨은 한 사전', () => {
    expect(developBudgetOptions(false)).toEqual(['under1000', 'r1000_3000', 'r3000_5000', 'r5000_10000', 'over10000', 'after_quote']);
    expect(developBudgetOptions(true)).toEqual(['under100', 'r100_300', 'r300_500', 'r500_1000', 'over1000', 'after_quote']);
    for (const code of [...developBudgetOptions(false), ...developBudgetOptions(true)]) expect(DEVELOP_BUDGET_RANGE_LABELS[code]).not.toBe('');
  });

  it('시스템개발이면 분야별 질문 대신 시스템 문항(분석 후 확인 5 + 외관·기구 2), 개별이면 고른 분야 문항만', () => {
    expect(developQuestionsFor(DEVELOP_SYSTEM_AREA_CODES).map((q) => q.code)).toEqual([
      'system.io', 'system.env', 'system.power', 'system.connect', 'system.cert', 'system.product_design', 'system.mech_design',
    ]);
    expect(isDevelopSystemAreas(DEVELOP_SYSTEM_AREA_CODES)).toBe(true);
    // 역설계가 더 있어도 6분야가 다 있으면 시스템개발 — 6분야 중 하나라도 빠지면 아니다.
    expect(isDevelopSystemAreas(['circuit', 'pcb', 'firmware', 'reverse', 'app', 'server'])).toBe(false);
    expect(DEVELOP_DELEGATE_KEPT_CODES).toEqual(['system.product_design', 'system.mech_design']);
    expect(keepDevelopDelegateAnswers([
      { code: 'system.io' }, { code: 'system.product_design' }, { code: 'system.mech_design' },
    ]).map((a) => a.code)).toEqual(['system.product_design', 'system.mech_design']);
    expect(developQuestionsFor(['pcb']).map((q) => q.code)).toEqual([
      'pcb.type', 'pcb.original', 'pcb.schematic', 'pcb.bom', 'pcb.size', 'pcb.board', 'pcb.signal', 'pcb.tool', 'pcb.deliver',
    ]);
    expect(developQuestionsFor([])).toEqual([]);
  });

  it('공유 문항 — 회로·펌웨어 통신은 한 번, 앱·서버 범위·작업 종류도 한 번', () => {
    expect(developQuestionsFor(['circuit']).map((q) => q.code)).toContain('hw.comm');
    expect(developQuestionsFor(['firmware']).map((q) => q.code)).toContain('hw.comm');
    const both = developQuestionsFor(['circuit', 'firmware']).map((q) => q.code);
    expect(both.filter((c) => c === 'hw.comm').length).toBe(1);
    expect(both.length).toBe(8 + 7 - 1);
    const appServer = developQuestionsFor(['app', 'server']).map((q) => q.code);
    expect(appServer.slice(0, 2)).toEqual(['appserver.scope', 'appserver.type']);
    expect(appServer.length).toBe(2 + 6 + 6);
    expect(developQuestionsFor(['server']).map((q) => q.code).slice(0, 2)).toEqual(['appserver.scope', 'appserver.type']);
  });

  it('배지 — 6분야는 시스템개발, 둘 이상은 " + ", 하나는 분야명', () => {
    expect(developAreaBadge(DEVELOP_SYSTEM_AREA_CODES)).toBe('시스템 개발');
    expect(developAreaBadge(['app', 'pcb'])).toBe('PCB + 앱');
    expect(developAreaBadge(['reverse'])).toBe('역설계');
    expect(developAreaBadge(['circuit'])).toBe('회로 설계');
    expect(developAreaBadge([])).toBe('');
    expect(marketAreaBadge(MARKET_AREA_CODES)).toBe('풀 개발(회로·PCB·펌웨어·앱·서버)');
  });

  it('resolveDevelopServiceAreas — 시스템은 6분야, 개별은 개별 메뉴 안의 것만, 앱·서버는 범위 답대로', () => {
    expect(resolveDevelopServiceAreas('system', ['pcb'])).toEqual(DEVELOP_SYSTEM_AREA_CODES);
    expect(resolveDevelopServiceAreas('individual', ['server', 'mech', 'pcb'])).toEqual(['pcb', 'app', 'server']);
    const scope = (s: string) => [{ code: 'appserver.scope', choices: [s] }];
    expect(resolveDevelopServiceAreas('individual', ['app', 'server'], scope('app'))).toEqual(['app']);
    expect(resolveDevelopServiceAreas('individual', ['circuit', 'app', 'server'], scope('server'))).toEqual(['circuit', 'server']);
    // 상담·무응답이면 둘 다, 하나만 들어와도 '모두'면 채운다.
    expect(resolveDevelopServiceAreas('individual', ['app'], scope('unknown'))).toEqual(['app', 'server']);
    expect(resolveDevelopServiceAreas('individual', ['app'])).toEqual(['app', 'server']);
    expect(resolveDevelopServiceAreas('individual', ['pcb'], scope('app'))).toEqual(['pcb']);
  });

  it('건너뛰는 스텝 — 펌웨어·앱·서버만이면 제작 계획 없음, 역설계·PCB 만이면 개발 단계 없음', () => {
    expect(developNeedsProduction(['firmware', 'app', 'server'])).toBe(false);
    expect(developNeedsProduction(['firmware', 'pcb'])).toBe(true);
    expect(developNeedsProduction(['reverse'])).toBe(true);
    expect(developNeedsProduction(DEVELOP_SYSTEM_AREA_CODES)).toBe(true);
    expect(developNeedsStages(['reverse'])).toBe(false);
    expect(developNeedsStages(['pcb'])).toBe(false);
    expect(developNeedsStages(['reverse', 'pcb'])).toBe(false); // 둘 다 단계를 안 묻는 메뉴(2026-11-02)
    expect(developNeedsStages(['reverse', 'circuit'])).toBe(true);
  });
});

describe('답변 검증·표시', () => {
  it('text 문항은 note 만, choice 문항은 선택지 1개 이상', () => {
    const areas = ['pcb', 'firmware'];
    expect(developAnswerIssues([{ code: 'firmware.flow', choices: [], note: '센서 → 판단 → 밸브' }], areas)).toEqual([]);
    expect(developAnswerIssues([{ code: 'firmware.flow', choices: ['x'], note: '' }], areas)).toEqual(['answers[0]: INVALID_CHOICE', 'answers[0]: NOTE_REQUIRED']);
    expect(developAnswerIssues([{ code: 'pcb.type', choices: [] }], areas)).toEqual(['answers[0]: EMPTY_CHOICES']);
    expect(developAnswerIssues([{ code: 'pcb.type', choices: ['new', 'modify'] }], areas)).toEqual(['answers[0]: SINGLE_CHOICE']);
    // 분야 밖·사전 밖 문항.
    expect(developAnswerIssues([{ code: 'circuit.type', choices: ['new'] }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
    expect(developAnswerIssues([{ code: 'mech.type', choices: ['new'] }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
    // 시스템개발 문항은 6분야일 때만 허용.
    expect(developAnswerIssues([{ code: 'system.io', choices: [], note: '공장' }], DEVELOP_SYSTEM_AREA_CODES)).toEqual([]);
    expect(developAnswerIssues([{ code: 'system.io', choices: [], note: '공장' }], areas)).toEqual(['answers[0]: UNKNOWN_QUESTION']);
  });

  it('역설계 — 권리 확인은 필수, 조건부 문항은 그 선택지를 골랐을 때만(숨은 답은 버린다)', () => {
    expect(developRequiredMissing([], ['reverse'])).toEqual(['reverse.rights']);
    expect(developRequiredMissing([{ code: 'reverse.rights', choices: ['own'] }], ['reverse'])).toEqual([]);
    expect(developRequiredMissing([], ['firmware'])).toEqual([]);
    const answers = [
      { code: 'reverse.rights', choices: ['own'] },
      { code: 'reverse.work', choices: ['schematic'] },
      { code: 'reverse.firmware', choices: ['known_part'] },
      { code: 'reverse.pcba', choices: ['basic'] },
    ];
    expect(pruneDevelopHiddenAnswers(answers).map((a) => a.code)).toEqual(['reverse.rights', 'reverse.work']);
    const withFw = answers.map((a) => (a.code === 'reverse.work' ? { ...a, choices: ['schematic', 'firmware'] } : a));
    expect(pruneDevelopHiddenAnswers(withFw).map((a) => a.code)).toEqual(['reverse.rights', 'reverse.work', 'reverse.firmware']);
    // 관리자 신호 — 유지보수 목적·상담만.
    expect(developReverseRightsCheckNeeded([{ code: 'reverse.rights', choices: ['maintenance'] }])).toBe(true);
    expect(developReverseRightsCheckNeeded([{ code: 'reverse.rights', choices: ['consult'] }])).toBe(true);
    expect(developReverseRightsCheckNeeded([{ code: 'reverse.rights', choices: ['permitted'] }])).toBe(false);
    expect(developReverseRightsCheckNeeded([])).toBe(false);
  });

  it('답변 문자열 — 선택지 라벨(+메모), text 문항은 서술 그대로', () => {
    expect(developAnswerText({ code: 'pcb.signal', choices: ['highspeed', 'rf'] })).toBe('고속 신호, RF·안테나');
    expect(developAnswerText({ code: 'pcb.board', choices: ['flex'], note: '4층 0.2T' })).toBe('FPCB·Rigid-Flex (4층 0.2T)');
    expect(developAnswerText({ code: 'circuit.power', choices: ['adapter'], note: 'DC 24V' })).toBe('어댑터 (DC 24V)');
    expect(developAnswerText({ code: 'system.io', choices: [], note: '온도 → 펌프 정지' })).toBe('온도 → 펌프 정지');
  });

  it('첨부 슬롯 — 기구·역설계 슬롯은 개발의뢰 레지스트리에만 있다', () => {
    expect(parseDevelopAttachmentField('attachment:mech:step')).toEqual({ area: 'mech', slot: 'step' });
    expect(parseDevelopAttachmentField('attachment:reverse:photo')).toEqual({ area: 'reverse', slot: 'photo' });
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
  const messages = (r: ReturnType<typeof DevelopRequestCreatePayload.safeParse>): string[] =>
    r.success ? [] : r.error.issues.map((i) => i.message);

  it('개별 견적은 개별 메뉴 코드 1개 이상, 희망 시기는 날짜·자유문 중 하나', () => {
    expect(DevelopRequestCreatePayload.safeParse(base).success).toBe(true);
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, serviceAreas: [] }))).toContain('AREA_REQUIRED');
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, serviceAreas: ['mech'] }))).toContain('UNKNOWN_AREA');
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...base, wishNote: null }))).toContain('WISH_REQUIRED');
    // 시스템개발은 분야를 비워도 된다(서버가 6분야로 채운다) — 시스템 문항 답변 허용.
    const sys = DevelopRequestCreatePayload.safeParse({
      ...base, requestMode: 'system', serviceAreas: [], answers: [{ code: 'system.io', choices: [], note: '공장' }],
    });
    expect(sys.success).toBe(true);
  });

  it('개발 단계 — 역설계·PCB 만이면 비워도 되고(둘만 골라도), 그 밖에는 STAGE_REQUIRED', () => {
    const noStage = { ...base, currentStage: null, targetStage: null };
    expect(DevelopRequestCreatePayload.safeParse(noStage).success).toBe(true); // base = PCB 만
    expect(DevelopRequestCreatePayload.safeParse({ ...noStage, serviceAreas: ['reverse'] }).success).toBe(true);
    expect(DevelopRequestCreatePayload.safeParse({ ...noStage, serviceAreas: ['reverse', 'pcb'] }).success).toBe(true);
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...noStage, serviceAreas: ['pcb', 'circuit'] }))).toContain('STAGE_REQUIRED');
    expect(messages(DevelopRequestCreatePayload.safeParse({ ...noStage, serviceAreas: ['firmware'] }))).toContain('STAGE_REQUIRED');
    expect(developNeedsStages(DEVELOP_SYSTEM_AREA_CODES)).toBe(true);
    expect(developNeedsStages([])).toBe(true);
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
