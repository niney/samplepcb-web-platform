// 장(슬라이드) 배분 — 높이가 고정인 장에 덩어리를 나눠 싣는 순수 함수(개발의뢰 출력물 16:9, docs/DEVELOP_FLOW.md §7.2.10).
// DOM 을 모른다 — 덩어리 높이는 화면이 숨은 자리에서 재어 넘긴다. 원칙: 한 장에 딱 담기게, 넘치면 덩어리 단위로
// 다음 장에 보내되 마지막 장에 하나만 남지 않게 고르게 나눈다.

// 잰 높이와 실제로 그린 높이의 반올림 차이를 덮는 여유.
const SLACK = 2;
// 한 장(단)에 이만큼까지는 넘치게 실어도 된다 — 덩어리 한둘 때문에 거의 빈 장을 하나 더 만드느니
// 그 장의 글자를 조금 줄여 담는다(장의 맞춤 — 8% 넘침이면 글자는 4% 남짓 준다).
export const DECK_STRETCH = 1.08;

/** 단에 쌓는 장 — solo 는 혼자 한 장(한 단에 안 드는 큰 덩어리), columns 는 단마다 덩어리 번호를 위에서 아래로. */
export type DeckColumnSlide = { kind: 'solo'; index: number } | { kind: 'columns'; columns: number[][] };

const stackHeight = (indexes: readonly number[], heights: readonly number[], gap: number): number =>
  indexes.reduce((sum, i) => sum + (heights[i] ?? 0), 0) + Math.max(0, indexes.length - 1) * gap;

/**
 * 덩어리를 순서대로 단에 쌓는다(한 장 = 두 단). 덩어리는 단 사이에서 쪼개지 않는다.
 * 한 단보다 큰 덩어리는 혼자 한 장을 쓴다(그 장이 안에서 두 단으로 편다). 한 단만 찬 장은 — 덩어리가 하나면 혼자 한 장으로,
 * 여럿이면 두 단으로 다시 갈라 — 반쪽만 찬 장을 남기지 않는다. 새 장을 열어야 할 때 남은 덩어리가 전부 마지막 단에
 * 조금 넘치는 정도로 들어가면 새 장을 열지 않고 거기 싣는다.
 */
export function packDeckColumns(heights: readonly number[], capacity: number, gap: number): DeckColumnSlide[] {
  const slides: DeckColumnSlide[] = [];
  let columns: number[][] = [];
  const flush = (): void => {
    if (columns.length > 0) slides.push({ kind: 'columns', columns });
    columns = [];
  };
  for (let i = 0; i < heights.length; i += 1) {
    if ((heights[i] ?? 0) > capacity + SLACK) {
      flush();
      slides.push({ kind: 'solo', index: i });
      continue;
    }
    const last = columns[columns.length - 1];
    if (last !== undefined && stackHeight([...last, i], heights, gap) <= capacity + SLACK) {
      last.push(i);
      continue;
    }
    if (columns.length >= 2) {
      const rest = Array.from({ length: heights.length - i }, (_, d) => i + d);
      if (last !== undefined && stackHeight([...last, ...rest], heights, gap) <= capacity * DECK_STRETCH) {
        last.push(...rest);
        break;
      }
      flush();
    }
    columns.push([i]);
  }
  flush();

  return slides.map((s): DeckColumnSlide => {
    if (s.kind !== 'columns' || s.columns.length !== 1) return s;
    const only = s.columns[0] ?? [];
    const first = only[0];
    if (first === undefined) return s;
    if (only.length === 1) return { kind: 'solo', index: first };
    // 두 단의 높이 차가 가장 작은 자리에서 가른다.
    let best = 1;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let cut = 1; cut < only.length; cut += 1) {
      const diff = Math.abs(stackHeight(only.slice(0, cut), heights, gap) - stackHeight(only.slice(cut), heights, gap));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cut;
      }
    }
    return { kind: 'columns', columns: [only.slice(0, best), only.slice(best)] };
  });
}

