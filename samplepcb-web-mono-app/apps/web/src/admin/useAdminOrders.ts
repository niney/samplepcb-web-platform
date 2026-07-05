import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminOrderActionResponse,
  AdminOrderDetailResponse,
  AdminOrderEditResponse,
  AdminOrderItemActionResponse,
  AdminOrderListResponse,
  AdminOrderPrintResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AdminOrderForceStatusRequestType,
  AdminOrderInfoBodyType,
  AdminOrderItemStatusRequestType,
  AdminOrderReceiptBodyType,
  AdminOrderStatusRequestType,
  AdminOrderTabType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend } from '@sp/shared';

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
// 'od_time'(주문일시)은 BE 워커가 계약 enum 에 추가 중 — FE 는 문자열 파라미터로만 쓰므로
// 로컬 타입에 선반영한다(서버 반영 전 선택 시 400, 코디네이션으로 곧 해소).
export type OrderSortField =
  | 'od_id'
  | 'od_time'
  | 'od_cart_price'
  | 'od_receipt_price'
  | 'od_cancel_price'
  | 'od_misu';

// 배송회사 표시 정규화 — DB 원본 '0'/''/null 은 '-'(레거시 아티팩트: 빈값이 '0'으로 저장됨).
export const displayCompany = (company: string | null): string =>
  company === null || company === '' || company === '0' ? '-' : company;

// 카트행 취소류(취소/반품/품절) — 처리 완료 상태. 이 상태 행은 재처리 UI 를 숨긴다.
export const CANCEL_ITEM_TARGETS = ['취소', '반품', '품절'] as const;
export type CancelItemTarget = (typeof CANCEL_ITEM_TARGETS)[number];
export const isCancelledItemStatus = (ctStatus: string): boolean =>
  (CANCEL_ITEM_TARGETS as readonly string[]).includes(ctStatus);

// 임의 상태 변경 대상 5종(계약 force-status target). 역방향 포함 강제 점프용.
export type OrderForceTarget = AdminOrderForceStatusRequestType['target'];
export const FORCE_STATUS_TARGETS = ['주문', '입금', '준비', '배송', '완료'] as const;
export const isForceTarget = (s: string): s is OrderForceTarget =>
  (FORCE_STATUS_TARGETS as readonly string[]).includes(s);

// 준비 탭 운송장 인라인 입력 행(로컬 상태). invoiceTime 은 datetime-local 문자열('YYYY-MM-DDThh:mm').
export interface DeliveryInput {
  deliveryCompany: string;
  invoiceNo: string;
  invoiceTime: string;
}

// KST 벽시계 기준 datetime-local 기본값('YYYY-MM-DDThh:mm'). datetime-local 은 TZ 무변환이라
// 브라우저 TZ 와 무관하게 이 문자열을 그대로 표시한다.
export const nowLocalDateTime = (): string =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date())
    .replace(' ', 'T');

// g5 native('YYYY-MM-DD HH:MM:SS') → datetime-local('YYYY-MM-DDThh:mm')
export const g5ToLocal = (g5: string): string => {
  const s = g5.replace(' ', 'T');
  return s.length >= 16 ? s.slice(0, 16) : s;
};

// datetime-local('YYYY-MM-DDThh:mm') → g5 native('YYYY-MM-DD hh:mm:00')
export const toG5DateTime = (local: string): string => {
  if (local === '') return '';
  const s = local.replace('T', ' ');
  return s.length === 16 ? `${s}:00` : s;
};

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

// 상태 일괄 전이(입금/준비/배송/완료) — 성공 시 ['admin','orders'] 접두 무효화(목록 counts·상세 갱신).
export function useOrderStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminOrderStatusRequestType) =>
      apiSend('PATCH', `${apiRoutes.adminOrders}/status`, body, AdminOrderActionResponse),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 미입금('주문') 선택삭제 — 견적 딸린 주문 삭제 시 보관함 수거가 연동되므로 quotes 도 무효화.
export function useOrderDeleteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (odIds: string[]) =>
      apiSend('POST', `${apiRoutes.adminOrders}/delete`, { odIds }, AdminOrderActionResponse),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quotes'] });
    },
  });
}

// 주문자/받는분/배송지/희망일 부분 편집(dirty 필드만) — 응답은 { odId } 에코 없음이라
// 성공 시 ['admin','orders'] 접두 무효화로 상세·목록 refetch(회원 편집 관례). info/memo/receipt 공통.
export function useOrderInfoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, ...body }: { odId: string } & AdminOrderInfoBodyType) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/info`,
        body,
        AdminOrderEditResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 관리자 메모(od_shop_memo) 저장 — ''=비움.
export function useOrderMemoMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, shopMemo }: { odId: string; shopMemo: string }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/memo`,
        { shopMemo },
        AdminOrderEditResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 무통장 입금 수동 조정 — 저장 후 서버가 미수금 재계산하므로 상세·목록 refetch 필요.
// 무통장 아니면 서버가 409 NOT_BANK_TRANSFER.
export function useOrderReceiptMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, ...body }: { odId: string } & AdminOrderReceiptBodyType) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/receipt`,
        body,
        AdminOrderEditResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 카트행 단위 취소/반품/품절(무통장 한정) — 성공 시 미수금·재고·주문상태 서버 재계산되어
// ['admin','orders'] 접두 무효화로 상세(카드·헤더)·목록이 갱신된다. 비무통장은 서버 409.
export function useOrderItemStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, ...body }: { odId: string } & AdminOrderItemStatusRequestType) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/items/status`,
        body,
        AdminOrderItemActionResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 주문 임의 상태 변경(역방향 포함) — 성공 시 재고·상태 서버 재계산되어 ['admin','orders'] 무효화로
// 상세(헤더·카드)·목록 갱신. 코어 정상 분기라 결제수단 가드 없음(임의 변경 허용).
export function useOrderForceStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ odId, ...body }: { odId: string } & AdminOrderForceStatusRequestType) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminOrders}/${encodeURIComponent(odId)}/force-status`,
        body,
        AdminOrderEditResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] });
    },
  });
}

// 주문서 인쇄 데이터 — 인쇄 모달 open(odId != null) 시에만 fetch(발신처 seller 포함).
export function useAdminOrderPrint(odId: Ref<string | null>) {
  return useQuery({
    queryKey: ['admin', 'orders', 'print', odId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminOrders}/${encodeURIComponent(String(odId.value))}/print`,
        AdminOrderPrintResponse,
      ),
    enabled: computed(() => odId.value !== null),
  });
}

// 엑셀배송 양식 다운로드 — Bearer 필요라 <a href> 불가, fetch→blob→objectURL 저장(downloadAdminFile 관례).
export async function downloadDeliveryExcel(): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminOrders}/delivery-excel`);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-delivery-${nowLocalDateTime().slice(0, 10)}.xlsx`;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
