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
  type PcbEqReopenBodyType,
  type PcbShipmentAdvanceBodyType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';

// 협력사 포털 PCB 발주·EQ 훅(P2) — docs/PCB_PARTNER_TRACK.md §5.4.

const base = apiRoutes.partnerPcbPos;

export function usePartnerPcbPos(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'pcbPos', 'list'],
    queryFn: () => apiGet(base, PartnerPcbPoListResponse),
    // 셸 배지가 트랙별로 켠다(R3 usePartnerWork) — 인자 없으면 기존처럼 항상 조회.
    ...(enabled === undefined ? {} : { enabled }),
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
    // note = 스텐실 트랙의 고객문의사항(eq-request 전용). 다른 전이는 안 보내고, EQ 트랙은
    // 빈 문자열이라 서버가 null 로 접는다 — 종전 호출과 완전히 같다.
    mutationFn: ({ poId, note }: { poId: number; note?: string }) =>
      apiSend(
        'POST',
        `${base}/${String(poId)}/${action}`,
        note === undefined ? {} : { note },
        PcbPoActionResponse,
      ),
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

// 추가 EQ 요청(D20 후속) — 승인된 건(eq_done)을 협력사가 사유와 함께 발주접수로 돌린다.
// 되돌리기(eq-revert)와 다른 축이라 훅도 따로 둔다 — 사유가 필수 본문이다.
export function usePartnerPcbEqReopen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: PcbEqReopenBodyType }) =>
      apiSend('POST', `${base}/${String(poId)}/eq-reopen`, body, PcbPoActionResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
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

/** 고객 회신서 엑셀(D20 P3) — 관리자가 전달한 문항형 회차를 서식 갖춘 한 장으로. 표 제목은 포털 언어를 따른다. */
export const downloadPartnerPcbEqReply = (
  poId: number,
  reviewId: number,
  lang: string,
  fileName: string,
): Promise<void> =>
  saveBlob(`${base}/${String(poId)}/eq-rounds/${String(reviewId)}/reply-xlsx?lang=${encodeURIComponent(lang)}`, fileName);

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

// 선적 완료 확인 — 받는 쪽이 국제 '선적'을 진행한 뒤 보내는 쪽이 "실제로 넘겼다"를 남긴다. 이 확인으로
// 발송은 보내기 보드에서 완료 내역으로 넘어간다(보드도 함께 무효화된다).
export function usePartnerPcbShipmentConfirm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ poId }: { poId: number }) =>
      apiSend('POST', `${base}/${String(poId)}/shipment/ship-confirm`, {}, PartnerPcbPoDetailResponse),
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

export function usePartnerPcbShipBoard(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'pcbShip', 'board'],
    queryFn: () => apiGet(apiRoutes.partnerPcbShipments, PartnerPcbShipBoardResponse),
    ...(enabled === undefined ? {} : { enabled }),
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
// ⚠ 첨부(attachXlsx)는 여기 두지 않는다 — 화면의 첨부 표시를 바꾸는 변이라
// useUploadPartnerPcbShipmentFile(무효화 포함)을 감싸 카드에서 주입한다.
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
});
