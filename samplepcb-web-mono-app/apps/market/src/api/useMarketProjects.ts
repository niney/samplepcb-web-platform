import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  MarketMyProjectListResponse,
  MarketProjectCreateResponse,
  MarketProjectDetailResponse,
  MarketProjectListResponse,
  apiRoutes,
} from '@sp/api-contract';
import type { MarketProjectCategoryType, MarketProjectMethodType } from '@sp/api-contract';
import { apiGet, apiSendForm } from '@sp/shared';

// 프로젝트(의뢰) 서버 상태 훅 — 계약은 @sp/api-contract(market.ts), 호출은 @sp/shared
// (apiGet — 401 시 토큰 재발급 1회 내장. 공개 라우트도 토큰이 있으면 실려 개인화된다).

export interface ProjectListFilters {
  page: number;
  pageSize: number;
  tab: 'open' | 'closed' | 'awarded' | 'all';
  category: '' | MarketProjectCategoryType; // '' = 전체
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
  if (f.category !== '') params.set('category', f.category);
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
  });
}

// 의뢰 등록(multipart: payload + attachment[]).
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      apiSendForm('POST', apiRoutes.marketProjects, form, MarketProjectCreateResponse),
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
