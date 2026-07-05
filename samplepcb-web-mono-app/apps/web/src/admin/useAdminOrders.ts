import { computed, type Ref } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import { AdminOrderDetailResponse, AdminOrderListResponse, apiRoutes } from '@sp/api-contract';
import type { AdminOrderTabType } from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// 관리자 주문내역(/admin/orders) 서버 상태 훅 — 이번 WP 는 읽기 경로만(목록/상세).
// 계약은 @sp/api-contract(orders.ts), 호출은 @sp/shared(apiGet — 401 시 토큰 재발급
// 1회 내장). 견적·회원 관리 훅(useAdminQuotes/useAdminMembers)의 queryKey 관례를 따른다.
// 상태 전이·삭제 mutation 은 다음 WP 에서 이 파일에 추가한다.

// 주문번호 하이픈 표기(레거시 orderlist.php :336 미러) — 길이 16 이면 8-8, 그 외는 6-나머지.
// 목록 셀과 상세 드로어 개요에서 공용으로 쓰는 순수 함수.
export const formatOdId = (odId: string): string =>
  odId.length === 16
    ? `${odId.slice(0, 8)}-${odId.slice(8)}`
    : `${odId.slice(0, 6)}-${odId.slice(6)}`;

// od_status(DB 패스스루) → i18n slug. 미등록 값은 null → 컴포넌트가 원문 노출(운영 커스텀 상태).
// 목록 뱃지·상세 개요 뱃지에서 공용. 라벨은 t() 가 필요해 컴포넌트에 두고, 여기선 slug/색만.
const ORDER_STATUS_SLUG: Record<string, string> = {
  주문: 'order',
  입금: 'deposit',
  준비: 'ready',
  배송: 'shipping',
  완료: 'done',
  취소: 'cancelled',
  전체취소: 'cancelled',
  부분취소: 'partialCancel',
};
export const orderStatusSlug = (status: string): string | null =>
  ORDER_STATUS_SLUG[status] ?? null;

// 상태 → 뱃지 색. 팔레트(UiBadge)가 4색이라 의미 그룹으로 묶는다:
// 주문(입금 대기)=amber · 입금/준비/배송(처리 중)=blue · 완료=green · 취소류=gray.
export type OrderStatusVariant = 'info' | 'warn' | 'success' | 'muted';
export const orderStatusVariant = (status: string): OrderStatusVariant => {
  switch (status) {
    case '주문':
      return 'warn';
    case '입금':
    case '준비':
    case '배송':
      return 'info';
    case '완료':
      return 'success';
    default:
      return 'muted';
  }
};

// 검색 대상 필드(레거시 sel_field 10종) — qField 와 q 는 동반 전송(계약 요구).
export type OrderQField =
  | 'od_id'
  | 'mb_id'
  | 'od_name'
  | 'od_tel'
  | 'od_hp'
  | 'od_b_name'
  | 'od_b_tel'
  | 'od_b_hp'
  | 'od_deposit_name'
  | 'od_invoice';

// 정렬 대상 컬럼(계약 sort enum). ''(filters.sort) = 미지정 → 서버 기본 정렬.
export type OrderSortField =
  | 'od_id'
  | 'od_cart_price'
  | 'od_receipt_price'
  | 'od_cancel_price'
  | 'od_misu';

export interface AdminOrderFilters {
  page: number;
  pageSize: number;
  tab: AdminOrderTabType; // 한글 리터럴(전체·주문·입금·준비·배송·완료·취소·부분취소)
  qField: OrderQField; // 검색 대상(q 가 비면 미적용)
  q: string; // '' = 미검색
  from: string; // '' = 미지정 (YYYY-MM-DD)
  to: string;
  settleCase: string; // '' = 결제수단 전체(미지정)
  misu: boolean; // 미수금(od_misu<>0)
  cancelled: boolean; // 반품·품절(od_cancel_price<>0)
  refund: boolean; // 환불(od_refund_price<>0)
  point: boolean; // 포인트주문(od_receipt_point<>0)
  coupon: boolean; // 쿠폰(쿠폰합>0)
  sort: OrderSortField | ''; // '' = 기본 정렬
  order: 'asc' | 'desc'; // sort 가 비어 있으면 미전송
}

// 필터 → 쿼리스트링. 빈 값·false 플래그는 스킵하고, boolean 은 'true' 로만 보낸다
// (계약 orderBoolFlag 는 'true'/'1' 만 참으로 취급). qField 는 q 가 있을 때만 동반 전송.
const listPath = (f: AdminOrderFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') {
    params.set('qField', f.qField);
    params.set('q', f.q.trim());
  }
  if (f.from !== '') params.set('from', f.from);
  if (f.to !== '') params.set('to', f.to);
  if (f.settleCase !== '') params.set('settleCase', f.settleCase);
  if (f.misu) params.set('misu', 'true');
  if (f.cancelled) params.set('cancelled', 'true');
  if (f.refund) params.set('refund', 'true');
  if (f.point) params.set('point', 'true');
  if (f.coupon) params.set('coupon', 'true');
  if (f.sort !== '') {
    params.set('sort', f.sort);
    params.set('order', f.order);
  }
  return `${apiRoutes.adminOrders}?${params.toString()}`;
};

export function useAdminOrderList(filters: Ref<AdminOrderFilters>) {
  return useQuery({
    queryKey: ['admin', 'orders', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminOrderListResponse),
    // 페이지·필터 전환 중 직전 데이터 유지(테이블 깜빡임 방지)
    placeholderData: keepPreviousData,
  });
}

export function useAdminOrderDetail(odId: Ref<string | null>) {
  return useQuery({
    queryKey: ['admin', 'orders', 'detail', odId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminOrders}/${encodeURIComponent(String(odId.value))}`,
        AdminOrderDetailResponse,
      ),
    enabled: computed(() => odId.value !== null),
  });
}
