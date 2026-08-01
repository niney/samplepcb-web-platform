import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';
import {
  AdminBomPartPackageResponse,
  AdminBomPoCreateResponse,
  AdminBomPoCrossListResponse,
  AdminBomPoListResponse,
  AdminBomPoMutationResponse,
  AdminBomShipmentCrossListResponse,
  BomInvoiceDraftResponse,
  BomShipmentPackingListResponse,
  apiRoutes,
  type AdminBomPartPackageActionBodyType,
  type AdminBomPoCreateBodyType,
  type AdminBomPoCrossListQueryType,
  type AdminBomShipmentCrossListQueryType,
  type AdminBomShipmentReceiveBodyType,
  type AdminBomShipmentUpsertBodyType,
  type BomInvoiceDataType,
  type BomShipmentPackingListSaveBodyType,
  type BomShipmentPackingListType,
  type BomShipmentFileTypeType,
} from '@sp/api-contract';

// 협력사 발주서(D18) — /api/admin/bom-quotes/:id/pos (requireAdmin)

const base = apiRoutes.adminBomQuotes;

export function useAdminBomPos(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-pos', quoteId.value]),
    queryFn: () => apiGet(`${base}/${quoteId.value ?? ''}/pos`, AdminBomPoListResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] }); // poCount 파생 갱신
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-shipments'] }); // 횡단 워크큐 갱신
};

// ── 횡단 워크큐(관리자 메뉴 재편) — 발주/선적·배송 메뉴 목록 ─────────────────

export interface AdminBomPoCrossFilters {
  page: number;
  pageSize: number;
  tab: AdminBomPoCrossListQueryType['tab'];
}

export function useAdminBomPoCross(filters: Ref<AdminBomPoCrossFilters>) {
  return useQuery({
    queryKey: ['admin', 'bom-pos', 'cross', filters],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
        tab: filters.value.tab,
      });
      return apiGet(`${apiRoutes.adminBomPos}?${params.toString()}`, AdminBomPoCrossListResponse);
    },
    placeholderData: keepPreviousData,
  });
}

export interface AdminBomShipmentCrossFilters {
  page: number;
  pageSize: number;
  tab: AdminBomShipmentCrossListQueryType['tab'];
}

export function useAdminBomShipmentCross(filters: Ref<AdminBomShipmentCrossFilters>) {
  return useQuery({
    queryKey: ['admin', 'bom-shipments', 'cross', filters],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(filters.value.page),
        pageSize: String(filters.value.pageSize),
        tab: filters.value.tab,
      });
      return apiGet(
        `${apiRoutes.adminBomShipments}?${params.toString()}`,
        AdminBomShipmentCrossListResponse,
      );
    },
    placeholderData: keepPreviousData,
  });
}

