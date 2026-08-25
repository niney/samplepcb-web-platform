import { describe, expect, it } from 'vitest';
import {
  pcbProgressLabel,
  pcbProgressShortLabel,
  progressTargetCtIds,
  resolvePcbProgressStage,
  slowestPcbProgress,
} from './pcb-customer-progress';

// 고객 진행 단계 판정(P4.13) — 발주 상태·발송 신호의 조합 전수.

describe('resolvePcbProgressStage', () => {
  it('확인 구간은 세 칸으로 갈린다 — issued/eq_requested/eq_done 이 한 문구로 뭉치지 않는다(08-25 교정)', () => {
    expect(resolvePcbProgressStage('issued', null)).toBe('eq_pending');
    expect(resolvePcbProgressStage('eq_requested', null)).toBe('eq');
    expect(resolvePcbProgressStage('eq_done', null)).toBe('eq_done');
  });

  it('모르는 발주 상태는 가장 이른 칸으로 접는다', () => {
    expect(resolvePcbProgressStage('???', null)).toBe('eq_pending');
  });

  it('producing 은 생산 중', () => {
    expect(resolvePcbProgressStage('producing', null)).toBe('producing');
  });

  it('produced 는 발송 신호에 따라 갈린다 — 없음/preparing→준비, 진행→운송, 입고확인→입고', () => {
    expect(resolvePcbProgressStage('produced', null)).toBe('produced');
    expect(resolvePcbProgressStage('produced', { status: 'preparing', receivedAt: null })).toBe(
      'produced',
    );
    expect(resolvePcbProgressStage('produced', { status: 'shipped', receivedAt: null })).toBe(
      'shipping',
    );
    // 입고확인(receivedAt)은 상태보다 우선 — 국내 3단계는 receive 가 종점을 닫는다(P4.10).
    expect(
      resolvePcbProgressStage('produced', { status: 'delivered', receivedAt: new Date() }),
    ).toBe('received');
  });

  it('선적요청(requested)은 아직 발송 준비 중 — 운송(shipping)은 shipped 부터다', () => {
    expect(resolvePcbProgressStage('produced', { status: 'requested', receivedAt: null })).toBe(
      'produced',
    );
    // 국내 발송 시작(shipping)은 실물이 움직였다 — 운송 취급 그대로.
    expect(resolvePcbProgressStage('produced', { status: 'shipping', receivedAt: null })).toBe(
      'shipping',
    );
  });
});

describe('progressTargetCtIds', () => {
  it('취소류(취소·반품·품절) 줄은 카드 대상에서 빠진다 — 부분 취소는 od 가 활성이라 여기서만 걸린다', () => {
    expect(
      progressTargetCtIds([
        { ctId: 1, ctStatus: '입금' },
        { ctId: 2, ctStatus: '취소' },
        { ctId: 3, ctStatus: '반품' },
        { ctId: 4, ctStatus: '품절' },
        { ctId: 5, ctStatus: '배송' },
      ]),
    ).toEqual([1, 5]);
  });

  it('전량 취소면 남는 대상이 없다(라우트의 od 단위 접힘과 같은 결과)', () => {
    expect(progressTargetCtIds([{ ctId: 1, ctStatus: '취소' }])).toEqual([]);
    expect(progressTargetCtIds([])).toEqual([]);
  });
});

describe('pcbProgressLabel', () => {
  it('확인 구간 세 문구 — 준비/진행/완료가 서로 다르다', () => {
    expect(pcbProgressLabel('eq_pending', 0)).toBe('제조 확인(EQ) 준비 중');
    expect(pcbProgressLabel('eq', 0)).toBe('제조 확인(EQ) 진행 중');
    expect(pcbProgressLabel('eq_done', 0)).toBe('제조 확인 완료 — 생산 준비 중');
    // 스텐실은 EQ 라는 말 대신 '제작 전 확인'.
    expect(pcbProgressLabel('eq_pending', 0, false, 'stencil')).toBe('제작 전 확인 준비 중');
    expect(pcbProgressLabel('eq', 0, false, 'stencil')).toBe('제작 전 확인 중');
    expect(pcbProgressLabel('eq_done', 0, false, 'stencil')).toBe('확인 완료 — 생산 준비 중');
  });

  it('회차>0 이면 A/S 재생산 접두가 붙는다', () => {
    expect(pcbProgressLabel('producing', 0)).toBe('생산 진행 중');
    expect(pcbProgressLabel('producing', 1)).toBe('A/S 재생산 — 생산 진행 중');
  });

  it('직송이면 운송·도착 어휘가 직송으로 바뀐다 — 자사 입고 어휘는 거짓말이 된다', () => {
    expect(pcbProgressLabel('shipping', 0, true)).toBe('주문지로 직송 배송 중');
    expect(pcbProgressLabel('received', 0, true)).toBe('직송 배송 완료');
    // 직송이어도 운송 전 단계 라벨은 그대로다(치환은 두 단계만).
    expect(pcbProgressLabel('produced', 0, true)).toBe('생산 완료 — 발송 준비 중');
    // 회차 접두와도 겹친다.
    expect(pcbProgressLabel('shipping', 2, true)).toBe('A/S 재생산 — 주문지로 직송 배송 중');
    // 직송 아님(기본값) — 기존 어휘 유지.
    expect(pcbProgressLabel('shipping', 0)).toBe('입고 운송 중');
    expect(pcbProgressLabel('received', 0, false)).toBe('입고 완료 — 배송 준비 중');
  });
});

describe('pcbProgressShortLabel', () => {
  it('배지용 짧은 문구 — 같은 축(직송·스텐실·회차)을 따른다', () => {
    expect(pcbProgressShortLabel('eq', 0)).toBe('제조 확인 중');
    expect(pcbProgressShortLabel('eq', 0, false, 'stencil')).toBe('제작 전 확인');
    expect(pcbProgressShortLabel('received', 0)).toBe('입고 완료');
    expect(pcbProgressShortLabel('received', 0, true)).toBe('직송 완료');
    expect(pcbProgressShortLabel('producing', 1)).toBe('A/S 생산 중');
  });
});

describe('slowestPcbProgress', () => {
  it('주문 배지는 가장 느린 줄을 따른다 — 한 줄이 입고돼도 다른 줄이 EQ 면 아직 EQ 다', () => {
    const picked = slowestPcbProgress([
      { stage: 'received' as const, id: 'a' },
      { stage: 'eq' as const, id: 'b' },
      { stage: 'producing' as const, id: 'c' },
    ]);
    expect(picked?.id).toBe('b');
    expect(slowestPcbProgress([])).toBeNull();
  });
});
