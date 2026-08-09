import { type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminOrderActionResponse,
  AdminOrderEditResponse,
  AdminPcbOrderListResponse,
  apiRoutes,
  type AdminOrderForceStatusRequestType,
  type AdminPcbOrderTabType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// PCB 주문·결제 워크큐 훅(P3.5) — 조감 + 입금확인. 입금확인은 코어 주문 전이 API 를 그대로
// 재사용해 조작 경로를 하나로 유지한다(스마트BOM 주문·결제와 동형, D21-3 관례).
// 고객 배송(P4.6 — 입고 끝난 주문 발송·구매확정)도 코어 force-status 재사용이고,
// 그 외 상태 변경(준비 등 중간 단계)은 통합 관리 주문내역이 전담한다.

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

/** 사이드바 '선적·배송' 배지 합산분 — 고객 배송 대기(입고확인 완료·배송 전) 수. */
export function usePcbOrdersToShipCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbOrder', 'to-ship-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbOrders}?page=1&pageSize=1&tab=all`,
        AdminPcbOrderListResponse,
      );
      return res.data.counts.toShip;
    },
    enabled,
    refetchInterval: 60_000,
  });
}

// 고객 배송 전이 후 파생 갱신 — 주문 축 + Case 상세(주문 카드·두 축 배지) + 진행현황 단계.
function invalidateCustomerDelivery(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbOrder'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'quotes'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbCase'] });
}

export type PcbOrderDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;

// [배송 처리](P4.6) — 입고확인 끝난 주문의 고객 발송. od 는 협력 축과 동기되지 않아
// '입금'에 머물러 있으므로(D6 수동 유지) 선형 전이 대신 임의 상태 변경(force-status,
// 코어 정상 분기 미러)으로 배송 진입: 운송장 반영 + 재고 앵커. 코어 관례상 이 경로는
// 알림 미발송 — 배송 안내 메일이 필요하면 통합 주문내역에서(SmartBOM D21-3 동형).
export function usePcbShipCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, delivery }: { odId: string; delivery: PcbOrderDelivery }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/force-status`,
        { target: '배송', delivery },
        AdminOrderEditResponse,
      ),
    onSuccess: () => {
      invalidateCustomerDelivery(qc);
    },
  });
}

// [구매확정](P4.6) — 배송 → 완료(역시 알림 없음).
export function usePcbCompleteCustomerOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (odId: string) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/force-status`,
        { target: '완료' },
        AdminOrderEditResponse,
      ),
    onSuccess: () => {
      invalidateCustomerDelivery(qc);
    },
  });
}
