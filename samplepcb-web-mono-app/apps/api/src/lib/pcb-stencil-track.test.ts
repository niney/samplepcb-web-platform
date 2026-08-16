import { describe, expect, it } from 'vitest';
import {
  PCB_PO_STATUS_LABELS,
  canEditPcbEqFile,
  pcbEqForwardLabel,
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

describe('pcbStencilSubmitBlockers', () => {
  const coord = [{ fileType: 'coord' }];

  it('둘 다 있어야 통과한다', () => {
    expect(pcbStencilSubmitBlockers('앞면만 도포합니다', coord)).toEqual([]);
  });

  it('문의사항이 비었거나 한 글자면 막는다', () => {
    expect(pcbStencilSubmitBlockers('', coord)).toEqual(['NOTE_REQUIRED']);
    expect(pcbStencilSubmitBlockers('   ', coord)).toEqual(['NOTE_REQUIRED']);
    expect(pcbStencilSubmitBlockers('네', coord)).toEqual(['NOTE_REQUIRED']); // 1자
    expect(pcbStencilSubmitBlockers('없음', coord)).toEqual([]); // 2자면 통과(D16 과 같은 하한)
    expect(pcbStencilSubmitBlockers(null, coord)).toEqual(['NOTE_REQUIRED']);
  });

  it('좌표파일이 없으면 막는다 — **다른 종류로는 대신 못 채운다**', () => {
    expect(pcbStencilSubmitBlockers('확인 부탁드립니다', [])).toEqual(['COORD_FILE_REQUIRED']);
    expect(
      pcbStencilSubmitBlockers('확인 부탁드립니다', [{ fileType: 'eq' }, { fileType: 'working' }]),
    ).toEqual(['COORD_FILE_REQUIRED']);
  });

  it('둘 다 없으면 둘 다 알린다(하나 고치고 또 막히지 않게)', () => {
    expect(pcbStencilSubmitBlockers('', [])).toEqual(['NOTE_REQUIRED', 'COORD_FILE_REQUIRED']);
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
