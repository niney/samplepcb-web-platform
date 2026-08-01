import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';
import {
  BomInvoiceDraftResponse,
  BomShipmentPackingListResponse,
  PartnerPoDetailResponse,
  PartnerPoListResponse,
  PartnerRfqDetailResponse,
  PartnerRfqListResponse,
  PartnerShipmentCreateResponse,
  PartnerShipmentListResponse,
  apiRoutes,
  type BomInvoiceDataType,
  type BomShipmentPackingListSaveBodyType,
  type BomShipmentPackingListType,
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
      void qc.invalidateQueries({ queryKey: ['partner'] });
    },
  });
}

// ── 발송 1급(§6.11) — 담기(생성)·목록. 조작은 대표 poId 로 기존 훅 재사용 ────

// 진행 중(active) 발송 — 홈·보내기 공용(협력사 관점 완료는 제외, counts.done 로 안내).
export function usePartnerShipments() {
  return useQuery({
    queryKey: ['partner', 'shipments', 'active'],
    queryFn: () => apiGet('/api/partner/shipments?tab=active', PartnerShipmentListResponse),
    retry: false,
  });
}

// 완료된 발송(§6.11 분리) — 별도 페이지, 페이지네이션.
export function usePartnerDoneShipments(page: Ref<number>, pageSize = 10) {
  return useQuery({
    queryKey: computed(() => ['partner', 'shipments', 'done', page.value, pageSize]),
    queryFn: () =>
      apiGet(
        `/api/partner/shipments?tab=done&page=${String(page.value)}&pageSize=${String(pageSize)}`,
        PartnerShipmentListResponse,
      ),
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useCreatePartnerShipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poIds: number[]) =>
      apiSend('POST', '/api/partner/shipments', { poIds }, PartnerShipmentCreateResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner'] });
    },
  });
}

// 박스에 담기(§6.11 두 칸 UI) — 준비 중 발송에 발주서 추가.
export function useAttachShipmentPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shipmentId, poId }: { shipmentId: number; poId: number }) =>
      apiSend(
        'POST',
        `/api/partner/shipments/${String(shipmentId)}/pos`,
        { poId },
        PartnerShipmentListResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner'] });
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
      void qc.invalidateQueries({ queryKey: ['partner'] });
    },
  });
}

export function usePartnerShipmentRevert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiSend('POST', `${poBase}/${poId}/shipment/revert`, undefined, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner'] });
    },
  });
}

// 묶음에서 제외(§6.10) — 자기 발주서를 그룹에서 뺀다(대표 불가·발송 준비 단계만).
export function usePartnerShipmentDetach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: string) =>
      apiSend('DELETE', `${poBase}/${poId}/shipment/membership`, undefined, PartnerPoDetailResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner'] });
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
      void qc.invalidateQueries({ queryKey: ['partner'] });
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
      void qc.invalidateQueries({ queryKey: ['partner'] });
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

/** 선적 리스트·QR 라벨(D24) — 현재 로그인 협력사의 발송만 서버가 허용한다. */
export const partnerPackingApi = (shipmentId: number) => ({
  load: (): Promise<BomShipmentPackingListType> =>
    apiGet(
      `${apiRoutes.partnerShipments}/${String(shipmentId)}/packing-list`,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
  save: (body: BomShipmentPackingListSaveBodyType) =>
    apiSend(
      'PUT',
      `${apiRoutes.partnerShipments}/${String(shipmentId)}/packing-list`,
      body,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
  markPrinted: () =>
    apiSend(
      'POST',
      `${apiRoutes.partnerShipments}/${String(shipmentId)}/packing-list/print`,
      undefined,
      BomShipmentPackingListResponse,
    ).then((res) => res.data),
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
