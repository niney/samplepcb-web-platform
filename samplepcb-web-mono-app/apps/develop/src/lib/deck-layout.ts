// 의뢰 출력물(16:9 장) 판 크기 — 13.333×7.5in(96dpi 로 1280×720). 머리(상표 줄 + 제목 [+ 부제])와 꼬리(의뢰 제목 · 쪽 번호)는
// 높이가 고정이라 본문 높이가 정해진다. DeckSlide · DeckTable 의 클래스와 같은 값이어야 한다(바꾸면 같이 바꾼다).
// 배분(어느 장에 무엇을 실을지)은 이 높이와 숨은 자리에서 잰 덩어리 높이로 정한다(@sp/utils deck-pack).
export const DECK = {
  width: 1280,
  height: 720,
  padX: 64,
  headPlain: 110, // 위 34 + 상표 줄 18 + 12 + 제목 46
  headSub: 144, // + 8 + 부제 26
  bodyGap: 26, // 머리 아래
  footGap: 18, // 꼬리 위
  foot: 52,
  colGap: 56, // 본문 두 단 사이
} as const;
export const DECK_BODY_WIDTH = DECK.width - DECK.padX * 2;
export const DECK_COLUMN_WIDTH = (DECK_BODY_WIDTH - DECK.colGap) / 2;
export const deckBodyHeight = (subtitle: boolean): number =>
  DECK.height - (subtitle ? DECK.headSub : DECK.headPlain) - DECK.bodyGap - DECK.footGap - DECK.foot;

// 표 머리줄 높이 — 넓은 표(본문 폭) · 촘촘한 표(한 단 폭).
export const DECK_TABLE_HEAD = { wide: 46, dense: 38 } as const;
