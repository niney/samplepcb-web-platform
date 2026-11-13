import { describe, expect, it } from 'vitest';
import { devReviewQuestionId, withDevReviewQuestionIds } from '@sp/api-contract';
import type { DevReviewOpenQuestionType } from '@sp/api-contract';
import { foldDevelopQuestionAnswers, questionAnswerEventBody, questionAnswerEventTitle } from './develop-questions';

const at = (n: number): Date => new Date(Date.UTC(2026, 10, 13, 0, n));
const answered = (n: number, answers: { qid: string; question: string; answer: string }[]) => ({ type: 'question_answered', payload: { answers }, createdAt: at(n) });

describe('확인 사항 문항 번호', () => {
  it('문구가 같으면 같은 번호 — 앞뒤 공백은 보지 않는다', () => {
    expect(devReviewQuestionId('외장 케이스는 정해졌나요?')).toBe(devReviewQuestionId('  외장 케이스는 정해졌나요? '));
    expect(devReviewQuestionId('외장 케이스는 정해졌나요?')).not.toBe(devReviewQuestionId('외장 케이스는 정해졌나요'));
    expect(devReviewQuestionId('외장 케이스는 정해졌나요?')).toMatch(/^q[0-9a-z]+$/);
  });

  it('있는 번호는 그대로, 없으면 문구에서 — 문구를 고쳐도 번호는 남는다', () => {
    const asked: DevReviewOpenQuestionType[] = [{ question: '수량은 몇 대인가요?', why: '', area: 'general' }];
    const first = withDevReviewQuestionIds({ openQuestions: asked });
    const id = first.openQuestions[0]?.id;
    expect(id).toBe(devReviewQuestionId('수량은 몇 대인가요?'));
    const edited = withDevReviewQuestionIds({ openQuestions: first.openQuestions.map((q) => ({ ...q, question: '시제품 수량은 몇 대인가요?' })) });
    expect(edited.openQuestions[0]?.id).toBe(id);
  });

  it('같은 문구가 둘이면 뒤 문항에 순번', () => {
    const asked: DevReviewOpenQuestionType[] = [
      { question: '같은 질문', why: '', area: 'general' },
      { question: '같은 질문', why: '', area: 'pcb' },
    ];
    const ids = withDevReviewQuestionIds({ openQuestions: asked }).openQuestions.map((q) => q.id);
    expect(ids[1]).toBe(`${ids[0] ?? ''}-2`);
  });
});

describe('확인 사항 고객 답변 접기', () => {
  it('같은 문항은 마지막 답이 이기고 답한 시각도 그것', () => {
    const list = foldDevelopQuestionAnswers([
      answered(1, [{ qid: 'q1', question: '질문 1', answer: '처음 답' }, { qid: 'q2', question: '질문 2', answer: '둘째 답' }]),
      answered(5, [{ qid: 'q1', question: '질문 1', answer: '고친 답' }]),
    ]);
    expect(list).toEqual([
      { qid: 'q1', question: '질문 1', answer: '고친 답', answeredAt: at(5).toISOString() },
      { qid: 'q2', question: '질문 2', answer: '둘째 답', answeredAt: at(1).toISOString() },
    ]);
  });

  it('빈 답은 지움 · 다른 이벤트와 모양이 다른 payload 는 건너뛴다', () => {
    const list = foldDevelopQuestionAnswers([
      answered(1, [{ qid: 'q1', question: '질문 1', answer: '답' }]),
      { type: 'comment', payload: { answers: [{ qid: 'q9', question: 'x', answer: 'y' }] }, createdAt: at(2) },
      { type: 'question_answered', payload: { answers: 'broken' }, createdAt: at(3) },
      { type: 'question_answered', payload: null, createdAt: at(4) },
      answered(6, [{ qid: 'q1', question: '질문 1', answer: '' }]),
    ]);
    expect(list).toEqual([]);
  });

  it('진행 사항 글 — 제목은 답한 수, 본문은 문항마다 Q/A', () => {
    const items = [
      { question: '수량은?', answer: '10대' },
      { question: '형식은?', answer: '' },
    ];
    expect(questionAnswerEventTitle(items)).toBe('확인 사항 1건에 답했습니다');
    expect(questionAnswerEventTitle([{ answer: '' }])).toBe('확인 사항 답변 1건을 지웠습니다');
    expect(questionAnswerEventBody(items)).toBe('Q. 수량은?\nA. 10대\n\nQ. 형식은?\nA. (답변을 지웠습니다)');
  });
});
