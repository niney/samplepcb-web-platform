import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbPoListResponse,
  AdminPcbPoWorkListResponse,
  PcbPoActionResponse,
  apiRoutes,
  type AdminPcbPoCreateBodyType,
  type AdminPcbPoPatchBodyType,
  type AdminPcbPoTabType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend } from '@sp/shared';

// PCB 발주·EQ 관리자 훅(P2) — docs/PCB_PARTNER_TRACK.md §5.4.
// 무효화는 ['admin','pcbPo'] 접두 일괄(+Case RFQ 패널과 배지는 별개 키라 독립).

export interface AdminPcbPoWorkFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbPoTabType;
  q: string;
}

const workListPath = (f: AdminPcbPoWorkFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminPcbPos}?${params.toString()}`;
};

export function useAdminPcbPoWork(filters: Ref<AdminPcbPoWorkFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbPo', 'work', filters],
    queryFn: () => apiGet(workListPath(filters.value), AdminPcbPoWorkListResponse),
    placeholderData: keepPreviousData,
  });
}

// 사이드바 '발주·EQ' 배지 — 관리자 차례(EQ 승인 대기) 수.
export function usePcbEqPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbPo', 'eq-pending-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbPos}?page=1&pageSize=1&tab=all`,
        AdminPcbPoWorkListResponse,
      );
      return res.data.counts.eq_pending;
    },
    enabled,
    refetchInterval: 60_000,
  });
}

export function useAdminPcbPos(specId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'pcbPo', 'list', specId],
    queryFn: () =>
      apiGet(`${apiRoutes.adminPcbProjects}/${String(specId.value)}/pos`, AdminPcbPoListResponse),
    enabled: computed(() => specId.value !== null),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
};

export function useCreatePcbPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, body }: { specId: number; body: AdminPcbPoCreateBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos`,
        body,
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function usePatchPcbPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specId,
      poId,
      body,
    }: {
      specId: number;
      poId: number;
      body: AdminPcbPoPatchBodyType;
    }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}`,
        body,
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeletePcbPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId }: { specId: number; poId: number }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}`,
        {},
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

const eqAction = (
  qc: ReturnType<typeof useQueryClient>,
  action: 'eq-approve' | 'eq-revert',
) =>
  useMutation({
    mutationFn: ({ specId, poId }: { specId: number; poId: number }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/${action}`,
        {},
        PcbPoActionResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });

export function useApprovePcbEq() {
  return eqAction(useQueryClient(), 'eq-approve');
}

export function useAdminRevertPcbEq() {
  return eqAction(useQueryClient(), 'eq-revert');
}

export function useRejectPcbEq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId, reason }: { specId: number; poId: number; reason: string }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/eq-reject`,
        { reason },
        PcbPoActionResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export async function downloadAdminPcbEqFile(
  specId: number,
  poId: number,
  fileId: number,
  fileName: string,
): Promise<void> {
  const blob = await apiGetBlob(
    `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/eq-files/${String(fileId)}`,
  );
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
