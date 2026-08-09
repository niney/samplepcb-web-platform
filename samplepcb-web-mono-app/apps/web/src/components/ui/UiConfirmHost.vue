<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { pendingConfirm, settleConfirm } from '../../lib/confirmDialog';

// confirmDialog() 요청을 그리는 단 하나의 호스트 — App 루트에 한 번만 둔다.
// Esc·배경 클릭은 취소, Enter 는 확인(포커스가 확인 버튼에 있어 키보드로도 그대로 흐른다).

const confirmBtn = ref<HTMLButtonElement | null>(null);
watch(pendingConfirm, (cur) => {
  if (cur !== null) void nextTick(() => confirmBtn.value?.focus());
});

const onKeydown = (e: KeyboardEvent): void => {
  if (pendingConfirm.value === null) return;
  if (e.key === 'Escape') settleConfirm(false);
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
      v-if="pendingConfirm !== null"
      class="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4"
      @click.self="settleConfirm(false)"
    >
      <div
        class="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
        role="alertdialog"
        aria-modal="true"
      >
        <h2 v-if="pendingConfirm.title !== undefined" class="text-base font-bold text-gray-800">
          {{ pendingConfirm.title }}
        </h2>
        <p
          class="whitespace-pre-line text-sm leading-6 text-gray-700"
          :class="pendingConfirm.title === undefined ? '' : 'mt-1.5'"
        >
          {{ pendingConfirm.message }}
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
            @click="settleConfirm(false)"
          >
            {{ pendingConfirm.cancelLabel ?? '취소' }}
          </button>
          <button
            ref="confirmBtn"
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-bold text-white"
            :class="pendingConfirm.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'"
            @click="settleConfirm(true)"
          >
            {{ pendingConfirm.confirmLabel ?? '확인' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
