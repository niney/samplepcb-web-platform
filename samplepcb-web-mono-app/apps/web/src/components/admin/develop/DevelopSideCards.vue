<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUOTE_KIND_LABELS, DEVELOP_QUOTE_STATUS_LABELS } from '@sp/api-contract';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { usePatchAdminDevelop } from '../../../admin/useAdminDevelop';
import { formatDateTime, formatKrw } from '../../../lib/format';

// 우측 사이드 — 내부 메모 · 검수 기간 · 견적서 요약(읽기) · 진행 타임스탬프.
// 작성·발송은 본문 견적 섹션(DevelopQuoteSection)이 맡고, 여기서는 요약과 앵커만 둔다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();

const { t } = useI18n();
const patch = usePatchAdminDevelop();

const memo = ref(props.detail.internalMemo ?? '');
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
  ].filter((row) => row.at !== null),
);
</script>

<template>
  <div class="grid gap-4">
    <p v-if="notice !== ''" class="text-xs font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>

    <!-- 내부 메모 — 고객 비노출 -->
    <section class="rounded-xl border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.side.memo') }}</h2>
      <textarea
        v-model="memo"
        rows="6"
        :maxlength="20000"
        :placeholder="t('admin.develop.side.memoPlaceholder')"
        class="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed"
      />
      <div class="mt-1.5 flex items-center gap-2">
        <span class="text-[11px] text-gray-500">{{ t('admin.develop.side.memoHint') }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-3 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="!memoDirty || patch.isPending.value"
          @click="save({ internalMemo: memo.trim() === '' ? null : memo.trim() })"
        >
          {{ t('admin.develop.side.save') }}
        </button>
      </div>
    </section>

    <!-- 검수 기간 -->
    <section class="rounded-xl border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.side.reviewDays') }}</h2>
      <div class="mt-2 flex items-center gap-2">
        <input v-model="reviewDays" type="number" min="1" max="90" class="h-8 w-24 rounded-md border border-gray-300 px-2 text-xs">
        <span class="text-xs text-gray-500">{{ t('admin.develop.side.days') }}</span>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-3 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="!reviewDaysDirty || patch.isPending.value"
          @click="save({ reviewDays: parsedReviewDays })"
        >
          {{ t('admin.develop.side.save') }}
        </button>
      </div>
      <p class="mt-1 text-[11px] text-gray-500">{{ t('admin.develop.side.reviewDaysHint') }}</p>
    </section>

    <!-- 견적서(읽기 전용 — 작성은 P2) -->
    <section class="rounded-xl border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.side.quotes', { count: detail.quotes.length }) }}</h2>
      <ul class="mt-2 grid gap-1.5">
        <li v-for="q in detail.quotes" :key="q.quoteId" class="rounded-lg border border-gray-100 px-3 py-2 text-xs">
          <div class="flex flex-wrap items-center gap-1.5">
            <b>v{{ q.version }}</b>
            <span class="text-gray-500">{{ DEVELOP_QUOTE_KIND_LABELS[q.kind] }}</span>
            <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
              {{ DEVELOP_QUOTE_STATUS_LABELS[q.status] }}
            </span>
            <span class="ml-auto font-semibold">{{ formatKrw(q.totalAmount) }}</span>
          </div>
          <p class="mt-0.5 truncate text-[11px] text-gray-500">{{ q.title }}</p>
        </li>
        <li v-if="detail.quotes.length === 0" class="text-xs text-gray-400">{{ t('admin.develop.side.noQuotes') }}</li>
      </ul>
      <a href="#develop-quotes" class="mt-2 inline-block text-[11px] font-semibold text-blue-600 hover:underline">
        {{ t('admin.develop.side.quotesAnchor') }}
      </a>
    </section>

    <!-- 타임스탬프 -->
    <section class="rounded-xl border border-gray-200 bg-white p-4">
      <h2 class="text-sm font-bold text-gray-800">{{ t('admin.develop.side.timestamps') }}</h2>
      <dl class="mt-2 grid grid-cols-[64px_1fr] gap-y-1 text-xs">
        <template v-for="row in timestamps" :key="row.key">
          <dt class="text-gray-500">{{ t(`admin.develop.side.ts.${row.key}`) }}</dt>
          <dd class="text-gray-800">{{ row.at === null ? '—' : formatDateTime(row.at) }}</dd>
        </template>
      </dl>
      <p v-if="detail.cancelReason !== null" class="mt-2 text-xs text-red-600">
        {{ t('admin.develop.side.cancelReason') }}: {{ detail.cancelReason }}
      </p>
      <p v-if="detail.declinedReason !== null" class="mt-1 text-xs text-red-600">
        {{ t('admin.develop.side.declinedReason') }}: {{ detail.declinedReason }}
      </p>
    </section>
  </div>
</template>
