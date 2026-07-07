<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminEstimate } from '../../admin/useAdminQuotes';
import EstimateSheet from './EstimateSheet.vue';
import EstimateSendControl from './EstimateSendControl.vue';

// 견적서 레이어 팝업 — body 로 Teleport 한다. 부모가 v-if 로 마운트를 제어하므로
// (견적서 열릴 때만 마운트) 인쇄 전역 스타일 주입/제거가 이 모달의 수명과 정확히 맞는다.
const props = defineProps<{ projectId: number | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const projectIdRef = computed(() => props.projectId);
const { data, isLoading } = useAdminEstimate(projectIdRef);
const estimate = computed(() => data.value?.data ?? null);

const onPrint = (): void => {
  window.print();
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};

// 인쇄 전역 스타일 — 모달이 #app 밖(body)에 있으므로 인쇄 시 다른 body 자식
// (#app 은 물론 드로어 같은 Teleport 레이어까지)을 전부 숨기고 모달 호스트를 정상
// 문서 흐름으로 되돌린다. sheet 자체 패딩이 여백을 담당하므로
// @page margin:0 으로 브라우저 머리글/URL 을 원천 차단한다. SFC <style> 은 언마운트해도
// 남아(상시 적용되면 모달 없이 인쇄해도 #app 이 사라짐) head 에 직접 주입/제거한다.
const PRINT_STYLE_ID = 'sp-estimate-print-style';
const PRINT_CSS = `
@media print {
  /* #app 만 숨기면 부족하다 — 상세 드로어 등 다른 Teleport 레이어도 body 직속이라
     position:fixed 인 채 인쇄에 겹쳐 나온다(2026-07-04 실측). body 자식 전부 숨기고
     견적서 호스트만 남긴다. */
  body > :not(.sp-estimate-host) { display: none !important; }
  .sp-estimate-host {
    position: static !important;
    overflow: visible !important;
    background: none !important;
    display: block !important;
  }
  .sp-estimate-scroll {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }
  .sp-estimate-host .no-print { display: none !important; }
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
    <div class="sp-estimate-host fixed inset-0 z-[60]">
      <div class="no-print absolute inset-0 bg-black/40" @click="emit('close')" />
      <div
        class="sp-estimate-scroll relative flex h-full flex-col items-center overflow-auto p-6"
        @click.self="emit('close')"
      >
        <!-- 툴바 (인쇄 미포함) -->
        <div class="no-print mb-4 flex gap-2">
          <EstimateSendControl
            v-if="estimate !== null"
            :project-id="estimate.projectId"
            :default-email="estimate.applicant?.email ?? ''"
            :priced="estimate.amounts !== null"
          />
          <button
            type="button"
            class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
            :disabled="estimate === null"
            @click="onPrint"
          >
            {{ t('admin.quotes.estimate.print') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100"
            @click="emit('close')"
          >
            {{ t('admin.quotes.estimate.close') }}
          </button>
        </div>

        <p v-if="isLoading" class="no-print py-12 text-sm text-white">…</p>
        <div v-else-if="estimate !== null" class="shadow-2xl" @click.stop>
          <EstimateSheet :key="estimate.projectId" :estimate="estimate" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
