import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomPoCreateResponse,
  AdminBomPoListResponse,
  AdminBomPoMutationResponse,
  apiRoutes,
  type AdminBomPoCreateBodyType,
} from '@sp/api-contract';

// 협력사 발주서(D18) — /api/admin/bom-quotes/:id/pos (requireAdmin)

const base = apiRoutes.adminBomQuotes;

export function useAdminBomPos(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-pos', quoteId.value]),
    queryFn: () => apiGet(`${base}/${quoteId.value ?? ''}/pos`, AdminBomPoListResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] }); // poCount 파생 갱신
};

export function useCreateBomPos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomPoCreateBodyType }) =>
      apiSend('POST', `${base}/${quoteId}/pos`, body, AdminBomPoCreateResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteBomPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('DELETE', `${base}/${quoteId}/pos/${String(poId)}`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useCloseBomPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('POST', `${base}/${quoteId}/pos/${String(poId)}/close`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 외부 실행 재시도/재발급(D20) — Mouser 카트 담기·DigiKey single-use 리스트.
export function useExecuteExternalPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('POST', `${base}/${quoteId}/pos/${String(poId)}/external`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}
