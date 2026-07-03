<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminQuoteCountsType } from '@sp/api-contract';

// 상태 탭 — rfq/priced/quoted 는 quoteStatus 1:1, carted 는 ctId 파생(담김+주문).
// counts 는 탭 미반영 분포라 탭을 오가도 숫자가 유지된다.
type TabKey = 'all' | 'rfq' | 'priced' | 'quoted' | 'carted';

const props = defineProps<{ tab: TabKey; counts: AdminQuoteCountsType | undefined }>();
const emit = defineEmits<{ 'update:tab': [tab: TabKey] }>();
const { t } = useI18n();

const TABS: TabKey[] = ['all', 'rfq', 'priced', 'quoted', 'carted'];

const countOf = (key: TabKey): number | null => {
  if (props.counts === undefined) return null;
  switch (key) {
    case 'all':
      return props.counts.total;
    case 'rfq':
      return props.counts.rfq;
    case 'priced':
      return props.counts.priced;
    case 'quoted':
      return props.counts.quoted;
    case 'carted':
      return props.counts.carted;
  }
};
</script>

<template>
  <div class="flex flex-wrap gap-1 border-b border-gray-200">
    <button
      v-for="key in TABS"
      :key="key"
      type="button"
      class="-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
      :class="
        props.tab === key
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'
      "
      @click="emit('update:tab', key)"
    >
      {{ t(`admin.quotes.tabs.${key}`) }}
      <!-- rfq(견적 대기)는 관리자 인박스 — 건수를 amber 로 강조 -->
      <span
        v-if="countOf(key) !== null"
        class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
        :class="
          key === 'rfq' && (countOf(key) ?? 0) > 0
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-600'
        "
      >
        {{ countOf(key) }}
      </span>
    </button>
  </div>
</template>
