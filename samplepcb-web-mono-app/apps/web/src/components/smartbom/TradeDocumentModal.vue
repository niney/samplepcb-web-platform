<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BomTradeDocumentType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import TradeDocumentSheet from './TradeDocumentSheet.vue';

const props = defineProps<{
  open: boolean;
  label: string;
  load: () => Promise<BomTradeDocumentType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomTradeDocumentType | null>(null);
const loading = ref(false);
const error = ref('');
const dialogEl = ref<HTMLElement | null>(null);
const closeButtonEl = ref<HTMLButtonElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let loadVersion = 0;

async function loadDocument(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const loaded = await props.load();
    if (version === loadVersion) data.value = loaded;
  } catch (cause) {
    if (version !== loadVersion) return;
    error.value =
      cause instanceof ApiRequestError ? cause.message : '거래 문서를 불러오지 못했습니다.';
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  const dialog = dialogEl.value;
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function restorePageFocus(): void {
  document.body.style.overflow = previousBodyOverflow;
  const target = previousFocus;
  previousFocus = null;
  void nextTick(() => target?.focus());
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      loadVersion += 1;
      if (previousFocus !== null) restorePageFocus();
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    await nextTick();
    closeButtonEl.value?.focus();
    await loadDocument();
  },
  { immediate: true },
);

const onKeydown = (event: KeyboardEvent): void => {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = dialogEl.value;
  if (dialog === null) return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};
const onPrint = (): void => {
  window.print();
};
const moveDocument = (direction: -1 | 1): void => {
  scrollEl.value?.scrollBy({ left: direction * 280, behavior: 'smooth' });
};
const PRINT_STYLE_ID = 'sp-bom-trade-document-print-style';
const PRINT_STYLE_USERS = 'tradeDocumentUsers';
const PRINT_CSS = `
@media print {
  body > :not(.sp-bom-trade-document-host) { display: none !important; }
  .sp-bom-trade-document-host { position: static !important; display: block !important; background: none !important; }
  .sp-bom-trade-document-shell { height: auto !important; padding: 0 !important; display: block !important; }
  .sp-bom-trade-document-scroll { position: static !important; overflow: visible !important; height: auto !important; padding: 0 !important; display: block !important; }
  .sp-bom-trade-document-host .no-print { display: none !important; }
  @page { size: A4; margin: 0; }
}`;

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  const existingStyle = document.getElementById(PRINT_STYLE_ID);
  if (existingStyle === null) {
    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = PRINT_CSS;
    style.dataset[PRINT_STYLE_USERS] = '1';
    document.head.appendChild(style);
  } else {
    const users = Number(existingStyle.dataset[PRINT_STYLE_USERS] ?? '0');
    existingStyle.dataset[PRINT_STYLE_USERS] = String(users + 1);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  loadVersion += 1;
  if (previousFocus !== null) restorePageFocus();
  const style = document.getElementById(PRINT_STYLE_ID);
  if (style === null) return;
  const users = Math.max(0, Number(style.dataset[PRINT_STYLE_USERS] ?? '1') - 1);
  if (users === 0) style.remove();
  else style.dataset[PRINT_STYLE_USERS] = String(users);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="dialogEl"
      class="sp-bom-trade-document-host fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      tabindex="-1"
    >
      <div class="no-print absolute inset-0 bg-black/40" @click="emit('close')" />
      <div
        class="sp-bom-trade-document-shell relative flex h-full min-h-0 flex-col p-3 sm:p-6"
        @click.self="emit('close')"
      >
        <div class="no-print mb-3 flex shrink-0 justify-center gap-2 sm:mb-4">
          <button
            type="button"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 disabled:opacity-40"
            :disabled="data === null"
            @click="onPrint"
          >
            인쇄
          </button>
          <button
            ref="closeButtonEl"
            type="button"
            class="rounded-md bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow hover:bg-gray-100"
            @click="emit('close')"
          >
            닫기
          </button>
        </div>

        <div
          v-if="data !== null"
          class="no-print mb-2 flex shrink-0 items-center gap-2 rounded-lg bg-black/55 px-2 py-1.5 text-xs font-medium text-white min-[840px]:hidden"
        >
          <span class="min-w-0 flex-1">좌우로 이동해 거래 문서 전체를 확인하세요.</span>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded border border-white/40 bg-white/15 text-base hover:bg-white/25"
            aria-label="거래 문서 왼쪽으로 이동"
            @click="moveDocument(-1)"
          >
            ←
          </button>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded border border-white/40 bg-white/15 text-base hover:bg-white/25"
            aria-label="거래 문서 오른쪽으로 이동"
            @click="moveDocument(1)"
          >
            →
          </button>
        </div>

        <div
          ref="scrollEl"
          data-trade-document-scroll
          class="sp-bom-trade-document-scroll min-h-0 flex-1 overflow-auto"
          @click.self="emit('close')"
        >
          <p v-if="loading" role="status" class="no-print py-12 text-center text-sm text-white">
            불러오는 중…
          </p>
          <div v-else-if="error !== ''" class="no-print py-12 text-center">
            <p role="alert" class="text-sm font-bold text-red-200">{{ error }}</p>
            <button
              type="button"
              class="mt-3 rounded-md bg-white px-3 py-2 text-sm font-bold text-gray-700 shadow hover:bg-gray-100"
              @click="loadDocument"
            >
              다시 시도
            </button>
          </div>
          <div v-else-if="data !== null" class="w-max shadow-2xl min-[840px]:mx-auto" @click.stop>
            <TradeDocumentSheet :data="data" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
