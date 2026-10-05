<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { conflictText, fmtWon, missingText, reasonLabel, requirementBadgeLabel, verificationTone } from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 현재 선정 — 이 행에 지금 적용된 부품과 그 근거(선정 출처·이유·기술/구매 순위·필수조건 확인률), 행 예상금액.
const {
  props,
  currentCandidate,
  provisionalSelectionPending,
  reviewSelectionConfirmed,
  requirementTooltipCandidateKey,
  requirementTooltipId,
  showRequirementTooltip,
  scheduleRequirementTooltipClose,
  originalExtractionAlerts,
  requirements,
  sourceLabel,
} = useCandidateDrawer();
const { engineSearchExcluded } = requirements;
</script>

<template>
  <SectionCard v-if="props.context !== null">
    <template #title>현재 선정</template>
    <template #meta>
      <span class="inline-flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{{ sourceLabel(props.context.selectionSource) }}</Badge>
        <Badge v-if="provisionalSelectionPending" variant="warning">선정됨 · 검토 대기</Badge>
        <Badge v-else-if="reviewSelectionConfirmed" variant="success">검토 완료</Badge>
        <Badge v-else-if="currentCandidate?.recommended" variant="success">자동 추천과 동일</Badge>
        <Badge v-else-if="currentCandidate !== null" variant="warning">추천에서 변경됨</Badge>
      </span>
    </template>

    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <p class="text-lg font-semibold break-words">{{ props.context.currentMpn || '선정 부품 없음' }}</p>
        <p v-if="currentCandidate?.manufacturerName" class="text-muted-foreground text-sm">
          {{ currentCandidate.manufacturerName }}
        </p>
      </div>
      <div class="shrink-0 sm:text-right">
        <p class="text-muted-foreground text-xs">현재 행 예상금액</p>
        <p class="text-xl font-semibold tabular-nums">{{ fmtWon(props.context.currentLineTotalKrw) }}</p>
        <p class="text-muted-foreground text-xs">공급사 배송비·세금 제외</p>
      </div>
    </div>

    <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div class="flex min-w-0 flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground shrink-0 text-xs font-medium">선정 이유</span>
        <template v-if="engineSearchExcluded">
          <Badge variant="secondary">공급사 검색 제외</Badge>
          <Badge v-for="alert in originalExtractionAlerts" :key="`selection-excluded-${alert}`" variant="outline">
            {{ alert }}
          </Badge>
        </template>
        <template v-else-if="props.context.decisionReasonCodes.length > 0">
          <Badge v-for="reason in props.context.decisionReasonCodes" :key="reason" variant="secondary">
            {{ reasonLabel(reason) }}
          </Badge>
        </template>
        <span v-else class="text-muted-foreground text-sm">기존 견적 또는 직접 검색으로 선정된 부품입니다.</span>
      </div>
      <Panel v-if="currentCandidate !== null" size="xs" muted class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span>기술 <b>{{ currentCandidate.technicalRank }}위</b></span>
        <span>
          구매 조건
          <b>{{ currentCandidate.priceRank === null ? '산정 불가' : `${String(currentCandidate.priceRank)}위` }}</b>
        </span>
        <Badge
          as="button"
          type="button"
          :variant="verificationTone(currentCandidate)"
          :aria-describedby="requirementTooltipCandidateKey === currentCandidate.candidateKey ? requirementTooltipId : undefined"
          @mouseenter="showRequirementTooltip(currentCandidate, $event)"
          @mouseleave="scheduleRequirementTooltipClose"
          @focus="showRequirementTooltip(currentCandidate, $event)"
          @blur="scheduleRequirementTooltipClose"
          @click.stop="showRequirementTooltip(currentCandidate, $event)"
        >
          {{ requirementBadgeLabel(currentCandidate) }}
        </Badge>
      </Panel>
    </div>

    <Alert
      v-if="
        currentCandidate !== null &&
          currentCandidate.selectionEligibility === 'automatic' &&
          (currentCandidate.conflicts.length > 0 || currentCandidate.missingRequirements.length > 0)
      "
      variant="warning"
      size="sm"
      role="status"
    >
      <AlertTitle>품번 정확 일치로 선정했습니다.</AlertTitle>
      <AlertDescription>
        <span v-if="currentCandidate.conflicts.length > 0">추가 정보 불일치: {{ conflictText(currentCandidate) }}.</span>
        <span v-if="currentCandidate.missingRequirements.length > 0"> 미확인 정보: {{ missingText(currentCandidate) }}.</span>
      </AlertDescription>
    </Alert>
    <Alert v-if="props.context.decisionReasonCodes.includes('purchase-fit')" variant="warning" size="sm">
      <AlertDescription>
        일부 조건은 추가 확인이 필요하지만, 기술 근거가 같은 후보 중 필요수량·MOQ·예상금액이 가장 적합한 부품을 선택했습니다.
      </AlertDescription>
    </Alert>
  </SectionCard>
</template>
