<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { DEVELOP_REQUEST_STATUS_LABELS, marketAreaBadge } from '@sp/api-contract';
import { useAdminDevelopDetail } from '../../admin/useAdminDevelop';
import DevelopDiagramPanel from '../../components/admin/develop/DevelopDiagramPanel.vue';
import DevelopOpsStrip from '../../components/admin/develop/DevelopOpsStrip.vue';
import DevelopQuoteSection from '../../components/admin/develop/DevelopQuoteSection.vue';
import DevelopRequestContent from '../../components/admin/develop/DevelopRequestContent.vue';
import DevelopReviewPanel from '../../components/admin/develop/DevelopReviewPanel.vue';
import DevelopStatusBar from '../../components/admin/develop/DevelopStatusBar.vue';
import DevelopTimeline from '../../components/admin/develop/DevelopTimeline.vue';
import { developStatusBadgeClass } from '../../components/admin/develop/develop-badge';
import { formatDateTime } from '../../lib/format';

// 개발의뢰 전면 상세(docs/DEVELOP_FLOW.md §7.3) — 드로어가 아니라 페이지다.
// AI 산출물 편집·타임라인 작성처럼 오래 머무는 작업이 있어 좁은 서랍에 담기지 않는다.
// 레이아웃은 **단일 컬럼 max-w 1120px**(2026-09-05 사용자 결정) — 우측 사이드는 카드가 짧아 아래가 비고
// 본문(편집기·타임라인)만 좁아져 손해였다. 옛 사이드 내용은 헤더 아래 운영 띠(DevelopOpsStrip)로 흡수.
// 섹션 내비는 sticky — 긴 페이지에서 편집기 ↔ 견적 ↔ 타임라인 이동용.
// 상세 조회는 AI 잡이 도는 동안만 5초 폴링한다(useAdminDevelopDetail).

const { t } = useI18n();
const route = useRoute();

const requestId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});

const { data, isLoading, isError } = useAdminDevelopDetail(requestId);
const detail = computed(() => data.value?.data);

const sections = [
  { id: 'develop-content', key: 'content' },
  { id: 'develop-review', key: 'review' },
  { id: 'develop-diagram', key: 'diagram' },
  { id: 'develop-quotes', key: 'quotes' },
  { id: 'develop-timeline', key: 'timeline' },
] as const;
</script>

<template>
  <div class="mx-auto w-full max-w-[1120px] space-y-4">
    <RouterLink :to="{ name: 'admin-develop-requests' }" class="inline-block text-xs font-semibold text-blue-600 hover:underline">
      ← {{ t('admin.develop.backToList') }}
    </RouterLink>

    <p v-if="isLoading" class="py-16 text-center text-sm text-gray-400">{{ t('admin.develop.loading') }}</p>
    <p v-else-if="isError || detail === undefined" class="py-16 text-center text-sm text-red-600">
      {{ t('admin.develop.detailFail') }}
    </p>
    <template v-else>
      <!-- 헤더 -->
      <header class="rounded-xl border border-gray-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold" :class="developStatusBadgeClass(detail.status)">
            {{ DEVELOP_REQUEST_STATUS_LABELS[detail.status] }}
          </span>
          <span v-if="marketAreaBadge(detail.serviceAreas) !== ''" class="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
            {{ marketAreaBadge(detail.serviceAreas) }}
          </span>
          <span class="text-[11px] text-gray-400">#{{ detail.requestId }} · {{ formatDateTime(detail.createdAt) }}</span>
        </div>
        <h1 class="mt-2 text-xl font-bold text-gray-900">{{ detail.title }}</h1>
        <p class="mt-1 text-xs text-gray-500">
          {{ t('admin.develop.owner') }}: {{ detail.owner.name === '' ? detail.owner.mbId : detail.owner.name }}
          ({{ detail.owner.mbId }})<template v-if="detail.owner.email !== null"> · {{ detail.owner.email }}</template>
        </p>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <DevelopStatusBar
            :request-id="detail.requestId"
            :status="detail.status"
            :assignee-mb-id="detail.assigneeMbId"
          />
        </div>
        <div class="mt-3 border-t border-gray-100 pt-3">
          <DevelopOpsStrip :detail="detail" />
        </div>
      </header>

      <!-- 섹션 내비 — 관리자 헤더 아래 고정 -->
      <nav class="sticky top-14 z-20 -mx-1 rounded-lg border border-gray-200 bg-white/95 px-1 py-1 backdrop-blur">
        <ul class="flex flex-wrap gap-1">
          <li v-for="s in sections" :key="s.id">
            <a :href="`#${s.id}`" class="inline-block rounded-md px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-gray-900">
              {{ t(`admin.develop.nav.${s.key}`) }}
            </a>
          </li>
        </ul>
      </nav>

      <div class="grid min-w-0 gap-4">
        <div id="develop-content" class="scroll-mt-28"><DevelopRequestContent :detail="detail" /></div>
        <div id="develop-review" class="scroll-mt-28">
          <DevelopReviewPanel
            :request-id="detail.requestId"
            :review="detail.review"
            :ai-consent="detail.aiConsent"
            :ai-supplement="detail.aiSupplement"
            :title="detail.title"
          />
        </div>
        <div id="develop-diagram" class="scroll-mt-28">
          <DevelopDiagramPanel
            :request-id="detail.requestId"
            :diagram="detail.diagram"
            :ai-consent="detail.aiConsent"
          />
        </div>
        <div class="scroll-mt-28"><DevelopQuoteSection :detail="detail" /></div>
        <div id="develop-timeline" class="scroll-mt-28">
          <DevelopTimeline :request-id="detail.requestId" :events="detail.events" :status="detail.status" />
        </div>
      </div>
    </template>
  </div>
</template>
