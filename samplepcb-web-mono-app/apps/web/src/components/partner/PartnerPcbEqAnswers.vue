<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { PCB_EQ_ITEM_CATEGORY_LABELS, type PartnerPcbEqItemType, type PartnerPcbEqRoundType } from '@sp/api-contract';
import { usePartnerI18n } from '../../partner/i18n';
import { formatPartnerDateTime } from '../../partner/i18n-core';

// EQ 고객 회신(D20) — 관리자가 협력사에 **전달한** 문항형 회차만 온다(서버가 거른다, 최신 먼저).
// 공장은 자기 EQ 표의 **선택지 기호**(A/B/C)로 답을 읽는다 — 번역이 어긋나도 "B 를 골랐다"는
// 사실은 어긋나지 않으므로 기호를 가장 크게, 문장은 공장 원문(없으면 한국어)으로 보인다.
// 고객 의견은 번역 없이 원문 그대로다.
//
// 2026-10-11 재편(사용자 지적) — 이 영역이 타임라인과 '지금 할 일' 사이에 끼어 있어, 추가 EQ 요청으로
// 돌아온 화면에서 올린 파일과 업로드 버튼 사이를 갈랐다. 지금은 **EQ 카드 아래의 별도 카드**이고,
// 문항은 카드 대신 **한 줄**이다(번호·유형·질문·선택·의견 — 공장이 자기 표에 옮겨 적는 모양 그대로).
// 줄을 펼치면 질문 전문·전체 선택지·고객이 본 한국어 문장이 나온다.
//
// collapsedByDefault — 읽어야 하는 단계(승인 직후·승인 대기 중 회신 도착)가 아니면 접어 둔다.
// 접혀도 '고객 선택 요약' 한 줄은 남는다. 단계가 바뀌면 사람이 누른 접힘은 잊는다.
const props = defineProps<{ rounds: readonly PartnerPcbEqRoundType[]; collapsedByDefault?: boolean }>();
const { pt, locale } = usePartnerI18n();

// 고른 회차는 reviewId 로 든다 — 고르지 않았으면 늘 최신(새 회차가 전달되면 저절로 넘어간다).
const pickedId = ref<number | null>(null);
const current = computed<PartnerPcbEqRoundType | null>(
  () => props.rounds.find((r) => r.reviewId === pickedId.value) ?? props.rounds[0] ?? null,
);
const latestId = computed(() => props.rounds[0]?.reviewId ?? null);
const dt = (value: string | null): string => formatPartnerDateTime(value, locale.value);

const toggled = ref<boolean | null>(null);
const open = computed(() => toggled.value ?? !props.collapsedByDefault);
watch(
  () => props.collapsedByDefault,
  () => {
    toggled.value = null;
  },
);

