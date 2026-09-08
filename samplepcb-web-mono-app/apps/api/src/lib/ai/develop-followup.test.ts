import { describe, expect, it } from 'vitest';
import { DEVELOP_FOLLOWUP_MAX_QUESTIONS, mergeDevelopFollowupAnswers, developFollowupAnswerText } from '@sp/api-contract';
import { buildDevelopFollowupPrompt, parseDevelopFollowupLlmOutput } from './develop-followup';

// 개발의뢰 AI 후속 질문(docs/DEVELOP_FLOW.md §7.2.2) — 파서·정규화의 결정적 규칙과 답 합치기.

describe('후속 질문 파서·정규화', () => {
  it('빈 질문 삭제·중복 접기·선택지 코드 부여·잘 모르겠음 부착·서술형 판정', () => {
    const raw = JSON.stringify({
      understood: '  온도를 재서 펌프를 끄는 장비  ',
      questions: [
        { question: '스마트폰 앱이 필요한가요?', why: '앱이 있으면 앱 개발 항목이 추가됩니다', options: ['필요함', '필요 없음', '필요 없음', '잘 모르겠음'] },
        { question: '스마트폰 앱이 필요한가요 ?', why: '중복', options: [] },
        { question: '', why: '', options: [] },
        { question: '설치 장소를 알려주세요.', why: '실외면 방수 케이스가 듭니다', options: ['실내'] },
        { question: '기존 장비와 연결되나요?', why: '통신 항목', options: ['네', '아니오', '전문가 판단 요청'] },
      ],
    });
    const parsed = parseDevelopFollowupLlmOutput(`\`\`\`json\n${raw}\n\`\`\``);
    expect(parsed.understood).toBe('온도를 재서 펌프를 끄는 장비');
    expect(parsed.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    // 선택지형: 중복·모름 류 제거 후 o1.. + unknown.
    expect(parsed.questions[0]?.options.map((o) => `${o.code}:${o.label}`)).toEqual(['o1:필요함', 'o2:필요 없음', 'unknown:잘 모르겠음']);
    // 선택지가 1개면 서술형으로.
    expect(parsed.questions[1]?.options).toEqual([]);
    expect(parsed.questions[2]?.options.map((o) => o.code)).toEqual(['o1', 'o2', 'unknown']);
  });

  it('상한을 넘는 질문은 앞에서 자르고, 객체가 아니면 던진다', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ question: `질문 ${String(i)}`, why: '', options: [] }));
    const parsed = parseDevelopFollowupLlmOutput(JSON.stringify({ understood: '', questions: many }));
    expect(parsed.questions).toHaveLength(DEVELOP_FOLLOWUP_MAX_QUESTIONS);
    expect(() => parseDevelopFollowupLlmOutput('[]')).toThrow();
  });

  it('프롬프트에 규칙·자료·추가 지침이 바인딩된다', () => {
    const p = buildDevelopFollowupPrompt({ title: '디스펜서', description: '설명', attachmentContext: '첨부 텍스트', attachmentFiles: ['a.pdf'] }, '운영 지침');
    expect(p).toContain('견적 산출에 영향을 주는 항목');
    expect(p).toContain('■ 제목: 디스펜서');
    expect(p).toContain('첨부 자료(1개)');
    expect(p).toContain('운영 지침');
  });

  it('답 합치기 — 옵션 밖 코드는 버리고, 서술은 남기고, 빈 답은 미응답', () => {
    const parsed = parseDevelopFollowupLlmOutput(JSON.stringify({
      understood: 'x',
      questions: [
        { question: '앱?', why: '', options: ['네', '아니오'] },
        { question: '설치 장소?', why: '', options: [] },
      ],
    }));
    const result = { version: 1 as const, understood: parsed.understood, questions: parsed.questions, meta: { jobId: 'j', model: 'm', promptVersion: 'v', generatedAt: 't', attachmentFiles: [] } };
    const merged = mergeDevelopFollowupAnswers(result, [
      { id: 'q1', choice: 'o9', text: '' },
      { id: 'q2', choice: 'o1', text: '창고 실내' },
      { id: 'zzz', choice: 'o1', text: 'ignored' },
    ]);
    expect(merged.questions[0]?.answer).toBeNull();
    expect(merged.questions[1]?.answer).toEqual({ choice: null, text: '창고 실내' });
    expect(merged.questions.map(developFollowupAnswerText)).toEqual(['', '창고 실내']);
    const chosen = mergeDevelopFollowupAnswers(result, [{ id: 'q1', choice: 'o2', text: '단, 나중에' }]);
    expect(chosen.questions.map(developFollowupAnswerText)).toEqual(['아니오 (단, 나중에)', '']);
  });
});
