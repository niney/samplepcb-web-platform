<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { SettingsTabKey } from '../../admin/useAdminSettings';

// 설정 탭 — 현재 사업자정보 1개. 결제/배송/알림 탭은 TABS 배열에 key 추가 + 페이지
// (AdminSettings.vue)의 패널 스위치에 컴포넌트 한 줄 추가로 확장한다(OrderStatusTabs 패턴).
const props = defineProps<{ tab: SettingsTabKey }>();
const emit = defineEmits<{ 'update:tab': [tab: SettingsTabKey] }>();
const { t } = useI18n();

const TABS: { key: SettingsTabKey; slug: string }[] = [
  { key: 'businessInfo', slug: 'businessInfo' },
  { key: 'gerberPricing', slug: 'gerberPricing' },
  { key: 'aiIntegration', slug: 'aiIntegration' },
];
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
      {{ t(`admin.settings.tabs.${tabItem.slug}`) }}
    </button>
  </div>
</template>
