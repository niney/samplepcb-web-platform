<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ORDER_PIPELINE, orderStatusSlug } from '../../admin/useAdminOrders';

// 주문 상태 스텝퍼 — 선형 파이프라인(주문→…→완료) 상에서 현재 위치를 시각화한다.
// 12단계라 한 줄이면 가로 스크롤이 생기므로 flex-wrap 으로 여러 줄 배치.
// 완료 구간은 파란 연결선으로 잇고(진행 경로), 이후 구간은 옅은 회색 선.
// 파이프라인 밖 상태(취소/반품/품절/A/S/쇼핑)는 진행바 대신 안내 배지로 표시한다.
const props = defineProps<{ status: string }>();
const { t } = useI18n();

const steps = ORDER_PIPELINE as readonly string[];
const currentIndex = computed(() => steps.indexOf(props.status));
const offPipeline = computed(() => currentIndex.value === -1);

const label = (s: string): string => {
  const slug = orderStatusSlug(s);
  return slug !== null ? t(`admin.orders.status.${slug}`) : s;
};
</script>

<template>
  <div
    v-if="offPipeline"
    class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
  >
    {{ t('admin.orders.stepper.offPipeline', { status: label(props.status) }) }}
  </div>
  <ol v-else class="flex flex-wrap gap-y-2">
    <li v-for="(s, i) in steps" :key="s" class="flex items-start">
      <div class="flex w-14 flex-col items-center gap-1">
        <span
          class="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold leading-none"
          :class="
            i < currentIndex
              ? 'bg-blue-600 text-white'
              : i === currentIndex
                ? 'border-2 border-blue-600 bg-blue-50 text-blue-700'
                : 'border border-gray-300 bg-white text-gray-400'
          "
        >
          <svg
            v-if="i < currentIndex"
            class="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fill-rule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.1 3.1 6.8-6.8a1 1 0 011.4 0z"
              clip-rule="evenodd"
            />
          </svg>
          <template v-else>{{ i + 1 }}</template>
        </span>
        <span
          class="text-center text-[10px] leading-tight"
          :class="
            i === currentIndex
              ? 'font-semibold text-blue-700'
              : i < currentIndex
                ? 'text-gray-600'
                : 'text-gray-400'
          "
        >
          {{ label(s) }}
        </span>
      </div>
      <div
        v-if="i < steps.length - 1"
        class="mt-3 h-0.5 w-2 shrink-0 rounded-full"
        :class="i < currentIndex ? 'bg-blue-600' : 'bg-gray-200'"
      />
    </li>
  </ol>
</template>
