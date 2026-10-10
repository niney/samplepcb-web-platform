<script setup lang="ts">
import { computed, ref } from 'vue';
import { PCB_EQ_ITEM_CATEGORY_LABELS, type PartnerPcbEqItemType, type PartnerPcbEqRoundType } from '@sp/api-contract';
import { usePartnerI18n } from '../../partner/i18n';
import { formatPartnerDateTime } from '../../partner/i18n-core';

// EQ 고객 회신(D20) — 관리자가 협력사에 **전달한** 문항형 회차만 온다(서버가 거른다, 최신 먼저).
// 공장은 자기 EQ 표의 **선택지 기호**(A/B/C)로 답을 읽는다 — 번역이 어긋나도 "B 를 골랐다"는
// 사실은 어긋나지 않으므로 기호를 가장 크게, 문장은 공장 원문(없으면 한국어)으로 보인다.
// 고객 의견은 P1 에서 번역 없이 원문 그대로다(번역 병기는 P2).
const props = defineProps<{ rounds: readonly PartnerPcbEqRoundType[] }>();
const { pt, locale } = usePartnerI18n();

// 고른 회차는 reviewId 로 든다 — 고르지 않았으면 늘 최신(새 회차가 전달되면 저절로 넘어간다).
const pickedId = ref<number | null>(null);
const current = computed<PartnerPcbEqRoundType | null>(
  () => props.rounds.find((r) => r.reviewId === pickedId.value) ?? props.rounds[0] ?? null,
);
const latestId = computed(() => props.rounds[0]?.reviewId ?? null);
const dt = (value: string | null): string => formatPartnerDateTime(value, locale.value);

/** 공장 번호가 회신서·개정 연결의 키다. 비어 있으면 표의 순서로 대신한다. */
const itemNo = (item: PartnerPcbEqItemType, index: number): string => item.factoryNo ?? String(index + 1);

/** 한 줄 요약 "1: B · 2: A" — 공장이 자기 표에 옮겨 적는 모양(관리자 이벤트 note 와 같은 꼴). */
const summary = computed(() =>
  (current.value?.items ?? []).map((item, i) => ({ no: itemNo(item, i), key: item.answer?.key ?? '—' })),
);

/** 고객이 실제로 읽은 한국어 문장이 원문과 다를 때만 펼칠 거리가 있다(번역이 답을 갈랐는지 확인용). */
const hasKoreanView = (item: PartnerPcbEqItemType): boolean =>
  (item.questionOrig !== null && item.questionOrig !== item.question) ||
  item.options.some((o) => o.labelOrig !== null && o.labelOrig !== o.label);
</script>

<template>
  <div v-if="current !== null" class="rounded-xl border border-violet-200 bg-violet-50/30 p-3 sm:p-4" data-testid="partner-eq-answers">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-bold text-violet-900">{{ pt('고객 회신') }}</h3>
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
    </div>
    <p class="mt-1 text-xs text-gray-500">
      {{ pt('전달 {value1}', { value1: dt(current.forwardedAt) }) }}<template v-if="current.answeredAt !== null"> · {{ pt('고객 회신 {value1}', { value1: dt(current.answeredAt) }) }}</template>
    </p>
    <p class="mt-1 text-xs leading-5 text-violet-800">
      {{ pt('샘플피씨비가 고객에게 확인한 EQ 답변입니다. 선택 기호는 귀사 EQ 표의 기호와 같습니다.') }}
    </p>

    <!-- 요약 — 문항이 많아도 한눈에 옮겨 적을 수 있게 -->
    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs" data-testid="partner-eq-answer-summary">
      <span class="font-semibold text-gray-600">{{ pt('고객 선택 요약') }}</span>
      <span
        v-for="s in summary"
        :key="s.no"
        class="rounded-md bg-surface px-2 py-0.5 font-mono font-bold text-violet-900 ring-1 ring-violet-200"
      >{{ s.no }}: {{ s.key }}</span>
    </div>

    <ol class="mt-3 space-y-3">
      <li
        v-for="(item, i) in current.items"
        :key="item.id"
        class="min-w-0 rounded-lg border border-gray-200 bg-surface p-3"
        data-testid="partner-eq-answer-item"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-bold text-gray-900">{{ pt('No. {value1}', { value1: itemNo(item, i) }) }}</span>
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">{{ pt(PCB_EQ_ITEM_CATEGORY_LABELS[item.category]) }}</span>
        </div>
        <!-- 공장 원문 질문 — 없으면(관리자가 한국어로만 적었으면) 그 문장 -->
        <p class="mt-1.5 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]" data-testid="partner-eq-question">{{ item.questionOrig ?? item.question }}</p>

        <ul class="mt-2 space-y-1.5">
          <li
            v-for="o in item.options"
            :key="o.key"
            class="flex min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5"
            :class="item.answer?.key === o.key ? 'bg-violet-100 ring-2 ring-violet-500' : 'bg-gray-50'"
            :data-chosen="item.answer?.key === o.key ? 'true' : 'false'"
            data-testid="partner-eq-option"
          >
            <!-- 기호가 공장이 읽는 키다 — 문장보다 크게 -->
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
        <p v-if="item.answer === null" class="mt-2 text-xs text-gray-400">{{ pt('답변 없음') }}</p>

        <!-- 고객 의견 — P1 은 번역 없이 원문 그대로(P2 에서 번역 병기) -->
        <div
          v-if="item.answer !== null && item.answer.comment !== null && item.answer.comment !== ''"
          class="mt-2 rounded-md border-l-4 border-violet-400 bg-surface px-3 py-2"
          data-testid="partner-eq-comment"
        >
          <p class="text-xs font-semibold text-violet-800">
            {{ pt('고객 의견') }} <span class="font-normal text-gray-400">· {{ pt('고객 원문(한국어)') }}</span>
          </p>
          <p class="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]">{{ item.answer.comment }}</p>
        </div>

        <!-- 고객이 실제로 읽은 문장 — 번역이 답을 갈랐는지 의심될 때만 펼친다 -->
        <details v-if="hasKoreanView(item)" class="mt-2 text-xs text-gray-500">
          <summary class="cursor-pointer select-none font-semibold">{{ pt('고객이 본 문장(한국어)') }}</summary>
          <p class="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ item.question }}</p>
          <ul class="mt-1 space-y-0.5">
            <li v-for="o in item.options" :key="o.key" class="[overflow-wrap:anywhere]">
              <b class="font-mono">{{ o.key }}</b> {{ o.label }}
            </li>
          </ul>
        </details>
      </li>
    </ol>
  </div>
</template>
