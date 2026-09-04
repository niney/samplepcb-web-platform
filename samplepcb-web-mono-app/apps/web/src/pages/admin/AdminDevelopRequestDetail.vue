<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { DEVELOP_REQUEST_STATUS_LABELS, marketAreaBadge } from '@sp/api-contract';
import { useAdminDevelopDetail } from '../../admin/useAdminDevelop';
import DevelopDiagramPanel from '../../components/admin/develop/DevelopDiagramPanel.vue';
import DevelopQuoteSection from '../../components/admin/develop/DevelopQuoteSection.vue';
import DevelopRequestContent from '../../components/admin/develop/DevelopRequestContent.vue';
import DevelopReviewPanel from '../../components/admin/develop/DevelopReviewPanel.vue';
import DevelopSideCards from '../../components/admin/develop/DevelopSideCards.vue';
import DevelopStatusBar from '../../components/admin/develop/DevelopStatusBar.vue';
import DevelopTimeline from '../../components/admin/develop/DevelopTimeline.vue';
import { developStatusBadgeClass } from '../../components/admin/develop/develop-badge';
import { formatDateTime } from '../../lib/format';

// 개발의뢰 전면 상세(docs/DEVELOP_FLOW.md §7.3) — 드로어가 아니라 페이지다.
// AI 산출물 편집·타임라인 작성처럼 오래 머무는 작업이 있어 좁은 서랍에 담기지 않는다.
// 상세 조회는 AI 잡이 도는 동안만 5초 폴링한다(useAdminDevelopDetail).

const { t } = useI18n();
const route = useRoute();

const requestId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});

const { data, isLoading, isError } = useAdminDevelopDetail(requestId);
const detail = computed(() => data.value?.data);
</script>

<template>
  <div class="space-y-4">
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
          <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="developStatusBadgeClass(detail.status)">
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
      </header>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div class="grid min-w-0 gap-4">
          <DevelopRequestContent :detail="detail" />
          <DevelopReviewPanel
            :request-id="detail.requestId"
            :review="detail.review"
            :ai-consent="detail.aiConsent"
            :ai-supplement="detail.aiSupplement"
            :title="detail.title"
          />
          <DevelopDiagramPanel
            :request-id="detail.requestId"
            :diagram="detail.diagram"
            :ai-consent="detail.aiConsent"
          />
          <DevelopQuoteSection :detail="detail" />
          <DevelopTimeline :request-id="detail.requestId" :events="detail.events" :status="detail.status" />
        </div>
        <DevelopSideCards :detail="detail" />
      </div>
    </template>
  </div>
</template>