// 펼친 문항 — 회차를 바꾸면 문항 id 가 달라지므로 따로 비울 필요가 없다.
const expandedIds = ref<ReadonlySet<number>>(new Set<number>());
const isExpanded = (id: number): boolean => expandedIds.value.has(id);
function toggleItem(id: number): void {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

/** 공장 번호가 회신서·개정 연결의 키다. 비어 있으면 표의 순서로 대신한다. */
const itemNo = (item: PartnerPcbEqItemType, index: number): string => item.factoryNo ?? String(index + 1);

/** 한 줄 요약 "1: B · 2: A" — 공장이 자기 표에 옮겨 적는 모양(관리자 이벤트 note 와 같은 꼴). */
const summary = computed(() =>
  (current.value?.items ?? []).map((item, i) => ({ no: itemNo(item, i), key: item.answer?.key ?? '—' })),
);

const chosenOption = (item: PartnerPcbEqItemType): PartnerPcbEqItemType['options'][number] | null =>
  item.answer === null ? null : (item.options.find((o) => o.key === item.answer?.key) ?? null);
const chosenText = (item: PartnerPcbEqItemType): string => {
  const o = chosenOption(item);
  return o === null ? '' : (o.labelOrig ?? o.label);
};
const commentOf = (item: PartnerPcbEqItemType): string | null => {
  const c = item.answer?.comment ?? null;
  return c === null || c === '' ? null : c;
};

/** 고객이 실제로 읽은 한국어 문장이 원문과 다를 때만 보일 거리가 있다(번역이 답을 갈랐는지 확인용). */
const hasKoreanView = (item: PartnerPcbEqItemType): boolean =>
  (item.questionOrig !== null && item.questionOrig !== item.question) ||
  item.options.some((o) => o.labelOrig !== null && o.labelOrig !== o.label);

// '지금 할 일'의 [회신 보기] — 카드를 펼치고 그 자리로 내려간다.
const root = ref<HTMLElement | null>(null);
async function reveal(): Promise<void> {
  toggled.value = true;
  await nextTick();
  root.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
defineExpose({ reveal });
</script>

<template>
  <section
    v-if="current !== null"
    ref="root"
    class="scroll-mt-4 rounded-xl border border-violet-200 bg-surface p-4"
    data-testid="partner-eq-answers"
  >
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-bold text-violet-900">{{ pt('고객 회신') }}</h2>
      <!-- 회차 전환 — 개정 EQ 가 오가면 회차가 쌓인다. 하나뿐이면 전환할 것이 없다. -->
      <div v-if="rounds.length > 1" class="flex flex-wrap gap-1" role="tablist">
        <button
          v-for="r in rounds"
          :key="r.reviewId"
          type="button"
          role="tab"
          :aria-selected="r.reviewId === current.reviewId"
          class="rounded-full px-2.5 py-0.5 text-xs font-semibold"
          :class="r.reviewId === current.reviewId ? 'bg-violet-600 text-white' : 'bg-surface text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50'"
          data-testid="partner-eq-round-tab"
          @click="pickedId = r.reviewId"
        >
          {{ pt('{value1}차', { value1: r.roundNo }) }}<template v-if="r.reviewId === latestId"> · {{ pt('최신') }}</template>
        </button>
      </div>
      <span v-else class="rounded-full bg-violet-600 px-2.5 py-0.5 text-xs font-semibold text-white">{{ pt('{value1}차', { value1: current.roundNo }) }}</span>
      <button
        type="button"
        class="ml-auto rounded-md border border-violet-200 bg-surface px-2.5 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-50"
        :aria-expanded="open"
        data-testid="partner-eq-answers-toggle"
        @click="toggled = !open"
      >
        {{ open ? pt('접기') : pt('펼치기') }}
      </button>
    </div>
    <p v-if="open" class="mt-1 text-xs text-gray-500">
      {{ pt('전달 {value1}', { value1: dt(current.forwardedAt) }) }}<template v-if="current.answeredAt !== null"> · {{ pt('고객 회신 {value1}', { value1: dt(current.answeredAt) }) }}</template>
    </p>
    <p v-if="open" class="mt-1 text-xs leading-5 text-violet-800">
      {{ pt('샘플피씨비가 고객에게 확인한 EQ 답변입니다. 선택 기호는 귀사 EQ 표의 기호와 같습니다.') }}
    </p>

    <!-- 요약 — 접혀 있어도 남는다(공장이 옮겨 적는 값) -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="partner-eq-answer-summary">
      <span class="font-semibold text-gray-600">{{ pt('고객 선택 요약') }}</span>
      <span
        v-for="s in summary"
        :key="s.no"
        class="rounded-md bg-violet-50 px-2 py-0.5 font-mono font-bold text-violet-900 ring-1 ring-violet-200"
      >{{ s.no }}: {{ s.key }}</span>
    </div>
    <p v-if="!open" class="mt-1 text-xs text-gray-500" data-testid="partner-eq-answers-collapsed">
      {{ pt('문항별 내용은 접어 두었습니다 — [펼치기]로 다시 볼 수 있습니다.') }}
    </p>

    <template v-if="open">
      <!-- 열 머리(넓은 화면) — 좁으면 문항이 세로로 쌓이고 머리는 숨는다 -->
      <div class="mt-3 hidden grid-cols-[3.5rem_7.5rem_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_4.5rem] gap-3 px-3 text-[11px] font-semibold text-gray-500 lg:grid">
        <span>{{ pt('번호') }}</span>
        <span>{{ pt('유형') }}</span>
        <span>{{ pt('질문') }}</span>
        <span>{{ pt('고객 선택') }}</span>
        <span>{{ pt('고객 의견') }}</span>
        <span />
      </div>
      <ol class="mt-1 divide-y divide-gray-200 rounded-lg border border-gray-200">
        <li
          v-for="(item, i) in current.items"
          :key="item.id"
          class="min-w-0"
          data-testid="partner-eq-answer-item"
        >
          <!-- 한 줄 — 번호·유형·질문·선택·의견. 누르면 아래가 펼쳐진다 -->
          <div
            class="grid min-w-0 cursor-pointer grid-cols-1 gap-x-3 gap-y-1.5 px-3 py-2.5 hover:bg-violet-50/40 lg:grid-cols-[3.5rem_7.5rem_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_4.5rem] lg:items-start"
            data-testid="partner-eq-answer-row"
            @click="toggleItem(item.id)"
          >
            <span class="text-sm font-bold text-gray-900">{{ pt('No. {value1}', { value1: itemNo(item, i) }) }}</span>
            <span class="min-w-0"><span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">{{ pt(PCB_EQ_ITEM_CATEGORY_LABELS[item.category]) }}</span></span>
            <!-- 공장 원문 질문 — 없으면(관리자가 한국어로만 적었으면) 그 문장. 접힌 줄에서는 두 줄까지만 -->
            <p
              class="min-w-0 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]"
              :class="isExpanded(item.id) ? '' : 'line-clamp-2'"
              data-testid="partner-eq-question"
            >
              {{ item.questionOrig ?? item.question }}
            </p>
            <!-- 고객이 고른 것 — 기호가 공장이 읽는 키다(문장보다 크게) -->
            <div class="flex min-w-0 items-start gap-2" data-testid="partner-eq-chosen">
              <template v-if="chosenOption(item) !== null">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-600 text-base font-black text-white">{{ item.answer?.key }}</span>
                <span class="min-w-0 pt-1 text-sm font-semibold text-violet-950 [overflow-wrap:anywhere]" :class="isExpanded(item.id) ? '' : 'line-clamp-2'">{{ chosenText(item) }}</span>
              </template>
              <span v-else class="pt-1 text-xs text-gray-400">{{ pt('답변 없음') }}</span>
            </div>
            <!-- 고객 의견 — 번역 없이 원문 그대로 -->
            <div v-if="commentOf(item) !== null" class="min-w-0 rounded-md border-l-4 border-violet-400 bg-violet-50/50 px-2 py-1" data-testid="partner-eq-comment">
              <p class="text-[11px] font-semibold text-violet-800">
                {{ pt('고객 의견') }} <span class="font-normal text-gray-400">· {{ pt('고객 원문(한국어)') }}</span>
              </p>
              <p class="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]" :class="isExpanded(item.id) ? '' : 'line-clamp-2'">{{ commentOf(item) }}</p>
            </div>
            <span v-else class="hidden text-xs text-gray-300 lg:block">—</span>
            <button
              type="button"
              class="justify-self-start rounded-md border border-gray-200 bg-surface px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 lg:justify-self-end"
              :aria-expanded="isExpanded(item.id)"
              data-testid="partner-eq-answer-expand"
              @click.stop="toggleItem(item.id)"
            >
              {{ isExpanded(item.id) ? pt('접기') : pt('자세히') }}
            </button>
          </div>

          <!-- 펼침 — 전체 선택지(고른 것 강조)와 고객이 본 한국어 문장 -->
          <div v-if="isExpanded(item.id)" class="border-t border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5">
            <ul class="space-y-1.5">
              <li
                v-for="o in item.options"
                :key="o.key"
                class="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5"
                :class="item.answer?.key === o.key ? 'bg-violet-100 ring-2 ring-violet-500' : 'bg-surface'"
                :data-chosen="item.answer?.key === o.key ? 'true' : 'false'"
                data-testid="partner-eq-option"
              >
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base font-black"
                  :class="item.answer?.key === o.key ? 'bg-violet-600 text-white' : 'bg-surface text-gray-500 ring-1 ring-gray-200'"
                >{{ o.key }}</span>
                <span
                  class="min-w-0 flex-1 pt-1 text-sm [overflow-wrap:anywhere]"
                  :class="item.answer?.key === o.key ? 'font-semibold text-violet-950' : 'text-gray-600'"
                >{{ o.labelOrig ?? o.label }}</span>
                <span
                  v-if="item.answer?.key === o.key"
                  class="mt-1 shrink-0 rounded bg-violet-600 px-1.5 py-0.5 text-[11px] font-bold text-white"
                >✓ {{ pt('고객 선택') }}</span>
              </li>
            </ul>
            <!-- 고객이 실제로 읽은 문장 — 번역이 답을 갈랐는지 의심될 때 본다 -->
            <details v-if="hasKoreanView(item)" class="mt-2 text-xs text-gray-500">
              <summary class="cursor-pointer select-none font-semibold">{{ pt('고객이 본 문장(한국어)') }}</summary>
              <p class="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ item.question }}</p>
              <ul class="mt-1 space-y-0.5">
                <li v-for="o in item.options" :key="o.key" class="[overflow-wrap:anywhere]">
                  <b class="font-mono">{{ o.key }}</b> {{ o.label }}
                </li>
              </ul>
            </details>
          </div>
        </li>
      </ol>
    </template>
  </section>
</template>
