<script setup lang="ts">
import { onMounted } from 'vue';
import { aiInterviewQuestionLabel } from '@sp/api-contract';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { RequestWizardAi } from '../../composables/useRequestWizardAi';

// 스텝 3 — AI 선분석(질문 축소·"이해한 내용") + 요구사항 확인 질문(한 번에 5개, 전체 ≤15).
// 전 문항 선택 사항 — 건너뛰고 바로 결과(검토 스텝)로 갈 수 있다. 구조화는 검토 스텝 진입 시 자동 실행.
const props = defineProps<{ form: RequestWizardForm; ai: RequestWizardAi }>();
const { attachments, goToStep } = props.form;
const {
  understood,
  preanalysisFindings,
  preanalysisKnownQuestionCodes,
  questionCandidates,
  questionPreanalysisRunning,
  questionPreanalysisFailed,
  questionPreanalysisDone,
  preanalyzeQuestions,
  ensurePreanalysis,
  visibleQuestions,
  currentQuestions,
  questionRound,
  questionRoundCount,
  nextRound,
  prevRound,
  questionContextLabel,
  interviewValues,
  interviewAnswerStr,
  setSingle,
  toggleMulti,
  hasInterviewAnswers,
} = props.ai;

// 진입 시 자동 선분석(이미 시작/완료됐으면 재호출 안 함).
onMounted(() => {
  ensurePreanalysis();
});

const questionLabel = (code: string): string =>
  aiInterviewQuestionLabel(code) ?? (code === 'extra' ? 'AI 추가 질문' : '추가 확인 사항');
</script>

