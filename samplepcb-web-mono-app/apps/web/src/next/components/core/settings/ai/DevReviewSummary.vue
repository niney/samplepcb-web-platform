<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEV_REVIEW_DISCLAIMER, DEV_REVIEW_GENERAL_AREA, marketAreaLabel } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { buildDevReviewView } from '@sp/utils';
import { formatDateTime } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';

// AI 사전 검토서 축약 렌더(관리자 전용, v2) — 옛 components/admin/DevReviewSummary.vue 와 같은 내용·순서:
// 배지(사실·상의 항목·분야) → 면책 → 요약 → 핵심 요구(근거) → 분야별 한 줄·명세 행(근거) → 확인 사항 →
// 전문가와 상의할 항목 → 원본 JSON. LLM 산출 문자열은 어디에서도 v-html 로 흘리지 않는다.
const props = defineProps<{ review: MarketDevReviewType }>();
const { t } = useI18n();

const view = computed(() => buildDevReviewView(props.review));
// 상의 항목의 분야 태그 — 레지스트리 라벨, 'general' 은 "공통".
const questionAreaLabel = (area: string): string =>
  area === DEV_REVIEW_GENERAL_AREA ? t('admin.devReview.generalArea') : marketAreaLabel(area);
const reviewJson = computed(() => JSON.stringify(props.review, null, 2));
const generatedAt = computed(() => formatDateTime(props.review.meta.generatedAt));
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge variant="success">{{ t('admin.devReview.facts', { count: view.factCount }) }}</Badge>
      <Badge variant="warning">{{ t('admin.devReview.openQuestionsCount', { count: view.openQuestions.length }) }}</Badge>
      <Badge variant="info">{{ view.areaBadge }}</Badge>
      <span class="text-muted-foreground ml-auto font-mono text-xs">
        {{
          t('admin.devReview.meta', {
            model: props.review.meta.model,
            promptVersion: props.review.meta.promptVersion,
            generatedAt: generatedAt,
          })
        }}
      </span>
    </div>

    <p class="text-muted-foreground text-xs">{{ DEV_REVIEW_DISCLAIMER }}</p>

    <Panel v-if="props.review.summary !== ''" tone="muted" class="text-sm leading-relaxed">
      {{ props.review.summary }}
    </Panel>

    <!-- 핵심 요구(근거 포함) -->
    <div>
      <p class="text-muted-foreground text-xs font-semibold">{{ t('admin.devReview.requirements') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li v-for="(item, index) in props.review.requirements" :key="index">
          <Panel size="xs" class="text-sm">
            {{ item.text }}
            <span v-if="item.evidence !== null" class="text-muted-foreground mt-0.5 block text-xs">
              {{ t('admin.devReview.evidence') }}: {{ item.evidence }}
            </span>
          </Panel>
        </li>
        <li v-if="props.review.requirements.length === 0" class="text-muted-foreground text-xs">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <!-- 분야별 한 줄 + 명세 행(근거 포함) -->
    <div>
      <p class="text-muted-foreground text-xs font-semibold">{{ t('admin.devReview.areas') }}</p>
      <div class="mt-1.5 grid gap-1.5">
        <Panel v-for="area in props.review.areas" :key="area.area" size="sm" class="text-sm">
          <p class="font-semibold">
            {{ marketAreaLabel(area.area) }}
            <span class="text-muted-foreground ml-1 font-normal">
              {{ area.summary !== '' ? area.summary : t('admin.devReview.afterConsult') }}
            </span>
          </p>
          <ul v-if="area.spec.length > 0" class="mt-1.5 grid gap-1 text-xs">
            <li v-for="(row, index) in area.spec" :key="index">
              <b>{{ row.item }}</b> — {{ row.text }}
              <span v-if="row.evidence !== null" class="text-muted-foreground block">
                {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
              </span>
            </li>
          </ul>
          <ul v-if="area.observations.length > 0" class="text-muted-foreground mt-1.5 grid gap-1 border-t pt-1.5 text-xs">
            <li v-for="(o, index) in area.observations" :key="index">
              › {{ o.text }}
              <span v-if="o.evidence !== null" class="block">
                {{ t('admin.devReview.evidence') }}: {{ o.evidence }}
              </span>
            </li>
          </ul>
        </Panel>
      </div>
      <Panel v-if="props.review.checks.length > 0" tone="warning" class="mt-1.5 text-xs">
        <ul class="grid gap-1">
          <li v-for="c in props.review.checks" :key="c.code">{{ t('admin.devReview.check') }}: {{ c.text }}</li>
        </ul>
      </Panel>
    </div>

    <!-- 전문가와 상의할 항목 -->
    <div>
      <p class="text-muted-foreground text-xs font-semibold">{{ t('admin.devReview.openQuestions') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li v-for="(q, index) in view.openQuestions" :key="index">
          <Panel size="xs" tone="muted" class="text-sm">
            <span class="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{{ questionAreaLabel(q.area) }}</Badge>
              {{ q.question }}
            </span>
            <span v-if="q.why !== ''" class="text-muted-foreground mt-0.5 block text-xs">
              {{ t('admin.devReview.why') }}: {{ q.why }}
            </span>
          </Panel>
        </li>
        <li v-if="view.openQuestions.length === 0" class="text-muted-foreground text-xs">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <details>
      <summary class="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium">
        {{ t('admin.devReview.json') }}
      </summary>
      <pre class="bg-muted mt-2 max-h-96 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{{ reviewJson }}</pre>
    </details>
  </div>
</template>
