<script setup lang="ts">
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { certaintyMark, certaintyTone } from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 원본 BOM — 고객 Excel 의 이 행에서 읽은 값. 요약 여섯 칸(품번·제조사·값·실장·설명·핵심 사양)을 먼저 보이고,
// 전체 추출값과 근거(셀 위치·정규화값)는 펼쳐서 본다. 확신도(확인·추론·검토·미상)는 칸마다 배지로.
const {
  props,
  originalDetailsExpanded,
  originalLocation,
  originalSummaryFields,
  originalFields,
  originalDetailCount,
  originalReviewFields,
  originalExtractionSummary,
  originalExtractionAlerts,
  requirements,
} = useCandidateDrawer();
const { engineSearchExcluded } = requirements;

const CERTAINTY_LABEL = { verified: '확인', inferred: '추론', review: '검토', unknown: '미상' } as const;
</script>

<template>
  <SectionCard v-if="props.context !== null">
    <template #title>원본 BOM</template>
    <template #meta>
      <span class="inline-flex flex-wrap items-center gap-2">
        <span class="tracking-widest uppercase">Excel source</span>
        <span v-if="originalLocation !== null" class="max-w-64 truncate" :title="originalLocation.title">
          {{ originalLocation.value }}
        </span>
        <Badge variant="secondary">
          BOM {{ props.context.bomQty.toLocaleString('ko-KR') }} · 필요 {{ props.context.neededQty.toLocaleString('ko-KR') }}
        </Badge>
      </span>
    </template>
    <template #actions>
      <template v-if="props.context.extraction !== null">
        <Badge variant="success">근거 {{ originalExtractionSummary.verified }}/{{ originalExtractionSummary.extracted }}</Badge>
        <Badge v-if="originalExtractionSummary.inferred > 0" variant="warning">추론 {{ originalExtractionSummary.inferred }}</Badge>
        <Badge v-if="engineSearchExcluded" variant="secondary">검색 제외</Badge>
        <Badge
          v-else-if="originalExtractionSummary.review > 0 || props.context.extraction.reviewStatus !== 'extracted'"
          variant="danger"
        >
          검토 {{ Math.max(originalExtractionSummary.review, 1) }}
        </Badge>
      </template>
      <Button
        variant="outline"
        size="xs"
        :aria-expanded="originalDetailsExpanded"
        aria-controls="original-bom-details"
        @click="originalDetailsExpanded = !originalDetailsExpanded"
      >
        {{ originalDetailsExpanded ? '전체 추출값 접기' : `전체 추출값 ${String(originalDetailCount)}개` }}
        <ChevronUpIcon v-if="originalDetailsExpanded" />
        <ChevronDownIcon v-else />
      </Button>
    </template>

    <dl class="grid grid-cols-2 gap-1.5 sm:grid-cols-6">
      <Panel v-for="field in originalSummaryFields" :key="field.key" size="xs" muted class="min-w-0" :class="field.summarySpan">
        <dt class="text-muted-foreground flex items-center justify-between gap-1.5 text-xs font-medium">
          <span class="truncate">{{ field.label }}</span>
          <Badge v-if="field.certainty !== undefined" :variant="certaintyTone(field.certainty)" :title="field.provenance">
            {{ certaintyMark(field.certainty) }} {{ CERTAINTY_LABEL[field.certainty] }}
          </Badge>
        </dt>
        <dd
          class="mt-0.5 truncate text-sm"
          :class="field.certainty === 'verified' ? 'text-foreground font-semibold' : 'font-medium'"
          :title="field.title"
        >
          {{ field.value }}
        </dd>
        <p v-if="field.normalizedValue !== undefined && field.normalizedValue !== null" class="text-info truncate text-xs">
          정규화 {{ field.normalizedValue }}
        </p>
      </Panel>
    </dl>

    <Alert v-if="engineSearchExcluded" variant="muted" size="sm">
      <AlertTitle>검색 제외</AlertTitle>
      <AlertDescription>
        <div class="flex flex-wrap items-center gap-1.5">
          <span v-if="originalExtractionAlerts.length === 0">엔진이 공급사 검색 대상이 아닌 행으로 판정했습니다.</span>
          <Badge v-for="alert in originalExtractionAlerts" :key="`excluded-${alert}`" variant="outline">{{ alert }}</Badge>
        </div>
      </AlertDescription>
    </Alert>
    <Alert v-else-if="originalReviewFields.length > 0 || originalExtractionAlerts.length > 0" variant="destructive" size="sm">
      <AlertTitle>검토 필요</AlertTitle>
      <AlertDescription>
        <div class="flex flex-wrap items-center gap-1.5">
          <span v-for="field in originalReviewFields" :key="`review-${field.key}`">{{ field.label }} {{ field.value }}</span>
          <Badge v-for="alert in originalExtractionAlerts" :key="alert" variant="outline">{{ alert }}</Badge>
        </div>
      </AlertDescription>
    </Alert>

    <div v-show="originalDetailsExpanded" id="original-bom-details" class="border-t pt-3">
      <div class="flex flex-wrap items-center justify-between gap-1">
        <p class="text-sm font-semibold">전체 추출값과 근거</p>
        <p class="text-muted-foreground text-xs">원문 우선 · 정규화값 보조</p>
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Panel
          v-for="field in originalFields"
          :key="`detail-${field.key}`"
          size="xs"
          class="min-w-0"
          :class="field.wide === true ? 'col-span-2' : ''"
        >
          <dt class="text-muted-foreground flex flex-wrap items-center justify-between gap-1 text-xs font-medium">
            <span>{{ field.label }}</span>
            <Badge v-if="field.provenance !== undefined" :variant="certaintyTone(field.certainty)">
              {{ certaintyMark(field.certainty) }} {{ field.provenance }}
            </Badge>
          </dt>
          <dd class="mt-0.5 text-sm font-semibold break-words" :title="field.title">{{ field.value }}</dd>
          <p v-if="field.normalizedValue !== undefined && field.normalizedValue !== null" class="text-info mt-0.5 text-xs">
            정규화 {{ field.normalizedValue }}
          </p>
          <p v-if="field.evidenceCells !== undefined && field.evidenceCells.length > 0" class="text-muted-foreground mt-0.5 text-xs">
            근거 {{ field.evidenceCells.join(', ') }}
          </p>
        </Panel>
      </dl>
    </div>
  </SectionCard>
</template>
