<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import BomPartSearchPanel from '../../components/bom/BomPartSearchPanel.vue';

// 단일 검색 — BOM 업로드 없이 부품 1건을 검색해 공급사별 구매 조건(포장·MOQ·가격구간)을
// 비교하는 화면. 검색·상세 UI는 견적 카탈로그 변경 패널(BomPartSearchPanel)의 browse 모드
// 재사용. 환율은 견적 문맥(usdKrwRateUsed)에만 있어 여기서는 원통화 그대로 표시한다.

const route = useRoute();
const initialQuery = typeof route.query.q === 'string' ? route.query.q : '';
const needed = ref<number | string>(1);
// v-model.number 는 빈 입력 시 string 을 남긴다 — 패널에는 항상 1 이상의 정수만 전달
const neededSafe = computed(() => {
  const raw = needed.value;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
});
</script>

<template>
  <div class="flex h-full flex-col items-center overflow-y-auto px-6 pb-[60px]">
    <!-- togle btn (87:9712 동형) — 이 화면에선 단일 검색이 활성 -->
    <div class="mt-[46px] flex h-[42px] shrink-0 items-center rounded-full bg-[#f0f4fa]">
      <RouterLink
        :to="{ name: 'bom' }"
        class="flex h-[42px] items-center rounded-full px-[24px] text-[16px] font-medium leading-[24px] text-[#27292e] transition hover:opacity-70"
      >
        BOM 분석
      </RouterLink>
      <span class="flex h-[42px] items-center rounded-full bg-[#061023] px-[24px] text-[16px] font-bold leading-[24px] text-white">단일 검색</span>
    </div>

    <div class="mt-[40px] w-full max-w-[760px]">
      <h2 class="text-center text-[26px] font-bold leading-[32px] text-[#061023]">전자부품 단일 검색</h2>
      <p class="mt-[8px] text-center text-[15px] leading-[24px] text-[#616164]">품번·스펙·패키지로 검색하고 공급사별 구매 조건을 한눈에 비교하세요</p>

      <div class="mt-7 flex items-center justify-end gap-2">
        <label for="bom-search-needed" class="text-xs font-medium text-slate-600">필요수량</label>
        <input
          id="bom-search-needed"
          v-model.number="needed"
          type="number"
          min="1"
          step="1"
          class="h-9 w-28 rounded-lg border border-slate-300 bg-white px-3 text-right text-sm tabular-nums outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
        >
        <span class="text-xs text-slate-500">개 기준 비교</span>
      </div>

      <div class="mt-3">
        <BomPartSearchPanel :initial-query="initialQuery" browse :needed="neededSafe" />
      </div>
    </div>
  </div>
</template>
