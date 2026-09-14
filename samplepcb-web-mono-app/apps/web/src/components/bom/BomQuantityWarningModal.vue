<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ open: boolean; allMissing: boolean; count: number }>();
const emit = defineEmits<{ close: []; reupload: [] }>();
const { t } = useI18n();
const dialog = ref<HTMLDialogElement | null>(null);
const uploadButton = ref<HTMLButtonElement | null>(null);
let previousOverflow: string | null = null;

function unlockBody(): void {
  if (previousOverflow !== null) document.body.style.overflow = previousOverflow;
  previousOverflow = null;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return;
  const buttons = dialog.value?.querySelectorAll<HTMLButtonElement>('button');
  const first = buttons?.[0];
  const last = buttons?.[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

watch(() => props.open, async () => {
  await nextTick();
  if (props.open && dialog.value !== null && !dialog.value.open) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.value.showModal();
    uploadButton.value?.focus();
  } else if (!props.open) {
    dialog.value?.close();
    unlockBody();
  }
}, { immediate: true });

onBeforeUnmount(() => {
  dialog.value?.close();
  unlockBody();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/50"
      aria-labelledby="bom-quantity-warning-title"
      aria-describedby="bom-quantity-warning-description"
      @cancel.prevent="emit('close')"
      @keydown="onKeydown"
      @click.self="emit('close')"
    >
      <button type="button" class="absolute right-3 top-3 grid size-8 place-items-center rounded text-xl text-ink-muted hover:bg-surface-raised" :aria-label="t('bomQuantity.close')" @click="emit('close')">×</button>
      <h2 id="bom-quantity-warning-title" class="pr-7 text-lg font-bold leading-7">{{ t(allMissing ? 'bomQuantity.allMissing' : 'bomQuantity.someMissing', { count }) }}</h2>
      <div id="bom-quantity-warning-description" class="mt-3 space-y-3 text-sm leading-6 text-ink-muted">
        <p>{{ t('bomQuantity.description') }}</p>
        <p class="rounded-lg bg-surface-raised p-3 text-xs">{{ t('bomQuantity.ignoreDescription') }}</p>
      </div>
      <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold hover:bg-surface-raised" @click="emit('close')">{{ t('bomQuantity.ignore') }}</button>
        <button ref="uploadButton" type="button" class="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong" @click="emit('reupload')">{{ t('bomQuantity.reupload') }}</button>
      </div>
    </dialog>
  </Teleport>
</template>
