import { type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminOrderActionResponse,
  AdminPcbOrderListResponse,
  apiRoutes,
  type AdminPcbOrderTabType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// PCB 주문·결제 워크큐 훅(P3.5) — 조감 + 입금확인. 입금확인은 코어 주문 전이 API 를 그대로
// 재사용해 조작 경로를 하나로 유지한다(스마트BOM 주문·결제와 동형, D21-3 관례).
// 그 외 상태 변경(준비·배송·완료 등)은 통합 관리 주문내역이 전담한다.

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

/** 입금확인(무통장 미입금 → 입금) — 코어 PATCH /api/admin/orders/status 재사용. */
export function useConfirmPcbOrderReceipt() {
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
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbOrder'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] }); // 발주 가능 여부(paid 게이트) 파생
      void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] }); // Case 상세의 주문 정보 카드
    },
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
