<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminOrderCountsType, AdminOrderTabType } from '@sp/api-contract';

// 주문상태 탭 — 계약 AdminOrderTab 8종(한글 리터럴). 값은 그대로 필터/카운트 키로 쓰되,
// i18n 라벨은 영문 스텁 대비를 위해 slug 로 우회한다. counts 는 탭 미반영 분포라
// 탭을 오가도 숫자가 유지된다(견적·회원 관리 관례).
const props = defineProps<{ tab: AdminOrderTabType; counts: AdminOrderCountsType | undefined }>();
const emit = defineEmits<{ 'update:tab': [tab: AdminOrderTabType] }>();
const { t } = useI18n();

const TABS: { key: AdminOrderTabType; slug: string }[] = [
  { key: '전체', slug: 'all' },
  { key: '주문', slug: 'order' },
  { key: '입금', slug: 'deposit' },
  { key: '준비', slug: 'ready' },
  { key: '배송', slug: 'shipping' },
  { key: '완료', slug: 'done' },
  { key: '취소', slug: 'cancelled' },
  { key: '부분취소', slug: 'partialCancel' },
];

const countOf = (key: AdminOrderTabType): number | null =>
  props.counts === undefined ? null : props.counts[key];
</script>

<template>
  <div class="flex flex-wrap gap-1 border-b border-gray-200">
    <button
      v-for="tabItem in TABS"
      :key="tabItem.key"
      type="button"
      class="-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
      :class="
        props.tab === tabItem.key
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'
      "
      @click="emit('update:tab', tabItem.key)"
    >
      {{ t(`admin.orders.tabs.${tabItem.slug}`) }}
      <!-- 취소·부분취소는 주의가 필요한 상태 — 건수를 amber 로 강조 -->
      <span
        v-if="countOf(tabItem.key) !== null"
        class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
        :class="
          (tabItem.key === '취소' || tabItem.key === '부분취소') && (countOf(tabItem.key) ?? 0) > 0
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-600'
        "
      >
        {{ countOf(tabItem.key) }}
      </span>
    </button>
  </div>
</template>
