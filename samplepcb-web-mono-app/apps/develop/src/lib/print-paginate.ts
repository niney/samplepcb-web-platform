// 의뢰 출력물 쪽 나누기 — 디자인 체크리스트 8번(2026-10-30): PPT 4:3 판을 화면에서 쪽 단위로 미리 보고, 인쇄도 같은 자리에서 끊는다.
// 판 = 10×7.5in(96dpi 로 960×720px) · 여백 위아래 40 · 좌우 48 → 내용 864×640. 화면은 판 사이를 24 띄워 그린다(인쇄엔 없다).
// 출력물은 한 줄기 흐름(flow)으로 그리고, 덩어리를 문서 순서로 재어 쪽 경계에 걸리면 다음 쪽 첫머리로 민다(margin-top).
// 민 덩어리엔 data-pb 를 달아 인쇄 CSS 가 같은 자리에서 쪽을 넘긴다(break-before: page · 민 여백은 0 — style.css).
// 덩어리 = 표 행·목록 항목·그림·제목·.print-keep·dl 의 행은 통째로, 그리드·가로 flex 도 통째로(나란한 칸을 쪼개지 않는다),
// 블록 자식이 없는 상자(글뿐)도 통째로. 나머지 상자는 안으로 들어가 자식을 잰다. 섹션(data-print-section)은 새 쪽에서 시작한다.
// 인쇄 규칙을 화면에서 그대로 흉내 내야 쪽 수가 맞는다:
//  · 첫 자식에 건 쪽 넘김은 부모로 옮아간다(CSS 조각화) — 첫 자식이면 부모째 민다(부모의 위 여백·테두리도 다음 쪽으로 간다).
//  · 표 행엔 margin 이 먹지 않는다 — 그 행 앞에서 표를 둘로 나눠(머리글 복제) 뒷 표를 민다. 첫 행이면 표째 민다.
//  · 쪼개지 말라는 덩어리(li·tr·img·figure·.print-keep)는 한 쪽보다 커도 인쇄가 먼저 다음 쪽으로 넘긴다 — 화면도 넘긴 뒤 안을 나눈다.
// 제목(h1~h4)은 바로 뒤 덩어리와 떨어지지 않게 같이 민다. 큰 글 덩어리(의뢰 내용 등)는 통째로 밀면 빈 자리가 크게 남아
// 줄 경계에서 둘로 쪼갠다(Range 로 줄 위치를 잰다 — 뒷조각은 같은 모양의 새 상자). 한 쪽보다 큰 나란한 칸만 쪽을 넘긴 채 둔다
// (인쇄는 브라우저가 나누고, 화면은 판 여백 가림이 덮는다 — 드물다).
// DOM 을 직접 바꾸므로(밀기·쪼개기) 다시 나눌 땐 흐름을 새로 그린 뒤 부른다(RequestPrint 가 key 로 다시 붙인다).
// 화면 폭이 768 아래면 md: 배치가 풀려 화면 판과 인쇄 쪽이 어긋날 수 있다(인쇄 쪽 폭 864 는 md 를 쓴다).

export const PRINT_PAGE = { width: 960, height: 720, padX: 48, padY: 40, gap: 24 } as const;
export const PRINT_CONTENT_HEIGHT = PRINT_PAGE.height - PRINT_PAGE.padY * 2;
// 화면에서 한 쪽 내용의 시작 간격(판 높이 + 판 사이).
export const PRINT_PITCH = PRINT_PAGE.height + PRINT_PAGE.gap;
// 화면 쪽과 인쇄 쪽의 1px 남짓한 반올림 차이를 덮는 여유 — 화면은 이만큼 덜 채운다.
const LIMIT = PRINT_CONTENT_HEIGHT - 4;
const EPS = 0.5;
const KEEP = 'img, svg, iframe, figure, tr, li, h1, h2, h3, h4, .print-keep, dl > div';
// 인쇄 CSS 가 break-inside: avoid 를 거는 덩어리(style.css 와 같게).
const AVOID = 'li, tr, img, figure, .print-keep';
const HEADING = 'h1, h2, h3, h4';
// 제목과 다음 덩어리 사이가 이만큼 안이면 붙어 있다고 본다(카드 안쪽 여백 + 사이 간격).
const KEEP_WITH_NEXT_GAP = 64;
// 이보다 큰 글 덩어리는 쪼개고, 작은 건 통째로 민다(두세 줄을 쪽마다 한 줄씩 가르지 않게).
const SPLIT_MIN_HEIGHT = PRINT_CONTENT_HEIGHT / 3;

