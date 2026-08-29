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

// docs/AI_DEV_REVIEW.md §1.2 후처리 규칙 R1~R7 — 근거 없는 확정은 살아남지 못한다.

const source: DevReviewSource = {
  title: '온실 환경 모니터 보드',
  serviceAreas: ['circuit', 'pcb'],
  description: '비닐하우스 안 온도·습도를 재서 스마트폰 앱으로 보여주는 보드입니다. 12V 어댑터로 동작하고, 시제품은 5대 필요합니다. 보드 크기는 80 x 50 mm 이내였으면 합니다.',
  answers: [
    { code: 'stage', choices: ['idea'] },
    { code: 'connectivity', choices: ['ble'] },
    { code: 'power', choices: ['adapter_dc'], note: '12V' },
    { code: 'certification', choices: ['unknown'] },
  ],
  attachmentContext: '',
  attachmentFiles: [],
};

const meta: DevReviewMetaType = {
  jobId: 'job-1', model: 'test', promptVersion: 'dev-review.v1', inputHash: 'x',
  generatedAt: '2026-08-28T00:00:00.000Z', attachmentFiles: [],
};

const item = (
  text: string,
  status: 'confirmed' | 'needs_confirmation',
  evidence: string | null = null,
  question: string | null = null,
  why: string | null = null,
) => ({ text, status, evidence, question, why });

const output: DevReviewLlmOutputType = {
  summary: '비닐하우스 온습도를 BLE로 앱에 보내는 보드 개발(nRF52840 기반)',
  requirements: [
    item('온도·습도를 측정해 스마트폰 앱으로 표시', 'confirmed', '온도·습도를 재서 스마트폰 앱으로 보여주는 보드'),
    item('12V 어댑터 입력', 'confirmed', '12V 어댑터로 동작하고'),
    item('보드 크기 80 x 50 mm 이내', 'confirmed', '보드 크기는 80 x 50 mm 이내였으면'),
    item('옥외 설치 방수 필요', 'confirmed', null, '옥외에 설치되나요?', '방수·온도 범위가 부품 선정에 필요'), // R1 강등
    item('데이터 로깅 기능', 'confirmed', '자료에 없음 — 통상 필요'), // R1 삭제(근거 불일치·질문 없음)
    item('4-Layer PCB 적용', 'needs_confirmation', null, '층수를 정해도 될까요?', ''), // R2 삭제
    item('nRF52840 MCU 사용', 'confirmed', '12V 어댑터로 동작'), // R2 삭제(품번)
    item('인증 필요 여부', 'needs_confirmation', null, null, null), // R3 삭제
  ],
  diagram: {
    project: { name: 'Greenhouse Monitor', summary: '', stage: 'idea', service_type: 'single' },
    groups: [{ id: 'main', label: 'MAIN' }, { id: 'ext', label: 'EXTERNAL' }],
    blocks: [
      { id: 'mcu', group: 'main', type: 'controller', label: '메인 컨트롤러 nRF52840', status: 'confirmed' },
      { id: 'sensor', group: 'main', type: 'sensor', label: '온습도 센서', status: 'confirmed' },
      { id: 'app', group: 'ext', type: 'external', label: '스마트폰 앱', status: 'confirmed' },
      { id: 'ghost', group: 'missing_group', type: 'other', label: 'X', status: 'tbd' },
    ],
    connections: [
      { from: 'sensor', to: 'mcu', interface: 'I2C', flow: 'data' },
      { from: 'mcu', to: 'app', interface: 'BLE', flow: 'data' },
      { from: 'mcu', to: 'nowhere', interface: '', flow: 'data' },
    ],
    constraints: [],
    feature_highlights: [],
    questions_missing: [{ topic: 'x', question: '무시되어야 함' }],
  },
  areas: [
    {
      area: 'circuit',
      scope: [item('온습도 센서 인터페이스 회로', 'confirmed', '온도·습도를 재서')],
      risks: [
        { text: '비닐하우스 고습 환경에서의 결로', evidence: '비닐하우스 안 온도·습도' },
        { text: '산업 현장 노이즈', evidence: null },
      ],
      spec: [
        { item: '전원부', ...item('12V 어댑터 입력 변환', 'confirmed', '12V 어댑터로 동작') },
        { item: 'MCU ESP32', ...item('무선 컨트롤러', 'needs_confirmation', null, '선호하는 MCU 계열이 있나요?', '부품 수급') },
      ],
    },
    {
      area: 'firmware', // 선택 분야 아님 → 제거
      scope: [item('펌웨어', 'confirmed', '온도')],
      risks: [],
      spec: [],
    },
  ],
  openQuestions: [
    { topic: '설치', question: '옥외에 설치되나요?', why: '중복 — 병합 시 제거', area: null },
    { topic: '인증', question: 'KC 인증이 필요한가요?', why: '판매 시 필수', area: 'circuit' },
  ],
};

