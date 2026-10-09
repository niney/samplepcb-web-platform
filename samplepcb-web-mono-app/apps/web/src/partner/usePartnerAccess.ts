import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { actAsPartnerId, useAuthStore, apiGet } from '@sp/shared';
import { apiRoutes, PartnerAccessResponse } from '@sp/api-contract';

// 상단 메뉴에서 사용할 협력사 접근 여부. 소속·승인 상태는 sp-node가 매 요청
// 서버 기준으로 판정하며, 본문 RFQ/발주 데이터를 읽지 않는 경량 조회다.
export function usePartnerAccess() {
  const auth = useAuthStore();
  const query = useQuery({
    // 관리자 대리 접속이면 그 조직의 판정이 온다 — 내 판정과 캐시가 섞이지 않게 키를 가른다.
    queryKey: computed(() => ['partner', 'access', auth.me?.mbId ?? null, actAsPartnerId.value]),
    queryFn: () => apiGet(apiRoutes.partnerAccess, PartnerAccessResponse),
    enabled: computed(() => auth.isLoggedIn),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    ...query,
    isPartner: computed(() => query.data.value?.data.isPartner === true),
  };
}
