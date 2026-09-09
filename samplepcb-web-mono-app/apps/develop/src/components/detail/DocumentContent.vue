<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_DOC_FIELDS, developDocContentRows } from '@sp/api-contract';
import type { DevelopDocColumn, DevelopDocContentType, DevelopDocTypeType } from '@sp/api-contract';

// 문서 본문 표 — 라벨/값. 라벨·순서·표 컬럼은 전부 계약 스펙(DEVELOP_DOC_FIELDS)이 정본이고
// 값 텍스트는 계약 순수 함수(developDocContentRows)가 만든다(빈 값은 애초에 빠진다).
// 다만 table kind 는 그 함수가 "1. 결정사항: … · 담당: …" 한 덩어리로 펴 주므로, 화면에서는
// 컬럼 라벨을 헤더로 세운 **실제 표**로 다시 그린다(종이·화면 모두 이 편이 읽힌다).
// 화면과 인쇄가 같은 규칙을 쓰도록 이 컴포넌트를 DocumentView·DocumentPrint 가 함께 쓴다.
const props = withDefaults(defineProps<{ type: DevelopDocTypeType; content: DevelopDocContentType; variant?: 'screen' | 'print' }>(), {
  variant: 'screen',
});

const rows = computed(() => developDocContentRows(props.type, props.content));
const specs = computed(() => DEVELOP_DOC_FIELDS[props.type]);
const columnsOf = (key: string): readonly DevelopDocColumn[] => specs.value.find((f) => f.key === key)?.columns ?? [];

// content 값은 `string | string[] | Record<string,string>[]` 이라 표 행만 좁혀 읽는다.
function tableRowsOf(key: string): Record<string, string>[] {
  const value = props.content[key];
  if (!Array.isArray(value)) return [];
  const out: Record<string, string>[] = [];
  for (const row of value) {
    if (typeof row !== 'string') out.push(row);
  }
  return out.filter((row) => Object.values(row).some((cell) => cell.trim() !== ''));
}
const cellText = (col: DevelopDocColumn, row: Record<string, string>): string => {
  const raw = row[col.key] ?? '';
  if (raw.trim() === '') return '';
  return col.kind === 'select' ? ((col.options ?? []).find((o) => o.code === raw)?.label ?? raw) : raw;
};
const print = computed(() => props.variant === 'print');
</script>

<template>
  <dl v-if="rows.length > 0" class="grid gap-px overflow-hidden rounded-xl bg-line" :class="print ? '' : 'border border-line'">
    <div
      v-for="r in rows"
      :key="r.key"
      class="grid gap-1 bg-white px-4 py-3 sm:gap-4"
      :class="r.kind === 'table' ? '' : 'sm:grid-cols-[160px_1fr]'"
    >
      <dt class="text-label font-semibold text-tx-3">{{ r.label }}</dt>
      <dd v-if="r.kind !== 'table'" class="whitespace-pre-wrap text-body leading-relaxed text-tx-1">{{ r.text }}</dd>
      <dd v-else class="overflow-x-auto">
        <table class="w-full min-w-[420px] border-collapse text-body">
          <thead>
            <tr class="border-b border-line text-label text-tx-3">
              <th
                v-for="c in columnsOf(r.key)"
                :key="c.key"
                class="py-1.5 pr-3 text-left font-semibold"
                :class="c.width === 'narrow' ? 'w-20' : c.width === 'wide' ? '' : 'w-32'"
              >
                {{ c.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in tableRowsOf(r.key)" :key="i" class="border-b border-line align-top last:border-b-0">
              <td v-for="c in columnsOf(r.key)" :key="c.key" class="py-2 pr-3 text-tx-1">{{ cellText(c, row) }}</td>
            </tr>
          </tbody>
        </table>
      </dd>
    </div>
  </dl>
  <p v-else class="rounded-xl px-4 py-6 text-center text-body text-tx-3" :class="print ? '' : 'border border-dashed border-line-2'">
    본문 없이 첨부만 보내진 문서입니다.
  </p>
</template>
