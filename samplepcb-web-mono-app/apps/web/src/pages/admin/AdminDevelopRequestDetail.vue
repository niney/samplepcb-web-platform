<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { DEVELOP_REQUEST_STATUS_LABELS, apiRoutes, marketAreaBadge } from '@sp/api-contract';
import { FilePreviewModal, apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { useAdminDevelopDetail } from '../../admin/useAdminDevelop';
import DevelopDiagramPanel from '../../components/admin/develop/DevelopDiagramPanel.vue';
import DevelopOpsStrip from '../../components/admin/develop/DevelopOpsStrip.vue';
import DevelopQuoteSection from '../../components/admin/develop/DevelopQuoteSection.vue';
import DevelopRequestContent from '../../components/admin/develop/DevelopRequestContent.vue';
import DevelopReviewPanel from '../../components/admin/develop/DevelopReviewPanel.vue';
import DevelopStatusBar from '../../components/admin/develop/DevelopStatusBar.vue';
import DevelopTimeline from '../../components/admin/develop/DevelopTimeline.vue';
import { developStatusBadgeClass } from '../../components/admin/develop/develop-badge';
import { downloadAdminDevelopFile } from '../../components/admin/develop/develop-files';
import { formatDateTime } from '../../lib/format';

// 개발의뢰 전면 상세(docs/DEVELOP_FLOW.md §7.3) — 드로어가 아니라 페이지다.
// AI 산출물 편집·타임라인 작성처럼 오래 머무는 작업이 있어 좁은 서랍에 담기지 않는다.
// 레이아웃(2026-09-05 사용자 결정):
//   · 헤더(상태·담당·운영 띠)는 항상 보이고, 그 아래 다섯 섹션은 **탭**으로 하나씩 본다.
//     다섯 섹션이 모두 길어 한 화면 나열은 스크롤 부담만 컸다. 탭은 URL 쿼리(?tab=)에 두어
//     새로고침·뒤로가기·딥링크가 살고, 패널은 v-show 로 전부 마운트해 편집 중 초안이 탭 이동에 안 날아간다.
//   · 검토서·견적을 쓰면서 의뢰 내용을 같이 보도록 **의뢰 내용 옆 보기**(우측 패널, 자기 스크롤)를 둔다.
//     의뢰 내용 탭에서는 중복이라 숨긴다. 열림 여부는 localStorage 로 기억.
//   · 본문 최대 너비 1120px, 옆 보기가 열리면 그만큼 넓힌다(본문이 좁아지지 않게).
// 상세 조회는 AI 잡이 도는 동안만 5초 폴링한다(useAdminDevelopDetail).

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const requestId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});

const { data, isLoading, isError } = useAdminDevelopDetail(requestId);
const detail = computed(() => data.value?.data);

const TABS = ['content', 'review', 'diagram', 'quotes', 'timeline'] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: unknown): value is Tab => typeof value === 'string' && (TABS as readonly string[]).includes(value);

const tab = computed<Tab>(() => (isTab(route.query.tab) ? route.query.tab : 'content'));
function selectTab(next: Tab): void {
  if (next === tab.value) return;
  const query = { ...route.query };
  if (next === 'content') delete query.tab;
  else query.tab = next;
  void router.replace({ query });
}

// 옆 보기 — 의뢰 내용 탭이 아닐 때만 의미가 있다.
const SIDE_KEY = 'develop.admin.sideContent';
const sideWanted = ref(localStorage.getItem(SIDE_KEY) === '1');
watch(sideWanted, (value) => {
  localStorage.setItem(SIDE_KEY, value ? '1' : '0');
});
const sideOpen = computed(() => sideWanted.value && tab.value !== 'content');

// 탭 배지 — 열어보지 않고도 할 일이 보이게. 편집 중 표시는 자식이 올려준다(저장 누락 방지).
const reviewDirty = ref(false);
const quoteEditing = ref(false);

interface Badge {
  text: string;
  tone: 'gray' | 'blue' | 'amber' | 'red' | 'emerald';
}
const badges = computed<Record<Tab, Badge[]>>(() => {
  const d = detail.value;
  const empty: Record<Tab, Badge[]> = { content: [], review: [], diagram: [], quotes: [], timeline: [] };
  if (d === undefined) return empty;
  const review: Badge[] = [];
  if (d.review.draftRunning) review.push({ text: t('admin.develop.nav.badge.running'), tone: 'blue' });
  else if (d.review.draftError !== null) review.push({ text: t('admin.develop.nav.badge.error'), tone: 'red' });
  else if (d.review.publicReview !== null && d.review.publishedStale) review.push({ text: t('admin.develop.nav.badge.publishedStale'), tone: 'amber' });
  else if (d.review.publicReview !== null) review.push({ text: t('admin.develop.nav.badge.published'), tone: 'emerald' });
  else if (d.review.working !== null || d.review.draft !== null) review.push({ text: t('admin.develop.nav.badge.ready'), tone: 'gray' });
  if (reviewDirty.value) review.push({ text: t('admin.develop.nav.badge.editing'), tone: 'amber' });

  const diagram: Badge[] = [];
  if (d.diagram.published && d.diagram.publishedStale) diagram.push({ text: t('admin.develop.nav.badge.publishedStale'), tone: 'amber' });
  else if (d.diagram.published) diagram.push({ text: t('admin.develop.nav.badge.published'), tone: 'emerald' });
  else if (d.diagram.html !== null) diagram.push({ text: t('admin.develop.nav.badge.ready'), tone: 'gray' });

  const quotes: Badge[] = [];
  if (d.quotes.length > 0) quotes.push({ text: String(d.quotes.length), tone: 'gray' });
  const sent = d.quotes.filter((q) => q.status === 'sent').length;
  if (sent > 0) quotes.push({ text: t('admin.develop.nav.badge.sent', { count: sent }), tone: 'blue' });
  if (quoteEditing.value) quotes.push({ text: t('admin.develop.nav.badge.editing'), tone: 'amber' });

  const timeline: Badge[] = d.events.length > 0 ? [{ text: String(d.events.length), tone: 'gray' }] : [];
  return { content: [], review, diagram, quotes, timeline };
});

