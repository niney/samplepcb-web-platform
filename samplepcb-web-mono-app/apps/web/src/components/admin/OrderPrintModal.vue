<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminOrderPrint } from '../../admin/useAdminOrders';
import OrderPrintSheet from './OrderPrintSheet.vue';

// 주문서 인쇄 레이어 — 견적서 모달(EstimateModal)과 동일 구조. 부모가 v-if 로 마운트 제어라
// 인쇄 전역 스타일 주입/제거가 이 모달 수명과 맞는다.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const odIdRef = computed(() => props.odId);
const { data, isLoading } = useAdminOrderPrint(odIdRef);
const printData = computed(() => data.value?.data ?? null);

const onPrint = (): void => {
  window.print();
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};

// 인쇄 시 body 직속 다른 레이어(#app·상세 드로어 등)를 숨기고 주문서 호스트만 남긴다.
// 견적서와 클래스가 겹치지 않게 sp-order-print-* 로 분리한다.
const PRINT_STYLE_ID = 'sp-order-print-style';
const PRINT_CSS = `
@media print {
  body > :not(.sp-order-print-host) { display: none !important; }
  .sp-order-print-host {
    position: static !important;
    overflow: visible !important;
    background: none !important;
    display: block !important;
  }
  .sp-order-print-scroll {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }
  .sp-order-print-host .no-print { display: none !important; }
  @page { size: A4; margin: 0; }
}
`;

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  if (document.getElementById(PRINT_STYLE_ID) === null) {
    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.getElementById(PRINT_STYLE_ID)?.remove();
});
</script>

<template>
  <Teleport to="body">
    <div class="sp-order-print-host fixed inset-0 z-[60]">
      <div class="no-print absolute inset-0 bg-black/40" @click="emit('close')" />
      <div
        class="sp-order-print-scroll relative flex h-full flex-col items-center overflow-auto p-6"
        @click.self="emit('close')"
      >
        <div class="no-print mb-4 flex gap-2">
          <button
            type="button"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
            :disabled="printData === null"
            @click="onPrint"
          >
            {{ t('admin.orders.print.print') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100"
            @click="emit('close')"
          >
            {{ t('admin.orders.print.close') }}
          </button>
        </div>

        <p v-if="isLoading" class="no-print py-12 text-sm text-white">…</p>
        <div v-else-if="printData !== null" class="shadow-2xl" @click.stop>
          <OrderPrintSheet :data="printData" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
