<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDownIcon, ChevronUpIcon, DownloadIcon, PanelRightIcon, TriangleAlertIcon } from '@lucide/vue';
import { fmtKstDate } from '@sp/utils';
import { downloadAdminFile } from '@/admin/useAdminQuotes';
import { fmtPcbAmount, pcbKrwSuffix, pcbMoneyWithSub } from '@/lib/pcb-money';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { pcbCategoryBadge } from '@/next/components/pcb/pcb-badges';
import { rateNote } from './case-core';
import { usePcbCaseContext } from './usePcbCase';

// 사양·견적·주문을 옆으로 세우지 않고 위아래로 쌓는다 — 셋은 순차적으로 하는 다른 일이고, 나란히 두면
// 짧은 쪽이 긴 쪽 높이에 끌려간다(실측 724px). 세 줄 모두 같은 문법: 좌측 이름 · 가운데 값 · 우측 동작.
// 금액은 칸으로 나눠 tabular-nums 로 자릿수를 맞춘다. 견적(팔기 전)과 주문·수금(팔린 후)은 다른 사건이라
// 줄을 가르고, 주문이 없으면 그 줄은 아예 없다.
const {
  detail,
  specId,
  specHeadline,
  specEntries,
  gerberFiles,
  specPanelOpen,
  selectedRow,
  estimateSent,
  estimateSendState,
  estimateEnabled,
  estimateBlockedReason,
  estimateProjectId,
  openPriceModal,
  orderDisplayStatus,
  isCanceledItem,
  canConfirmReceipt,
  confirmReceipt,
  receipt,
  canReviewOrderCancel,
  cancelOrderOpen,
  orderDetailOpen,
} = usePcbCaseContext();

const sendToneClass = computed(() =>
  estimateSendState.value.tone === 'success'
    ? 'text-success'
    : estimateSendState.value.tone === 'danger'
      ? 'text-destructive'
      : 'text-warning',
);
const message = computed(() => detail.value?.message ?? null);
const openEstimate = (): void => {
  estimateProjectId.value = specId.value;
};
const toggleSpecPanel = (): void => {
  specPanelOpen.value = !specPanelOpen.value;
};
</script>

