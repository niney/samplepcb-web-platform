<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomComponentType } from '@sp/api-contract';

const props = defineProps<{
  components: BomComponentType[];
  selectedSheet: string;
}>();

const emit = defineEmits<{ inspect: [component: BomComponentType] }>();

const search = ref('');
const reviewOnly = ref(false);
const page = ref(1);
const perPage = 30;

function isReview(component: BomComponentType): boolean {
  return component.review_status === 'review'
    || (component.uncertain_fields?.length ?? 0) > 0
    || (component.quality_flags?.length ?? 0) > 0;
}

function fieldText(component: BomComponentType): string {
  return [
    component.part_number,
    component.value_raw,
    component.manufacturer,
    component.description,
    component.component_type,
    component.package,
    component.footprint,
    component.reference_designators?.join(' '),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
}

const filtered = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  return props.components.filter((component) => {
    if (component.sheet_name !== props.selectedSheet) return false;
    if (reviewOnly.value && !isReview(component)) return false;
    return needle === '' || fieldText(component).includes(needle);
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / perPage)));
const visible = computed(() => filtered.value.slice((page.value - 1) * perPage, page.value * perPage));

watch([search, reviewOnly, () => props.selectedSheet], () => {
  page.value = 1;
});

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '미추출' : value.toLocaleString('ko-KR');
}

function formatResistance(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toLocaleString('ko-KR')} MΩ`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toLocaleString('ko-KR')} kΩ`;
  return `${value.toLocaleString('ko-KR')} Ω`;
}

function formatCapacitance(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Math.abs(value) < 1e-9) return `${(value * 1e12).toLocaleString('ko-KR')} pF`;
  if (Math.abs(value) < 1e-6) return `${(value * 1e9).toLocaleString('ko-KR')} nF`;
  return `${(value * 1e6).toLocaleString('ko-KR')} µF`;
}

function formatInductance(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (Math.abs(value) < 1e-3) return `${(value * 1e6).toLocaleString('ko-KR')} µH`;
  return `${(value * 1e3).toLocaleString('ko-KR')} mH`;
}

function specs(component: BomComponentType): string[] {
  const values = [
    formatResistance(component.resistance_ohm),
    formatCapacitance(component.capacitance_f),
    formatInductance(component.inductance_h),
    component.power_w === null || component.power_w === undefined ? null : `${component.power_w.toLocaleString('ko-KR')} W`,
    component.tolerance_percent === null || component.tolerance_percent === undefined ? null : `±${component.tolerance_percent.toLocaleString('ko-KR')}%`,
    component.voltage_v === null || component.voltage_v === undefined ? null : `${component.voltage_v.toLocaleString('ko-KR')} V`,
  ];
  return values.filter((value): value is string => value !== null);
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-white shadow-sm">
    <div class="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="font-semibold text-gray-900">컴포넌트</h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ filtered.length.toLocaleString('ko-KR') }}개 행 · 행을 선택하면 원본 셀 근거를 확인합니다.
        </p>
      </div>
      <label class="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-600">
        <input v-model="reviewOnly" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-blue-600">
        검토 필요만
      </label>
    </div>

    <div class="flex items-center justify-between gap-4 border-b border-gray-100 px-4 py-3">
      <label class="flex h-10 w-full max-w-md items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 text-gray-400 focus-within:border-blue-400 focus-within:bg-white">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="search"
          type="search"
          class="min-w-0 flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
          placeholder="품번, 값, 제조사, REFDES 검색"
          aria-label="컴포넌트 검색"
        >
      </label>
      <span class="shrink-0 text-xs text-gray-400">{{ page }} / {{ pageCount }}</span>
    </div>

    <div class="overflow-x-auto">
      <table class="min-w-275 w-full text-left text-sm">
        <thead class="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th class="px-3 py-3 font-semibold">상태</th>
            <th class="px-3 py-3 font-semibold">종류</th>
            <th class="px-3 py-3 font-semibold">Part number / 값</th>
            <th class="px-3 py-3 font-semibold">전기 사양</th>
            <th class="px-3 py-3 font-semibold">패키지</th>
            <th class="px-3 py-3 font-semibold">수량</th>
            <th class="px-3 py-3 font-semibold">REFDES</th>
            <th class="px-3 py-3 text-center font-semibold">근거</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="(component, index) in visible"
            :key="`${component.sheet_name}-${component.source_rows_1based?.join('-') ?? index}-${component.part_number ?? component.value_raw ?? index}`"
            tabindex="0"
            class="cursor-pointer text-gray-700 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
            @click="emit('inspect', component)"
            @keydown.enter="emit('inspect', component)"
          >
            <td class="px-3 py-3 align-top">
              <span
                class="inline-flex rounded-full px-2 py-1 text-xs font-semibold"
                :class="isReview(component) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'"
              >
                {{ isReview(component) ? '검토 필요' : '추출됨' }}
              </span>
            </td>
            <td class="px-3 py-3 align-top">
              <span class="rounded bg-gray-100 px-2 py-1 text-xs font-medium uppercase text-gray-600">
                {{ component.component_type ?? 'unknown' }}
              </span>
            </td>
            <td class="max-w-64 px-3 py-3 align-top">
              <strong class="block break-words font-semibold text-gray-900">
                {{ component.part_number ?? component.value_raw ?? '미추출' }}
              </strong>
              <span v-if="component.part_number !== null && component.part_number !== undefined && component.value_raw" class="mt-1 block text-xs text-gray-500">
                {{ component.value_raw }}
              </span>
              <span v-if="component.manufacturer" class="mt-1 block text-xs text-gray-400">{{ component.manufacturer }}</span>
            </td>
            <td class="max-w-60 px-3 py-3 align-top">
              <span v-if="specs(component).length" class="font-mono text-xs text-teal-700">{{ specs(component).join(' · ') }}</span>
              <span v-else class="text-gray-400">미추출</span>
            </td>
            <td class="px-3 py-3 align-top">{{ component.package ?? component.footprint ?? component.size_code ?? '미추출' }}</td>
            <td class="px-3 py-3 align-top">{{ formatNumber(component.quantity) }}</td>
            <td class="max-w-56 px-3 py-3 align-top text-gray-600">
              {{ component.reference_designators?.join(', ') || '미추출' }}
            </td>
            <td class="px-3 py-3 text-center align-top">
              <span class="inline-grid h-7 min-w-7 place-items-center rounded-full bg-blue-50 px-1 text-xs font-bold text-blue-700">
                {{ component.evidence?.length ?? 0 }}
              </span>
            </td>
          </tr>
          <tr v-if="visible.length === 0">
            <td colspan="8" class="px-3 py-12 text-center text-gray-400">조건에 맞는 컴포넌트가 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-center gap-5 border-t border-gray-100 px-4 py-3 text-sm text-gray-500">
      <button type="button" class="rounded px-2 py-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
      <span>
        {{ filtered.length === 0 ? 0 : (page - 1) * perPage + 1 }}–{{ Math.min(page * perPage, filtered.length) }}
      </span>
      <button type="button" class="rounded px-2 py-1 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40" :disabled="page >= pageCount" @click="page += 1">다음</button>
    </div>
  </section>
</template>
