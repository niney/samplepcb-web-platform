<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { DEV_DIAGRAM_DISCLAIMER, MARKET_DEV_DIAGRAM_STATUS_LABELS } from '@sp/api-contract';
import type { MarketDevDiagramViewType } from '@sp/api-contract';

// 정밀 시스템 구성도 섹션(docs/AI_DEV_REVIEW.md §13.5·§13.9) — 등록 뒤 비동기로 만들어지는 전문가용
// 기초 자산. 상태(대기·생성 중·완성·실패·생략)를 보이고, 완성이면 살균된 HTML 을 sandbox iframe
// 으로만 렌더한다(LLM 문자열을 v-html 로 흘리지 않는다). sandbox="" 라 크기 실측이 불가하므로
// 첫 SVG 의 viewBox 비율로 미리보기 높이를 잡고, 전체 문서는 모달에서 스크롤로 본다.
const props = withDefaults(defineProps<{
  diagram: MarketDevDiagramViewType;
  canRegenerate?: boolean;
  regenerating?: boolean;
  regenerateError?: string;
  skipReason?: string | null; // 3단계(등록 전): run 응답의 생략 사유
  failed?: boolean; // 3단계: 잡 조회 실패
  reused?: boolean; // 3단계: 같은 입력(제목·분야·설명·답변·첨부)의 1시간 안 잡을 재사용
}>(), { canRegenerate: false, regenerating: false, regenerateError: '', skipReason: null, failed: false, reused: false });
const emit = defineEmits<{ regenerate: [] }>();

const meta = computed(() => props.diagram.meta);
const html = computed(() => props.diagram.html);
const statusLabel = computed(() => (meta.value === null ? '' : MARKET_DEV_DIAGRAM_STATUS_LABELS[meta.value.status]));
const statusClass = computed(() => {
  switch (meta.value?.status) {
    case 'done': return 'bg-emerald-100 text-emerald-700';
    case 'running': case 'queued': return 'bg-copper-50 text-copper-700';
    case 'error': return 'bg-red-100 text-red-700';
    default: return 'bg-line text-tx-3';
  }
});

// 미리보기 비율 — 첫 SVG viewBox(폭×높이). 없으면 1900×1200(프롬프트 최소 규격).
const ratio = computed(() => {
  const m = /<svg[^>]*viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*"/i.exec(html.value ?? '');
  const w = Number(m?.[1]);
  const h = Number(m?.[2]);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? h / w : 1200 / 1900;
});
const previewHeight = computed(() => `${String(Math.round(Math.min(720, Math.max(320, 900 * ratio.value + 120))))}px`);

