import { describe, expect, it } from 'vitest';
import {
  PCB_PO_STATUS_LABELS,
  canEditPcbEqFile,
  lastPcbStencilInquiry,
  orderPcbEqFiles,
  pcbEqEventLabel,
  pcbEqForwardLabel,
  pcbEqRejectActionLabel,
  pcbEqRevertLabel,
  pcbStencilSubmitBlockers,
  resolvePcbPoTrack,
} from '@sp/api-contract';
import { customerCoordFileName, pcbProgressLabel } from './pcb-customer-progress';

// ── 스텐실(메탈마스크) 트랙 — 2026-08-16 ─────────────────────────────────────
// 메탈마스크에는 EQ 왕복이 없고 **고객문의사항 + 좌표파일**이 그 자리를 대신한다.
// status 5단계는 그대로이므로, 이 편이 지키는 것은 딱 둘이다: 갈리는 것만 갈리는가,
// 안 갈려야 할 것이 안 갈리는가.

describe('resolvePcbPoTrack', () => {
  it('metalMask 만 스텐실이다', () => {
    expect(resolvePcbPoTrack('metalMask')).toBe('stencil');
  });

  it('나머지 제품군·미지정은 전부 EQ 트랙이다(회귀 방어 — 기존 건이 안 흔들려야 한다)', () => {
    for (const c of ['standard', 'advance', 'flexible', 'assembly', 'purchasing', 'mass', '']) {
      expect(resolvePcbPoTrack(c)).toBe('eq');
    }
    expect(resolvePcbPoTrack(null)).toBe('eq');
    expect(resolvePcbPoTrack(undefined)).toBe('eq');
  });
});

describe('트랙별 라벨', () => {
  it('갈리는 것은 확인 두 칸뿐 — 생산 단계는 두 트랙이 같은 말을 쓴다', () => {
    expect(PCB_PO_STATUS_LABELS.eq.eq_requested).toBe('EQ 승인요청');
    expect(PCB_PO_STATUS_LABELS.stencil.eq_requested).toBe('확인 요청');
    expect(PCB_PO_STATUS_LABELS.stencil.eq_done).toBe('확인 완료');
    for (const s of ['issued', 'producing', 'produced'] as const) {
      expect(PCB_PO_STATUS_LABELS.stencil[s]).toBe(PCB_PO_STATUS_LABELS.eq[s]);
    }
  });

  it('버튼 문구도 확인 구간만 갈린다 — 전이 사전 자체는 트랙 공용이다', () => {
    expect(pcbEqForwardLabel('issued', 'eq')).toBe('EQ 승인요청');
    expect(pcbEqForwardLabel('issued', 'stencil')).toBe('확인 요청');
    expect(pcbEqForwardLabel('eq_requested', 'stencil')).toBe('확인 완료');
    // 생산 구간은 덮어쓰지 않으므로 EQ 문구가 그대로 나온다.
    expect(pcbEqForwardLabel('eq_done', 'stencil')).toBe(pcbEqForwardLabel('eq_done', 'eq'));
    expect(pcbEqForwardLabel('produced', 'stencil')).toBe('');
    expect(pcbEqRevertLabel('eq_requested', 'stencil')).toBe('확인 요청 취소');
    expect(pcbEqRevertLabel('issued', 'stencil')).toBe('');
  });

  it('고객 화면에서도 EQ 라는 말이 스텐실에는 안 나온다', () => {
    expect(pcbProgressLabel('eq', 0, false, 'stencil')).toBe('제작 전 확인 중');
    expect(pcbProgressLabel('eq', 0)).toBe('제조 확인(EQ) 진행 중'); // 기본값=EQ 트랙(회귀)
    // 회차·직송 어휘는 트랙과 독립이다 — 겹칠 때 직송이 이긴다(기존 규칙 불변).
    expect(pcbProgressLabel('producing', 1, false, 'stencil')).toBe('A/S 재생산 — 생산 진행 중');
    expect(pcbProgressLabel('shipping', 0, true, 'stencil')).toBe('주문지로 직송 배송 중');
  });
});

describe('pcbStencilSubmitBlockers — 필수는 좌표파일 하나(문의사항은 선택, 2026-08-17)', () => {
  it('좌표파일만 있으면 통과한다 — 고객문의사항 없이도', () => {
    expect(pcbStencilSubmitBlockers([{ fileType: 'coord' }])).toEqual([]);
  });

  it('좌표파일이 없으면 막는다 — **다른 종류로는 대신 못 채운다**', () => {
    expect(pcbStencilSubmitBlockers([])).toEqual(['COORD_FILE_REQUIRED']);
    expect(
      pcbStencilSubmitBlockers([{ fileType: 'eq' }, { fileType: 'working' }, { fileType: 'inquiry' }]),
    ).toEqual(['COORD_FILE_REQUIRED']);
  });
});

