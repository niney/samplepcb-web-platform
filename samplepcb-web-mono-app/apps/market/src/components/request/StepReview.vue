<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { MARKET_DEADLINE_PRESETS } from '@sp/api-contract';
import { DevReviewView } from '@sp/ui';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { DevReviewJob } from '../../composables/useDevReviewJob';

// 스텝 3 — 진입 시 AI 사전 검토서 생성을 자동 시작하고(동의 on ∧ 활성), 완료되면 미리보기와
// "이 검토서를 의뢰에 포함" 체크를 띄운다. 그 아래는 견적 마감(등록 시점 기준이라 여기 남는다).
// 예산·방식·NDA 는 2스텝 "프로젝트 공통 조건"으로, 최종 요약은 우측 사이드(WizardAside)로 옮겨졌다(§13.8·§13.9).
// 포함 예정 검토서가 생성 중이면 등록이 차단되고, 기다리지 않으려면 탈출구를 누른다.
const props = defineProps<{ form: RequestWizardForm; job: DevReviewJob }>();
const { fields, todayKst } = props.form;
const {
  active: aiActive,
  running,
  failed,
  errorText,
  stage,
  elapsedSecs,
  review,
  stale,
  include,
  blocking,
  diagramJobId,
  diagramMeta,
  diagramSkipReason,
  diagramCached,
  diagramFailed,
  ensure,
  regenerate,
  skip,
} = props.job;

onMounted(() => {
  if (aiActive.value) ensure();
});

// 생성 중 표시 — 서버 stage 는 'attachments'(자료 판독) → 'review'(작성) 2단뿐이라 그 둘만 그린다.
const readingDone = computed(() => stage.value !== 'attachments');
const runSteps = computed(() => [
  { key: 'attachments', label: '자료 읽기', state: readingDone.value ? 'done' : 'active' },
  { key: 'review', label: '검토서 작성', state: readingDone.value ? 'active' : 'wait' },
]);
// 90초를 넘기면 "멈춘 것 아닌가" 로 읽히기 시작한다 — 한 줄로 안심시킨다.
const slowly = computed(() => elapsedSecs.value >= 90);
</script>

