import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomQuoteDetailResponse,
  AdminBomQuoteListResponse,
  BomQuoteItemCandidatesResponse,
  apiRoutes,
  type AdminBomQuotePatchBodyType,
  type BomQuoteStatusType,
} from '@sp/api-contract';

// 고객 BOM 견적요청 검토 — /api/admin/bom-quotes (requireAdmin)

const base = apiRoutes.adminBomQuotes;

export function useAdminBomQuotes(status: Ref<BomQuoteStatusType | null>, page: Ref<number>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', status.value, page.value]),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page.value), pageSize: '20' });
      if (status.value !== null) params.set('status', status.value);
      return apiGet(`${base}?${params.toString()}`, AdminBomQuoteListResponse);
    },
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useAdminBomQuote(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', 'detail', quoteId.value]),
    queryFn: () => apiGet(`${base}/${quoteId.value ?? ''}`, AdminBomQuoteDetailResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

export function useAdminBomQuoteCandidates(quoteId: Ref<string | null>, rowIdx: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', 'candidates', quoteId.value, rowIdx.value]),
    queryFn: () => apiGet(
      `${base}/${quoteId.value ?? ''}/items/${String(rowIdx.value ?? '')}/candidates`,
      BomQuoteItemCandidatesResponse,
    ),
    enabled: computed(() => quoteId.value !== null && rowIdx.value !== null),
    retry: false,
  });
}

export function usePatchAdminBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomQuotePatchBodyType }) =>
      apiSend('PATCH', `${base}/${quoteId}`, body, AdminBomQuoteDetailResponse),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] }),
  });
}
