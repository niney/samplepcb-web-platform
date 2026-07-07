import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminMarketExpertDecisionResponse,
  AdminMarketExpertDetailResponse,
  AdminMarketExpertListResponse,
  AdminMarketProjectDetailResponse,
  AdminMarketProjectListResponse,
  MarketProjectStatusResponse,
  MarketSettingsResponse,
  apiRoutes,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 재능마켓 관리(/admin/market/*) 서버 상태 훅 — 전문가 심사·프로젝트 모니터·설정.
// 계약은 @sp/api-contract(market.ts), 호출은 @sp/shared(관리자 견적 관리 관례 그대로).

// ── 전문가 심사 ──────────────────────────────────────────────────────────────

export interface AdminMarketExpertFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'pending' | 'approved' | 'rejected' | 'suspended';
  q: string;
}

const expertListPath = (f: AdminMarketExpertFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminMarketExperts}?${params.toString()}`;
};

export function useAdminMarketExpertList(filters: Ref<AdminMarketExpertFilters>) {
  return useQuery({
    queryKey: ['admin', 'market', 'experts', 'list', filters],
    queryFn: () => apiGet(expertListPath(filters.value), AdminMarketExpertListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useAdminMarketExpertDetail(expertId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'market', 'experts', 'detail', expertId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminMarketExperts}/${String(expertId.value)}`,
        AdminMarketExpertDetailResponse,
      ),
    enabled: computed(() => expertId.value !== null),
  });
}

export type ExpertDecisionAction = 'approve' | 'reject' | 'suspend' | 'unsuspend';

export function useExpertDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      expertId,
      action,
      reason,
    }: {
      expertId: number;
      action: ExpertDecisionAction;
      reason?: string;
    }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminMarketExperts}/${String(expertId)}/${action}`,
        reason !== undefined ? { reason } : undefined,
        AdminMarketExpertDecisionResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'market', 'experts'] });
    },
  });
}

// ── 프로젝트 모니터 ──────────────────────────────────────────────────────────

export interface AdminMarketProjectFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'bidding' | 'awarded' | 'closed' | 'cancelled';
  method: '' | 'open' | 'targeted';
  q: string;
}

const projectListPath = (f: AdminMarketProjectFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.method !== '') params.set('method', f.method);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminMarketProjects}?${params.toString()}`;
};

export function useAdminMarketProjectList(filters: Ref<AdminMarketProjectFilters>) {
  return useQuery({
    queryKey: ['admin', 'market', 'projects', 'list', filters],
    queryFn: () => apiGet(projectListPath(filters.value), AdminMarketProjectListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useAdminMarketProjectDetail(projectId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'market', 'projects', 'detail', projectId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminMarketProjects}/${String(projectId.value)}`,
        AdminMarketProjectDetailResponse,
      ),
    enabled: computed(() => projectId.value !== null),
  });
}

export function useAdminCancelProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend(
        'POST',
        `${apiRoutes.adminMarketProjects}/${String(projectId)}/cancel`,
        undefined,
        MarketProjectStatusResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'market', 'projects'] });
    },
  });
}

// ── 마켓 설정 ────────────────────────────────────────────────────────────────

export function useAdminMarketSettings() {
  return useQuery({
    queryKey: ['admin', 'market', 'settings'],
    queryFn: () => apiGet(apiRoutes.adminMarketSettings, MarketSettingsResponse),
  });
}

export function useSaveMarketSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (feeRateBp: number) =>
      apiSend('PATCH', apiRoutes.adminMarketSettings, { feeRateBp }, MarketSettingsResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'market', 'settings'] });
    },
  });
}
