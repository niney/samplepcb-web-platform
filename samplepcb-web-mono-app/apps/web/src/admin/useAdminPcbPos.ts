import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbEqReviewListResponse,
  AdminPcbPoListResponse,
  AdminPcbPoWorkListResponse,
  AdminPcbShipmentWorkListResponse,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  apiRoutes,
  type AdminPcbEqReviewCreateBodyType,
  type AdminPcbPoCreateBodyType,
  type AdminPcbPoPatchBodyType,
  type AdminPcbPoTabType,
  type AdminPcbShipmentTabType,
  type BomInvoiceDataType,
  type PcbShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';

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

// 발주서 축 counts — 사이드바 배지 둘이 나눠 쓴다: 발주·EQ 는 eq_pending(EQ 승인
// 대기), 선적·배송은 to_ship(발송 대기). 두 배지 모두 "그 역할이 지금 움직여야 하는
// 수"라 각각 대기 큐 수와 합산된다(AdminLayout).
export function usePcbPoWorkCounts(enabled: Ref<boolean>) {
  const query = useQuery({
    queryKey: ['admin', 'pcbPo', 'work-counts'],
    queryFn: () =>
      apiGet(`${apiRoutes.adminPcbPos}?page=1&pageSize=1&tab=all`, AdminPcbPoWorkListResponse),
    enabled,
    refetchInterval: 60_000,
  });
  return {
    eqPending: computed(() => query.data.value?.data.counts.eq_pending ?? 0),
    toShip: computed(() => query.data.value?.data.counts.to_ship ?? 0),
  };
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

// ── EQ·생산 대행(D11) — 협력사 포털 미온보딩(레거시 진행분) 대비 ──────────────
export type AdminPcbEqSubstituteAction = 'eq-request' | 'production-start' | 'production-complete';

export function useAdminPcbEqSubstitute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specId,
      poId,
      action,
    }: {
      specId: number;
      poId: number;
      action: AdminPcbEqSubstituteAction;
    }) =>
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
}

export function useUploadAdminPcbEqFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specId,
      poId,
      file,
      fileType,
    }: {
      specId: number;
      poId: number;
      file: File;
      fileType: 'eq' | 'working';
    }) => {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', file);
      return apiSendForm(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/eq-files`,
        form,
        PcbPoActionResponse,
      );
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteAdminPcbEqFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId, fileId }: { specId: number; poId: number; fileId: number }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/eq-files/${String(fileId)}`,
        {},
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

// ═══ P3 선적 — 관리자 전이·입고확인·워크큐·송장 ═══════════════════════════════

export interface AdminPcbShipmentFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbShipmentTabType;
}

export function useAdminPcbShipmentWork(filters: Ref<AdminPcbShipmentFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbShipment', 'work', filters],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbShipments}?page=${String(filters.value.page)}&pageSize=${String(filters.value.pageSize)}&tab=${filters.value.tab}`,
        AdminPcbShipmentWorkListResponse,
      ),
    placeholderData: keepPreviousData,
  });
}

// 사이드바 '선적·배송' 배지 — 관리자 차례 발송 수.
export function usePcbShipmentPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbShipment', 'pending-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbShipments}?page=1&pageSize=1&tab=all`,
        AdminPcbShipmentWorkListResponse,
      );
      return res.data.counts.pending;
    },
    enabled,
    refetchInterval: 60_000,
  });
}

const shipmentInvalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbShipment'] });
};

const shipmentAction = (
  qc: ReturnType<typeof useQueryClient>,
  action: 'advance' | 'box' | 'revert',
) =>
  useMutation({
    mutationFn: ({
      specId,
      poId,
      body,
    }: {
      specId: number;
      poId: number;
      body?: PcbShipmentAdvanceBodyType;
    }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/${action}`,
        body ?? {},
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      shipmentInvalidate(qc);
    },
  });

export function useAdminPcbShipmentAdvance() {
  return shipmentAction(useQueryClient(), 'advance');
}
/** 담기(박스만 확보) — 관리자 대행의 발송 시작점. 협력사 포털의 [담기]와 같은 일을 한다.
 *  담고 나면 선적 줄이 서고, 이후 전이는 기존 [~ 진행]이 모드에 맞는 입력을 묻는다. */
export function useAdminPcbShipmentBox() {
  return shipmentAction(useQueryClient(), 'box');
}
export function useAdminPcbShipmentRevert() {
  return shipmentAction(useQueryClient(), 'revert');
}

/** 선적 취소(문서 삭제) — 발송 전·입고 전만. 견적 삭제의 SHIPMENT_EXISTS 를 푸는 출구. */
export function useAdminPcbShipmentCancel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId }: { specId: number; poId: number }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment`,
        {},
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      shipmentInvalidate(qc);
    },
  });
}

export function useAdminPcbShipmentReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId, note }: { specId: number; poId: number; note: string | null }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/receive`,
        { note },
        AdminPcbPoListResponse,
      ),
    onSuccess: () => {
      shipmentInvalidate(qc);
    },
  });
}

export async function downloadAdminPcbShipmentFile(
  specId: number,
  poId: number,
  fileId: number,
  fileName: string,
): Promise<void> {
  const blob = await apiGetBlob(
    `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/files/${String(fileId)}`,
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

// 상업송장 — InvoiceEditorModal 콜백 주입(관리자측).
export const adminPcbInvoiceApi = (specId: number, poId: number) => ({
  loadDraft: async (fresh: boolean) =>
    (
      await apiGet(
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/invoice?fresh=${fresh ? 'true' : 'false'}`,
        PcbInvoiceResponse,
      )
    ).data,
  saveDraft: (data: BomInvoiceDataType) =>
    apiSend(
      'PUT',
      `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/invoice`,
      data,
      PcbPoActionResponse,
    ),
  renderXlsx: (data: BomInvoiceDataType) =>
    apiSendBlob(
      'POST',
      `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/invoice/xlsx`,
      data,
    ),
  attachPdf: async (_file: File) => {
    // 관리자 PDF 첨부는 파일 업로드 라우트로 — P3 후속(현재 엑셀·저장만).
    await Promise.resolve();
  },
});

// ── EQ 고객 확인(P4.1) — docs/PCB_PARTNER_TRACK.md D16 ───────────────────────
// 협력사 EQ 를 고객에게 물어보는 별도 축. 승인해도 EQ 전이는 관리자 몫이라
// 발주 패널 캐시만 갱신하면 된다.
export function useAdminPcbEqReviews(poId: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'pcbEqReview', poId.value] as const),
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbEqReviews}/${String(poId.value)}`,
        AdminPcbEqReviewListResponse,
      ),
    enabled: computed(() => poId.value !== null),
  });
}

export function useCreatePcbEqReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: AdminPcbEqReviewCreateBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbEqReviews}/${String(poId)}`,
        body,
        AdminPcbEqReviewListResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbEqReview'] });
    },
  });
}

export function useCancelPcbEqReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, reviewId }: { poId: number; reviewId: number }) =>
      apiSend(
        'DELETE',
        `${apiRoutes.adminPcbEqReviews}/${String(poId)}/${String(reviewId)}`,
        undefined,
        AdminPcbEqReviewListResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbEqReview'] });
    },
  });
}
