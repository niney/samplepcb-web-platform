<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { usePatchAdminDevelop } from '@/admin/useAdminDevelop';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';
import SectionCard from '@/next/components/common/SectionCard.vue';
import ActionNotice from './ActionNotice.vue';

// 헤더 아래 운영 띠(옛 components/admin/develop/DevelopOpsStrip.vue 와 같은 props·동작) — 옛 우측 사이드를 본문 폭으로
// 흡수한 것(2026-09-05 사용자 결정): 진행 시각 → 칩 한 줄 · 검수 기간 → 인라인 입력 · 내부 메모 → 접힘(첫 줄 미리보기).
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
      <Badge v-for="row in timestamps" :key="row.key" variant="outline" class="tabular-nums">
        <span class="font-semibold">{{ t(`admin.develop.side.ts.${row.key}`) }}</span>
        <span class="text-muted-foreground">{{ formatDateTime(row.at) }}</span>
      </Badge>
      <Badge v-if="props.detail.cancelReason !== null" variant="danger">
        {{ t('admin.develop.side.cancelReason') }}: {{ props.detail.cancelReason }}
      </Badge>
      <Badge v-if="props.detail.declinedReason !== null" variant="danger">
        {{ t('admin.develop.side.declinedReason') }}: {{ props.detail.declinedReason }}
      </Badge>

      <label class="text-muted-foreground ml-auto inline-flex items-center gap-1.5" :title="t('admin.develop.side.reviewDaysHint')">
        {{ t('admin.develop.side.reviewDays') }}
        <Input v-model="reviewDays" type="number" min="1" max="90" class="w-16 tabular-nums" />
        {{ t('admin.develop.side.days') }}
        <Button
          variant="outline"
          size="xs"
          :disabled="!reviewDaysDirty || patch.isPending.value"
          @click="void save({ reviewDays: parsedReviewDays })"
        >
          {{ t('admin.develop.side.save') }}
        </Button>
      </label>
    </div>

    <!-- 내부 메모 — 고객 비노출, 기본 접힘(첫 줄 미리보기). -->
    <SectionCard v-model:open="memoOpen" :title="t('admin.develop.side.memo')" collapsible>
      <template #collapsed>
        <span class="text-foreground font-semibold">{{ t('admin.develop.side.memo') }}</span>
        <span v-if="memoPreview !== ''" class="ml-2">{{ memoPreview }}</span>
        <span v-else class="ml-2">{{ t('admin.develop.side.memoPlaceholder') }}</span>
      </template>
      <div class="grid gap-1.5">
        <Textarea
          v-model="memo"
          :rows="5"
          :maxlength="20000"
          :placeholder="t('admin.develop.side.memoPlaceholder')"
          :aria-label="t('admin.develop.side.memo')"
        />
        <div class="flex items-center gap-2">
          <span class="text-muted-foreground text-xs">{{ t('admin.develop.side.memoHint') }}</span>
          <Button
            variant="outline"
            size="xs"
            class="ml-auto"
            :disabled="!memoDirty || patch.isPending.value"
            @click="void save({ internalMemo: memo.trim() === '' ? null : memo.trim() })"
          >
            {{ t('admin.develop.side.save') }}
          </Button>
        </div>
      </div>
    </SectionCard>

    <ActionNotice :text="notice" :error="noticeError" />
  </div>
</template>
