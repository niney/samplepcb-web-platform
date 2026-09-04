<script setup lang="ts">
import { ref } from 'vue';
import { MARKET_BUDGET_RANGES, MARKET_BUDGET_RANGE_LABELS, MARKET_EXPERT_TYPE_LABELS } from '@sp/api-contract';
import { useMarketExpertList } from '../../api/useMarketExperts';
import type { ExpertListFilters } from '../../api/useMarketExperts';
import { slotKey } from '../../composables/useRequestWizardForm';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import QuestionField from './QuestionField.vue';

// 스텝 2 — 몇 가지만 더(docs/AI_DEV_REVIEW.md §13.4·§13.8):
//   ① 프로젝트 공통 조건(필수, n/6) — 예산·완료 시점·목표 단계·견적 방식·인도 범위·NDA. 참고안의
//      "프로젝트 공통 조건" 7항목 중 공개 범위는 견적 방식과 같은 축이라 뺐다.
//   ② 공통 질문 3(선택) ③ 선택 분야마다 카드 하나 [맞춤 질문 2~3(풀 개발이면 2) · 희망 개발툴·언어("전문가
//      추천"이 기본, 접힘) · 추가자료 슬롯].
// 카드는 레지스트리 데이터로만 그린다 — 분야가 늘어도 이 컴포넌트는 안 바뀐다.
const props = defineProps<{ form: RequestWizardForm }>();
const {
  fields,
  conditionQuestions,
  conditionProgress,
  commonQuestions,
  areaDefs,
  areaQuestionsOf,
  stateOf,
  toggleChoice,
  noteMissingCodes,
  tools,
  toggleTool,
  clearTools,
  isRecommended,
  slotFiles,
  pickSlotFiles,
} = props.form;

const slotCount = (area: string, slot: string): number => slotFiles[slotKey(area, slot)]?.length ?? 0;

// 지정 전문가 선택 목록(승인 전문가 전체 — 소규모 전제).
const expertFilters = ref<ExpertListFilters>({ page: 1, pageSize: 100, expertType: '', serviceArea: '', tool: '', q: '' });
const expertList = useMarketExpertList(expertFilters);
</script>

