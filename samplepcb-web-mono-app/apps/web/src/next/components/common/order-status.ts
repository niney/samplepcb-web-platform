import type { BadgeVariant } from './badge-types';

// 고객 주문 상태(영카트 od_status 원문, 정본은 g5) → 배지 색. PCB·SmartBOM 이 같은 구간을 쓴다 —
// 입금 대기=기다림, 입금 뒤 진행=진행, 완료=끝남, 취소=이력. 라벨은 원문 그대로라 여기서는 색만 정한다.
// (파일검사·생산중·생산완료는 PCB 주문 단계라 BOM 주문에는 오지 않는다.)
const OD_STATUS: Record<string, BadgeVariant> = {
  주문: 'warning',
  입금: 'info',
  준비: 'info',
  파일검사: 'info',
  생산중: 'info',
  생산완료: 'info',
  배송: 'info',
  완료: 'success',
  취소: 'secondary',
};

/** 모르는 상태는 fallback(기본 중립) — 화면마다 '모름'을 어떻게 보일지가 다를 수 있어 인자로 받는다. */
export const odStatusVariant = (status: string, fallback: BadgeVariant = 'secondary'): BadgeVariant =>
  OD_STATUS[status] ?? fallback;
