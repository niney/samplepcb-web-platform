<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { BomQuotePrintType } from '@sp/api-contract';
import BomEstimateSheet from './BomEstimateSheet.vue';

// BOM 견적서 레이어 팝업(§6.8) — 거버 EstimateModal 동형(body Teleport + window.print
// + 인쇄 전역 스타일 주입/제거). 데이터는 콜백 주입 — 관리자·고객이 각자 API 를 연결한다.

const props = defineProps<{
  open: boolean;
  load: () => Promise<BomQuotePrintType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomQuotePrintType | null>(null);
const loading = ref(false);
const error = ref('');
const includeImages = ref(true);
const printing = ref(false);
const sheetHost = ref<HTMLElement | null>(null);
const hasImages = computed(() => data.value?.items.some((item) => item.imageUrl !== null) ?? false);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    error.value = '';
    data.value = null;
    includeImages.value = true;
    printing.value = false;
    try {
      data.value = await props.load();
    } catch (e) {
      error.value = e instanceof ApiRequestError ? e.message : '견적서를 불러오지 못했습니다.';
    } finally {
      loading.value = false;
    }
  },
);

async function waitForEstimateImages(): Promise<void> {
  await nextTick();
  const images = sheetHost.value === null
    ? []
    : [...sheetHost.value.querySelectorAll<HTMLImageElement>('[data-estimate-part-image]')];
  await Promise.all(images.map(async (image) => {
    if (image.complete) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        image.removeEventListener('load', finish);
        image.removeEventListener('error', finish);
        resolve();
      };
      const timeoutId = window.setTimeout(finish, 2_500);
      image.addEventListener('load', finish, { once: true });
      image.addEventListener('error', finish, { once: true });
    });
  }));
}

const onPrint = async (): Promise<void> => {
  if (data.value === null || printing.value) return;
  printing.value = true;
  try {
    if (includeImages.value) await waitForEstimateImages();
    window.print();
  } finally {
    printing.value = false;
  }
};
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};

// 인쇄 전역 스타일 — EstimateModal 관례: body 자식 전부 숨기고 시트 호스트만 남긴다.
// SFC <style> 은 언마운트 후에도 남으므로 head 직접 주입/제거(수명 = 모달 마운트).
const PRINT_STYLE_ID = 'sp-bom-estimate-print-style';
const PRINT_CSS = `
@media print {
  body > :not(.sp-bom-estimate-host) { display: none !important; }
  .sp-bom-estimate-host {
    position: static !important;
    overflow: visible !important;
    background: none !important;
    display: block !important;
  }
  .sp-bom-estimate-scroll {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }
  .sp-bom-estimate-host .no-print { display: none !important; }
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
    <div v-if="open" class="sp-bom-estimate-host fixed inset-0 z-[60]">
      <div class="no-print absolute inset-0 bg-black/40" @click="emit('close')" />
      <div
        class="sp-bom-estimate-scroll relative flex h-full flex-col items-center overflow-auto p-6"
        @click.self="emit('close')"
      >
        <div class="no-print mb-4 flex flex-wrap items-center justify-center gap-2">
          <label
            v-if="hasImages"
            class="flex cursor-pointer items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow"
          >
            <input v-model="includeImages" type="checkbox" class="size-4 rounded border-gray-300 text-blue-600">
            부품 이미지 포함
          </label>
          <button
            type="button"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
            :disabled="data === null || printing"
            @click="onPrint"
          >
            {{ printing ? '인쇄 준비 중…' : '인쇄' }}
          </button>
          <button
            type="button"
            class="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100"
            @click="emit('close')"
          >
            닫기
          </button>
        </div>

        <p v-if="loading" class="no-print py-12 text-sm text-white">불러오는 중…</p>
        <p v-else-if="error !== ''" class="no-print py-12 text-sm font-semibold text-red-300">{{ error }}</p>
        <div v-else-if="data !== null" ref="sheetHost" class="shadow-2xl" @click.stop>
          <BomEstimateSheet :data="data" :show-images="includeImages" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
