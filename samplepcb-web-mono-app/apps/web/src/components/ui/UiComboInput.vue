<script setup lang="ts">
import { computed, ref } from 'vue';

// 선택지로 **유도하되 가두지는 않는** 입력칸.
//
// 거버(고객)는 select 로 값을 좁히지만, 관리자는 협력사와 협의한 값을 적어야 한다 —
// 실측상 `panel` 의 19%(1x2·2x2…)·`edgeRail` 의 11%(사방 자삽바·상하 7mm)가 선택지 밖 값이다.
// select 로 강제하면 그 값들이 저장 순간 사라지거나 엉뚱한 값으로 바뀐다.
//
// 그래서 목록은 **보기**이고 입력은 자유다. 대신 목록 밖 값이면 그 사실을 표시한다
// (막는 대신 대가를 보여주는 방식 — 거버 파생값 경고·삭제 차단 해제와 같은 결).
//
// 값의 두 얼굴: 목록에서 고르면 화면엔 표시명(녹색), 저장은 거버와 같은 값(green).
// 손으로 적으면 적은 문자열이 그대로 저장값이자 표시값이다.
// modelValue 가 undefined 를 받는 이유: 호출부가 `draft[key]` 처럼 인덱스 접근으로 넘긴다
// (noUncheckedIndexedAccess). 빈 값과 같게 다루면 되므로 여기서 흡수한다.
const props = defineProps<{
  modelValue: string | undefined;
  options: readonly { value: string; name: string }[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const box = ref<HTMLElement | null>(null);
const current = computed(() => props.modelValue ?? '');

/** 저장값 → 표시명. 목록 밖이면 저장값이 곧 표시값이다. */
const shown = computed(() => {
  const raw = current.value.trim();
  if (raw === '') return '';
  const hit = props.options.find(
    (o) => o.value.toLowerCase() === raw.toLowerCase() || o.name.toLowerCase() === raw.toLowerCase(),
  );
  return hit?.name ?? raw;
});

const listed = computed(() => {
  const raw = current.value.trim();
  if (raw === '' || props.options.length === 0) return true;
  return props.options.some(
    (o) => o.value.toLowerCase() === raw.toLowerCase() || o.name.toLowerCase() === raw.toLowerCase(),
  );
});

/** 타이핑은 그대로 저장값이 된다 — 관리자가 적은 문구를 우리가 해석하지 않는다. */
function onInput(e: Event): void {
  open.value = true;
  emit('update:modelValue', (e.target as HTMLInputElement).value);
}
function pick(o: { value: string; name: string }): void {
  emit('update:modelValue', o.value);
  open.value = false;
}
function onBlur(e: FocusEvent): void {
  // 목록 항목을 누르는 중이면 닫지 않는다(click 이 blur 뒤에 온다).
  const next = e.relatedTarget as Node | null;
  if (next !== null && box.value?.contains(next) === true) return;
  open.value = false;
}
</script>

<template>
  <div ref="box" class="relative">
    <div class="flex items-center gap-1">
      <input
        :value="shown"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        class="min-w-0 flex-1 rounded-md border px-2 py-1 text-sm focus:outline-none disabled:bg-gray-50"
        :class="listed ? 'border-gray-300 focus:border-blue-500' : 'border-amber-300 bg-amber-50 focus:border-amber-500'"
        @input="onInput"
        @focus="open = true"
        @blur="onBlur"
      >
      <button
        v-if="options.length > 0"
        type="button"
        class="shrink-0 rounded-md border border-gray-200 px-1.5 py-1 text-[10px] text-gray-400 hover:bg-gray-50"
        :disabled="disabled"
        :aria-expanded="open"
        title="거버 선택지 보기"
        @mousedown.prevent="open = !open"
      >
        ▾
      </button>
    </div>

    <!-- 목록 밖 값이라는 사실만 알린다 — 고치라고 강요하지 않는다. -->
    <p v-if="!listed" class="mt-0.5 text-[10px] font-semibold text-amber-600">직접 입력</p>

    <ul
      v-if="open && options.length > 0"
      class="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-gray-200 bg-surface py-1 shadow-lg"
    >
      <li v-for="o in options" :key="o.value">
        <button
          type="button"
          class="flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm hover:bg-blue-50"
          :class="o.value.toLowerCase() === current.trim().toLowerCase() ? 'font-bold text-blue-700' : 'text-gray-700'"
          @click="pick(o)"
        >
          <span class="min-w-0 flex-1 truncate">{{ o.name }}</span>
          <span v-if="o.name !== o.value" class="shrink-0 font-mono text-[10px] text-gray-400">{{ o.value }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
