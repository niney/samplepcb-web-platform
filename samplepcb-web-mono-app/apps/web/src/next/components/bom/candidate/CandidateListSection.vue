<script setup lang="ts">
import { computed } from 'vue';
import { Badge } from '@/next/components/ui/badge';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CandidateCard from './CandidateCard.vue';
import { useCandidateDrawer, type CandidateTab } from './useCandidateDrawer';

// 부품 후보 — sp-engine 의 기술 안전성 안에서 현재 선택·추천과 구매 가능한 재고를 먼저 보인다(기술 순위는 유지).
// 탭: 기술 후보(직접 선택 가능) · 구매 가능 · 전체 · 검토 후보(자동선정 아님).
const {
  props,
  tab,
  candidates,
  selectableCount,
  purchasableCount,
  reviewCount,
  procurementAvailabilityAlert,
  recommendedCandidate,
  provisionalSelectionPending,
  reviewSelectionConfirmed,
} = useCandidateDrawer();

const tabs = computed<QueueTab<CandidateTab>[]>(() => [
  { key: 'selectable', label: '기술 후보', count: selectableCount.value },
  { key: 'purchasable', label: '구매 가능', count: purchasableCount.value },
  { key: 'all', label: '전체', count: props.context?.candidates.length ?? 0 },
  { key: 'review', label: '검토 후보', count: reviewCount.value, attention: true },
]);
const reviewBand = computed(() =>
  recommendedCandidate.value !== null && recommendedCandidate.value.selectionEligibility === 'manual_review'
    ? recommendedCandidate.value
    : null,
);
</script>

<template>
  <SectionCard v-if="props.context !== null">
    <template #title>부품 후보</template>
    <template #meta>sp-engine의 기술 안전성 안에서 현재 선택·추천과 구매 가능한 재고를 먼저 표시합니다.</template>
    <template #actions>
      <Badge variant="outline">추천·재고 우선 · 기술 순위 유지</Badge>
    </template>
    <template v-if="procurementAvailabilityAlert !== null || reviewBand !== null" #notice>
      <NoticeBand v-if="procurementAvailabilityAlert !== null" :tone="procurementAvailabilityAlert.tone" role="status">
        <p class="font-semibold">{{ procurementAvailabilityAlert.title }}</p>
        <p class="text-foreground/80 mt-0.5 text-xs">{{ procurementAvailabilityAlert.detail }}</p>
      </NoticeBand>
      <NoticeBand
        v-if="reviewBand !== null"
        :tone="reviewSelectionConfirmed ? 'success' : 'warning'"
        class="flex flex-wrap items-center justify-between gap-2 text-xs"
      >
        <p v-if="provisionalSelectionPending">
          <b>선정됨 · 검토 대기</b> {{ reviewBand.mpn }} —
          <template v-if="props.context.technicalFallbackUsed">
            기술 1순위의 적용 가능한 구매 조건이 없어 엔진이 다음 안전 후보를 임시 선정했습니다.
          </template>
          <template v-else>엔진 임시 선정으로 예상 견적에 반영했습니다.</template>
        </p>
        <p v-else-if="reviewSelectionConfirmed">
          <b>검토 완료</b> {{ reviewBand.mpn }} — 사용자가 엔진 검토 권장 후보를 확인했습니다.
        </p>
        <p v-else><b>검토 권장</b> {{ reviewBand.mpn }} — 엔진이 실제 적용 후보로 지정했습니다.</p>
        <Badge v-if="reviewBand.technicalReviewRank !== null" variant="warning">
          검토 {{ reviewBand.technicalReviewRank }}순위
        </Badge>
      </NoticeBand>
    </template>

    <QueueTabs v-model="tab" :tabs="tabs" />
    <div v-if="candidates.length > 0" class="flex flex-col gap-2">
      <CandidateCard v-for="candidate in candidates" :key="candidate.candidateKey" :candidate="candidate" />
    </div>
    <p v-else class="text-muted-foreground py-8 text-center text-sm">이 조건에 해당하는 후보가 없습니다.</p>
  </SectionCard>
</template>
