import { describe, expect, it } from 'vitest';
import { orderPcbEqFiles } from '@sp/api-contract';

// EQ 첨부 최신 판정(여정 22호) — 관리자 Case·고객확인 패널·협력사 포털이 같은 답을 하게
// 하는 순수 함수. 협력사가 같은 종류를 다시 올려도 이전 파일은 남으므로(여러 장 올리는
// 실무 보존), **어느 것이 최신인지**를 여기서 한 번 정한다.
const f = (fileId: number, fileType: 'eq' | 'working') => ({ fileId, fileType });

describe('orderPcbEqFiles', () => {
  it('종류별로 가장 나중에 올라온 1건이 최신이다', () => {
    const out = orderPcbEqFiles([f(1, 'eq'), f(2, 'eq'), f(3, 'working')]);
    expect(out.find((x) => x.fileId === 2)?.isLatest).toBe(true);
    expect(out.find((x) => x.fileId === 1)?.isLatest).toBe(false);
    // 종류가 다르면 서로의 최신을 밀어내지 않는다 — eq 를 새로 올려도 working 은 그대로다.
    expect(out.find((x) => x.fileId === 3)?.isLatest).toBe(true);
  });

  // 이 정렬이 이 함수의 존재 이유다. 업로드 순(id asc)으로 늘어놓으면 관리자가 누르는
  // **맨 앞 버튼이 가장 오래된 도면**이 된다 — EQ 는 생산의 근거 서류라 그대로 만들어진다.
  it('최신이 앞에 선다 — 옛 도면이 첫 버튼이 되지 않게', () => {
    const out = orderPcbEqFiles([f(1, 'eq'), f(2, 'eq'), f(3, 'eq')]);
    expect(out.map((x) => x.fileId)).toEqual([3, 2, 1]);
  });

  it('최신끼리는 종류 순(eq → working), 이전 것들은 최근 순', () => {
    const out = orderPcbEqFiles([f(1, 'working'), f(2, 'eq'), f(5, 'working'), f(9, 'eq')]);
    expect(out.map((x) => x.fileId)).toEqual([9, 5, 2, 1]);
    expect(out.map((x) => x.isLatest)).toEqual([true, true, false, false]);
  });

  // ⚠ writeDate 가 아니라 fileId 로 정한다 — 같은 초에 두 건이 들어오면 시각은 갈리지 않는다.
  it('한 건뿐이면 그것이 최신이다', () => {
    expect(orderPcbEqFiles([f(7, 'eq')])).toEqual([
      { fileId: 7, fileType: 'eq', isLatest: true },
    ]);
  });

  it('빈 목록은 빈 목록', () => {
    expect(orderPcbEqFiles([])).toEqual([]);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [f(1, 'eq'), f(2, 'eq')];
    orderPcbEqFiles(input);
    expect(input.map((x) => x.fileId)).toEqual([1, 2]);
  });
});
