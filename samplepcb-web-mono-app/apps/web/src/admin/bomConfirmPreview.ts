// 결제 후 부품 확인 요청(D43) 작성 패널 ↔ 고객 미리보기 사이의 표시 모형.
// .vue 에서 내보낸 타입은 ESLint 타입 프로그램에서 error type 으로 잡혀 no-unsafe-* 오탐이 나므로 .ts 에 둔다.

export interface BomConfirmPreviewOption {
  code: string;
  title: string;
  deltaText: string;
  tone: 'plus' | 'minus' | 'zero' | 'unknown';
  summary: string;
}

export interface BomConfirmPreviewIssue {
  key: string;
  mpn: string;
  manufacturerName: string | null;
  issueTypeLabel: string;
  moq: boolean;
  /** 알림(가격 인하·단종) — 고객이 고르지 않는다. */
  notice: boolean;
  description: string;
  options: BomConfirmPreviewOption[];
}

/** 고객 어휘의 금액 효과(PHP sp_bom_confirm_delta_text 와 같은 문구). null = 아직 정수가 아님. */
export function bomConfirmPreviewDelta(value: number | null): Pick<BomConfirmPreviewOption, 'deltaText' | 'tone'> {
  if (value === null) return { deltaText: '차액 미입력', tone: 'unknown' };
  if (value === 0) return { deltaText: '금액 변동 없음', tone: 'zero' };
  if (value > 0) return { deltaText: `+${value.toLocaleString('ko-KR')}원 추가결제`, tone: 'plus' };
  return { deltaText: `${(-value).toLocaleString('ko-KR')}원 환불`, tone: 'minus' };
}
