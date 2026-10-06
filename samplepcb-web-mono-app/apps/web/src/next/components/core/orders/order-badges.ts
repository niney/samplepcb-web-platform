import { orderStatusVariant, type OrderStatusVariant } from '@/admin/useAdminOrders';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// 통합 주문내역의 주문 상태(od_status 원문 — 표준 8 + PCB 제작 단계 8) → 배지 색. 구간 판정은 옛 화면과 같은
// orderStatusVariant(주문·EQ=기다림, 입금~배송=진행, 완료=끝남, A/S·취소류=이력)를 그대로 쓰고 이름만 키트로 옮긴다.
const VARIANT: Record<OrderStatusVariant, BadgeVariant> = {
  warn: 'warning',
  info: 'info',
  success: 'success',
  muted: 'secondary',
};

export const orderStatusBadgeVariant = (status: string): BadgeVariant => VARIANT[orderStatusVariant(status)];
