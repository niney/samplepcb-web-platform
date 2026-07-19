<script setup lang="ts">
import { ref, watch } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import { BomQuoteConfigResponse, apiRoutes, type BomQuoteConfigType } from '@sp/api-contract';

// 고객 BOM 견적 비용·검색 한도(sp_config bom_quote) — 레거시 하드코딩
// (운송료 30000·관리비 25000)의 관리자 설정 승격. 고객 화면엔 '예상' 라벨로 표시된다.

const path = `${apiRoutes.adminSettings}/bom-quote`;
const qc = useQueryClient();
const query = useQuery({
  queryKey: ['admin', 'settings', 'bom-quote'],
  queryFn: () => apiGet(path, BomQuoteConfigResponse),
  retry: false,
});

const form = ref<BomQuoteConfigType | null>(null);
const saved = ref(false);
const error = ref('');

watch(
  () => query.data.value?.data,
  (d) => {
    if (d !== undefined && form.value === null) form.value = { ...d };
  },
  { immediate: true },
);

const save = useMutation({
  mutationFn: (body: BomQuoteConfigType) => apiSend('PUT', path, body, BomQuoteConfigResponse),
  onSuccess: (res) => {
    form.value = { ...res.data };
    saved.value = true;
    void qc.invalidateQueries({ queryKey: ['admin', 'settings', 'bom-quote'] });
    setTimeout(() => (saved.value = false), 2_000);
  },
  onError: () => {
    error.value = '저장에 실패했습니다.';
  },
});

function submit(): void {
  if (form.value === null) return;
  error.value = '';
  // 환율 빈 입력 → null(미환산 표시)
  const rate = form.value.usdKrwRate;
  save.mutate({ ...form.value, usdKrwRate: rate === null || Number.isNaN(rate) || rate <= 0 ? null : rate });
}
</script>

<template>
  <p v-if="query.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
  <form v-else-if="form !== null" class="max-w-xl space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm" @submit.prevent="submit">
    <p class="text-sm text-gray-500">
      고객 스마트 BOM 견적의 예상 비용 기본값과 공급사 검색 한도입니다. 고객 화면에는 "예상 견적 — 확정 시 변동" 라벨로 표시되고, 확정가는 견적요청 검토에서 입력합니다.
    </p>
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block text-sm">
        <span class="text-gray-600">기본 운송료(원)</span>
        <input v-model.number="form.defaultShippingFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">기본 관리비(원)</span>
        <input v-model.number="form.defaultManagementFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">USD→KRW 환율(비우면 미환산 표시)</span>
        <input v-model.number="form.usdKrwRate" type="number" min="0" step="0.01" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums" placeholder="예: 1400">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">검색 1회 최대 API 호출 (부품 1건당 약 3콜 — 100라인 ≈ 300)</span>
        <input v-model.number="form.supplierSearchMaxCalls" type="number" min="1" max="1000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
      <label class="block text-sm">
        <span class="text-gray-600">회원별 일일 검색 한도</span>
        <input v-model.number="form.memberDailySearchLimit" type="number" min="1" max="1000" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-right tabular-nums">
      </label>
    </div>
    <div class="flex items-center gap-3">
      <button type="submit" class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50" :disabled="save.isPending.value">
        {{ save.isPending.value ? '저장 중…' : '저장' }}
      </button>
      <span v-if="saved" class="text-sm text-emerald-600">저장되었습니다.</span>
      <span v-if="error !== ''" class="text-sm text-red-600">{{ error }}</span>
    </div>
  </form>
</template>
