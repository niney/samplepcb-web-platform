import { type Ref } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import {
  AdminPcbOrderListResponse,
  apiRoutes,
  type AdminPcbOrderTabType,
} from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// PCB 주문·결제 워크큐 훅(P3.5) — read-only 조감(od 상태 변경은 코어 주문 관리 몫).

export interface AdminPcbOrderFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbOrderTabType;
  q: string;
}

const listPath = (f: AdminPcbOrderFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminPcbOrders}?${params.toString()}`;
};

export function useAdminPcbOrderWork(filters: Ref<AdminPcbOrderFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbOrder', 'work', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminPcbOrderListResponse),
    placeholderData: keepPreviousData,
  });
}

// 사이드바 '주문·결제' 배지 — 입금 대기 수.
export function usePcbOrdersAwaitingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbOrder', 'awaiting-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbOrders}?page=1&pageSize=1&tab=all`,
        AdminPcbOrderListResponse,
      );
      return res.data.counts.awaiting;
    },
    enabled,
    refetchInterval: 60_000,
  });
}
