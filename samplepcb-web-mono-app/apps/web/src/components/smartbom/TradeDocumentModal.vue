<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BomTradeDocumentType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import TradeDocumentSheet from './TradeDocumentSheet.vue';

const props = defineProps<{
  open: boolean;
  load: () => Promise<BomTradeDocumentType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomTradeDocumentType | null>(null);
const loading = ref(false);
const error = ref('');

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    error.value = '';
    data.value = null;
    try {
      data.value = await props.load();
    } catch (cause) {
      error.value =
        cause instanceof ApiRequestError ? cause.message : '거래 문서를 불러오지 못했습니다.';
    } finally {
      loading.value = false;
    }
  },
);

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close');
};
const onPrint = (): void => {
  window.print();
};
const PRINT_STYLE_ID = 'sp-bom-trade-document-print-style';
const PRINT_STYLE_USERS = 'tradeDocumentUsers';
const PRINT_CSS = `
@media print {
  body > :not(.sp-bom-trade-document-host) { display: none !important; }
  .sp-bom-trade-document-host { position: static !important; display: block !important; background: none !important; }
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
  const style = document.getElementById(PRINT_STYLE_ID);
  if (style === null) return;
  const users = Math.max(0, Number(style.dataset[PRINT_STYLE_USERS] ?? '1') - 1);
  if (users === 0) style.remove();
  else style.dataset[PRINT_STYLE_USERS] = String(users);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sp-bom-trade-document-host fixed inset-0 z-[70]">
      <div class="no-print absolute inset-0 bg-black/40" @click="emit('close')" />
      <div
        class="sp-bom-trade-document-scroll relative flex h-full flex-col items-center overflow-auto p-6"
        @click.self="emit('close')"
      >
        <div class="no-print mb-4 flex gap-2">
          <button
            type="button"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow hover:bg-blue-700 disabled:opacity-40"
            :disabled="data === null"
            @click="onPrint"
          >
            인쇄
          </button>
          <button
            type="button"
            class="rounded-md bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow hover:bg-gray-100"
            @click="emit('close')"
          >
            닫기
          </button>
        </div>
        <p v-if="loading" class="no-print py-12 text-sm text-white">불러오는 중…</p>
        <p v-else-if="error !== ''" class="no-print py-12 text-sm font-bold text-red-200">
          {{ error }}
        </p>
        <div v-else-if="data !== null" class="shadow-2xl" @click.stop>
          <TradeDocumentSheet :data="data" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
