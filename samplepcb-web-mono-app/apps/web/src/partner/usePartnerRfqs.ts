import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  PartnerPoDetailResponse,
  PartnerPoListResponse,
  PartnerRfqDetailResponse,
  PartnerRfqListResponse,
  apiRoutes,
  type BomRfqReplyBodyType,
} from '@sp/api-contract';

// 협력사 포털(/partner) 서버 상태 훅 — 받은 RFQ(회신)·받은 발주(확인, D18).
// 소속 판정은 서버가 매 요청 수행하므로 프론트는 로그인만 보장하고 403 을 안내로 처리.

const base = apiRoutes.partnerRfqs;
const poBase = apiRoutes.partnerPos;

export function usePartnerRfqs() {
  return useQuery({
    queryKey: ['partner', 'rfqs', 'list'],
    queryFn: () => apiGet(base, PartnerRfqListResponse),
    retry: false,
  });
}

export function usePartnerRfqDetail(rfqId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'rfqs', 'detail', rfqId.value]),
    queryFn: () => apiGet(`${base}/${rfqId.value ?? ''}`, PartnerRfqDetailResponse),
    enabled: computed(() => rfqId.value !== null),
    retry: false,
  });
}

export function usePartnerRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rfqId, body }: { rfqId: string; body: BomRfqReplyBodyType }) =>
      apiSend('PUT', `${base}/${rfqId}`, body, PartnerRfqDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'rfqs'] });
    },
  });
}

// ── 받은 발주(D18) ───────────────────────────────────────────────────────────

export function usePartnerPos() {
  return useQuery({
    queryKey: ['partner', 'pos', 'list'],
    queryFn: () => apiGet(poBase, PartnerPoListResponse),
    retry: false,
  });
}

export function usePartnerPoDetail(poId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'pos', 'detail', poId.value]),
    queryFn: () => apiGet(`${poBase}/${poId.value ?? ''}`, PartnerPoDetailResponse),
    enabled: computed(() => poId.value !== null),
    retry: false,
  });
}

export function usePartnerPoConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiSend('POST', `${poBase}/${poId}/confirm`, undefined, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}
