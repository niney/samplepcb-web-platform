import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminMemberDetailResponse,
  AdminMemberInterceptResponse,
  AdminMemberLevelResponse,
  AdminMemberListResponse,
  AdminMemberProfileResponse,
  apiRoutes,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 관리자 회원 관리(/admin/members) 서버 상태 훅 모음. 계약은 @sp/api-contract(members.ts),
// 호출은 @sp/shared(apiGet/apiSend — 401 시 토큰 재발급 1회 내장). 견적 관리 훅
// (useAdminQuotes.ts)의 queryKey·invalidate 관례를 그대로 따른다.

export interface AdminMemberFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'normal' | 'intercepted' | 'left';
  q: string; // '' = 미검색 (아이디·이름·닉네임·이메일·휴대폰)
  from: string; // '' = 미지정 (YYYY-MM-DD)
  to: string;
  sort: 'joined' | 'lastLogin';
}

const listPath = (f: AdminMemberFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  params.set('sort', f.sort);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  if (f.from !== '') params.set('from', f.from);
  if (f.to !== '') params.set('to', f.to);
  return `${apiRoutes.adminMembers}?${params.toString()}`;
};

export function useAdminMemberList(filters: Ref<AdminMemberFilters>) {
  return useQuery({
    queryKey: ['admin', 'members', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminMemberListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useAdminMemberDetail(mbId: Ref<string | null>) {
  return useQuery({
    queryKey: ['admin', 'members', 'detail', mbId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminMembers}/${encodeURIComponent(String(mbId.value))}`,
        AdminMemberDetailResponse,
      ),
    enabled: computed(() => mbId.value !== null),
  });
}

// 차단/해제 — 성공 시 ['admin','members'] 접두 무효화(목록 counts·상세 상태 갱신).
export function useSetIntercept() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mbId, intercept }: { mbId: string; intercept: boolean }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminMembers}/${encodeURIComponent(mbId)}/intercept`,
        { intercept },
        AdminMemberInterceptResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    },
  });
}

// 레벨 변경 — 성공 시 ['admin','members'] 접두 무효화.
export function useSetLevel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mbId, level }: { mbId: string; level: number }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminMembers}/${encodeURIComponent(mbId)}/level`,
        { level },
        AdminMemberLevelResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
    },
  });
}

// 회사명(sp 프로필층) 저장 — 회사명 해석값은 견적 관리 드로어·목록에도 나타나므로
// ['admin','members'] + ['admin','quotes'] 양쪽 무효화(2층 구조 연동).
export function useSaveMemberProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ mbId, companyName }: { mbId: string; companyName: string }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminMembers}/${encodeURIComponent(mbId)}/profile`,
        { companyName },
        AdminMemberProfileResponse,
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'quotes'] });
    },
  });
}
