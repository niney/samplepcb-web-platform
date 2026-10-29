<script setup lang="ts">
import { WIZ } from '../../lib/wizard-copy';
import sectionChevron from '../../assets/wizard/section-chevron.svg';

// 3스텝 질문 묶음 — 피그마 01-3(135:21811): 번호 붙은 26px 제목 + 오른쪽 접기 화살표(30, 펼침이면 위로) · 부제 18 #666 · 질문 사이 40.
// 제목 줄 전체가 접기 버튼이다(아코디언 관례: h2 안 button). 접힘 상태는 부모가 소유한다 — 목차가 펼치고 스크롤해야 해서.
// id 는 목차의 이동 대상(위 바 62px 아래로 멈추게 scroll-margin).
defineProps<{
  id: string;
  no: number;
  title: string;
  lead?: string; // 빈 문자열이면 부제 없음
  open: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();
</script>

<template>
  <section :id="id" class="flex scroll-mt-[90px] flex-col gap-[20px] sm:gap-[26px]">
    <div class="flex flex-col gap-[8px]">
      <h2 :class="WIZ.groupTitle">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-[16px] text-left"
          :aria-expanded="open"
          :aria-controls="`${id}-body`"
          @click="emit('toggle')"
        >
          <span class="min-w-0">{{ no }}. {{ title }}<slot name="badge" /></span>
          <img
            :src="sectionChevron"
            alt=""
            width="30"
            height="30"
            class="block size-[26px] shrink-0 transition-transform sm:size-[30px]"
            :class="open ? 'rotate-180' : ''"
          >
        </button>
      </h2>
      <p v-if="lead !== undefined && lead !== ''" :class="WIZ.groupLead">{{ lead }}</p>
    </div>
    <div v-show="open" :id="`${id}-body`" class="flex flex-col gap-[32px] sm:gap-[40px]">
      <slot />
    </div>
  </section>
</template>
