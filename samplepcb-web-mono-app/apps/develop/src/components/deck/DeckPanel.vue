<script setup lang="ts">
import { computed } from 'vue';
import { DECK } from '../../lib/deck-layout';

// 넘기지 않는 화면의 판 — 진행 · 문의, 첨부, 프로젝트 문서, 견적 수락 · 결제, 빈 상태. 장과 같은 모양 언어로 그린다
// (docs/DEVELOP_FLOW.md §7.2.12): 글 색 · 제목 크기 · 테두리가 장과 같아 탭을 오갈 때 판이 이어진다.
//  · scale 이 있으면 PC — 넘겨 보는 장(DeckSlide stage)과 같은 폭 · 좌우 여백 · 제목 크기 · 테두리 그림자. 장은 통째로 줄여(zoom)
//    보이므로 폭 · 여백 · 제목만 같은 비율로 맞춘다(왼쪽 선이 장과 나란하다). 본문 글자는 줄이지 않는다 — 입력하는 화면이다.
//  · 없으면 좁은 화면의 세로 흐름 판(.deck-flow 와 같은 모양).
// 높이는 내용대로다 — 쓰고 누르는 화면(글쓰기 · 회신 · 수락 · 결제)이라 고정 틀에 가두지 않는다.
const props = withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    scale?: number | null; // 넘겨 보는 장의 줄임 비율(RequestDetail stageScale)
    slim?: boolean; // 장 아래에 붙는 낮은 판(견적 수락 · 결제): 위아래 여백을 줄인다
  }>(),
  { title: '', subtitle: '', scale: null, slim: false },
);
const px = (n: number): string => `${String(Math.round(n))}px`;
const board = computed(() => props.scale !== null);
const frame = computed(() => {
  const k = props.scale;
  return k === null ? undefined : { maxWidth: px(DECK.width * k), paddingLeft: px(DECK.padX * k), paddingRight: px(DECK.padX * k) };
});
const titleStyle = computed(() => {
  const k = props.scale;
  return k === null ? undefined : { fontSize: px(36 * k), lineHeight: px(46 * k) };
});
</script>

<template>
  <section
    class="deck-panel bg-white text-[#141e34]"
    :class="
      board
        ? ['mx-auto w-full shadow-[0_0_0_1px_#e3e6eb,0_10px_28px_rgba(11,18,32,0.06)]', slim ? 'py-[26px]' : 'pb-[40px] pt-[34px]']
        : 'rounded-[12px] border border-line px-[18px] py-[20px] sm:px-[24px] sm:py-[24px]'
    "
    :style="frame"
  >
    <header v-if="title !== '' || $slots.aside" class="flex flex-wrap items-end justify-between gap-x-[16px] gap-y-[8px]">
      <div class="min-w-0">
        <h3 v-if="title !== ''" class="font-bold" :class="board ? '' : 'text-[20px] leading-[1.35] sm:text-[22px]'" :style="titleStyle">{{ title }}</h3>
        <p v-if="subtitle !== ''" class="text-tx-2" :class="board ? 'mt-[8px] text-[17px] leading-[26px]' : 'mt-[6px] text-[15px] leading-[1.55]'">{{ subtitle }}</p>
      </div>
      <slot name="aside" />
    </header>
    <div :class="title === '' && !$slots.aside ? '' : board ? 'mt-[26px]' : 'mt-[16px]'"><slot /></div>
  </section>
</template>
