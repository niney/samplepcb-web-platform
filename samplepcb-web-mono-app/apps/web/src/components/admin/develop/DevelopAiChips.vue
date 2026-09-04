<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { MARKET_DEV_DIAGRAM_STATUS_LABELS } from '@sp/api-contract';
import type { AdminDevelopAiSummaryType, DevelopAiReviewStateType } from '@sp/api-contract';
import { developDiagramStateClass, developReviewStateClass } from './develop-badge';

// 워크큐 AI 열 — 검토서 상태(+원천 변경 경고) · 구성도 상태 · 공개 여부를 칩 한 줄로.
// 고객이 AI 분석에 동의하지 않은 의뢰는 버튼이 잠기므로 그 사실을 먼저 보인다.
defineProps<{ ai: AdminDevelopAiSummaryType; aiConsent: boolean }>();

const { t } = useI18n();
const reviewLabel = (state: DevelopAiReviewStateType): string => t(`admin.develop.reviewState.${state}`);
</script>

<template>
  <div class="flex flex-wrap items-center gap-1 text-[11px] font-bold">
    <span v-if="!aiConsent" class="rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">
      {{ t('admin.develop.noAiConsent') }}
    </span>
    <span class="rounded-full px-2 py-0.5" :class="developReviewStateClass(ai.review)">
      {{ t('admin.develop.reviewChip', { state: reviewLabel(ai.review) }) }}
    </span>
    <span v-if="ai.reviewStale" class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
      {{ t('admin.develop.staleShort') }}
    </span>
    <span class="rounded-full px-2 py-0.5" :class="developDiagramStateClass(ai.diagram)">
      {{ t('admin.develop.diagramChip', {
        state: ai.diagram === null ? t('admin.develop.diagramNone') : MARKET_DEV_DIAGRAM_STATUS_LABELS[ai.diagram],
      }) }}
    </span>
    <span v-if="ai.diagramPublished" class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
      {{ t('admin.develop.diagramPublished') }}
    </span>
  </div>
</template>
