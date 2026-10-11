<script setup lang="ts">
import { computed } from 'vue';
import { PCB_PO_STATUS_LABELS, type AdminPcbPoViewType } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { fmtPcbAmount, pcbKrwSuffix, pcbMoneyWithSub } from '@/lib/pcb-money';
import { Badge } from '@/next/components/ui/badge';
import { TableCell, TableRow } from '@/next/components/ui/table';
import ChildPoRow from './ChildPoRow.vue';
import PoActionsCell from './PoActionsCell.vue';
import PoEqBand from './PoEqBand.vue';
import ShipmentRow from './ShipmentRow.vue';
import { pcbPoStatusVariant as poStatusVariant } from '@/next/components/pcb/pcb-badges';
import { pcbEqReworkBadge } from '@/next/components/pcb/pos/pos-badges';
import { dateOnly, rateNote } from './case-core';
import { usePcbCaseContext } from './usePcbCase';

// 발주서 한 건 — 본행 + EQ 줄(파일·고객 확인·판정을 요청 회차로) + 선적 줄(대표 발주 아래 1줄, 묶음 포함) + MD 하위 발주 요약 줄.
const props = defineProps<{ po: AdminPcbPoViewType }>();

const { poRework, poReopenAuthor, isPoOverdue, shipRowsOf, childPosOf, showEqBand } = usePcbCaseContext();

// 발주접수로 돌아온 이유 — 관리자 반려(우리가 돌려보냄) 또는 협력사 추가 EQ 요청(승인 뒤 협력사가 다시 연 것, D20 후속).
const rework = computed(() => poRework(props.po));
const reworkBadge = computed(() => (rework.value === null ? null : pcbEqReworkBadge(props.po.track, rework.value.kind)));
</script>

