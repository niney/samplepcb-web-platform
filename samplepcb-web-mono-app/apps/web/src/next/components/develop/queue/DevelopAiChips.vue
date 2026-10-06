<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { MARKET_DEV_DIAGRAM_STATUS_LABELS } from '@sp/api-contract';
import type { AdminDevelopAiSummaryType, DevelopAiReviewStateType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { developDiagramStateVariant, developReviewStateVariant } from '@/next/components/develop/develop-badges';

// 워크큐 AI 열(옛 components/admin/develop/DevelopAiChips.vue 의 짝, 같은 props) — 검토서 상태(+원천 변경 경고) ·
// 구성도 상태 · 공개 여부를 배지 한 줄로. 고객이 AI 분석에 동의하지 않은 의뢰는 버튼이 잠기므로 그 사실을 먼저 보인다.
defineProps<{ ai: AdminDevelopAiSummaryType; aiConsent: boolean }>();

const { t } = useI18n();
const reviewLabel = (state: DevelopAiReviewStateType): string => t(`admin.develop.reviewState.${state}`);
</script>

<template>
  <span class="flex flex-wrap items-center gap-1">
    <Badge v-if="!aiConsent" variant="secondary">{{ t('admin.develop.noAiConsent') }}</Badge>
    <Badge :variant="developReviewStateVariant(ai.review)">
      {{ t('admin.develop.reviewChip', { state: reviewLabel(ai.review) }) }}
    </Badge>
    <Badge v-if="ai.reviewStale" variant="warning">{{ t('admin.develop.staleShort') }}</Badge>
    <Badge :variant="developDiagramStateVariant(ai.diagram)">
      {{
        t('admin.develop.diagramChip', {
          state: ai.diagram === null ? t('admin.develop.diagramNone') : MARKET_DEV_DIAGRAM_STATUS_LABELS[ai.diagram],
        })
      }}
    </Badge>
    <Badge v-if="ai.diagramPublished" variant="success">{{ t('admin.develop.diagramPublished') }}</Badge>
  </span>
</template>
