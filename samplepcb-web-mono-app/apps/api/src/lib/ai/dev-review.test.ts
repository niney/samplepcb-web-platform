import { describe, expect, it } from 'vitest';
import type { DevReviewLlmOutputType, DevReviewMetaType } from '@sp/api-contract';
import {
  buildDevReviewCorpus,
  buildDevReviewPrompt,
  detectAnswerChecks,
  detectSourceConflicts,
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
  areas: [
    {
      area: 'circuit',
      summary: '온습도 센서와 12V 전원 회로를 설계합니다(ESP32 기반)',
      spec: [
        { item: '전원부', ...fact('12V 어댑터 입력 변환', '12V 어댑터로 동작') },
        { item: 'MCU ESP32', ...fact('무선 컨트롤러', '스마트폰 앱에 보여주는') }, // 항목명의 품번만 제거
        { item: '통신', ...fact('BLE 로 앱 연결', '통상 필요') }, // R1 삭제
      ],
      observations: [
        fact('BLE 앱 연동과 12V 어댑터 전원이 함께 있어 무선부 전원 설계가 중심입니다', '12V 어댑터로 동작하고'),
        fact('저전력 설계를 권장합니다', '12V 어댑터로 동작하고'), // 판단 어휘 → 삭제
      ],
    },
    { area: 'firmware', summary: '펌웨어', spec: [], observations: [] }, // 선택 분야 아님 → 제거
  ],
  openQuestions: [
    { question: '전원 공급 방식은 무엇인가요?', why: '전원 회로 설계에 필요', area: 'general' },
    { question: '전원 공급 방식은?', why: '중복 — 접힌다', area: 'general' },
    { question: '옥외에 설치되나요?', why: '방수·온도 범위', area: 'general' },
    { question: 'KC 인증이 필요한가요?', why: '판매 시 필수', area: 'general' },
    { question: '시제품 수량은 몇 대인가요?', why: '제작 방식', area: 'general' },
    { question: '목표 일정은 언제인가요?', why: '일정 계획', area: 'general' },
    { question: '케이스 크기 제한이 있나요?', why: '보드 외형', area: 'general' },
    { question: '센서 정밀도 요구가 있나요?', why: '부품 선정', area: 'general' }, // 6개 캡에 걸려 빠진다
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

  it('검토 관찰 — 근거 있는 사실 연결만 남고 판단 어휘·명세·상의 항목 되풀이는 버린다', () => {
    expect(review.areas[0]?.observations.map((o) => o.text)).toEqual(['BLE 앱 연동과 12V 어댑터 전원이 함께 있어 무선부 전원 설계가 중심입니다']);
    expect(diagnostics.observationsDropped).toBe(1);
    const dup = postProcessDevReview({
      ...output,
      areas: [{ area: 'circuit', summary: '', spec: [], observations: [fact('옥외에 설치되나요 방수', '12V 어댑터로 동작하고')] }],
    }, source, meta);
    expect(dup.review.areas[0]?.observations).toEqual([]); // "옥외에 설치되나요?" 질문과 겹친다
    expect(dup.diagnostics.observationsDropped).toBe(1);
    expect(review.checks).toEqual([]); // 답변(idea·mobile_app)과 자료가 어긋나지 않는다
    expect(diagnostics.r9Checks).toBe(0);
  });

  it('버전·브리프·메타가 채워진다', () => {
    expect(review.version).toBe(4);
    expect(review.brief.serviceAreas).toEqual(['circuit', 'pcb']);
    expect(review.brief.answers).toHaveLength(3);
    expect(review.meta.jobId).toBe('job-1');
  });
});

describe('R8 — 자료 간 불일치', () => {
  const conflicted: DevReviewSource = {
    ...source,
    attachmentContext: '[첨부 1] 요구 메모\n- 팬: 24V DC 팬 2대\n- 전원: 24V 어댑터 하나로 팬과 제어기를 같이 돌림\n- 온도 설정 20~40도',
  };
  const out: DevReviewLlmOutputType = {
    ...output,
    requirements: [
      fact('12V 어댑터 입력', '12V 어댑터로 동작하고'), // 설명 쪽 값 — 역시 확정 불가
      fact('24V 어댑터 하나로 팬과 제어기 구동', '24V 어댑터 하나로 팬과 제어기를 같이 돌림'), // 첨부 쪽 값
      fact('온도·습도를 측정해 스마트폰 앱으로 표시', '온도·습도를 재서 블루투스(BLE)로 스마트폰 앱에 보여주는 보드'),
    ],
    areas: [{ area: 'circuit', summary: '24V 전원 회로', spec: [{ item: '전원부', ...fact('24V DC 팬 2대 구동', '24V DC 팬 2대') }], observations: [] }],
    openQuestions: [
      { question: '전원 전압을 12V로 할지 24V로 할지 확정이 필요합니다.', why: '', area: 'general' }, // 자동 질문으로 갈음
      { question: '옥외에 설치되나요?', why: '', area: 'general' },
    ],
  };

  it('같은 단위의 수치가 설명과 첨부에서 서로 다르면 불일치로 감지한다', () => {
    expect(detectSourceConflicts(conflicted)).toEqual([{ unit: 'v', label: '전압', primary: ['12'], attachment: ['24'] }]);
    // 첨부가 설명 값을 포함하면(12V 와 5V 레일) 불일치가 아니다.
    expect(detectSourceConflicts({ ...source, attachmentContext: '입력 12V, 내부 5V 와 3.3V' })).toEqual([]);
    // 한쪽에만 있는 단위(첨부의 온도)는 판정 대상이 아니다.
    expect(detectSourceConflicts({ ...source, attachmentContext: '동작 온도 -20~60℃' })).toEqual([]);
  });

  it('불일치 값을 품은 확정 항목은 양쪽 다 삭제되고, 구성도 라벨은 값만 빠지며 미정이 된다', () => {
    const { review, diagnostics } = postProcessDevReview(out, conflicted, meta);
    expect(review.requirements.map((r) => r.text)).toEqual(['온도·습도를 측정해 스마트폰 앱으로 표시']);
    expect(review.areas[0]?.spec).toEqual([]);
    expect(review.areas[0]?.summary).toBe('전원 회로');
    expect(diagnostics.conflicts).toBe(1);
    expect(diagnostics.r8Dropped).toBe(3);
  });

  it('상의 항목 맨 앞에 "자료 간 확인 필요" 를 세우고 같은 값을 말하는 모델 질문은 접는다', () => {
    const { review } = postProcessDevReview(out, conflicted, meta);
    expect(review.openQuestions[0]?.question).toBe('자료 간 확인 필요: 전압 — 설명에는 12V, 첨부에는 24V로 적혀 있습니다. 어느 쪽이 맞나요?');
    expect(review.openQuestions.map((q) => q.question)).toEqual([
      review.openQuestions[0]?.question,
      '옥외에 설치되나요?',
    ]);
  });
});

