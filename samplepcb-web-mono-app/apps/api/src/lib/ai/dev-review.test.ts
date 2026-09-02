import { describe, expect, it } from 'vitest';
import type { DevReviewLlmOutputType, DevReviewMetaType } from '@sp/api-contract';
import {
  buildDevReviewCorpus,
  buildDevReviewPrompt,
  devReviewInputHash,
  isGroundedQuote,
  normalizeForMatch,
  parseAttachmentReadResult,
  parseDevReviewLlmOutput,
  postProcessDevReview,
  ungroundedTokens,
  type DevReviewSource,
} from './dev-review';

// docs/AI_DEV_REVIEW.md §12 후처리 — 근거 없는 항목·자료에 없는 수치는 살아남지 못한다(확정만).

const source: DevReviewSource = {
  title: '온실 환경 모니터 보드',
  serviceAreas: ['circuit', 'pcb'],
  description: '비닐하우스 안 온도·습도를 재서 블루투스(BLE)로 스마트폰 앱에 보여주는 보드입니다. 12V 어댑터로 동작하고, 시제품은 5대 필요합니다. 보드 크기는 80 x 50 mm 이내였으면 합니다.',
  answers: [
    { code: 'stage', choices: ['idea'] },
    { code: 'external', choices: ['mobile_app'] },
    { code: 'timeline', choices: ['unknown'] },
  ],
  attachmentContext: '',
  attachmentFiles: [],
};

const meta: DevReviewMetaType = {
  jobId: 'job-1', model: 'test', promptVersion: 'dev-review.v2', inputHash: 'x',
  generatedAt: '2026-09-02T00:00:00.000Z', attachmentFiles: [],
};

const fact = (text: string, evidence: string | null = null) => ({ text, evidence });

const output: DevReviewLlmOutputType = {
  summary: '비닐하우스 온습도를 BLE로 앱에 보내는 보드 개발(nRF52840 기반)',
  requirements: [
    fact('온도·습도를 측정해 스마트폰 앱으로 표시', '온도·습도를 재서 블루투스(BLE)로 스마트폰 앱에 보여주는 보드'),
    fact('12V 어댑터 입력', '12V 어댑터로 동작하고'),
    fact('보드 크기 80 x 50 mm 이내', '보드 크기는 80 x 50 mm 이내였으면'),
    fact('데이터 로깅 기능', '자료에 없음 — 통상 필요'), // R1 삭제(근거 불일치)
    fact('4-Layer PCB 적용', '보드 크기는 80 x 50 mm'), // R2 삭제(자료에 없는 층수)
  ],
  diagram: {
    columns: { inputs: '현장 입력', board: '제어 보드', outputs: '연동' },
    inputs: [
      { label: '온습도 센서 SHT31', detail: '온도·습도', icon: 'sensor' }, // 품번만 제거
      { label: 'ADS1115', detail: '', icon: 'other' }, // 라벨이 통째 품번 → 카드 삭제
    ],
    board: { label: '메인 컨트롤러 nRF52840', detail: '제어·통신', chips: ['전원 변환 3.3V', '데이터 처리', 'STM32'] },
    outputs: [{ label: '스마트폰 앱', detail: '실시간 표시', icon: 'phone' }],
    linkIn: 'I2C', // 자료에 없음 → 비움
    linkOut: 'BLE', // 자료에 있음 → 유지
    notes: { flow: '센싱 → BLE 전송', design: '4층 기판 설계', extension: '' },
  },
  areas: [
    {
      area: 'circuit',
      summary: '온습도 센서와 12V 전원 회로를 설계합니다(ESP32 기반)',
      spec: [
        { item: '전원부', ...fact('12V 어댑터 입력 변환', '12V 어댑터로 동작') },
        { item: 'MCU ESP32', ...fact('무선 컨트롤러', '스마트폰 앱에 보여주는') }, // 항목명의 품번만 제거
        { item: '통신', ...fact('BLE 로 앱 연결', '통상 필요') }, // R1 삭제
      ],
    },
    { area: 'firmware', summary: '펌웨어', spec: [] }, // 선택 분야 아님 → 제거
  ],
  openQuestions: [
    { question: '전원 공급 방식은 무엇인가요?', why: '전원 회로 설계에 필요' },
    { question: '전원 공급 방식은?', why: '중복 — 접힌다' },
    { question: '옥외에 설치되나요?', why: '방수·온도 범위' },
    { question: 'KC 인증이 필요한가요?', why: '판매 시 필수' },
    { question: '시제품 수량은 몇 대인가요?', why: '제작 방식' },
    { question: '목표 일정은 언제인가요?', why: '일정 계획' },
    { question: '케이스 크기 제한이 있나요?', why: '보드 외형' },
    { question: '센서 정밀도 요구가 있나요?', why: '부품 선정' }, // 6개 캡에 걸려 빠진다
  ],
};

