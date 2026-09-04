<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { DEV_DIAGRAM_DISCLAIMER, MARKET_DEV_DIAGRAM_STATUS_LABELS } from '@sp/api-contract';
import type { MarketDevDiagramViewType } from '@sp/api-contract';

// 정밀 시스템 구성도 섹션(docs/AI_DEV_REVIEW.md §13.5) — 등록 뒤 비동기로 만들어지는 전문가용
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
  <div class="grid gap-3">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-emerald-700">SYSTEM ARCHITECTURE</p>
        <h3 class="text-base font-extrabold text-tx-1">시스템 구성도</h3>
        <p class="mt-0.5 text-xs text-tx-3">AI 가 자료만으로 그린 기술 초안 — 블록도·인터페이스·검토 항목. 인터페이스·부품은 전문가 검토 후 확정됩니다.</p>
      </div>
      <div class="flex items-center gap-2 text-[11px]">
        <span v-if="meta !== null" class="rounded-full px-2.5 py-0.5 font-bold" :class="statusClass">{{ statusLabel }}</span>
        <button
          v-if="canRegenerate && meta?.status !== 'running' && meta?.status !== 'queued'"
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
          :disabled="regenerating"
          @click="emit('regenerate')"
        >
          {{ regenerating ? '요청 중…' : meta === null ? '구성도 만들기' : '다시 만들기' }}
        </button>
      </div>
    </div>
    <p v-if="regenerateError !== ''" class="text-xs font-semibold text-red-600">{{ regenerateError }}</p>
    <p v-if="reused && meta !== null" class="rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-900">
      같은 내용으로 이미 만든 구성도를 재사용합니다(1시간 안 같은 입력). 내용을 바꾸면 새로 만듭니다.
    </p>

    <!-- 상태별 안내 -->
    <p v-if="meta === null && skipReason !== null" class="rounded-xl bg-paper px-4 py-3 text-xs leading-relaxed text-tx-3">
      {{ skipReason === 'DISABLED' ? '시스템 구성도 생성이 지금 중지되어 있습니다.' : skipReason }}
    </p>
    <p v-else-if="meta === null && failed" class="rounded-xl bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
      구성도 생성 상태를 불러오지 못했습니다. 검토서를 다시 만들면 구성도도 다시 시작됩니다.
    </p>
    <p v-else-if="meta === null" class="rounded-xl bg-paper px-4 py-3 text-xs leading-relaxed text-tx-3">
      아직 만들지 않았습니다. AI 동의로 등록한 의뢰는 자료가 충분하면 자동으로 만들어집니다.
    </p>
    <p v-else-if="meta.status === 'queued' || meta.status === 'running'" class="rounded-xl bg-copper-50 px-4 py-3 text-xs leading-relaxed text-copper-700">
      ⏳ 시스템 구성도를 만드는 중입니다(보통 5~10분). 화면을 벗어나도 우측 아래 알림과 메일로 알려드립니다.
    </p>
    <p v-else-if="meta.status === 'skipped'" class="rounded-xl bg-paper px-4 py-3 text-xs leading-relaxed text-tx-3">
      {{ meta.skipReason ?? '자료가 부족해 만들지 않았습니다.' }}
    </p>
    <p v-else-if="meta.status === 'error'" class="rounded-xl bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
      생성에 실패했습니다{{ meta.error === null ? '' : ` (${meta.error})` }}. 다시 만들거나 관리자에게 문의해 주세요.
    </p>

    <!-- 완성 -->
    <template v-else-if="html !== null">
      <div
        role="button"
        tabindex="0"
        aria-label="시스템 구성도 크게 보기"
        class="group relative w-full cursor-zoom-in overflow-hidden rounded-xl border border-line bg-white"
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
          <span class="rounded-lg bg-ink-900/80 px-3 py-1.5 text-xs font-bold text-white">🔍 전체 문서 보기</span>
        </div>
      </div>
      <p class="text-[11px] text-tx-3">
        {{ meta.model }} · thinking {{ meta.think }} · {{ generatedAt }} 생성
        <template v-if="meta.elapsedSecs !== null"> · {{ Math.round(meta.elapsedSecs / 60) }}분 소요</template>
        <template v-if="meta.audit !== null && meta.audit.ungroundedTokens.length > 0">
          · 자료에 없는 표기 {{ meta.audit.ungroundedTokens.length }}건(전문가 확인)
        </template>
      </p>
      <p class="rounded-xl bg-paper px-3.5 py-2.5 text-[11px] leading-relaxed text-tx-3">{{ DEV_DIAGRAM_DISCLAIMER }}</p>

      <Teleport to="body">
        <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" @click.self="open = false">
          <div class="flex h-[94vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center justify-between gap-6 border-b border-line px-4 py-2.5">
              <p class="text-sm font-extrabold text-tx-1">시스템 구성도 <span class="font-normal text-tx-3">(AI 기술 초안)</span></p>
              <button type="button" class="rounded-lg border border-line px-3 py-1 text-xs font-bold text-tx-2 hover:border-line-2" @click="open = false">닫기 ✕</button>
            </div>
            <iframe sandbox="" :srcdoc="html" title="시스템 구성도 전체" class="min-h-0 flex-1 border-0" />
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
