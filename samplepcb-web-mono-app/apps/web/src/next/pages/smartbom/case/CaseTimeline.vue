<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '@lucide/vue';
import { SMARTBOM_STEPS } from '@/admin/smartbom';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 12단계 파생 진행 줄 — 지난 단계는 옅은 진행색, 지금 단계는 채움, 남은 단계는 흐림. 주문이 취소되면
// 지금 단계를 오류색으로 바꾸고 '주문 취소 · 재주문 대기'로 읽는다. 좁은 화면은 가로 스크롤 + 이동 버튼.
const { currentStep, orderCanceled, timelineScroll, moveTimeline } = useSmartbomCaseContext();

// 컨텍스트가 든 스크롤 칸 ref 에 이 화면의 요소를 단다(현재 단계 자동 스크롤·이동 버튼이 쓴다).
const bindTimelineScroll = (el: unknown): void => {
  timelineScroll.value = el instanceof HTMLElement ? el : null;
};

const circleClass = (step: number): string =>
  step === currentStep.value && orderCanceled.value
    ? 'bg-destructive text-primary-foreground'
    : step === currentStep.value
      ? 'bg-primary text-primary-foreground'
      : step < currentStep.value
        ? 'bg-info-soft text-info'
        : 'bg-muted text-muted-foreground';
const labelClass = (step: number): string =>
  step === currentStep.value && orderCanceled.value
    ? 'text-destructive font-semibold'
    : step === currentStep.value
      ? 'text-primary font-semibold'
      : step < currentStep.value
        ? 'text-foreground'
        : 'text-muted-foreground';
const lineClass = (step: number): string =>
  step < currentStep.value ? (orderCanceled.value && step + 1 === currentStep.value ? 'bg-destructive' : 'bg-info') : 'bg-border';
</script>

<template>
  <Card class="gap-0 overflow-hidden py-0">
    <NoticeBand v-if="orderCanceled" tone="destructive" class="flex items-center gap-2 font-medium" role="status">
      <XIcon class="size-4 shrink-0" />
      주문 취소 · 확정 견적 유지 · 고객 재주문 대기
    </NoticeBand>
    <NoticeBand tone="info" class="flex items-center gap-2 text-xs xl:hidden">
      <span class="min-w-0 flex-1">12단계 진행 현황 · 현재 단계가 자동으로 보이며 좌우로 전체 단계를 확인할 수 있습니다.</span>
      <Button variant="outline" size="icon-xs" aria-label="진행 단계 왼쪽으로 이동" @click="moveTimeline(-1)">
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon-xs" aria-label="진행 단계 오른쪽으로 이동" @click="moveTimeline(1)">
        <ChevronRightIcon />
      </Button>
    </NoticeBand>
    <div :ref="bindTimelineScroll" class="overflow-x-auto px-4 py-3">
      <ol class="flex min-w-max items-center gap-1">
        <li
          v-for="(step, idx) in SMARTBOM_STEPS"
          :key="step"
          class="flex items-center gap-1"
          :data-smartbom-step="idx + 1"
        >
          <div class="flex flex-col items-center gap-1">
            <span class="grid size-5 place-items-center rounded-full text-xs font-semibold" :class="circleClass(idx + 1)">
              {{ idx + 1 }}
            </span>
            <span class="text-xs whitespace-nowrap" :class="labelClass(idx + 1)">
              {{ idx + 1 === currentStep && orderCanceled ? '주문 취소 · 재주문 대기' : step }}
            </span>
          </div>
          <span v-if="idx < SMARTBOM_STEPS.length - 1" class="mb-5 h-px w-4" :class="lineClass(idx + 1)" />
        </li>
      </ol>
    </div>
  </Card>
</template>
