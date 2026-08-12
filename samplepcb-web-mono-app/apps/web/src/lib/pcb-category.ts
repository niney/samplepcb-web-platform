// PCB 제작 분류 배지 — 값은 sp_order_spec.category(스냅샷 모델 4종 고정, QuoteFilterBar
// 와 같은 사전). 목록에서 회색 텍스트로 흘려 두면 standard 와 advance 가 눈에 안 들어오는데,
// 이 둘은 공정·단가·리드타임이 다른 **다른 물건**이라 행을 훑을 때 바로 갈려야 한다.
//
// 색은 성격순이다: standard 는 기본이라 중립(slate), advance 는 주의를 끌어야 해서 난색
// (orange), metalMask 는 금속(stone), flexible 은 연성(teal). 이 화면의 다른 배지들
// (견적 amber/sky/emerald · RFQ blue/violet)과 겹치지 않는 자리만 골랐다.
//
// 라벨은 i18n 사전(admin.quotes.categories)과 같은 제품명이되 목록용으로 짧게 줄인다
// ('Standard PCB' 는 배지에 넣으면 열을 밀어낸다).
const PCB_CATEGORY_BADGES: Record<string, { label: string; cls: string }> = {
  standard: { label: 'Standard', cls: 'bg-slate-100 text-slate-700' },
  advance: { label: 'Advance', cls: 'bg-orange-100 text-orange-700' },
  metalMask: { label: 'Metal Mask', cls: 'bg-stone-200 text-stone-700' },
  flexible: { label: 'FPCB', cls: 'bg-teal-100 text-teal-700' },
};

/** 모르는 분류는 원문 그대로 보여준다 — 사전에 없다고 값을 숨기면 화면이 거짓말을 한다. */
export const pcbCategoryBadge = (category: string): { label: string; cls: string } =>
  PCB_CATEGORY_BADGES[category] ?? { label: category, cls: 'bg-gray-100 text-gray-600' };
