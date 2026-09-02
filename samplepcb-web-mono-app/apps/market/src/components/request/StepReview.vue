<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  MARKET_BUDGET_RANGES,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_DEADLINE_PRESETS,
  MARKET_EXPERT_TYPE_LABELS,
} from '@sp/api-contract';
import { devReviewAreaBadge } from '@sp/utils';
import DevReviewView from '../dev-review/DevReviewView.vue';
import { useMarketExpertList } from '../../api/useMarketExperts';
import type { ExpertListFilters } from '../../api/useMarketExperts';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { DevReviewJob } from '../../composables/useDevReviewJob';

// 스텝 3 — 진입 시 AI 사전 검토서 생성을 자동 시작하고(동의 on ∧ 활성), 완료되면 미리보기와
// "이 검토서를 의뢰에 포함" 체크를 띄운다. 그 아래는 견적 조건 폼(예산·마감·방식·NDA).
// 포함 예정 검토서가 생성 중이면 등록이 차단되고, 기다리지 않으려면 탈출구를 누른다.
const props = defineProps<{ form: RequestWizardForm; job: DevReviewJob }>();
const { fields, attachments, todayKst, buildAnswers } = props.form;
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
  ensure,
  regenerate,
  skip,
} = props.job;

onMounted(() => {
  if (aiActive.value) ensure();
});

// 지정 전문가 선택 목록(승인 전문가 전체 — 소규모 전제).
const expertFilters = ref<ExpertListFilters>({
  page: 1,
  pageSize: 100,
  expertType: '',
  serviceArea: '',
  category: '',
  cadTool: '',
  q: '',
});
const expertList = useMarketExpertList(expertFilters);

const answeredCount = computed(() => buildAnswers().length);
const questionCount = props.form.activeQuestions.length;
const areaBadge = computed(() => devReviewAreaBadge(fields.serviceAreas));
</script>

<template>
  <div class="grid gap-5">
    <!-- ── AI 사전 검토서 ──────────────────────────────────────────────────── -->
    <div v-if="aiActive" class="grid gap-4">
      <div>
        <p class="text-xs font-bold text-tx-2">AI 사전 검토서</p>
        <p class="mt-1.5 text-xs leading-relaxed text-tx-3">
          적어 주신 내용과 첨부를 근거로 요약·제안 구성도·작업 항목을 정리합니다(약 30초~3분). 생성 중에도
          아래 견적 조건을 미리 입력할 수 있습니다.
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
          <DevReviewView :review="review" />
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

    <!-- ── 견적 조건 폼 (항상) ──────────────────────────────────────────────── -->
    <div class="grid gap-5" :class="aiActive ? 'border-t border-line pt-5' : ''">
      <p class="text-xs font-bold text-tx-1">견적 조건</p>

      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        예산 범위 <span class="text-red-500">*</span>
        <select v-model="fields.budgetRange" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
          <option v-for="b in MARKET_BUDGET_RANGES" :key="b" :value="b">{{ MARKET_BUDGET_RANGE_LABELS[b] }}</option>
        </select>
      </label>

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

      <div>
        <p class="text-xs font-bold text-tx-2">견적 방식 <span class="text-red-500">*</span></p>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            class="rounded-2xl border-2 p-4 text-left transition"
            :class="fields.method === 'open' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="fields.method = 'open'"
          >
            <p class="text-sm font-extrabold text-tx-1">역견적 (공개 입찰) <span class="ml-1 rounded bg-copper-500 px-1.5 py-0.5 text-[10px] font-bold text-white">추천</span></p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">조건이 맞는 전문가들이 블라인드로 견적을 제출합니다. 견적은 나만 볼 수 있습니다.</p>
          </button>
          <button
            type="button"
            class="rounded-2xl border-2 p-4 text-left transition"
            :class="fields.method === 'targeted' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="fields.method = 'targeted'"
          >
            <p class="text-sm font-extrabold text-tx-1">지정견적 (1:1)</p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">원하는 전문가 한 명에게만 견적을 요청합니다.</p>
          </button>
        </div>
        <label v-if="fields.method === 'targeted'" class="mt-3 grid gap-1.5 text-xs font-bold text-tx-2">
          작업자 선택 <span class="text-red-500">*</span>
          <select v-model="fields.targetExpertId" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
            <option :value="null" disabled>전문가를 선택하세요</option>
            <option v-for="e in expertList.data.value?.data.items ?? []" :key="e.expertId" :value="e.expertId">
              {{ e.displayName }} · {{ MARKET_EXPERT_TYPE_LABELS[e.expertType] }}
            </option>
          </select>
          <span v-if="(expertList.data.value?.data.items ?? []).length === 0" class="font-normal text-tx-3">
            선택할 수 있는 전문가가 없습니다.
          </span>
        </label>
      </div>

      <label class="flex items-start gap-2 rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
        <input v-model="fields.ndaRequired" type="checkbox" class="mt-0.5">
        <span>
          <b class="text-tx-1">🔏 NDA 보호</b> — 첨부 자료를 NDA에 전자서명한 전문가만 열람하도록 잠급니다. (권장)
        </span>
      </label>
    </div>

    <!-- ── 최종 요약 ────────────────────────────────────────────────────────── -->
    <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
      <p class="font-bold text-tx-1">최종 의뢰 내용</p>
      <p class="mt-1"><b class="text-tx-1">{{ fields.title || '(제목 미입력)' }}</b></p>
      <p class="mt-1">{{ areaBadge }} · 질문 답변 {{ answeredCount }}/{{ questionCount }}</p>
      <p class="mt-1">
        {{ MARKET_BUDGET_RANGE_LABELS[fields.budgetRange] }} ·
        견적 마감 {{ fields.deadlineMode === 'date' ? fields.deadlineDate : `${fields.deadlineMode}일 뒤` }} ·
        {{ fields.method === 'open' ? '역견적' : '지정견적' }} ·
        {{ fields.ndaRequired ? 'NDA 보호' : 'NDA 없음' }} · 첨부 {{ attachments.length }}개
      </p>
      <p v-if="aiActive" class="mt-1 text-tx-3">
        <template v-if="blocking">AI 사전 검토서 생성 중 — 완료 후 등록 가능</template>
        <template v-else-if="includable">AI 사전 검토서 포함</template>
        <template v-else>AI 사전 검토서 없이 등록</template>
      </p>
    </div>
  </div>
</template>