const open = ref(false);
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false;
}
watch(open, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

// 생성 중(대기·그리는 중) — 잡은 5~10분짜리라 "얼마나 됐나"를 서버 requestedAt 으로 클라이언트가 센다
// (검토서와 달리 화면을 다시 열어도 값이 살아 있다). 단계 목록은 두지 않는다 — 구성도 잡의 상태는
// queued/running 둘뿐이라 3칸으로 그리면 없는 진척을 지어내는 셈이다(§13.12).
const pending = computed(() => meta.value?.status === 'queued' || meta.value?.status === 'running');
const elapsed = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;
const stopTimer = (): void => {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};
const tick = (): void => {
  const started = new Date(meta.value?.requestedAt ?? '').getTime();
  elapsed.value = Number.isNaN(started) ? 0 : Math.max(0, Math.round((Date.now() - started) / 1000));
};
watch(pending, (on) => {
  stopTimer();
  if (!on) return;
  tick();
  timer = setInterval(tick, 1000);
}, { immediate: true });
onBeforeUnmount(stopTimer);
const elapsedLabel = computed(() =>
  elapsed.value < 60
    ? `${String(elapsed.value)}초`
    : `${String(Math.floor(elapsed.value / 60))}분 ${String(elapsed.value % 60)}초`,
);
// 프로빙 실측 최대 581초(9.7분) — 12분을 넘기면 "멈춘 것 아닌가" 로 읽힌다.
const overdue = computed(() => elapsed.value >= 720);

const generatedAt = computed(() => {
  const iso = meta.value?.generatedAt;
  if (iso === null || iso === undefined) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const kst = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
});
</script>

<template>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-emerald-700">SYSTEM ARCHITECTURE</p>
        <h3 class="text-lead font-extrabold text-tx-1">시스템 구성도</h3>
        <p class="mt-1 text-label text-tx-3">AI 가 자료만으로 그린 기술 초안 — 블록도·인터페이스·검토 항목. 인터페이스·부품은 전문가 검토 후 확정됩니다.</p>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="meta !== null" class="rounded-full px-2.5 py-1 text-micro font-bold" :class="statusClass">{{ statusLabel }}</span>
        <button
          v-if="canRegenerate && meta?.status !== 'running' && meta?.status !== 'queued'"
          type="button"
          class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-tx-3 disabled:opacity-40"
          :disabled="regenerating"
          @click="emit('regenerate')"
        >
          {{ regenerating ? '요청 중…' : meta === null ? '구성도 만들기' : '다시 만들기' }}
        </button>
      </div>
    </div>
    <p v-if="regenerateError !== ''" class="text-body font-semibold text-red-600">{{ regenerateError }}</p>
    <p v-if="reused && meta !== null" class="rounded-xl bg-blue-50 px-4 py-3 text-label leading-relaxed text-blue-900">
      같은 내용으로 이미 만든 구성도를 재사용합니다(1시간 안 같은 입력). 내용을 바꾸면 새로 만듭니다.
    </p>

    <!-- 상태별 안내 -->
    <div v-if="meta === null && skipReason !== null" class="grid gap-1.5 rounded-2xl border border-dashed border-line-2 bg-paper px-6 py-7 text-center">
      <p class="text-body font-semibold text-tx-1">{{ skipReason === 'DISABLED' ? '시스템 구성도 생성이 지금 중지되어 있습니다' : '자료가 아직 적어 정밀 구성도를 만들지 않았습니다' }}</p>
      <p class="mx-auto max-w-lg text-label leading-relaxed text-tx-3">
        <template v-if="skipReason === 'DISABLED'">관리자가 다시 켜면 자료가 충분한 의뢰부터 만들어집니다.</template>
        <template v-else>{{ skipReason }} 설명을 500자 이상 적거나 회로도·사양서를 첨부하면 5~10분 안에 만들어집니다.</template>
      </p>
    </div>
    <p v-else-if="meta === null && failed" class="rounded-xl bg-red-50 px-4 py-3 text-body leading-relaxed text-red-700">
      구성도 생성 상태를 불러오지 못했습니다. 검토서를 다시 만들면 구성도도 다시 시작됩니다.
    </p>
    <div v-else-if="meta === null" class="grid gap-1.5 rounded-2xl border border-dashed border-line-2 bg-paper px-6 py-7 text-center">
      <p class="text-body font-semibold text-tx-1">아직 만들지 않았습니다</p>
      <p class="mx-auto max-w-lg text-label leading-relaxed text-tx-3">AI 동의로 등록한 의뢰는 자료가 충분하면 자동으로 만들어집니다.</p>
    </div>
    <!-- 생성 중 — 완성본이 들어올 액자를 미리 세운다(작게: 220px). 5~10분짜리라 주 메시지는 "기다리지 마세요"다. -->
    <div v-else-if="pending" class="grid gap-3.5 rounded-2xl border-2 border-copper-200 bg-white p-5">
      <div class="flex flex-wrap items-center gap-2.5">
        <span class="pulse-dot h-2 w-2 shrink-0 rounded-full bg-copper-500" />
        <p class="text-body font-extrabold text-tx-1">
          {{ meta.status === 'queued' ? '대기 중 — 곧 시작합니다' : '구성도를 그리는 중입니다' }}
        </p>
        <p class="ml-auto font-mono text-label tabular-nums text-tx-2">
          경과 {{ elapsedLabel }} <span class="text-tx-3">/ 보통 5~10분</span>
        </p>
      </div>
      <div class="h-1.5 overflow-hidden rounded-full bg-copper-50"><span class="dg-bar block h-full w-2/5 rounded-full bg-copper-500" /></div>
      <!-- 도면 자리 — 청사진 격자 위에 블록·연결선이 차례로 옅게 나타난다 -->
      <div class="dg-grid relative h-[220px] overflow-hidden rounded-xl border border-dashed border-line-2" aria-hidden="true">
        <svg class="absolute inset-0 h-full w-full" viewBox="0 0 380 220" fill="none" preserveAspectRatio="xMidYMid meet">
          <g stroke="var(--color-line-2)" stroke-width="1.5">
            <rect class="dg-b1" x="26" y="84" width="86" height="52" rx="6" fill="var(--color-line)" />
            <rect class="dg-b2" x="150" y="40" width="86" height="52" rx="6" fill="var(--color-line)" />
            <rect class="dg-b3" x="150" y="128" width="86" height="52" rx="6" fill="var(--color-line)" />
            <rect class="dg-b4" x="272" y="84" width="82" height="52" rx="6" fill="var(--color-line)" />
            <path class="dg-l1" d="M112 104h38v-38" />
            <path class="dg-l2" d="M112 116h38v38" />
            <path class="dg-l3" d="M236 66h24v44h12" />
            <path class="dg-l4" d="M236 154h24v-44h12" />
          </g>
        </svg>
      </div>
      <!-- 5~10분짜리라 이 카드에서 가장 크게 읽혀야 하는 문장이다 -->
      <div class="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-blue-900">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 9a6 6 0 1 0-12 0c0 4.5-2 6-2 6h16s-2-1.5-2-6" />
            <path d="M10.5 20a2 2 0 0 0 3 0" />
          </svg>
        </span>
        <span class="grid gap-0.5">
          <b class="text-lead font-extrabold">기다리지 않으셔도 됩니다</b>
          <span class="text-label leading-relaxed text-blue-800">
            등록 뒤 화면을 벗어나도 완성되면 우측 아래 알림과 메일로 알려드립니다. 지금 등록을 진행하셔도 구성도는 계속 만들어집니다.
          </span>
        </span>
      </div>
      <p v-if="overdue" class="rounded-xl bg-paper px-4 py-2.5 text-label leading-relaxed text-tx-2">
        예상보다 오래 걸리고 있습니다 — 자료가 많으면 15분까지 걸릴 수 있습니다.
      </p>
    </div>
    <div v-else-if="meta.status === 'skipped'" class="grid gap-1.5 rounded-2xl border border-dashed border-line-2 bg-paper px-6 py-7 text-center">
      <p class="text-body font-semibold text-tx-1">{{ meta.skipReason ?? '자료가 아직 적어 정밀 구성도를 만들지 않았습니다.' }}</p>
      <p class="mx-auto max-w-lg text-label leading-relaxed text-tx-3">설명을 500자 이상 적거나 회로도·사양서를 첨부하면 5~10분 안에 만들어집니다.</p>
    </div>
    <p v-else-if="meta.status === 'error'" class="rounded-xl bg-red-50 px-4 py-3 text-body leading-relaxed text-red-700">
      생성에 실패했습니다{{ meta.error === null ? '' : ` (${meta.error})` }}. 다시 만들거나 관리자에게 문의해 주세요.
    </p>

    <!-- 완성 -->
    <template v-else-if="html !== null">
      <div
        role="button"
        tabindex="0"
        aria-label="시스템 구성도 크게 보기"
        class="group relative w-full cursor-zoom-in overflow-hidden rounded-2xl border border-line bg-white"
        :style="{ height: previewHeight }"
        @click="open = true"
        @keydown.enter="open = true"
      >
        <iframe
          sandbox=""
          :srcdoc="html"
          title="시스템 구성도 미리보기"
          class="pointer-events-none absolute left-0 top-0 h-full w-full border-0"
        />
        <div class="absolute inset-0 flex items-end justify-end p-3 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <span class="rounded-lg bg-ink-900/80 px-3.5 py-2 text-label font-bold text-white">🔍 전체 문서 보기</span>
        </div>
      </div>
      <p class="text-micro text-tx-3">
        {{ meta.model }} · thinking {{ meta.think }} · {{ generatedAt }} 생성
        <template v-if="meta.elapsedSecs !== null"> · {{ Math.round(meta.elapsedSecs / 60) }}분 소요</template>
        <template v-if="meta.audit !== null && meta.audit.ungroundedTokens.length > 0">
          · 자료에 없는 표기 {{ meta.audit.ungroundedTokens.length }}건(전문가 확인)
        </template>
      </p>
      <p class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-3">{{ DEV_DIAGRAM_DISCLAIMER }}</p>

      <Teleport to="body">
        <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" @click.self="open = false">
          <div class="flex h-[94vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center justify-between gap-6 border-b border-line px-5 py-3">
              <p class="text-body font-extrabold text-tx-1">시스템 구성도 <span class="font-normal text-tx-3">(AI 기술 초안)</span></p>
              <button type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-tx-3" @click="open = false">닫기 ✕</button>
            </div>
            <iframe sandbox="" :srcdoc="html" title="시스템 구성도 전체" class="min-h-0 flex-1 border-0" />
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.pulse-dot { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* 생성 중 액자(§13.12) — 청사진 격자 + 블록·연결선이 차례로 나타난다. 진행률이 아니라 "그리는 중" 표시다. */
.dg-bar { animation: dg-bar 1.6s ease-in-out infinite; }
@keyframes dg-bar { 0% { transform: translateX(-105%); } 100% { transform: translateX(255%); } }

.dg-grid {
  background-color: var(--color-paper);
  background-image:
    linear-gradient(to right, color-mix(in oklab, var(--color-line-2) 55%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, var(--color-line-2) 55%, transparent) 1px, transparent 1px);
  background-size: 22px 22px;
}

.dg-b1, .dg-b2, .dg-b3, .dg-b4, .dg-l1, .dg-l2, .dg-l3, .dg-l4 {
  opacity: 0;
  animation: dg-draw 4.8s ease-in-out infinite;
}
.dg-b1 { animation-delay: 0s; }
.dg-l1 { animation-delay: 0.35s; }
.dg-b2 { animation-delay: 0.6s; }
.dg-l2 { animation-delay: 0.95s; }
.dg-b3 { animation-delay: 1.2s; }
.dg-l3 { animation-delay: 1.55s; }
.dg-l4 { animation-delay: 1.8s; }
.dg-b4 { animation-delay: 2.05s; }
@keyframes dg-draw { 0% { opacity: 0; } 12%, 72% { opacity: 1; } 92%, 100% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .pulse-dot, .dg-bar { animation: none; }
  .dg-b1, .dg-b2, .dg-b3, .dg-b4, .dg-l1, .dg-l2, .dg-l3, .dg-l4 { animation: none; opacity: 1; }
}
</style>
