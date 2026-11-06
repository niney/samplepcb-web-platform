// 의뢰 출력물 크기 규칙 — 디자이너 메모(2026-11-05, 피그마 「개발 의뢰 > 내 의뢰 > 출력하기」): 출력할 때 글자는 2px 작게,
// 16px 이상인 여백은 10px 줄인다. 2-4 개발 명세서는 예외.
// 출력물은 상세 화면 컴포넌트를 print 모드로 다시 쓰므로(RequestPrint) 클래스를 고치지 않고, 그려진 크기를 재서 인라인으로 덮는다.
// 여백 = 안쪽 여백(네 변) · 바깥 위아래 여백 · 칸 사이 간격(gap). 좌우 바깥 여백은 건드리지 않는다 — mx-auto 의 계산값(px)이나
// 목록 들여쓰기(ms-*)까지 줄여 가운데 맞춤·글머리 자리가 깨진다.
// 예외 = [data-print-noscale] 안 — 표지 · 첫 쪽 머리 띠 · 견적서 문서 · 2-4 개발 명세서(출력용 크기로 따로 그렸거나 메모가 뺀 것).
// 쪽 나누기(lib/print-paginate) **전에** 한 번 부른다 — 줄어든 크기로 재야 화면 판과 인쇄 쪽이 맞는다. 흐름을 새로 그리면(key)
// 새 DOM 에 다시 부른다(인라인 값이 두 번 줄지 않는다).

const NOSCALE = '[data-print-noscale]';
const FONT_STEP = 2;
const MIN_FONT = 8;
const SPACE_MIN = 16;
const SPACE_STEP = 10;

const px = (v: string): number => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const shrink = (v: number): number | null => (v >= SPACE_MIN ? v - SPACE_STEP : null);

interface Plan {
  el: HTMLElement;
  font: number;
  pad: [number, number, number, number];
  margin: [number, number];
  gap: [number, number];
}

export function applyPrintScale(root: HTMLElement): void {
  const all = [...root.querySelectorAll<HTMLElement>('*')].filter((el) => el instanceof HTMLElement && el.closest('svg') === null);
  // 예외 상자의 글자 크기를 먼저 못 박는다 — 바깥(줄어드는 조상)에서 상속받던 크기가 같이 줄지 않게.
  for (const el of all) {
    if (el.matches(NOSCALE) && (el.parentElement?.closest(NOSCALE) ?? null) === null) el.style.fontSize = getComputedStyle(el).fontSize;
  }
  const targets = all.filter((el) => el.closest(NOSCALE) === null);
  // 먼저 다 재고 나중에 쓴다 — 부모 글자를 줄이면 자식의 계산값(상속·em)이 따라 바뀐다.
  const plans: Plan[] = targets.map((el) => {
    const cs = getComputedStyle(el);
    return {
      el,
      font: px(cs.fontSize),
      pad: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      margin: [px(cs.marginTop), px(cs.marginBottom)],
      gap: [px(cs.rowGap), px(cs.columnGap)],
    };
  });
  for (const { el, font, pad, margin, gap } of plans) {
    const s = el.style;
    if (font > 0) s.fontSize = `${String(Math.max(MIN_FONT, font - FONT_STEP))}px`;
    const sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const;
    sides.forEach((side, i) => {
      const v = shrink(pad[i] ?? 0);
      if (v !== null) s[side] = `${String(v)}px`;
    });
    const top = shrink(margin[0]);
    if (top !== null) s.marginTop = `${String(top)}px`;
    const bottom = shrink(margin[1]);
    if (bottom !== null) s.marginBottom = `${String(bottom)}px`;
    const row = shrink(gap[0]);
    if (row !== null) s.rowGap = `${String(row)}px`;
    const col = shrink(gap[1]);
    if (col !== null) s.columnGap = `${String(col)}px`;
  }
}
