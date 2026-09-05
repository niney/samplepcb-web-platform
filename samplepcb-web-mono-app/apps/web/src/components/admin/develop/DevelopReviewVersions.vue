<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopReviewVersionListResponseType, DevelopReviewVersionMetaType } from '@sp/api-contract';
import { DevReviewView, apiErrorMessage } from '@sp/ui';
import { useAdminDevelopReviewRestore, useAdminDevelopReviewVersion } from '../../../admin/useAdminDevelop';
import { formatDateTime } from '../../../lib/format';
import DevelopReviewDiff from './DevelopReviewDiff.vue';

// 검토서 버전 원장 탭(docs/DEVELOP_FLOW.md §6.2) — 왼쪽 목록(최신 위)에서 A·B 두 판을 골라 오른쪽에서 구조 비교.
// 기본 선택은 "공개본 ↔ 작업본"(지금 공개하면 고객에게 무엇이 바뀌는지). 공개본이 없으면 최신 AI 초안 ↔ 작업본.
// 복원은 그 판을 작업본으로 덮고 새 working 버전을 쌓는다(이력은 안 지움) — 편집기는 seedKey(editedAt)가 바뀌어 다시 선다.
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

const KIND_CLASS: Record<DevelopReviewVersionMetaType['kind'], string> = {
  ai_draft: 'bg-indigo-100 text-indigo-700',
  working: 'bg-gray-100 text-gray-700',
  published: 'bg-emerald-100 text-emerald-700',
};

const label = (seq: number | null): string => {
  const v = items.value.find((x) => x.seq === seq);
  return v === undefined ? '' : `v${String(v.seq)} · ${t(`admin.develop.review.versions.kind.${v.kind}`)} · ${formatDateTime(v.createdAt)}`;
};

