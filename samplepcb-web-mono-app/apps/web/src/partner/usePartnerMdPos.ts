import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  PartnerMdPoDeleteResponse,
  PartnerMdPoDetailResponse,
  PartnerMdPoListResponse,
  PartnerPoChildPosResponse,
  apiRoutes,
  type PartnerMdPoAdvanceBodyType,
  type PartnerPoChildPosIssueBodyType,
} from '@sp/api-contract';

// 마스터딜러 하위 발주(D47, docs/SMARTBOM_PARTNER_RFQ.md §6.43) — 포털 서버 상태 훅.
//  · 발주처(마스터딜러): 받은 발주서의 발주 계획을 보고 하위 발주를 낸다.
//  · 하위: 받은 하위 발주를 보고 확인·출고를 알린다.
// 진행(확인·출고·수령·되돌리기)은 양쪽이 같은 주소를 쓰고, 누를 수 있는 동작은 서버가 역할로 가른다.

const poBase = apiRoutes.partnerPos;
const mdBase = apiRoutes.partnerMdPos;

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['partner', 'md-pos'] });
  void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
};

export function usePartnerPoChildPos(poId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'md-pos', 'plan', poId.value]),
    queryFn: () => apiGet(`${poBase}/${poId.value ?? ''}/child-pos`, PartnerPoChildPosResponse),
    enabled: computed(() => poId.value !== null && enabled.value),
    retry: false,
  });
}

export function useIssuePartnerPoChildPos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: string; body: PartnerPoChildPosIssueBodyType }) =>
      apiSend('POST', `${poBase}/${poId}/child-pos`, body, PartnerPoChildPosResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 내가 받은 하위 발주(하위로서) — 없으면 화면에 아무것도 띄우지 않는다. */
export function usePartnerMdPos(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'md-pos', 'received'],
    queryFn: () => apiGet(mdBase, PartnerMdPoListResponse),
    retry: false,
    ...(enabled === undefined ? {} : { enabled }),
  });
}

export function useAdvancePartnerMdPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mdPoId, body }: { mdPoId: number; body: PartnerMdPoAdvanceBodyType }) =>
      apiSend('POST', `${mdBase}/${String(mdPoId)}/advance`, body, PartnerMdPoDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeletePartnerMdPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mdPoId: number) =>
      apiSend('DELETE', `${mdBase}/${String(mdPoId)}`, undefined, PartnerMdPoDeleteResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}
