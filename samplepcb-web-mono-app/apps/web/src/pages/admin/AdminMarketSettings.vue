<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAdminMarketSettings, useSaveMarketSettings } from '../../admin/useAdminMarket';

// 재능마켓 설정 — 전문가측 수수료율(bp, 100bp=1%). 정산 계산의 정본은 2차(계약 스냅샷).

const { data, isLoading } = useAdminMarketSettings();
const save = useSaveMarketSettings();

const percentInput = ref('');
const saved = ref(false);
const error = ref('');

watch(
  data,
  (d) => {
    if (d !== undefined && percentInput.value === '') {
      percentInput.value = (d.data.feeRateBp / 100).toFixed(1);
    }
  },
  { immediate: true },
);

const bp = computed<number | null>(() => {
  const n = Number(percentInput.value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
});

async function onSave(): Promise<void> {
  saved.value = false;
  error.value = '';
  if (bp.value === null) {
    error.value = '0~100 사이 퍼센트를 입력해 주세요.';
    return;
  }
  try {
    await save.mutateAsync(bp.value);
    saved.value = true;
  } catch {
    error.value = '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}
</script>

<template>
  <div class="max-w-lg space-y-4">
    <h1 class="text-xl font-bold">마켓 설정</h1>

    <div class="rounded-xl border border-gray-200 bg-white p-6">
      <p class="text-sm font-bold text-gray-800">플랫폼 중개 수수료 (전문가측 공제)</p>
      <p class="mt-1 text-xs leading-relaxed text-gray-500">
        정산 시 전문가 수령액에서 공제되는 요율입니다. 이미 채택된 거래에는 2차 계약
        스냅샷 요율이 적용될 예정이라 소급되지 않습니다.
      </p>
      <div class="mt-4 flex items-center gap-2">
        <input
          v-model="percentInput"
          type="number"
          step="0.1"
          min="0"
          max="100"
          class="h-10 w-28 rounded-lg border border-gray-200 px-3 text-sm"
          :disabled="isLoading"
        >
        <span class="text-sm font-bold text-gray-700">%</span>
        <button
          type="button"
          class="ml-auto rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="save.isPending.value || bp === null"
          @click="onSave"
        >
          {{ save.isPending.value ? '저장 중…' : '저장' }}
        </button>
      </div>
      <p v-if="saved" class="mt-3 text-xs font-semibold text-emerald-600">저장되었습니다.</p>
      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
