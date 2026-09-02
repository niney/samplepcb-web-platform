<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { DEV_REVIEW_DIAGRAM_WIDTH } from '@sp/utils';

// 시스템 구성도 뷰어 — 기본은 컨테이너 폭에 맞춘 축소 미리보기(scale-to-fit, 스크롤 없음),
// 클릭하면 모달에서 원본 크기 전체보기. 위저드 검토서 미리보기·프로젝트 상세가 공유한다.
//
// 입력 HTML 은 @sp/utils renderDevReviewDiagramHtml 이 만든 **결정적 SVG** 하나뿐이다
// (스크립트·외부 리소스 없음, CSP meta 내장). LLM 이 HTML 을 직접 뱉던 시절의 클라이언트
// 살균(lib/diagram-srcdoc.ts)은 그래서 사라졌고, iframe 은 `sandbox=""`(전 권한 차단)로
// 더 좁게 잠근다 — 스크립트·동일 출처·폼·이동 전부 금지.
//
// 크기: sandbox="" 는 contentDocument 접근을 막아 DOM 실측이 불가능하다. 대신 우리
// 렌더러가 항상 `<svg … width="W" height="H">` 를 내므로 문자열에서 그 값을 읽는다
// (같은 입력 → 같은 출력이라 신뢰 가능). 실패 시 설계 캔버스 기본값으로 폴백.
//
// 레이아웃: scale 은 시각 축소일 뿐 레이아웃 크기는 원본 그대로라, iframe 을 absolute 로
// 띄워 레이아웃 기여를 0 으로 만든다(안 그러면 grid min-content 가 1400px 로 밀려
// 부모 카드를 뚫는다 — 실측 버그).

const props = defineProps<{ html: string }>();

// 렌더러의 설계 캔버스(svg width 1200) — 크기 파싱 실패 시 폴백.
const BASE_W = DEV_REVIEW_DIAGRAM_WIDTH;
const BASE_H = 420;

const svgSize = computed<{ w: number; h: number }>(() => {
  const m = /<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(props.html);
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  return {
    w: Number.isFinite(w) && w > 0 ? w : BASE_W,
    h: Number.isFinite(h) && h > 0 ? h : BASE_H,
  };
});

const wrap = ref<HTMLDivElement | null>(null);
const wrapW = ref(0);
const open = ref(false);

const contentW = computed(() => svgSize.value.w);
const contentH = computed(() => svgSize.value.h);
const scale = computed(() => Math.min(1, (wrapW.value > 0 ? wrapW.value : BASE_W) / contentW.value));
const previewH = computed(() => Math.round(contentH.value * scale.value));

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
      aria-label="제안 시스템 구성도 크게 보기"
      class="group relative w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper-500"
      :style="{ height: `${String(previewH)}px` }"
      @click="open = true"
      @keydown.enter="open = true"
    >
      <iframe
        sandbox=""
        :srcdoc="html"
        title="제안 시스템 구성도 미리보기"
        class="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
        :style="{
          width: `${String(contentW)}px`,
          height: `${String(contentH)}px`,
          transform: `scale(${String(scale)})`,
        }"
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
              제안 시스템 구성도 <span class="font-normal text-tx-3">(AI 사전 검토서)</span>
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
              sandbox=""
              :srcdoc="html"
              title="제안 시스템 구성도 전체보기"
              class="pointer-events-none block border-0"
              :style="{ width: `${String(contentW)}px`, height: `${String(contentH)}px` }"
            />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
