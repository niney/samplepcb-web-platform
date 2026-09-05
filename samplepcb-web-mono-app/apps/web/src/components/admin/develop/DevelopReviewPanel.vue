<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopReviewStateType, MarketDevReviewType } from '@sp/api-contract';
import { DevReviewView, apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopAiRun,
  useAdminDevelopReviewAction,
  useAdminDevelopReviewPut,
  usePatchAdminDevelop,
} from '../../../admin/useAdminDevelop';
import { formatDateTime } from '../../../lib/format';
import DevelopReviewEditor from './DevelopReviewEditor.vue';
import { developReviewIssues } from './develop-review-edit';
import { developReviewStateClass } from './develop-badge';

// AI 검토서 패널(docs/DEVELOP_FLOW.md §7.3) — 3층(초안·작업본·공개본)을 한 자리에서 다룬다.
// 초안 = AI 원본(덮어쓰기 대상) · 작업본 = 관리자가 고치는 것 · 공개본 = 고객이 보는 스냅샷.
// 실행 버튼은 실제 LLM 을 돌린다(수 분) — 진행 중에는 상세 조회가 5초 폴링으로 상태를 따라간다.
const props = defineProps<{
  requestId: number;
  review: AdminDevelopReviewStateType;
  aiConsent: boolean;
  aiSupplement: string | null;
  title: string;
}>();
const emit = defineEmits<{ dirty: [value: boolean] }>();

const { t } = useI18n();

const aiRun = useAdminDevelopAiRun();
const reviewPut = useAdminDevelopReviewPut();
const reviewAction = useAdminDevelopReviewAction();
const patch = usePatchAdminDevelop();

const notice = ref('');
const noticeError = ref(false);
const setNotice = (message: string, isError: boolean): void => {
  notice.value = message;
  noticeError.value = isError;
};

// ── 편집기 상태 ──────────────────────────────────────────────────────────────
// 편집 원본은 작업본, 없으면 초안(저장하면 그것이 작업본이 된다).
const source = computed<MarketDevReviewType | null>(() => props.review.working ?? props.review.draft);
const fromDraftOnly = computed(() => props.review.working === null && props.review.draft !== null);
// 재시드 키 — 작업본이 있으면 편집 시각, 없으면 초안 시각. 폴링 재조회로는 바뀌지 않는다.
const seedKey = computed(() =>
  props.review.working === null
    ? `${String(props.requestId)}:draft:${props.review.draftAt ?? ''}`
    : `${String(props.requestId)}:work:${props.review.editedAt ?? ''}`,
);

const working = ref<MarketDevReviewType | null>(null);
const dirty = ref(false);
const onEditorUpdate = (review: MarketDevReviewType, isDirty: boolean): void => {
  working.value = review;
  dirty.value = isDirty;
  emit('dirty', isDirty);
};

const tab = ref<'edit' | 'preview'>('edit');
const previewReview = computed<MarketDevReviewType | null>(() => working.value ?? source.value);

const issues = ref<string[]>([]);

