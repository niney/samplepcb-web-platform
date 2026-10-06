<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_REGISTRY } from '@sp/api-contract';
import type { AdminDevelopReviewVersionListResponseType, DevelopReviewVersionMetaType } from '@sp/api-contract';
import { DevReviewView, apiErrorMessage } from '@sp/ui';
import { useAdminDevelopReviewRestore, useAdminDevelopReviewVersion } from '@/admin/useAdminDevelop';
import { formatDateTime } from '@/lib/format';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import Panel from '@/next/components/common/Panel.vue';
import { confirmDialog } from '@/next/lib/dialog';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Empty, EmptyDescription } from '@/next/components/ui/empty';
import { Spinner } from '@/next/components/ui/spinner';
import DevelopReviewDiff from './DevelopReviewDiff.vue';

// 검토서 버전 원장 탭(docs/DEVELOP_FLOW.md §6.2) — 옛 components/admin/develop/DevelopReviewVersions.vue 의 짝
// (같은 props·emits). 왼쪽 목록(최신 위)에서 A·B 두 판을 골라 오른쪽에서 구조 비교. 기본 선택은 "공개본 ↔ 작업본"
// (지금 공개하면 고객에게 무엇이 바뀌는지), 공개본이 없으면 최신 AI 초안 ↔ 작업본.
// 복원은 그 판을 작업본으로 덮고 새 working 버전을 쌓는다(이력은 안 지움) — 편집기는 seedKey(editedAt)가 바뀌어 다시 선다.
// A·B 고르기는 목록 행을 가로지르는 두 묶음이라 RadioGroup 하나로 못 묶는다 — 버튼에 radio 역할을 준다(이름 'A'·'B' 유지).
const props = defineProps<{
  requestId: number;
  list: AdminDevelopReviewVersionListResponseType['data'] | undefined;
  isLoading: boolean;
  isError: boolean;
  dirty: boolean;
  title: string;
}>();
const emit = defineEmits<{ notice: [message: string, isError: boolean] }>();

const { t } = useI18n();
const restore = useAdminDevelopReviewRestore();

const items = computed(() => props.list?.items ?? []);
const current = computed(() => props.list?.current ?? { draftSeq: null, workingSeq: null, publicSeq: null });

const seqA = ref<number | null>(null);
const seqB = ref<number | null>(null);
const has = (seq: number | null): boolean => seq !== null && items.value.some((v) => v.seq === seq);

// 목록이 오면(또는 바뀌면) 기본 두 판을 고른다 — 이미 고른 판이 아직 있으면 존중한다.
watch(
  items,
  (rows) => {
    if (rows.length === 0) return;
    if (!has(seqA.value) || !has(seqB.value) || seqA.value === seqB.value) {
      const working = current.value.workingSeq ?? rows[0]?.seq ?? null;
      const pub = current.value.publicSeq;
      const latestDraft = rows.find((v) => v.kind === 'ai_draft')?.seq ?? null;
      let a = pub ?? latestDraft;
      if (a === null || a === working) a = rows.find((v) => v.seq !== working)?.seq ?? null;
      seqA.value = a;
      seqB.value = working;
    }
  },
  { immediate: true },
);

const requestIdRef = computed(() => props.requestId);
const versionA = useAdminDevelopReviewVersion(requestIdRef, seqA);
const versionB = useAdminDevelopReviewVersion(requestIdRef, seqB);

const viewSeq = ref<number | null>(null);
const viewing = useAdminDevelopReviewVersion(requestIdRef, viewSeq);

// AI 초안=진행색(옛 남색) · 작업본=중립 · 공개=완료색.
const KIND_VARIANT: Record<DevelopReviewVersionMetaType['kind'], BadgeVariant> = {
  ai_draft: 'info',
  working: 'secondary',
  published: 'success',
};

const label = (seq: number | null): string => {
  const v = items.value.find((x) => x.seq === seq);
  return v === undefined ? '' : `v${String(v.seq)} · ${t(`admin.develop.review.versions.kind.${v.kind}`)} · ${formatDateTime(v.createdAt)}`;
};

const toggleView = (seq: number): void => {
  viewSeq.value = viewSeq.value === seq ? null : seq;
};

