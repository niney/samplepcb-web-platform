<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { DEV_REVIEW_SCHEDULE_CAPTION, devReviewScheduleFit, devReviewScheduleTotals } from '@sp/api-contract';
import type { DevReviewScheduleType } from '@sp/api-contract';

// 예상 개발 일정 카드 — 피그마 「00-3 의뢰 상세」 39:9768: 간트 + 단계 표 + 합계·희망 시점 상자.
// 검토서 일정은 단계별 최소~최대 주만 있고 시작 시점이 없어 단계를 차례로 잇는다(사용자 결정 2026-10-22):
// 진한 막대 = 최소 기간, 옅은 연장 = 최대까지. 다음 단계는 앞 단계 최소가 끝난 뒤 시작한다.
// 눈금은 개월(가장 늦게 끝나는 막대까지). 이름이 막대에 안 들어가면 막대 오른쪽(끝이면 왼쪽)에 적는다.
// 표 머리는 시안이 '기간(주)'를 세 번 복사해 둔 자리라 산출물·선행 조건으로 바로잡았다.
// 희망 시점: 검토서의 wishCode 는 마켓 공통 질문('timeline') 코드라 개발의뢰(희망 시기를 날짜·자유문으로 받음)에선 대개 비어 있다.
// 개발의뢰에선 의뢰에 적힌 희망 시기가 정본이라 그것을 먼저 보이고, 없을 때만 wishCode 라벨 — 둘 다 없으면 '미응답'.
const props = defineProps<{ schedule: DevReviewScheduleType; wishLabel?: string }>();

const ROW = 37;
const ROW_GAP = 4;
const WEEKS_PER_MONTH = 52 / 12;

const phases = computed(() => props.schedule.phases);
const totals = computed(() => devReviewScheduleTotals(props.schedule));
const fit = computed(() => devReviewScheduleFit(props.schedule));
const wishText = computed(() => {
  const own = (props.wishLabel ?? '').trim();
  if (own !== '') return own;
  return fit.value.wishLabel === '' ? '미응답' : fit.value.wishLabel;
});

interface Bar {
  name: string;
  start: number;
  min: number;
  max: number;
}
const bars = computed<Bar[]>(() => {
  let cursor = 0;
  return phases.value.map((p) => {
    const min = Math.max(0, p.minWeeks);
    const max = Math.max(min, p.maxWeeks);
    const bar = { name: p.name, start: cursor, min, max };
    cursor += min;
    return bar;
  });
});
const months = computed(() => {
  const end = bars.value.reduce((m, b) => Math.max(m, b.start + b.max), 0);
  return Math.max(1, Math.ceil(end / WEEKS_PER_MONTH));
});
const axisWeeks = computed(() => months.value * WEEKS_PER_MONTH);
const pct = (weeks: number): number => (weeks / axisWeeks.value) * 100;
const chartHeight = computed(() => bars.value.length * (ROW + ROW_GAP) + 44);

