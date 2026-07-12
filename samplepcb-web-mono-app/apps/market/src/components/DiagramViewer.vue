<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

// AI 구성도 뷰어 — 기본은 컨테이너 폭에 맞춘 축소 미리보기(scale-to-fit, 스크롤 없음),
// 클릭하면 모달에서 원본 크기 전체보기. 위저드 미리보기·프로젝트 상세가 공유한다.
// LLM 산출 HTML 이므로 iframe 은 항상 sandbox=""(스크립트 차단) — blob/새 탭 전체보기는
// sandbox 가 풀려 금지. 구성도는 SVG 기반이라 scale 축소가 벡터로 깨끗하다.

defineProps<{ html: string }>();

// 프롬프트가 강제하는 설계 캔버스(svg viewBox 1400×1000) — 축소 비율·미리보기 높이 기준.
// 실제 결과가 더 길면 미리보기 하단이 잘릴 수 있으나(파악용) 전체보기가 보완한다.
const BASE_W = 1400;
const BASE_H = 1000;

const wrap = ref<HTMLDivElement | null>(null);
const scale = ref(0.5);
const open = ref(false);

let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    const w = wrap.value?.clientWidth ?? BASE_W;
    scale.value = Math.min(1, w / BASE_W);
  });
  if (wrap.value !== null) ro.observe(wrap.value);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener('keydown', onKey);
});

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div>
    <!-- 축소 미리보기 — iframe 은 pointer-events 차단(클릭·휠이 내부로 새지 않게) -->
    <div
      ref="wrap"
      role="button"
      tabindex="0"
      aria-label="시스템 구성도 크게 보기"
      class="group relative cursor-zoom-in overflow-hidden rounded-xl border border-line bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
      :style="{ height: `${String(Math.round(BASE_H * scale))}px` }"
      @click="open = true"
      @keydown.enter="open = true"
    >
      <iframe
        sandbox=""
        :srcdoc="html"
        title="시스템 구성도 미리보기"
        class="pointer-events-none origin-top-left border-0"
        :style="{ width: `${String(BASE_W)}px`, height: `${String(BASE_H)}px`, transform: `scale(${String(scale)})` }"
      />
      <div
        class="absolute inset-0 flex items-end justify-end bg-transparent p-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span class="rounded-lg bg-ink-900/80 px-3 py-1.5 text-xs font-bold text-white">🔍 크게 보기</span>
      </div>
    </div>

    <!-- 전체보기 모달 — 원본 크기, 모달 안에서만 스크롤. ESC·배경·닫기로 닫힘 -->
    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
        @click.self="open = false"
      >
        <div class="flex h-[92vh] w-[min(96vw,1520px)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p class="text-sm font-extrabold text-tx-1">
              시스템 구성도 <span class="font-normal text-tx-3">(AI 자동 생성 초안)</span>
            </p>
            <button
              type="button"
              class="rounded-lg border border-line px-3 py-1 text-xs font-bold text-tx-2 hover:border-line-2"
              @click="open = false"
            >
              닫기 ✕
            </button>
          </div>
          <div class="flex-1 overflow-auto">
            <iframe
              sandbox=""
              :srcdoc="html"
              title="시스템 구성도 전체보기"
              class="block h-[1600px] w-[1400px] border-0"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
