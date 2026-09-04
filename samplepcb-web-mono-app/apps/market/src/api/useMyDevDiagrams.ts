import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { MyDevDiagramsResponse, apiRoutes } from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// 내 시스템 구성도 진행 목록(플로팅 위젯, docs/AI_DEV_REVIEW.md §13.7) — 서버 사실(내 프로젝트의
// devDiagram.status)이 정본이라 다른 탭·기기에서도 같게 보인다. 진행 중이 있을 때만 10초 폴링, 없으면
// 정지(LLM 은 진행률을 주지 않으므로 "실시간"은 10초 간격 + 경과 시간 표시가 한계).
export function useMyDevDiagrams(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'my-dev-diagrams'],
    queryFn: () => apiGet(`${apiRoutes.marketProjects.replace('/projects', '')}/my/dev-diagrams`, MyDevDiagramsResponse),
    enabled,
    refetchInterval: (query) =>
      (query.state.data?.data.items ?? []).some((i) => i.meta.status === 'queued' || i.meta.status === 'running')
        ? 10_000
        : false,
    refetchOnWindowFocus: true,
  });
}

export const useHasPendingDevDiagram = (items: Ref<readonly { meta: { status: string } }[]>) =>
  computed(() => items.value.some((i) => i.meta.status === 'queued' || i.meta.status === 'running'));
