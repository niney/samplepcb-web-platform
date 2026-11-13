<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DevelopRequestDetailType } from '@sp/api-contract';
import { DECK } from '../../lib/deck-layout';
import DeckBook from './DeckBook.vue';

// 의뢰 상세의 탭 안에서 장을 넘겨 보는 무대 — 한 묶음(section)의 장을 한 번에 하나만 보이고, 장의 꼬리 자리에 넘김 줄을 둔다:
// 「‹ 이전 · 묶음 이름 3 / 8 · 다음 ›」. 첫 장의 '이전' · 마지막 장의 '다음'은 옆 탭으로 넘어간다(이름이 있을 때).
// ←/→ 키로도 넘긴다(글자를 치는 중이거나 겹쳐 뜬 창이 있으면 넘기지 않는다).
// 크기는 부모가 정한 비율(scale)로 통째로 줄인다 — 장 안 배치(배분 · 글자 맞춤)는 1280 폭 기준 그대로다.
// below 슬롯 = 장 아래에 붙는 판(견적 수락 · 결제) — 지금 장이 견적의 것일 때만, 그 견적 번호를 넘겨 준다. 줄이지 않고 장과 같은 폭으로.
// 견적 요약 장의 '아래에서 수락 · 결제' 단추(jump)는 그 판으로 내린다.
const props = withDefaults(
  defineProps<{
    detail: DevelopRequestDetailType;
    section: string;
    scale: number;
    prevLabel?: string; // 앞 탭 이름 — 없으면 첫 장에서 '이전'이 꺼진다
    nextLabel?: string;
    withDocs?: boolean; // 프로젝트 문서 표를 장에 싣는가(DeckBook 으로 넘긴다)
    answerable?: boolean; // 확인 사항에 고객이 답할 수 있는가(DeckBook 으로 넘긴다)
  }>(),
  { prevLabel: '', nextLabel: '', withDocs: true, answerable: false },
);
const emit = defineEmits<{ paged: []; prevTab: []; nextTab: []; answer: [qid: string] }>();

const STAGE_HEIGHT = 690; // 화면 장(DeckSlide embedded) 높이
const page = ref(0);
const count = ref(0);
watch(
  () => props.section,
  () => {
    page.value = 0;
  },
);
const shownQuote = ref<number | null>(null);
const belowEl = ref<HTMLElement | null>(null);
function onJump(): void {
  belowEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function onPlanned(plan: { count: number }): void {
  count.value = plan.count;
  if (page.value > Math.max(0, plan.count - 1)) page.value = Math.max(0, plan.count - 1);
}
const atFirst = computed(() => page.value <= 0);
const atLast = computed(() => page.value >= count.value - 1);
function prev(): void {
  if (!atFirst.value) {
    page.value -= 1;
    emit('paged');
  } else if (props.prevLabel !== '') emit('prevTab');
}
function next(): void {
  if (!atLast.value) {
    page.value += 1;
    emit('paged');
  } else if (props.nextLabel !== '') emit('nextTab');
}
function go(i: number): void {
  if (i === page.value) return;
  page.value = i;
  emit('paged');
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const target = e.target;
  if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
  if (document.querySelector('[data-deck-overlay]') !== null) return;
  if (e.key === 'ArrowLeft') prev();
  else next();
}
onMounted(() => {
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

const px = (n: number): string => `${String(n)}px`;
const BTN = 'flex h-[34px] items-center gap-[6px] rounded-[6px] px-[12px] text-[14px] font-medium text-[#141e34] transition-colors hover:bg-brand-50 disabled:pointer-events-none disabled:opacity-30';
</script>

<template>
  <div class="flex flex-col gap-[20px]">
    <div class="mx-auto" :style="{ width: px(DECK.width * scale), minHeight: px(STAGE_HEIGHT * scale) }" data-deck-stage :data-deck-page="page + 1" :data-deck-scale="scale.toFixed(3)">
      <div :style="{ zoom: scale, width: px(DECK.width) }">
        <DeckBook
          :detail="detail"
          mode="stage"
          :section="section"
          :page="page"
          :with-docs="withDocs"
          :answerable="answerable"
          @planned="onPlanned"
          @answer="emit('answer', $event)"
          @shown="shownQuote = $event.quoteId"
          @jump="onJump"
        >
          <template #foot>
            <button type="button" :class="BTN" :disabled="atFirst && prevLabel === ''" data-deck="prev" @click="prev">
              <span aria-hidden="true">‹</span>{{ atFirst && prevLabel !== '' ? prevLabel : '이전' }}
            </button>
            <div class="flex min-w-0 items-center gap-[14px]">
              <span class="truncate text-[14px] text-tx-2">{{ section }}</span>
              <span class="shrink-0 text-[14px] tabular-nums text-[#141e34]"><b class="font-bold">{{ page + 1 }}</b> / {{ count }}</span>
              <span class="flex shrink-0 items-center gap-[6px]">
                <button
                  v-for="i in count"
                  :key="i"
                  type="button"
                  class="size-[8px] rounded-full transition-colors"
                  :class="i - 1 === page ? 'bg-brand-600' : 'bg-line-2 hover:bg-brand-300'"
                  :aria-label="`${String(i)}번째 장`"
                  :aria-current="i - 1 === page ? 'true' : undefined"
                  @click="go(i - 1)"
                />
              </span>
            </div>
            <button type="button" :class="BTN" :disabled="atLast && nextLabel === ''" data-deck="next" @click="next">
              {{ atLast && nextLabel !== '' ? nextLabel : '다음' }}<span aria-hidden="true">›</span>
            </button>
          </template>
        </DeckBook>
      </div>
    </div>
    <!-- 장 아래 판 — 탭 줄(위 바 62 + 탭 줄 56) 아래에 닿게 내린다 -->
    <div
      v-if="shownQuote !== null && $slots.below"
      ref="belowEl"
      class="mx-auto w-full scroll-mt-[128px]"
      :style="{ maxWidth: px(DECK.width * scale) }"
      data-deck-below
    >
      <slot name="below" :quote-id="shownQuote" />
    </div>
  </div>
</template>
