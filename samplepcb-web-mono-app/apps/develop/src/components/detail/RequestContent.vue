<script setup lang="ts">
import { computed } from 'vue';
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REGISTRY,
  DEVELOP_REQUEST_MODE_LABELS,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  developFollowupAnswerText,
  developProductionSummary,
  developWishLabel,
  isDevelopFollowupAnswered,
  isDevelopFollowupUnknown,
} from '@sp/api-contract';
import type { DevelopRequestDetailType } from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';

// 상세 "의뢰 내용" — 설명 · 조건 타일(의뢰 방식·예산·개발단계·희망 시기) · 시제품·제조 · AI 추가 질문 · 답변 표 · 연락처.
// (희망 툴 표시는 2026-09-08 간소화로 뺐다 — PCB 설계 툴은 답변 표의 문항이다.)
// 라벨은 전부 개발의뢰 계약 사전(DEVELOP_*)과 레지스트리에서 온다 — 이 파일에 한글 라벨을 새로 적지 않는다.
// 위저드 v1 로 접수한 옛 의뢰는 단계·계획이 null 이고 답변에 지금 사전에 없는 코드가 섞여 있다 —
// 그런 행은 코드가 라벨 자리에 그대로 보인다(파싱은 안 깨진다).
const props = defineProps<{ detail: DevelopRequestDetailType }>();

const briefRows = computed(() => buildDevReviewBriefRows(props.detail.answers, DEVELOP_REGISTRY));
// AI 후속 질문(§7.2.2) — 저장분이 있을 때만. 미응답도 행을 남긴다(무엇을 물었는지가 견적 근거의 일부다).
const aiFollowup = computed(() => props.detail.aiQuestions);
const aiRows = computed(() =>
  (aiFollowup.value?.questions ?? []).map((q) => ({
    id: q.id,
    label: q.question,
    value: isDevelopFollowupAnswered(q) ? developFollowupAnswerText(q) : '답하지 않음',
    muted: !isDevelopFollowupAnswered(q) || isDevelopFollowupUnknown(q),
  })),
);
const budgetLabel = computed(() => DEVELOP_BUDGET_RANGE_LABELS[props.detail.budgetRange]);
const modeLabel = computed(() => DEVELOP_REQUEST_MODE_LABELS[props.detail.requestMode]);
const stageLabel = computed(() => {
  const { currentStage, targetStage } = props.detail;
  if (currentStage === null && targetStage === null) return '—';
  const from = currentStage === null ? '?' : DEVELOP_CURRENT_STAGE_LABELS[currentStage];
  const to = targetStage === null ? '?' : DEVELOP_TARGET_STAGE_LABELS[targetStage];
  return `${from} → ${to}`;
});
const wishLabel = computed(() => {
  const label = developWishLabel(props.detail.wishDate, props.detail.wishNote);
  return label === '' ? '—' : label;
});
const production = computed(() => props.detail.production);
const productionSummary = computed(() => developProductionSummary(production.value));
const priorityLabel = computed(() => {
  const p = production.value?.priority ?? null;
  return p === null ? '' : DEVELOP_PRIORITY_LABELS[p];
});
const sourcingLabel = computed(() => {
  const s = production.value?.sourcing ?? null;
  return s === null ? '' : DEVELOP_SOURCING_MODE_LABELS[s];
});
const deliveryLabel = computed(() => {
  const d = production.value?.delivery ?? null;
  return d === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[d];
});
</script>

<template>
  <div class="grid gap-6">
    <!-- 설명 -->
    <div class="grid gap-2">
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-label font-bold text-tx-3">의뢰 설명</h3>
        <span v-if="detail.expertDelegate" class="rounded-full bg-ink-950 px-2.5 py-1 text-micro font-bold text-white">전문가에게 맡김</span>
      </div>
      <p class="whitespace-pre-wrap text-body leading-relaxed text-tx-1">{{ detail.description }}</p>
    </div>

    <!-- 조건 타일 -->
    <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
      <div class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">의뢰 방식</span>
        <span class="text-body font-bold text-tx-1">{{ modeLabel }}</span>
      </div>
      <div class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">예산</span>
        <span class="text-body font-bold text-tx-1">{{ budgetLabel }}</span>
      </div>
      <div class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">개발단계</span>
        <span class="text-body font-bold text-tx-1">{{ stageLabel }}</span>
      </div>
      <div class="grid gap-1 rounded-xl bg-paper px-4 py-3.5">
        <span class="text-label font-semibold text-tx-3">희망 완료 시기</span>
        <span class="text-body font-bold text-tx-1">{{ wishLabel }}</span>
      </div>
    </div>

    <!-- 시제품 · 제조 -->
    <div v-if="production !== null" class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">시제품 · 제조</h3>
      <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">계획</dt>
          <dd class="text-body text-tx-1">{{ productionSummary }}</dd>
        </div>
        <div v-if="priorityLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">우선순위</dt>
          <dd class="text-body text-tx-1">{{ priorityLabel }}</dd>
        </div>
        <div v-if="sourcingLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">자재 조달</dt>
          <dd class="text-body text-tx-1">{{ sourcingLabel }}</dd>
        </div>
        <div v-if="deliveryLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">납품 형태</dt>
          <dd class="text-body text-tx-1">{{ deliveryLabel }}</dd>
        </div>
      </dl>
    </div>

    <!-- AI 추가 질문 — 자료를 읽고 고른 질문과 그 답(질문 문장이 길어 라벨을 한 줄 위에 둔다) -->
    <div v-if="aiFollowup !== null" class="grid gap-2">
      <div class="flex flex-wrap items-baseline gap-2">
        <h3 class="text-label font-bold text-tx-3">AI 추가 질문</h3>
        <span class="rounded-full bg-brand-50 px-2.5 py-0.5 text-micro font-bold text-brand-700">AI 질문</span>
      </div>
      <p v-if="aiFollowup.understood !== ''" class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
        <b class="font-bold text-tx-1">AI 가 이해한 내용</b> — {{ aiFollowup.understood }}
      </p>
      <dl v-if="aiRows.length > 0" class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div v-for="row in aiRows" :key="row.id" class="grid gap-1 bg-white px-4 py-3">
          <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
          <dd class="whitespace-pre-wrap text-body" :class="row.muted ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="rounded-xl bg-paper px-4 py-3 text-body text-tx-3">자료가 충분해 추가 질문이 없었습니다.</p>
    </div>

    <!-- 답변 표 -->
    <div v-if="briefRows.length > 0" class="grid gap-2">
      <h3 class="text-label font-bold text-tx-3">세부 질문 답변</h3>
      <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div v-for="row in briefRows" :key="row.code" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
          <dd class="whitespace-pre-wrap text-body" :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
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
