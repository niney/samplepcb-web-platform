import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { bomPoExternalCheckStale, type AdminBomPoViewType, type BomPoItemViewType } from '@sp/api-contract';
import {
  downloadBomPoImportFile,
  useCheckExternalPo,
  useCloseBomPo,
  useConfirmSupplierBomPo,
  useCreateBomPos,
  useDeleteBomPo,
  useExecuteExternalPo,
} from '@/admin/useAdminBomPos';
import { confirmDialog } from '@/next/lib/dialog';
import type { CaseCore } from './case-core';

// 조달 발주(D18) — 결제 확인 후 발행, all-or-nothing. 선적 관리(D21)·부족분 대체발주(D31)·
// 외부 실행(D20)·Mouser 카트 확인(D41). 옛 화면 스크립트의 '발주' 부분 그대로.

const PO_TERMINAL_ORDER_STATUSES = new Set(['완료', '취소', '반품', '품절']);
const PO_TERMINAL_LINE_STATUSES = new Set(['완료', '취소', '반품', '품절', '삭제']);

export function useCasePo(core: CaseCore) {
  const { detailId, detail, pos } = core;

  const poCreateOpen = ref(false);
  const poError = ref('');
  const shipmentPo = ref<AdminBomPoViewType | null>(null);
  const shortageRecoveryTarget = ref<{ po: AdminBomPoViewType; item: BomPoItemViewType } | null>(null);
  const createPos = useCreateBomPos();
  const deletePo = useDeleteBomPo();
  const closePo = useCloseBomPo();
  const confirmSupplierPo = useConfirmSupplierBomPo();
  const executeExternal = useExecuteExternalPo();
  const checkExternal = useCheckExternalPo();
  const poBusy = computed(
    () =>
      createPos.isPending.value ||
      deletePo.isPending.value ||
      closePo.isPending.value ||
      confirmSupplierPo.isPending.value ||
      executeExternal.isPending.value,
  );
  // 카트 상태 확인(D41)은 가벼운 조회라 다른 버튼을 잠그지 않고 확인 버튼만 잠근다.
  const checkingPoId = computed(() =>
    checkExternal.isPending.value ? (checkExternal.variables.value?.poId ?? null) : null,
  );
  // 선적 관리 대상 — 목록이 다시 불리면 같은 발주서의 최신 값을 넘긴다.
  const shipmentPoView = computed(
    () => pos.value.find((entry) => entry.poId === shipmentPo.value?.poId) ?? shipmentPo.value,
  );

  function openPoCreate(): void {
    poCreateOpen.value = true;
    poError.value = '';
  }

  // 외부 실행 재시도(실패 PO)·다시 담기(Mouser ok PO — 같은 CartKey 전체 교체, D41)
  async function retryExternalPo(po: AdminBomPoViewType): Promise<void> {
    if (detailId.value === null) return;
    const ext = po.externalRef;
    if (ext?.state === 'ok' && ext.cartKey !== undefined) {
      const ok = await confirmDialog({
        title: 'Mouser 카트 다시 담기',
        message: `같은 CartKey(${ext.cartKey.slice(0, 8)}…) 카트의 내용을 발주 품목 ${String(po.itemCount)}행으로 다시 채웁니다(카트 내용은 발주 품목으로 교체).\n\n담은 뒤에는 바로 Mouser 에서 주문을 완료해 주세요 — API 카트는 시간이 지나면 비워질 수 있습니다.`,
        confirmLabel: '다시 담기',
      });
      if (!ok) return;
    }
    poError.value = '';
    try {
      await executeExternal.mutateAsync({ quoteId: detailId.value, poId: po.poId });
    } catch (e) {
      poError.value = e instanceof ApiRequestError ? e.message : '외부 실행에 실패했습니다.';
    }
  }

  async function checkExternalPo(po: AdminBomPoViewType): Promise<void> {
    if (detailId.value === null) return;
    poError.value = '';
    try {
      await checkExternal.mutateAsync({ quoteId: detailId.value, poId: po.poId });
    } catch (e) {
      poError.value = e instanceof ApiRequestError ? e.message : '카트 상태 확인에 실패했습니다.';
    }
  }

  async function downloadPoImportFile(po: AdminBomPoViewType): Promise<void> {
    if (detailId.value === null) return;
    poError.value = '';
    try {
      await downloadBomPoImportFile(
        detailId.value,
        po.poId,
        `${po.supplierCode ?? 'supplier'}-po-${String(po.poId)}-import.csv`,
      );
    } catch (e) {
      poError.value = e instanceof ApiRequestError ? e.message : '가져오기 파일 다운로드에 실패했습니다.';
    }
  }

  // Case 진입 시 Mouser 카트 상태 자동 확인(D41) — 확인이 없거나 오래된(10분) 미확인 PO 만, 세션당 1회.
  const autoCheckedPoIds = new Set<number>();
  watch(
    pos,
    (list) => {
      const quoteId = detailId.value;
      if (quoteId === null) return;
      for (const po of list) {
        if (po.supplierCode !== 'mouser' || po.status !== 'issued') continue;
        const ext = po.externalRef;
        if (ext?.state !== 'ok' || ext.cartKey === undefined) continue;
        if (autoCheckedPoIds.has(po.poId) || !bomPoExternalCheckStale(ext.checkedAt)) continue;
        autoCheckedPoIds.add(po.poId);
        checkExternal.mutateAsync({ quoteId, poId: po.poId }).catch(() => {
          /* 실패는 checkError 로 박제되거나 [카트 상태 확인]으로 다시 — 진입을 막지 않는다 */
        });
      }
    },
    { immediate: true },
  );

  async function confirmSupplierPurchase(po: AdminBomPoViewType): Promise<void> {
    if (detailId.value === null) return;
    const fallbackNotice =
      po.externalRef?.state === 'failed'
        ? '\n\n자동 실행에 실패했습니다. 공급사 사이트에서 수동 주문을 완료한 경우에만 진행해 주세요.'
        : '';
    if (
      !(await confirmDialog({
        title: '구매 완료 처리',
        message: `공급사 사이트에서 실제 주문·결제를 완료했나요?${fallbackNotice}\n\n완료 처리하면 발주 확인 시각이 기록되고 선적 업무가 열립니다.`,
        confirmLabel: '구매 완료',
      }))
    ) {
      return;
    }
    poError.value = '';
    try {
      await confirmSupplierPo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
    } catch (error) {
      poError.value = error instanceof ApiRequestError ? error.message : '공급사 구매 완료 처리에 실패했습니다.';
    }
  }

  const canIssuePo = computed(() => {
    const info = detail.value?.orderInfo;
    return (
      info?.isPaid === true &&
      !PO_TERMINAL_ORDER_STATUSES.has(info.odStatus) &&
      !PO_TERMINAL_LINE_STATUSES.has(info.ctStatus)
    );
  });
  const issueDisabledReason = computed(() => {
    if (detail.value?.orderState === 'canceled') {
      return '취소된 주문입니다. 고객이 다시 주문하고 입금된 뒤 발주할 수 있습니다';
    }
    if (detail.value?.orderState !== 'ordered') return '고객 주문 후에 발주할 수 있습니다';
    if (detail.value.orderInfo !== null && PO_TERMINAL_LINE_STATUSES.has(detail.value.orderInfo.ctStatus)) {
      return `BOM 주문 항목 상태가 ${detail.value.orderInfo.ctStatus}이므로 발주서를 추가할 수 없습니다`;
    }
    if (detail.value.orderInfo?.isPaid !== true) return '결제 확인(입금) 후에 발주할 수 있습니다';
    if (detail.value.orderInfo.odStatus === '완료') return '완료된 주문에는 발주서를 추가할 수 없습니다';
    if (PO_TERMINAL_ORDER_STATUSES.has(detail.value.orderInfo.odStatus)) {
      return `주문 상태가 ${detail.value.orderInfo.odStatus}이므로 발주서를 추가할 수 없습니다`;
    }
    return '';
  });

  async function removePo(po: { poId: number; partnerName: string }): Promise<void> {
    if (detailId.value === null) return;
    if (
      !(await confirmDialog({
        message: `'${po.partnerName}' 발주서 발행을 취소할까요? (미확인 발주서만 가능)`,
        confirmLabel: '발행 취소',
        tone: 'danger',
      }))
    ) {
      return;
    }
    poError.value = '';
    try {
      await deletePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
    } catch (e) {
      poError.value = e instanceof ApiRequestError ? e.message : '발행 취소에 실패했습니다.';
    }
  }

  async function closePoRow(po: { poId: number; partnerName: string }): Promise<void> {
    if (detailId.value === null) return;
    if (!(await confirmDialog({ message: `'${po.partnerName}' 발주서를 마감할까요?`, confirmLabel: '마감' }))) return;
    poError.value = '';
    try {
      await closePo.mutateAsync({ quoteId: detailId.value, poId: po.poId });
    } catch (e) {
      poError.value = e instanceof ApiRequestError ? e.message : '마감에 실패했습니다.';
    }
  }

  function openShipment(po: AdminBomPoViewType): void {
    shipmentPo.value = po;
  }
  function openShortageRecovery(po: AdminBomPoViewType, item: BomPoItemViewType): void {
    shortageRecoveryTarget.value = { po, item };
  }

  return {
    poCreateOpen,
    poError,
    shipmentPo,
    shipmentPoView,
    shortageRecoveryTarget,
    poBusy,
    checkingPoId,
    openPoCreate,
    retryExternalPo,
    checkExternalPo,
    downloadPoImportFile,
    confirmSupplierPurchase,
    canIssuePo,
    issueDisabledReason,
    removePo,
    closePoRow,
    openShipment,
    openShortageRecovery,
  };
}

export type CasePo = ReturnType<typeof useCasePo>;
