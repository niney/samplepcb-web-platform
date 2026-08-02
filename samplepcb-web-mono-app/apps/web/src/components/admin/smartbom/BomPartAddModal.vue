<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PartHitType } from '@sp/api-contract';
import { neededQty, type OfferPick } from '@sp/utils';
import BomPartSearchPanel from '../bom/BomPartSearchPanel.vue';

// SmartBOM 관리자 수동 행 추가 — 세트당 BOM 수량을 먼저 확정하고 같은 수량 문맥으로
// 카탈로그 오퍼의 MOQ·주문배수·가격을 비교한다. 실제 값은 서버가 다시 계산한다.

const props = defineProps<{
  setQty: number;
  spareQty: number;
  usdKrwRate: number | null;
  selecting: boolean;
  readOnly: boolean;
  lockedReason: string;
  error: string;
}>();

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null, bomQty: number];
  close: [];
}>();

const bomQty = ref(1);
const quantityValid = computed(
  () => Number.isInteger(bomQty.value) && bomQty.value >= 1 && bomQty.value <= 100000,
);
const normalizedBomQty = computed(() => quantityValid.value ? bomQty.value : 1);
const needed = computed(() => neededQty(
  normalizedBomQty.value,
  props.setQty,
  props.spareQty,
));

function onSelect(part: PartHitType, pick: OfferPick | null): void {
  if (props.readOnly || props.selecting || !quantityValid.value) return;
  emit('select', part, pick, bomQty.value);
}
</script>

<template>
  <div
    class="fixed inset-0 z-[90] grid place-items-center bg-slate-950/55 p-4"
    role="presentation"
    @mousedown.self="emit('close')"
  >
    <section
      class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-blue-200 bg-surface shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-part-add-title"
    >
      <header class="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-blue-200 bg-blue-50 px-4 py-3 sm:px-5">
        <h3 id="admin-part-add-title" class="mr-auto text-base font-bold text-slate-950 sm:text-lg">견적에 부품 추가</h3>
        <label class="flex h-8 items-center gap-1.5 rounded-lg border border-blue-200 bg-surface px-2 text-[11px] font-bold text-slate-600">
          세트당
          <input
            v-model.number="bomQty"
            type="number"
            min="1"
            max="100000"
            step="1"
            class="h-6 w-20 rounded border border-slate-300 bg-surface px-1.5 text-right text-xs font-bold tabular-nums text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            :disabled="selecting"
          >
        </label>
        <button
          type="button"
          class="grid size-8 place-items-center rounded-lg text-base text-slate-400 transition hover:bg-blue-100 hover:text-slate-700"
          aria-label="닫기"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="p-4 sm:p-5">
        <p v-if="!quantityValid" class="text-xs font-semibold text-red-600">세트당 수량은 1~100,000 사이 정수로 입력해 주세요.</p>
        <p
          v-if="readOnly"
          class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-900"
        >
          지금은 검색·가격 비교만 가능합니다. {{ lockedReason }}
        </p>
        <p v-if="error !== ''" class="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          {{ error }}
        </p>

        <BomPartSearchPanel
          class="mt-3"
          initial-query=""
          :needed="needed"
          :usd-krw-rate="usdKrwRate"
          :selecting="selecting || !quantityValid"
          :browse="readOnly"
          @select="onSelect"
        />
      </div>
    </section>
  </div>
</template>
