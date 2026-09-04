// 문항 하나의 입력 상태 — 미응답은 choices 가 빈 배열이고 등록 payload 에서 빠진다.
// QuestionField 가 그리는 모양이라 여기(공용)에 두고, 각 앱의 위저드 폼이 이 타입으로 상태를 든다.
export interface QuestionState {
  choices: string[];
  note: string;
}
