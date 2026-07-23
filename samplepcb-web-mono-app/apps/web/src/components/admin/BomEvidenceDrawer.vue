<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import type { BomComponentType, BomEvidenceType } from '@sp/api-contract';

const props = defineProps<{ component: BomComponentType | null }>();
const emit = defineEmits<{ close: [] }>();

const fieldLabels: Record<string, string> = {
  part_number: '품번',
  component_type: '종류',
  resistance: '저항',
  capacitance: '용량',
  inductance: '인덕턴스',
  power: '전력',
  tolerance: '허용오차',
  voltage: '전압',
  current: '전류',
  frequency: '주파수',
  temperature: '온도',
  package: '패키지',
  manufacturer: '제조사',
  quantity: '수량',
};

const flagLabels: Record<string, string> = {
  quantity_not_found: '수량 미추출',
  field_without_direct_evidence: '직접 셀 근거 부족',
  row_shape_recovered: 'CSV 행 구조 복구됨',
  row_shape_invalid: 'CSV 행 구조 확인 필요',
};

const componentTitle = computed(() => {
  const component = props.component;
  return component?.part_number ?? component?.value_raw ?? component?.component_type ?? '미식별 컴포넌트';
});

const allEvidence = computed<BomEvidenceType[]>(() => {
  const component = props.component;
  if (component === null) return [];
  const result: BomEvidenceType[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...(component.evidence ?? []),
    ...(component.attributes ?? []).flatMap((attribute) => attribute.evidence ?? []),
    ...Object.values(component.field_states ?? {}).flatMap((field) => field.evidence ?? []),
  ];
  for (const evidence of candidates) {
    const key = `${evidence.cell}\u0000${evidence.supports}\u0000${evidence.raw_value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(evidence);
    }
  }
  return result;
});

const fieldStates = computed(() => Object.entries(props.component?.field_states ?? {}));
const isReview = computed(() => {
  const component = props.component;
  return component?.review_status === 'review'
    || (component?.uncertain_fields?.length ?? 0) > 0
    || (component?.quality_flags?.length ?? 0) > 0;
});

function label(value: string): string {
  return fieldLabels[value] ?? flagLabels[value] ?? value;
}

function fieldValue(value: string | number | null): string {
  return value === null || value === '' ? '미추출' : String(value);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="component !== null"
      class="fixed inset-0 z-50 flex justify-end bg-slate-950/40"
      role="presentation"
      @mousedown.self="emit('close')"
    >
      <aside class="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="bom-evidence-title">
        <header class="sticky top-0 z-10 flex items-start justify-between gap-4 bg-slate-900 px-6 py-5 text-white">
          <div class="min-w-0">
            <p class="text-xs font-bold tracking-[0.16em] text-emerald-300">COMPONENT EVIDENCE</p>
            <h2 id="bom-evidence-title" class="mt-2 break-words text-xl font-semibold">{{ componentTitle }}</h2>
          </div>
          <button type="button" class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-2xl text-white hover:bg-white/20" aria-label="상세 닫기" @click="emit('close')">×</button>
        </header>

        <div class="space-y-7 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
            <span
              class="rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="isReview ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'"
            >
              {{ isReview ? '검토 필요' : '추출됨' }}
            </span>
            <span>{{ component.sheet_name }} · 행 {{ component.source_rows_1based?.join(', ') || '—' }}</span>
          </div>

          <p v-if="component.description" class="text-sm leading-6 text-gray-700">{{ component.description }}</p>

          <dl class="grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200">
            <div class="min-h-20 border-b border-r border-gray-200 p-3">
              <dt class="text-xs text-gray-400">제조사</dt>
              <dd class="mt-2 break-words text-sm font-medium text-gray-900">{{ component.manufacturer ?? '미추출' }}</dd>
            </div>
            <div class="min-h-20 border-b border-gray-200 p-3">
              <dt class="text-xs text-gray-400">패키지</dt>
              <dd class="mt-2 break-words text-sm font-medium text-gray-900">{{ component.package ?? component.footprint ?? '미추출' }}</dd>
            </div>
            <div class="min-h-20 border-r border-gray-200 p-3">
              <dt class="text-xs text-gray-400">원본 값</dt>
              <dd class="mt-2 break-words text-sm font-medium text-gray-900">{{ component.value_raw ?? '미추출' }}</dd>
            </div>
            <div class="min-h-20 p-3">
              <dt class="text-xs text-gray-400">REFDES</dt>
              <dd class="mt-2 break-words text-sm font-medium text-gray-900">{{ component.reference_designators?.join(', ') || '미추출' }}</dd>
            </div>
          </dl>

          <section v-if="(component.uncertain_fields?.length ?? 0) > 0 || (component.quality_flags?.length ?? 0) > 0" class="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h3 class="text-sm font-semibold text-amber-900">검토 필요</h3>
            <div class="mt-3 flex flex-wrap gap-2">
              <span v-for="field in component.uncertain_fields" :key="field" class="rounded bg-white px-2 py-1 text-xs text-amber-900">{{ label(field) }}</span>
              <span v-for="flag in component.quality_flags" :key="flag" class="rounded bg-white px-2 py-1 text-xs text-amber-900">{{ label(flag) }}</span>
            </div>
          </section>

          <section v-if="fieldStates.length > 0">
            <div class="flex items-end justify-between gap-3">
              <h3 class="font-semibold text-gray-900">필드 추출 상태</h3>
              <span class="text-xs text-gray-400">추출값과 근거 상태</span>
            </div>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              <article v-for="[field, state] in fieldStates" :key="field" class="flex min-h-16 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div class="min-w-0">
                  <p class="text-xs font-medium text-gray-500">{{ label(field) }}</p>
                  <p class="mt-1 break-words text-sm font-semibold text-gray-900">{{ fieldValue(state.value) }}</p>
                </div>
                <span
                  class="shrink-0 rounded-full px-2 py-1 text-xs font-semibold"
                  :class="{
                    'bg-emerald-100 text-emerald-800': state.status === 'extracted',
                    'bg-amber-100 text-amber-800': state.status === 'review',
                    'bg-gray-200 text-gray-600': state.status === 'not_found',
                  }"
                >{{ state.status === 'extracted' ? '추출됨' : state.status === 'review' ? '검토' : '미추출' }}</span>
              </article>
            </div>
          </section>

          <section>
            <div class="flex items-end justify-between gap-3">
              <h3 class="font-semibold text-gray-900">원본 셀 근거</h3>
              <span class="text-xs text-gray-400">{{ allEvidence.length }} cells</span>
            </div>
            <div v-if="allEvidence.length > 0" class="mt-3 space-y-2">
              <article v-for="(evidence, index) in allEvidence" :key="`${evidence.cell}-${evidence.supports}-${index}`" class="grid grid-cols-[4rem_1fr] gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <span class="font-mono text-sm font-bold text-blue-700">{{ evidence.cell }}</span>
                <div>
                  <p class="text-xs font-semibold text-gray-600">{{ label(evidence.supports) }}</p>
                  <p class="mt-1 break-words text-sm text-gray-900">{{ evidence.raw_value }}</p>
                </div>
              </article>
            </div>
            <p v-else class="mt-3 rounded-lg bg-gray-50 p-4 text-sm text-gray-400">저장된 원본 셀 근거가 없습니다.</p>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