<template>
  <div class="grid gap-7">
    <!-- ── AI 사전 검토서 ──────────────────────────────────────────────────── -->
    <div v-if="aiActive" class="grid gap-4">
      <div>
        <h2 class="text-title font-extrabold text-tx-1">AI 사전 검토서</h2>
        <p class="mt-1 text-body leading-relaxed text-tx-2">
          적어 주신 내용과 1단계 참고 자료를 근거로 요약·개발명세서를 정리합니다(약 30초~3분). 시스템 구성도는 같이 시작돼
          5~10분 뒤 완성되며, 등록 뒤 화면을 벗어나도 우측 아래 알림으로 알려드립니다.
        </p>
      </div>

      <!-- 생성 중 — 완성될 검토서 자리를 미리 차지하는 분석 카드(§13.11).
           단계는 서버가 실제로 알려주는 2단(자료 읽기 → 검토서 작성)만 쓴다 — 없는 진척을 지어내지 않는다. -->
      <div v-if="running" class="grid gap-5 rounded-2xl border-2 border-copper-200 bg-white p-6">
        <div class="flex flex-wrap items-center gap-3.5">
          <span class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-copper-50 text-copper-600">
            <span class="ai-ring absolute inset-0 rounded-xl border-2 border-copper-300" />
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
              <path d="M8.5 12h5M8.5 16h3" />
              <path d="m18 2 .9 2.1L21 5l-2.1.9L18 8l-.9-2.1L15 5l2.1-.9z" />
            </svg>
          </span>
          <div class="grid gap-0.5">
            <p class="text-lead font-extrabold text-tx-1">
              {{ readingDone ? 'AI 가 검토서를 쓰고 있습니다' : 'AI 가 자료를 읽고 있습니다' }}
            </p>
            <p class="text-label text-tx-3">
              {{ readingDone ? '요약 · 핵심 요구사항 · 분야별 검토 · 개발명세서를 정리합니다.' : '적어 주신 내용과 참고 자료에서 텍스트·이미지를 추출합니다.' }}
            </p>
          </div>
          <p class="ml-auto font-mono text-label tabular-nums text-tx-2">
            경과 {{ elapsedSecs }}초 <span class="text-tx-3">/ 보통 30초~3분</span>
          </p>
        </div>

        <div class="h-1.5 overflow-hidden rounded-full bg-copper-50"><span class="ai-bar block h-full w-2/5 rounded-full bg-copper-500" /></div>

        <ol class="grid gap-2.5 sm:grid-cols-2">
          <li
            v-for="(s, i) in runSteps"
            :key="s.key"
            class="flex items-center gap-2.5 rounded-xl border px-4 py-3 text-label transition"
            :class="s.state === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : s.state === 'active' ? 'border-copper-300 bg-copper-50 text-copper-800'
                : 'border-line bg-paper text-tx-3'"
          >
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-micro font-bold"
              :class="s.state === 'done' ? 'bg-emerald-600 text-white' : s.state === 'active' ? 'bg-copper-500 text-white' : 'bg-white text-tx-3 ring-1 ring-line-2'"
            >
              <template v-if="s.state === 'done'">✓</template>
              <template v-else>{{ i + 1 }}</template>
            </span>
            <span class="font-bold">{{ s.label }}</span>
            <span v-if="s.state === 'active'" class="tray-dot ml-auto h-2 w-2 rounded-full bg-copper-500" />
          </li>
        </ol>

        <!-- 완성 레이아웃 예고 — 검토서가 들어오면 이 자리에 그대로 채워진다(높이가 튀지 않는다) -->
        <div class="grid gap-3 border-t border-line pt-5" aria-hidden="true">
          <span class="ai-skel h-4 w-1/3 rounded" />
          <span class="ai-skel h-3 w-full rounded" />
          <span class="ai-skel h-3 w-11/12 rounded" />
          <div class="mt-1.5 grid gap-3 sm:grid-cols-2">
            <div v-for="n in 2" :key="n" class="grid gap-2 rounded-xl border border-line p-4">
              <span class="ai-skel h-3.5 w-2/5 rounded" />
              <span class="ai-skel h-3 w-full rounded" />
              <span class="ai-skel h-3 w-4/5 rounded" />
            </div>
          </div>
        </div>

        <p v-if="slowly" class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
          조금 더 걸리고 있습니다 — 자료가 많으면 3분까지 걸릴 수 있습니다. 이 화면을 그대로 두셔도 됩니다.
        </p>

        <!-- 구성도는 같은 자료로 병렬 생성(§13.7) — 검토서보다 훨씬 오래 걸린다는 것을 여기서 알려 준다 -->
        <p v-if="diagramSkipReason !== null" class="flex flex-wrap items-center gap-2 rounded-xl bg-paper px-4 py-3 text-label text-tx-2">
          <span class="font-bold text-tx-1">시스템 구성도</span> 이번에는 만들지 않습니다 — {{ diagramSkipReason }}
        </p>
        <p v-else-if="diagramJobId !== null" class="flex flex-wrap items-center gap-2 rounded-xl bg-paper px-4 py-3 text-label text-tx-2">
          <span class="tray-dot h-2 w-2 rounded-full bg-ink-900" />
          <span class="font-bold text-tx-1">시스템 구성도</span>
          도 같은 자료로 만들고 있습니다 · 5~10분 · 등록 뒤 화면을 벗어나도 우측 아래 알림으로 알려드립니다.
        </p>

        <!-- 생성 대기 탈출구 — 포함 예정 검토서가 생성 중이면 등록이 막힌다. -->
        <div v-if="blocking" class="flex flex-wrap items-center gap-3 border-t border-line pt-5 text-label text-tx-2">
          <span>검토서 생성이 끝나면 등록됩니다.</span>
          <button type="button" class="h-9 rounded-lg border border-line-2 bg-white px-3.5 text-label font-bold text-tx-2 hover:border-tx-3" @click="skip()">
            검토서 없이 바로 등록
          </button>
        </div>
      </div>

      <!-- 실패 -->
      <div v-if="failed && !running" class="grid gap-2">
        <p class="text-body font-semibold text-red-600">{{ errorText }}</p>
        <div>
          <button type="button" class="h-10 rounded-lg border border-line-2 px-4 text-label font-bold text-tx-2 hover:border-tx-3" @click="regenerate()">
            다시 만들기
          </button>
        </div>
      </div>

      <!-- 오래됨 — 생성 이후 제목·분야·설명·답변·참고 자료가 바뀌었다(분야 슬롯 자료는 원천이 아니다). -->
      <div v-if="stale" class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-label leading-relaxed text-amber-800">
        <p class="text-body font-bold">의뢰 내용이 바뀌어 검토서가 오래된 상태입니다.</p>
        <p class="mt-1">지금 등록하면 검토서는 빠집니다. 바뀐 내용으로 다시 만들어 주세요.</p>
        <button
          type="button"
          class="mt-2.5 h-9 rounded-lg border border-amber-300 bg-white px-3.5 font-bold hover:border-amber-500"
          :disabled="running"
          @click="regenerate()"
        >
          검토서 다시 만들기
        </button>
      </div>

      <!-- 완료 — 미리보기 + 포함 체크 -->
      <template v-if="review !== null">
        <div class="rounded-2xl border border-line bg-white p-6">
          <DevReviewView
            :review="review"
            :title="fields.title"
            :diagram="{ meta: diagramMeta, html: null }"
            :diagram-skip-reason="diagramSkipReason"
            :diagram-failed="diagramFailed"
            :diagram-reused="diagramCached"
          />
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-2 text-body font-semibold text-tx-2">
            <input v-model="include" type="checkbox" :disabled="stale">
            이 검토서를 의뢰에 포함
          </label>
          <button
            type="button"
            class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-tx-3 disabled:opacity-40"
            :disabled="running"
            @click="regenerate()"
          >
            검토서 다시 만들기
          </button>
        </div>
      </template>
    </div>

    <!-- ── 견적 마감 (항상) ──────────────────────────────────────────────── -->
    <div class="grid gap-3" :class="aiActive ? 'border-t border-line pt-6' : ''">
      <div>
        <h2 class="text-title font-extrabold text-tx-1">견적 마감 <span class="text-red-500">*</span></h2>
        <p class="mt-1 text-label text-tx-3">마감 시각은 해당 일 23:59(KST)입니다. 마감 전에는 언제든 조기 마감할 수 있습니다.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="d in MARKET_DEADLINE_PRESETS"
          :key="d"
          type="button"
          class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
          :class="fields.deadlineMode === String(d) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 text-tx-2 hover:border-tx-3'"
          @click="fields.deadlineMode = String(d) as '3' | '7' | '14'"
        >
          {{ d }}일 뒤
        </button>
        <button
          type="button"
          class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
          :class="fields.deadlineMode === 'date' ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 text-tx-2 hover:border-tx-3'"
          @click="fields.deadlineMode = 'date'"
        >
          날짜 지정
        </button>
        <input
          v-if="fields.deadlineMode === 'date'"
          v-model="fields.deadlineDate"
          type="date"
          :min="todayKst"
          class="h-9 rounded-lg border border-line-2 px-3 text-label"
        >
      </div>
    </div>
  </div>
</template>

<style scoped>
.tray-dot { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

/* 분석 카드 — 불확정 진행 바 · 아이콘 링 · 스켈레톤 셔머(§13.11) */
.ai-bar { animation: ai-bar 1.5s ease-in-out infinite; }
@keyframes ai-bar { 0% { transform: translateX(-105%); } 100% { transform: translateX(255%); } }

.ai-ring { animation: ai-ring 1.8s ease-out infinite; }
@keyframes ai-ring { 0% { transform: scale(1); opacity: 0.9; } 70%, 100% { transform: scale(1.25); opacity: 0; } }

.ai-skel {
  display: block;
  background: linear-gradient(90deg, var(--color-line) 25%, var(--color-paper) 50%, var(--color-line) 75%) 0 0 / 300% 100%;
  animation: ai-skel 1.4s ease-in-out infinite;
}
@keyframes ai-skel { 0% { background-position: 150% 0; } 100% { background-position: -150% 0; } }

@media (prefers-reduced-motion: reduce) {
  .tray-dot, .ai-bar, .ai-ring, .ai-skel { animation: none; }
  .ai-ring { opacity: 0.5; }
}
</style>
