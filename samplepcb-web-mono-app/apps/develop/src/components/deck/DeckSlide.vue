<script setup lang="ts">
import { computed, onMounted, onUpdated, ref } from 'vue';

// 의뢰 출력물의 한 장(16:9, 1280×720) — 모든 장이 같은 틀을 쓴다: 왼쪽 위 상표 줄(+ 묶음 이름) → 큰 제목 → [한 줄 부제] →
// 본문 → 아래 선 · 의뢰 제목 · 쪽 번호. 틀의 자리가 장마다 같아야 넘겨 볼 때 이어진다(높이 값은 lib/deck-layout DECK 과 같게).
// layout 'side' = 도면 장 — 제목을 왼쪽 단으로 옮겨 오른쪽을 도면이 통째로 쓴다(제목이 시작하는 자리는 같다).
// 제목 없이 쓰면(표지) 상표 줄과 꼬리만 두고 본문이 사이를 다 쓴다.
// 본문이 넘치면 글자를 줄여 담는다(PPT 의 '도형에 맞춤') — 장을 나누는 일은 부모가 배분(@sp/utils deck-pack)으로 먼저 하고,
// 여기는 마지막 안전판이다. 한도까지 줄여도 넘치면 data-deck-overflow 를 남긴다(검증이 0 인지 본다).
const props = withDefaults(
  defineProps<{
    page: number;
    kind: string; // 장 종류(data-deck-kind — 검증이 어떤 장이 실렸는지 본다)
    footer: string; // 의뢰 제목
    section?: string; // 상표 옆 묶음 이름('AI 사전 검토서')
    title?: string;
    subtitle?: string;
    layout?: 'top' | 'side';
  }>(),
  { section: '', title: '', subtitle: '', layout: 'top' },
);

const pageLabel = computed(() => String(props.page).padStart(2, '0'));

const MIN_ZOOM = 0.72;
const bodyEl = ref<HTMLElement | null>(null);
const fitEl = ref<HTMLElement | null>(null);
const zoom = ref(1);
const overflow = ref(false);
function fit(): void {
  const body = bodyEl.value;
  const inner = fitEl.value;
  if (body === null || inner === null) return;
  const over = (): number => inner.getBoundingClientRect().height / Math.max(1, body.getBoundingClientRect().height);
  inner.style.removeProperty('zoom');
  let k = 1;
  // 줄이면 줄 길이가 늘어 높이가 제곱에 가깝게 준다 — 제곱근만큼씩 줄여 가며 다시 잰다.
  for (let i = 0; i < 6 && over() > 1.001 && k > MIN_ZOOM; i += 1) {
    k = Math.max(MIN_ZOOM, k / Math.sqrt(over()) - 0.004);
    inner.style.setProperty('zoom', String(k));
  }
  zoom.value = k;
  overflow.value = over() > 1.001;
}
onMounted(fit);
onUpdated(fit);
</script>

<template>
  <section
    class="deck-slide relative flex h-[720px] w-[1280px] shrink-0 flex-col overflow-hidden bg-white text-[#141e34]"
    :data-deck-slide="page"
    :data-deck-kind="kind"
    :data-deck-zoom="zoom === 1 ? undefined : zoom.toFixed(3)"
    :data-deck-overflow="overflow ? '' : undefined"
  >
    <!-- 도면 장 — 왼쪽 단(상표 · 제목 · 설명) + 오른쪽 도면 -->
    <div v-if="layout === 'side'" class="flex min-h-0 flex-1">
      <div class="flex w-[300px] shrink-0 flex-col pb-[18px] pl-[64px] pt-[34px]">
        <p class="h-[18px] truncate text-[13px] font-bold leading-[18px] tracking-[0.04em] text-brand-600">
          SAMPLEPCB<span v-if="section !== ''" class="font-medium tracking-normal text-tx-3"><span class="mx-[8px] text-line-2">|</span>{{ section }}</span>
        </p>
        <h2 class="mt-[12px] text-[36px] font-bold leading-[46px]">{{ title }}</h2>
        <div class="mt-[14px] flex min-h-0 flex-1 flex-col"><slot name="aside" /></div>
      </div>
      <div class="min-h-0 min-w-0 flex-1 pb-[14px] pl-[20px] pr-[32px] pt-[30px]"><slot /></div>
    </div>

    <template v-else>
      <header class="shrink-0 px-[64px] pt-[34px]" :class="title === '' ? 'h-[52px]' : subtitle === '' ? 'h-[110px]' : 'h-[144px]'">
        <p class="h-[18px] truncate text-[13px] font-bold leading-[18px] tracking-[0.04em] text-brand-600">
          SAMPLEPCB<span v-if="section !== ''" class="font-medium tracking-normal text-tx-3"><span class="mx-[8px] text-line-2">|</span>{{ section }}</span>
        </p>
        <template v-if="title !== ''">
          <h2 class="mt-[12px] h-[46px] truncate text-[36px] font-bold leading-[46px]">{{ title }}</h2>
          <p v-if="subtitle !== ''" class="mt-[8px] h-[26px] truncate text-[17px] leading-[26px] text-tx-2">{{ subtitle }}</p>
        </template>
      </header>
      <div ref="bodyEl" class="mx-[64px] mb-[18px] min-h-0 flex-1 overflow-hidden" :class="title === '' ? '' : 'mt-[26px]'" data-deck-body>
        <div ref="fitEl" class="flex min-h-full flex-col"><slot /></div>
      </div>
    </template>

    <footer class="mx-[64px] flex h-[52px] shrink-0 items-center justify-between gap-[24px] border-t border-line text-[12px] text-tx-3">
      <span class="min-w-0 truncate">{{ footer }}</span>
      <span class="shrink-0 tabular-nums">{{ pageLabel }}</span>
    </footer>
  </section>
</template>
