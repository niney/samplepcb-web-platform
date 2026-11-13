<script setup lang="ts">
import { computed } from 'vue';
import { DEV_REVIEW_SCHEDULE_CAPTION, devReviewScheduleFit, devReviewScheduleTotals } from '@sp/api-contract';
import type { DevReviewScheduleType } from '@sp/api-contract';

// 예상 개발 일정의 합계 띠 — 일정 표 마지막 장 아래에 붙는다: 왼쪽 작은 글(전제 · 안내), 오른쪽 희망 시점과 큰 합계.
// 희망 시점은 의뢰에 적힌 희망 시기가 정본이고(개발의뢰는 날짜 · 자유문으로 받는다) 없을 때만 검토서의 wishCode 라벨이다 —
// 대조 문장은 wishCode 기준이라 둘이 다른 말을 하지 않게, 같은 값을 보일 때만 적는다(ReviewSchedule 과 같은 규칙).
const props = defineProps<{ schedule: DevReviewScheduleType; wishLabel: string }>();

const totals = computed(() => devReviewScheduleTotals(props.schedule));
const fit = computed(() => devReviewScheduleFit(props.schedule));
const wishText = computed(() => {
  const own = props.wishLabel.trim();
  if (own !== '') return own;
  return fit.value.wishLabel === '' ? '미응답' : fit.value.wishLabel;
});
const span = computed(() =>
  totals.value.minWeeks === totals.value.maxWeeks ? `${String(totals.value.minWeeks)}주` : `${String(totals.value.minWeeks)}~${String(totals.value.maxWeeks)}주`,
);
</script>

<template>
  <div class="mt-[14px] flex flex-wrap items-end gap-x-[40px] gap-y-[10px]">
    <div class="min-w-[240px] flex-1 text-[13px] leading-[1.55] text-tx-2">
      <p v-if="fit.status !== 'unknown' && wishText === fit.wishLabel">{{ fit.text }}</p>
      <p v-if="schedule.assumptions !== ''">전제 — {{ schedule.assumptions }}</p>
      <p>{{ DEV_REVIEW_SCHEDULE_CAPTION }}</p>
    </div>
    <div class="shrink-0 text-right">
      <p class="text-[14px] leading-[1.4] text-tx-2">희망 완료 시점</p>
      <p class="max-w-[260px] text-[20px] font-semibold leading-[1.3]">{{ wishText }}</p>
    </div>
    <div class="shrink-0 text-right">
      <p class="text-[14px] leading-[1.4] text-tx-2">예상 개발 일정</p>
      <p class="text-[34px] font-bold leading-[1.15] tabular-nums text-brand-600">{{ span }}</p>
    </div>
  </div>
</template>
