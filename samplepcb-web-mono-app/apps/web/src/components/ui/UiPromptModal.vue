<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// 값을 받아야 하는 확인창 — window.prompt 를 대신한다.
//
// prompt 는 화면 밖 장치라 여러 값을 물으려면 창을 연달아 띄워야 하고(두 번째에서 취소하면
// 첫 입력이 그대로 사라진다), 줄바꿈·형식 검증·되돌리기가 전부 불가능하며, 브라우저의
// "추가 대화상자 표시 안 함"을 한 번 체크하면 기능 자체가 막힌다. 필드를 한 화면에 모아
// 받고 필수값이 채워질 때까지 확인 버튼을 잠근다.

export interface PromptField {
  name: string;
  label: string;
  /** text=한 줄 · textarea=여러 줄(대외 문구) · date=YYYY-MM-DD */
  type?: 'text' | 'textarea' | 'date';
  required?: boolean;
  placeholder?: string;
  /** 필드 아래 회색 보조 설명 */
  hint?: string;
  value?: string;
  maxlength?: number;
}

const props = withDefaults(
  defineProps<{
    /** null 이면 닫힘. 열 때마다 초깃값으로 되돌린다. */
    title: string | null;
    fields: PromptField[];
    description?: string;
    confirmLabel?: string;
    /** danger 면 확인 버튼이 붉게 — 되돌리기 어려운 조작에. */
    tone?: 'default' | 'danger';
    busy?: boolean;
  }>(),
  { description: '', confirmLabel: '확인', tone: 'default', busy: false },
);
const emit = defineEmits<{ close: []; confirm: [values: Record<string, string>] }>();

const values = ref<Record<string, string>>({});
const firstInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

watch(
  () => props.title,
  (title) => {
    if (title === null) return;
    values.value = Object.fromEntries(props.fields.map((f) => [f.name, f.value ?? '']));
    void nextTick(() => firstInput.value?.focus());
  },
  { immediate: true },
);

const canConfirm = computed(() =>
  props.fields.every((f) => f.required !== true || (values.value[f.name] ?? '').trim() !== ''),
);

const submit = (): void => {
  if (!canConfirm.value || props.busy) return;
  emit(
    'confirm',
    Object.fromEntries(props.fields.map((f) => [f.name, (values.value[f.name] ?? '').trim()])),
  );
};

const onKeydown = (e: KeyboardEvent): void => {
  if (props.title === null) return;
  if (e.key === 'Escape') emit('close');
  // 여러 줄 입력 중에는 Enter 가 줄바꿈이어야 한다 — 확인은 Ctrl/⌘+Enter.
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
};
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
      v-if="title !== null"
      class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl" role="dialog" aria-modal="true">
        <div class="flex items-start justify-between gap-3">
          <h2 class="text-base font-bold text-gray-800">{{ title }}</h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
        </div>
        <p v-if="description !== ''" class="mt-1.5 text-xs leading-5 text-gray-500">{{ description }}</p>

        <div class="mt-3 grid gap-3">
          <label v-for="(f, i) in fields" :key="f.name" class="block">
            <span class="text-xs font-semibold text-gray-500">
              {{ f.label }}<span v-if="f.required === true" class="text-red-500"> *</span>
            </span>
            <textarea
              v-if="f.type === 'textarea'"
              :ref="i === 0 ? ((el) => { firstInput = el as HTMLTextAreaElement }) : undefined"
              v-model="values[f.name]"
              rows="3"
              :maxlength="f.maxlength ?? 2000"
              :placeholder="f.placeholder"
              class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
            <input
              v-else
              :ref="i === 0 ? ((el) => { firstInput = el as HTMLInputElement }) : undefined"
              v-model="values[f.name]"
              :type="f.type === 'date' ? 'date' : 'text'"
              :maxlength="f.maxlength ?? 200"
              :placeholder="f.placeholder"
              class="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
            >
            <span v-if="f.hint !== undefined" class="mt-1 block text-[11px] text-gray-400">{{ f.hint }}</span>
          </label>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
            @click="emit('close')"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            :class="tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'"
            :disabled="!canConfirm || busy"
            @click="submit"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
