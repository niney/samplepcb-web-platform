import { type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminBomQuoteRetentionRunResponse,
  AdminBomQuoteRetentionStatusResponse,
  AdminDeleteAuditListResponse,
  apiRoutes,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 삭제 기록(sp_delete_audit)과 취소 견적 자동 정리 상태 — "삭제 기록" 화면 + 대시보드 위젯 공용.
// 계약은 admin-delete-audit.ts(api-contract), 필터 상태는 화면이 소유(useAdminMailLogs 관례).

export interface AdminDeleteAuditFilters {
  page: number;
  pageSize: number;
  subjectType: 'bom_case' | 'pcb_case' | ''; // '' = 전체
  actor: 'auto' | 'manual' | ''; // '' = 전체
  search: string; // '' = 미검색
  dateFrom: string; // '' = 미지정(YYYY-MM-DD, KST)
  dateTo: string;
}

export const emptyDeleteAuditFilters = (
  patch?: Partial<AdminDeleteAuditFilters>,
): AdminDeleteAuditFilters => ({
  page: 1,
  pageSize: 20,
  subjectType: '',
  actor: '',
  search: '',
  dateFrom: '',
  dateTo: '',
  ...patch,
});

const listPath = (f: AdminDeleteAuditFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  if (f.subjectType !== '') params.set('subjectType', f.subjectType);
  if (f.actor !== '') params.set('actor', f.actor);
  if (f.search.trim() !== '') params.set('search', f.search.trim());
  if (f.dateFrom !== '') params.set('dateFrom', f.dateFrom);
  if (f.dateTo !== '') params.set('dateTo', f.dateTo);
  return `${apiRoutes.adminDeleteAudits}?${params.toString()}`;
};

export function useAdminDeleteAuditList(filters: Ref<AdminDeleteAuditFilters>) {
  return useQuery({
    queryKey: ['admin', 'delete-audits', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminDeleteAuditListResponse),
    placeholderData: keepPreviousData,
  });
}

const RETENTION_KEY = ['admin', 'bom-quote-retention'] as const;

/** 자동 정리 상태 — 화면이 떠 있는 동안 1분마다 다시 본다(배치는 6시간 주기라 그보다 촘촘할 이유가 없다). */
export function useBomQuoteRetentionStatus() {
  return useQuery({
    queryKey: RETENTION_KEY,
    queryFn: () => apiGet(apiRoutes.adminBomQuoteRetention, AdminBomQuoteRetentionStatusResponse),
    refetchInterval: 60_000,
  });
}

/** 지금 실행 — 끝나면 상태를 응답값으로 바꾸고, 새로 쌓인 삭제 기록을 다시 불러온다. */
export function useRunBomQuoteRetention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend('POST', `${apiRoutes.adminBomQuoteRetention}/run`, undefined, AdminBomQuoteRetentionRunResponse),
    onSuccess: (res) => {
      qc.setQueryData(RETENTION_KEY, { result: true as const, data: res.data.status });
      void qc.invalidateQueries({ queryKey: ['admin', 'delete-audits'] });
    },
    // 겹쳐 눌렀거나(이미 실행 중) 꺼져 있을 때도 최신 상태는 다시 본다.
    onError: () => void qc.invalidateQueries({ queryKey: RETENTION_KEY }),
  });
}