// 복원 확인 — 옛 화면의 행 안 인라인 확인(문구·'복원' 버튼)을 확인 대화상자로. 편집 중이면 경고 한 줄을 더하고
// 되돌릴 수 없는 손실(저장 안 한 편집)이라 위험 톤으로 묻는다.
async function onRestore(seq: number): Promise<void> {
  const message = props.dirty
    ? `${t('admin.develop.review.versions.restoreConfirm', { seq })}\n${t('admin.develop.review.versions.restoreDirtyWarn')}`
    : t('admin.develop.review.versions.restoreConfirm', { seq });
  const ok = await confirmDialog({
    message,
    confirmLabel: t('admin.develop.review.versions.restoreYes'),
    tone: props.dirty ? 'danger' : 'default',
  });
  if (!ok) return;
  try {
    await restore.mutateAsync({ requestId: props.requestId, seq });
    emit('notice', t('admin.develop.review.versions.restored', { seq }), false);
  } catch (error) {
    emit('notice', apiErrorMessage(error, t('admin.develop.review.versions.restoreFail')), true);
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p class="text-muted-foreground text-xs">{{ t('admin.develop.review.versions.hint') }}</p>

    <p v-if="props.isLoading" class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
      <Spinner />
      {{ t('admin.develop.review.versions.loading') }}
    </p>
    <p v-else-if="props.isError" class="text-destructive py-6 text-center text-sm">
      {{ t('admin.develop.review.versions.loadFail') }}
    </p>
    <Empty v-else-if="items.length === 0">
      <EmptyDescription>{{ t('admin.develop.review.versions.empty') }}</EmptyDescription>
    </Empty>

    <div v-else class="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <!-- 목록 -->
      <ol class="grid content-start gap-1.5">
        <li v-for="v in items" :key="v.seq">
          <Panel class="grid gap-1" :class="v.seq === seqA || v.seq === seqB ? 'border-primary/50' : ''">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-sm font-semibold tabular-nums">v{{ v.seq }}</span>
              <Badge :variant="KIND_VARIANT[v.kind]">{{ t(`admin.develop.review.versions.kind.${v.kind}`) }}</Badge>
              <Badge v-if="v.seq === current.draftSeq" variant="outline">
                {{ t('admin.develop.review.versions.current.draft') }}
              </Badge>
              <Badge v-if="v.seq === current.workingSeq" variant="outline">
                {{ t('admin.develop.review.versions.current.working') }}
              </Badge>
              <Badge v-if="v.seq === current.publicSeq" variant="outline">
                {{ t('admin.develop.review.versions.current.public') }}
              </Badge>
              <span class="text-muted-foreground ml-auto text-xs tabular-nums">{{ formatDateTime(v.createdAt) }}</span>
            </div>
            <p class="text-muted-foreground truncate text-xs">
              {{ v.author }}<template v-if="v.note !== null"> · {{ v.note }}</template>
              <template v-if="v.parentSeq !== null"> (← v{{ v.parentSeq }})</template>
            </p>
            <p v-if="v.summary !== ''" class="text-muted-foreground truncate text-xs">{{ v.summary }}</p>
            <div class="flex flex-wrap items-center gap-1 pt-0.5">
              <Button
                size="xs"
                role="radio"
                :variant="seqA === v.seq ? 'default' : 'outline'"
                :aria-checked="seqA === v.seq"
                @click="seqA = v.seq"
              >
                {{ t('admin.develop.review.versions.pickA') }}
              </Button>
              <Button
                size="xs"
                role="radio"
                :variant="seqB === v.seq ? 'default' : 'outline'"
                :aria-checked="seqB === v.seq"
                @click="seqB = v.seq"
              >
                {{ t('admin.develop.review.versions.pickB') }}
              </Button>
              <Button variant="ghost" size="xs" class="ml-auto" @click="toggleView(v.seq)">
                {{ viewSeq === v.seq ? t('admin.develop.review.versions.hideView') : t('admin.develop.review.versions.view') }}
              </Button>
              <Button
                v-if="v.seq !== current.workingSeq"
                variant="outline"
                size="xs"
                :disabled="restore.isPending.value"
                @click="onRestore(v.seq)"
              >
                {{ t('admin.develop.review.versions.restore') }}
              </Button>
            </div>
          </Panel>
        </li>
      </ol>

      <!-- 오른쪽: 보기 또는 비교 -->
      <div class="min-w-0">
        <Panel v-if="viewSeq !== null" size="md" class="grid gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">{{ label(viewSeq) }}</span>
            <Button variant="outline" size="xs" class="ml-auto" @click="viewSeq = null">
              {{ t('admin.develop.review.versions.hideView') }}
            </Button>
          </div>
          <!-- 고객이 보는 것과 같은 렌더러(@sp/ui) — 관리자 미리보기를 따로 그리지 않는다 -->
          <DevReviewView
            v-if="viewing.data.value !== undefined"
            :review="viewing.data.value.data.review"
            :title="props.title"
            :version-label="`v${String(viewSeq)}`"
            :registry="DEVELOP_REGISTRY"
          />
          <p v-else class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
            <Spinner />
            {{ t('admin.develop.review.versions.loading') }}
          </p>
        </Panel>
        <template v-else>
          <Empty v-if="seqA === null || seqB === null">
            <EmptyDescription>{{ t('admin.develop.review.versions.needTwo') }}</EmptyDescription>
          </Empty>
          <DevelopReviewDiff
            v-else-if="versionA.data.value !== undefined && versionB.data.value !== undefined"
            :a="versionA.data.value.data.review"
            :b="versionB.data.value.data.review"
            :a-label="label(seqA)"
            :b-label="label(seqB)"
          />
          <p v-else class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
            <Spinner />
            {{ t('admin.develop.review.versions.loading') }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>
