import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  PartnerPcbPoDetailResponse,
  PartnerPcbPoListResponse,
  PartnerPcbRemittanceListResponse,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  apiRoutes,
  type BomInvoiceDataType,
  type BomShipmentFileTypeType,
  type PartnerPcbChildPoCreateBodyType,
  type PcbEqFileTypeType,
  type PcbShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';

// 협력사 포털 PCB 발주·EQ 훅(P2) — docs/PCB_PARTNER_TRACK.md §5.4.

const base = apiRoutes.partnerPcbPos;

export function usePartnerPcbPos() {
  return useQuery({
    queryKey: ['partner', 'pcbPos', 'list'],
    queryFn: () => apiGet(base, PartnerPcbPoListResponse),
  });
}

export function usePartnerPcbPoDetail(poId: Ref<number | null>) {
  return useQuery({
    queryKey: ['partner', 'pcbPos', 'detail', poId],
    queryFn: () => apiGet(`${base}/${String(poId.value)}`, PartnerPcbPoDetailResponse),
    enabled: computed(() => poId.value !== null),
  });
}

/** 수금 현황(P3.11) — 완료된 발주서는 홈의 '진행할 발주'에 안 떠서 진입 경로가 없었다. */
export function usePartnerPcbRemittances() {
  return useQuery({
    queryKey: ['partner', 'pcbRemittances'],
    queryFn: () => apiGet(apiRoutes.partnerPcbRemittances, PartnerPcbRemittanceListResponse),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['partner', 'pcbPos'] });
};

export function useUploadPartnerPcbEqFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      file,
      fileType,
    }: {
      poId: number;
      file: File;
      fileType: PcbEqFileTypeType;
    }) => {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', file);
      return apiSendForm('POST', `${base}/${String(poId)}/eq-files`, form, PartnerPcbPoDetailResponse);
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeletePartnerPcbEqFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, fileId }: { poId: number; fileId: number }) =>
      apiSend(
        'DELETE',
        `${base}/${String(poId)}/eq-files/${String(fileId)}`,
        {},
        PartnerPcbPoDetailResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

const transition = (
  qc: ReturnType<typeof useQueryClient>,
  action: 'eq-request' | 'production-start' | 'production-complete' | 'eq-revert',
) =>
  useMutation({
    mutationFn: ({ poId }: { poId: number }) =>
      apiSend('POST', `${base}/${String(poId)}/${action}`, {}, PcbPoActionResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });

export function usePartnerPcbEqRequest() {
  return transition(useQueryClient(), 'eq-request');
}
export function usePartnerPcbProductionStart() {
  return transition(useQueryClient(), 'production-start');
}
export function usePartnerPcbProductionComplete() {
  return transition(useQueryClient(), 'production-complete');
}
export function usePartnerPcbEqRevert() {
  return transition(useQueryClient(), 'eq-revert');
}

// MD 하위 발주 — 하위 회신 견적행 기준(대상·통화·금액 유도).
export function useCreatePartnerChildPcbPo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: PartnerPcbChildPoCreateBodyType }) =>
      apiSend('POST', `${base}/${String(poId)}/children`, body, PartnerPcbPoDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

const saveBlob = async (path: string, fileName: string): Promise<void> => {
  const blob = await apiGetBlob(path);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const downloadPartnerPcbPoSpecFile = (
  poId: number,
  fileId: number,
  fileName: string,
): Promise<void> => saveBlob(`${base}/${String(poId)}/spec-files/${String(fileId)}`, fileName);

export const downloadPartnerPcbEqFile = (
  poId: number,
  fileId: number,
  fileName: string,
): Promise<void> => saveBlob(`${base}/${String(poId)}/eq-files/${String(fileId)}`, fileName);

// ═══ P3 선적 — 발송(핑퐁)·입고확인·첨부·상업송장 ═══════════════════════════════

export function usePartnerPcbShipmentAdvance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: PcbShipmentAdvanceBodyType }) =>
      apiSend('POST', `${base}/${String(poId)}/shipment/advance`, body, PartnerPcbPoDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function usePartnerPcbShipmentRevert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId }: { poId: number }) =>
      apiSend('POST', `${base}/${String(poId)}/shipment/revert`, {}, PartnerPcbPoDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// MD 입고확인 — 받는측이 내 조직인 발송만(서버 판정).
export function usePartnerPcbShipmentReceive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, note }: { poId: number; note: string | null }) =>
      apiSend('POST', `${base}/${String(poId)}/shipment/receive`, { note }, PartnerPcbPoDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// 묶음에서 빼기 — 발송 준비(preparing) 단계, 대표 발주서 제외(서버 검증).
export function usePartnerPcbShipmentDetach() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId }: { poId: number }) =>
      apiSend('DELETE', `${base}/${String(poId)}/shipment/membership`, {}, PcbPoActionResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useUploadPartnerPcbShipmentFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      poId,
      file,
      fileType,
    }: {
      poId: number;
      file: File;
      fileType: BomShipmentFileTypeType;
    }) => {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', file);
      return apiSendForm('POST', `${base}/${String(poId)}/shipment/files`, form, PartnerPcbPoDetailResponse);
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export const downloadPartnerPcbShipmentFile = (
  poId: number,
  fileId: number,
  fileName: string,
): Promise<void> => saveBlob(`${base}/${String(poId)}/shipment/files/${String(fileId)}`, fileName);

// 상업송장 — InvoiceEditorModal 콜백 주입용 API 묶음(BOM 포털과 동형).
export const partnerPcbInvoiceApi = (poId: number) => ({
  loadDraft: async (fresh: boolean) =>
    (
      await apiGet(
        `${base}/${String(poId)}/shipment/invoice?fresh=${fresh ? 'true' : 'false'}`,
        PcbInvoiceResponse,
      )
    ).data,
  saveDraft: (data: BomInvoiceDataType) =>
    apiSend('PUT', `${base}/${String(poId)}/shipment/invoice`, data, PcbPoActionResponse),
  renderXlsx: (data: BomInvoiceDataType) =>
    apiSendBlob('POST', `${base}/${String(poId)}/shipment/invoice/xlsx`, data),
  attachPdf: (file: File) => {
    const form = new FormData();
    form.set('fileType', 'invoice');
    form.set('file', file);
    return apiSendForm('POST', `${base}/${String(poId)}/shipment/files`, form, PartnerPcbPoDetailResponse);
  },
});