<template>
  <div class="grid gap-4">
    <div>
      <p class="text-xs font-bold text-tx-2">AI 인터뷰 <span class="font-normal text-tx-3">(선택)</span></p>
      <p class="mt-1.5 text-xs leading-relaxed text-tx-3">
        AI가 설명·첨부를 먼저 확인해 이미 적힌 내용은 질문에서 빼고, 공통 질문과 선택한 개발 분야에 맞는 질문만 보여드립니다.
        답할수록 구성 명세가 정확해집니다 — 모두 선택 사항이며, 건너뛴 항목은 명세에 "(TBD)"(미확정)로 표시됩니다.
      </p>
    </div>

    <!-- 선분석 진행/실패/완료 -->
    <div class="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="font-bold">AI가 설명·첨부를 먼저 확인해 질문 줄이기</p>
          <p class="mt-1 text-blue-700">
            이미 명확히 적힌 내용은 질문 후보에서 제외합니다. 선분석 없이 아래 질문을 바로 답해도 됩니다.
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-blue-300 bg-white px-3 py-2 text-[11px] font-bold text-blue-800 hover:border-blue-500 disabled:opacity-40"
          :disabled="questionPreanalysisRunning || questionCandidates.length === 0"
          @click="preanalyzeQuestions"
        >
          {{ questionPreanalysisDone ? '다시 선분석' : 'AI 선분석 다시 시도' }}
        </button>
      </div>
      <p v-if="questionPreanalysisRunning" class="mt-3 font-semibold text-blue-800">
        ⏳ AI가 {{ attachments.length > 0 ? '설명과 첨부자료를' : '설명을' }} 확인하고 있습니다(약 30초~3분).
      </p>
      <p v-else-if="questionPreanalysisFailed" class="mt-3 font-semibold text-red-600">
        선분석에 실패했습니다. 기존 질문으로 계속 진행하거나 다시 시도할 수 있습니다.
      </p>
      <p v-else-if="questionPreanalysisDone" class="mt-3 font-semibold text-blue-800">
        {{ preanalysisKnownQuestionCodes.length }}개 항목을 자료에서 확인해 질문을
        {{ questionCandidates.length }}개에서 {{ visibleQuestions.length }}개로 줄였습니다.
      </p>
    </div>

    <!-- "제가 이해한 내용" 카드(understood — v2 optional, 없으면 생략) -->
    <div
      v-if="understood !== null"
      class="grid gap-2 rounded-xl border border-line bg-paper p-4 text-xs leading-relaxed text-tx-2"
    >
      <p class="text-xs font-bold text-tx-1">제가 이해한 내용</p>
      <dl class="grid gap-1.5">
        <div v-if="understood.product !== undefined" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">만들 것</dt><dd>{{ understood.product }}</dd>
        </div>
        <div v-if="understood.problem !== undefined" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">해결 문제</dt><dd>{{ understood.problem }}</dd>
        </div>
        <div v-if="understood.users !== undefined" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">사용자</dt><dd>{{ understood.users }}</dd>
        </div>
        <div v-if="understood.environment !== undefined" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">사용 환경</dt><dd>{{ understood.environment }}</dd>
        </div>
        <div v-if="understood.coreFunctions.length > 0" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">핵심 기능</dt>
          <dd>
            <ul class="grid gap-0.5">
              <li v-for="(fn, i) in understood.coreFunctions" :key="i" class="flex gap-1.5">
                <span class="text-copper-500">•</span><span>{{ fn }}</span>
              </li>
            </ul>
          </dd>
        </div>
        <div v-if="understood.materials !== undefined" class="flex gap-2">
          <dt class="w-16 shrink-0 font-semibold text-tx-3">보유 자료</dt><dd>{{ understood.materials }}</dd>
        </div>
      </dl>
      <p class="text-[11px] text-tx-3">잘못 이해한 부분이 있으면 아래 질문·설명에서 바로잡아 주세요.</p>
    </div>

    <!-- 제외된 질문 안내(접이식) -->
    <details
      v-if="preanalysisKnownQuestionCodes.length > 0"
      class="rounded-xl border border-line bg-white p-3 text-xs leading-relaxed text-tx-2"
    >
      <summary class="cursor-pointer font-semibold text-tx-2">
        이미 확인되어 제외한 질문 {{ preanalysisKnownQuestionCodes.length }}개
      </summary>
      <ul class="mt-2 grid gap-1.5">
        <li v-for="finding in preanalysisFindings" :key="finding.code" class="flex gap-1.5">
          <span class="text-copper-500">•</span>
          <span><b class="text-tx-1">{{ questionLabel(finding.code) }}</b> — {{ finding.evidence }}</span>
        </li>
      </ul>
    </details>

    <!-- 요구사항 확인 질문(한 번에 5개) -->
    <div class="flex items-center justify-between rounded-lg bg-paper px-3 py-2 text-[11px] text-tx-3">
      <span>요구사항 확인 질문 {{ questionRound + 1 }}/{{ questionRoundCount }}</span>
      <span>한 번에 최대 5개 · 전체 {{ visibleQuestions.length }}개</span>
    </div>
    <p v-if="attachments.length > 0" class="rounded-lg bg-paper px-3 py-2 text-[11px] leading-relaxed text-tx-3">
      첨부에 이미 적힌 내용은 다시 답하지 않아도 됩니다. AI가 첨부 근거를 우선 반영하고 중복 질문을 제외합니다.
    </p>
    <p v-if="visibleQuestions.length === 0" class="rounded-lg bg-paper px-3 py-2 text-xs leading-relaxed text-tx-3">
      추가로 확인할 질문이 없습니다. 바로 결과를 확인하세요.
    </p>

    <div v-for="q in currentQuestions" :key="q.code">
      <p class="text-xs font-bold text-tx-2">
        <span class="mr-1 rounded bg-paper px-1.5 py-0.5 text-[10px] text-tx-3">{{ questionContextLabel(q) }}</span>
        {{ q.label }} <span class="font-normal text-tx-3">(선택)</span>
      </p>
      <div v-if="q.type === 'text'" class="mt-2">
        <input
          :value="interviewAnswerStr(q.code)"
          type="text"
          :placeholder="q.placeholder ?? ''"
          class="h-9 w-full rounded-lg border border-line px-3 text-xs font-normal"
          @input="interviewValues[q.code] = ($event.target as HTMLInputElement).value"
        >
      </div>
      <div v-else class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="opt in q.options ?? []"
          :key="opt"
          type="button"
          class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
          :class="
            (q.type === 'single'
              ? interviewValues[q.code] === opt
              : Array.isArray(interviewValues[q.code]) &&
                (interviewValues[q.code] as string[]).includes(opt))
              ? 'border-ink-900 bg-ink-900 text-white'
              : 'border-line text-tx-2 hover:border-line-2'
          "
          @click="q.type === 'single' ? setSingle(q.code, opt) : toggleMulti(q.code, opt)"
        >
          {{ opt }}
        </button>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-if="questionRound > 0"
        type="button"
        class="rounded-lg border border-line px-4 py-2.5 text-xs font-bold text-tx-2 hover:border-line-2"
        @click="prevRound"
      >
        이전 질문
      </button>
      <button
        v-if="questionRound < questionRoundCount - 1"
        type="button"
        class="rounded-lg bg-ink-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-ink-800"
        @click="nextRound"
      >
        다음 질문
      </button>
      <button
        type="button"
        class="rounded-lg border border-line px-4 py-2.5 text-xs font-bold text-tx-2 hover:border-line-2"
        @click="goToStep('review')"
      >
        {{ hasInterviewAnswers ? '답변 반영해 결과 보기' : '질문 건너뛰고 결과 보기' }}
      </button>
    </div>
  </div>
</template>
