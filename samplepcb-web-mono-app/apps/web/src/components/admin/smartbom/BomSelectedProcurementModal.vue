<script setup lang="ts">
import { computed } from 'vue';
import type { BomQuoteItemType } from '@sp/api-contract';

const props = defineProps<{
  open: boolean;
  providerName: string;
  providerKind: 'supplier' | 'partner' | 'other';
  items: BomQuoteItemType[];
}>();
const emit = defineEmits<{ close: [] }>();

const providerKindLabel = computed(() =>
  props.providerKind === 'supplier'
    ? 'API 공급사'
    : props.providerKind === 'partner'
      ? '협력사 회신'
      : '기타 구매처');

const selectedTotal = computed(() => props.items.reduce(
  (sum, item) => sum + (item.lineTotalKrw ?? 0),
  0,
));
const unpricedCount = computed(() => props.items.filter((item) => item.lineTotalKrw === null).length);

const fmt = (value: number): string => value.toLocaleString('ko-KR');
const fmtMoney = (value: number | null): string =>
  value === null ? '금액 미확정' : `${fmt(Math.round(value))}원`;
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
    @click.self="emit('close')"
  >
    <section class="flex max-h-[92vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
      <header class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-4">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="truncate text-lg font-bold text-gray-950">{{ providerName }} 선정 품목</h2>
            <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              {{ providerKindLabel }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500">
            {{ items.length }}개 품목 · 선정 합계 <b class="text-gray-800">{{ fmtMoney(selectedTotal) }}</b>
            <template v-if="unpricedCount > 0"> · 금액 미확정 {{ unpricedCount }}개</template>
          </p>
        </div>
        <button
          type="button"
          class="ml-auto grid size-9 shrink-0 place-items-center rounded-lg text-xl text-gray-400"
          aria-label="선정 품목 닫기"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-auto">
        <table class="w-full min-w-[960px] divide-y divide-gray-100 text-xs">
          <thead class="sticky top-0 z-10 bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-4 py-2.5">품번·제조사</th>
              <th class="px-4 py-2.5">공급사 SKU·포장</th>
              <th class="px-4 py-2.5 text-right">주문수량</th>
              <th class="px-4 py-2.5 text-right">선정 단가</th>
              <th class="px-4 py-2.5 text-right">행 합계</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in items" :key="item.id">
              <td class="max-w-64 px-4 py-3">
                <p class="truncate font-semibold text-gray-900">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</p>
                <p class="mt-0.5 truncate text-[11px] text-gray-400">{{ item.manufacturerName ?? '제조사 미확인' }}</p>
              </td>
              <td class="max-w-64 px-4 py-3">
                <p class="truncate font-medium text-gray-700">{{ item.selectedOffer?.supplierSku || 'SKU 미제공' }}</p>
                <p class="mt-0.5 truncate text-[11px] text-gray-400">{{ item.selectedOffer?.packaging ?? '포장 미상' }}</p>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-gray-700">
                {{ fmt(item.orderQty) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">
                <template v-if="item.selectedOffer !== null">
                  {{ item.selectedOffer.unitPrice.toLocaleString('ko-KR') }} {{ item.selectedOffer.currency }}
                </template>
                <span v-else class="text-gray-400">—</span>
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums text-blue-700">
                {{ fmtMoney(item.lineTotalKrw) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="flex justify-end border-t border-gray-100 px-5 py-3">
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold text-gray-700"
          @click="emit('close')"
        >
          닫기
        </button>
      </footer>
    </section>
  </div>
</template>
