import { computed, type Ref } from 'vue';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/vue-query';
import {
  AdminCompanyNameResponse,
  AdminConfirmPriceResponse,
  AdminEstimateResponse,
  AdminQuoteDetailResponse,
  AdminQuoteListResponse,
  apiRoutes,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend } from '@sp/shared';

// 관리자 견적 관리(/admin/quotes) 서버 상태 훅 모음.
// 계약은 @sp/api-contract(admin.ts), 호출은 @sp/shared(apiGet/apiSend — 401 시
// 토큰 재발급 1회 내장)를 그대로 쓴다.

export interface AdminQuoteFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'rfq' | 'priced' | 'quoted' | 'carted';
  includeDeleted: boolean; // true 면 status=all(보관함 포함)
  category: string; // '' = 전체
  q: string; // '' = 미검색 (회원ID·프로젝트명)
  from: string; // '' = 미지정 (YYYY-MM-DD)
  to: string;
}

const listPath = (f: AdminQuoteFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  params.set('status', f.includeDeleted ? 'all' : 'active');
  if (f.category !== '') params.set('category', f.category);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  if (f.from !== '') params.set('from', f.from);
  if (f.to !== '') params.set('to', f.to);
  return `${apiRoutes.adminPcbProjects}?${params.toString()}`;
};

export function useAdminQuoteList(filters: Ref<AdminQuoteFilters>) {
  return useQuery({
    queryKey: ['admin', 'quotes', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminQuoteListResponse),
    // 페이지·필터 전환 중 직전 데이터 유지(테이블 깜빡임 방지)
    placeholderData: keepPreviousData,
  });
}

export function useAdminQuoteDetail(projectId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'quotes', 'detail', projectId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbProjects}/${String(projectId.value)}`,
        AdminQuoteDetailResponse,
      ),
    enabled: computed(() => projectId.value !== null),
  });
}

// 견적서(A4) 표시 데이터 — 견적서 모달 open(projectId != null) 시에만 fetch.
export function useAdminEstimate(projectId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'quotes', 'estimate', projectId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbProjects}/${String(projectId.value)}/estimate`,
        AdminEstimateResponse,
      ),
    enabled: computed(() => projectId.value !== null),
  });
}

// 사이드바 "견적 관리" rfq 대기 수 뱃지 — 목록 API 최소 호출(pageSize=1)로 counts 만
// 취한다(전용 카운트 API 를 만들지 않음). 확정 성공 시 ['admin','quotes'] 접두
// 무효화에 함께 걸려 갱신된다.
export function useRfqCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'quotes', 'rfq-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbProjects}?page=1&pageSize=1`,
        AdminQuoteListResponse,
      );
      return res.data.counts.rfq;
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useConfirmPrice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, finalPrice }: { projectId: number; finalPrice: number }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminPcbProjects}/${String(projectId)}/price`,
        { finalPrice },
        AdminConfirmPriceResponse,
      ),
    onSuccess: async () => {
      // 접두 무효화 — 목록·상세·rfq 뱃지 일괄 갱신
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quotes'] });
    },
  });
}

// 수신처 회사명 저장(2층 구조) — 스냅샷 저장 + 회원이면 프로필 기억. 성공 시 ['admin',
// 'quotes'] 접두 무효화로 상세·목록·견적서(estimate) 프리필까지 갱신(useConfirmPrice 관례).
// 빈 문자열은 스냅샷 삭제 신호(서버가 프로필 fallback 을 반영한 값으로 응답).
export function useSaveCompanyName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, companyName }: { projectId: number; companyName: string }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminPcbProjects}/${String(projectId)}/company-name`,
        { companyName },
        AdminCompanyNameResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quotes'] });
    },
  });
}

// 거버 원본 등 파일 다운로드 — 관리자 라우트는 Bearer 가 필요해 <a href> 직링크가
// 불가하므로 fetch→blob→objectURL 로 저장한다.
export async function downloadAdminFile(fileId: number, fileName: string): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminPcbFiles}/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