export interface DeckChunkOptions {
  /** 묶음 수를 이 수의 배수로 올린다 — 두 단짜리 표가 한 단만 남기지 않게(2). 덩어리 수보다 많아지지는 않는다. */
  multipleOf?: number;
  /** 첫 묶음 앞에 붙는 높이(머리 덩어리 — 달성도 띠 등). 첫 덩어리와 같은 묶음에 든다. */
  lead?: number;
  /** 마지막 묶음 뒤에 붙는 높이(꼬리 덩어리 — 합계 띠 등). 마지막 덩어리와 같은 묶음에 든다. */
  tail?: number;
  /** 고르게 나누지 않고 앞에서부터 가득 채운다 — 마지막 묶음 뒤에 다른 것을 이어 실을 자리를 남길 때. */
  fill?: boolean;
}

/**
 * 덩어리를 순서대로 묶음(장 또는 단)에 나눈다 — 묶음 수는 가장 적게, 그 수 안에서는 가장 높은 묶음이 가장 낮아지게(고르게).
 * 6문항이 4+2 로 들어가도 3+3 으로 나눈다. 한 묶음보다 큰 덩어리는 혼자 한 묶음(그 장이 글자를 줄여 담는다).
 */
export function balanceDeckChunks(heights: readonly number[], capacity: number, gap: number, options: DeckChunkOptions = {}): number[][] {
  const n = heights.length;
  if (n === 0) return [];
  const limit = capacity + SLACK;
  const lead = options.lead ?? 0;
  const tail = options.tail ?? 0;
  const span = (from: number, to: number): number => {
    let sum = (from === 0 ? lead : 0) + (to === n ? tail : 0);
    for (let i = from; i < to; i += 1) sum += heights[i] ?? 0;
    return sum + Math.max(0, to - from - 1) * gap;
  };
  const fits = (from: number, to: number): boolean => to - from === 1 || span(from, to) <= limit;

  // 묶음 수 — 앞에서부터 들어가는 만큼 채운 수가 최소다.
  const filled: number[][] = [];
  for (let from = 0; from < n; ) {
    let to = from + 1;
    while (to < n && fits(from, to + 1)) to += 1;
    filled.push(Array.from({ length: to - from }, (_, d) => from + d));
    from = to;
  }
  if (options.fill === true) return filled;
  let count = filled.length;
  const multiple = options.multipleOf ?? 1;
  if (multiple > 1) count = Math.min(n, Math.ceil(count / multiple) * multiple);

  // best[k][i] = 앞 i 개를 k 묶음에 나눴을 때 가장 높은 묶음의 최소 높이.
  const best: number[][] = Array.from({ length: count + 1 }, () => Array.from({ length: n + 1 }, () => Number.POSITIVE_INFINITY));
  const cutAt: number[][] = Array.from({ length: count + 1 }, () => Array.from({ length: n + 1 }, () => 0));
  const zero = best[0];
  if (zero !== undefined) zero[0] = 0;
  for (let k = 1; k <= count; k += 1) {
    for (let i = k; i <= n; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        const prev = best[k - 1]?.[j] ?? Number.POSITIVE_INFINITY;
        if (!Number.isFinite(prev) || !fits(j, i)) continue;
        const worst = Math.max(prev, span(j, i));
        const row = best[k];
        const cuts = cutAt[k];
        if (row !== undefined && cuts !== undefined && worst < (row[i] ?? Number.POSITIVE_INFINITY)) {
          row[i] = worst;
          cuts[i] = j;
        }
      }
    }
  }
  const chunks: number[][] = [];
  for (let k = count, i = n; k >= 1; k -= 1) {
    const j = cutAt[k]?.[i] ?? 0;
    chunks.unshift(Array.from({ length: i - j }, (_, d) => j + d));
    i = j;
  }
  return chunks;
}
