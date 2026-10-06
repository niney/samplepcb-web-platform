<script setup lang="ts">
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import {
  localCatalogAttentionAssessments,
  localCatalogDecisionCodeLabel,
  localCatalogDecisionStatusLabel,
  localCatalogEligibilityLabel,
  localCatalogEligibilityTone,
  localCatalogOutcomeLabel,
  localCatalogOutcomeTone,
  localCatalogReasonCountLabel,
  localCatalogReasonLabel,
  localCatalogTitle,
  localCatalogUnavailabilityLabel,
  requirementExpectedLabel,
  requirementLabel,
  requirementStateLabel,
  requirementStateTone,
  statusLabel,
  traceElapsedLabel,
} from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 검색 과정 — 저장된 부품 우선 조회(1단계)와 공급사 검색 시도들. 응답 건수는 엔진의 기술 검증·중복 제거·
// 최종 정리 전 공급사 응답 수라 최종 후보 수와 다르다(그 차이를 맨 위에 밝힌다). 기본 접힘.
const {
  props,
  t,
  searchTraceExpanded,
  searchTracePrimaryQuery,
  searchTraceStageCount,
  localCatalogDecisionSummary,
  localCatalogRepresentativeCandidate,
  traceCodeLabel,
  traceOutcomeLabel,
} = useCandidateDrawer();

// 저장된 부품 조회 결과 — 선정(완료)·후보 없음/미선정/생략(주의)·오류(문제).
const outcomeBadge = (
  trace: NonNullable<NonNullable<typeof props.context>['localCatalogTrace']>,
): 'success' | 'warning' | 'danger' => {
  const tone = localCatalogOutcomeTone(trace);
  return tone === 'destructive' ? 'danger' : tone;
};
</script>

