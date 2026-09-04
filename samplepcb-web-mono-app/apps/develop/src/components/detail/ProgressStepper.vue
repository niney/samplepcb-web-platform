<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_PROGRESS_STEPS, DEVELOP_REQUEST_STATUS_LABELS } from '@sp/api-contract';
import type { DevelopRequestStatusType } from '@sp/api-contract';

// 진행 스텝퍼 — 접수부터 완료까지 7칸(계약 DEVELOP_PROGRESS_STEPS). 종결 상태(cancelled·declined)는
// 스텝이 아니라 배지라 이 컴포넌트를 그리지 않는다(부모가 가른다).
const props = defineProps<{ status: DevelopRequestStatusType }>();

// 종결(cancelled·declined)은 진행 목록에 없는 값이라 indexOf 로는 타입이 안 맞는다 — findIndex 가 -1 을 주고
// 그때는 모든 칸이 "아직"으로 그려진다(부모가 종결이면 이 컴포넌트 대신 배지를 그린다).
const currentIndex = computed(() => DEVELOP_PROGRESS_STEPS.findIndex((s) => s === props.status));
const steps = DEVELOP_PROGRESS_STEPS;
const label = (s: DevelopRequestStatusType): string => DEVELOP_REQUEST_STATUS_LABELS[s];
</script>

<template>
  <ol class="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-7">
    <li v-for="(s, i) in steps" :key="s" class="grid gap-1.5">
      <span
        class="h-1.5 rounded-full"
        :class="i < currentIndex ? 'bg-brand-300' : i === currentIndex ? 'bg-brand-500' : 'bg-line'"
      />
      <span
        class="text-micro font-bold leading-tight"
        :class="i === currentIndex ? 'text-brand-700' : i < currentIndex ? 'text-tx-2' : 'text-tx-3'"
      >{{ label(s) }}</span>
    </li>
  </ol>
</template>
