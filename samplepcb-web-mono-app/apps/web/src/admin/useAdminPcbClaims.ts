import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';
import {
  AdminPcbClaimListResponse,
  AdminPcbClaimMutateResponse,
  apiRoutes,
  type AdminPcbClaimCreateBodyType,
  type AdminPcbClaimListQueryType,
  type AdminPcbClaimReturnBodyType,
  type AdminPcbClaimTransitionBodyType,
} from '@sp/api-contract';

// PCB 고객 클레임(A/S 접수, P5) 관리자 훅 — useAdminBomClaims 미러 + 스펙 축 패널·
// 대리 접수·회수 기록·판정(재생산 핸드오프 포함). 판정은 A/S 케이스를 만들 수 있어
// 케이스 패널 쿼리까지 무효화한다.

export interface AdminPcbClaimFilters {
  page: number;
  pageSize: number;
  status: AdminPcbClaimListQueryType['status'];
  search: string;
}

const base = apiRoutes.adminPcbClaims;

export function useAdminPcbClaims(filters: Ref<AdminPcbClaimFilters>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'pcb-claims', 'list', filters.value]),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
        status: filters.value.status,
      });
      const search = filters.value.search.trim();
      if (search !== '') params.set('search', search);
      return apiGet(`${base}?${params.toString()}`, AdminPcbClaimListResponse);
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Case 상세 패널 — 스펙 축 클레임 전량. */
export function useAdminPcbSpecClaims(specId: Ref<bigint | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'pcb-claims', 'spec', String(specId.value)]),
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbProjects}/${String(specId.value)}/claims`,
        AdminPcbClaimListResponse,
      ),
    enabled: computed(() => specId.value !== null),
    retry: false,
  });
}

/** 사이드바 배지 = 접수+검토 중인 관리자 미처리 건수(BOM 배지 미러). */
export function usePcbClaimsPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcb-claims', 'pending-count'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1&status=pending`, AdminPcbClaimListResponse),
    enabled,
    select: (response) => response.data.counts.pending,
    refetchInterval: 60_000,
  });
}

const invalidateClaims = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcb-claims'] });
};

/** 대리 접수(전화·메일 건) — byRole=admin. */
export function useCreateAdminPcbClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, body }: { specId: bigint; body: AdminPcbClaimCreateBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/claims`,
        body,
        AdminPcbClaimMutateResponse,
      ),
    onSuccess: () => { invalidateClaims(qc); },
  });
}

/** 판정 전이(검토 시작·처리 확정·처리 불가) — reproduce 는 A/S 케이스까지 만든다. */
export function useTransitionAdminPcbClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, body }: { claimId: string; body: AdminPcbClaimTransitionBodyType }) =>
      apiSend('PATCH', `${base}/${claimId}`, body, AdminPcbClaimMutateResponse),
    onSuccess: () => {
      invalidateClaims(qc);
      // 재생산 핸드오프가 케이스 초안을 만들 수 있다 — A/S 패널(pcbAs 키)도 함께 갱신.
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbAs'] });
    },
  });
}

/** 회수 기록(자유 메모) — 전이 아님, 최종쓰기 우선. */
export function useAdminPcbClaimReturn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, body }: { claimId: string; body: AdminPcbClaimReturnBodyType }) =>
      apiSend('PATCH', `${base}/${claimId}/return`, body, AdminPcbClaimMutateResponse),
    onSuccess: () => { invalidateClaims(qc); },
  });
}

/** 관리자 첨부(대리 접수 건 사진) — 열린 상태에서만. */
export function useUploadAdminPcbClaimFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ claimId, file }: { claimId: string; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      return apiSendForm('POST', `${base}/${claimId}/files`, form, AdminPcbClaimMutateResponse);
    },
    onSuccess: () => { invalidateClaims(qc); },
  });
}

export async function downloadAdminPcbClaimFile(
  claimId: string,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(`${base}/${claimId}/files/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
