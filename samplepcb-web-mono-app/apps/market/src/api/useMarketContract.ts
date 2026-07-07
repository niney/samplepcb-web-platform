import { computed, type Ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { MarketCheckoutResponse, MarketContractResponse, apiRoutes } from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import { useInvalidateProject } from './useMarketBids';

// 계약(2차) 서버 상태 훅 — 상세 조회 + 결제/납품/검수/취소 전이. 계약은 프로젝트 경유
// 라우트(/market/projects/:id/contract*)이고, 무효화는 useInvalidateProject 공유(계약 키 포함).
// 산출물 파일 다운로드는 lib/download.ts(downloadAuthedFile)를 컴포넌트에서 직접 사용한다.

const contractPath = (projectId: number): string =>
  `${apiRoutes.marketProjects}/${String(projectId)}/contract`;

// 당사자(의뢰인·채택 전문가)일 때만 활성화 — viewer.contract 유무로 게이트한다.
export function useContractQuery(projectId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'contract', projectId],
    queryFn: () => apiGet(contractPath(projectId.value ?? 0), MarketContractResponse),
    enabled: computed(() => enabled.value && projectId.value !== null),
  });
}

// 결제하기(의뢰인) — 성공 시 data.redirectUrl 로 영카트 주문서 이동. cartId 스테일 방지용
// me 재발급은 호출측(ProjectDetail)이 checkout 직전 auth.bootstrap() 으로 처리한다.
export function useCheckout() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${contractPath(projectId)}/checkout`, undefined, MarketCheckoutResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}

// 작업 완료 보고(전문가) — multipart: note? + deliverable[]. delivered 에서 재보고도 동일 경로.
export function useDeliver() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ projectId, form }: { projectId: number; form: FormData }) =>
      apiSendForm('POST', `${contractPath(projectId)}/deliver`, form, MarketContractResponse),
    onSuccess: (_d, v) => {
      invalidate(v.projectId);
    },
  });
}

// 검수 확정(의뢰인) — delivered → completed.
export function useConfirm() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${contractPath(projectId)}/confirm`, undefined, MarketContractResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}

// 계약 취소(의뢰인, pending 만) — 프로젝트도 동반 취소(서버 tx).
export function useCancelContract() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${contractPath(projectId)}/cancel`, undefined, MarketContractResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}
