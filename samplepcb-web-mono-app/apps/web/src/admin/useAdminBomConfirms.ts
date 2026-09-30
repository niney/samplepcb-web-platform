// 결제 후 부품 확인 요청(D43) — 관리자 vue-query 훅. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// 변경 계열은 전부 Case 뷰(AdminBomConfirmCaseResponse)를 돌려주므로 캐시를 그대로 덮어쓰고,
// 발주·주문·견적 화면이 게이트 결과를 다시 읽도록 관련 키를 무효화한다.
import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomConfirmCaseResponse,
  AdminBomConfirmCreateResponse,
  AdminBomConfirmListResponse,
  apiRoutes,
  type AdminBomConfirmApplyBodyType,
  type AdminBomConfirmCancelBodyType,
  type AdminBomConfirmCaseResponseType,
  type AdminBomConfirmCreateBodyType,
  type AdminBomConfirmFollowupBodyType,
  type AdminBomConfirmProxyAnswerBodyType,
  type AdminBomConfirmTabType,
} from '@sp/api-contract';

const quotesBase = apiRoutes.adminBomQuotes;
const listBase = apiRoutes.adminBomConfirms;

export const bomConfirmCaseKey = (quoteId: string | null) => ['admin', 'bom-confirms', 'case', quoteId] as const;

export function useAdminBomConfirmCase(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => bomConfirmCaseKey(quoteId.value)),
    queryFn: () => apiGet(`${quotesBase}/${quoteId.value ?? ''}/confirms`, AdminBomConfirmCaseResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

export interface AdminBomConfirmFilters {
  tab: AdminBomConfirmTabType;
  page: number;
  pageSize: number;
  search: string;
}

export function useAdminBomConfirmList(filters: Ref<AdminBomConfirmFilters>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-confirms', 'list', filters.value]),
    queryFn: () => {
      const params = new URLSearchParams({
        tab: filters.value.tab,
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
      });
      const search = filters.value.search.trim();
      if (search !== '') params.set('search', search);
      return apiGet(`${listBase}?${params.toString()}`, AdminBomConfirmListResponse);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** 메뉴 배지 = 관리자 차례(처리 필요 — 적용·환불). */
export function useBomConfirmsNeedsActionCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-confirms', 'needs-action-count'],
    queryFn: () => apiGet(`${listBase}?tab=needs_action&page=1&pageSize=1`, AdminBomConfirmListResponse),
    enabled,
    select: (response) => response.data.counts.needs_action,
    refetchInterval: 60_000,
  });
}

function useCaseMutation<TVars>(
  request: (vars: TVars) => Promise<AdminBomConfirmCaseResponseType>,
  quoteIdOf: (vars: TVars) => string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (response, vars) => {
      qc.setQueryData(bomConfirmCaseKey(quoteIdOf(vars)), response);
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-confirms', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-confirms', 'needs-action-count'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes', 'detail', quoteIdOf(vars)] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos', quoteIdOf(vars)] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
    },
  });
}

export function useCreateBomConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomConfirmCreateBodyType }) =>
      apiSend('POST', `${quotesBase}/${quoteId}/confirms`, body, AdminBomConfirmCreateResponse),
    onSuccess: (_response, vars) => {
      void qc.invalidateQueries({ queryKey: bomConfirmCaseKey(vars.quoteId) });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-confirms', 'list'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'mail-logs'] });
    },
  });
}

export function useCancelBomConfirm() {
  return useCaseMutation(
    ({ quoteId, requestId, body }: { quoteId: string; requestId: string; body: AdminBomConfirmCancelBodyType }) =>
      apiSend('POST', `${quotesBase}/${quoteId}/confirms/${requestId}/cancel`, body, AdminBomConfirmCaseResponse),
    (vars) => vars.quoteId,
  );
}

export function useProxyAnswerBomConfirm() {
  return useCaseMutation(
    ({ quoteId, requestId, body }: { quoteId: string; requestId: string; body: AdminBomConfirmProxyAnswerBodyType }) =>
      apiSend('POST', `${quotesBase}/${quoteId}/confirms/${requestId}/answer`, body, AdminBomConfirmCaseResponse),
    (vars) => vars.quoteId,
  );
}

export function useApplyBomConfirmIssue() {
  return useCaseMutation(
    ({ quoteId, requestId, issueId, body }: {
      quoteId: string;
      requestId: string;
      issueId: string;
      body: AdminBomConfirmApplyBodyType;
    }) =>
      apiSend(
        'POST',
        `${quotesBase}/${quoteId}/confirms/${requestId}/issues/${issueId}/apply`,
        body,
        AdminBomConfirmCaseResponse,
      ),
    (vars) => vars.quoteId,
  );
}

export function useFollowupBomConfirmIssue() {
  return useCaseMutation(
    ({ quoteId, requestId, issueId, body }: {
      quoteId: string;
      requestId: string;
      issueId: string;
      body: AdminBomConfirmFollowupBodyType;
    }) =>
      apiSend(
        'POST',
        `${quotesBase}/${quoteId}/confirms/${requestId}/issues/${issueId}/followup`,
        body,
        AdminBomConfirmCaseResponse,
      ),
    (vars) => vars.quoteId,
  );
}

export function useResolveBomConfirm() {
  return useCaseMutation(
    ({ quoteId, requestId, expectedVersion }: { quoteId: string; requestId: string; expectedVersion: number }) =>
      apiSend(
        'POST',
        `${quotesBase}/${quoteId}/confirms/${requestId}/resolve`,
        { expectedVersion },
        AdminBomConfirmCaseResponse,
      ),
    (vars) => vars.quoteId,
  );
}

export type BomSettlementAction = 'reduce' | 'refund' | 'cancel';

export function useBomSettlementAction() {
  return useCaseMutation(
    ({ quoteId, settlementId, action, note, reason }: {
      quoteId: string;
      settlementId: string;
      action: BomSettlementAction;
      note?: string;
      reason?: string;
    }) =>
      apiSend(
        'POST',
        `${quotesBase}/${quoteId}/settlements/${settlementId}/${action}`,
        action === 'cancel' ? { reason: reason ?? '' } : note === undefined || note === '' ? {} : { note },
        AdminBomConfirmCaseResponse,
      ),
    (vars) => vars.quoteId,
  );
}