describe('AI 사전 검토서 후처리', () => {
  const { review, diagnostics } = postProcessDevReview(output, source, meta);

  it('R1 — 근거 없는 확정은 질문이 있으면 강등, 없으면 삭제', () => {
    const texts = review.requirements.map((r) => r.text);
    expect(texts).toContain('온도·습도를 측정해 스마트폰 앱으로 표시');
    expect(texts).toContain('12V 어댑터 입력');
    expect(review.requirements.find((r) => r.text === '옥외 설치 방수 필요')?.status).toBe('needs_confirmation');
    expect(texts).not.toContain('데이터 로깅 기능');
    expect(diagnostics.r1Demoted).toBe(1);
    expect(diagnostics.r1Dropped).toBe(1);
  });

  it('R2 — 자료에 없는 수치·품번은 삭제되고 있는 수치는 살아남는다', () => {
    const texts = review.requirements.map((r) => r.text);
    expect(texts).toContain('보드 크기 80 x 50 mm 이내');
    expect(texts).not.toContain('4-Layer PCB 적용');
    expect(texts).not.toContain('nRF52840 MCU 사용');
    expect(diagnostics.r2Dropped).toBe(2);
    expect(review.summary).not.toContain('nRF52840');
  });

  it('R3 — 질문 없는 확인 필요 항목은 삭제', () => {
    expect(review.requirements.map((r) => r.text)).not.toContain('인증 필요 여부');
    expect(diagnostics.r3Dropped).toBe(1);
  });

  it('R4 — 구성도 라벨의 품번 제거·tbd 강등, 근거 없는 인터페이스 비움, 끊긴 연결 제거', () => {
    const mcu = review.diagram.blocks.find((b) => b.id === 'mcu');
    expect(mcu?.label).toBe('메인 컨트롤러');
    expect(mcu?.status).toBe('tbd');
    expect(review.diagram.connections.find((c) => c.from === 'sensor')?.interface).toBe('');
    expect(review.diagram.connections.find((c) => c.to === 'app')?.interface).toBe('BLE');
    expect(review.diagram.connections.some((c) => c.to === 'nowhere')).toBe(false);
    expect(review.diagram.groups.some((g) => g.id === 'missing_group')).toBe(true);
    expect(review.diagram.questions_missing).toEqual([]);
  });

  it('분야는 선택 분야만·전부 존재하고, R7 근거 없는 리스크는 삭제', () => {
    expect(review.areas.map((a) => a.area)).toEqual(['circuit', 'pcb']);
    const circuit = review.areas[0];
    expect(circuit?.risks.map((r) => r.text)).toEqual(['비닐하우스 고습 환경에서의 결로']);
    expect(circuit?.spec.map((r) => r.item)).toEqual(['전원부', 'MCU']);
    expect(review.areas[1]?.spec).toEqual([]);
    expect(diagnostics.r7Dropped).toBe(1);
  });

  it('R5 — 확인 필요 질문과 LLM 제안이 병합되고 중복은 하나만 남는다', () => {
    const questions = review.openQuestions.map((q) => q.question);
    expect(questions.filter((q) => q === '옥외에 설치되나요?')).toHaveLength(1);
    expect(questions).toContain('선호하는 MCU 계열이 있나요?');
    expect(questions).toContain('KC 인증이 필요한가요?');
    expect(review.openQuestions[0]?.why).toBe('방수·온도 범위가 부품 선정에 필요');
  });

  it('통계·브리프·메타가 채워진다', () => {
    expect(review.stats).toEqual({ confirmed: 5, needsConfirmation: 2 });
    expect(review.brief.serviceAreas).toEqual(['circuit', 'pcb']);
    expect(review.brief.answers).toHaveLength(4);
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
  it('깨진 배열 원소만 버리고 나머지를 살리며, 중첩형 spec 행도 평면으로 받는다', () => {
    const raw = `설명입니다.\n\`\`\`json\n${JSON.stringify({
      ...output,
      requirements: [output.requirements[0], { text: '' }, 'junk'],
      openQuestions: [{ question: '' }, output.openQuestions[1]],
      areas: [{
        area: 'circuit', scope: [], risks: [],
        spec: [
          { item: '전원부', content: { text: '12V 입력', status: 'confirmed', evidence: '12V', question: null, why: null } },
          { item: '통신', content: '문자열 내용' },
          { item: '보호', text: '평면형', status: 'needs_confirmation', evidence: null, question: '서지 보호?', why: null },
        ],
      }],
    })}\n\`\`\``;
    const parsed = parseDevReviewLlmOutput(raw);
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.openQuestions).toHaveLength(1);
    expect(parsed.areas[0]?.spec.map((r) => [r.item, r.text, r.status])).toEqual([
      ['전원부', '12V 입력', 'confirmed'],
      ['통신', '문자열 내용', 'needs_confirmation'],
      ['보호', '평면형', 'needs_confirmation'],
    ]);
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
    expect(prompt).toContain('전원은 어떻게 공급되나요? → DC 어댑터 (12V)');
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