describe('AI 사전 검토서 후처리(v2 — 확정만)', () => {
  const { review, diagnostics } = postProcessDevReview(output, source, meta);

  it('R1·R2 — 근거 없는 항목과 자료에 없는 수치·품번 항목은 삭제', () => {
    const texts = review.requirements.map((r) => r.text);
    expect(texts).toEqual(['온도·습도를 측정해 스마트폰 앱으로 표시', '12V 어댑터 입력', '보드 크기 80 x 50 mm 이내']);
    expect(diagnostics.r1Dropped).toBe(2); // 요구 1 + 명세 1
    expect(diagnostics.r2Dropped).toBe(1);
    expect(review.summary).toBe('비닐하우스 온습도를 BLE로 앱에 보내는 보드 개발');
  });

  it('구성도 — 라벨의 품번·수치만 제거, 라벨이 비면 카드·칩 삭제, 연결 라벨은 자료에 있는 것만', () => {
    expect(review.diagram.inputs.map((n) => n.label)).toEqual(['온습도 센서']);
    expect(review.diagram.board.label).toBe('메인 컨트롤러');
    expect(review.diagram.board.chips).toEqual(['전원 변환', '데이터 처리']);
    expect(review.diagram.outputs.map((n) => n.label)).toEqual(['스마트폰 앱']);
    expect(review.diagram.linkIn).toBe('');
    expect(review.diagram.linkOut).toBe('BLE');
    expect(review.diagram.notes.design).toBe('기판 설계');
    expect(review.diagram.columns.inputs).toBe('현장 입력');
    expect(diagnostics.diagramNodesDropped).toBe(2);
    expect(diagnostics.linksCleared).toBe(1);
  });

  it('분야는 선택 분야만·전부 존재하고, 명세 항목명의 품번은 제거된다', () => {
    expect(review.areas.map((a) => a.area)).toEqual(['circuit', 'pcb']);
    const circuit = review.areas[0];
    expect(circuit?.summary).toBe('온습도 센서와 12V 전원 회로를 설계합니다');
    expect(circuit?.spec.map((r) => [r.item, r.text])).toEqual([
      ['전원부', '12V 어댑터 입력 변환'],
      ['MCU', '무선 컨트롤러'],
    ]);
    expect(review.areas[1]?.spec).toEqual([]);
    expect(review.areas[1]?.summary).toBe('');
  });

  it('R5 — 표현만 다른 질문은 접히고 최대 6개', () => {
    const questions = review.openQuestions.map((q) => q.question);
    expect(questions.filter((q) => q.startsWith('전원 공급'))).toHaveLength(1);
    expect(questions).toHaveLength(6);
    expect(questions).not.toContain('센서 정밀도 요구가 있나요?');
    expect(diagnostics.openQuestionsDeduped).toBe(1);
  });

  it('버전·브리프·메타가 채워진다', () => {
    expect(review.version).toBe(2);
    expect(review.brief.serviceAreas).toEqual(['circuit', 'pcb']);
    expect(review.brief.answers).toHaveLength(3);
    expect(review.meta.jobId).toBe('job-1');
  });
});

describe('근거 대조 정규화', () => {
  const corpus = normalizeForMatch('입력 전원은 12 V 어댑터를 사용하고 시제품 5 SET, 4-Layer 기판');

  it('단위 동의어·공백·문장부호를 흡수한다', () => {
    expect(ungroundedTokens('12V 어댑터 입력', corpus)).toEqual([]);
    expect(ungroundedTokens('시제품 5대 제작', corpus)).toEqual([]);
    expect(ungroundedTokens('4층 PCB', corpus)).toEqual([]);
    expect(ungroundedTokens('24V 입력', corpus)).toEqual(['24V']);
    expect(ungroundedTokens('STM32F103 사용', corpus)).toEqual(['STM32F103']);
  });

  it('단위 뒤에 조사가 붙은 원문("1개가")도 "1개"와 일치한다', () => {
    const c = buildDevReviewCorpus({
      ...source,
      description: '릴레이 출력 2개를 쓰고 NTC 온도 센서 1개가 붙어 있습니다. 시제품은 5대를 원합니다.',
    });
    expect(ungroundedTokens('NTC 온도 센서 1개 구성', c)).toEqual([]);
    expect(ungroundedTokens('릴레이 출력 2개 제어', c)).toEqual([]);
    expect(ungroundedTokens('시제품 5대 제작', c)).toEqual([]);
    expect(ungroundedTokens('시제품 6대 제작', c)).toEqual(['6대']);
  });

  it('인용문은 통째 또는 토큰 0.7 이상 일치해야 근거로 인정한다', () => {
    expect(isGroundedQuote('12 V 어댑터를 사용', corpus)).toBe(true);
    expect(isGroundedQuote('어댑터로 동작하는 12V 입력 전원', corpus)).toBe(true);
    expect(isGroundedQuote('배터리로 동작', corpus)).toBe(false);
    expect(isGroundedQuote(null, corpus)).toBe(false);
  });
});

