import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query';
import { apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';
import {
  AdminPcbRemittanceDetailResponse,
  AdminPcbRemittanceListResponse,
  AdminPcbRemittancePartnerResponse,
  PcbRemittanceMutationResponse,
  apiRoutes,
  type AdminPcbRemittanceTabType,
  type PcbRemittanceCreateBodyType,
  type PcbRemittancePatchBodyType,
} from '@sp/api-contract';

// PCB 송금 원장 클라이언트(P3.11) — 목록·협력사별 집계·발주서별 내역·기록/수정/삭제.
// 송금이 바뀌면 발주(remittedAt 파생)·Case 상세·진행현황도 영향을 받으므로 함께 비운다.

export interface AdminPcbRemittanceFilters {
  tab: AdminPcbRemittanceTabType;
  q: string;
  page: number;
  pageSize: number;
  partnerId?: number;
}

const invalidate = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbRemittance'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbCase'] });
};

const listUrl = (f: AdminPcbRemittanceFilters): string => {
  const params = new URLSearchParams({
    tab: f.tab,
    page: String(f.page),
    pageSize: String(f.pageSize),
  });
  if (f.q !== '') params.set('q', f.q);
  if (f.partnerId !== undefined) params.set('partnerId', String(f.partnerId));
  return `${apiRoutes.adminPcbRemittances}?${params.toString()}`;
};

export function useAdminPcbRemittances(filters: Ref<AdminPcbRemittanceFilters>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'pcbRemittance', 'list', filters.value] as const),
    queryFn: () => apiGet(listUrl(filters.value), AdminPcbRemittanceListResponse),
  });
}

/** 사이드바 배지 — 송금 대기(발주됐는데 한 푼도 안 나간 건) 수. */
export function usePcbRemittancePendingCount(enabled: Ref<boolean>) {
  const query = useQuery({
    queryKey: ['admin', 'pcbRemittance', 'pendingCount'] as const,
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbRemittances}?tab=pending&page=1&pageSize=1`,
        AdminPcbRemittanceListResponse,
      ),
    enabled,
    staleTime: 30_000,
  });
  return computed(() => query.data.value?.data.counts.pending ?? 0);
}

export function useAdminPcbRemittancePartners(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbRemittance', 'partners'] as const,
    queryFn: () =>
      apiGet(`${apiRoutes.adminPcbRemittances}/partners`, AdminPcbRemittancePartnerResponse),
    enabled,
  });
}

/** 발주서 1건의 송금 내역 — 상세 패널이 열릴 때만 조회한다. */
export function useAdminPcbRemittanceDetail(poId: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'pcbRemittance', 'detail', poId.value] as const),
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbRemittances}/${String(poId.value)}`,
        AdminPcbRemittanceDetailResponse,
      ),
    enabled: computed(() => poId.value !== null),
  });
}

export function useCreatePcbRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: PcbRemittanceCreateBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbRemittances}/${String(poId)}`,
        body,
        PcbRemittanceMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function usePatchPcbRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      remittanceId,
      body,
    }: {
      poId: number;
      remittanceId: number;
      body: PcbRemittancePatchBodyType;
    }) =>
      apiSend(
        'PATCH',
        `${apiRoutes.adminPcbRemittances}/${String(poId)}/${String(remittanceId)}`,
        body,
        PcbRemittanceMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeletePcbRemittance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, remittanceId }: { poId: number; remittanceId: number }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbRemittances}/${String(poId)}/${String(remittanceId)}`,
        undefined,
        PcbRemittanceMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useUploadRemittanceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      remittanceId,
      file,
    }: {
      poId: number;
      remittanceId: number;
      file: File;
    }) => {
      const form = new FormData();
      form.append('file', file);
      return apiSendForm(
        'POST',
        `${apiRoutes.adminPcbRemittances}/${String(poId)}/${String(remittanceId)}/files`,
        form,
        PcbRemittanceMutationResponse,
      );
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteRemittanceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      remittanceId,
      fileId,
    }: {
      poId: number;
      remittanceId: number;
      fileId: number;
    }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbRemittances}/${String(poId)}/${String(remittanceId)}/files/${String(fileId)}`,
        undefined,
        PcbRemittanceMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 증빙 다운로드 — 관리자 라우트는 Bearer 가 필요해 <a href> 직링크가 안 된다. */
export async function downloadRemittanceFile(
  poId: number,
  remittanceId: number,
  fileId: number,
  fileName: string,
): Promise<void> {
  const blob = await apiGetBlob(
    `${apiRoutes.adminPcbRemittances}/${String(poId)}/${String(remittanceId)}/files/${String(fileId)}`,
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
