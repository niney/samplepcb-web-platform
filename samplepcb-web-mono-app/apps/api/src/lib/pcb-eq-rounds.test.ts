import { describe, expect, it } from 'vitest';
import { summarizePcbEqRounds } from '@sp/api-contract';

// EQ 요청 회차 요약 — 관리자 Case 의 'EQ 줄'(회차 칩 1차·2차·3차)이 회차마다 보여 주는 것.
// 회차 번호는 포털 타임라인(buildPcbEqTimeline)과 같은 수다 — 관리자와 협력사가 같은 번호로 말한다.
const f = (fileId: number, fileType: string, uploadedAt: string, uploadedBy = 'PARTNER') => ({
  fileId,
  fileType,
  uploadedAt,
  uploadedBy,
});
const ev = (at: string, byRole: string, fromStatus: string, toStatus: string, note: string | null = null) => ({
  at,
  byRole,
  fromStatus,
  toStatus,
  note,
});
const T = (n: number): string => `2026-10-11T00:${String(n).padStart(2, '0')}:00.000Z`;

describe('summarizePcbEqRounds', () => {
  it('이력이 없으면 열린 회차 하나 — 올라온 파일만 있다', () => {
    const [r, ...rest] = summarizePcbEqRounds([], [f(1, 'eq', T(1))]);
    expect(rest).toEqual([]);
    expect(r).toMatchObject({ index: 1, outcome: 'open', requestedAt: null, startAt: null, endAt: null });
    expect(r?.files.map((x) => x.fileId)).toEqual([1]);
  });

  it('반려 → 승인 → 추가 EQ 요청 — 회차가 닫힐 때마다 다음 회차가 열리고, 파일은 올린 회차에 남는다', () => {
    const rounds = summarizePcbEqRounds(
      [
        ev(T(2), 'PARTNER', 'issued', 'eq_requested'),
        ev(T(4), 'ADMIN', 'eq_requested', 'issued', '도면 번호가 다릅니다'),
        ev(T(6), 'PARTNER', 'issued', 'eq_requested'),
        ev(T(7), 'ADMIN', 'eq_requested', 'eq_done'),
        ev(T(8), 'PARTNER', 'eq_done', 'issued', '적층을 다시 확인해야 합니다'),
      ],
      [f(1, 'eq', T(1)), f(2, 'reply', T(3), 'ADMIN'), f(3, 'eq', T(5)), f(4, 'eq', T(9))],
    );
    expect(rounds.map((r) => [r.index, r.outcome])).toEqual([
      [1, 'rejected'],
      [2, 'reopened'],
      [3, 'open'],
    ]);
    const [r1, r2, r3] = rounds;
    // 1차 — 반려로 닫혔다. 관리자 회신 첨부는 반려한 그 회차의 것이다.
    expect(r1).toMatchObject({ requestedAt: T(2), requestedBy: 'PARTNER', closedAt: T(4), closedBy: 'ADMIN', closedNote: '도면 번호가 다릅니다', approvedAt: null });
    expect(r1?.files.map((x) => x.fileId)).toEqual([1]);
    expect(r1?.replyFiles.map((x) => x.fileId)).toEqual([2]);
    // 2차 — 승인된 뒤 협력사가 다시 열었다. 승인 시각은 남는다(무엇이 승인됐었는지의 근거).
    expect(r2).toMatchObject({ requestedAt: T(6), approvedAt: T(7), closedAt: T(8), closedBy: 'PARTNER', closedNote: '적층을 다시 확인해야 합니다' });
    expect(r2?.files.map((x) => x.fileId)).toEqual([3]);
    // 3차 — 돌아온 뒤 새로 올린 파일만.
    expect(r3).toMatchObject({ requestedAt: null, closedAt: null });
    expect(r3?.files.map((x) => x.fileId)).toEqual([4]);
    // 시간 창 — 고객 확인 회차를 어느 요청 회차에 붙일지의 기준. 이어 붙어야 한다.
    expect(rounds.map((r) => [r.startAt, r.endAt])).toEqual([
      [null, T(4)],
      [T(4), T(8)],
      [T(8), null],
    ]);
  });

  it('요청 취소는 회차를 닫지 않는다 — 요청 시각만 지워지고 같은 회차가 이어진다', () => {
    const rounds = summarizePcbEqRounds(
      [ev(T(1), 'PARTNER', 'issued', 'eq_requested'), ev(T(2), 'PARTNER', 'eq_requested', 'issued')],
      [],
    );
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ outcome: 'open', requestedAt: null, requestedBy: null });
    // 레거시 '되돌리기' 표식(note)도 사유가 아니다 — 반려로 읽지 않는다(isPcbEqRejectionEvent 하나로 판정).
    const legacy = summarizePcbEqRounds(
      [ev(T(1), 'PARTNER', 'issued', 'eq_requested'), ev(T(2), 'ADMIN', 'eq_requested', 'issued', '되돌리기')],
      [],
    );
    expect(legacy.map((r) => r.outcome)).toEqual(['open']);
  });

  it('승인 취소는 승인 대기로 되돌린다 — 승인 시각이 지워진다', () => {
    const [r] = summarizePcbEqRounds(
      [
        ev(T(1), 'PARTNER', 'issued', 'eq_requested'),
        ev(T(2), 'ADMIN', 'eq_requested', 'eq_done'),
        ev(T(3), 'ADMIN', 'eq_done', 'eq_requested'),
      ],
      [],
    );
    expect(r).toMatchObject({ outcome: 'requested', approvedAt: null, requestedAt: T(1) });
  });

  it('생산 전이는 EQ 의 결말을 바꾸지 않는다', () => {
    const [r] = summarizePcbEqRounds(
      [
        ev(T(1), 'ADMIN', 'issued', 'eq_requested'),
        ev(T(2), 'ADMIN', 'eq_requested', 'eq_done'),
        ev(T(3), 'PARTNER', 'eq_done', 'producing'),
        ev(T(4), 'PARTNER', 'producing', 'produced'),
      ],
      [],
    );
    // 요청 주체는 그대로 실린다 — 관리자 대행으로 올린 요청이면 화면이 '관리자 대행'이라 말한다.
    expect(r).toMatchObject({ outcome: 'approved', approvedAt: T(2), requestedBy: 'ADMIN' });
  });

  it('같은 회차에서 같은 종류를 다시 올리면 앞의 것이 밀린다 — 종류가 다르면 밀지 않고, 문의 사진은 누적이다', () => {
    const [r] = summarizePcbEqRounds(
      [],
      [
        f(1, 'eq', T(1)),
        f(2, 'working', T(2)),
        f(3, 'eq', T(3)),
        f(4, 'inquiry', T(4)),
        f(5, 'inquiry', T(5)),
      ],
    );
    expect(r?.supersededFileIds).toEqual([1]);
  });

  it('밀림은 회차 안에서만 센다 — 지난 회차의 파일은 그 회차에서는 최신이었다', () => {
    const rounds = summarizePcbEqRounds(
      [ev(T(2), 'PARTNER', 'issued', 'eq_requested'), ev(T(3), 'ADMIN', 'eq_requested', 'issued', '보완')],
      [f(1, 'eq', T(1)), f(2, 'eq', T(4))],
    );
    expect(rounds.map((r) => r.supersededFileIds)).toEqual([[], []]);
  });

  it('스텐실 — 확인 요청에 실린 고객문의사항이 요청 글로 남는다', () => {
    const [r] = summarizePcbEqRounds([ev(T(1), 'PARTNER', 'issued', 'eq_requested', '개구부를 10% 줄여도 될까요?')], []);
    expect(r).toMatchObject({ outcome: 'requested', requestNote: '개구부를 10% 줄여도 될까요?' });
  });
});
