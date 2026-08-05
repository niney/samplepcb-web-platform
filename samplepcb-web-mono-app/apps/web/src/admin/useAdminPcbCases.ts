import { computed, type Ref } from 'vue';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
import {
  AdminPcbCaseListResponse,
  apiRoutes,
  type AdminPcbCaseTabType,
} from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// PCB 진행현황 + 역할별 대기 큐 훅 — 한 엔드포인트가 구간 조감과 "시작 전" 큐를
// 함께 공급한다(계약 pcb-cases.ts 주석). 대기 큐 탭(todo_rfq·todo_po)은 견적요청·
// 발주·EQ 화면의 첫 탭이 쓰고, counts 는 사이드바 배지가 함께 소비한다.

export interface AdminPcbCaseFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbCaseTabType;
  q: string;
}

const listPath = (f: AdminPcbCaseFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminPcbCases}?${params.toString()}`;
};

export function useAdminPcbCases(filters: Ref<AdminPcbCaseFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbCase', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminPcbCaseListResponse),
    placeholderData: keepPreviousData,
  });
}

/** 대기 큐 counts 만 필요한 곳(배지·다른 워크큐의 첫 탭 카운트) — 1행만 받아온다. */
export function useAdminPcbTodoCounts(enabled: Ref<boolean>) {
  const query = useQuery({
    queryKey: ['admin', 'pcbCase', 'todo-counts'],
    queryFn: () =>
      apiGet(`${apiRoutes.adminPcbCases}?page=1&pageSize=1&tab=all`, AdminPcbCaseListResponse),
    enabled,
    refetchInterval: 60_000,
  });
  return {
    todoRfq: computed(() => query.data.value?.data.counts.todoRfq ?? 0),
    todoPo: computed(() => query.data.value?.data.counts.todoPo ?? 0),
  };
}
