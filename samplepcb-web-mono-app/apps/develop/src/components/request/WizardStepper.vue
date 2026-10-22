<script setup lang="ts">
import stepDone from '../../assets/wizard/step-done.svg';
import stepPending from '../../assets/wizard/step-pending.svg';

// 위저드 진행 표시 — 피그마 01-x 287px 줄: 지난 단계 = 초록 체크(28) · 지금 = 파란 테두리 원(40) 안 번호 원(28) ·
// 남은 단계 = 회색 고리(28). 사이 막대 100×4(지난 구간 초록 #24bf72, 나머지 #c7d5e5). 이름은 아래 18px(지난·지금 #111, 남은 #999).
// 좁은 화면은 막대를 줄이고 지금 단계 이름만 남긴다.
defineProps<{ labels: readonly string[]; current: number }>();
</script>

<template>
  <ol class="mx-auto flex w-full max-w-[660px] items-start justify-center" aria-label="진행 단계">
    <template v-for="(label, i) in labels" :key="label">
      <li v-if="i > 0" class="mt-[18px] h-[4px] min-w-[12px] max-w-[100px] flex-1 rounded-[5px]" :class="i <= current ? 'bg-[#24bf72]' : 'bg-[#c7d5e5]'" aria-hidden="true" />
      <li class="relative flex w-[40px] shrink-0 flex-col items-center" :aria-current="i === current ? 'step' : undefined">
        <span class="flex size-[40px] items-center justify-center">
          <span v-if="i === current" class="flex size-[40px] items-center justify-center rounded-full border border-[#2945e8]">
            <span class="flex size-[28px] items-center justify-center rounded-full bg-[#2945e8] text-[16px] font-bold text-white">{{ i + 1 }}</span>
          </span>
          <img v-else-if="i < current" :src="stepDone" alt="" width="28" height="28" class="block size-[28px]">
          <img v-else :src="stepPending" alt="" width="28" height="28" class="block size-[28px]">
        </span>
        <span
          class="absolute top-[46px] whitespace-nowrap text-[14px] font-semibold leading-[1.2] sm:text-[18px]"
          :class="[i <= current ? 'text-[#111]' : 'text-[#999]', i === current ? '' : 'hidden sm:block']"
        >{{ label }}</span>
      </li>
    </template>
  </ol>
</template>
