import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  DevDiagramRequestResponse,
  MarketMyProjectListResponse,
  MarketProjectCreateResponse,
  MarketProjectDetailResponse,
  MarketProjectListResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  MarketProjectMethodType,
  MarketProjectUpdateBodyType,
} from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';

// 프로젝트(의뢰) 서버 상태 훅 — 계약은 @sp/api-contract(market.ts), 호출은 @sp/shared
// (apiGet — 401 시 토큰 재발급 1회 내장. 공개 라우트도 토큰이 있으면 실려 개인화된다).

export interface ProjectListFilters {
  page: number;
  pageSize: number;
  tab: 'open' | 'closed' | 'awarded' | 'all';
  // 의뢰 유형 필터는 폐기(2026-08-28) — 분야 필터가 대체한다.
  serviceArea: string; // '' = 전체(레지스트리 분야 코드)
  method: '' | MarketProjectMethodType;
  q: string;
  sort: 'latest' | 'deadline';
}

const listPath = (f: ProjectListFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  params.set('sort', f.sort);
  if (f.serviceArea !== '') params.set('serviceArea', f.serviceArea);
  if (f.method !== '') params.set('method', f.method);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.marketProjects}?${params.toString()}`;
};

export function useMarketProjectList(filters: Ref<ProjectListFilters>) {
  return useQuery({
    queryKey: ['market', 'projects', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), MarketProjectListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useMarketProjectDetail(projectId: Ref<number | null>) {
  return useQuery({
    queryKey: ['market', 'projects', 'detail', projectId],
    queryFn: () =>
      apiGet(`${apiRoutes.marketProjects}/${String(projectId.value)}`, MarketProjectDetailResponse),
    enabled: computed(() => projectId.value !== null),
    // 정밀 구성도가 대기·생성 중이면 10초마다 다시 읽어 완성되는 순간 상세에 붙인다(§13.5).
    refetchInterval: (query) => {
      const status = query.state.data?.data.devDiagram.meta?.status;
      return status === 'queued' || status === 'running' ? 10_000 : false;
    },
  });
}

// 의뢰 등록(multipart: payload + attachment[]).
// 정밀 시스템 구성도 (재)생성 요청(소유자) — 서버 큐에 넣고 상태를 queued 로 바꾼다(§13.5).
export function useRequestDevDiagram(projectId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend(
        'POST',
        `${apiRoutes.marketProjects}/${String(projectId.value)}/dev-diagram`,
        {},
        DevDiagramRequestResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'projects', 'detail', projectId] });
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      apiSendForm('POST', apiRoutes.marketProjects, form, MarketProjectCreateResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'projects'] });
      void qc.invalidateQueries({ queryKey: ['market', 'my-projects'] });
      // 등록으로 구성도 잡이 프로젝트에 연결됐다 — 플로팅 트레이가 바로 "생성 중" 을 보이게(§13.7).
      void qc.invalidateQueries({ queryKey: ['market', 'my-dev-diagrams'] });
    },
  });
}

// 의뢰 수정(소유자·입찰 0건·접수 중) — 현재 마켓 화면이 쓰는 유일한 용도는
// AI 사전 검토서 제거({ devReview: null })다. 검토서 본문은 서버 저장분이 정본이라
// 갱신 경로가 없고, 제거만 계약에 열려 있다(MarketProjectUpdateBody).
export function useUpdateProject(projectId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MarketProjectUpdateBodyType) =>
      apiSend(
        'PATCH',
        `${apiRoutes.marketProjects}/${String(projectId.value)}`,
        body,
        MarketProjectCreateResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'projects'] });
      void qc.invalidateQueries({ queryKey: ['market', 'my-projects'] });
    },
  });
}

export interface MyProjectFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'bidding' | 'awarded' | 'working' | 'completed' | 'closed' | 'cancelled';
}

export function useMyProjectList(filters: Ref<MyProjectFilters>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'my-projects', filters],
    queryFn: () => {
      const f = filters.value;
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('pageSize', String(f.pageSize));
      params.set('tab', f.tab);
      return apiGet(`${apiRoutes.marketMyProjects}?${params.toString()}`, MarketMyProjectListResponse);
    },
    enabled,
    placeholderData: keepPreviousData,
  });
}
