import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomOrderListResponse,
  AdminBomOrderCancelPreviewResponse,
  AdminBomOrderCancelResponse,
  AdminOrderActionResponse,
  AdminOrderEditResponse,
  apiRoutes,
  type AdminBomOrderListQueryType,
  type AdminOrderForceStatusRequestType,
} from '@sp/api-contract';

// 스마트 BOM 주문·결제(주문 축, D19) — 목록은 /api/admin/bom-orders 파생,
// 입금확인·배송·완료는 기존 /api/admin/orders/status 재사용(조작 경로 단일, D21-3).

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

/** 메뉴 배지용 발주 대기(결제 완료+미발주) 수 — 발주 메뉴(관리자 메뉴 재편). */
export function useBomPosAwaitingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-orders', 'pos-awaiting-count'],
    queryFn: () =>
      apiGet(`${apiRoutes.adminBomOrders}?page=1&pageSize=1&tab=all`, AdminBomOrderListResponse),
    enabled,
    select: (res) => res.data.counts.paidUnissued,
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

/** BOM 취소 미리보기 — 결제·발주·부분취소 범위 판정은 서버 단일 진실이다. */
export function useBomOrderCancelPreview(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: ['admin', 'bom-orders', 'cancel-preview', quoteId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminBomOrders}/${quoteId.value ?? ''}/cancel-preview`,
        AdminBomOrderCancelPreviewResponse,
      ),
    enabled: computed(() => quoteId.value !== null),
  });
}

/** 미입금·무통장·발주 전 BOM 카트행 취소. 실행 시 서버가 정책을 다시 검증한다. */
export function useCancelBomOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, reason }: { quoteId: string; reason: string }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminBomOrders}/${encodeURIComponent(quoteId)}/cancel`,
        { reason },
        AdminBomOrderCancelResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 전이 후 파생 갱신 — 주문 축 + 타임라인(⑪⑫) + 통합 주문내역까지 함께 무효화.
function invalidateOrderDerived(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'orders'] });
}

export type BomOrderDelivery = NonNullable<AdminOrderForceStatusRequestType['delivery']>;

// [배송 처리](D21-3) — 부품 주문은 제작 7단계(가격확인~생산완료)를 밟지 않으므로 선형 전이
// 대신 임의 상태 변경(force-status, 코어 정상 분기 미러)으로 배송 진입: 운송장 반영 + 재고
// 앵커 포함. sendMail=true 이면 같은 영카트 주문 메일 브리지를 호출해 배송 안내도 함께 보낸다.
export function useShipBomOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, delivery, sendMail }: { odId: string; delivery: BomOrderDelivery; sendMail: boolean }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/force-status`,
        { target: '배송', delivery, sendMail, preserveCanceled: true },
        AdminOrderEditResponse,
      ),
    onSuccess: () => {
      invalidateOrderDerived(qc);
    },
  });
}

// [구매확정](D21-3) — 배송 → 완료(역시 알림 없음).
export function useCompleteBomOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (odId: string) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/force-status`,
        { target: '완료', preserveCanceled: true },
        AdminOrderEditResponse,
      ),
    onSuccess: () => {
      invalidateOrderDerived(qc);
    },
  });
}
