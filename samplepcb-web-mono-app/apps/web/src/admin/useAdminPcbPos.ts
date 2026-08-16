import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbEqReviewListResponse,
  AdminPcbPoListResponse,
  AdminPcbPoWorkListResponse,
  AdminPcbShipmentWorkListResponse,
  AdminPcbPackageResponse,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  PcbShipmentPackageListResponse,
  apiRoutes,
  type AdminPcbEqReviewCreateBodyType,
  type AdminPcbPoCreateBodyType,
  type AdminPcbPoPatchBodyType,
  type AdminPcbPoTabType,
  type AdminPcbShipmentTabType,
  type PcbEqFileTypeType,
  type BomInvoiceDataType,
  type PcbShipmentAdvanceBodyType,
  type PcbShipmentFileTypeType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendBlob, apiSendForm } from '@sp/shared';

// PCB 발주·EQ 관리자 훅(P2) — docs/PCB_PARTNER_TRACK.md §5.4.
// 무효화는 ['admin','pcbPo'] 접두 일괄(+Case RFQ 패널과 배지는 별개 키라 독립).

export interface AdminPcbPoWorkFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbPoTabType;
  q: string;
  /** 확정 납기 KST 날짜 범위(양끝 포함). 단일일은 같은 날짜를 두 값에 넣는다. */
  deliveryFrom: string;
  deliveryTo: string;
}

const workListPath = (f: AdminPcbPoWorkFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  if (f.deliveryFrom !== '' && f.deliveryTo !== '') {
    params.set('deliveryFrom', f.deliveryFrom);
    params.set('deliveryTo', f.deliveryTo);
  }
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
      note,
    }: {
      specId: number;
      poId: number;
      action: AdminPcbEqSubstituteAction;
      /** 스텐실 트랙의 고객문의사항(eq-request 대행 전용) — 서버 게이트가 필수로 본다. */
      note?: string;
    }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/${action}`,
        note === undefined ? {} : { note },
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
      // reply = 관리자 회신(반려하며 돌려보내는 수정지시) — 협력사 산출물과 방향이 반대다.
      fileType: PcbEqFileTypeType;
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
  /** 검색 — 구성원(다른 고객 포함) 필드까지 서버가 훑는다(고객·프로젝트·PO·운송장). */
  q: string;
  /** 협력사 구간(하위→MD) 표시 토글 — 서버 필터(counts 일관). 기본 'show'. */
  mdLegs: 'show' | 'hide';
}

const shipmentWorkPath = (f: AdminPcbShipmentFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  if (f.mdLegs === 'hide') params.set('mdLegs', 'hide');
  return `${apiRoutes.adminPcbShipments}?${params.toString()}`;
};

export function useAdminPcbShipmentWork(filters: Ref<AdminPcbShipmentFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbShipment', 'work', filters],
    queryFn: () => apiGet(shipmentWorkPath(filters.value), AdminPcbShipmentWorkListResponse),
    placeholderData: keepPreviousData,
  });
}

/** PCB Case QR 라벨 — 박스 단위 일괄 출력. 고객 신원은 라벨 계약에 포함되지 않는다. */
export const adminPcbPackageApi = (shipmentId: number) => ({
  load: async () =>
    (
      await apiGet(
        `${apiRoutes.adminPcbShipments}/${String(shipmentId)}/labels`,
        PcbShipmentPackageListResponse,
      )
    ).data,
  markPrinted: async () =>
    (
      await apiSend(
        'POST',
        `${apiRoutes.adminPcbShipments}/${String(shipmentId)}/labels/print`,
        {},
        PcbShipmentPackageListResponse,
      )
    ).data,
});

export function useAdminPcbPackage(code: Ref<string | null>) {
  return useQuery({
    queryKey: ['admin', 'pcbPackage', code],
    queryFn: () => apiGet(`${apiRoutes.adminPcbPackages}/${String(code.value)}`, AdminPcbPackageResponse),
    enabled: computed(() => code.value !== null),
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

/** 발송 참조번호(Case ID) 입력 — 협력사 요청에 대한 응답(요청 없어도 기록 가능).
 *  입력되면 협력사에게 값이 메일로 안내되고 발송(운송장) 게이트가 열린다. */
export function useAdminPcbShipmentCaseRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId, caseRef }: { specId: number; poId: number; caseRef: string }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/case-ref`,
        { caseRef },
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
// ⚠ 첨부(attachXlsx)는 여기 두지 않는다 — 화면의 첨부 표시를 바꾸는 변이라
// useUploadAdminPcbShipmentFile(무효화 포함)을 감싸 Case 화면에서 주입한다.
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
});

/** 선적 첨부 업로드(관리자) — Case ID 갈래의 핵심 경로: 수정한 인보이스 재첨부·AWB 첨부.
 *  종류별 1건 교체(서버 semantics). */
export function useUploadAdminPcbShipmentFile() {
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
      fileType: PcbShipmentFileTypeType;
    }) => {
      const form = new FormData();
      form.set('fileType', fileType);
      form.set('file', file);
      return apiSendForm(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/shipment/files`,
        form,
        AdminPcbPoListResponse,
      );
    },
    onSuccess: () => {
      shipmentInvalidate(qc);
    },
  });
}

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