describe('타임라인 전이 라벨(pcbEqEventLabel) — 대화가 트랙의 말로 그려진다', () => {
  const ev = (fromStatus: string, toStatus: string, note: string | null = null) => ({
    fromStatus,
    toStatus,
    note,
  });

  it('스텐실 — 요청/보완/취소/완료가 전부 확인 어휘다', () => {
    expect(pcbEqEventLabel(ev('issued', 'eq_requested', '문의'), 'stencil')).toBe('확인 요청');
    expect(pcbEqEventLabel(ev('eq_requested', 'issued', '좌표 보완'), 'stencil')).toBe('보완 요청');
    expect(pcbEqEventLabel(ev('eq_requested', 'issued'), 'stencil')).toBe('확인 요청 취소');
    expect(pcbEqEventLabel(ev('eq_requested', 'eq_done'), 'stencil')).toBe('확인 완료');
    expect(pcbEqEventLabel(ev('eq_done', 'eq_requested'), 'stencil')).toBe('확인 취소');
  });

  it('EQ 트랙은 종전 문구 그대로(회귀 방어) — 생산 구간은 두 트랙이 같은 말', () => {
    expect(pcbEqEventLabel(ev('issued', 'eq_requested'), 'eq')).toBe('EQ 승인요청');
    expect(pcbEqEventLabel(ev('eq_requested', 'issued', '드릴 누락'), 'eq')).toBe('EQ 반려');
    expect(pcbEqEventLabel(ev('eq_requested', 'issued'), 'eq')).toBe('EQ 요청 취소');
    expect(pcbEqEventLabel(ev('eq_requested', 'eq_done'), 'eq')).toBe('EQ 승인');
    for (const track of ['eq', 'stencil'] as const) {
      expect(pcbEqEventLabel(ev('eq_done', 'producing'), track)).toBe('생산 시작');
      expect(pcbEqEventLabel(ev('producing', 'produced'), track)).toBe('생산 완료');
    }
  });

  it("옛 이력의 '되돌리기' 표식은 두 트랙 모두 취소로 읽는다 — 판정은 isPcbEqRejectionEvent 하나", () => {
    expect(pcbEqEventLabel(ev('eq_requested', 'issued', '되돌리기'), 'eq')).toBe('EQ 요청 취소');
    expect(pcbEqEventLabel(ev('eq_requested', 'issued', '되돌리기'), 'stencil')).toBe('확인 요청 취소');
  });

  it('버튼 라벨 사전과 어긋나지 않는다 — 어긋나는 두 곳은 의도된 것만(드리프트 감시)', () => {
    // 타임라인 라벨과 버튼 라벨(pcbEqForwardLabel/pcbEqRevertLabel)은 별도 사전이다.
    // 같아야 하는 칸이 조용히 갈라지면 여기가 빨개진다. 의도된 차이는 둘뿐:
    // ① eq 트랙 요청 취소(버튼 '승인요청 취소' vs 말풍선 'EQ 요청 취소' — 대화에는 EQ 맥락을 남긴다)
    // ② 반려(버튼은 짧게 '반려/보완 요청', 말풍선은 'EQ 반려/보완 요청').
    for (const track of ['eq', 'stencil'] as const) {
      expect(pcbEqEventLabel(ev('issued', 'eq_requested'), track)).toBe(
        pcbEqForwardLabel('issued', track),
      );
      expect(pcbEqEventLabel(ev('eq_requested', 'eq_done'), track)).toBe(
        pcbEqForwardLabel('eq_requested', track),
      );
      expect(pcbEqEventLabel(ev('eq_done', 'producing'), track)).toBe('생산 시작');
      expect(pcbEqEventLabel(ev('producing', 'produced'), track)).toBe('생산 완료');
      expect(pcbEqEventLabel(ev('eq_done', 'eq_requested'), track)).toBe(
        pcbEqRevertLabel('eq_done', track),
      );
    }
    // 스텐실 요청 취소는 버튼과도 같은 말이다(확인 요청 취소).
    expect(pcbEqEventLabel(ev('eq_requested', 'issued'), 'stencil')).toBe(
      pcbEqRevertLabel('eq_requested', 'stencil'),
    );
  });
});

describe('pcbEqRejectActionLabel — 반려 액션의 단어(버튼·모달·409 공용)', () => {
  it('스텐실은 보완 요청, EQ 는 반려', () => {
    expect(pcbEqRejectActionLabel('stencil')).toBe('보완 요청');
    expect(pcbEqRejectActionLabel('eq')).toBe('반려');
  });
});

