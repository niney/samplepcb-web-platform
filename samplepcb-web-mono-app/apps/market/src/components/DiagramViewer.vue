<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildDiagramSrcdoc } from '../lib/diagram-srcdoc';

// AI 구성도 뷰어 — 기본은 컨테이너 폭에 맞춘 축소 미리보기(scale-to-fit, 스크롤 없음),
// 클릭하면 모달에서 원본 크기 전체보기. 위저드 미리보기·프로젝트 상세가 공유한다.
//
// 보안: LLM 산출 HTML 이므로 iframe 은 sandbox 필수. allow-same-origin 만 부여
// (allow-scripts 없음 → 스크립트 실행 자체가 불가)해 부모가 contentDocument 로 실제
// 콘텐츠 크기를 측정한다 — 측정값으로 미리보기 잘림·모달 빈 스크롤을 없앤다.
// blob/새 탭 전체보기는 sandbox 가 풀려 금지.
//
// 레이아웃: scale 은 시각 축소일 뿐 레이아웃 크기는 원본 그대로라, iframe 을 absolute 로
// 띄워 레이아웃 기여를 0 으로 만든다(안 그러면 grid min-content 가 1400px 로 밀려
// 부모 카드를 뚫는다 — 실측 버그).

const props = defineProps<{ html: string }>();
const sandboxedHtml = computed(() => buildDiagramSrcdoc(props.html));

// 프롬프트가 강제하는 설계 캔버스(svg viewBox 1400×1000) — 측정 실패 시 폴백.
const BASE_W = 1400;
const BASE_H = 1000;

const wrap = ref<HTMLDivElement | null>(null);
const wrapW = ref(0);
const contentW = ref(BASE_W);
const contentH = ref(BASE_H);
const open = ref(false);

const scale = computed(() => Math.min(1, (wrapW.value > 0 ? wrapW.value : BASE_W) / contentW.value));
const previewH = computed(() => Math.round(contentH.value * scale.value));

// srcdoc 로드 후 실제 콘텐츠 크기 측정 — sandbox 에 allow-same-origin 이 없으면
// contentDocument 가 null(불투명 출처)이라 폴백값으로 동작한다.
function onPreviewLoad(e: Event): void {
  const doc = (e.target as HTMLIFrameElement).contentDocument;
  const de = doc?.documentElement;
  if (de === undefined) return;
  contentW.value = Math.max(BASE_W, de.scrollWidth);
  contentH.value = Math.max(200, de.scrollHeight);
}

let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    wrapW.value = wrap.value?.clientWidth ?? 0;
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
    <!-- 축소 미리보기 — iframe 은 absolute(레이아웃 미기여) + pointer-events 차단 -->
    <div
      ref="wrap"
      role="button"
      tabindex="0"
      aria-label="시스템 구성도 크게 보기"
      class="group relative w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
      :style="{ height: `${String(previewH)}px` }"
      @click="open = true"
      @keydown.enter="open = true"
    >
      <iframe
        sandbox="allow-same-origin"
        :srcdoc="sandboxedHtml"
        title="시스템 구성도 미리보기"
        class="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
        :style="{
          width: `${String(contentW)}px`,
          height: `${String(contentH)}px`,
          transform: `scale(${String(scale)})`,
        }"
        @load="onPreviewLoad"
      />
      <div
        class="absolute inset-0 flex items-end justify-end bg-transparent p-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <span class="rounded-lg bg-ink-900/80 px-3 py-1.5 text-xs font-bold text-white">🔍 크게 보기</span>
      </div>
    </div>

    <!-- 전체보기 모달 — 콘텐츠 실측 크기로 렌더(빈 스크롤 없음), 넘칠 때만 스크롤 -->
    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
        @click.self="open = false"
      >
        <div class="flex max-h-[94vh] w-fit max-w-[96vw] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div class="flex items-center justify-between gap-6 border-b border-line px-4 py-2.5">
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
          <div class="min-h-0 flex-1 overflow-auto">
            <iframe
              sandbox="allow-same-origin"
              :srcdoc="sandboxedHtml"
              title="시스템 구성도 전체보기"
              class="pointer-events-none block border-0"
              :style="{ width: `${String(contentW)}px`, height: `${String(contentH)}px` }"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