// 막대 이름 자리 — 실제 폭을 재야 해서 차트 폭(ResizeObserver)과 글자 폭(canvas)을 쓴다.
const chartEl = ref<HTMLElement | null>(null);
const chartWidth = ref(1152);
let ro: ResizeObserver | null = null;
onMounted(() => {
  if (chartEl.value === null || typeof ResizeObserver === 'undefined') return;
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w !== undefined && w > 0) chartWidth.value = w;
  });
  ro.observe(chartEl.value);
});
onBeforeUnmount(() => {
  ro?.disconnect();
});
let ctx: CanvasRenderingContext2D | null = null;
const textWidth = (s: string): number => {
  if (ctx === null && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
  if (ctx === null) return s.length * 15;
  ctx.font = '500 15px "Pretendard Variable", Pretendard, sans-serif';
  return ctx.measureText(s).width;
};
type LabelPlace = 'inside' | 'right' | 'left';
const labelPlace = (b: Bar): LabelPlace => {
  const w = chartWidth.value;
  const need = textWidth(b.name) + 20;
  if ((pct(b.min) / 100) * w >= need) return 'inside';
  const endPx = (pct(b.start + b.max) / 100) * w;
  return endPx + need <= w ? 'right' : 'left';
};
</script>

<template>
  <section class="flex flex-col gap-[16px] rounded-[14px] bg-white px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
    <div class="flex flex-col gap-[4px] leading-[1.8]">
      <h3 class="text-[18px] font-bold text-black">예상 개발 일정</h3>
      <p class="text-[14px] text-[#666]">단계마다 최소~최대 주로 적었습니다. 고객이 먼저 주셔야 할 자료가 있는 단계는 선행 조건에 적혀 있습니다.</p>
    </div>

    <!-- 간트 -->
    <div class="print-keep overflow-x-auto">
      <div ref="chartEl" class="relative min-w-[640px]" :style="{ height: `${chartHeight}px` }">
        <!-- 개월 눈금(점선) -->
        <span
          v-for="m in months + 1"
          :key="`g${m}`"
          class="absolute top-0 h-full w-px bg-[linear-gradient(#d0d5dc_50%,transparent_50%)] bg-[length:1px_8px]"
          :style="{ left: `calc(${pct((m - 1) * (52 / 12))}% - ${m === months + 1 ? 1 : 0}px)` }"
          aria-hidden="true"
        />
        <!-- 막대 -->
        <div
          v-for="(b, i) in bars"
          :key="i"
          class="absolute flex h-[37px] items-center"
          :style="{ top: `${i * 41}px`, left: `${pct(b.start)}%`, width: `${pct(b.max)}%` }"
          :title="`${b.name} · ${b.min}~${b.max}주`"
        >
          <span class="absolute inset-y-0 left-0 rounded-[10px] bg-[#212121]/30" :style="{ width: '100%' }" aria-hidden="true" />
          <span class="absolute inset-y-0 left-0 rounded-[10px] bg-[#212121]" :style="{ width: `${b.max === 0 ? 100 : (b.min / b.max) * 100}%` }" aria-hidden="true" />
          <span
            class="absolute whitespace-nowrap text-[15px] font-medium leading-[1.8]"
            :class="{
              'left-[10px] text-white': labelPlace(b) === 'inside',
              'left-[calc(100%+8px)] text-[#212121]': labelPlace(b) === 'right',
              'right-[calc(100%+8px)] text-[#212121]': labelPlace(b) === 'left',
            }"
          >{{ b.name }}</span>
        </div>
        <!-- 개월 라벨 -->
        <span
          v-for="m in months"
          :key="`m${m}`"
          class="absolute -translate-x-1/2 text-center text-[14px] font-semibold text-[#999]"
          :style="{ top: `${bars.length * 41 + 19}px`, left: `${pct((m - 0.5) * (52 / 12))}%` }"
        >{{ m }}m</span>
      </div>
    </div>

    <!-- 단계 표 -->
    <div class="overflow-x-auto">
      <div class="flex min-w-[760px] flex-col gap-[10px] pb-[10px] pt-[14px] leading-[1.8]">
        <div class="flex items-center gap-[14px] bg-[#f5f6f8] px-[10px] text-[15px] font-medium text-[#666]">
          <span class="w-[210px] shrink-0">단계</span>
          <span class="w-[104px] shrink-0">기간(주)</span>
          <span class="min-w-0 flex-1">산출물</span>
          <span class="min-w-0 flex-1">선행 조건</span>
          <span class="min-w-0 flex-1">비고</span>
        </div>
        <div v-for="(p, i) in phases" :key="i" class="flex items-start gap-[14px] px-[10px] text-[15px] text-[#141e34]">
          <span class="w-[210px] shrink-0 font-semibold text-black">{{ p.name }}</span>
          <span class="w-[104px] shrink-0">{{ p.minWeeks }}~{{ p.maxWeeks }}주</span>
          <span class="min-w-0 flex-1">{{ p.output }}</span>
          <span class="min-w-0 flex-1">{{ p.prerequisite }}</span>
          <span class="min-w-0 flex-1 text-[#666]">{{ p.note }}</span>
        </div>
      </div>
    </div>

    <!-- 합계 · 희망 시점 -->
    <div class="grid gap-[20px] leading-[1.8] md:grid-cols-2">
      <p class="flex flex-wrap items-center gap-[6px] rounded-[10px] border border-[#d9d9d9] bg-[#f5f6f8] px-[16px] py-[14px]">
        <span class="text-[15px] text-[#141e34]">예상 개발 일정 :</span>
        <span class="text-[16px] font-semibold text-black">{{ totals.minWeeks }}주~{{ totals.maxWeeks }}주</span>
      </p>
      <p class="flex flex-wrap items-center gap-[6px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px]">
        <span class="text-[15px] text-[#141e34]">희망 완료 시점 :</span>
        <span class="text-[16px] font-semibold text-black">{{ wishText }}</span>
      </p>
    </div>
    <div class="flex flex-col gap-[2px] text-[14px] leading-[1.8] text-[#666]">
      <!-- 대조 문장은 wishCode 기준이라, 의뢰의 희망 시기를 보일 때는 서로 다른 말을 하지 않게 뺀다 -->
      <p v-if="fit.status !== 'unknown' && wishText === fit.wishLabel">{{ fit.text }}</p>
      <p v-if="schedule.assumptions !== ''">전제 — {{ schedule.assumptions }}</p>
      <p>{{ DEV_REVIEW_SCHEDULE_CAPTION }}</p>
    </div>
  </section>
</template>
