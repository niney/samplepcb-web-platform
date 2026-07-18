<script setup lang="ts">
import { computed } from 'vue';
import type { BomResultSummaryType, BomSheetType } from '@sp/api-contract';

const props = defineProps<{
  summary: BomResultSummaryType;
  sheets: BomSheetType[];
}>();

const cards = computed(() => {
  const parsed = props.summary.parsed_sheet_count
    ?? props.sheets.filter((sheet) => sheet.status === 'parsed').length;
  const headerMissing = props.summary.header_not_found_sheet_count
    ?? props.sheets.filter((sheet) => sheet.status === 'not_bom').length;
  const review = props.summary.review_component_count ?? 0;

  return [
    { label: '파싱 시트', value: parsed, note: `${String(props.sheets.length)}개 시트 중 분석 완료` },
    { label: '구조화 부품', value: props.summary.component_count, note: '검토 가능한 부품 행' },
    { label: '검토 필요', value: review, note: '근거 부족 또는 충돌' },
    { label: '헤더 미탐', value: headerMissing, note: '강제 추정하지 않은 시트' },
  ];
});
</script>

<template>
  <section class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="BOM 분석 요약">
    <article
      v-for="card in cards"
      :key="card.label"
      class="min-h-30 rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      <p class="text-sm font-medium text-gray-500">{{ card.label }}</p>
      <p class="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
        {{ card.value.toLocaleString('ko-KR') }}
      </p>
      <p class="mt-2 text-xs text-gray-400">{{ card.note }}</p>
    </article>
  </section>
</template>
