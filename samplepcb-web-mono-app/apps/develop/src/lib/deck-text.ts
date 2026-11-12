// 의뢰 출력물(16:9 장) 긴 글 나누기 — 의뢰 내용(2만 자까지) · 담당자 의견(4천 자까지)은 한 장에 안 들 수 있어
// 줄 경계에서 잘라 단(한 장 = 두 단)에 차례로 흘린다. 실제 폭 · 글꼴로 그린 숨은 문단(host)에 글을 넣고 Range 로 줄 위치를 잰다.
// host 의 글은 끝나면 되돌려 둔다(Vue 가 그린 노드라 다음 갱신 때 값이 맞아야 한다).

/** host 높이 capacity 에 드는 만큼씩 글을 잘라 돌려준다(앞에서부터, 줄 경계에서). 다 들어가면 한 조각. */
export function splitTextToFit(host: HTMLElement, text: string, capacity: number): string[] {
  const original = host.textContent;
  const range = document.createRange();
  const chunks: string[] = [];
  let rest = text;
  try {
    while (rest !== '') {
      host.textContent = rest;
      const node = host.firstChild;
      const top = host.getBoundingClientRect().top;
      if (!(node instanceof Text) || host.getBoundingClientRect().height <= capacity + 0.5) {
        chunks.push(rest);
        break;
      }
      // [0, n) 글자의 마지막 줄 아래 — n 이 늘면 줄지 않는다.
      const bottomOf = (n: number): number => {
        range.setStart(node, 0);
        range.setEnd(node, n);
        let bottom = Number.NEGATIVE_INFINITY;
        for (const rect of range.getClientRects()) if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
        return bottom - top;
      };
      // 이 단에 드는 가장 긴 앞부분 — 그다음 글자는 넘치는 줄의 첫 글자다.
      let lo = 1;
      let hi = rest.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (bottomOf(mid) <= capacity + 0.5) lo = mid;
        else hi = mid - 1;
      }
      chunks.push(rest.slice(0, lo).replace(/\s+$/, ''));
      rest = rest.slice(lo).replace(/^\s+/, '');
    }
  } finally {
    host.textContent = original;
  }
  return chunks.filter((c) => c !== '');
}