export function useCreateBomPos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomPoCreateBodyType }) =>
      apiSend('POST', `${base}/${quoteId}/pos`, body, AdminBomPoCreateResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteBomPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('DELETE', `${base}/${quoteId}/pos/${String(poId)}`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useCloseBomPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('POST', `${base}/${quoteId}/pos/${String(poId)}/close`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 선적 등록/수정(D21) — 발주서당 1건, mode 는 생성 시 박제.
export function useUpsertBomShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      poId,
      body,
    }: {
      quoteId: string;
      poId: number;
      body: AdminBomShipmentUpsertBodyType;
    }) =>
      apiSend('PUT', `${base}/${quoteId}/pos/${String(poId)}/shipment`, body, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 입고 확인(검수 ⑩, D21-2) — 편차 메모와 함께 최종 단계로 마감.
export function useReceiveBomShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      poId,
      body,
    }: {
      quoteId: string;
      poId: number;
      body: AdminBomShipmentReceiveBodyType;
    }) =>
      apiSend('POST', `${base}/${quoteId}/pos/${String(poId)}/shipment/receive`, body, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 묶음에서 제외(§6.10) — 대표 불가·발송 준비 단계만(협력사와 같은 규칙).
export function useDetachBomShipmentPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend(
        'DELETE',
        `${base}/${quoteId}/pos/${String(poId)}/shipment/membership`,
        undefined,
        AdminBomPoMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 선적 첨부(D22) — 종류별 1건(재업로드=교체), 실파일은 파일서버·메타는 sp_file.
export function useUploadBomShipmentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      poId,
      fileType,
      file,
    }: {
      quoteId: string;
      poId: number;
      fileType: BomShipmentFileTypeType;
      file: File;
    }) => {
      const form = new FormData();
      form.append('fileType', fileType);
      form.append('file', file);
      return apiSendForm(
        'POST',
        `${base}/${quoteId}/pos/${String(poId)}/shipment/files`,
        form,
        AdminBomPoMutationResponse,
      );
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteBomShipmentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId, fileId }: { quoteId: string; poId: number; fileId: number }) =>
      apiSend(
        'DELETE',
        `${base}/${quoteId}/pos/${String(poId)}/shipment/files/${String(fileId)}`,
        undefined,
        AdminBomPoMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 첨부 다운로드 — Bearer 필요라 <a href> 불가, blob → objectURL 저장(관례). */
export async function downloadBomShipmentFile(
  quoteId: string,
  poId: number,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(`${base}/${quoteId}/pos/${String(poId)}/shipment/files/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 상업송장 생성기(D23) API 묶음 — InvoiceEditorModal 콜백 주입용(관리자 대리 작성). */
export const adminInvoiceApi = (quoteId: string, poId: number) => ({
  loadDraft: (fresh: boolean): Promise<BomInvoiceDataType> =>
    apiGet(
      `${base}/${quoteId}/pos/${String(poId)}/shipment/invoice?fresh=${String(fresh)}`,
      BomInvoiceDraftResponse,
    ).then((res) => res.data),
  saveDraft: (data: BomInvoiceDataType) =>
    apiSend(
      'PUT',
      `${base}/${quoteId}/pos/${String(poId)}/shipment/invoice`,
      data,
      BomInvoiceDraftResponse,
    ),
  renderXlsx: (data: BomInvoiceDataType): Promise<Blob> =>
    apiSendBlob('POST', `${base}/${quoteId}/pos/${String(poId)}/shipment/invoice/xlsx`, data),
});

/** 선적 리스트·QR 라벨(D24) — 관리자 대리 작성·재인쇄. */
export const adminPackingApi = (shipmentId: number) => ({
  load: (): Promise<BomShipmentPackingListType> =>
    apiGet(
      `${apiRoutes.adminBomShipments}/${String(shipmentId)}/packing-list`,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
  save: (body: BomShipmentPackingListSaveBodyType) =>
    apiSend(
      'PUT',
      `${apiRoutes.adminBomShipments}/${String(shipmentId)}/packing-list`,
      body,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
  markPrinted: () =>
    apiSend(
      'POST',
      `${apiRoutes.adminBomShipments}/${String(shipmentId)}/packing-list/print`,
      undefined,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
});

/** QR token 또는 인쇄된 labelCode로 실물 포장 추적 원장을 조회한다. */
export function useAdminBomPackage(code: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-package', code.value]),
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminBomPackages}/${encodeURIComponent(code.value ?? '')}`,
        AdminBomPartPackageResponse,
      ),
    enabled: computed(() => code.value !== null && code.value !== ''),
    retry: false,
  });
}

export function useAdminBomPackageAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, body }: { code: string; body: AdminBomPartPackageActionBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminBomPackages}/${encodeURIComponent(code)}/actions`,
        body,
        AdminBomPartPackageResponse,
      ),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-package', variables.code] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-shipments'] });
    },
  });
}

// 외부 실행 재시도/재발급(D20) — Mouser 카트 담기·DigiKey single-use 리스트.
export function useExecuteExternalPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, poId }: { quoteId: string; poId: number }) =>
      apiSend('POST', `${base}/${quoteId}/pos/${String(poId)}/external`, undefined, AdminBomPoMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}
