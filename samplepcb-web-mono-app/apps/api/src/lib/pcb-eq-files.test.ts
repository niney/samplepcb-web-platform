import { describe, expect, it } from 'vitest';
import { lastPcbEqRejectedAt, orderPcbEqFiles } from '@sp/api-contract';

// EQ 첨부 최신·보완 판정(여정 22호 → 33호 결정) — 관리자 Case·고객확인 패널·협력사 포털이
// 같은 답을 하게 하는 순수 함수. 협력사가 같은 종류를 다시 올려도 이전 파일은 남으므로
// (여러 장 올리는 실무 보존), **어느 것이 최신인지**와 **어느 것이 반려 뒤 보완분인지**를
// 여기서 한 번 정한다.
const f = (fileId: number, fileType: 'eq' | 'working', uploadedAt = '2026-08-11T00:00:00.000Z') => ({
  fileId,
  fileType,
  uploadedAt,
});

/** EQ 이력 한 줄 — 반려는 note 가 있고, 요청 취소는 없다(그것이 유일한 구분점). */
const ev = (at: string, fromStatus: string, toStatus: string, note: string | null = null) => ({
  at,
  fromStatus,
  toStatus,
  note,
});

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
    const out = orderPcbEqFiles([f(7, 'eq')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.isLatest).toBe(true);
  });

  it('빈 목록은 빈 목록', () => {
    expect(orderPcbEqFiles([])).toEqual([]);
  });

  it('입력 배열을 바꾸지 않는다', () => {
    const input = [f(1, 'eq'), f(2, 'eq')];
    orderPcbEqFiles(input);
    expect(input.map((x) => x.fileId)).toEqual([1, 2]);
  });

  // ── 반려 뒤 보완분(afterReject) ────────────────────────────────────────────
  it('반려 이력이 없으면 아무것도 보완분이 아니다', () => {
    const out = orderPcbEqFiles([f(1, 'eq'), f(2, 'working')], null);
    expect(out.some((x) => x.afterReject)).toBe(false);
  });

  it('반려 시각 뒤에 올라온 파일만 보완분이다', () => {
    const out = orderPcbEqFiles(
      [
        f(1, 'eq', '2026-08-10T01:00:00.000Z'), // 반려 전 — 문제가 된 그 도면
        f(2, 'eq', '2026-08-11T05:00:00.000Z'), // 반려 후 — 보완분
      ],
      '2026-08-11T03:00:00.000Z',
    );
    expect(out.find((x) => x.fileId === 1)?.afterReject).toBe(false);
    expect(out.find((x) => x.fileId === 2)?.afterReject).toBe(true);
  });

  // 경계 — 반려와 같은 시각이면 보완분이 아니다(반려 '뒤'에 올라온 것만 보완이다).
  it('반려와 같은 시각은 보완분이 아니다', () => {
    const at = '2026-08-11T03:00:00.000Z';
    expect(orderPcbEqFiles([f(1, 'eq', at)], at)[0]?.afterReject).toBe(false);
  });
});

describe('lastPcbEqRejectedAt', () => {
  it('반려가 없으면 null', () => {
    expect(lastPcbEqRejectedAt([])).toBeNull();
    expect(
      lastPcbEqRejectedAt([ev('2026-08-11T01:00:00.000Z', 'issued', 'eq_requested')]),
    ).toBeNull();
  });

  // 이 편의 핵심 — 반려와 '요청 취소'는 **같은 전이**(eq_requested → issued)라 상태로는
  // 갈리지 않는다. 사유(note)를 남기는 쪽만 반려다.
  it('요청 취소(사유 없음)는 반려가 아니다', () => {
    expect(
      lastPcbEqRejectedAt([
        ev('2026-08-11T01:00:00.000Z', 'issued', 'eq_requested'),
        ev('2026-08-11T02:00:00.000Z', 'eq_requested', 'issued'), // 협력사가 스스로 취소
      ]),
    ).toBeNull();
  });

  it('사유가 붙은 되돌림이 반려다', () => {
    expect(
      lastPcbEqRejectedAt([
        ev('2026-08-11T01:00:00.000Z', 'issued', 'eq_requested'),
        ev('2026-08-11T02:00:00.000Z', 'eq_requested', 'issued', '홀 지름이 규격 밖입니다'),
      ]),
    ).toBe('2026-08-11T02:00:00.000Z');
  });

  it('여러 번 반려됐으면 가장 최근 것', () => {
    expect(
      lastPcbEqRejectedAt([
        ev('2026-08-10T02:00:00.000Z', 'eq_requested', 'issued', '1차 반려'),
        ev('2026-08-10T03:00:00.000Z', 'issued', 'eq_requested'),
        ev('2026-08-11T02:00:00.000Z', 'eq_requested', 'issued', '2차 반려'),
      ]),
    ).toBe('2026-08-11T02:00:00.000Z');
  });

  // 이관·구데이터는 at 이 비어 있을 수 있다 — 비교 기준이 못 되므로 건너뛴다.
  it('시각이 비면 근거로 삼지 않는다', () => {
    expect(lastPcbEqRejectedAt([ev('', 'eq_requested', 'issued', '사유')])).toBeNull();
  });
});
