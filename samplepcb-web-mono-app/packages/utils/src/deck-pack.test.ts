import { describe, expect, it } from 'vitest';
import { balanceDeckChunks, packDeckColumns } from './deck-pack';

// 명세는 "한 장에 딱 담기게, 넘치면 덩어리 단위로, 마지막에 하나만 남지 않게"다.
// 숫자는 실제 판 크기에서 왔다 — 본문 높이 514, 분야 덩어리 사이 30(로컬 의뢰 257 실측이 첫 두 사례).
describe('packDeckColumns', () => {
  const CAP = 514;
  const GAP = 30;

  it('덩어리를 순서대로 두 단에 쌓고, 단이 차면 다음 단 · 다음 장으로 넘긴다', () => {
    expect(packDeckColumns([450, 420, 460, 230, 190], CAP, GAP)).toEqual([
      { kind: 'columns', columns: [[0], [1]] },
      { kind: 'columns', columns: [[2], [3, 4]] },
    ]);
  });

  it('남은 덩어리가 마지막 단에 조금 넘치는 정도면 새 장을 열지 않는다(거의 빈 장을 만들지 않는다)', () => {
    // 230 + 190 + 60 + 사이 60 = 540 — 514 의 8% 안쪽
    expect(packDeckColumns([450, 420, 460, 230, 190, 60], CAP, GAP)).toEqual([
      { kind: 'columns', columns: [[0], [1]] },
      { kind: 'columns', columns: [[2], [3, 4, 5]] },
    ]);
  });

  it('많이 넘치면 새 장을 연다 — 혼자 남은 덩어리는 혼자 한 장', () => {
    expect(packDeckColumns([450, 420, 460, 230, 190, 200], CAP, GAP)).toEqual([
      { kind: 'columns', columns: [[0], [1]] },
      { kind: 'columns', columns: [[2], [3, 4]] },
      { kind: 'solo', index: 5 },
    ]);
  });

  it('한 단보다 큰 덩어리는 혼자 한 장을 쓰고, 앞뒤 덩어리는 따로 쌓인다', () => {
    expect(packDeckColumns([200, 700, 200, 250], CAP, GAP)).toEqual([
      { kind: 'solo', index: 0 },
      { kind: 'solo', index: 1 },
      { kind: 'columns', columns: [[2], [3]] },
    ]);
  });

  it('한 단에 다 들어가는 덩어리 여럿은 두 단으로 고르게 가른다(반쪽만 찬 장을 남기지 않는다)', () => {
    expect(packDeckColumns([100, 120, 90, 110], CAP, GAP)).toEqual([{ kind: 'columns', columns: [[0, 1], [2, 3]] }]);
  });

  it('덩어리가 없으면 장도 없다', () => {
    expect(packDeckColumns([], CAP, GAP)).toEqual([]);
  });
});

describe('balanceDeckChunks', () => {
  it('묶음 수는 최소로, 그 안에서는 고르게 — 4+2 가 아니라 3+3', () => {
    // 앞에서부터 채우면 넷이 들어가지만(4×150+3×22=666 ≤ 680) 둘만 남는다
    expect(balanceDeckChunks([150, 150, 150, 150, 150, 150], 680, 22)).toEqual([[0, 1, 2], [3, 4, 5]]);
  });

  it('한 묶음에 다 들어가면 나누지 않는다', () => {
    expect(balanceDeckChunks([100, 100, 100], 480, 22)).toEqual([[0, 1, 2]]);
  });

  it('한 묶음보다 큰 덩어리는 혼자 한 묶음이다', () => {
    expect(balanceDeckChunks([100, 900, 100], 480, 0)).toEqual([[0], [1], [2]]);
  });

  it('multipleOf — 두 단짜리 표가 한 단만 남기지 않게 묶음 수를 짝수로 올린다', () => {
    const heights = Array.from({ length: 9 }, () => 100);
    // 400 높이에 넷씩 → 세 묶음(4+4+1 → 3+3+3)인데, 짝수로 올려 네 묶음
    expect(balanceDeckChunks(heights, 400, 0).map((c) => c.length)).toEqual([3, 3, 3]);
    expect(balanceDeckChunks(heights, 400, 0, { multipleOf: 2 }).map((c) => c.length).sort()).toEqual([2, 2, 2, 3]);
    // 덩어리 수보다 많아지지는 않는다
    expect(balanceDeckChunks([100], 400, 0, { multipleOf: 2 })).toEqual([[0]]);
  });

  it('머리 · 꼬리 덩어리는 첫 묶음 · 마지막 묶음의 높이로 셈한다', () => {
    const heights = [100, 100, 100, 100];
    expect(balanceDeckChunks(heights, 400, 0)).toEqual([[0, 1, 2, 3]]);
    // 머리 150 이 붙으면 넷이 한 묶음에 못 든다(550). 가장 높은 묶음이 낮은 쪽 — 250 | 300 (350 | 200 이 아니라)
    expect(balanceDeckChunks(heights, 400, 0, { lead: 150 })).toEqual([[0], [1, 2, 3]]);
    // 꼬리도 같다 — 300 | 250
    expect(balanceDeckChunks(heights, 400, 0, { tail: 150 })).toEqual([[0, 1, 2], [3]]);
  });

  it('fill — 고르게 나누지 않고 앞에서부터 가득 채운다(마지막 묶음에 자리를 남긴다)', () => {
    const heights = Array.from({ length: 8 }, () => 56);
    // 머리 148 이 붙은 첫 장에 여섯(148+336=484), 나머지 둘 — 고르게 나누면 3 | 5
    expect(balanceDeckChunks(heights, 490, 0, { lead: 148 }).map((c) => c.length)).toEqual([3, 5]);
    expect(balanceDeckChunks(heights, 490, 0, { lead: 148, fill: true }).map((c) => c.length)).toEqual([6, 2]);
  });

  it('덩어리가 없으면 묶음도 없다', () => {
    expect(balanceDeckChunks([], 400, 0)).toEqual([]);
  });
});
