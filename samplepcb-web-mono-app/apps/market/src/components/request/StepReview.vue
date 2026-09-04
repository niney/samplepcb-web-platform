<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { MARKET_BUDGET_RANGE_LABELS, MARKET_DEADLINE_PRESETS, marketAreaBadge, marketAnswerText } from '@sp/api-contract';
import DevReviewView from '../dev-review/DevReviewView.vue';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { DevReviewJob } from '../../composables/useDevReviewJob';

// 스텝 3 — 진입 시 AI 사전 검토서 생성을 자동 시작하고(동의 on ∧ 활성), 완료되면 미리보기와
// "이 검토서를 의뢰에 포함" 체크를 띄운다. 그 아래는 견적 마감(등록 시점 기준이라 여기 남는다)과 최종 요약 —
// 예산·방식·NDA 는 2스텝 "프로젝트 공통 조건"으로 옮겨졌다(§13.8).
// 포함 예정 검토서가 생성 중이면 등록이 차단되고, 기다리지 않으려면 탈출구를 누른다.
const props = defineProps<{ form: RequestWizardForm; job: DevReviewJob }>();
const { fields, totalAttachmentCount, todayKst, buildAnswers, activeQuestions } = props.form;
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
  includable,
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

const answeredCount = computed(() => buildAnswers().length);
// 공통 조건 요약 한 줄(완료 시점·목표 단계·인도 범위) — 2스텝에서 고른 값.
const conditionSummary = computed(() =>
  buildAnswers().filter((a) => props.form.conditionQuestions.some((q) => q.code === a.code)).map(marketAnswerText).join(' · '),
);
const budgetLabel = computed(() => (fields.budgetRange === null ? '예산 미선택' : MARKET_BUDGET_RANGE_LABELS[fields.budgetRange]));
const questionCount = computed(() => activeQuestions.value.length);
const areaBadge = computed(() => marketAreaBadge(fields.serviceAreas));
</script>

<template>
  <div class="grid gap-5">
    <!-- ── AI 사전 검토서 ──────────────────────────────────────────────────── -->
    <div v-if="aiActive" class="grid gap-4">
      <div>
        <p class="text-xs font-bold text-tx-2">AI 사전 검토서</p>
        <p class="mt-1.5 text-xs leading-relaxed text-tx-3">
          적어 주신 내용과 첨부를 근거로 요약·개발명세서를 정리합니다(약 30초~3분). 시스템 구성도는 같이 시작돼
          5~10분 뒤 완성되며, 등록 뒤 화면을 벗어나도 우측 아래 알림으로 알려드립니다. 생성 중에도 아래 견적
          마감을 미리 정할 수 있습니다.
        </p>
      </div>

      <!-- 생성 진행 2단(첨부 판독 → 검토서 작성) -->
      <p
        v-if="running"
        class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700"
      >
        <template v-if="stage === 'attachments'">⏳ 첨부 확인 중…</template>
        <template v-else>⏳ 검토서 작성 중… (30초~3분)</template>
        <span class="ml-1 font-normal">경과 {{ elapsedSecs }}초</span>
      </p>

      <!-- 생성 대기 탈출구 — 포함 예정 검토서가 생성 중이면 등록이 막힌다. -->
      <div
        v-if="blocking"
        class="flex flex-wrap items-center gap-2 rounded-lg bg-paper px-3 py-2 text-[11px] leading-relaxed text-tx-3"
      >
        <span>검토서 생성이 끝나면 등록됩니다.</span>
        <button
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2"
          @click="skip()"
        >
          검토서 없이 바로 등록
        </button>
      </div>

      <!-- 실패 -->
      <div v-if="failed && !running" class="grid gap-2">
        <p class="text-xs font-semibold text-red-600">{{ errorText }}</p>
        <div>
          <button
            type="button"
            class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
            @click="regenerate()"
          >
            다시 만들기
          </button>
        </div>
      </div>

      <!-- 오래됨 — 생성 이후 제목·분야·설명·답변·첨부가 바뀌었다. -->
      <div
        v-if="stale"
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"
      >
        <p class="font-bold">의뢰 내용이 바뀌어 검토서가 오래된 상태입니다.</p>
        <p class="mt-1">지금 등록하면 검토서는 빠집니다. 바뀐 내용으로 다시 만들어 주세요.</p>
        <button
          type="button"
          class="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-bold hover:border-amber-500"
          :disabled="running"
          @click="regenerate()"
        >
          검토서 다시 만들기
        </button>
      </div>

      <!-- 완료 — 미리보기 + 포함 체크 -->
      <template v-if="review !== null">
        <div class="rounded-2xl border border-line bg-white p-4 sm:p-5">
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
          <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
            <input v-model="include" type="checkbox" :disabled="stale">
            이 검토서를 의뢰에 포함
          </label>
          <button
            type="button"
            class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
            :disabled="running"
            @click="regenerate()"
          >
            검토서 다시 만들기
          </button>
        </div>
      </template>
    </div>

    <!-- ── 견적 마감 (항상) ──────────────────────────────────────────────── -->
    <div class="grid gap-5" :class="aiActive ? 'border-t border-line pt-5' : ''">
      <p class="text-xs font-bold text-tx-1">견적 마감</p>
      <div>
        <p class="text-xs font-bold text-tx-2">견적 마감 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            v-for="d in MARKET_DEADLINE_PRESETS"
            :key="d"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="fields.deadlineMode === String(d) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
            @click="fields.deadlineMode = String(d) as '3' | '7' | '14'"
          >
            {{ d }}일 뒤
          </button>
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="fields.deadlineMode === 'date' ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
            @click="fields.deadlineMode = 'date'"
          >
            날짜 지정
          </button>
          <input
            v-if="fields.deadlineMode === 'date'"
            v-model="fields.deadlineDate"
            type="date"
            :min="todayKst"
            class="h-9 rounded-lg border border-line px-3 text-xs"
          >
        </div>
        <p class="mt-2 text-xs text-tx-3">마감 시각은 해당 일 23:59(KST)입니다. 마감 전에는 언제든 조기 마감할 수 있습니다.</p>
      </div>
    </div>
    <!-- ── 최종 요약 ────────────────────────────────────────────────────────── -->
    <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
      <p class="font-bold text-tx-1">최종 의뢰 내용</p>
      <p class="mt-1"><b class="text-tx-1">{{ fields.title || '(제목 미입력)' }}</b></p>
      <p class="mt-1">{{ areaBadge }} · 질문 답변 {{ answeredCount }}/{{ questionCount }}</p>
      <p class="mt-1">
        {{ budgetLabel }} ·
        견적 마감 {{ fields.deadlineMode === 'date' ? fields.deadlineDate : `${fields.deadlineMode}일 뒤` }} ·
        {{ fields.method === 'open' ? '역견적' : '지정견적' }} ·
        {{ fields.ndaRequired ? 'NDA 보호' : 'NDA 없음' }} · 첨부 {{ totalAttachmentCount }}개
      </p>
      <p v-if="conditionSummary !== ''" class="mt-1">{{ conditionSummary }}</p>
      <p v-if="aiActive" class="mt-1 text-tx-3">
        <template v-if="blocking">AI 사전 검토서 생성 중 — 완료 후 등록 가능</template>
        <template v-else-if="includable">AI 사전 검토서 포함</template>
        <template v-else>AI 사전 검토서 없이 등록</template>
      </p>
    </div>
  </div>
</template>
