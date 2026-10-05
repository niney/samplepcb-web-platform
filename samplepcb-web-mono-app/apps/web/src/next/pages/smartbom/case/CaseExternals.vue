<script setup lang="ts">
import { computed } from 'vue';
import { neededQty } from '@sp/utils';
import CandidateDrawer from '@/next/components/bom/CandidateDrawer.vue';
import CaseDeleteDialog from '@/next/components/smartbom/CaseDeleteDialog.vue';
import EstimateDialog from '@/next/components/smartbom/EstimateDialog.vue';
import PartAddDialog from '@/next/components/smartbom/PartAddDialog.vue';
import PoCreateDialog from '@/next/components/smartbom/PoCreateDialog.vue';
import QuickMailComposer from '@/next/components/smartbom/QuickMailComposer.vue';
import RfqCompareDialog from '@/next/components/smartbom/RfqCompareDialog.vue';
import RfqSendDialog from '@/next/components/smartbom/RfqSendDialog.vue';
import ShipmentDialog from '@/next/components/smartbom/ShipmentDialog.vue';
import ShortageRecoveryDialog from '@/next/components/smartbom/ShortageRecoveryDialog.vue';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 다른 화면과 함께 쓰는 대화상자·서랍 — 옛 Case 화면과 같은 props·emits 로 연결한다(부품은 각 담당이 옮겼다).
const {
  detail,
  detailId,
  caseNo,
  estimateOpen,
  loadEstimatePrint,
  mailOpen,
  caseDeleteOpen,
  onCaseDeleted,
  scopeItems,
  rfqs,
  pos,
  sendOpen,
  compareOpen,
  rfqItemSelection,
  partnerItemsByPartner,
  partnerHoldersByItem,
  useFullRfqScope,
  poCreateOpen,
  shipmentPo,
  shipmentPoView,
  shortageRecoveryTarget,
  partAddOpen,
  partAdd,
  partAddError,
  partAddUnavailableReason,
  requestPartAdd,
  closePartAdd,
  candidateItemId,
  candidateQuery,
  candidateItem,
  candidateSelection,
  candidateSelectionError,
  candidateSelectionUnavailableReason,
  candidateSelectionNotice,
  candidateForceSelectionAllowed,
  candidateDrawerView,
  requestCandidateSelection,
  requestCatalogSelection,
  closePartSelection,
} = useSmartbomCaseContext();

const candidateNeeded = computed(() => {
  const item = candidateItem.value;
  const quote = detail.value;
  return item === null || quote === null ? 1 : neededQty(item.bomQty, quote.setQty, quote.spareQty);
});
const selectedItemIds = computed(() => [...rfqItemSelection.value]);
</script>

<template>
  <!-- 견적서(§6.8) — 확정 전이면 시트가 "가안" 표기 -->
  <EstimateDialog v-if="detailId !== null" :open="estimateOpen" :load="loadEstimatePrint" @close="estimateOpen = false" />

  <!-- 빠른 메일 컴포즈(§6.15) — 우하단 도킹 -->
  <QuickMailComposer
    v-if="mailOpen && detail !== null && detailId !== null"
    :quote-id="detailId"
    :case-no="caseNo"
    :case-title="detail.title"
    :confirmed-total="detail.confirmedTotal"
    @close="mailOpen = false"
  />

  <!-- Case 강제 영구 삭제 — 차단·경고 판정은 서버가 정본 -->
  <CaseDeleteDialog
    v-if="caseDeleteOpen && detailId !== null"
    :quote-id="detailId"
    @close="caseDeleteOpen = false"
    @deleted="onCaseDeleted"
  />

  <!-- 수동 부품 추가 — 고르면 확인 대화상자(PartAddConfirmDialog)로 넘어간다 -->
  <PartAddDialog
    v-if="partAddOpen && detail !== null"
    :set-qty="detail.setQty"
    :spare-qty="detail.spareQty"
    :usd-krw-rate="detail.usdKrwRateUsed"
    :selecting="partAdd.isPending.value"
    :read-only="partAddUnavailableReason !== null"
    :locked-reason="partAddUnavailableReason ?? ''"
    :error="partAddError"
    @select="requestPartAdd"
    @close="closePartAdd"
  />

  <!-- 후보·근거 / 부품 검색·변경 서랍 — 고르면 확인 대화상자(PartSelectionConfirmDialog)가 위에 뜬다 -->
  <CandidateDrawer
    :open="candidateItemId !== null"
    :context="candidateQuery.data.value?.data ?? null"
    :loading="candidateQuery.isLoading.value"
    :failed="candidateQuery.isError.value"
    :read-only="candidateSelectionUnavailableReason !== null"
    :selecting="candidateSelection.isPending.value"
    :catalog-selecting="candidateSelection.isPending.value"
    :selection-error="candidateSelectionError"
    :selection-locked-reason="candidateSelectionNotice ?? ''"
    :force-selection-allowed="candidateForceSelectionAllowed"
    :interaction-locked="candidateSelection.isPending.value"
    :initial-view="candidateDrawerView"
    :search-initial-query="candidateItem?.mpn ?? ''"
    :current-part-id="candidateItem?.partId ?? null"
    :needed="candidateNeeded"
    :usd-krw-rate="detail?.usdKrwRateUsed ?? null"
    :search-refresh-enabled="false"
    @select="requestCandidateSelection"
    @catalog-select="requestCatalogSelection"
    @close="closePartSelection"
  />

  <template v-if="detail !== null && detailId !== null">
    <RfqSendDialog
      :open="sendOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :selected-item-ids="selectedItemIds"
      :rfqs="rfqs"
      :partner-items="partnerItemsByPartner"
      :item-holders="partnerHoldersByItem"
      @close="sendOpen = false"
      @sent="useFullRfqScope"
    />
    <RfqCompareDialog
      :open="compareOpen"
      :quote-id="detailId"
      :rfqs="rfqs"
      :scope-items="scopeItems"
      @close="compareOpen = false"
    />
    <PoCreateDialog
      :open="poCreateOpen"
      :quote-id="detailId"
      :scope-items="scopeItems"
      :rfqs="rfqs"
      :existing-pos="pos"
      @close="poCreateOpen = false"
    />
  </template>

  <template v-if="detailId !== null">
    <ShipmentDialog :open="shipmentPo !== null" :quote-id="detailId" :po="shipmentPoView" @close="shipmentPo = null" />
    <ShortageRecoveryDialog
      :open="shortageRecoveryTarget !== null"
      :quote-id="detailId"
      :po="shortageRecoveryTarget?.po ?? null"
      :item="shortageRecoveryTarget?.item ?? null"
      @close="shortageRecoveryTarget = null"
    />
  </template>
</template>
