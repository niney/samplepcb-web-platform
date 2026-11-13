<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { DECK } from '../lib/deck-layout';
import { errorMessage } from '../lib/error-msg';
import DeckBook from '../components/deck/DeckBook.vue';

// 의뢰 출력물('출력하기') — 16:9 장(슬라이드) 판(2026-11-12, 사용자 결정 — docs/DEVELOP_FLOW.md §7.2.10).
// 그 전(10-22~11-06)은 상세 화면 컴포넌트를 한 줄기로 그려 PPT 4:3 쪽 경계에서 밀어내는 방식이었다. 지금은 장이 먼저다 —
// 장을 만들고 배분하고 그리는 일은 DeckBook 이 하고(의뢰 상세의 탭도 같은 장을 쓴다), 이 화면은 틀만 맡는다:
// 로그인 · 불러오기 · 인쇄 버튼 · 용지. 브라우저 인쇄만(견적서 인쇄 D12 관례) — 쪽 = 장(1280×720px = 13.333×7.5in).
// 셸이 없는 라우트(meta.bare)다.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);

// 용지 = 장 크기 그대로(1280×720px = 13.333×7.5in), 여백 0 — 장이 제 여백을 갖는다. @page 는 문서 전역이라 들어올 때 붙이고 나갈 때 뗀다
// (견적서 인쇄는 A4 세로 그대로). 화면은 창 폭에 맞춰 장 묶음을 줄여 보인다(인쇄는 1 — style.css).
let pageStyle: HTMLStyleElement | null = null;
const screenZoom = ref(1);
function updateZoom(): void {
  screenZoom.value = Math.min(1, Math.max(0.3, (window.innerWidth - 48) / DECK.width));
}
onMounted(() => {
  pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${String(DECK.width)}px ${String(DECK.height)}px; margin: 0; }`;
  document.head.appendChild(pageStyle);
  updateZoom();
  window.addEventListener('resize', updateZoom);
});
onBeforeUnmount(() => {
  pageStyle?.remove();
  window.removeEventListener('resize', updateZoom);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}
</script>

<template>
  <main class="min-h-screen bg-paper py-8 print:min-h-0 print:bg-white print:py-0">
    <div v-if="!loggedIn" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">의뢰 출력물은 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white" @click="goLogin">로그인</button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div v-else-if="detailQ.isError.value || detail === undefined" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body font-semibold text-red-700">{{ errorMessage(detailQ.error.value, '의뢰를 불러오지 못했습니다.') }}</p>
      <RouterLink
        :to="`/requests/${String(requestId ?? 0)}`"
        class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2"
      >
        의뢰 상세로
      </RouterLink>
    </div>

    <template v-else>
      <!-- 인쇄 버튼(종이에는 안 나온다) -->
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[1280px] flex-wrap items-center gap-2.5 px-6">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <p class="text-label text-tx-3">16:9(13.33×7.5인치) 장으로 인쇄됩니다. 'PDF로 저장'을 고르시면 파일로 받으실 수 있습니다.</p>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <DeckBook :detail="detail" mode="print" :zoom="screenZoom" />
    </template>
  </main>
</template>
