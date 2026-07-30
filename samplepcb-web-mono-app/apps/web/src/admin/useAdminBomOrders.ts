import type { Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomOrderListResponse,
  AdminOrderActionResponse,
  apiRoutes,
  type AdminBomOrderListQueryType,
} from '@sp/api-contract';

// 스마트 BOM 주문·결제(주문 축, D19) — 목록은 /api/admin/bom-orders 파생,
// 입금확인은 기존 /api/admin/orders/status(target='입금') 재사용(조작 경로 단일).

export interface AdminBomOrderFilters {
  page: number;
  pageSize: number;
  tab: AdminBomOrderListQueryType['tab'];
}

export function useAdminBomOrders(filters: Ref<AdminBomOrderFilters>) {
  return useQuery({
    queryKey: ['admin', 'bom-orders', 'list', filters],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
        tab: filters.value.tab,
      });
      return apiGet(`${apiRoutes.adminBomOrders}?${params.toString()}`, AdminBomOrderListResponse);
    },
    placeholderData: keepPreviousData,
  });
}

/** 메뉴 배지용 입금 대기 수 — counts 만 필요해 최소 페이지로 조회. */
export function useBomOrdersAwaitingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-orders', 'awaiting-count'],
    queryFn: () =>
      apiGet(`${apiRoutes.adminBomOrders}?page=1&pageSize=1&tab=all`, AdminBomOrderListResponse),
    enabled,
    select: (res) => res.data.counts.awaitingPayment,
    refetchInterval: 60_000,
  });
}

export function useConfirmBomOrderReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, sendMail }: { odId: string; sendMail: boolean }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/status`,
        { target: '입금', odIds: [odId], sendMail, sendSms: false },
        AdminOrderActionResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] }); // 타임라인 ⑦ 파생 갱신
    },
  });
}
