<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_MD_PO_STATUS_LABELS,
  bomMdPoActionsFor,
  bomMdPoCanDelete,
  type BomMdPoActionType,
  type BomMdPoViewType,
  type BomMdPoViewerRoleType,
} from '@sp/api-contract';
import { confirmDialog } from '../../lib/confirmDialog';
import { usePartnerI18n } from '../../partner/i18n';
import { partnerIntlLocale } from '../../partner/i18n-core';
import { useAdvancePartnerMdPo, useDeletePartnerMdPo } from '../../partner/usePartnerMdPos';

// 마스터딜러 하위 발주 한 건(D47) — 발주처(마스터딜러)와 수주처(하위)가 같은 카드를 쓴다.
// 누를 수 있는 동작만 역할로 갈린다(계약 bomMdPoActionsFor — 서버 판정과 같은 함수).
//  · 하위: 발주 확인 → 출고 알림
//  · 발주처: 계정 없는 하위를 대신해 확인·출고를 찍고, 받은 것을 수령으로 닫는다. 출고 전에는 삭제.

const props = defineProps<{ mdPo: BomMdPoViewType; role: BomMdPoViewerRoleType }>();

const { pt, pn, pd, pm, locale } = usePartnerI18n();
const advanceMut = useAdvancePartnerMdPo();
const deleteMut = useDeletePartnerMdPo();

const actions = computed(() => bomMdPoActionsFor(props.mdPo.status, props.role));
const canDelete = computed(() => bomMdPoCanDelete(props.mdPo.status, props.role));
const busy = computed(() => advanceMut.isPending.value || deleteMut.isPending.value);

const carrier = ref('');
const trackingNo = ref('');
const error = ref('');
watch(locale, () => {
  error.value = '';
});

// 대행 표기 — 발주처가 하위 몫(확인·출고)을 대신 찍는 경우.
const ACTION_LABELS: Record<BomMdPoViewerRoleType, Record<BomMdPoActionType, string>> = {
  child: { confirm: '발주 확인', ship: '출고 알림', receive: '수령 확인', revert: '되돌리기' },
  parent: { confirm: '확인 처리(대행)', ship: '출고 처리(대행)', receive: '수령 확인', revert: '되돌리기' },
};

