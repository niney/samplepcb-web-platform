<script setup lang="ts">
import { computed } from 'vue';
import { SMARTBOM_STEPS } from '@/admin/smartbom';

// 진행현황 행의 '현재 단계' — 12단계 파생 타임라인(미니 점) + 단계 이름. 단계는 저장 상태가 아니라
// 주문·결제·발주·선적·검수·배송 원장에서 상세와 같은 입력(smartbomStepOf)으로 계산한 표시값이다.
// 결제 전 주문 취소는 ⑥ 자리를 취소 색·문구로 덮는다(재주문 대기라는 별도 업무 상태).
const props = defineProps<{ step: number; orderCanceled: boolean }>();

const label = computed(() =>
  props.step === 0
    ? '—'
    : props.orderCanceled
      ? `${String(props.step)}/12 주문 취소 · 재주문 대기`
      : `${String(props.step)}/12 ${SMARTBOM_STEPS[props.step - 1] ?? ''}`,
);
const dotClass = (idx: number): string =>
  props.orderCanceled && idx === props.step - 1 ? 'bg-destructive' : idx < props.step ? 'bg-primary' : 'bg-muted';
</script>

<template>
  <span class="inline-flex items-center gap-2 whitespace-nowrap">
    <span class="flex gap-0.5" aria-hidden="true">
      <span v-for="(_, idx) in SMARTBOM_STEPS" :key="idx" class="size-1.5 rounded-full" :class="dotClass(idx)" />
    </span>
    <span class="text-muted-foreground text-xs">{{ label }}</span>
  </span>
</template>
