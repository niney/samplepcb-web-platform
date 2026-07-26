import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  PartBulkDeletePreviewResponse,
  PartBulkDeleteResponse,
  PartDeleteResponse,
  PartDetailResponse,
  PartRefreshResponse,
  PartSearchResponse,
  PartsResetResponse,
  apiRoutes,
  type PartBulkDeleteBodyType,
  type PartBulkDeleteFilterType,
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

// 하드 삭제 — 오퍼·가격구간 cascade. 견적 연결 부품은 서버가 409로 보호한다.
export function useDeletePart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partId: string) => apiSend('DELETE', `${apiRoutes.adminParts}/${partId}`, undefined, PartDeleteResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
    },
  });
}

// 현재 검색 필터 전체 삭제 — preview hash와 건수 확인 문구를 실행 요청에 다시 보낸다.
export function usePreviewPartBulkDelete() {
  return useMutation({
    mutationFn: (filter: PartBulkDeleteFilterType) =>
      apiSend(
        'POST',
        `${apiRoutes.adminParts}/bulk-delete/preview`,
        { filter },
        PartBulkDeletePreviewResponse,
      ),
  });
}

export function useBulkDeleteParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PartBulkDeleteBodyType) =>
      apiSend('POST', `${apiRoutes.adminParts}/bulk-delete`, body, PartBulkDeleteResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
    },
  });
}

// 카탈로그 초기화 — 부품 전체와 partId·매칭·오퍼 스냅샷이 연결된 BOM 견적을 강제 삭제.
export function useResetParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend(
      'POST',
      `${apiRoutes.adminParts}/reset`,
      { confirm: 'RESET_WITH_QUOTES' },
      PartsResetResponse,
    ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'parts'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['bom', 'quotes'] });
    },
  });
}
