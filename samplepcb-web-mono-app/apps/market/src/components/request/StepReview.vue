<script setup lang="ts">
import { onMounted } from 'vue';
import { MARKET_DEADLINE_PRESETS } from '@sp/api-contract';
import DevReviewView from '../dev-review/DevReviewView.vue';
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
</script>

<template>
  <div class="grid gap-7">
    <!-- ── AI 사전 검토서 ──────────────────────────────────────────────────── -->
    <div v-if="aiActive" class="grid gap-4">
      <div>
        <h2 class="text-title font-extrabold text-tx-1">AI 사전 검토서</h2>
        <p class="mt-1 text-body leading-relaxed text-tx-2">
          적어 주신 내용과 첨부를 근거로 요약·개발명세서를 정리합니다(약 30초~3분). 시스템 구성도는 같이 시작돼
          5~10분 뒤 완성되며, 등록 뒤 화면을 벗어나도 우측 아래 알림으로 알려드립니다.
        </p>
      </div>

      <!-- 생성 진행 2단(첨부 판독 → 검토서 작성) -->
      <p v-if="running" class="flex items-center gap-2 rounded-xl bg-copper-50 px-4 py-3 text-body font-semibold text-copper-700">
        <span class="tray-dot h-2 w-2 rounded-full bg-copper-500" />
        <template v-if="stage === 'attachments'">첨부 확인 중…</template>
        <template v-else>검토서 작성 중… (30초~3분)</template>
        <span class="font-normal tabular-nums">경과 {{ elapsedSecs }}초</span>
      </p>

      <!-- 생성 대기 탈출구 — 포함 예정 검토서가 생성 중이면 등록이 막힌다. -->
      <div v-if="blocking" class="flex flex-wrap items-center gap-3 rounded-xl bg-paper px-4 py-3 text-label text-tx-2">
        <span>검토서 생성이 끝나면 등록됩니다.</span>
        <button type="button" class="h-9 rounded-lg border border-line-2 bg-white px-3.5 text-label font-bold text-tx-2 hover:border-tx-3" @click="skip()">
          검토서 없이 바로 등록
        </button>
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

      <!-- 오래됨 — 생성 이후 제목·분야·설명·답변·첨부가 바뀌었다. -->
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
@media (prefers-reduced-motion: reduce) { .tray-dot { animation: none; } }
</style>
