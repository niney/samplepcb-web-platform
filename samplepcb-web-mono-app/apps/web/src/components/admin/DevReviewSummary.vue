<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEV_REVIEW_DISCLAIMER, DEV_REVIEW_GENERAL_AREA, marketAreaLabel } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { buildDevReviewView } from '@sp/utils';
import { formatDateTime } from '../../lib/format';

// AI 사전 검토서 축약 렌더(관리자 전용, v2). 고객·전문가 화면(apps/market DevReviewView)은
// 전 섹션을 보여주지만 관리자에게 필요한 것은 운영 판단 재료뿐이라 배지·요약·핵심 요구(근거
// 포함)·분야별 한 줄·명세 행(근거 포함)·전문가와 상의할 항목·원본 JSON 으로 좁힌다
// (docs/AI_DEV_REVIEW.md §13 — Vue 공유 패키지가 없어 축약 사본이다). 근거 인용은 관리자만 본다.
// 시스템 구성도는 검토서 밖의 산출물이라 AdminMarketProjects 의 구성도 섹션이 따로 보여준다(§13.7).
// LLM 산출 문자열은 어디에서도 v-html 로 흘리지 않는다.

const props = defineProps<{ review: MarketDevReviewType; title?: string }>();
const { t } = useI18n();

const view = computed(() => buildDevReviewView(props.review));
// 상의 항목의 분야 태그 — 레지스트리 라벨, 'general' 은 "공통".
const questionAreaLabel = (area: string): string =>
  area === DEV_REVIEW_GENERAL_AREA ? t('admin.devReview.generalArea') : marketAreaLabel(area);
const reviewJson = computed(() => JSON.stringify(props.review, null, 2));
// 서버 ISO(UTC)를 업무 기준 KST 로 — 관리자 화면 공용 포맷터(lib/format.ts) 사용.
const generatedAt = computed(() => formatDateTime(props.review.meta.generatedAt));
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-1.5">
      <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
        {{ t('admin.devReview.facts', { count: view.factCount }) }}
      </span>
      <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
        {{ t('admin.devReview.openQuestionsCount', { count: view.openQuestions.length }) }}
      </span>
      <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
        {{ view.areaBadge }}
      </span>
      <span class="ml-auto font-mono text-[10px] text-gray-400">
        {{
          t('admin.devReview.meta', {
            model: props.review.meta.model,
            promptVersion: props.review.meta.promptVersion,
            generatedAt: generatedAt,
          })
        }}
      </span>
    </div>

    <p class="text-[11px] text-gray-500">{{ DEV_REVIEW_DISCLAIMER }}</p>

    <p v-if="props.review.summary !== ''" class="rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
      {{ props.review.summary }}
    </p>

    <!-- 핵심 요구(근거 포함) -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.requirements') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="(item, index) in props.review.requirements"
          :key="index"
          class="rounded-lg border border-gray-100 px-3 py-1.5 text-xs text-gray-800"
        >
          {{ item.text }}
          <span v-if="item.evidence !== null" class="mt-0.5 block text-[11px] text-gray-400">
            {{ t('admin.devReview.evidence') }}: {{ item.evidence }}
          </span>
        </li>
        <li v-if="props.review.requirements.length === 0" class="text-xs text-gray-400">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <!-- 분야별 한 줄 + 명세 행(근거 포함) -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.areas') }}</p>
      <div class="mt-1.5 grid gap-1.5">
        <div v-for="area in props.review.areas" :key="area.area" class="rounded-lg border border-gray-100 px-3 py-2">
          <p class="text-xs font-bold text-gray-700">
            {{ marketAreaLabel(area.area) }}
            <span class="ml-1 font-normal text-gray-500">{{ area.summary !== '' ? area.summary : t('admin.devReview.afterConsult') }}</span>
          </p>
          <ul v-if="area.spec.length > 0" class="mt-1.5 grid gap-1">
            <li v-for="(row, index) in area.spec" :key="index" class="text-[11px] text-gray-700">
              <b>{{ row.item }}</b> — {{ row.text }}
              <span v-if="row.evidence !== null" class="block text-[11px] text-gray-400">
                {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
              </span>
            </li>
          </ul>
          <ul v-if="area.observations.length > 0" class="mt-1.5 grid gap-1 border-t border-gray-100 pt-1.5">
            <li v-for="(o, index) in area.observations" :key="index" class="text-[11px] text-gray-600">
              › {{ o.text }}
              <span v-if="o.evidence !== null" class="block text-[11px] text-gray-400">
                {{ t('admin.devReview.evidence') }}: {{ o.evidence }}
              </span>
            </li>
          </ul>
        </div>
      </div>
      <ul v-if="props.review.checks.length > 0" class="mt-1.5 grid gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
        <li v-for="c in props.review.checks" :key="c.code" class="text-[11px] text-amber-900">
          {{ t('admin.devReview.check') }}: {{ c.text }}
        </li>
      </ul>
    </div>

    <!-- 전문가와 상의할 항목 -->
    <div>
      <p class="text-xs font-bold text-gray-500">{{ t('admin.devReview.openQuestions') }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="(q, index) in view.openQuestions"
          :key="index"
          class="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-1.5 text-xs text-gray-700"
        >
          <span class="block">
            <span class="mr-1 rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-gray-500">{{ questionAreaLabel(q.area) }}</span>
            {{ q.question }}
          </span>
          <span v-if="q.why !== ''" class="mt-0.5 block text-[11px] text-gray-500">
            {{ t('admin.devReview.why') }}: {{ q.why }}
          </span>
        </li>
        <li v-if="view.openQuestions.length === 0" class="text-xs text-gray-400">
          {{ t('admin.devReview.none') }}
        </li>
      </ul>
    </div>

    <details>
      <summary class="cursor-pointer text-xs font-medium text-gray-600">
        {{ t('admin.devReview.json') }}
      </summary>
      <pre class="mt-2 max-h-[430px] overflow-auto whitespace-pre-wrap rounded-md bg-gray-900 p-3 text-[11px] text-gray-100">{{ reviewJson }}</pre>
    </details>
  </div>
</template>
