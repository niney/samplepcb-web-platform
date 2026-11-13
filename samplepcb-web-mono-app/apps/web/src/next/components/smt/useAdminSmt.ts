import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminSmtLinkStatusResponse,
  AdminSmtOrderListResponse,
  AdminSmtPullResponse,
  AdminSmtQuoteDetailResponse,
  AdminSmtReceiveLogResponse,
  type AdminSmtOrderTab,
  type SmartsmtReceiveResult,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend } from '@sp/shared';

// SMT 모듈 서버 상태 훅 — /api/admin/smt/* (docs/SMARTSMT_INTEGRATION.md §4.5). 계약은 @sp/api-contract
// (smartsmt.ts 의 "관리자 화면" 절), 무효화는 ['admin','smt'] 접두 일괄(관례). 계약 패키지의 apiRoutes 에는 이
// 모듈의 경로가 없어 여기 한 곳에 둔다(useAdminMailLogs 와 같은 방식).

const base = '/api/admin/smt';
const SMT_KEY = ['admin', 'smt'] as const;

export interface AdminSmtOrderFilters {
  page: number;
  pageSize: number;
  tab: AdminSmtOrderTab;
  q: string;
}

const orderListPath = (f: AdminSmtOrderFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('search', f.q.trim());
  return `${base}/orders?${params.toString()}`;
};

/** 받은 견적 목록 — 주문 단위 한 줄(마지막 견적 기준). */
export function useAdminSmtOrders(filters: Ref<AdminSmtOrderFilters>) {
  return useQuery({
    queryKey: [...SMT_KEY, 'orders', filters],
    queryFn: () => apiGet(orderListPath(filters.value), AdminSmtOrderListResponse),
    placeholderData: keepPreviousData,
  });
}

/** 견적 상세 — 견적서 전체 + 동봉 파일 + 같은 주문의 견적 이력. id 는 sp_smt_quote 행 번호. */
export function useAdminSmtQuote(id: Ref<number | null>) {
  return useQuery({
    queryKey: [...SMT_KEY, 'quote', id],
    queryFn: () => apiGet(`${base}/quotes/${String(id.value)}`, AdminSmtQuoteDetailResponse),
    enabled: computed(() => id.value !== null),
    // 없는 견적(404)을 세 번 다시 묻지 않는다.
    retry: false,
  });
}

export interface AdminSmtReceiveLogFilters {
  page: number;
  pageSize: number;
  /** '' = 전체 */
  result: SmartsmtReceiveResult | '';
}

/** 수신 기록 — SmartSMT 가 보낸 시도(성공·실패). */
export function useAdminSmtReceiveLogs(filters: Ref<AdminSmtReceiveLogFilters>) {
  return useQuery({
    queryKey: [...SMT_KEY, 'receive-logs', filters],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(filters.value.page));
      params.set('pageSize', String(filters.value.pageSize));
      if (filters.value.result !== '') params.set('result', filters.value.result);
      return apiGet(`${base}/receive-logs?${params.toString()}`, AdminSmtReceiveLogResponse);
    },
    placeholderData: keepPreviousData,
  });
}

/** 연동 상태 — 설정 여부와 최근 24시간 수신 요약(공유 비밀의 값은 오지 않는다). */
export function useAdminSmtLinkStatus() {
  return useQuery({
    queryKey: [...SMT_KEY, 'link-status'],
    queryFn: () => apiGet(`${base}/link-status`, AdminSmtLinkStatusResponse),
  });
}

/**
 * 견적서 가져오기 — 주문 번호로 SmartSMT 에서 당겨 와 저장한다(파일 없음). 실패는 ApiRequestError 로 던진다
 * (message = 서버가 준 문장, payload.error = SMARTSMT_PULL_ERRORS). 성공하면 목록·상세를 다시 부른다.
 */
export function usePullSmtQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => apiSend('POST', `${base}/pull`, { orderId }, AdminSmtPullResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SMT_KEY });
    },
  });
}

/**
 * 가져오기 응답에는 견적 번호(quote_id)만 온다 — 상세 주소에 쓰는 행 번호를 찾는다.
 * 그 주문을 목록에서 찾아 마지막 견적이 그 견적이면 그 행, 아니면(이미 받아 둔 옛 견적) 상세의 이력에서 찾는다.
 * 못 찾으면 null(목록 검색으로 보여 준다).
 */
export async function findSmtQuoteRowId(orderId: string, quoteId: string): Promise<number | null> {
  const params = new URLSearchParams({ page: '1', pageSize: '100', tab: 'all', search: orderId });
  const list = await apiGet(`${base}/orders?${params.toString()}`, AdminSmtOrderListResponse);
  const latest = list.data.items.find((item) => item.orderId === orderId)?.latest ?? null;
  if (latest === null) return null;
  if (latest.quoteId === quoteId) return latest.id;
  const detail = await apiGet(`${base}/quotes/${String(latest.id)}`, AdminSmtQuoteDetailResponse);
  return detail.data.history.find((entry) => entry.quoteId === quoteId)?.id ?? null;
}

/** 동봉 파일 내려받기 — 인증 헤더가 필요한 주소라 <a href> 대신 Blob 으로 받아 저장한다(다른 관리자 화면과 같은 방식). */
export async function downloadAdminSmtFile(fileId: number, name: string): Promise<void> {
  const blob = await apiGetBlob(`${base}/files/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