<template>
  <!-- EQ 승인요청 = 관리자 차례 — 행을 강조해 표에서 먼저 눈에 걸리게 한다(바로 아래 EQ 줄도 같이 강조된다). -->
  <TableRow :data-state="po.status === 'eq_requested' ? 'selected' : undefined" data-po-row>
    <!-- 협력사 이름은 줄바꿈 금지 — 옆 칸의 긴 결제조건이 폭을 가져가면 이 칸이 0폭으로 붕괴한다 -->
    <TableCell class="whitespace-nowrap">
      <p class="flex items-center gap-1.5 font-medium">
        {{ po.partnerName }}
        <Badge v-if="po.reorderRound > 0" variant="danger">{{ po.reorderRound }}차</Badge>
      </p>
      <p v-if="po.eqDelegatePoId !== null" class="text-info text-xs">
        MD 경유 — {{ po.track === 'stencil' ? '확인은' : 'EQ는' }} 하위에서 진행(자동 반영)
      </p>
      <p v-else-if="po.eqBlocked" class="text-warning text-xs">
        MD 하위 발주 대기 — 발주되면 {{ po.track === 'stencil' ? '확인 절차' : 'EQ' }} 시작
      </p>
      <p v-else-if="po.fulfillmentMode === 'self'" class="text-muted-foreground text-xs">
        직접 제작 — 이 발주서에서 {{ po.track === 'stencil' ? '확인·생산' : 'EQ·생산' }} 진행
      </p>
      <!-- 계정 없는 조직 — 기다려도 오지 않는다. 대행이 필요하다는 신호를 이름 밑에 둔다(어느 줄이 대행
           몫인지부터 읽혀야 한다). -->
      <p
        v-if="!po.partnerHasPortal"
        class="text-warning text-xs font-medium"
        :title="`이 조직에는 포털 연결 계정이 없습니다 — ${po.track === 'stencil' ? '확인' : 'EQ'}·생산·선적을 관리자가 대행해야 진행됩니다(견적 회신은 매직링크로 협력사가 직접 합니다).`"
      >
        포털 계정 없음 — 대행 필요
      </p>
    </TableCell>
    <TableCell>
      <span class="inline-flex flex-wrap items-center gap-1">
        <Badge :variant="poStatusVariant(po.status)">{{ PCB_PO_STATUS_LABELS[po.track][po.status] }}</Badge>
        <!-- 반려하거나 협력사가 추가 EQ 를 요청하면 상태가 issued 로 돌아가 '발주접수'만 남는다 — 방금 돌아온 건과
             발주 직후인 건이 같아진다. 워크큐와 같은 문구로 갈라 주고(반려=문제색 · 추가 EQ 요청=주의색), 사유를 함께 보여 준다. -->
        <Badge v-if="po.status === 'issued' && rework !== null && reworkBadge !== null" :variant="reworkBadge.variant" data-eq-rework-badge>
          {{ reworkBadge.label }} {{ fmtKstDate(rework.at) }}
        </Badge>
      </span>
      <!-- 사유 — 반려는 내가 쓴 말, 추가 EQ 요청은 협력사가 쓴 말(누구 말인지 색과 머리말로 가른다). 전문은 바로 아래
           EQ 줄이 잘리지 않게 보이므로, 여기서는 EQ 줄이 없는 행(위임·차단 발주)에서만 줄여서 남긴다. -->
      <p
        v-if="!showEqBand(po) && rework !== null && rework.note !== '' && (po.status === 'issued' || po.status === 'eq_requested')"
        class="mt-1 max-w-52 truncate text-xs"
        :class="rework.kind === 'reopen' ? 'text-warning' : 'text-destructive'"
        :title="rework.kind === 'reopen' ? `추가 EQ 요청 사유(${poReopenAuthor(po, rework)}): ${rework.note}` : rework.note"
        data-eq-rework-note
      >
        <template v-if="rework.kind === 'reopen'">{{ poReopenAuthor(po, rework) }}: </template>“{{ rework.note }}”
      </p>
    </TableCell>
    <TableCell class="whitespace-nowrap tabular-nums">
      {{ pcbMoneyWithSub(po.currency, po.priceOriginal, po.subCurrency, po.subPriceOriginal) }}
      <span class="text-muted-foreground text-xs">
        {{ pcbKrwSuffix(po.currency, po.krwAmount) }}{{ rateNote(po.currency, po.krwAmount, po.exchangeRate, '발주 시점') }}
      </span>
    </TableCell>
    <!-- 조건 문자열은 길다(예: '50% PRE-PAID / 50% BEFORE SHIPMENT') — 잘라서 제목으로 넘기고 폭을 고정한다. -->
    <TableCell class="text-muted-foreground max-w-56 text-xs">
      <p class="truncate" :title="po.paymentTerms ?? ''">{{ po.paymentTerms ?? '—' }}</p>
      <p v-if="po.remittanceDueOn !== null" class="text-primary mt-0.5 font-medium">송금 예정 {{ fmtKstDate(po.remittanceDueOn) }}</p>
      <!-- 초록 배지 하나로는 부분 송금과 완납이 같아 보인다 — 금액으로 말한다 -->
      <p v-if="po.remittance.count > 0" class="mt-0.5">
        <Badge
          :variant="po.remittance.balance > 0.005 ? 'warning' : 'success'"
          :title="`최근 송금 ${dateOnly(po.remittedAt)} · ${String(po.remittance.count)}회`"
        >
          송금 {{ fmtPcbAmount(po.currency, po.remittance.paidAmount) }}/{{ fmtPcbAmount(po.currency, po.priceOriginal) }}
          <template v-if="po.remittance.balance > 0.005"> · 잔액 {{ fmtPcbAmount(po.currency, po.remittance.balance) }}</template>
          <template v-else-if="po.remittance.balance < -0.005"> · 과지급 {{ fmtPcbAmount(po.currency, -po.remittance.balance) }}</template>
        </Badge>
      </p>
      <p v-else class="mt-0.5">송금 전</p>
    </TableCell>
    <!-- 납기 경과는 큐와 같은 규칙(계약 isPcbDeliveryOverdue)으로 말한다 -->
    <TableCell class="whitespace-nowrap" :class="isPoOverdue(po) ? 'text-destructive font-medium' : 'text-muted-foreground'">
      {{ dateOnly(po.deliveryDate) }}
      <Badge v-if="isPoOverdue(po)" variant="danger" title="납기일이 지났는데 아직 생산완료가 아닙니다.">납기 초과</Badge>
    </TableCell>
    <TableCell class="text-right">
      <PoActionsCell :po="po" />
    </TableCell>
  </TableRow>
  <PoEqBand v-if="showEqBand(po)" :po="po" />
  <ShipmentRow v-for="s in shipRowsOf(po.poId)" :key="`ship-${String(s.shipmentId)}`" :po="po" :shipment="s" />
  <ChildPoRow v-if="childPosOf(po).length > 0" :po="po" />
</template>