async function onSave(): Promise<void> {
  const review = working.value;
  if (review === null) return;
  const found = developReviewIssues(review);
  issues.value = found;
  if (found.length > 0) {
    setNotice(t('admin.develop.review.saveBlocked'), true);
    return;
  }
  try {
    await reviewPut.mutateAsync({ requestId: props.requestId, review });
    setNotice(t('admin.develop.review.saved'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.review.saveFail')), true);
  }
}

const confirmReset = ref(false);

async function runAction(action: 'publish' | 'unpublish' | 'reset'): Promise<void> {
  try {
    await reviewAction.mutateAsync({ requestId: props.requestId, action });
    confirmReset.value = false;
    setNotice(t(`admin.develop.review.done.${action}`), false);
  } catch (error) {
    setNotice(
      apiErrorMessage(error, t('admin.develop.review.actionFail'), {
        REVIEW_EMPTY: t('admin.develop.review.errorReviewEmpty'),
        DRAFT_EMPTY: t('admin.develop.review.errorDraftEmpty'),
      }),
      true,
    );
  }
}

async function onRegenerate(): Promise<void> {
  try {
    const res = await aiRun.mutateAsync({ requestId: props.requestId, kind: 'review' });
    setNotice(
      res.data.skipped === null
        ? t('admin.develop.review.runStarted')
        : t('admin.develop.review.runSkipped', { reason: res.data.skipped }),
      res.data.skipped !== null,
    );
  } catch (error) {
    setNotice(
      apiErrorMessage(error, t('admin.develop.review.runFail'), {
        AI_CONSENT_REQUIRED: t('admin.develop.noAiConsentHint'),
        AI_RUNNING: t('admin.develop.review.errorRunning'),
      }),
      true,
    );
  }
}

// ── AI 보충 메모 ─────────────────────────────────────────────────────────────
const supplement = ref(props.aiSupplement ?? '');
watch(
  () => props.aiSupplement,
  (value) => {
    supplement.value = value ?? '';
  },
);
const supplementDirty = computed(() => supplement.value !== (props.aiSupplement ?? ''));

async function onSaveSupplement(): Promise<void> {
  try {
    await patch.mutateAsync({
      requestId: props.requestId,
      body: { aiSupplement: supplement.value.trim() === '' ? null : supplement.value.trim() },
    });
    setNotice(t('admin.develop.review.supplementSaved'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.review.saveFail')), true);
  }
}

const busy = computed(
  () => reviewPut.isPending.value || reviewAction.isPending.value || aiRun.isPending.value,
);
</script>

<template>
  <section class="rounded-xl border border-blue-100 bg-blue-50/20 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-base font-bold text-gray-800">{{ t('admin.develop.review.title') }}</h2>
      <span
        class="rounded-full px-2 py-0.5 text-xs font-bold"
        :class="developReviewStateClass(review.draftRunning ? 'running' : review.publicReview !== null ? 'published' : source !== null ? 'ready' : review.draftError !== null ? 'error' : 'none')"
      >
        {{ review.draftRunning
          ? t('admin.develop.reviewState.running')
          : review.publicReview !== null
            ? t('admin.develop.reviewState.published')
            : source !== null
              ? t('admin.develop.reviewState.ready')
              : t('admin.develop.reviewState.none') }}
      </span>
      <span v-if="review.stale" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
        {{ t('admin.develop.review.stale') }}
      </span>
      <span v-if="review.publishedStale" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
        {{ t('admin.develop.review.publishedStale') }}
      </span>
      <button
        type="button"
        class="ml-auto rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        :disabled="!aiConsent || review.draftRunning || busy"
        :title="aiConsent ? '' : t('admin.develop.noAiConsentHint')"
        @click="onRegenerate"
      >
        {{ review.draftRunning ? t('admin.develop.review.running') : t('admin.develop.review.regenerate') }}
      </button>
    </div>

    <p v-if="!aiConsent" class="mt-2 text-sm font-semibold text-amber-700">{{ t('admin.develop.noAiConsentHint') }}</p>
    <p v-if="review.draftError !== null" class="mt-2 text-sm font-semibold text-red-600">
      {{ t('admin.develop.review.draftError', { error: review.draftError }) }}
    </p>
    <p v-if="notice !== ''" class="mt-2 text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">
      {{ notice }}
    </p>
    <ul v-if="issues.length > 0" class="mt-1.5 grid gap-0.5 text-xs text-red-600">
      <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
    </ul>

    <dl class="mt-2 grid grid-cols-[80px_1fr] gap-y-1 text-xs text-gray-500">
      <dt>{{ t('admin.develop.review.draftAt') }}</dt>
      <dd>{{ review.draftAt === null ? '—' : formatDateTime(review.draftAt) }}</dd>
      <dt>{{ t('admin.develop.review.editedAt') }}</dt>
      <dd>
        {{ review.editedAt === null ? '—' : formatDateTime(review.editedAt) }}
        <span v-if="review.editedBy !== null"> · {{ review.editedBy }}</span>
      </dd>
      <dt>{{ t('admin.develop.review.publishedAt') }}</dt>
      <dd>{{ review.publishedAt === null ? t('admin.develop.review.notPublished') : formatDateTime(review.publishedAt) }}</dd>
    </dl>

    <!-- AI 보충 메모 — 코퍼스에 담당자 자료로 합류한다. 고객 비노출. -->
    <div class="mt-4 grid gap-1">
      <span class="text-sm font-semibold text-gray-700">{{ t('admin.develop.review.supplement') }}</span>
      <textarea
        v-model="supplement"
        rows="3"
        :maxlength="20000"
        :placeholder="t('admin.develop.review.supplementPlaceholder')"
        class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs leading-relaxed"
      />
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-500">{{ t('admin.develop.review.supplementHint') }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="!supplementDirty || patch.isPending.value"
          @click="onSaveSupplement"
        >
          {{ t('admin.develop.review.supplementSave') }}
        </button>
      </div>
    </div>

    <!-- 작업본 -->
    <div v-if="source === null" class="mt-4 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center">
      <p class="text-base font-semibold text-gray-700">{{ t('admin.develop.review.emptyTitle') }}</p>
      <p class="mt-1 text-sm text-gray-500">{{ t('admin.develop.review.emptyHint') }}</p>
    </div>
    <template v-else>
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <div class="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm font-semibold">
          <button
            type="button"
            class="rounded-md px-3 py-1"
            :class="tab === 'edit' ? 'bg-blue-600 text-white' : 'text-gray-600'"
            @click="tab = 'edit'"
          >
            {{ t('admin.develop.review.tabEdit') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1"
            :class="tab === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-600'"
            @click="tab = 'preview'"
          >
            {{ t('admin.develop.review.tabPreview') }}
          </button>
        </div>
        <span v-if="fromDraftOnly" class="text-xs font-semibold text-amber-700">{{ t('admin.develop.review.fromDraft') }}</span>
        <span v-else-if="dirty" class="text-xs font-semibold text-amber-700">{{ t('admin.develop.review.dirty') }}</span>

        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="busy || working === null"
            @click="onSave"
          >
            {{ reviewPut.isPending.value ? t('admin.develop.saving') : t('admin.develop.review.save') }}
          </button>
          <template v-if="confirmReset">
            <button
              type="button"
              class="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40"
              :disabled="busy"
              @click="runAction('reset')"
            >
              {{ t('admin.develop.review.resetConfirm') }}
            </button>
            <button type="button" class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600" @click="confirmReset = false">
              {{ t('admin.develop.cancel') }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="busy || review.draft === null"
            @click="confirmReset = true"
          >
            {{ t('admin.develop.review.reset') }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            :disabled="busy || review.working === null"
            @click="runAction('publish')"
          >
            {{ review.publicReview === null ? t('admin.develop.review.publish') : t('admin.develop.review.republish') }}
          </button>
          <button
            v-if="review.publicReview !== null"
            type="button"
            class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="busy"
            @click="runAction('unpublish')"
          >
            {{ t('admin.develop.review.unpublish') }}
          </button>
        </div>
      </div>
      <p v-if="dirty" class="mt-1 text-xs text-gray-500">{{ t('admin.develop.review.publishUsesSaved') }}</p>

      <div class="mt-3 rounded-lg border border-gray-200 bg-white p-4">
        <DevelopReviewEditor
          v-show="tab === 'edit'"
          :source="source"
          :seed-key="seedKey"
          :disabled="busy"
          @update="onEditorUpdate"
        />
        <DevReviewView v-if="tab === 'preview' && previewReview !== null" :review="previewReview" :title="title" />
      </div>
    </template>
  </section>
</template>
