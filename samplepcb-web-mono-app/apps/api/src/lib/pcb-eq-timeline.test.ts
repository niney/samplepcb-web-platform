import { describe, expect, it } from 'vitest';
import { buildPcbEqTimeline } from '@sp/api-contract';

// EQ 타임라인 조립 — 협력사 포털이 "무슨 일이 있었고 지금 무엇을 해야 하는지"를 한 축으로
// 읽게 하는 순수 함수. 명세는 넷이다:
//   ① 시간 순으로 섞인다(이력과 첨부가 각자 자리에)
//   ② 연속된 같은 주체의 업로드는 한 묶음
//   ③ 반려가 회차를 닫는다(요청 취소는 안 닫는다 — note 로 갈린다)
//   ④ 같은 시각은 안정 정렬(실행마다 앞뒤가 뒤집히면 안 된다)

const ev = (at: string, byRole: string, from: string, to: string, note: string | null = null) => ({
  at,
  byRole,
  fromStatus: from,
  toStatus: to,
  note,
});
const file = (fileId: number, uploadedAt: string, uploadedBy: string) => ({
  fileId,
  uploadedAt,
  uploadedBy,
});

describe('buildPcbEqTimeline', () => {
  it('이력과 첨부가 한 시간축에 섞인다', () => {
    const rounds = buildPcbEqTimeline(
      [ev('2026-08-11T05:20:00.000Z', 'PARTNER', 'issued', 'eq_requested')],
      [file(1, '2026-08-11T05:10:00.000Z', 'PARTNER')],
    );
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.items.map((i) => i.kind)).toEqual(['files', 'event']);
  });

  it('연속된 같은 주체의 업로드는 한 묶음으로 접힌다', () => {
    const rounds = buildPcbEqTimeline(
      [],
      [
        file(1, '2026-08-11T05:10:00.000Z', 'PARTNER'),
        file(2, '2026-08-11T05:11:00.000Z', 'PARTNER'),
        file(3, '2026-08-11T05:12:00.000Z', 'PARTNER'),
      ],
    );
    expect(rounds[0]?.items).toHaveLength(1);
    expect(rounds[0]?.items[0]?.files).toHaveLength(3);
  });

  it('주체가 바뀌면 말풍선이 갈린다 — 내가 올린 것과 받은 것은 다른 말이다', () => {
    const rounds = buildPcbEqTimeline(
      [],
      [
        file(1, '2026-08-11T05:10:00.000Z', 'PARTNER'),
        file(2, '2026-08-12T00:00:00.000Z', 'ADMIN'),
      ],
    );
    expect(rounds[0]?.items).toHaveLength(2);
    expect(rounds[0]?.items.map((i) => i.byRole)).toEqual(['PARTNER', 'ADMIN']);
  });

  it('반려가 회차를 닫고 다음 회차가 열린다', () => {
    const rounds = buildPcbEqTimeline(
      [
        ev('2026-08-11T05:20:00.000Z', 'PARTNER', 'issued', 'eq_requested'),
        ev('2026-08-12T00:05:00.000Z', 'ADMIN', 'eq_requested', 'issued', '실크 위치를 옮겨 주세요'),
        ev('2026-08-13T01:00:00.000Z', 'PARTNER', 'issued', 'eq_requested'),
      ],
      [file(9, '2026-08-12T23:00:00.000Z', 'PARTNER')],
    );
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.closedByNote).toBe('실크 위치를 옮겨 주세요');
    expect(rounds[1]?.closedByNote).toBeNull();
    // 보완 파일과 재요청은 2회차에 들어간다.
    expect(rounds[1]?.items.map((i) => i.kind)).toEqual(['files', 'event']);
  });

  it('요청 취소는 회차를 닫지 않는다 — 반려와 같은 전이지만 사유가 없다', () => {
    const rounds = buildPcbEqTimeline(
      [
        ev('2026-08-11T05:20:00.000Z', 'PARTNER', 'issued', 'eq_requested'),
        ev('2026-08-11T06:00:00.000Z', 'PARTNER', 'eq_requested', 'issued'), // 취소(note 없음)
      ],
      [],
    );
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.closedByNote).toBeNull();
  });

  it('반려 직후에는 빈 회차가 남는다 — 그 빈 자리가 "지금 당신 차례"다', () => {
    const rounds = buildPcbEqTimeline(
      [
        ev('2026-08-11T05:20:00.000Z', 'PARTNER', 'issued', 'eq_requested'),
        ev('2026-08-12T00:05:00.000Z', 'ADMIN', 'eq_requested', 'issued', '수정 요망'),
      ],
      [],
    );
    expect(rounds).toHaveLength(2);
    expect(rounds[1]?.items).toEqual([]);
  });

  it('같은 시각이어도 순서가 흔들리지 않는다(안정 정렬)', () => {
    const at = '2026-08-11T05:00:00.000Z';
    const twice = () =>
      buildPcbEqTimeline(
        [ev(at, 'PARTNER', 'issued', 'eq_requested')],
        [file(2, at, 'PARTNER'), file(1, at, 'PARTNER')],
      );
    const a = JSON.stringify(twice());
    const b = JSON.stringify(twice());
    expect(a).toBe(b);
    // 파일은 fileId 오름차순으로 안정화된다.
    expect(twice()[0]?.items[0]?.files?.map((f) => f.fileId)).toEqual([1, 2]);
  });

  it('아무것도 없으면 빈 1회차 하나', () => {
    const rounds = buildPcbEqTimeline([], []);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.items).toEqual([]);
  });
});