const confirmSeq = ref<number | null>(null);
async function onRestore(seq: number): Promise<void> {
  try {
    await restore.mutateAsync({ requestId: props.requestId, seq });
    confirmSeq.value = null;
    emit('notice', t('admin.develop.review.versions.restored', { seq }), false);
  } catch (error) {
    emit('notice', apiErrorMessage(error, t('admin.develop.review.versions.restoreFail')), true);
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p class="text-xs text-gray-500">{{ t('admin.develop.review.versions.hint') }}</p>

    <p v-if="isLoading" class="py-6 text-center text-sm text-gray-400">{{ t('admin.develop.review.versions.loading') }}</p>
    <p v-else-if="isError" class="py-6 text-center text-sm text-red-600">{{ t('admin.develop.review.versions.loadFail') }}</p>
    <p v-else-if="items.length === 0" class="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400">
      {{ t('admin.develop.review.versions.empty') }}
    </p>

    <div v-else class="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
      <!-- 목록 -->
      <ol class="grid content-start gap-1.5">
        <li
          v-for="v in items"
          :key="v.seq"
          class="grid gap-1 rounded-lg border bg-white px-3 py-2"
          :class="v.seq === seqA || v.seq === seqB ? 'border-blue-300' : 'border-gray-200'"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-sm font-bold text-gray-800">v{{ v.seq }}</span>
            <span class="rounded-full px-1.5 py-0.5 text-[11px] font-bold" :class="KIND_CLASS[v.kind]">
              {{ t(`admin.develop.review.versions.kind.${v.kind}`) }}
            </span>
            <span v-if="v.seq === current.draftSeq" class="rounded-full border border-indigo-200 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">{{ t('admin.develop.review.versions.current.draft') }}</span>
            <span v-if="v.seq === current.workingSeq" class="rounded-full border border-gray-300 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700">{{ t('admin.develop.review.versions.current.working') }}</span>
            <span v-if="v.seq === current.publicSeq" class="rounded-full border border-emerald-300 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">{{ t('admin.develop.review.versions.current.public') }}</span>
            <span class="ml-auto text-xs text-gray-500">{{ formatDateTime(v.createdAt) }}</span>
          </div>
          <p class="truncate text-xs text-gray-600">
            {{ v.author }}<template v-if="v.note !== null"> · {{ v.note }}</template>
            <template v-if="v.parentSeq !== null"> (← v{{ v.parentSeq }})</template>
          </p>
          <p v-if="v.summary !== ''" class="truncate text-xs text-gray-500">{{ v.summary }}</p>
          <div class="flex flex-wrap items-center gap-1 pt-0.5">
            <label class="inline-flex items-center gap-1 text-xs font-semibold text-gray-600">
              <input v-model="seqA" type="radio" name="dev-review-version-a" :value="v.seq" class="h-3.5 w-3.5">{{ t('admin.develop.review.versions.pickA') }}
            </label>
            <label class="inline-flex items-center gap-1 text-xs font-semibold text-gray-600">
              <input v-model="seqB" type="radio" name="dev-review-version-b" :value="v.seq" class="h-3.5 w-3.5">{{ t('admin.develop.review.versions.pickB') }}
            </label>
            <button
              type="button"
              class="ml-auto rounded-md border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
              @click="viewSeq = viewSeq === v.seq ? null : v.seq"
            >
              {{ viewSeq === v.seq ? t('admin.develop.review.versions.hideView') : t('admin.develop.review.versions.view') }}
            </button>
            <template v-if="v.seq !== current.workingSeq">
              <template v-if="confirmSeq === v.seq">
                <span class="text-[11px] font-semibold text-amber-700">{{ t('admin.develop.review.versions.restoreConfirm', { seq: v.seq }) }}</span>
                <span v-if="dirty" class="text-[11px] font-semibold text-red-600">{{ t('admin.develop.review.versions.restoreDirtyWarn') }}</span>
                <button
                  type="button"
                  class="rounded-md bg-amber-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-40"
                  :disabled="restore.isPending.value"
                  @click="onRestore(v.seq)"
                >
                  {{ t('admin.develop.review.versions.restoreYes') }}
                </button>
                <button type="button" class="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-600" @click="confirmSeq = null">
                  {{ t('admin.develop.cancel') }}
                </button>
              </template>
              <button
                v-else
                type="button"
                class="rounded-md border border-amber-300 px-2 py-0.5 text-xs font-bold text-amber-700 hover:bg-amber-50"
                @click="confirmSeq = v.seq"
              >
                {{ t('admin.develop.review.versions.restore') }}
              </button>
            </template>
          </div>
        </li>
      </ol>

      <!-- 오른쪽: 보기 또는 비교 -->
      <div class="min-w-0">
        <div v-if="viewSeq !== null" class="rounded-lg border border-gray-200 bg-white p-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="text-sm font-bold text-gray-800">{{ label(viewSeq) }}</span>
            <button type="button" class="ml-auto rounded-md border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-600" @click="viewSeq = null">
              {{ t('admin.develop.review.versions.hideView') }}
            </button>
          </div>
          <DevReviewView v-if="viewing.data.value !== undefined" :review="viewing.data.value.data.review" :title="title" :version-label="`v${String(viewSeq)}`" />
          <p v-else class="py-6 text-center text-sm text-gray-400">{{ t('admin.develop.review.versions.loading') }}</p>
        </div>
        <template v-else>
          <p v-if="seqA === null || seqB === null" class="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-400">
            {{ t('admin.develop.review.versions.needTwo') }}
          </p>
          <DevelopReviewDiff
            v-else-if="versionA.data.value !== undefined && versionB.data.value !== undefined"
            :a="versionA.data.value.data.review"
            :b="versionB.data.value.data.review"
            :a-label="label(seqA)"
            :b-label="label(seqB)"
          />
          <p v-else class="py-6 text-center text-sm text-gray-400">{{ t('admin.develop.review.versions.loading') }}</p>
        </template>
      </div>
    </div>
  </div>
</template>