type Box = Element & ElementCSSInlineStyle;
interface Item {
  el: Box;
  force: boolean; // 새 쪽에서 시작(섹션)
}

const hasStyle = (el: Element): el is Box => 'style' in el;
// 흐름 안의 블록(절대 배치·숨김·인라인은 뺀다).
const isFlowBlock = (el: Element): boolean => {
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.display !== 'contents' && !cs.display.startsWith('inline') && cs.position !== 'absolute' && cs.position !== 'fixed';
};
// 나란한 칸(열 둘 이상 그리드·가로 flex·표 행) — 통째로만 다루고 안으로 들어가지 않는다. 한 열 그리드(grid gap-2 같은
// 세로 쌓기)는 블록처럼 안으로 들어간다.
const isRowLayout = (el: Element): boolean => {
  const cs = getComputedStyle(el);
  if (cs.display === 'grid') return cs.gridTemplateColumns.trim().split(/\s+/).length > 1;
  return cs.display === 'table-row' || (cs.display === 'flex' && !cs.flexDirection.startsWith('column'));
};
const isAtomic = (el: Element): boolean => el.matches(KEEP) || isRowLayout(el) || ![...el.children].some((c) => isFlowBlock(c));

function collect(root: Element): Item[] {
  const out: Item[] = [];
  const walk = (el: Element): void => {
    for (const child of el.children) {
      if (!hasStyle(child) || !isFlowBlock(child)) continue;
      if (child.hasAttribute('data-print-section')) out.push({ el: child, force: true });
      if (isAtomic(child)) out.push({ el: child, force: false });
      else walk(child);
    }
  };
  walk(root);
  return out;
}

const pageOf = (y: number): number => Math.floor((y + EPS) / PRINT_PITCH);

// el 의 윗변을 흐름 기준 target 으로 내린다. 접히는 여백(블록 첫 자식)은 덜 내려갈 수 있어 다시 재고 모자란 만큼 더한다.
function pushTo(el: Box, target: number, origin: () => number): void {
  for (let i = 0; i < 3; i += 1) {
    const delta = target - (el.getBoundingClientRect().top - origin());
    if (delta <= EPS) return;
    const current = Number.parseFloat(getComputedStyle(el).marginTop) || 0;
    el.style.marginTop = `${String(current + delta)}px`;
    el.setAttribute('data-pb', '');
  }
}

const hasPrevInFlow = (el: Element): boolean => {
  for (let p = el.previousElementSibling; p !== null; p = p.previousElementSibling) if (isFlowBlock(p)) return true;
  return false;
};
const hasNextInFlow = (el: Element): boolean => {
  for (let n = el.nextElementSibling; n !== null; n = n.nextElementSibling) if (isFlowBlock(n)) return true;
  return false;
};

