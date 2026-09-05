<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { usePatchAdminDevelop } from '../../../admin/useAdminDevelop';
import { formatDateTime } from '../../../lib/format';

// 헤더 아래 운영 띠 — 옛 우측 사이드(내부 메모·검수 기간·견적 요약·진행 시각)를 본문 폭으로 흡수했다.
// 사이드는 카드 4개가 짧게 놓이고 아래가 비었는데 본문(편집기·타임라인)은 좁아서 손해였다(2026-09-05 사용자 결정).
//   · 진행 시각 → 칩 한 줄   · 검수 기간 → 인라인 입력   · 내부 메모 → 접힘 패널(기본 접힘, 첫 줄 미리보기)
//   · 견적 요약 → 삭제(본문 견적 섹션이 전체를 보인다)
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();

const { t } = useI18n();
const patch = usePatchAdminDevelop();

const memo = ref(props.detail.internalMemo ?? '');
const memoOpen = ref(false);
const reviewDays = ref(String(props.detail.reviewDays));
const notice = ref('');
const noticeError = ref(false);

watch(
  () => props.detail.internalMemo,
  (value) => {
    memo.value = value ?? '';
  },
);
watch(
  () => props.detail.reviewDays,
  (value) => {
    reviewDays.value = String(value);
  },
);

const memoDirty = computed(() => memo.value !== (props.detail.internalMemo ?? ''));
const memoPreview = computed(() => {
  const first = (props.detail.internalMemo ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
  return first.length > 80 ? `${first.slice(0, 80)}…` : first;
});
const parsedReviewDays = computed(() => Number(reviewDays.value));
const reviewDaysValid = computed(
  () => Number.isInteger(parsedReviewDays.value) && parsedReviewDays.value >= 1 && parsedReviewDays.value <= 90,
);
const reviewDaysDirty = computed(() => reviewDaysValid.value && parsedReviewDays.value !== props.detail.reviewDays);

async function save(body: { internalMemo?: string | null; reviewDays?: number }): Promise<void> {
  notice.value = '';
  try {
    await patch.mutateAsync({ requestId: props.detail.requestId, body });
    noticeError.value = false;
    notice.value = t('admin.develop.side.saved');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.side.saveFail'));
  }
}

const timestamps = computed(() =>
  [
    { key: 'received', at: props.detail.createdAt },
    { key: 'started', at: props.detail.startedAt },
    { key: 'delivered', at: props.detail.deliveredAt },
    { key: 'completed', at: props.detail.completedAt },
    { key: 'cancelled', at: props.detail.cancelledAt },
  ].filter((row): row is { key: string; at: string } => row.at !== null),
);
</script>

<template>
  <div class="grid gap-2.5">
    <!-- 진행 시각 칩 + 검수 기간 -->
    <div class="flex flex-wrap items-center gap-1.5 text-xs">
      <span
        v-for="row in timestamps"
        :key="row.key"
        class="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-gray-600"
      >
        <b class="text-gray-800">{{ t(`admin.develop.side.ts.${row.key}`) }}</b>
        {{ formatDateTime(row.at) }}
      </span>
      <span v-if="detail.cancelReason !== null" class="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
        {{ t('admin.develop.side.cancelReason') }}: {{ detail.cancelReason }}
      </span>
      <span v-if="detail.declinedReason !== null" class="rounded-full bg-red-50 px-2 py-0.5 text-red-700">
        {{ t('admin.develop.side.declinedReason') }}: {{ detail.declinedReason }}
      </span>

      <label class="ml-auto inline-flex items-center gap-1.5 text-gray-600" :title="t('admin.develop.side.reviewDaysHint')">
        {{ t('admin.develop.side.reviewDays') }}
        <input v-model="reviewDays" type="number" min="1" max="90" class="h-8 w-16 rounded-md border border-gray-300 px-2 text-xs">
        {{ t('admin.develop.side.days') }}
        <button
          type="button"
          class="rounded-md border border-gray-300 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="!reviewDaysDirty || patch.isPending.value"
          @click="save({ reviewDays: parsedReviewDays })"
        >
          {{ t('admin.develop.side.save') }}
        </button>
      </label>
    </div>

    <!-- 내부 메모 — 접힘. 고객 비노출. -->
    <div class="rounded-lg border border-dashed border-gray-300 bg-gray-50/60">
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        :aria-expanded="memoOpen"
        @click="memoOpen = !memoOpen"
      >
        <span class="font-bold text-gray-700">{{ t('admin.develop.side.memo') }}</span>
        <span v-if="!memoOpen && memoPreview !== ''" class="min-w-0 flex-1 truncate text-gray-500">{{ memoPreview }}</span>
        <span v-else-if="!memoOpen" class="text-gray-400">{{ t('admin.develop.side.memoPlaceholder') }}</span>
        <span class="ml-auto shrink-0 text-xs text-gray-500">{{ memoOpen ? t('admin.develop.side.memoClose') : t('admin.develop.side.memoOpen') }}</span>
      </button>
      <div v-if="memoOpen" class="grid gap-1.5 border-t border-gray-200 px-3 py-2.5">
        <textarea
          v-model="memo"
          rows="5"
          :maxlength="20000"
          :placeholder="t('admin.develop.side.memoPlaceholder')"
          class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs leading-relaxed"
        />
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500">{{ t('admin.develop.side.memoHint') }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="!memoDirty || patch.isPending.value"
            @click="save({ internalMemo: memo.trim() === '' ? null : memo.trim() })"
          >
            {{ t('admin.develop.side.save') }}
          </button>
        </div>
      </div>
    </div>

    <p v-if="notice !== ''" class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
  </div>
</template>
