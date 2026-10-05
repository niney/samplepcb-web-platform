<script setup lang="ts">
import { RotateCwIcon, TriangleAlertIcon } from '@lucide/vue';
import CaseCustomerCard from '@/next/components/common/CaseCustomerCard.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import ConfirmPanel from '@/next/components/smartbom/ConfirmPanel.vue';
import PoPanel from '@/next/components/smartbom/PoPanel.vue';
import RfqPanel from '@/next/components/smartbom/RfqPanel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import CaseExternals from './case/CaseExternals.vue';
import CaseHeader from './case/CaseHeader.vue';
import CaseSummaryStrip from './case/CaseSummaryStrip.vue';
import CaseTimeline from './case/CaseTimeline.vue';
import ItemsSection from './case/ItemsSection.vue';
import MailSection from './case/MailSection.vue';
import ReviewPanel from './case/ReviewPanel.vue';
import CompletionDialog from './case/dialogs/CompletionDialog.vue';
import PartAddConfirmDialog from './case/dialogs/PartAddConfirmDialog.vue';
import PartRemoveConfirmDialog from './case/dialogs/PartRemoveConfirmDialog.vue';
import PartSelectionConfirmDialog from './case/dialogs/PartSelectionConfirmDialog.vue';
import QuoteClosingDialog from './case/dialogs/QuoteClosingDialog.vue';
import ReplyDialog from './case/dialogs/ReplyDialog.vue';
import ResendEmailDialog from './case/dialogs/ResendEmailDialog.vue';
import { provideSmartbomCase } from './case/useSmartbomCase';

// SmartBOM Case 상세 — docs/SMARTBOM_PARTNER_RFQ.md. 옛 pages/admin/AdminSmartbomCase.vue 의 리뉴얼(배치 동일).
// 12단계 타임라인 + 고객 + 요약 + 협력사 RFQ + 결제 후 부품 확인(D43) + 조달 발주(D18) + 품목·검토 + 보낸 메일.
// Case 삭제는 머리(PCB 와 같은 자리). 무관 파트에서 들어오면(?from=) 큰 섹션을 한 줄로 접는다(§6.12). 상태·조작은 case/useSmartbomCase
// (core·rfq·items·po·review)가 한 곳에 들고, 섹션 컴포넌트는 그리기만 한다.
const {
  detail,
  detailQuery,
  detailNotFound,
  detailErrorMessage,
  retryDetail,
  caseNo,
  collapsed,
  expandSection,
  rfqs,
  rfqQuery,
  scopeItems,
  supplierComparisonTargetCount,
  sendOpen,
  compareOpen,
  openRfqReply,
  reissueLink,
  rfqLinkNotice,
  rfqLinkError,
  reissueMagicLink,
  pos,
  poQuery,
  poError,
  canIssuePo,
  issueDisabledReason,
  poBusy,
  checkingPoId,
  openPoCreate,
  removePo,
  confirmSupplierPurchase,
  closePoRow,
  retryExternalPo,
  checkExternalPo,
  downloadPoImportFile,
  openShipment,
  openShortageRecovery,
} = provideSmartbomCase();