// 덩어리 바로 아래에 붙는 조상들의 아래 안쪽 여백·테두리 — 마지막 흐름 자식인 동안 위로 올라가며 더한다. 인쇄(Chrome)는 이
// 여백을 다음 쪽으로 떼어 보내지 않고 마지막 덩어리째 넘기므로(2026-11-05 실측: 담당자 의견 카드의 아래 여백 26px 이 쪽 아래를
// 넘자 카드 내용이 통째로 다음 쪽으로 가 화면 판보다 한 쪽 늘었다) 이 쪽에 드는지 볼 때 같이 잰다. 화면이 더 미는 건
// 인쇄도 data-pb 로 같은 자리에서 끊으니 어긋나지 않는다 — 어긋나는 건 덜 밀 때뿐이다.
function trailingOf(el: Element, flow: Element): number {
  let sum = 0;
  let node = el;
  let parent = el.parentElement;
  while (parent !== null && parent !== flow && !hasNextInFlow(node)) {
    const cs = getComputedStyle(parent);
    sum += (Number.parseFloat(cs.paddingBottom) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
    node = parent;
    parent = parent.parentElement;
  }
  return sum;
}

// 이 행 앞에서 표를 둘로 나눈다 — 뒷 표는 같은 모양(머리글 복제)으로 바로 뒤에 붙고, 행은 그대로 옮겨 간다.
function splitTableBefore(row: HTMLTableRowElement): HTMLTableElement | null {
  const body = row.parentElement;
  const table = row.closest('table');
  if (!(body instanceof HTMLTableSectionElement) || body.tagName !== 'TBODY' || table === null) return null;
  const tailTable = table.cloneNode(false);
  const tailBody = body.cloneNode(false);
  if (!(tailTable instanceof HTMLTableElement) || !(tailBody instanceof HTMLTableSectionElement)) return null;
  tailTable.removeAttribute('data-pb');
  tailTable.style.marginTop = '';
  if (table.tHead !== null) tailTable.appendChild(table.tHead.cloneNode(true));
  for (let r: Element | null = row; r !== null; ) {
    const next: Element | null = r.nextElementSibling;
    tailBody.appendChild(r);
    r = next;
  }
  tailTable.appendChild(tailBody);
  table.after(tailTable);
  return tailTable;
}

// 실제로 밀 상자 — 표 행이면 표(첫 행)나 그 행에서 나눈 뒷 표, 그다음 첫 자식이면 부모째(인쇄의 쪽 넘김 전파와 같게).
function boxToPush(el: Box, flow: Element): Box {
  let box: Box = el;
  if (el instanceof HTMLTableRowElement) {
    const table = el.closest('table');
    const firstBodyRow = el.parentElement?.tagName !== 'TBODY' || !hasPrevInFlow(el);
    if (table !== null) box = firstBodyRow ? table : (splitTableBefore(el) ?? table);
  }
  while (!hasPrevInFlow(box)) {
    const parent = box.parentElement;
    if (parent === null || parent === flow || !hasStyle(parent)) break;
    box = parent;
  }
  return box;
}

// 밀 덩어리 — 바로 위가 붙어 있는 제목이면 제목부터(제목이 이미 쪽 첫머리면 덩어리만).
function keepTarget(items: readonly Item[], index: number, origin: () => number): Box {
  let target = items[index]?.el;
  if (target === undefined) throw new Error('print-paginate: index');
  for (let j = index - 1; j >= 0; j -= 1) {
    const prev = items[j];
    if (prev === undefined || prev.force || !prev.el.matches(HEADING)) break;
    const pr = prev.el.getBoundingClientRect();
    if (target.getBoundingClientRect().top - pr.bottom > KEEP_WITH_NEXT_GAP) break;
    const prevTop = pr.top - origin();
    if (prevTop <= pageOf(prevTop) * PRINT_PITCH + EPS) break;
    target = prev.el;
  }
  return target;
}

// 글 하나뿐인 상자(자식 요소 없음) — 줄 경계에서 쪼갤 수 있다.
const splittable = (el: Box): el is HTMLElement =>
  el instanceof HTMLElement && el.children.length === 0 && el.childNodes.length === 1 && el.firstChild instanceof Text && el.firstChild.data.length > 1;

// limit(흐름 기준) 위에서 끝나는 줄까지 남기고 나머지를 같은 모양의 새 상자로 떼어 바로 뒤에 붙인다. 첫 줄도 안 들어가면 null.
function splitAt(el: HTMLElement, limit: number, origin: () => number): HTMLElement | null {
  const text = el.firstChild;
  if (!(text instanceof Text)) return null;
  const cs = getComputedStyle(el);
  const tail = (Number.parseFloat(cs.paddingBottom) || 0) + (Number.parseFloat(cs.borderBottomWidth) || 0);
  const bound = limit - tail + origin();
  const range = document.createRange();
  // [0, n) 글자의 마지막 줄 아래 — n 이 늘면 줄지 않는다.
  const bottomOf = (n: number): number => {
    range.setStart(text, 0);
    range.setEnd(text, n);
    let bottom = Number.NEGATIVE_INFINITY;
    for (const rect of range.getClientRects()) if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
    return bottom;
  };
  const length = text.data.length;
  if (bottomOf(1) > bound) return null;
  // 이 쪽에 남길 수 있는 가장 긴 앞부분 — cut 번째 글자는 넘치는 줄의 첫 글자다.
  let lo = 1;
  let hi = length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bottomOf(mid) <= bound) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= length) return null;
  const rest = text.splitText(lo);
  rest.data = rest.data.replace(/^\n/, '');
  const tailBox = el.cloneNode(false);
  if (!(tailBox instanceof HTMLElement)) return null;
  tailBox.removeAttribute('data-pb');
  tailBox.style.marginTop = '';
  tailBox.appendChild(rest);
  el.after(tailBox);
  return tailBox;
}

