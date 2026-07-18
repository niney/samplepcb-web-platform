import { computed, type Ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import { apiGet } from '@sp/shared';
import {
  PartDetailResponse,
  PartSearchResponse,
  apiRoutes,
  type PartSearchQueryType,
} from '@sp/api-contract';

// 부품 카탈로그 검색/상세 — /api/admin/parts (ES 검색 + DB 상세)

export type PartSearchFilters = Partial<
  Pick<PartSearchQueryType, 'manufacturer' | 'packageCode' | 'supplier' | 'inStockOnly' | 'sort' | 'page' | 'pageSize'>
>;

function toQueryString(q: string, filters: PartSearchFilters): string {
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (filters.manufacturer !== undefined) params.set('manufacturer', filters.manufacturer);
  if (filters.packageCode !== undefined) params.set('packageCode', filters.packageCode);
  if (filters.supplier !== undefined) params.set('supplier', filters.supplier);
  if (filters.inStockOnly === true) params.set('inStockOnly', 'true');
  if (filters.sort !== undefined) params.set('sort', filters.sort);
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.pageSize !== undefined) params.set('pageSize', String(filters.pageSize));
  return params.toString();
}

export function usePartSearch(q: Ref<string>, filters: Ref<PartSearchFilters>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'parts', 'search', q.value, filters.value]),
    queryFn: () =>
      apiGet(`${apiRoutes.adminParts}/search?${toQueryString(q.value, filters.value)}`, PartSearchResponse),
    enabled,
    retry: false,
    placeholderData: (prev) => prev, // 페이지 전환 시 깜빡임 방지
  });
}

export function usePartDetail(partId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'parts', 'detail', partId.value]),
    queryFn: () => apiGet(`${apiRoutes.adminParts}/${partId.value ?? ''}`, PartDetailResponse),
    enabled: computed(() => partId.value !== null),
    retry: false,
  });
}
