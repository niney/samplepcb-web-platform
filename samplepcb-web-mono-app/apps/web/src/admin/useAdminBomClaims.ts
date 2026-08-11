import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomClaimListResponse,
  AdminBomClaimDetailResponse,
  AdminBomClaimTransitionResponse,
  apiRoutes,
  type AdminBomClaimListQueryType,
  type AdminBomClaimTransitionRequestType,
} from '@sp/api-contract';

export interface AdminBomClaimFilters {
  page: number;
  pageSize: number;
  status: AdminBomClaimListQueryType['status'];
  search: string;
}

const base = apiRoutes.adminBomClaims;

export function useAdminBomClaims(filters: Ref<AdminBomClaimFilters>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-claims', 'list', filters.value]),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
        status: filters.value.status,
      });
      const search = filters.value.search.trim();
      if (search !== '') params.set('search', search);
      return apiGet(`${base}?${params.toString()}`, AdminBomClaimListResponse);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useAdminBomClaim(claimId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-claims', 'detail', claimId.value]),
    queryFn: () => apiGet(`${base}/${claimId.value ?? ''}`, AdminBomClaimDetailResponse),
    enabled: computed(() => enabled.value && claimId.value !== null),
    retry: false,
  });
}

/** 사이드바 배지 = 새 접수+검토 중인 관리자 미처리 건수. */
export function useBomClaimsPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-claims', 'pending-count'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1&status=pending`, AdminBomClaimListResponse),
    enabled,
    select: (response) => response.data.counts.pending,
    refetchInterval: 60_000,
  });
}

export function useTransitionAdminBomClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, body }: {
      claimId: string;
      body: AdminBomClaimTransitionRequestType;
    }) => apiSend('PATCH', `${base}/${claimId}`, body, AdminBomClaimTransitionResponse),
    onSuccess: (response) => {
      qc.setQueryData(
        ['admin', 'bom-claims', 'detail', response.data.id],
        { result: true as const, data: response.data },
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-claims'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['bom', 'claims', response.data.quoteId] });
    },
  });
}