describe('lastPcbStencilInquiry — 현행 제출분의 고객문의사항', () => {
  const ev = (fromStatus: string, toStatus: string, note: string | null, at: string) => ({
    at,
    fromStatus,
    toStatus,
    note,
  });

  it('마지막 확인 요청의 note 를 돌려준다 — 보완 뒤 재요청이면 새 note 로 갈아탄다', () => {
    const history = [
      ev('issued', 'eq_requested', '첫 문의', '2026-08-17T01:00:00.000Z'),
      ev('eq_requested', 'issued', '좌표가 다릅니다', '2026-08-17T02:00:00.000Z'), // 보완 요청
      ev('issued', 'eq_requested', '수정했습니다 — 재확인 부탁', '2026-08-17T03:00:00.000Z'),
    ];
    expect(lastPcbStencilInquiry(history)).toEqual({
      at: '2026-08-17T03:00:00.000Z',
      note: '수정했습니다 — 재확인 부탁',
    });
  });

  it('현행 제출이 무메모면 null — 옛 회차의 메모를 끌어오지 않는다', () => {
    const history = [
      ev('issued', 'eq_requested', '첫 문의', '2026-08-17T01:00:00.000Z'),
      ev('eq_requested', 'issued', null, '2026-08-17T02:00:00.000Z'), // 요청 취소
      ev('issued', 'eq_requested', null, '2026-08-17T03:00:00.000Z'), // 무메모 재요청
    ];
    expect(lastPcbStencilInquiry(history)).toBeNull();
    expect(lastPcbStencilInquiry([])).toBeNull();
  });

  it('요청 취소는 문의를 **철회**한다 — 물린 글을 관리자 화면에 현행처럼 세우지 않는다', () => {
    const history = [
      ev('issued', 'eq_requested', '다시 쓰려고 물린 문의', '2026-08-17T01:00:00.000Z'),
      ev('eq_requested', 'issued', null, '2026-08-17T02:00:00.000Z'), // 자기 취소
    ];
    expect(lastPcbStencilInquiry(history)).toBeNull();
  });

  it('보완 요청(반려)은 문의를 철회시키지 않는다 — 돌려보낸 건 파일이지 질문이 아니다', () => {
    const history = [
      ev('issued', 'eq_requested', '스텐실 면 확인 부탁', '2026-08-17T01:00:00.000Z'),
      ev('eq_requested', 'issued', '좌표가 다릅니다', '2026-08-17T02:00:00.000Z'), // 보완 요청
    ];
    expect(lastPcbStencilInquiry(history)).toEqual({
      at: '2026-08-17T01:00:00.000Z',
      note: '스텐실 면 확인 부탁',
    });
  });
});

describe('문의 사진(inquiry) — 선택·누적 첨부', () => {
  it('협력사 산출물과 같은 잠금 — 확인 요청 뒤엔 못 바꾼다', () => {
    expect(canEditPcbEqFile('inquiry', 'issued')).toBe(true);
    expect(canEditPcbEqFile('inquiry', 'eq_requested')).toBe(false);
  });

  it('여러 장이 전부 최신이다 — 버전 관례(isLatest)의 예외', () => {
    const files = orderPcbEqFiles([
      { fileId: 1, fileType: 'inquiry', uploadedAt: '2026-08-17T01:00:00.000Z' },
      { fileId: 2, fileType: 'inquiry', uploadedAt: '2026-08-17T02:00:00.000Z' },
      { fileId: 3, fileType: 'coord', uploadedAt: '2026-08-17T03:00:00.000Z' },
      { fileId: 4, fileType: 'coord', uploadedAt: '2026-08-17T04:00:00.000Z' },
    ]);
    const latest = (id: number): boolean => files.find((f) => f.fileId === id)?.isLatest ?? false;
    expect(latest(1)).toBe(true); // 사진은 누적 — 둘 다 유효
    expect(latest(2)).toBe(true);
    expect(latest(3)).toBe(false); // 좌표는 버전 — 최신 1건만
    expect(latest(4)).toBe(true);
  });
});

describe('좌표파일 잠금·이름', () => {
  it('coord 는 협력사 산출물과 같은 잠금이다 — 확인 요청 뒤엔 못 바꾼다', () => {
    expect(canEditPcbEqFile('coord', 'issued')).toBe(true);
    expect(canEditPcbEqFile('coord', 'eq_requested')).toBe(false);
    expect(canEditPcbEqFile('coord', 'eq_done')).toBe(false);
    // 이 잠금이 곧 고객 열람의 전제다: 확인 뒤로는 내려받은 것이 달라지지 않는다.
  });

  it('고객에게 내려가는 이름은 협력사 흔적을 지우고 확장자만 승계한다', () => {
    expect(customerCoordFileName('한중전자_v3_좌표.xlsx', 'D40 센서보드')).toBe(
      '부품좌표_D40 센서보드.xlsx',
    );
    expect(customerCoordFileName('coord.CSV', 'Q1')).toBe('부품좌표_Q1.CSV');
  });

  it('확장자·프로젝트명이 없거나 경로 문자가 섞여도 안전한 파일명을 만든다', () => {
    expect(customerCoordFileName('좌표데이터', 'Q9')).toBe('부품좌표_Q9');
    expect(customerCoordFileName('a.xlsx', '')).toBe('부품좌표_주문.xlsx');
    expect(customerCoordFileName('a.xlsx', 'A/B:C*D?"<>|')).toBe('부품좌표_ABCD.xlsx');
    // 확장자 자리에 이상한 문자가 오면 버린다(내려받는 쪽 OS 를 가리지 않게).
    expect(customerCoordFileName('a.x/x', 'Q1')).toBe('부품좌표_Q1.xx');
  });
});