<template>
  <SectionCard v-if="props.context !== null">
    <template #title>{{ t('bomSearchTrace.process') }}</template>
    <template #meta>
      <span class="inline-flex min-w-0 items-center gap-1.5">
        <span class="max-w-80 truncate" :title="searchTracePrimaryQuery">{{ searchTracePrimaryQuery }}</span>
        <Badge v-if="props.context.searchTrace?.fallbackUsed" variant="warning">{{ t('bomSearchTrace.fallbackBadge') }}</Badge>
      </span>
    </template>
    <template #actions>
      <Button
        variant="ghost"
        size="xs"
        :aria-expanded="searchTraceExpanded"
        aria-controls="supplier-search-trace"
        @click="searchTraceExpanded = !searchTraceExpanded"
      >
        {{ t('bomSearchTrace.attempts', { count: searchTraceStageCount }) }}
        <ChevronUpIcon v-if="searchTraceExpanded" />
        <ChevronDownIcon v-else />
      </Button>
    </template>

    <template v-if="searchTraceExpanded" #default>
      <div id="supplier-search-trace" class="flex flex-col gap-2 text-xs">
        <Alert variant="info" size="sm">
          <AlertTitle>{{ t('bomSearchTrace.finalCandidates', { count: props.context.candidates.length }) }}</AlertTitle>
          <AlertDescription>{{ t('bomSearchTrace.rawResponseHelp') }}</AlertDescription>
        </Alert>
        <Panel
          v-if="props.context.searchTrace?.fallbackQuery"
          size="xs"
          tone="warning"
          class="grid min-w-0 gap-1 sm:grid-cols-[auto_1fr]"
        >
          <b>{{ t('bomSearchTrace.fallbackBadge') }}</b>
          <span class="text-foreground break-words">{{ props.context.searchTrace.fallbackQuery }}</span>
        </Panel>

        <ol class="flex flex-col gap-1.5">
          <li v-if="props.context.localCatalogTrace !== null">
            <Panel size="sm" class="grid gap-x-3 gap-y-1 sm:grid-cols-[24px_132px_minmax(0,1fr)_auto] sm:items-start">
              <Badge variant="outline">1</Badge>
              <span class="font-semibold">
                {{ localCatalogTitle(props.context.localCatalogTrace) }}
                <small class="text-muted-foreground block font-normal">저장된 부품 조회 · 외부 API 0회</small>
              </span>
              <div class="min-w-0">
                <Badge variant="info" class="mr-1.5">우선 조회</Badge>
                <span class="break-words">{{ props.context.localCatalogTrace.query || '엔진 정규 검색조건' }}</span>
                <span
                  v-if="localCatalogReasonLabel(props.context.localCatalogTrace) !== null"
                  class="text-muted-foreground mt-1 block"
                >{{ localCatalogReasonLabel(props.context.localCatalogTrace) }}</span>
                <Panel v-if="localCatalogDecisionSummary !== null" size="xs" tone="card" class="mt-2 flex flex-col gap-1.5">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-semibold">
                      엔진 결론: {{ localCatalogDecisionStatusLabel(localCatalogDecisionSummary.procurementStatus) }}
                    </span>
                    <Badge
                      v-if="localCatalogUnavailabilityLabel(localCatalogDecisionSummary.primaryUnavailabilityReason) !== null"
                      variant="warning"
                    >
                      {{ localCatalogUnavailabilityLabel(localCatalogDecisionSummary.primaryUnavailabilityReason) }}
                    </Badge>
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <Badge variant="success">
                      자동 가능 {{ localCatalogDecisionSummary.automaticCandidateCount.toLocaleString('ko-KR') }}
                    </Badge>
                    <Badge v-if="localCatalogDecisionSummary.reviewCandidateCount > 0" variant="warning">
                      검토 필요 {{ localCatalogDecisionSummary.reviewCandidateCount.toLocaleString('ko-KR') }}
                    </Badge>
                    <Badge v-if="localCatalogDecisionSummary.blockedCandidateCount > 0" variant="danger">
                      선정 제외 {{ localCatalogDecisionSummary.blockedCandidateCount.toLocaleString('ko-KR') }}
                    </Badge>
                    <Badge v-if="localCatalogDecisionSummary.unclassifiedCandidateCount > 0" variant="secondary">
                      상세 판정 없음 {{ localCatalogDecisionSummary.unclassifiedCandidateCount.toLocaleString('ko-KR') }}
                    </Badge>
                  </div>
                  <div
                    v-if="localCatalogDecisionSummary.reasonCounts.length > 0"
                    class="flex flex-wrap gap-1"
                    aria-label="자동선정 보류 주요 사유"
                  >
                    <Badge
                      v-for="reasonCount in localCatalogDecisionSummary.reasonCounts"
                      :key="`${reasonCount.kind}:${reasonCount.code}`"
                      variant="outline"
                    >
                      {{ localCatalogReasonCountLabel(reasonCount) }} {{ reasonCount.count.toLocaleString('ko-KR') }}개
                    </Badge>
                  </div>
                  <div v-if="localCatalogDecisionSummary.recommendationReasonCodes.length > 0" class="flex flex-wrap gap-1">
                    <Badge
                      v-for="code in localCatalogDecisionSummary.recommendationReasonCodes.slice(0, 4)"
                      :key="code"
                      variant="secondary"
                    >
                      {{ localCatalogDecisionCodeLabel(code) }}
                    </Badge>
                  </div>
                  <details v-if="localCatalogRepresentativeCandidate !== null" class="border-t pt-1.5">
                    <summary class="cursor-pointer font-semibold">
                      대표 후보 {{ localCatalogRepresentativeCandidate.mpn }}
                      <span
                        v-if="localCatalogRepresentativeCandidate.manufacturerName !== null"
                        class="text-muted-foreground font-normal"
                      >
                        · {{ localCatalogRepresentativeCandidate.manufacturerName }}
                      </span>
                    </summary>
                    <div class="mt-1.5 flex flex-col gap-1.5">
                      <div class="flex flex-wrap items-center gap-1.5">
                        <Badge :variant="localCatalogEligibilityTone(localCatalogRepresentativeCandidate.selectionEligibility)">
                          {{ localCatalogEligibilityLabel(localCatalogRepresentativeCandidate.selectionEligibility) }}
                        </Badge>
                        <span class="text-muted-foreground">
                          {{ statusLabel(localCatalogRepresentativeCandidate.status) }} · 확인 조건
                          {{ localCatalogRepresentativeCandidate.verifiedRequirementCount }}/{{
                            localCatalogRepresentativeCandidate.requiredRequirementCount
                          }}
                        </span>
                      </div>
                      <template v-if="localCatalogAttentionAssessments(localCatalogRepresentativeCandidate).length > 0">
                        <div
                          v-for="assessment in localCatalogAttentionAssessments(localCatalogRepresentativeCandidate)"
                          :key="assessment.key"
                          class="grid items-center gap-x-2 sm:grid-cols-[100px_1fr_auto]"
                        >
                          <b>{{ requirementLabel(assessment.key) }}</b>
                          <span class="text-muted-foreground">
                            요구 {{ requirementExpectedLabel(assessment) }} · 후보 {{ assessment.actualDisplay ?? '정보 없음' }}
                          </span>
                          <Badge :variant="requirementStateTone(assessment)">{{ requirementStateLabel(assessment) }}</Badge>
                        </div>
                      </template>
                      <p v-else class="text-muted-foreground">
                        항목별 미충족 정보는 없으며 엔진 정책 사유로 자동선정되지 않았습니다.
                      </p>
                    </div>
                  </details>
                </Panel>
              </div>
              <span class="text-muted-foreground text-right whitespace-nowrap">
                <Badge :variant="outcomeBadge(props.context.localCatalogTrace)">
                  {{ localCatalogOutcomeLabel(props.context.localCatalogTrace) }}
                </Badge>
                <small class="block">
                  후보 {{ props.context.localCatalogTrace.candidateCount.toLocaleString('ko-KR') }}개 · 판정
                  {{ props.context.localCatalogTrace.evaluatedCandidateCount.toLocaleString('ko-KR') }}개
                </small>
                <small class="block">{{ traceElapsedLabel(props.context.localCatalogTrace.elapsedMs) }}</small>
              </span>
            </Panel>
          </li>
          <template v-if="props.context.searchTrace !== null">
            <li v-for="attempt in props.context.searchTrace.attempts" :key="attempt.sequence">
              <Panel size="sm" class="grid gap-x-3 gap-y-1 sm:grid-cols-[24px_108px_minmax(0,1fr)_auto] sm:items-start">
                <Badge variant="secondary">
                  {{ attempt.sequence + (props.context.localCatalogTrace === null ? 0 : 1) }}
                </Badge>
                <span class="font-semibold">
                  {{ traceCodeLabel('stage', attempt.stage) }}
                  <small class="text-muted-foreground block truncate font-normal uppercase">{{ attempt.supplier }}</small>
                </span>
                <span class="min-w-0">
                  <Badge variant="info" class="mr-1.5">{{ traceCodeLabel('strategy', attempt.strategy) }}</Badge>
                  <span class="break-words">{{ attempt.query }}</span>
                  <span v-if="attempt.fallbackReason !== null" class="text-warning mt-1 block">
                    {{ traceCodeLabel('fallbackReason', attempt.fallbackReason) }}
                  </span>
                  <span v-if="attempt.errorType !== null" class="text-destructive mt-1 block">{{ attempt.errorType }}</span>
                </span>
                <span class="text-muted-foreground text-right whitespace-nowrap">
                  <b class="text-foreground">{{ traceOutcomeLabel(attempt) }}</b>
                  <small class="block">
                    {{ traceCodeLabel('source', attempt.source) }} · {{ traceElapsedLabel(attempt.elapsedMs) }}
                  </small>
                </span>
              </Panel>
            </li>
          </template>
        </ol>
      </div>
    </template>
  </SectionCard>
</template>
