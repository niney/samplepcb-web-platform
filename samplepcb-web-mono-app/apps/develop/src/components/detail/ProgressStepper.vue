<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_PROGRESS_STEPS, DEVELOP_REQUEST_STATUS_LABELS } from '@sp/api-contract';
import type { DevelopRequestStatusType } from '@sp/api-contract';
import stepDone from '../../assets/detail/step-done.svg';

// 진행 스텝퍼 — 접수부터 완료까지 7칸(계약 DEVELOP_PROGRESS_STEPS). 피그마 「00-3 의뢰 상세」 38:9566:
// 지난 단계 = 파란 체크 원, 지금 = 파란 번호 원, 남은 단계 = 회색 테 원. 원 사이 4px 막대(지난 구간만 파랑).
// 종결 상태(cancelled·declined)는 스텝이 아니라 배지라 이 컴포넌트를 그리지 않는다(부모가 가른다).
const props = defineProps<{ status: DevelopRequestStatusType }>();

// 종결(cancelled·declined)은 진행 목록에 없는 값이라 findIndex 가 -1 을 주고 모든 칸이 "아직"으로 그려진다.
const currentIndex = computed(() => DEVELOP_PROGRESS_STEPS.findIndex((s) => s === props.status));
const steps = DEVELOP_PROGRESS_STEPS;
const label = (s: DevelopRequestStatusType): string => DEVELOP_REQUEST_STATUS_LABELS[s];
const currentLabel = computed(() => {
  const s = steps[currentIndex.value];
  return s === undefined ? '' : `${String(currentIndex.value + 1)}. ${label(s)}`;
});
</script>

<template>
  <ol class="flex items-start">
    <li v-for="(s, i) in steps" :key="s" class="flex min-w-0 items-start" :class="i < steps.length - 1 ? 'flex-1' : 'shrink-0'">
      <div class="flex w-[28px] shrink-0 flex-col items-center">
        <img v-if="i < currentIndex" :src="stepDone" alt="" class="block size-[28px] max-w-none">
        <span
          v-else-if="i === currentIndex"
          class="flex size-[28px] items-center justify-center rounded-[14px] bg-[#2945e8] text-[16px] font-bold leading-none text-white"
        >{{ i + 1 }}</span>
        <span
          v-else
          class="flex size-[28px] items-center justify-center rounded-[14px] border-2 border-[#c7d5e5] bg-white/20 text-[16px] font-bold leading-none text-[#c7d5e5]"
        >{{ i + 1 }}</span>
        <span
          class="mt-[8px] whitespace-nowrap text-center text-[14px] font-semibold leading-[1.2] max-md:hidden"
          :class="i <= currentIndex ? 'text-[#111]' : 'text-[#999]'"
        >{{ label(s) }}</span>
      </div>
      <span
        v-if="i < steps.length - 1"
        class="mx-[11px] mt-[12px] h-[4px] min-w-[8px] flex-1 rounded-[5px]"
        :class="i < currentIndex ? 'bg-[#2945e8]' : 'bg-[#c7d5e5]'"
        aria-hidden="true"
      />
    </li>
  </ol>
  <!-- 좁은 화면은 칸마다 라벨을 못 달아 지금 단계 이름만 아래에 -->
  <p v-if="currentLabel !== ''" class="mt-[8px] text-center text-[14px] font-semibold leading-[1.2] text-[#111] md:hidden">
    {{ currentLabel }}
  </p>
</template>
