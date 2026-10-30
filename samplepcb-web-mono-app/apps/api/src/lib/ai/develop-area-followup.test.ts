import { describe, expect, it } from 'vitest';
import { buildAreaBanks, buildDevelopAreaFollowupPrompt, parseDevelopAreaFollowupLlmOutput, toDevelopAreaFollowupResult } from './develop-area-followup';

// 개별 메뉴 AI 맞춤 질문 — 정규화 규칙은 결정적이다(모델 출력이 흔들려도 저장할 수 있는 답만 남는다).

const out = (items: unknown[], understood = '파악한 의뢰'): string => JSON.stringify({ understood, items });
const META = { jobId: 'j1', model: 'm', promptVersion: 'v', generatedAt: '2026-10-30T00:00:00.000Z', areas: ['circuit'], attachmentFiles: [] };

describe('buildAreaBanks', () => {
  it('고정 질문(범위·권리 확인·필요 작업)을 빼고 공유 질문은 앞 분야에서 한 번만', () => {
    const banks = buildAreaBanks(['firmware', 'circuit']);
    expect(banks.map((b) => b.area)).toEqual(['circuit', 'firmware']);
    const codes = banks.flatMap((b) => b.questions.map((q) => q.code));
    expect(codes.filter((c) => c === 'hw.comm')).toHaveLength(1);
    expect(banks[0]?.questions.some((q) => q.code === 'hw.comm')).toBe(true);
    const app = buildAreaBanks(['app', 'server']).flatMap((b) => b.questions.map((q) => q.code));
    expect(app).not.toContain('appserver.scope');
    expect(app.filter((c) => c === 'appserver.type')).toHaveLength(1);
    const rev = buildAreaBanks(['reverse']).flatMap((b) => b.questions.map((q) => q.code));
    expect(rev).not.toContain('reverse.rights');
    expect(rev).not.toContain('reverse.work');
  });

  it('프롬프트에 기본 질문 코드와 따로 묻는 질문이 실린다', () => {
    const prompt = buildDevelopAreaFollowupPrompt({ areas: ['reverse'], title: '보드 복원', description: '오래된 보드', attachmentContext: '', attachmentFiles: [] });
    expect(prompt).toContain('reverse.target');
    expect(prompt).toContain('[따로 묻는 질문');
    expect(prompt).toContain('분석 대상 제품에 대한 권리');
  });
});

