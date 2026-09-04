<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_BUDGET_RANGE_LABELS, MARKET_COMMON_CONDITIONS, MARKET_EXPERT_PICK_LABEL, marketToolRows } from '@sp/api-contract';
import type { DevelopRequestDetailType } from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';

// 상세 "의뢰 내용" — 설명 · 조건 타일(예산 + 공통 조건 3) · 답변 표 · 희망 툴 · 연락처 · 비밀유지.
// 라벨은 전부 계약 사전(MARKET_*·질문 레지스트리)에서 온다 — 이 파일에 한글 라벨을 새로 적지 않는다.
const props = defineProps<{ detail: DevelopRequestDetailType }>();

const briefRows = computed(() => buildDevReviewBriefRows(props.detail.answers));
const isConditionCode = (code: string): boolean => MARKET_COMMON_CONDITIONS.some((q) => q.code === code);
const conditionRows = computed(() => briefRows.value.filter((r) => isConditionCode(r.code)));
const answerRows = computed(() => briefRows.value.filter((r) => !isConditionCode(r.code)));
const toolRows = computed(() => marketToolRows(props.detail.tools, props.detail.serviceAreas));
const budgetLabel = computed(() => MARKET_BUDGET_RANGE_LABELS[props.detail.budgetRange]);
</script>

<template>
  <div class="grid gap-6">
    <!-- 설명 -->
    <div class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">의뢰 설명</h3>
      <p class="whitespace-pre-wrap text-body leading-relaxed text-tx-1">{{ detail.description }}</p>
    </div>

    <!-- 조건 타일 -->
    <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      <div class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">예산</span>
        <span class="text-body font-bold text-tx-1">{{ budgetLabel }}</span>
      </div>
      <div v-for="row in conditionRows" :key="row.code" class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">{{ row.label }}</span>
        <span class="text-body font-bold" :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</span>
      </div>
    </div>

    <!-- 답변 표 -->
    <div v-if="answerRows.length > 0" class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">답변</h3>
      <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div v-for="row in answerRows" :key="row.code" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
          <dd class="text-body" :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <!-- 희망 툴 -->
    <div v-if="toolRows.length > 0" class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">희망 개발 툴 · 언어</h3>
      <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div v-for="row in toolRows" :key="row.area" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">{{ row.areaLabel }}</dt>
          <dd class="text-body" :class="row.labels.length === 0 ? 'text-tx-3' : 'text-tx-1'">
            {{ row.labels.length === 0 ? MARKET_EXPERT_PICK_LABEL : row.labels.join(' · ') }}
          </dd>
        </div>
      </dl>
    </div>

    <!-- 연락처 · 비밀유지 -->
    <div class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">연락처</h3>
      <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">담당자</dt>
          <dd class="text-body text-tx-1">
            {{ detail.contact.name }}<template v-if="detail.contact.company !== null"> · {{ detail.contact.company }}</template>
          </dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">연락</dt>
          <dd class="text-body text-tx-1">{{ detail.contact.phone }} · {{ detail.contact.email }}</dd>
        </div>
        <div v-if="detail.contact.hours !== null" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">통화 가능 시간</dt>
          <dd class="text-body text-tx-1">{{ detail.contact.hours }}</dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">비밀유지 계약</dt>
          <dd class="text-body" :class="detail.ndaWanted ? 'text-tx-1' : 'text-tx-3'">
            {{ detail.ndaWanted ? '희망 — 담당자가 계약서를 준비해 연락드립니다' : '희망하지 않음' }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
