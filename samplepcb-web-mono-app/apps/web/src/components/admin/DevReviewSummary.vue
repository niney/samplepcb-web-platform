<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEV_REVIEW_DISCLAIMER, MARKET_SERVICE_AREA_LABELS } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { DEV_REVIEW_DIAGRAM_WIDTH, buildDevReviewView, renderDevReviewDiagramHtml } from '@sp/utils';
import { formatDateTime } from '../../lib/format';

// AI 사전 검토서 축약 렌더(관리자 전용, v2). 고객·전문가 화면(apps/market DevReviewView)은
// 전 섹션을 보여주지만 관리자에게 필요한 것은 운영 판단 재료뿐이라 배지·요약·핵심 요구(근거
// 포함)·분야별 한 줄·명세 행(근거 포함)·전문가와 상의할 항목·구성도·원본 JSON 으로 좁힌다
// (docs/AI_DEV_REVIEW.md §12 — Vue 공유 패키지가 없어 축약 사본이다). 근거 인용은 관리자만 본다.
// 구성도는 renderDevReviewDiagramHtml 의 결정적 SVG 를 sandbox iframe srcdoc 으로만 넣는다.
// LLM 산출 문자열은 어디에서도 v-html 로 흘리지 않는다.

const props = defineProps<{ review: MarketDevReviewType; title?: string }>();
const { t } = useI18n();

const view = computed(() => buildDevReviewView(props.review));
const diagramSrcdoc = computed(() =>
  renderDevReviewDiagramHtml(props.review.diagram, {
    title: props.title ?? '',
    meta: `검토안 V1 · ${props.review.meta.model} · ${formatDateTime(props.review.meta.generatedAt)}`,
  }),
);

// 구성도 크기 — sandbox="" 는 contentDocument 접근을 막아 DOM 실측이 불가능하다. 대신
// 렌더러가 항상 `<svg … width="W" height="H">` 를 내므로 문자열에서 읽는다(결정적 SVG라
// 같은 입력 → 같은 출력). 실패 시 설계 캔버스 기본값으로 폴백.
// scale 은 시각 축소일 뿐 레이아웃 크기는 원본 그대로라, iframe 을 absolute 로 띄워 레이아웃
// 기여를 0 으로 만든다 — 안 그러면 좁은 드로어에서 카드를 뚫는다(apps/market DiagramViewer 동형).
const BASE_W = DEV_REVIEW_DIAGRAM_WIDTH;
const BASE_H = 420;

const svgSize = computed<{ w: number; h: number }>(() => {
  const matched = /<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(diagramSrcdoc.value);
  const w = Number(matched?.[1]);
  const h = Number(matched?.[2]);
  return {
    w: Number.isFinite(w) && w > 0 ? w : BASE_W,
    h: Number.isFinite(h) && h > 0 ? h : BASE_H,
  };
});

const wrap = ref<HTMLDivElement | null>(null);
const wrapW = ref(0);
const scale = computed(() =>
  Math.min(1, (wrapW.value > 0 ? wrapW.value : BASE_W) / svgSize.value.w),
);
const previewH = computed(() => Math.round(svgSize.value.h * scale.value));

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    wrapW.value = wrap.value?.clientWidth ?? 0;
  });
  if (wrap.value !== null) resizeObserver.observe(wrap.value);
});

// 전체보기 모달 — 축소본으로는 못 읽는 라벨을 원본 크기로 확인한다(마켓 DiagramViewer 동형).
const zoomed = ref(false);
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') zoomed.value = false;
}
watch(zoomed, (open) => {
  if (open) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('keydown', onKey);
});