<template>
  <div class="grid gap-6">
    <!-- 프로젝트 공통 조건(필수) -->
    <div class="grid gap-4 rounded-2xl border-2 border-ink-900/10 bg-white p-4 sm:p-5">
      <div class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-extrabold text-tx-1">프로젝트 공통 조건</p>
        <span class="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">필수</span>
        <span class="ml-auto font-mono text-[11px] text-tx-3">{{ conditionProgress.done }} / {{ conditionProgress.total }}</span>
      </div>
      <p class="-mt-2 text-[11px] leading-relaxed text-tx-3">
        견적 비교·계약·산출물 인도 범위를 한 번에 정합니다. 모르는 항목은 '협의해서 정할게요'를 고르세요.
      </p>
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="grid gap-1.5 text-xs font-semibold text-tx-2">
          <span>예상 개발 예산 <span class="text-red-500">*</span></span>
          <select v-model="fields.budgetRange" class="h-10 rounded-lg border border-line px-3 text-sm font-normal" :class="fields.budgetRange === null ? 'text-tx-3' : ''">
            <option :value="null" disabled>선택해 주세요</option>
            <option v-for="b in MARKET_BUDGET_RANGES" :key="b" :value="b">{{ MARKET_BUDGET_RANGE_LABELS[b] }}</option>
          </select>
        </label>
        <QuestionField
          v-for="q in conditionQuestions"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </div>
      <div>
        <p class="text-xs font-semibold text-tx-2">견적·전문가 선정 방식 <span class="text-red-500">*</span></p>
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
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">원하는 전문가 한 명에게만 견적을 요청합니다(비공개).</p>
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
          <b class="text-tx-1">🔏 보안·비밀유지 — NDA 보호</b> — 첨부 자료를 NDA에 전자서명한 전문가만 열람하도록 잠급니다. (권장)
        </span>
      </label>
    </div>

    <!-- 공통 질문 3문항 -->
    <div class="grid gap-4 rounded-2xl bg-paper p-4">
      <p class="text-xs font-bold text-tx-2">
        몇 가지만 더 알려주세요 <span class="font-normal text-tx-3">(전부 선택 — 모르면 '잘 모르겠어요')</span>
      </p>
      <QuestionField
        v-for="q in commonQuestions"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />
    </div>

    <!-- 분야별 카드 -->
    <div v-for="area in areaDefs" :key="area.code" class="grid gap-4 rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-tx-3">{{ area.code.toUpperCase() }}</p>
        <p class="text-sm font-extrabold text-tx-1">{{ area.label }}</p>
        <p class="text-[11px] text-tx-3">{{ area.hint }}</p>
      </div>

      <!-- 분야 맞춤 질문(풀 개발이면 앞 2개) — 모르면 '전문가 추천' -->
      <QuestionField
        v-for="q in areaQuestionsOf(area.code)"
        :key="q.code"
        :question="q"
        :state="stateOf(q.code)"
        :note-missing="noteMissingCodes.includes(q.code)"
        @toggle="toggleChoice(q, $event)"
        @note="stateOf(q.code).note = $event"
      />

      <!-- 희망 툴·언어 — 전문가 추천 기본 -->
      <details class="group rounded-xl border border-line bg-paper" :open="!isRecommended(area.code)">
        <summary class="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs">
          <span class="font-bold text-tx-2">{{ area.tools.label }}</span>
          <span
            class="rounded-full px-2 py-0.5 text-[11px] font-bold"
            :class="isRecommended(area.code) ? 'bg-emerald-100 text-emerald-700' : 'bg-ink-900 text-white'"
          >
            {{ isRecommended(area.code) ? '전문가 추천' : `${(tools[area.code] ?? []).length}개 지정` }}
          </span>
          <span class="ml-auto text-[11px] text-tx-3">기존 프로젝트와 맞춰야 하면 펼쳐서 지정하세요</span>
        </summary>
        <div class="flex flex-wrap gap-1.5 border-t border-line px-3.5 py-3">
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="isRecommended(area.code) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line bg-white text-tx-2 hover:border-line-2'"
            @click="clearTools(area.code)"
          >
            전문가 추천
          </button>
          <button
            v-for="opt in area.tools.options"
            :key="opt.code"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="(tools[area.code] ?? []).includes(opt.code) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-tx-2 hover:border-line-2'"
            @click="toggleTool(area.code, opt.code)"
          >
            {{ opt.label }}
          </button>
        </div>
      </details>

      <!-- 추가자료 슬롯 -->
      <div>
        <p class="text-xs font-bold text-tx-2">
          {{ area.short }} 관련 자료 <span class="font-normal text-tx-3">(있는 것만 · 없으면 전문가 검토 후 보완)</span>
        </p>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          <label
            v-for="slot in area.attachmentSlots"
            :key="slot.code"
            class="grid gap-1 rounded-xl border border-dashed border-line px-3.5 py-3 text-xs"
            :class="slotCount(area.code, slot.code) > 0 ? 'border-ink-900 bg-white' : 'bg-paper'"
          >
            <span class="font-bold text-tx-1">
              {{ slot.label }}
              <span v-if="slotCount(area.code, slot.code) > 0" class="ml-1 rounded-full bg-ink-900 px-1.5 py-0.5 text-[10px] text-white">
                {{ slotCount(area.code, slot.code) }}개
              </span>
            </span>
            <span class="font-normal text-tx-3">{{ slot.hint }}</span>
            <input type="file" multiple class="mt-1 text-xs font-normal" @change="pickSlotFiles(area.code, slot.code, $event)">
          </label>
        </div>
      </div>
    </div>

    <p class="rounded-xl bg-blue-50 px-4 py-3 text-[11px] leading-relaxed text-blue-900">
      기술 사항은 묻지 않습니다 — 통신 방식·MCU·기판 층수·서버 구조는 사용 목적을 기준으로 AI 검토서와 전문가가 제안합니다.
    </p>
  </div>
</template>
