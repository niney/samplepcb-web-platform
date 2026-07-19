import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  PartDeleteResponse,
  PartDetailResponse,
  PartRefreshResponse,
  PartSearchResponse,
  PartsResetResponse,
  apiRoutes,
  type PartSearchQueryType,
} from '@sp/api-contract';

// 부품 카탈로그 검색/상세 — /api/admin/parts (ES 검색 + DB 상세)

export type PartSearchFilters = Partial<
  Pick<
    PartSearchQueryType,
    | 'manufacturer'
    | 'packageCode'
    | 'supplier'
    | 'inStockOnly'
    | 'sort'
    | 'page'
    | 'pageSize'
    | 'resistanceMin'
    | 'resistanceMax'
    | 'capacitanceMin'
    | 'capacitanceMax'
    | 'inductanceMin'
    | 'inductanceMax'
    | 'voltageMin'
    | 'voltageMax'
  >
>;

const RANGE_KEYS = [
  'resistanceMin',
  'resistanceMax',
  'capacitanceMin',
  'capacitanceMax',
  'inductanceMin',
  'inductanceMax',
  'voltageMin',
  'voltageMax',
] as const;

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
  for (const key of RANGE_KEYS) {
    const v = filters[key];
    if (v !== undefined) params.set(key, String(v));
  }
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

// 수동 갱신([공급사 갱신]) — 강제 라이브 검색→재인제스트 후 검색·상세 쿼리 무효화
export function useRefreshPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partId: string) =>
      apiSend('POST', `${apiRoutes.adminParts}/${partId}/refresh`, undefined, PartRefreshResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
    },
  });
}

// 하드 삭제 — 오퍼·가격구간 cascade, 견적 라인은 partId 만 해제(스냅샷 보존)
export function useDeletePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partId: string) => apiSend('DELETE', `${apiRoutes.adminParts}/${partId}`, undefined, PartDeleteResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
    },
  });
}

// 카탈로그 초기화 — 부품 전체 하드 삭제(자동 인제스트로 재성장)
export function useResetParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('POST', `${apiRoutes.adminParts}/reset`, { confirm: 'RESET' }, PartsResetResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
    },
  });
}
