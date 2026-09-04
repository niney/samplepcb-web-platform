import { describe, expect, it } from 'vitest';
import {
  MARKET_AREAS,
  MARKET_AREA_CODES,
  MARKET_COMMON_QUESTIONS,
  MARKET_QUESTIONS,
  marketAnswerIssues,
  marketAnswerText,
  marketAreaBadge,
  marketAreaLabel,
  marketQuestionArea,
  marketToolIssues,
  marketToolRows,
  normalizeMarketTools,
  parseMarketAttachmentField,
  sortMarketAreas,
} from '@sp/api-contract';

// 분야 레지스트리(docs/AI_DEV_REVIEW.md §13) — 사전 정합성과 파생 함수의 계약.

describe('레지스트리 정합성', () => {
  it('분야 코드·질문 코드·툴 코드·슬롯 코드가 각각 유일하다', () => {
    expect(new Set(MARKET_AREA_CODES).size).toBe(MARKET_AREAS.length);
    expect(new Set(MARKET_QUESTIONS.map((q) => q.code)).size).toBe(MARKET_QUESTIONS.length);
    for (const a of MARKET_AREAS) {
      expect(new Set(a.tools.options.map((o) => o.code)).size).toBe(a.tools.options.length);
      expect(new Set(a.attachmentSlots.map((s) => s.code)).size).toBe(a.attachmentSlots.length);
      // 분야별 질문은 `${area}.` 접두 — 공통 질문과 네임스페이스가 갈린다.
      for (const q of a.questions) expect(q.code.startsWith(`${a.code}.`)).toBe(true);
    }
    for (const q of MARKET_COMMON_QUESTIONS) expect(q.code.includes('.')).toBe(false);
  });

  it('모든 질문에 "잘 모르겠어요" 탈출구가 붙어 있고 프롬프트 조각이 비어 있지 않다', () => {
    for (const q of MARKET_QUESTIONS) expect(q.options.at(-1)?.code).toBe('unknown');
    for (const a of MARKET_AREAS) {
      expect(a.prompt.what.length).toBeGreaterThan(5);
      expect(a.prompt.specItems.length).toBeGreaterThan(0);
      expect(a.hint.length).toBeGreaterThan(3);
    }
  });
});

describe('분야 파생', () => {
  it('정렬은 레지스트리 순서, 미지 코드는 제거된다', () => {
    expect(sortMarketAreas(['server', 'circuit', 'zzz', 'pcb'])).toEqual(['circuit', 'pcb', 'server']);
  });
  it('배지 — 1개=분야명, 2개 이상=short 나열, 전부=풀 개발', () => {
    expect(marketAreaBadge(['pcb'])).toBe('PCB 설계');
    expect(marketAreaBadge(['firmware', 'circuit'])).toBe('회로 + 펌웨어');
    expect(marketAreaBadge([...MARKET_AREA_CODES])).toBe('풀 개발(회로·PCB·펌웨어·앱·서버)');
    expect(marketAreaBadge([])).toBe('');
  });
  it('라벨 — 레지스트리에 없는 옛 코드는 "(종료)" 표기로 남는다', () => {
    expect(marketAreaLabel('app')).toBe('앱 개발');
    expect(marketAreaLabel('product-design')).toBe('product-design(종료)');
  });
  it('질문 코드에서 분야를 읽는다', () => {
    expect(marketQuestionArea('stage')).toBeNull();
    expect(marketQuestionArea('app.platform')).toBe('app');
  });
});

describe('답변 검증·표시', () => {
  it('선택 분야 밖 문항·미지 선택지·단일 선택 위반·메모 필수를 잡는다', () => {
    const issues = marketAnswerIssues(
      [
        { code: 'stage', choices: ['idea', 'spec'] }, // 단일 선택 위반
        { code: 'app.platform', choices: ['android'] }, // 선택 분야(circuit) 밖
        { code: 'quantity', choices: ['bogus'] }, // 미지 선택지
        { code: 'pcb.outline', choices: ['fixed'] }, // 메모 필수(분야 pcb 선택)
      ],
      ['circuit', 'pcb'],
    );
    expect(issues).toEqual([
      'answers[0]: SINGLE_CHOICE',
      'answers[1]: UNKNOWN_QUESTION',
      'answers[2]: INVALID_CHOICE',
      'answers[3]: NOTE_REQUIRED',
    ]);
    expect(marketAnswerIssues([{ code: 'pcb.outline', choices: ['fixed'], note: '80×50' }], ['pcb'])).toEqual([]);
  });
  it('답변 문자열 = 라벨(+메모)', () => {
    expect(marketAnswerText({ code: 'quantity', choices: ['proto_1_10'], note: '먼저 3개' })).toBe('시제품 1~10개 (먼저 3개)');
    expect(marketAnswerText({ code: 'external', choices: ['mobile_app', 'server_cloud'] })).toBe('스마트폰 앱, 서버·웹(클라우드)');
  });
});

describe('희망 툴', () => {
  it('미지 분야·사전에 없는 코드를 잡고, 정규화는 선택 분야의 비어 있지 않은 항목만 남긴다', () => {
    expect(marketToolIssues({ version: 1, byArea: { circuit: ['altium', 'nope'], zzz: ['x'] } })).toEqual([
      'tools.byArea.circuit: UNKNOWN_TOOL:nope',
      'tools.byArea.zzz: UNKNOWN_AREA',
    ]);
    expect(normalizeMarketTools({ version: 1, byArea: { circuit: ['altium', 'altium'], pcb: [], app: ['flutter'] } }, ['pcb', 'circuit'])).toEqual({
      version: 1,
      byArea: { circuit: ['altium'] },
    });
  });
  it('표시 행 — 분야별 라벨, 빈 분야는 빈 목록(전문가 추천)', () => {
    expect(marketToolRows({ version: 1, byArea: { server: ['node'] } }, ['server', 'app'])).toEqual([
      { area: 'app', areaLabel: '앱 개발', labels: [] },
      { area: 'server', areaLabel: '서버 개발', labels: ['Node.js · TypeScript'] },
    ]);
  });
});

describe('첨부 슬롯 파트 이름', () => {
  it('attachment 는 일반(null), attachment:<area>:<slot> 은 슬롯, 그 외·미지는 undefined', () => {
    expect(parseMarketAttachmentField('attachment')).toBeNull();
    expect(parseMarketAttachmentField('attachment:circuit:schematic')).toEqual({ area: 'circuit', slot: 'schematic' });
    expect(parseMarketAttachmentField('attachment:circuit:nope')).toBeUndefined();
    expect(parseMarketAttachmentField('attachment:zzz:schematic')).toBeUndefined();
    expect(parseMarketAttachmentField('license')).toBeUndefined();
  });
});