const reviewJson = computed(() => JSON.stringify(props.review, null, 2));
// 서버 ISO(UTC)를 업무 기준 KST 로 — 관리자 화면 공용 포맷터(lib/format.ts) 사용.
const generatedAt = computed(() => formatDateTime(props.review.meta.generatedAt));
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
        {{ t('admin.devReview.facts', { count: view.factCount }) }}
      </span>
      <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
        {{ t('admin.devReview.openQuestionsCount', { count: view.openQuestions.length }) }}
      </span>
      <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
        {{ view.areaBadge }}
      </span>
      <span class="ml-auto font-mono text-[10px] text-gray-400">
        {{
          t('admin.devReview.meta', {
            model: props.review.meta.model,
            promptVersion: props.review.meta.promptVersion,
            generatedAt: generatedAt,
          })
        }}
      </span>
    </div>

    <p class="text-[11px] text-gray-500">{{ DEV_REVIEW_DISCLAIMER }}</p>

    <p v-if="props.review.summary !== ''" class="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
      {{ props.review.summary }}
    </p>

    <!-- 핵심 요구(근거 포함) -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.requirements') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="(item, index) in props.review.requirements"
          :key="index"
          class="rounded-lg border border-gray-100 px-3 py-1.5 text-xs text-gray-800"
        >
          {{ item.text }}
          <span v-if="item.evidence !== null" class="mt-0.5 block text-[11px] text-gray-400">
            {{ t('admin.devReview.evidence') }}: {{ item.evidence }}
          </span>
        </li>
        <li v-if="props.review.requirements.length === 0" class="text-xs text-gray-400">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <!-- 분야별 한 줄 + 명세 행(근거 포함) -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.areas') }}</p>
      <div class="mt-1.5 grid gap-1.5">
        <div v-for="area in props.review.areas" :key="area.area" class="rounded-lg border border-gray-100 px-3 py-2">
          <p class="text-xs font-bold text-gray-700">
            {{ MARKET_SERVICE_AREA_LABELS[area.area] }}
            <span class="ml-1 font-normal text-gray-500">{{ area.summary !== '' ? area.summary : t('admin.devReview.afterConsult') }}</span>
          </p>
          <ul v-if="area.spec.length > 0" class="mt-1.5 grid gap-1">
            <li v-for="(row, index) in area.spec" :key="index" class="text-[11px] text-gray-700">
              <b>{{ row.item }}</b> — {{ row.text }}
              <span v-if="row.evidence !== null" class="block text-[11px] text-gray-400">
                {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
              </span>
            </li>
          </ul>
          <ul v-if="area.observations.length > 0" class="mt-1.5 grid gap-1 border-t border-gray-100 pt-1.5">
            <li v-for="(o, index) in area.observations" :key="index" class="text-[11px] text-gray-600">
              › {{ o.text }}
              <span v-if="o.evidence !== null" class="block text-[11px] text-gray-400">
                {{ t('admin.devReview.evidence') }}: {{ o.evidence }}
              </span>
            </li>
          </ul>
        </div>
      </div>
      <ul v-if="props.review.checks.length > 0" class="mt-1.5 grid gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <li v-for="c in props.review.checks" :key="c.code" class="text-[11px] text-amber-900">
          {{ t('admin.devReview.check') }}: {{ c.text }}
        </li>
      </ul>
    </div>

    <!-- 전문가와 상의할 항목 -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.openQuestions') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="(q, index) in view.openQuestions"
          :key="index"
          class="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-1.5 text-xs text-gray-700"
        >
          <span class="block">{{ q.question }}</span>
          <span v-if="q.why !== ''" class="mt-0.5 block text-[11px] text-gray-500">
            {{ t('admin.devReview.why') }}: {{ q.why }}
          </span>
        </li>
        <li v-if="view.openQuestions.length === 0" class="text-xs text-gray-400">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <!-- 구성도 — 결정적 SVG(외부 리소스·스크립트 없음)를 sandbox iframe 으로만.
         래퍼 폭에 맞춰 축소해 스크롤 없이 전체가 보이고, 클릭하면 원본 크기 모달로 연다. -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.diagram') }}</p>
      <div
        ref="wrap"
        role="button"
        tabindex="0"
        :aria-label="t('admin.devReview.diagramZoom')"
        class="group relative mt-1.5 w-full cursor-zoom-in overflow-hidden rounded-md border border-gray-200 bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        :style="{ height: `${String(previewH)}px` }"
        @click="zoomed = true"
        @keydown.enter="zoomed = true"
      >
        <iframe
          :srcdoc="diagramSrcdoc"
          sandbox=""
          class="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          :title="t('admin.devReview.diagramTitle')"
          :style="{
            width: `${String(svgSize.w)}px`,
            height: `${String(svgSize.h)}px`,
            transform: `scale(${String(scale)})`,
          }"
        />
        <div class="absolute inset-0 flex items-end justify-end p-2 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <span class="rounded-md bg-gray-900/80 px-2.5 py-1 text-[11px] font-bold text-white">
            🔍 {{ t('admin.devReview.diagramZoom') }}
          </span>
        </div>
      </div>
    </div>

    <!-- 전체보기 모달 — 원본 크기 렌더(넘칠 때만 스크롤), ESC·배경 클릭으로 닫힘 -->
    <Teleport to="body">
      <div
        v-if="zoomed"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6"
        @click.self="zoomed = false"
      >
        <div class="flex max-h-[94vh] w-fit max-w-[96vw] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <div class="flex items-center justify-between gap-6 border-b border-gray-200 px-4 py-2.5">
            <p class="text-sm font-bold text-gray-800">{{ t('admin.devReview.diagramTitle') }}</p>
            <button
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
              @click="zoomed = false"
            >
              {{ t('admin.devReview.close') }} ✕
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <iframe
              :srcdoc="diagramSrcdoc"
              sandbox=""
              class="pointer-events-none block border-0"
              :title="t('admin.devReview.diagramFull')"
              :style="{ width: `${String(svgSize.w)}px`, height: `${String(svgSize.h)}px` }"
            />
          </div>
        </div>
      </div>
    </Teleport>

    <details>
      <summary class="cursor-pointer text-xs font-medium text-gray-600">
        {{ t('admin.devReview.json') }}
      </summary>
      <pre class="mt-2 max-h-[430px] overflow-auto whitespace-pre-wrap rounded-md bg-gray-900 p-3 text-[11px] text-gray-100">{{ reviewJson }}</pre>
    </details>
  </div>
</template>
