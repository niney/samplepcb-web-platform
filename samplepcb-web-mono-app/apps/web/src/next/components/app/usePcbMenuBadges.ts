import { computed, type ComputedRef } from 'vue';
import { useAuthStore } from '@sp/shared';
import { usePcbRfqPendingCount } from '@/admin/useAdminPcbRfqs';
import { usePcbPoWorkCounts, usePcbShipmentPendingCount } from '@/admin/useAdminPcbPos';
import { usePcbOrdersAwaitingCount, usePcbOrdersToShipCount } from '@/admin/useAdminPcbOrders';
import { usePcbRemittancePendingCount } from '@/admin/useAdminPcbRemittances';
import { useAdminPcbTodoCounts } from '@/admin/useAdminPcbCases';
import { usePcbClaimsPendingCount } from '@/admin/useAdminPcbClaims';
import type { NextMenuBadge } from '@/next/admin-menu';

// PCB 메뉴 배지 — 옛 AdminLayout 과 같은 훅·같은 합산식(옛 화면과 숫자가 어긋나면 안 된다).
// PCB 배지는 합산이다: 시작 전(대기 큐)과 진행 중 내 차례가 모두 관리자 몫이라 하나만 세면
// 나머지가 묻힌다("이 역할이 지금 움직여야 하는 수").
export function usePcbMenuBadges(): ComputedRef<Record<NextMenuBadge, number>> {
  const auth = useAuthStore();
  const isAdminUser = computed(() => auth.me?.isAdmin === true);

  const { data: rfqPending } = usePcbRfqPendingCount(isAdminUser);
  const { eqPending, toShip } = usePcbPoWorkCounts(isAdminUser);
  const { data: shipmentPending } = usePcbShipmentPendingCount(isAdminUser);
  const { data: ordersAwaiting } = usePcbOrdersAwaitingCount(isAdminUser);
  // 고객 배송 대기(P4.6) — 입고확인이 끝났는데 od 가 배송 전인 주문(선적·배송 배지 합산분).
  const { data: customerToShip } = usePcbOrdersToShipCount(isAdminUser);
  // 송금 대기 — 발주됐는데 한 푼도 안 나간 건(P3.11).
  const remittancePending = usePcbRemittancePendingCount(isAdminUser);
  const { data: claimsPending } = usePcbClaimsPendingCount(isAdminUser);
  const { todoRfq, todoPo } = useAdminPcbTodoCounts(isAdminUser);

  return computed(() => ({
    pcbRfqPending: todoRfq.value + (rfqPending.value ?? 0),
    pcbPosPending: todoPo.value + eqPending.value,
    pcbShipmentPending: toShip.value + (shipmentPending.value ?? 0) + (customerToShip.value ?? 0),
    pcbOrdersAwaiting: ordersAwaiting.value ?? 0,
    pcbRemittancePending: remittancePending.value,
    pcbClaimsPending: claimsPending.value ?? 0,
  }));
}
