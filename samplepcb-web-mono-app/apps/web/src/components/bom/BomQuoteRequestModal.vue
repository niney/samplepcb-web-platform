<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  open: boolean;
  initialTitle: string;
  submitting: boolean;
  error: string;
  done: boolean;
  requestDescription?: string;
  doneDescription?: string;
}>(), {
  requestDescription: '요청 후에는 내용이 동결되고 담당자가 확정 견적으로 회신합니다.',
  doneDescription: '담당자가 검토 후 확정 견적으로 회신합니다. 진행 상태는 요청한 견적에서 확인할 수 있습니다.',
});

const emit = defineEmits<{
  close: [];
  submit: [title: string];
  clearError: [];
}>();

const dialog = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const donePanel = ref<HTMLElement | null>(null);
const errorPanel = ref<HTMLParagraphElement | null>(null);
const title = ref('');
const localError = ref('');
const visibleError = computed(() => localError.value === '' ? props.error : localError.value);
let triggerElement: HTMLElement | null = null;
let bodyOverflow: string | null = null;

async function focusCurrentPanel(): Promise<void> {
  await nextTick();
  if (props.done) {
    donePanel.value?.focus();
    return;
  }
  titleInput.value?.focus();
  titleInput.value?.select();
}

function unlockBody(restoreFocus: boolean): void {
  if (bodyOverflow !== null) document.body.style.overflow = bodyOverflow;
  bodyOverflow = null;
  const trigger = triggerElement;
  triggerElement = null;
  if (restoreFocus && trigger?.isConnected === true) {
    void nextTick(() => {
      trigger.focus();
    });
  }
}

watch(
  () => props.open,
  (open, wasOpen) => {
    if (open) {
      title.value = props.initialTitle;
      localError.value = '';
      triggerElement = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      void focusCurrentPanel();
      return;
    }
    if (wasOpen) unlockBody(true);
  },
);

watch(
  () => props.done,
  (done) => {
    if (props.open && done) void focusCurrentPanel();
  },
);

watch(
  () => props.error,
  (error) => {
    if (props.open && error !== '') {
      void nextTick(() => {
        errorPanel.value?.focus();
      });
    }
  },
);

onBeforeUnmount(() => {
  unlockBody(false);
});

function close(): void {
  if (!props.submitting) emit('close');
}

function clearError(): void {
  localError.value = '';
  if (props.error !== '') emit('clearError');
}

function submit(): void {
  if (props.submitting) return;
  const trimmed = title.value.trim();
  if (trimmed === '') {
    localError.value = '견적명을 입력해 주세요.';
    void nextTick(() => errorPanel.value?.focus());
    return;
  }
  clearError();
  emit('submit', trimmed);
}

function focusableElements(): HTMLElement[] {
  if (dialog.value === null) return [];
  return [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (!props.submitting) {
      event.preventDefault();
      event.stopPropagation();
      emit('close');
    }
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || dialog.value?.contains(active) !== true)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || dialog.value?.contains(active) !== true)) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="close"
    >
      <div
        ref="dialog"
        class="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl outline-none"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="done ? 'bom-request-done-title' : 'bom-request-title'"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <template v-if="done">
          <div ref="donePanel" class="outline-none" role="status" tabindex="-1">
            <h3 id="bom-request-done-title" class="text-base font-semibold text-gray-900">
              견적요청이 접수되었습니다
            </h3>
            <p class="mt-1 text-xs leading-5 text-gray-500">{{ doneDescription }}</p>
          </div>
          <div class="mt-4 flex flex-wrap items-center justify-end gap-2">
            <slot name="done-actions" />
          </div>
        </template>
        <template v-else>
          <h3 id="bom-request-title" class="text-base font-semibold text-gray-900">견적요청</h3>
          <p class="mt-1 text-xs text-gray-500">{{ requestDescription }}</p>
          <input
            ref="titleInput"
            v-model="title"
            type="text"
            placeholder="견적명"
            aria-label="견적명"
            class="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            @input="clearError"
            @keydown.enter.prevent="submit"
          >
          <p
            v-if="visibleError !== ''"
            ref="errorPanel"
            class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 outline-none"
            role="alert"
            tabindex="-1"
          >
            {{ visibleError }}
          </p>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50"
              :disabled="submitting"
              @click="close"
            >
              취소
            </button>
            <button
              type="button"
              class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50"
              :disabled="submitting"
              @click="submit"
            >
              {{ submitting ? '요청 중…' : '견적요청 보내기' }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