describe('parseDevelopAreaFollowupLlmOutput', () => {
  it('채운 답은 선택지 코드·근거를 검증하고, 실패하면 원래 문구로 되살린다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        { mode: 'covered', base: 'circuit.type', choices: ['new'], note: '', evidence: "설명: '새로 만든다'" },
        { mode: 'covered', base: 'circuit.parts', choices: ['nope'], note: '', evidence: '설명' },
        { mode: 'covered', base: 'circuit.cert', choices: ['kc'], note: '', evidence: '' },
      ]),
      ['circuit'],
    );
    expect(p.covered.map((c) => c.base)).toEqual(['circuit.type']);
    const restored = p.questions.filter((q) => q.origin === 'restored').map((q) => q.base);
    expect(restored).toContain('circuit.parts'); // 없는 코드
    expect(restored).toContain('circuit.cert'); // 근거 없음
    expect(restored).toContain('circuit.power'); // 빠짐
  });

  it('하나 선택 질문에 여러 개를 채우면 받지 않는다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(out([{ mode: 'covered', base: 'circuit.type', choices: ['new', 'modify'], note: '', evidence: 'e' }]), ['circuit']);
    expect(p.covered).toHaveLength(0);
  });

  it('고쳐 묻는 질문은 maps 를 원래 코드로 검증하고 기타·없음을 되살린다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        {
          mode: 'ask',
          base: 'hw.comm',
          question: '측정값을 휴대폰으로 보내나요?',
          why: '통신 회로가 달라집니다',
          options: [
            { label: 'BLE', maps: 'ble' },
            { label: 'Wi-Fi', maps: 'wifi' },
            { label: '전용 무선', maps: '' },
            { label: '모름', maps: '' },
          ],
        },
      ]),
      ['circuit'],
    );
    const q = p.questions.find((x) => x.base === 'hw.comm');
    expect(q?.origin).toBe('ask');
    expect(q?.multi).toBe(true);
    const maps = q?.options.map((o) => o.maps);
    expect(maps).toEqual(['ble', 'wifi', null, 'other', 'none', 'unknown']); // '모름'은 버리고 서버 것 하나
  });

  it("'기타'가 없는 질문엔 새 선택지를 받지 않는다", () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([{ mode: 'ask', base: 'circuit.type', question: '어떤 작업인가요?', why: '', options: [{ label: '신규', maps: 'new' }, { label: '수정', maps: 'modify' }, { label: '복각', maps: '' }] }]),
      ['circuit'],
    );
    const q = p.questions.find((x) => x.base === 'circuit.type');
    expect(q?.options.some((o) => o.maps === null)).toBe(false);
  });

  it('원래 선택지와 하나도 안 이어지면 기본 선택지로 되돌린다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([{ mode: 'ask', base: 'circuit.type', question: '어떤 작업인가요?', why: '', options: [{ label: '가', maps: 'x' }, { label: '나', maps: 'y' }] }]),
      ['circuit'],
    );
    const q = p.questions.find((x) => x.base === 'circuit.type');
    expect(q?.question).toBe('어떤 작업인가요?');
    expect(q?.options.map((o) => o.maps)).toEqual(['new', 'modify', 'eol', 'unknown']);
  });

  it('미리 체크는 여러 개 선택 질문의 원래 코드만, 없음은 빼고 선택지에 없으면 앞에 넣는다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        {
          mode: 'ask',
          base: 'circuit.input',
          question: '센서 외에 더 들어가나요?',
          why: '',
          preset: ['sensor', 'none', 'zzz'],
          options: [{ label: '버튼', maps: 'button' }, { label: '화면', maps: 'display' }],
        },
        { mode: 'ask', base: 'circuit.type', question: '작업?', why: '', preset: ['new'], options: [{ label: '신규', maps: 'new' }, { label: '수정', maps: 'modify' }] },
      ]),
      ['circuit'],
    );
    const input = p.questions.find((x) => x.base === 'circuit.input');
    expect(input?.options[0]).toMatchObject({ maps: 'sensor', preset: true });
    expect(input?.options.filter((o) => o.preset).map((o) => o.maps)).toEqual(['sensor']);
    const type = p.questions.find((x) => x.base === 'circuit.type');
    expect(type?.options.some((o) => o.preset)).toBe(false); // 하나 선택은 미리 체크 없음
  });

  it('고정 질문은 버리고, 분야 접두가 붙은 공유 질문 코드는 바로잡는다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        { mode: 'covered', base: 'reverse.rights', choices: ['own'], note: '', evidence: 'e' },
        { mode: 'covered', base: 'circuit.comm', choices: ['ble'], note: '', evidence: "설명: 'BLE'" },
      ]),
      ['circuit', 'reverse'],
    );
    expect(p.covered.map((c) => c.base)).toEqual(['hw.comm']);
    expect(p.dropped.some((d) => d.startsWith('reverse.rights'))).toBe(true);
  });

  it('새 질문은 분야당 2개·하나 선택이고, 조건부 기본 질문은 조건을 잇는다', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        { mode: 'new', base: '', area: 'reverse', question: '원본이 동작하나요?', why: 'w', options: [{ label: '예', maps: '' }, { label: '아니오', maps: '' }] },
        { mode: 'new', base: '', area: 'reverse', question: '설명서가 있나요?', why: 'w', options: [] },
        { mode: 'new', base: '', area: 'reverse', question: '세 번째', why: 'w', options: [] },
      ]),
      ['reverse'],
    );
    const added = p.questions.filter((q) => q.origin === 'new');
    expect(added).toHaveLength(2);
    expect(added[0]?.multi).toBe(false);
    expect(added[0]?.options.map((o) => o.code)).toEqual(['o1', 'o2', 'unknown']);
    expect(added[1]?.options).toEqual([]);
    const fw = p.questions.find((q) => q.base === 'reverse.firmware');
    expect(fw?.showWhen).toEqual({ code: 'reverse.work', anyOf: ['firmware'] });
  });

  it('잡 결과에는 되살린 질문을 싣지 않는다(위저드가 기본 질문을 그린다)', () => {
    const p = parseDevelopAreaFollowupLlmOutput(
      out([
        { mode: 'covered', base: 'circuit.type', choices: ['new'], note: '', evidence: 'e' },
        { mode: 'ask', base: 'circuit.power', question: '전원은?', why: '', options: [{ label: '배터리', maps: 'battery_rechargeable' }, { label: 'USB', maps: 'usb' }] },
        { mode: 'new', base: '', area: 'circuit', question: '크기 제한이 있나요?', why: '', options: [] },
      ]),
      ['circuit'],
    );
    const r = toDevelopAreaFollowupResult(p, META);
    expect(r.covered.map((c) => c.base)).toEqual(['circuit.type']);
    expect(r.asked.map((q) => q.base)).toEqual(['circuit.power']);
    expect(r.added.map((q) => q.question)).toEqual(['크기 제한이 있나요?']);
    expect(r.added[0]).toHaveProperty('area', 'circuit');
  });

  it('JSON 이 아니면 던진다', () => {
    expect(() => parseDevelopAreaFollowupLlmOutput('그냥 문장', ['circuit'])).toThrow();
  });
});
