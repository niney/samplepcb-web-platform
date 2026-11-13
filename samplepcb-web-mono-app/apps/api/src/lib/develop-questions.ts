import { withDevReviewQuestionIds } from '@sp/api-contract';
import type { DevelopQuestionAnswerType, MarketDevReviewType } from '@sp/api-contract';
import { z } from 'zod';
import { toDevReview } from './market';

// 확인이 필요한 사항 — 고객이 직접 적는 답(docs/DEVELOP_FLOW.md §7.2.13).
// 저장은 진행 기록이다: 답할 때마다 question_answered 이벤트 하나(payload.answers = 바뀐 문항들). 표를 따로 두지 않은 까닭 —
// 이벤트는 추가 전용이라(고치거나 지우는 길이 없다) 답의 이력이 그대로 남고, 진행 사항에 보이는 기록과 저장이 한 몸이라 어긋날 수 없다.
// '지금 답변'은 이벤트를 시간순으로 접어 만든다: 같은 문항은 마지막 것이 이기고, 빈 답은 지움이다.
const AnswerPayload = z.object({
  answers: z.array(z.object({ qid: z.string(), question: z.string(), answer: z.string() })),
});

interface AnswerEvent {
  type: string;
  payload: unknown;
  createdAt: Date;
}

/** 이벤트(시간순) → 지금 답변. 다른 종류의 이벤트 · 모양이 다른 payload 는 건너뛴다. */
export function foldDevelopQuestionAnswers(events: readonly AnswerEvent[]): DevelopQuestionAnswerType[] {
  const map = new Map<string, DevelopQuestionAnswerType>();
  for (const e of events) {
    if (e.type !== 'question_answered') continue;
    const parsed = AnswerPayload.safeParse(e.payload);
    if (!parsed.success) continue;
    for (const a of parsed.data.answers) {
      if (a.answer.trim() === '') map.delete(a.qid);
      else map.set(a.qid, { qid: a.qid, question: a.question, answer: a.answer, answeredAt: e.createdAt.toISOString() });
    }
  }
  return [...map.values()];
}

/** 진행 사항에 보일 글 — 문항마다 'Q. 질문 / A. 답'. */
export function questionAnswerEventBody(items: readonly { question: string; answer: string }[]): string {
  return items.map((a) => `Q. ${a.question}\nA. ${a.answer === '' ? '(답변을 지웠습니다)' : a.answer}`).join('\n\n');
}

export function questionAnswerEventTitle(items: readonly { answer: string }[]): string {
  const answered = items.filter((a) => a.answer !== '').length;
  return answered > 0 ? `확인 사항 ${String(answered)}건에 답했습니다` : `확인 사항 답변 ${String(items.length)}건을 지웠습니다`;
}

/** 개발의뢰 검토서 읽기 — 문항마다 번호를 채운다(고객 답변이 번호에 붙는다). 저장분에 번호가 없으면 질문 문구에서 만든다. */
export const toDevelopReview = (json: unknown): MarketDevReviewType | null => {
  const review = toDevReview(json);
  return review === null ? null : withDevReviewQuestionIds(review);
};
