<script setup lang="ts">
import DeleteQuoteDialog from '@/next/components/pcb/DeleteQuoteDialog.vue';
import CustomerShipDialog from '@/next/components/pcb/CustomerShipDialog.vue';
import EqRejectDialog from '@/next/components/pcb/EqRejectDialog.vue';
import EqReviewPanel from '@/next/components/pcb/EqReviewPanel.vue';
import OrderCancelDialog from '@/next/components/pcb/OrderCancelDialog.vue';
import RemittancePanel from '@/next/components/pcb/RemittancePanel.vue';
import SpecEditDialog from '@/next/components/pcb/SpecEditDialog.vue';
import EstimateDialog from '@/next/components/common/EstimateDialog.vue';
import InvoiceEditorDialog from '@/next/components/common/InvoiceEditorDialog.vue';
import { usePcbCaseContext } from './usePcbCase';

// 다른 화면과 함께 쓰는 대화상자·패널 — 옛 Case 화면과 같은 props·emits 로 연결한다(부품은 각 담당이 옮긴다).
const {
  detail,
  specId,
  specEditOpen,
  editableSpec,
  specEditSaved,
  eqReviewPo,
  remittancePoId,
  adminInvoiceApiRef,
  invoicePoId,
  attachInvoiceXlsx,
  estimateProjectId,
  deleteOpen,
  onDeleted,
  customerShipOdId,
  customerShipAllReceived,
  rejectTarget,
  rejectPrefill,
  rejectEq,
  rejectPoId,
  submitReject,
  cancelOrderOpen,
} = usePcbCaseContext();
</script>

<template>
  <!-- 제작 사양 수정 — 전 필드 편집 + 변경 요약 + 재견적 결과 -->
  <SpecEditDialog
    v-if="specEditOpen && detail !== null"
    :project-id="detail.projectId"
    :spec="editableSpec"
    :qty="detail.qty"
    :category="detail.category"
    :order-category="detail.orderCategory"
    :final-price="detail.finalPrice"
    :auto-price="detail.quote?.autoPrice ?? null"
    @close="specEditOpen = false"
    @saved="specEditSaved"
  />

  <!-- EQ 고객 확인 패널 -->
  <EqReviewPanel v-if="eqReviewPo !== null" :po="eqReviewPo" @close="eqReviewPo = null" />

  <!-- 송금 원장 패널 — 송금 워크큐와 같은 컴포넌트(창구는 여럿, 원장은 하나) -->
  <RemittancePanel v-if="remittancePoId !== null" :po-id="remittancePoId" @close="remittancePoId = null" />

  <!-- 인보이스 생성기 — BOM 과 같은 편집기에 PCB 콜백을 주입한다 -->
  <InvoiceEditorDialog
    v-if="adminInvoiceApiRef !== null"
    :open="invoicePoId !== null"
    title="인보이스 생성기"
    :load-draft="adminInvoiceApiRef.loadDraft"
    :save-draft="adminInvoiceApiRef.saveDraft"
    :render-xlsx="adminInvoiceApiRef.renderXlsx"
    :attach-xlsx="attachInvoiceXlsx"
    @close="invoicePoId = null"
  />

  <!-- 견적서 — 마운트를 v-if 로 제어해야 인쇄 전역 스타일 주입/제거가 대화상자 수명과 맞는다. -->
  <EstimateDialog v-if="estimateProjectId !== null" :project-id="estimateProjectId" @close="estimateProjectId = null" />

  <!-- 견적 영구 삭제 — 견적 관리와 같은 대화상자(차단·경고·사유 판정은 서버가 정본) -->
  <DeleteQuoteDialog v-if="deleteOpen && specId !== null" :ids="[specId]" @close="deleteOpen = false" @deleted="onDeleted" />

  <!-- 고객 배송 처리 — '배송 처리 대기' 신호의 액션. 워크큐와 공용 -->
  <CustomerShipDialog
    :od-id="customerShipOdId"
    :incomplete-receipt="!customerShipAllReceived"
    :customer-label="detail?.customer?.name ?? ''"
    :project-name="detail?.projectName ?? ''"
    @close="customerShipOdId = null"
  />

  <!-- EQ 반려 — 사유와 수정지시 첨부를 한 자리에서 -->
  <EqRejectDialog
    :po="rejectTarget"
    :spec-id="specId"
    :prefill-reason="rejectPrefill"
    :busy="rejectEq.isPending.value"
    @close="rejectPoId = null"
    @confirm="(reason) => void submitReject(reason)"
  />

  <OrderCancelDialog
    v-if="cancelOrderOpen && specId !== null"
    :spec-id="specId"
    @close="cancelOrderOpen = false"
    @done="cancelOrderOpen = false"
    @open-case="cancelOrderOpen = false"
  />
</template>
