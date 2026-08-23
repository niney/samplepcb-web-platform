<script setup lang="ts" generic="K extends string">
// 워크큐 탭 띠(R3) — 관리자 워크큐(AdminPcbPos 등)와 같은 밑줄 탭. count 는 탭 미반영
// 분포라 탭을 오가도 숫자가 유지되고, emphasize(할 일 탭)는 건수가 있을 때 amber 로 띄운다.
// 오른쪽 슬롯은 검색창 자리.
export interface PartnerWorkqueueTab<T extends string> {
  key: T;
  label: string;
  count?: number;
  emphasize?: boolean;
}

const props = withDefaults(
  defineProps<{
    tabs: readonly PartnerWorkqueueTab<K>[];
    modelValue: K;
    accent?: 'indigo' | 'teal' | 'blue';
  }>(),
  { accent: 'blue' },
);
const emit = defineEmits<{ 'update:modelValue': [tab: K] }>();

const ACTIVE_CLS: Record<'indigo' | 'teal' | 'blue', string> = {
  indigo: 'border-indigo-600 text-indigo-700',
  teal: 'border-teal-600 text-teal-700',
  blue: 'border-blue-600 text-blue-700',
};
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200">
    <div class="flex flex-wrap gap-1" role="tablist">
      <button
        v-for="t in props.tabs"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="t.key === props.modelValue"
        class="-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
        :class="
          t.key === props.modelValue
            ? ACTIVE_CLS[props.accent]
            : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'
        "
        @click="emit('update:modelValue', t.key)"
      >
        {{ t.label }}
        <span
          v-if="t.count !== undefined"
          class="rounded-full px-1.5 py-px text-[11px] font-bold tabular-nums"
          :class="t.emphasize === true && t.count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'"
        >{{ t.count }}</span>
      </button>
    </div>
    <div v-if="$slots.default" class="pb-1.5">
      <slot />
    </div>
  </div>
</template>