const fail = (caught: unknown): void => {
  error.value =
    caught instanceof ApiRequestError && locale.value === 'ko'
      ? caught.message
      : pt('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
};

async function run(action: BomMdPoActionType): Promise<void> {
  error.value = '';
  try {
    await advanceMut.mutateAsync({
      mdPoId: props.mdPo.mdPoId,
      body:
        action === 'ship'
          ? {
              action,
              carrier: carrier.value.trim() === '' ? null : carrier.value.trim(),
              trackingNo: trackingNo.value.trim() === '' ? null : trackingNo.value.trim(),
            }
          : { action },
    });
  } catch (caught) {
    fail(caught);
  }
}

async function remove(): Promise<void> {
  error.value = '';
  const ok = await confirmDialog({
    title: pt('하위 발주를 삭제할까요?'),
    message: pt('{name}에 보낸 발주서를 삭제합니다. 삭제한 뒤 다시 보낼 수 있습니다.', { name: props.mdPo.partnerName }),
    confirmLabel: pt('삭제'),
  });
  if (!ok) return;
  try {
    await deleteMut.mutateAsync(props.mdPo.mdPoId);
  } catch (caught) {
    fail(caught);
  }
}

const fmtUnitPrice = (value: number): string =>
  new Intl.NumberFormat(partnerIntlLocale(locale.value), { maximumFractionDigits: 4 }).format(value);

const statusCls = computed(() =>
  props.mdPo.status === 'received'
    ? 'bg-emerald-100 text-emerald-700'
    : props.mdPo.status === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-800',
);
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-3" data-testid="partner-md-po">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p class="min-w-0 flex-1 text-sm font-semibold text-gray-900">
        <!-- 발주처는 누구에게 보냈는지, 하위는 누가 보냈는지 본다 -->
        {{ role === 'parent' ? mdPo.partnerName : pt('{name} 발주', { name: mdPo.parentPartnerName }) }}
        <span v-if="role === 'child'" class="ml-1 font-normal text-gray-500">{{ mdPo.quoteTitle }}</span>
      </p>
      <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="statusCls">
        {{ pt(BOM_MD_PO_STATUS_LABELS[mdPo.status]) }}
      </span>
      <span class="text-sm font-bold tabular-nums">{{ pm(mdPo.totalAmount, mdPo.currency) }}</span>
    </div>
    <p class="mt-0.5 text-xs text-gray-500">
      {{ pt('발행일 {date}', { date: pd(mdPo.issuedAt) }) }}
      <template v-if="mdPo.shippedAt !== null">
        · {{ pt('출고 {date}', { date: pd(mdPo.shippedAt) }) }}
        <template v-if="mdPo.trackingNo !== null"> ({{ mdPo.carrier ?? '' }} {{ mdPo.trackingNo }})</template>
      </template>
      <template v-if="mdPo.receivedAt !== null"> · {{ pt('수령 {date}', { date: pd(mdPo.receivedAt) }) }}</template>
      <template v-if="role === 'parent' && !mdPo.hasPortalAccount">
        · <span class="font-semibold text-amber-700">{{ pt('포털 계정 없음 — 진행은 대신 처리해 주세요') }}</span>
      </template>
    </p>
    <p v-if="mdPo.memo !== null" class="mt-1 rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">{{ mdPo.memo }}</p>

    <table class="mt-2 w-full divide-y divide-gray-100 text-xs">
      <thead class="text-left text-gray-500">
        <tr>
          <th class="py-1 pr-2">{{ pt('부품') }}</th>
          <th class="py-1 pr-2 text-right">{{ pt('수량') }}</th>
          <th class="py-1 pr-2 text-right">{{ pt('단가({value1})', { value1: mdPo.currency }) }}</th>
          <th class="py-1 text-right">{{ pt('금액') }}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-50">
        <tr v-for="item in mdPo.items" :key="item.itemId">
          <td class="py-1 pr-2">
            <span class="font-medium">{{ item.mpn === '' ? pt('품번 미기재') : item.mpn }}</span>
            <span class="ml-1 text-gray-400">{{ item.manufacturerName ?? '' }}</span>
          </td>
          <td class="py-1 pr-2 text-right tabular-nums">{{ pn(item.qty) }}</td>
          <td class="py-1 pr-2 text-right tabular-nums">{{ fmtUnitPrice(item.unitPrice) }}</td>
          <td class="py-1 text-right tabular-nums">{{ pm(item.lineTotal, mdPo.currency) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="actions.length > 0 || canDelete" class="mt-2 flex flex-wrap items-center gap-2">
      <template v-if="actions.includes('ship')">
        <input
          v-model="carrier"
          type="text"
          maxlength="100"
          class="h-8 w-32 rounded border border-gray-300 px-2 text-xs"
          :placeholder="pt('택배사')"
          :aria-label="pt('택배사')"
        >
        <input
          v-model="trackingNo"
          type="text"
          maxlength="100"
          class="h-8 w-40 rounded border border-gray-300 px-2 text-xs"
          :placeholder="pt('송장번호')"
          :aria-label="pt('송장번호')"
        >
      </template>
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="h-8 rounded-lg px-3 text-xs font-bold disabled:opacity-40"
        :class="action === 'revert'
          ? 'border border-gray-300 text-gray-600 hover:bg-gray-50'
          : 'bg-teal-600 text-white hover:bg-teal-700'"
        :disabled="busy"
        @click="run(action)"
      >
        {{ pt(ACTION_LABELS[role][action]) }}
      </button>
      <button
        v-if="canDelete"
        type="button"
        class="ml-auto h-8 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
        :disabled="busy"
        @click="remove"
      >
        {{ pt('삭제') }}
      </button>
    </div>
    <p v-if="error !== ''" class="mt-1 text-xs font-semibold text-red-600" role="alert">{{ error }}</p>
  </div>
</template>