describe('R9 — 답변↔자료 정합', () => {
  const mismatched: DevReviewSource = {
    ...source,
    description: '버스용 LED 컨트롤러입니다. PC 한 대가 이더넷으로 여러 보드에 접속합니다. 회로도와 넷리스트는 첨부했습니다.',
    answers: [
      { code: 'stage', choices: ['idea'] },
      { code: 'external', choices: ['none'] },
    ],
    attachmentContext: '[첨부 1] 설계 설명서\n- 기준 자료: 컨트롤러v2_넷리스트_v0.4.net (KiCad)\n- 회로도 v0.4',
  };

  it('"아이디어만"인데 회로도·넷리스트가 있고 "장치 단독"인데 PC 연동이 있으면 두 건을 잡는다', () => {
    const checks = detectAnswerChecks(mismatched);
    expect(checks.map((c) => c.code)).toEqual(['stage', 'external']);
    expect(checks[0]?.found).toEqual(['회로도', '넷리스트', 'KiCad']);
    expect(checks[0]?.text).toBe("답변과 자료 확인 필요: 현재 상태는 '아이디어만 있어요'로 답하셨는데 자료에 회로도·넷리스트·KiCad이(가) 나옵니다. 어느 단계가 맞나요?");
    expect(checks[1]?.found).toEqual(['PC']);
  });

  it('단서 뒤에 부정이 오면("회로도는 없다") 단서로 치지 않고, 답이 어긋나지 않으면 비어 있다', () => {
    expect(detectAnswerChecks({ ...mismatched, description: '회로도는 아직 없습니다. PC 프로그램은 없고 장치 단독입니다.', attachmentContext: '' })).toEqual([]);
    expect(detectAnswerChecks({ ...mismatched, answers: [{ code: 'stage', choices: ['schematic'] }, { code: 'external', choices: ['pc_software'] }] })).toEqual([]);
  });

  it('정합 질문은 불일치 질문 다음·모델 질문 앞에 서고 검토서 checks 에도 남는다', () => {
    const { review, diagnostics } = postProcessDevReview(output, mismatched, meta);
    expect(diagnostics.r9Checks).toBe(2);
    expect(review.checks.map((c) => c.code)).toEqual(['stage', 'external']);
    expect(review.openQuestions.slice(0, 2).map((q) => [q.area, q.question.startsWith('답변과 자료 확인 필요')])).toEqual([['general', true], ['general', true]]);
    expect(review.openQuestions).toHaveLength(6);
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
      areas: [{ area: 'circuit', summary: 7, spec: [{ item: '전원부', text: '12V 입력', evidence: '12V' }, { item: '' }] }],
    })}\n\`\`\``;
    const parsed = parseDevReviewLlmOutput(raw);
    expect(parsed.requirements).toHaveLength(1);
    expect(parsed.openQuestions).toHaveLength(1);
    expect(parsed.areas[0]?.summary).toBe('');
    expect(parsed.areas[0]?.spec.map((r) => r.item)).toEqual(['전원부']);
  });

  it('프롬프트에 규칙·답변·첨부가 바인딩되고 추가 지침은 관리자 몫', () => {
    const prompt = buildDevReviewPrompt({ ...source, attachmentContext: '[첨부 1] 사양서' }, 'KC 인증을 항상 확인하세요');
    expect(prompt).toContain('[절대 규칙]');
    expect(prompt).toContain('KC 인증을 항상 확인하세요');
    expect(prompt).toContain('함께 쓰는 것이 있나요? → 스마트폰 앱');
    expect(prompt).toContain('언제까지 완성돼야 하나요? → 협의해서 정할게요');
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
