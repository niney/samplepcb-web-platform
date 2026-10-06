<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { SparklesIcon } from '@lucide/vue';
import { DEVELOP_REGISTRY } from '@sp/api-contract';
import type { AdminDevelopReviewStateType, DevelopAiReviewStateType, MarketDevReviewType } from '@sp/api-contract';
import { DevReviewView, apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopAiRun,
  useAdminDevelopReviewAction,
  useAdminDevelopReviewPut,
  useAdminDevelopReviewVersions,
  usePatchAdminDevelop,
} from '@/admin/useAdminDevelop';
import { developReviewIssues } from '@/components/admin/develop/develop-review-edit';
import { formatDateTime } from '@/lib/format';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { developReviewStateVariant } from '@/next/components/develop/develop-badges';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/next/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';
import DevelopReviewEditor from './DevelopReviewEditor.vue';
import DevelopReviewVersions from './DevelopReviewVersions.vue';

// AI 검토서 패널(docs/DEVELOP_FLOW.md §6·§7.3) — 옛 components/admin/develop/DevelopReviewPanel.vue 의 짝(같은 props·emits).
// 3층(초안·작업본·공개본)을 한 자리에서 다룬다. 초안 = AI 원본(덮어쓰기 대상) · 작업본 = 관리자가 고치는 것 ·
// 공개본 = 고객이 보는 스냅샷. 재생성은 실제 LLM 을 돌린다(수 분) — 진행 중에는 상세 조회가 5초 폴링으로 상태를 따라가고,
// 머리 배지·재생성 버튼이 '생성 중'으로 바뀐다. 요청(훅·본문)은 옛 패널과 같다.
// 탭(편집·미리보기·버전)은 공용 QueueTabs — 저장·초안 가져오기·공개는 탭 줄 오른쪽. 편집기는 v-show 로 늘 마운트해
// 미리보기·버전 탭을 오가도 편집 중 내용이 남는다(dirty 를 상세의 이탈 가드로 올린다).
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

// 머리 상태 배지 — 옛 패널과 같은 우선순위(생성 중 → 공개 → 작성됨 → 실패/없음).
const reviewState = computed<DevelopAiReviewStateType>(() =>
  props.review.draftRunning
    ? 'running'
    : props.review.publicReview !== null
      ? 'published'
      : source.value !== null
        ? 'ready'
        : props.review.draftError !== null
          ? 'error'
          : 'none',
);

type PanelTab = 'edit' | 'preview' | 'versions';
const tab = ref<PanelTab>('edit');
const previewReview = computed<MarketDevReviewType | null>(() => working.value ?? source.value);

// 버전 원장(§6.2) — 목록은 가벼워(본문 없음) 검토서가 있으면 늘 받아 둔다: 편집 탭의 "v{n} 작업본" 줄과 버전 탭이 같이 쓴다.
const requestIdRef = computed(() => props.requestId);
const versionsEnabled = computed(() => source.value !== null);
const versions = useAdminDevelopReviewVersions(requestIdRef, versionsEnabled);
const workingSeq = computed(() => versions.data.value?.data.current.workingSeq ?? null);
const workingVersionLabel = computed(() =>
  workingSeq.value === null ? undefined : t('admin.develop.review.versions.workingLine', { seq: workingSeq.value }),
);

const tabs = computed<QueueTab<PanelTab>[]>(() => [
  { key: 'edit', label: t('admin.develop.review.tabEdit') },
  { key: 'preview', label: t('admin.develop.review.tabPreview') },
  { key: 'versions', label: t('admin.develop.review.tabVersions'), count: versions.data.value?.data.items.length ?? null },
]);

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

