import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  PartnerPcbPoDetailResponse,
  PartnerPcbPoListResponse,
  PartnerPcbRemittanceListResponse,
  PartnerPcbShipBoardResponse,
  PartnerPcbShipDoneResponse,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  PcbShipmentPackageListResponse,
  apiRoutes,
  type BomInvoiceDataType,
  type PcbShipmentFileTypeType,
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

/** 수금 현황(P3.11) — 완료된 발주서는 홈의 '진행할 발주'에 안 떠서 진입 경로가 없었다.
 *  홈 카드·셸 배지도 같은 응답을 쓴다(unpaidCount) — enabled 로 PCB 트랙에서만 조회한다. */
export function usePartnerPcbRemittances(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'pcbRemittances'],
    queryFn: () => apiGet(apiRoutes.partnerPcbRemittances, PartnerPcbRemittanceListResponse),
    ...(enabled === undefined ? {} : { enabled }),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['partner', 'pcbPos'] });
  // 발주·발송 변이는 보내기 보드(선반·박스)에도 반영된다 — 함께 무효화.
  void qc.invalidateQueries({ queryKey: ['partner', 'pcbShip'] });
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

/** 발송 참조번호(Case ID) 요청 — 부치기 전 수취인 측 참조값이 필요할 때(옵션).
 *  요청되면 관리자 입력까지 실발송(운송장) 전이가 게이트된다. */
export function usePartnerPcbShipmentCaseRefRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, note }: { poId: number; note: string | null }) =>
      apiSend(
        'POST',
        `${base}/${String(poId)}/shipment/case-ref-request`,
        { note },
        PartnerPcbPoDetailResponse,
      ),
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

// 박스에서 꺼내기 — 발송 준비(preparing) 단계만. 대표 개념은 서버가 은닉(꺼내면
// 승계·마지막이면 발송 소멸 — §9 재구성).
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

// ═══ [📦 PCB 보내기] 보드(§9 묶음 재구성) — 선반·박스·진행·완료 ═══════════════

export function usePartnerPcbShipBoard() {
  return useQuery({
    queryKey: ['partner', 'pcbShip', 'board'],
    queryFn: () => apiGet(apiRoutes.partnerPcbShipments, PartnerPcbShipBoardResponse),
  });
}

/** PCB Case QR — 한 박스의 PO별 라벨을 일괄 조회·인쇄한다. */
export const partnerPcbPackageApi = (shipmentId: number) => ({
  load: async () =>
    (
      await apiGet(
        `${apiRoutes.partnerPcbShipments}/${String(shipmentId)}/labels`,
        PcbShipmentPackageListResponse,
      )
    ).data,
  markPrinted: async () =>
    (
      await apiSend(
        'POST',
        `${apiRoutes.partnerPcbShipments}/${String(shipmentId)}/labels/print`,
        {},
        PcbShipmentPackageListResponse,
      )
    ).data,
});

// 완료된 발송 아카이브(R2 — BOM done 분리 미러) — 누적 목록, 페이지네이션.
export function usePartnerPcbDoneShipments(page: Ref<number>, pageSize: number) {
  return useQuery({
    queryKey: ['partner', 'pcbShip', 'done', page],
    queryFn: () =>
      apiGet(
        `${apiRoutes.partnerPcbShipments}/done?page=${String(page.value)}&pageSize=${String(pageSize)}`,
        PartnerPcbShipDoneResponse,
      ),
  });
}

// 담기 — 서버가 컨텍스트(받는 곳·회차)를 해석해 같은 박스에 합류시키거나 새로 만든다.
export function usePartnerPcbShipBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId }: { poId: number }) =>
      apiSend(
        'POST',
        `${apiRoutes.partnerPcbShipments}/box`,
        { poId },
        PartnerPcbShipBoardResponse,
      ),
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
      fileType: PcbShipmentFileTypeType;
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
  // 엑셀 첨부(08-13 재편) — 관리자가 내려받아 수동 수정 후 재첨부하는 왕복이라
  // 편집 가능한 파일로 첨부한다(PDF 경로는 모달이 attachXlsx 존재 시 미노출).
  attachXlsx: (file: File) => {
    const form = new FormData();
    form.set('fileType', 'invoice');
    form.set('file', file);
    return apiSendForm('POST', `${base}/${String(poId)}/shipment/files`, form, PartnerPcbPoDetailResponse);
  },
});
