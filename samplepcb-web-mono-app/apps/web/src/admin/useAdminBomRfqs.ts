import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomRfqListResponse,
  AdminBomRfqReplyResponse,
  AdminBomRfqSelectionResponse,
  AdminBomRfqSendResponse,
  apiRoutes,
  type AdminBomRfqSelectionBodyType,
  type AdminBomRfqSendBodyType,
  type BomRfqReplyBodyType,
} from '@sp/api-contract';

// 협력사 RFQ 발송·현황·대리 입력 — /api/admin/bom-quotes/:id/rfqs (requireAdmin)
// 설계 docs/SMARTBOM_PARTNER_RFQ.md §2.4·§3.4.

const base = apiRoutes.adminBomQuotes;

export function useAdminBomRfqs(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-rfqs', quoteId.value]),
    queryFn: () => apiGet(`${base}/${quoteId.value ?? ''}/rfqs`, AdminBomRfqListResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

export function useSendBomRfqs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomRfqSendBodyType }) =>
      apiSend('POST', `${base}/${quoteId}/rfqs`, body, AdminBomRfqSendResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs'] });
    },
  });
}

// 행별 협력사 회신 선정/해제 — 서버가 스냅샷 박제+재계산하므로 견적 상세도 무효화한다.
export function useSelectRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomRfqSelectionBodyType }) =>
      apiSend('POST', `${base}/${quoteId}/rfq-selection`, body, AdminBomRfqSelectionResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
    },
  });
}

// 매직링크 재발급(§6.9) — 구 토큰 즉시 무효(유출 회수·구 데이터 소급 발급 공용).
export function useReissueRfqMagicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, rfqId }: { quoteId: string; rfqId: number }) =>
      apiSend(
        'POST',
        `${base}/${quoteId}/rfqs/${String(rfqId)}/magic-link`,
        undefined,
        AdminBomRfqListResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs'] });
    },
  });
}

export function useAdminRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      rfqId,
      body,
    }: {
      quoteId: string;
      rfqId: number;
      body: BomRfqReplyBodyType;
    }) =>
      apiSend(
        'PUT',
        `${base}/${quoteId}/rfqs/${String(rfqId)}/reply`,
        body,
        AdminBomRfqReplyResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs'] });
    },
  });
}
