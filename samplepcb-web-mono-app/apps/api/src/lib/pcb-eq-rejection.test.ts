import { describe, expect, it } from 'vitest';
import {
  PCB_EQ_REVERT_NOTE,
  buildPcbEqTimeline,
  isPcbEqRejectionEvent,
  lastPcbEqRejectedAt,
  lastPcbEqRejection,
} from '@sp/api-contract';

// ── 반려 판정 — 2026-08-16 교정 회귀 ─────────────────────────────────────────
//
// 반려와 '요청 취소'는 **같은 전이**(eq_requested → issued)라 사유(note)로만 갈린다.
// 그런데 `revertPcbPoEq` 가 되돌리기마다 note 에 '되돌리기' 를 넣고 있어서, 협력사가
// 자기 EQ 요청을 취소하면 넷이 동시에 거짓말을 했다:
//   ① 포털이 "반려된 건입니다 — 보완 파일을 올리고 다시 승인요청해 주세요"
//   ② 관리자 워크큐의 rejectedAt(= '반려 뒤 보완 대기' 배지)
//   ③ Case 상세의 '반려 후 새 파일 없음' 경고
//   ④ 타임라인이 회차를 닫아 '2차 요청' 을 열었다
// 반대로 화면의 '요청 취소' 분기는 한 번도 도달할 수 없는 죽은 코드였다.
//
// 이 편이 박제하는 것: **사유 없는 되돌리기는 반려가 아니다**(옛 이력의 '되돌리기'
// 표식까지 포함), 그리고 **판정은 한 곳뿐이다**.

const ev = (at: string, from: string, to: string, note: string | null = null) => ({
  at,
  byRole: 'PARTNER',
  fromStatus: from,
  toStatus: to,
  note,
});

const REQUEST = ev('2026-08-16T01:00:00.000Z', 'issued', 'eq_requested');
const CANCEL = ev('2026-08-16T02:00:00.000Z', 'eq_requested', 'issued');
const LEGACY_CANCEL = ev('2026-08-16T02:00:00.000Z', 'eq_requested', 'issued', PCB_EQ_REVERT_NOTE);
const REJECT = ev('2026-08-16T03:00:00.000Z', 'eq_requested', 'issued', '실크 위치를 옮겨 주세요');

describe('isPcbEqRejectionEvent', () => {
  it('사유가 있는 승인요청→발주접수만 반려다', () => {
    expect(isPcbEqRejectionEvent(REJECT)).toBe(true);
  });

  it('사유 없는 되돌리기(요청 취소)는 반려가 아니다', () => {
    expect(isPcbEqRejectionEvent(CANCEL)).toBe(false);
    expect(isPcbEqRejectionEvent({ ...CANCEL, note: '' })).toBe(false);
  });

  it("옛 이력의 '되돌리기' 표식도 반려가 아니다 — 교정 전에 쌓인 행이 남아 있다", () => {
    expect(isPcbEqRejectionEvent(LEGACY_CANCEL)).toBe(false);
  });

  it('다른 전이는 사유가 있어도 반려가 아니다', () => {
    expect(isPcbEqRejectionEvent(ev('t', 'eq_done', 'eq_requested', '승인 취소함'))).toBe(false);
    expect(isPcbEqRejectionEvent(ev('t', 'issued', 'eq_requested', '고객문의사항'))).toBe(false);
  });
});

describe('lastPcbEqRejection', () => {
  it('요청 취소만 있으면 반려 이력이 없다', () => {
    expect(lastPcbEqRejection([REQUEST, CANCEL])).toBeNull();
    expect(lastPcbEqRejectedAt([REQUEST, LEGACY_CANCEL])).toBeNull();
  });

  it('반려는 시각과 사유를 그대로 돌려준다(관리자가 뭐라 썼는지 화면이 보여야 한다)', () => {
    expect(lastPcbEqRejection([REQUEST, REJECT])).toEqual({
      at: REJECT.at,
      note: '실크 위치를 옮겨 주세요',
    });
  });

  it('취소가 반려보다 나중이어도 마지막 **반려**를 집는다', () => {
    const history = [REQUEST, REJECT, ev('2026-08-16T04:00:00.000Z', 'issued', 'eq_requested'), CANCEL];
    expect(lastPcbEqRejectedAt(history)).toBe(REJECT.at);
  });

  it('스텐실의 고객문의사항(issued→eq_requested 의 note)은 반려로 안 읽힌다', () => {
    const submit = ev('2026-08-16T01:00:00.000Z', 'issued', 'eq_requested', '앞면만 도포합니다');
    expect(lastPcbEqRejectedAt([submit])).toBeNull();
  });
});

describe('buildPcbEqTimeline — 회차 분할', () => {
  it('반려가 회차를 닫는다', () => {
    const rounds = buildPcbEqTimeline([REQUEST, REJECT], []);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.closedByNote).toBe('실크 위치를 옮겨 주세요');
  });

  it('요청 취소는 회차를 닫지 않는다 — 같은 회차를 잠깐 물렸다 다시 올리는 것이다', () => {
    expect(buildPcbEqTimeline([REQUEST, CANCEL], [])).toHaveLength(1);
    expect(buildPcbEqTimeline([REQUEST, LEGACY_CANCEL], [])).toHaveLength(1);
  });
});