describe('파서·프롬프트·해시', () => {
  it('깨진 배열 원소만 버리고 나머지를 살리며, 칩은 문자열·객체 둘 다 받는다', () => {
    const raw = `설명입니다.\n\`\`\`json\n${JSON.stringify({
      ...output,
      requirements: [output.requirements[0], { text: '' }, 'junk'],
      openQuestions: [{ question: '' }, output.openQuestions[3]],
      diagram: {
        ...output.diagram,
        inputs: [output.diagram.inputs[0], { label: '' }, 'junk'],
        board: { label: '메인', detail: '', chips: ['전원', { label: '통신' }, '', 7] },
        columns: 'broken',
      },
      areas: [{ area: 'circuit', summary: 7, spec: [{ item: '전원부', text: '12V 입력', evidence: '12V' }, { item: '' }] }],
    })}\n\`\`\``;
    const parsed = parseDevReviewLlmOutput(raw);
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.openQuestions).toHaveLength(1);
    expect(parsed.diagram.inputs).toHaveLength(1);
    expect(parsed.diagram.board.chips).toEqual(['전원', '통신']);
    expect(parsed.diagram.columns).toEqual({ inputs: '입력', board: '메인 보드', outputs: '출력·연동' });
    expect(parsed.areas[0]?.summary).toBe('');
    expect(parsed.areas[0]?.spec.map((r) => r.item)).toEqual(['전원부']);
  });

  it('구성도가 없으면 실패(러너 재시도 대상)', () => {
    expect(() => parseDevReviewLlmOutput(JSON.stringify({ summary: 'x', requirements: [], areas: [] }))).toThrow(
      'DEV_REVIEW_DIAGRAM_INVALID',
    );
  });

  it('프롬프트에 규칙·답변·첨부가 바인딩되고 추가 지침은 관리자 몫', () => {
    const prompt = buildDevReviewPrompt({ ...source, attachmentContext: '[첨부 1] 사양서' }, 'KC 인증을 항상 확인하세요');
    expect(prompt).toContain('[절대 규칙]');
    expect(prompt).toContain('KC 인증을 항상 확인하세요');
    expect(prompt).toContain('함께 쓰는 것이 있나요? → 스마트폰 앱');
    expect(prompt).toContain('언제까지 필요한가요? → 잘 모르겠어요');
    expect(prompt).toContain('[첨부 1] 사양서');
    expect(prompt).toContain('회로 개발, PCB 설계');
  });

  it('입력 해시는 순서·공백에 불변이고 조건(예산 등)을 포함하지 않는다', () => {
    const a = devReviewInputHash({ title: '제목 ', serviceAreas: ['pcb', 'circuit'], description: '설명', answers: [{ code: 'stage', choices: ['idea'] }], attachmentHashes: ['b', 'a'] });
    const b = devReviewInputHash({ title: '제목', serviceAreas: ['circuit', 'pcb'], description: '설명', answers: [{ code: 'stage', choices: ['idea'], note: '' }], attachmentHashes: ['a', 'b'] });
    const c = devReviewInputHash({ title: '제목', serviceAreas: ['circuit'], description: '설명', answers: [], attachmentHashes: [] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('첨부 판독 결과를 근거 코퍼스용 텍스트 블록으로 만든다', () => {
    const text = parseAttachmentReadResult(JSON.stringify({
      images: [{ index: 1, kind: '블록도', summary: '센서-MCU-BLE 구성', facts: ['MCU: STM32G071', '전원 12V'] }],
    }));
    expect(text).toContain('(이미지 1) 종류: 블록도 — 센서-MCU-BLE 구성');
    expect(text).toContain('- MCU: STM32G071');
    expect(parseAttachmentReadResult('{"images":[]}')).toBe('');
  });
});
