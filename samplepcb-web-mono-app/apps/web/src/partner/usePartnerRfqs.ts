import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';
import {
  BomInvoiceDraftResponse,
  PartnerPoDetailResponse,
  PartnerPoListResponse,
  PartnerRfqDetailResponse,
  PartnerRfqListResponse,
  apiRoutes,
  type BomInvoiceDataType,
  type BomRfqReplyBodyType,
  type BomShipmentFileTypeType,
  type PartnerShipmentAdvanceBodyType,
} from '@sp/api-contract';

// 협력사 포털(/partner) 서버 상태 훅 — 받은 RFQ(회신)·받은 발주(확인, D18).
// 소속 판정은 서버가 매 요청 수행하므로 프론트는 로그인만 보장하고 403 을 안내로 처리.

const base = apiRoutes.partnerRfqs;
const poBase = apiRoutes.partnerPos;

export function usePartnerRfqs() {
  return useQuery({
    queryKey: ['partner', 'rfqs', 'list'],
    queryFn: () => apiGet(base, PartnerRfqListResponse),
    retry: false,
  });
}

export function usePartnerRfqDetail(rfqId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'rfqs', 'detail', rfqId.value]),
    queryFn: () => apiGet(`${base}/${rfqId.value ?? ''}`, PartnerRfqDetailResponse),
    enabled: computed(() => rfqId.value !== null),
    retry: false,
  });
}

export function usePartnerRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rfqId, body }: { rfqId: string; body: BomRfqReplyBodyType }) =>
      apiSend('PUT', `${base}/${rfqId}`, body, PartnerRfqDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'rfqs'] });
    },
  });
}

// ── 받은 발주(D18) ───────────────────────────────────────────────────────────

export function usePartnerPos() {
  return useQuery({
    queryKey: ['partner', 'pos', 'list'],
    queryFn: () => apiGet(poBase, PartnerPoListResponse),
    retry: false,
  });
}

export function usePartnerPoDetail(poId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'pos', 'detail', poId.value]),
    queryFn: () => apiGet(`${poBase}/${poId.value ?? ''}`, PartnerPoDetailResponse),
    enabled: computed(() => poId.value !== null),
    retry: false,
  });
}

export function usePartnerPoConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiSend('POST', `${poBase}/${poId}/confirm`, undefined, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}

// ── 선적 핑퐁(D22) — 자기 차례 전이·되돌리기·첨부 ───────────────────────────

export function usePartnerShipmentAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: string; body: PartnerShipmentAdvanceBodyType }) =>
      apiSend('POST', `${poBase}/${poId}/shipment/advance`, body, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}

export function usePartnerShipmentRevert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiSend('POST', `${poBase}/${poId}/shipment/revert`, undefined, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}

export function usePartnerShipmentFileUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      fileType,
      file,
    }: {
      poId: string;
      fileType: BomShipmentFileTypeType;
      file: File;
    }) => {
      const form = new FormData();
      form.append('fileType', fileType);
      form.append('file', file);
      return apiSendForm('POST', `${poBase}/${poId}/shipment/files`, form, PartnerPoDetailResponse);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}

export function usePartnerShipmentFileDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, fileId }: { poId: string; fileId: number }) =>
      apiSend(
        'DELETE',
        `${poBase}/${poId}/shipment/files/${String(fileId)}`,
        undefined,
        PartnerPoDetailResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'pos'] });
    },
  });
}

/** 상업송장 생성기(D23) API 묶음 — InvoiceEditorModal 콜백 주입용. */
export const partnerInvoiceApi = (poId: string) => ({
  loadDraft: (fresh: boolean): Promise<BomInvoiceDataType> =>
    apiGet(
      `${poBase}/${poId}/shipment/invoice?fresh=${String(fresh)}`,
      BomInvoiceDraftResponse,
    ).then((res) => res.data),
  saveDraft: (data: BomInvoiceDataType) =>
    apiSend('PUT', `${poBase}/${poId}/shipment/invoice`, data, BomInvoiceDraftResponse),
  renderXlsx: (data: BomInvoiceDataType): Promise<Blob> =>
    apiSendBlob('POST', `${poBase}/${poId}/shipment/invoice/xlsx`, data),
});

/** 첨부 다운로드 — Bearer 필요라 <a href> 불가, blob → objectURL 저장(관례). */
export async function downloadPartnerShipmentFile(
  poId: string,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(`${poBase}/${poId}/shipment/files/${String(fileId)}`);
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
