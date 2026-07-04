<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminMemberCountsType } from '@sp/api-contract';

// 상태 탭 — normal/intercepted/left 는 상태 1:1(배타 집계), all = 전체.
// counts 는 탭 미반영 분포라 탭을 오가도 숫자가 유지된다(견적 관리 관례).
type TabKey = 'all' | 'normal' | 'intercepted' | 'left';

const props = defineProps<{ tab: TabKey; counts: AdminMemberCountsType | undefined }>();
const emit = defineEmits<{ 'update:tab': [tab: TabKey] }>();
const { t } = useI18n();

const TABS: TabKey[] = ['all', 'normal', 'intercepted', 'left'];

const countOf = (key: TabKey): number | null => (props.counts === undefined ? null : props.counts[key]);
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
      {{ t(`admin.members.tabs.${key}`) }}
      <!-- 차단(intercepted)은 주의가 필요한 상태 — 건수를 amber 로 강조 -->
      <span
        v-if="countOf(key) !== null"
        class="rounded-full px-1.5 py-0.5 text-[11px] font-semibold"
        :class="
          key === 'intercepted' && (countOf(key) ?? 0) > 0
            ? 'bg-amber-100 text-amber-700'
            : 'bg-gray-100 text-gray-600'
        "
      >
        {{ countOf(key) }}
      </span>
    </button>
  </div>
</template>
