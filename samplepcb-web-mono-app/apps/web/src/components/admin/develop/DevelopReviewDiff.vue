<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MarketDevReviewType } from '@sp/api-contract';
import { DEV_REVIEW_DIFF_SECTION_LABELS, diffDevReview, diffWords } from '@sp/utils';
import type { DevReviewDiffEntry, DevReviewDiffSection } from '@sp/utils';

// 두 판의 구조 비교(docs/DEVELOP_FLOW.md §6.2) — 항목 단위 추가/삭제/변경, 변경 문장은 단어 하이라이트.
// 계산은 전부 @sp/utils 순수 함수(diffDevReview·diffWords)라 이 컴포넌트는 그리기만 한다.
const props = defineProps<{ a: MarketDevReviewType; b: MarketDevReviewType; aLabel: string; bLabel: string }>();

const { t } = useI18n();

const diff = computed(() => diffDevReview(props.a, props.b));
const groups = computed(() =>
  diff.value.changedSections.map((section) => ({
    section,
    title: DEV_REVIEW_DIFF_SECTION_LABELS[section],
    entries: diff.value.entries.filter((e) => e.section === section),
  })),
);

const OP_CLASS: Record<DevReviewDiffEntry['op'], string> = {
  added: 'bg-emerald-100 text-emerald-700',
  removed: 'bg-red-100 text-red-700',
  changed: 'bg-amber-100 text-amber-700',
};
const SECTION_TONE: Record<DevReviewDiffSection, string> = {
  summary: 'border-gray-200',
  requirements: 'border-gray-200',
  areas: 'border-blue-100',
  openQuestions: 'border-amber-100',
  schedule: 'border-indigo-100',
  adminComment: 'border-gray-200',
};

const words = (before: string | null, after: string | null) => diffWords(before ?? '', after ?? '');
</script>

<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-bold text-gray-800">{{ aLabel }}</span>
      <span class="text-gray-400">→</span>
      <span class="font-bold text-gray-800">{{ bLabel }}</span>
      <template v-if="!diff.isEmpty">
        <span class="ml-2 text-xs text-gray-500">{{ t('admin.develop.review.versions.changedSections') }}:</span>
        <span v-for="g in groups" :key="g.section" class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
          {{ g.title }} {{ g.entries.length }}
        </span>
      </template>
    </div>

    <p v-if="diff.isEmpty" class="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
      {{ t('admin.develop.review.versions.same') }}
    </p>

    <section v-for="g in groups" :key="g.section" class="rounded-lg border bg-white" :class="SECTION_TONE[g.section]">
      <h4 class="border-b border-gray-100 px-3 py-2 text-sm font-bold text-gray-800">{{ g.title }}</h4>
      <ul class="divide-y divide-gray-100">
        <li v-for="(e, i) in g.entries" :key="i" class="grid gap-1.5 px-3 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full px-1.5 py-0.5 text-[11px] font-bold" :class="OP_CLASS[e.op]">
              {{ t(`admin.develop.review.versions.op.${e.op}`) }}
            </span>
            <span class="text-sm font-semibold text-gray-700">{{ e.label }}</span>
          </div>
          <!-- 변경: 한 줄에 단어 하이라이트(삭제=빨강 취소선·추가=초록) -->
          <p v-if="e.op === 'changed'" class="whitespace-pre-line text-sm leading-relaxed text-gray-800">
            <template v-for="(w, wi) in words(e.before, e.after)" :key="wi">
              <span v-if="w.op === 'same'">{{ w.text }}</span>
              <del v-else-if="w.op === 'removed'" class="rounded bg-red-100 px-0.5 text-red-700">{{ w.text }}</del>
              <ins v-else class="rounded bg-emerald-100 px-0.5 no-underline text-emerald-800">{{ w.text }}</ins>
            </template>
          </p>
          <p v-else-if="e.op === 'added'" class="whitespace-pre-line rounded-md bg-emerald-50 px-2 py-1 text-sm leading-relaxed text-emerald-900">{{ e.after }}</p>
          <p v-else class="whitespace-pre-line rounded-md bg-red-50 px-2 py-1 text-sm leading-relaxed text-red-800 line-through">{{ e.before }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