async function runAction(action: 'publish' | 'unpublish' | 'reset'): Promise<void> {
  try {
    await reviewAction.mutateAsync({ requestId: props.requestId, action });
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

// 초안 가져오기 — 옛 화면의 인라인 확인(문구 버튼 + 취소)을 확인 대화상자로. 덮인 작업본은 버전 원장에 남아
// 복원할 수 있으니 위험 톤은 아니다.
async function onReset(): Promise<void> {
  const ok = await confirmDialog({
    message: t('admin.develop.review.resetConfirm'),
    confirmLabel: t('admin.develop.review.reset'),
  });
  if (ok) await runAction('reset');
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
const setSupplement = (value: string | number): void => {
  supplement.value = String(value);
};

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

const busy = computed(() => reviewPut.isPending.value || reviewAction.isPending.value || aiRun.isPending.value);
</script>

<template>
  <SectionCard :title="t('admin.develop.review.title')">
    <template #meta>
      <span class="inline-flex flex-wrap items-center gap-1.5">
        <Badge :variant="developReviewStateVariant(reviewState)">{{ t(`admin.develop.reviewState.${reviewState}`) }}</Badge>
        <Badge v-if="props.review.stale" variant="warning">{{ t('admin.develop.review.stale') }}</Badge>
        <Badge v-if="props.review.publishedStale" variant="warning">{{ t('admin.develop.review.publishedStale') }}</Badge>
      </span>
    </template>
    <template #actions>
      <Button
        variant="outline"
        size="sm"
        :disabled="!props.aiConsent || props.review.draftRunning || busy"
        :title="props.aiConsent ? '' : t('admin.develop.noAiConsentHint')"
        @click="onRegenerate"
      >
        <Spinner v-if="props.review.draftRunning" />
        <SparklesIcon v-else />
        {{ props.review.draftRunning ? t('admin.develop.review.running') : t('admin.develop.review.regenerate') }}
      </Button>
    </template>
    <template v-if="!props.aiConsent || props.review.draftError !== null" #notice>
      <NoticeBand v-if="!props.aiConsent" tone="warning">{{ t('admin.develop.noAiConsentHint') }}</NoticeBand>
      <NoticeBand v-if="props.review.draftError !== null" tone="destructive">
        {{ t('admin.develop.review.draftError', { error: props.review.draftError }) }}
      </NoticeBand>
    </template>

    <div class="grid gap-5">
      <Alert v-if="notice !== ''" :variant="noticeError ? 'destructive' : 'success'" size="sm">
        <AlertDescription>
          <p>{{ notice }}</p>
          <ul v-if="issues.length > 0" class="mt-1 grid gap-0.5 text-xs">
            <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
          </ul>
        </AlertDescription>
      </Alert>

      <dl class="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt>{{ t('admin.develop.review.draftAt') }}</dt>
        <dd class="tabular-nums">{{ props.review.draftAt === null ? '—' : formatDateTime(props.review.draftAt) }}</dd>
        <dt>{{ t('admin.develop.review.editedAt') }}</dt>
        <dd class="tabular-nums">
          {{ props.review.editedAt === null ? '—' : formatDateTime(props.review.editedAt) }}
          <span v-if="props.review.editedBy !== null"> · {{ props.review.editedBy }}</span>
        </dd>
        <dt>{{ t('admin.develop.review.publishedAt') }}</dt>
        <dd class="tabular-nums">
          {{ props.review.publishedAt === null ? t('admin.develop.review.notPublished') : formatDateTime(props.review.publishedAt) }}
        </dd>
      </dl>

      <!-- AI 보충 메모 — 코퍼스에 담당자 자료로 합류한다. 고객 비노출. -->
      <Field>
        <FieldLabel for="dev-review-supplement">{{ t('admin.develop.review.supplement') }}</FieldLabel>
        <Textarea
          id="dev-review-supplement"
          :model-value="supplement"
          rows="3"
          :maxlength="20000"
          :placeholder="t('admin.develop.review.supplementPlaceholder')"
          @update:model-value="setSupplement"
        />
        <div class="flex flex-wrap items-center gap-2">
          <FieldDescription>{{ t('admin.develop.review.supplementHint') }}</FieldDescription>
          <Button
            variant="outline"
            size="sm"
            class="ml-auto"
            :disabled="!supplementDirty || patch.isPending.value"
            @click="onSaveSupplement"
          >
            {{ t('admin.develop.review.supplementSave') }}
          </Button>
        </div>
      </Field>

      <!-- 작업본 -->
      <Empty v-if="source === null">
        <EmptyHeader>
          <EmptyTitle>{{ t('admin.develop.review.emptyTitle') }}</EmptyTitle>
          <EmptyDescription>{{ t('admin.develop.review.emptyHint') }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <div v-else class="grid gap-3">
        <QueueTabs v-model="tab" :tabs="tabs">
          <template #end>
            <Button size="sm" :disabled="busy || working === null" @click="onSave">
              {{ reviewPut.isPending.value ? t('admin.develop.saving') : t('admin.develop.review.save') }}
            </Button>
            <Button variant="outline" size="sm" :disabled="busy || props.review.draft === null" @click="onReset">
              {{ t('admin.develop.review.reset') }}
            </Button>
            <Button variant="success" size="sm" :disabled="busy || props.review.working === null" @click="runAction('publish')">
              {{ props.review.publicReview === null ? t('admin.develop.review.publish') : t('admin.develop.review.republish') }}
            </Button>
            <Button
              v-if="props.review.publicReview !== null"
              variant="outline"
              size="sm"
              :disabled="busy"
              @click="runAction('unpublish')"
            >
              {{ t('admin.develop.review.unpublish') }}
            </Button>
          </template>
        </QueueTabs>

        <div
          v-if="workingVersionLabel !== undefined || fromDraftOnly || dirty"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        >
          <span v-if="workingVersionLabel !== undefined" class="text-muted-foreground tabular-nums">{{ workingVersionLabel }}</span>
          <span v-if="fromDraftOnly" class="text-warning font-semibold">{{ t('admin.develop.review.fromDraft') }}</span>
          <span v-else-if="dirty" class="text-warning font-semibold">{{ t('admin.develop.review.dirty') }}</span>
          <span v-if="dirty" class="text-muted-foreground">{{ t('admin.develop.review.publishUsesSaved') }}</span>
        </div>

        <DevelopReviewEditor
          v-show="tab === 'edit'"
          :source="source"
          :seed-key="seedKey"
          :disabled="busy"
          @update="onEditorUpdate"
        />
        <!-- 고객이 보는 것과 같은 렌더러(@sp/ui) — 저장 전 편집 내용으로 미리 본다 -->
        <Panel v-if="tab === 'preview' && previewReview !== null" size="md">
          <DevReviewView
            :review="previewReview"
            :title="props.title"
            :version-label="workingVersionLabel"
            :registry="DEVELOP_REGISTRY"
          />
        </Panel>
        <DevelopReviewVersions
          v-if="tab === 'versions'"
          :request-id="props.requestId"
          :list="versions.data.value?.data"
          :is-loading="versions.isLoading.value"
          :is-error="versions.isError.value"
          :dirty="dirty"
          :title="props.title"
          @notice="setNotice"
        />
      </div>
    </div>
  </SectionCard>
</template>
