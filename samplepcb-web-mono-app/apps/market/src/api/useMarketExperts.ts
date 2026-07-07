import { computed, type Ref } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import {
  MarketExpertDetailResponse,
  MarketExpertListResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  MarketCadToolCodeType,
  MarketCategoryCodeType,
  MarketExpertTypeType,
} from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// 전문가 공개 프로필 서버 상태 훅 — 목록·상세는 비로그인 열람 가능(공개 계약 필드만).

export interface ExpertListFilters {
  page: number;
  pageSize: number;
  expertType: '' | MarketExpertTypeType; // '' = 전체
  category: '' | MarketCategoryCodeType;
  cadTool: '' | MarketCadToolCodeType;
  q: string;
}

const listPath = (f: ExpertListFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  if (f.expertType !== '') params.set('expertType', f.expertType);
  if (f.category !== '') params.set('category', f.category);
  if (f.cadTool !== '') params.set('cadTool', f.cadTool);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.marketExperts}?${params.toString()}`;
};

export function useMarketExpertList(filters: Ref<ExpertListFilters>) {
  return useQuery({
    queryKey: ['market', 'experts', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), MarketExpertListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useMarketExpertDetail(expertId: Ref<number | null>) {
  return useQuery({
    queryKey: ['market', 'experts', 'detail', expertId],
    queryFn: () =>
      apiGet(`${apiRoutes.marketExperts}/${String(expertId.value)}`, MarketExpertDetailResponse),
    enabled: computed(() => expertId.value !== null),
  });
}