<template>
  <section v-if="detail !== null" class="bg-card divide-y overflow-hidden rounded-xl border shadow-xs">
    <!-- 제작 사양 — 협력사와 통화하며 그대로 읽는 값만 한 줄로. 전체 항목은 우측 곁판으로(확인하는 것이라).
         첨부는 여기 남긴다 — 내려받기는 곁판을 열 이유가 아니다. -->
    <div class="border-l-muted-foreground/40 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 px-4 py-3">
      <span class="text-muted-foreground w-20 shrink-0 text-xs font-medium">제작 사양</span>
      <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <!-- 제품군은 배지로 — 뒤의 값들과 회색 텍스트로 흘리면 분류로 읽히지 않는다. -->
        <Badge :variant="pcbCategoryBadge(detail.category).variant">{{ pcbCategoryBadge(detail.category).label }}</Badge>
        <template v-for="(k, i) in specHeadline" :key="k.label">
          <span v-if="i > 0" class="bg-border size-1 shrink-0 self-center rounded-full" />
          <span class="text-sm font-semibold whitespace-nowrap tabular-nums" :title="k.label">
            {{ k.value }}<span v-if="k.unit" class="text-muted-foreground ml-0.5 text-xs font-medium">{{ k.unit }}</span>
          </span>
        </template>
      </div>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <Button
          v-for="f in gerberFiles"
          :key="f.fileId"
          variant="outline"
          size="sm"
          class="max-w-52"
          :title="f.originFileName"
          @click="void downloadAdminFile(f.fileId, f.originFileName)"
        >
          <DownloadIcon />
          <span class="truncate">{{ f.originFileName }}</span>
        </Button>
        <Button variant="secondary" size="sm" :aria-expanded="specPanelOpen" @click="toggleSpecPanel">
          <PanelRightIcon />
          제작 사양
          <span class="text-muted-foreground tabular-nums">{{ specEntries.length }}</span>
        </Button>
      </div>
      <p v-if="message !== null && message !== ''" class="flex w-full items-baseline gap-2">
        <span class="text-muted-foreground shrink-0 text-xs font-medium">고객 요청</span>
        <span class="text-muted-foreground min-w-0 flex-1 truncate text-sm">{{ message.replace(/\s*\n+\s*/g, ' ') }}</span>
        <Button variant="link" size="xs" @click="specPanelOpen = true">전문 보기</Button>
      </p>
    </div>

    <!-- 고객 견적 -->
    <div class="border-l-success flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 px-4 py-3">
      <span class="text-muted-foreground w-20 shrink-0 text-xs font-medium">고객 견적</span>
      <dl class="flex min-w-0 flex-1 flex-wrap items-stretch gap-y-1 divide-x">
        <div class="pr-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">확정 총액 <span class="font-normal">(VAT 포함)</span></dt>
          <dd
            class="text-base font-semibold whitespace-nowrap tabular-nums"
            :class="detail.finalPrice === null ? 'text-muted-foreground' : 'text-success'"
          >
            {{ fmtPcbAmount('KRW', detail.finalPrice) }}
          </dd>
        </div>
        <div v-if="detail.priceAmounts !== null" class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">공급가액</dt>
          <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ fmtPcbAmount('KRW', detail.priceAmounts.supply) }}</dd>
        </div>
        <div v-if="detail.priceAmounts !== null" class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">부가세</dt>
          <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ fmtPcbAmount('KRW', detail.priceAmounts.vat) }}</dd>
        </div>
        <div v-if="detail.quote?.autoPrice != null" class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">자동견적</dt>
          <dd class="text-muted-foreground text-base whitespace-nowrap tabular-nums">{{ fmtPcbAmount('KRW', detail.quote.autoPrice) }}</dd>
        </div>
        <!-- 확정가 옆에 원가를 세우는 자리 — 이 둘만은 나란히 봐야 마진이 보인다. -->
        <div v-if="selectedRow !== null" class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">선정 원가</dt>
          <dd class="text-sm font-medium whitespace-nowrap tabular-nums">
            {{ pcbMoneyWithSub(selectedRow.currency, selectedRow.priceOriginal, selectedRow.subCurrency, selectedRow.subPriceOriginal)
            }}{{ pcbKrwSuffix(selectedRow.currency, selectedRow.krwAmount)
            }}<span class="text-muted-foreground text-xs font-normal">{{
              rateNote(selectedRow.currency, selectedRow.krwAmount, selectedRow.exchangeRate, '선정 시점')
            }}</span>
          </dd>
        </div>
      </dl>
      <!-- ① 확정 ─▸ ② 발송 — 확정가만 등록하고 끝내면 고객은 아무것도 모른다(자동 발송 없음). 상태와 행동이
           같은 자리에 있어야 두 번 보내지도, 보낸 걸 또 찾지도 않는다. -->
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <span class="text-muted-foreground flex items-center gap-1.5 text-xs font-medium whitespace-nowrap">
          <span
            class="inline-flex size-4 items-center justify-center rounded-full text-xs font-semibold"
            :class="detail.finalPrice === null ? 'bg-muted text-muted-foreground' : 'bg-success text-background'"
          >1</span>확정가
          <span>—</span>
          <span
            class="inline-flex size-4 items-center justify-center rounded-full text-xs font-semibold"
            :class="estimateSent
              ? 'bg-success text-background'
              : estimateEnabled
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'"
          >2</span>
          <span :class="sendToneClass" :title="estimateSendState.title">{{ estimateSendState.label }}</span>
        </span>
        <!-- 확정가(판매가)는 주문 후 불변 — 주문된 건에선 버튼이 사라진다(D10). -->
        <Button
          v-if="detail.order === null"
          size="sm"
          :disabled="detail.cartState !== 'none' || detail.status !== 'active'"
          @click="openPriceModal"
        >
          {{ detail.finalPrice === null ? '확정가 등록' : '확정가 수정' }}
        </Button>
        <!-- 누르면 견적서가 열리고, 수신자를 확인한 뒤 그 안에서 보낸다(클릭 즉시 발송 아님). -->
        <Button
          variant="outline"
          size="sm"
          :disabled="!estimateEnabled"
          :title="estimateEnabled ? '견적서를 열어 수신자를 확인하고 발송합니다' : estimateBlockedReason"
          @click="openEstimate"
        >
          {{ estimateSent ? '다시 보내기' : '보내기' }}
        </Button>
      </div>
      <p v-if="detail.order === null && detail.finalPrice === null" class="text-muted-foreground w-full text-xs">
        확정가를 등록해야 고객이 주문할 수 있습니다(견적 확정). 협력사 [선정] 대화상자에서 마진을 더해 함께 등록할 수
        있고, 여기서는 등록된 확정가를 수정합니다.
      </p>
    </div>

    <!-- 주문 · 수금 — od read-only 파생. 레거시 이관 주문 이력 열람의 정위치. -->
    <div
      v-if="detail.order !== null"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-4 px-4 py-3"
      :class="detail.order.misu > 0 ? 'border-l-destructive' : 'border-l-primary'"
    >
      <span class="text-muted-foreground w-20 shrink-0 text-xs font-medium">주문 · 수금</span>
      <dl class="flex min-w-0 flex-1 flex-wrap items-stretch gap-y-1 divide-x">
        <div class="pr-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">주문번호</dt>
          <dd class="font-mono text-xs font-medium whitespace-nowrap">
            {{ detail.order.odId }}
            <span class="text-primary font-sans text-xs font-medium">PCB {{ detail.order.orderPcbCount }}건</span>
          </dd>
        </div>
        <div class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">상태</dt>
          <dd
            class="text-base font-semibold whitespace-nowrap"
            :class="isCanceledItem(detail.order.ctStatus) || detail.order.odStatus === '취소'
              ? 'text-muted-foreground'
              : detail.order.isPaid ? 'text-success' : 'text-warning'"
          >
            {{ orderDisplayStatus }}<span v-if="orderDisplayStatus === '주문'" class="text-xs font-medium"> (입금 대기)</span>
          </dd>
        </div>
        <div class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">이 PCB 금액</dt>
          <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ fmtPcbAmount('KRW', detail.order.lineAmount) }}</dd>
        </div>
        <div class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">주문 전체 결제대상</dt>
          <dd class="text-muted-foreground text-base whitespace-nowrap tabular-nums">{{ fmtPcbAmount('KRW', detail.order.orderPrice) }}</dd>
        </div>
        <div class="px-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">현금수납</dt>
          <dd
            class="text-base font-semibold whitespace-nowrap tabular-nums"
            :class="detail.order.receiptPrice > 0 ? 'text-success' : 'text-muted-foreground'"
          >
            {{ fmtPcbAmount('KRW', detail.order.receiptPrice) }}
          </dd>
        </div>
        <div class="pl-4">
          <dt class="text-muted-foreground text-xs whitespace-nowrap">결제수단 · 주문일</dt>
          <dd class="text-xs font-medium whitespace-nowrap">
            {{ detail.order.settleCase || '—' }} · {{ fmtKstDate(detail.order.orderedAt) }}
          </dd>
        </div>
      </dl>
      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <!-- 미수·과입금은 금액 칸에 섞지 않는다 — 다른 숫자와 같은 무게로 읽혀 놓친다. -->
        <Badge v-if="detail.order.misu !== 0" :variant="detail.order.misu > 0 ? 'danger' : 'warning'">
          <TriangleAlertIcon />
          {{ detail.order.misu > 0 ? '미수금' : '과입금' }} {{ fmtPcbAmount('KRW', Math.abs(detail.order.misu)) }}
        </Badge>
        <!-- 미입금이면 여기서 바로 처리 — 아래 발주 패널이 결제 게이트(NOT_PAID)로 막히기 때문. -->
        <Button v-if="canConfirmReceipt" size="sm" :disabled="receipt.isPending.value" @click="void confirmReceipt()">
          입금확인
        </Button>
        <Button v-if="canReviewOrderCancel" variant="outline" size="sm" @click="cancelOrderOpen = true">주문 취소</Button>
        <!-- 세액·포인트·환불은 줄에 다 못 담는다. 실측상 대부분 0이라 접고, 값이 있으면 여기서 편다. -->
        <Button variant="ghost" size="sm" :aria-expanded="orderDetailOpen" @click="orderDetailOpen = !orderDetailOpen">
          세부
          <ChevronUpIcon v-if="orderDetailOpen" />
          <ChevronDownIcon v-else />
        </Button>
      </div>
      <!-- 견적 접수 때의 고객 요청과 다른, 주문서의 전하실 말씀(od_memo) — 세부 접기 밖에 항상 보인다. -->
      <Alert v-if="detail.order.memo.trim() !== ''" variant="warning" size="sm">
        <AlertDescription>
          <div class="flex items-start gap-2">
            <Badge variant="warning">전하실 말씀</Badge>
            <span class="text-foreground min-w-0 flex-1 break-words whitespace-pre-wrap">{{ detail.order.memo }}</span>
          </div>
        </AlertDescription>
      </Alert>
      <p v-if="!detail.order.isPaid && !canConfirmReceipt" class="text-warning w-full text-xs">
        미입금 주문입니다 — 무통장 외 결제수단은 통합 관리 주문내역에서 처리하세요.
      </p>
    </div>

    <dl
      v-if="detail.order !== null && orderDetailOpen"
      class="bg-muted/40 grid grid-cols-2 gap-x-6 gap-y-1 px-4 py-3 text-xs sm:grid-cols-4"
    >
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">공급가액</dt>
        <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.supply) }}</dd>
      </div>
      <div class="flex justify-between gap-2">
        <dt class="text-muted-foreground">부가세</dt>
        <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.vat) }}</dd>
      </div>
      <div v-if="detail.order.taxAmounts.taxFree > 0" class="flex justify-between gap-2">
        <dt class="text-muted-foreground">비과세액</dt>
        <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.taxAmounts.taxFree) }}</dd>
      </div>
      <div v-if="detail.order.receiptPoint !== 0" class="flex justify-between gap-2">
        <dt class="text-muted-foreground">사용 포인트</dt>
        <dd class="tabular-nums">{{ fmtPcbAmount('KRW', detail.order.receiptPoint) }}</dd>
      </div>
      <div v-if="detail.order.refundPrice !== 0" class="flex justify-between gap-2">
        <dt class="text-muted-foreground">환불 누계</dt>
        <dd class="text-destructive tabular-nums">-{{ fmtPcbAmount('KRW', detail.order.refundPrice) }}</dd>
      </div>
      <div v-if="detail.order.receiptPoint !== 0 || detail.order.refundPrice !== 0" class="flex justify-between gap-2">
        <dt class="font-medium">순결제액</dt>
        <dd class="text-success font-medium tabular-nums">{{ fmtPcbAmount('KRW', detail.order.netReceipt) }}</dd>
      </div>
      <p class="text-muted-foreground col-span-full pt-0.5 text-xs">세액은 주문 전체에 저장된 영카트 실제 값 기준입니다.</p>
    </dl>
  </section>
</template>