interface Spot {
  height: number;
  limit: number; // 이 쪽 내용 아래(흐름 기준)
  nextTop: number; // 다음 쪽 내용 위
  atTop: boolean; // 이 쪽 첫머리에서 시작
  inGap: boolean; // 여백(쪽 사이)에서 시작
  fits: boolean; // 조상의 아래 여백(trailing)까지 이 쪽에 든다
}
function spotOf(el: Box, origin: () => number, trailing = 0): Spot {
  const rect = el.getBoundingClientRect();
  const top = rect.top - origin();
  const page = pageOf(top);
  const limit = page * PRINT_PITCH + LIMIT;
  return {
    height: rect.height,
    limit,
    nextTop: (page + 1) * PRINT_PITCH,
    atTop: top <= page * PRINT_PITCH + EPS,
    inGap: top >= limit - EPS,
    fits: top < limit - EPS && top + rect.height + trailing <= limit + EPS,
  };
}

// 흐름을 쪽으로 나누고 쪽 수를 돌려준다.
export function paginatePrint(flow: HTMLElement): number {
  const origin = (): number => flow.getBoundingClientRect().top;
  const push = (el: Box, target: number): void => {
    pushTo(boxToPush(el, flow), target, origin);
  };
  const items = collect(flow);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item === undefined) break;
    const { el, force } = item;
    const spot = spotOf(el, origin, trailingOf(el, flow));
    if (spot.height <= 0) continue;
    if (force) {
      if (!spot.atTop) push(el, spot.nextTop);
      continue;
    }
    if (spot.fits) continue;
    const tall = spot.height > LIMIT;
    // 큰 글 덩어리 — 줄 경계에서 쪼갠다(앞 줄은 이 쪽에).
    if (!spot.inGap && splittable(el) && (spot.height > SPLIT_MIN_HEIGHT || tall)) {
      const tailBox = splitAt(el, spot.limit, origin);
      if (tailBox !== null) {
        items.splice(i + 1, 0, { el: tailBox, force: false });
        continue;
      }
    }
    // 다음 쪽으로 — 한 쪽에 드는 덩어리, 여백에서 시작한 덩어리, 쪼개지 말라는 덩어리(인쇄가 먼저 넘긴다).
    if (!spot.atTop && (!tall || spot.inGap || el.matches(AVOID))) {
      push(keepTarget(items, i, origin), spot.nextTop);
      if (!tall) continue;
    }
    // 한 쪽보다 크다 — 글이면 넘긴 자리에서 다시 쪼개고, 세로로 쌓인 상자면 안으로 들어가 자식을 나눈다.
    if (splittable(el)) {
      const tailBox = splitAt(el, spotOf(el, origin).limit, origin);
      if (tailBox !== null) items.splice(i + 1, 0, { el: tailBox, force: false });
    } else if (!isRowLayout(el)) {
      const inner = collect(el);
      if (inner.length > 0) items.splice(i + 1, 0, ...inner);
    }
  }
  const height = flow.getBoundingClientRect().height;
  return Math.max(1, pageOf(Math.max(0, height - 1)) + 1);
}