const onExpand = (section: 'rfq' | 'po' | 'items', open: boolean): void => {
  if (open) expandSection(section);
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <CaseHeader />

    <p v-if="detailQuery.isLoading.value" class="text-muted-foreground flex items-center gap-2 text-sm">
      <Spinner />
      불러오는 중…
    </p>
    <p v-else-if="detailQuery.isError.value && detailNotFound" class="text-muted-foreground text-sm">Case를 찾을 수 없습니다.</p>
    <Alert v-else-if="detailQuery.isError.value" variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>
        <div class="flex flex-wrap items-center gap-3">
          <span>{{ detailErrorMessage }}</span>
          <Button variant="outline" size="sm" :disabled="detailQuery.isFetching.value" @click="void retryDetail()">
            <RotateCwIcon />
            {{ detailQuery.isFetching.value ? '다시 불러오는 중…' : '다시 시도' }}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
    <p v-else-if="detail === null" class="text-muted-foreground text-sm">Case를 찾을 수 없습니다.</p>

    <template v-else>
      <CaseTimeline />
      <CaseCustomerCard :customer="detail.customer" />
      <CaseSummaryStrip />

      <!-- 협력사 RFQ 현황 — 무관 파트 진입 시 한 줄 접힘(§6.12) -->
      <SectionCard
        v-if="collapsed.has('rfq')"
        :title="`협력사 RFQ (${String(rfqs.length)}건)`"
        collapsible
        :open="false"
        @update:open="(open) => onExpand('rfq', open)"
      />
      <RfqPanel
        v-else
        :rfqs="rfqs"
        :scope-items="scopeItems"
        :supplier-comparison-target-count="supplierComparisonTargetCount"
        :loading="rfqQuery.isLoading.value"
        :can-send="detail.status === 'reviewing'"
        :busy="reissueLink.isPending.value"
        :action-notice="rfqLinkNotice"
        :action-error="rfqLinkError"
        @send="sendOpen = true"
        @compare="compareOpen = true"
        @reply="openRfqReply"
        @reissue-link="(rfq) => void reissueMagicLink(rfq)"
      />

      <!-- 결제 후 부품 확인 요청(D43) — 주문이 있는 Case 에만. 발주 게이트와 맞물려 발주 바로 위에 둔다. -->
      <ConfirmPanel
        v-if="detail.orderInfo !== null"
        :quote-id="detail.id"
        :usd-krw-rate="detail.usdKrwRateUsed"
        :case-label="`${caseNo} · ${detail.title}`"
      />

      <!-- 협력사 발주(D18) — 결제 확인 후 -->
      <SectionCard
        v-if="collapsed.has('po')"
        :title="`조달 발주 (${String(pos.length)}건)`"
        collapsible
        :open="false"
        @update:open="(open) => onExpand('po', open)"
      />
      <PoPanel
        v-else
        :pos="pos"
        :loading="poQuery.isLoading.value"
        :can-issue="canIssuePo"
        :issue-disabled-reason="issueDisabledReason"
        :busy="poBusy"
        :checking-po-id="checkingPoId"
        @create="openPoCreate"
        @remove="(po) => void removePo(po)"
        @confirm-supplier="(po) => void confirmSupplierPurchase(po)"
        @close="(po) => void closePoRow(po)"
        @external="(po) => void retryExternalPo(po)"
        @check="(po) => void checkExternalPo(po)"
        @import-file="(po) => void downloadPoImportFile(po)"
        @shipment="openShipment"
        @recover="openShortageRecovery"
      />
      <Alert v-if="poError !== ''" variant="destructive" size="sm" role="alert">
        <AlertDescription>{{ poError }}</AlertDescription>
      </Alert>

      <!-- 품목 표+검토 — 견적 담당 외 진입에선 접힘(가장 큰 몸통, §6.12). 넓은 화면은 표 | 검토 2단. -->
      <SectionCard
        v-if="collapsed.has('items')"
        :title="`품목·검토 (${String(detail.items.length)}행)`"
        collapsible
        :open="false"
        @update:open="(open) => onExpand('items', open)"
      />
      <div v-else class="grid gap-4 min-[1760px]:grid-cols-[minmax(0,1fr)_340px]">
        <ItemsSection class="order-2 min-w-0 min-[1760px]:order-1" />
        <ReviewPanel class="order-1 h-fit min-[1760px]:order-2" />
      </div>

      <MailSection />
    </template>

    <CompletionDialog />
    <ResendEmailDialog />
    <QuoteClosingDialog />
    <PartAddConfirmDialog />
    <PartRemoveConfirmDialog />
    <ReplyDialog />
    <CaseExternals />
    <!-- 후보 서랍(CaseExternals) 위에 떠야 하므로 서랍보다 뒤에 둔다. -->
    <PartSelectionConfirmDialog />
  </div>
</template>
