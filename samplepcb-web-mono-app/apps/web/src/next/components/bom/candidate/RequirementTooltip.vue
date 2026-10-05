<script setup lang="ts">
import { Badge } from '@/next/components/ui/badge';
import { Popover, PopoverAnchor, PopoverContent } from '@/next/components/ui/popover';
import {
  requirementBadgeLabel,
  requirementExpectedLabel,
  requirementLabel,
  requirementStateLabel,
  requirementStateTone,
  verificationTone,
} from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 필수조건 상세 — 후보의 '필수조건 n/m' 배지에 마우스·포커스·클릭으로 연다. 항목별 요구 조건 대 후보값과 판정.
// 위치는 Popover 가 배지에 맞추고(화면 끝에서 뒤집힘), 판 위로 옮겨 가는 동안은 닫지 않는다. 스크롤·바깥 클릭·
// Esc 로 닫힌다(Esc 는 맨 위 층부터 — 이 판이 서랍보다 먼저 닫힌다).
const {
  props,
  requirementTooltipCandidate,
  requirementTooltipAnchor,
  requirementTooltipId,
  cancelRequirementTooltipClose,
  scheduleRequirementTooltipClose,
  hideRequirementTooltipNow,
} = useCandidateDrawer();

const onOpenChange = (open: boolean): void => {
  if (!open) hideRequirementTooltipNow();
};
</script>

<template>
  <Popover :open="props.open && requirementTooltipCandidate !== null" @update:open="onOpenChange">
    <PopoverAnchor v-if="requirementTooltipAnchor !== null" :reference="requirementTooltipAnchor" />
    <PopoverContent
      v-if="requirementTooltipCandidate !== null"
      :id="requirementTooltipId"
      side="bottom"
      align="center"
      :side-offset="8"
      :collision-padding="8"
      class="w-[min(440px,calc(100vw-16px))]"
      @open-auto-focus.prevent
      @close-auto-focus.prevent
      @mouseenter="cancelRequirementTooltipClose"
      @mouseleave="scheduleRequirementTooltipClose"
    >
      <div class="flex items-center justify-between gap-3 border-b pb-2">
        <div class="min-w-0">
          <p class="text-sm font-semibold">
            {{ requirementTooltipCandidate.strictCategoryCoverage ? '필수조건 상세' : '확인 조건 상세' }}
          </p>
          <p class="text-muted-foreground truncate text-xs">{{ requirementTooltipCandidate.mpn }}</p>
        </div>
        <Badge :variant="verificationTone(requirementTooltipCandidate)" class="shrink-0">
          {{ requirementBadgeLabel(requirementTooltipCandidate) }}
        </Badge>
      </div>
      <!-- ui-audit-allow: 대화상자가 아니라 떠 있는 판(Popover) 안의 표 스크롤 — DialogScrollBody 는 대화상자 여백 기준이다 -->
      <div v-if="requirementTooltipCandidate.requirementAssessments.length > 0" class="max-h-[60vh] overflow-auto pt-1 text-xs">
        <div
          class="text-muted-foreground grid min-w-[400px] grid-cols-[minmax(76px,0.8fr)_minmax(96px,1fr)_minmax(96px,1fr)_auto] gap-x-2 border-b py-1.5 font-medium"
        >
          <span>항목</span>
          <span>요구 조건</span>
          <span>후보값</span>
          <span>판정</span>
        </div>
        <div
          v-for="assessment in requirementTooltipCandidate.requirementAssessments"
          :key="assessment.key"
          class="grid min-w-[400px] grid-cols-[minmax(76px,0.8fr)_minmax(96px,1fr)_minmax(96px,1fr)_auto] items-center gap-x-2 border-b py-2 last:border-b-0"
        >
          <span class="font-semibold wrap-anywhere">
            {{ requirementLabel(assessment.key) }}
            <span v-if="assessment.source === 'policy_default'" class="text-info mt-0.5 block font-medium">승인 기본값</span>
          </span>
          <span class="text-muted-foreground break-words">{{ requirementExpectedLabel(assessment) }}</span>
          <span class="break-words" :class="assessment.actualDisplay === null ? 'text-warning' : ''">
            {{ assessment.actualDisplay ?? '정보 없음' }}
          </span>
          <Badge :variant="requirementStateTone(assessment)">{{ requirementStateLabel(assessment) }}</Badge>
        </div>
      </div>
      <p v-else class="text-muted-foreground pt-2 text-xs">
        기존 분석 결과에는 항목별 근거가 없습니다. 새로 분석한 견적부터 상세값을 표시합니다.
      </p>
    </PopoverContent>
  </Popover>
</template>
