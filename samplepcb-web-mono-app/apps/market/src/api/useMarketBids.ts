import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  MarketAwardResponse,
  MarketBidSubmitResponse,
  MarketBidWithdrawResponse,
  MarketMyBidListResponse,
  MarketMyBidResponse,
  MarketNdaSignResponse,
  MarketProjectBidsResponse,
  MarketProjectStatusResponse,
  MarketTargetedProjectListResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  MarketBidStatusType,
  MarketBidSubmitBodyType,
  MarketNdaSignBodyType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 입찰·NDA·프로젝트 상태 액션 훅 — 성공 시 상세/입찰/마이 목록 캐시를 무효화해
// 화면 상태(viewer.myBidStatus·bidCount·status)를 서버 진실로 재동기화한다.

const projectPath = (projectId: number): string =>
  `${apiRoutes.marketProjects}/${String(projectId)}`;

function useInvalidateProject() {
  const qc = useQueryClient();
  return (projectId: number): void => {
    void qc.invalidateQueries({ queryKey: ['market', 'projects', 'detail'] });
    void qc.invalidateQueries({ queryKey: ['market', 'projects', 'list'] });
    void qc.invalidateQueries({ queryKey: ['market', 'bids', projectId] });
    void qc.invalidateQueries({ queryKey: ['market', 'my-bid', projectId] });
    void qc.invalidateQueries({ queryKey: ['market', 'my-projects'] });
    void qc.invalidateQueries({ queryKey: ['market', 'my-bids'] });
  };
}

// 소유자 전용 — 받은 견적 전체(블라인드 예외 표면).
export function useProjectBids(projectId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'bids', projectId],
    queryFn: () => apiGet(`${projectPath(projectId.value ?? 0)}/bids`, MarketProjectBidsResponse),
    enabled: computed(() => enabled.value && projectId.value !== null),
  });
}

// 전문가 본인 입찰(없으면 data:null).
export function useMyBid(projectId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'my-bid', projectId],
    queryFn: () => apiGet(`${projectPath(projectId.value ?? 0)}/my-bid`, MarketMyBidResponse),
    enabled: computed(() => enabled.value && projectId.value !== null),
  });
}

export function useSubmitBid() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: MarketBidSubmitBodyType }) =>
      apiSend('POST', `${projectPath(projectId)}/bids`, body, MarketBidSubmitResponse),
    onSuccess: (_d, v) => {
      invalidate(v.projectId);
    },
  });
}

export function useUpdateMyBid() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: MarketBidSubmitBodyType }) =>
      apiSend('PATCH', `${projectPath(projectId)}/my-bid`, body, MarketBidSubmitResponse),
    onSuccess: (_d, v) => {
      invalidate(v.projectId);
    },
  });
}

export function useWithdrawMyBid() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${projectPath(projectId)}/my-bid/withdraw`, undefined, MarketBidWithdrawResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}

export function useAwardBid() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ projectId, bidId }: { projectId: number; bidId: number }) =>
      apiSend('POST', `${projectPath(projectId)}/bids/${String(bidId)}/award`, undefined, MarketAwardResponse),
    onSuccess: (_d, v) => {
      invalidate(v.projectId);
    },
  });
}

export function useSignNda() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: number; body: MarketNdaSignBodyType }) =>
      apiSend('POST', `${projectPath(projectId)}/nda`, body, MarketNdaSignResponse),
    onSuccess: (_d, v) => {
      invalidate(v.projectId);
    },
  });
}

export interface MyBidFilters {
  page: number;
  pageSize: number;
  status: '' | MarketBidStatusType;
}

// 내 입찰 목록(전문가).
export function useMyBidList(filters: Ref<MyBidFilters>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'my-bids', filters],
    queryFn: () => {
      const f = filters.value;
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('pageSize', String(f.pageSize));
      if (f.status !== '') params.set('status', f.status);
      return apiGet(`${apiRoutes.marketMyBids}?${params.toString()}`, MarketMyBidListResponse);
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}

// 나를 지정한 의뢰 인박스(전문가).
export function useTargetedProjects(page: Ref<number>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'targeted-projects', page],
    queryFn: () =>
      apiGet(
        `${apiRoutes.marketMyTargetedProjects}?page=${String(page.value)}&pageSize=20`,
        MarketTargetedProjectListResponse,
      ),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCloseProject() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${projectPath(projectId)}/close`, undefined, MarketProjectStatusResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}

export function useCancelProject() {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: number) =>
      apiSend('POST', `${projectPath(projectId)}/cancel`, undefined, MarketProjectStatusResponse),
    onSuccess: (_d, projectId) => {
      invalidate(projectId);
    },
  });
}