// 첨부 미리보기 — 의뢰 첨부·타임라인 첨부·옆 보기 패널이 한 모달을 쓴다(고객 앱과 같은 @sp/ui FilePreviewModal).
const previewFile = ref<PreviewTarget | null>(null);
const previewDownloadError = ref('');
async function downloadFromPreview(fileId: number, name: string): Promise<void> {
  previewDownloadError.value = '';
  try {
    await downloadAdminDevelopFile(fileId, name);
  } catch (error) {
    previewDownloadError.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}

const badgeClass: Record<Badge['tone'], string> = {
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-100 text-blue-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  emerald: 'bg-emerald-100 text-emerald-700',
};
</script>

<template>
  <div class="w-full space-y-4" :class="sideOpen ? 'max-w-[1560px]' : 'max-w-[1120px]'">
    <RouterLink :to="{ name: 'admin-develop-requests' }" class="inline-block text-sm font-semibold text-blue-600 hover:underline">
      ← {{ t('admin.develop.backToList') }}
    </RouterLink>

    <p v-if="isLoading" class="py-16 text-center text-base text-gray-400">{{ t('admin.develop.loading') }}</p>
    <p v-else-if="isError || detail === undefined" class="py-16 text-center text-base text-red-600">
      {{ t('admin.develop.detailFail') }}
    </p>
    <template v-else>
      <!-- 헤더 — 어느 탭에서도 보인다 -->
      <header class="rounded-xl border border-gray-200 bg-white p-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold" :class="developStatusBadgeClass(detail.status)">
            {{ DEVELOP_REQUEST_STATUS_LABELS[detail.status] }}
          </span>
          <span v-if="marketAreaBadge(detail.serviceAreas) !== ''" class="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
            {{ marketAreaBadge(detail.serviceAreas) }}
          </span>
          <span class="text-xs text-gray-400">#{{ detail.requestId }} · {{ formatDateTime(detail.createdAt) }}</span>
        </div>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">{{ detail.title }}</h1>
        <p class="mt-1 text-sm text-gray-500">
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

      <!-- 탭 -->
      <div class="flex flex-wrap items-end gap-2 border-b border-gray-200">
        <nav class="-mb-px flex flex-wrap gap-1" role="tablist">
          <button
            v-for="key in TABS"
            :key="key"
            type="button"
            role="tab"
            :aria-selected="tab === key"
            class="inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors"
            :class="tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'"
            @click="selectTab(key)"
          >
            {{ t(`admin.develop.nav.${key}`) }}
            <span
              v-for="b in badges[key]"
              :key="b.text"
              class="rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none"
              :class="badgeClass[b.tone]"
            >{{ b.text }}</span>
          </button>
        </nav>
        <label v-if="tab !== 'content'" class="mb-1.5 ml-auto inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-gray-600">
          <input v-model="sideWanted" type="checkbox" class="h-3.5 w-3.5 rounded border-gray-300">
          {{ sideWanted ? t('admin.develop.nav.sideClose') : t('admin.develop.nav.sideOpen') }}
        </label>
      </div>

      <!-- 본문 (+ 옆 보기) -->
      <div class="grid min-w-0 items-start gap-4" :class="sideOpen ? 'xl:grid-cols-[minmax(0,1fr)_420px]' : ''">
        <div class="grid min-w-0 gap-4">
          <div v-show="tab === 'content'" role="tabpanel"><DevelopRequestContent :detail="detail" @preview="previewFile = $event" /></div>
          <div v-show="tab === 'review'" role="tabpanel">
            <DevelopReviewPanel
              :request-id="detail.requestId"
              :review="detail.review"
              :ai-consent="detail.aiConsent"
              :ai-supplement="detail.aiSupplement"
              :title="detail.title"
              @dirty="reviewDirty = $event"
            />
          </div>
          <div v-show="tab === 'diagram'" role="tabpanel">
            <DevelopDiagramPanel
              :request-id="detail.requestId"
              :diagram="detail.diagram"
              :ai-consent="detail.aiConsent"
            />
          </div>
          <div v-show="tab === 'quotes'" role="tabpanel"><DevelopQuoteSection :detail="detail" @editing="quoteEditing = $event" /></div>
          <div v-show="tab === 'timeline'" role="tabpanel">
            <DevelopTimeline :request-id="detail.requestId" :events="detail.events" :status="detail.status" @preview="previewFile = $event" />
          </div>
        </div>

        <!-- 옆 보기: 의뢰 내용을 참고하며 쓰도록 자기 스크롤로 붙는다(넓은 화면에서만 옆, 좁으면 아래). -->
        <aside v-if="sideOpen" class="min-w-0 xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto">
          <DevelopRequestContent :detail="detail" @preview="previewFile = $event" />
        </aside>
      </div>

      <p v-if="previewDownloadError !== ''" class="text-sm font-semibold text-red-600">{{ previewDownloadError }}</p>
      <FilePreviewModal
        :open="previewFile !== null"
        :files-path="apiRoutes.adminDevelopFiles"
        :file="previewFile"
        @close="previewFile = null"
        @download="downloadFromPreview"
      />
    </template>
  </div>
</template>
