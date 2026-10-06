<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminMemberDetailType } from '@sp/api-contract';
import { useUpdateMemberMemo } from '@/admin/useAdminMembers';
import { Button } from '@/next/components/ui/button';
import { Textarea } from '@/next/components/ui/textarea';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 관리자 메모 — 항상 표시. 탈퇴 회원은 읽기 전용, 그 외는 바뀌었을 때만 저장 버튼이 켜진다(회사명 저장 관례).
const props = defineProps<{ detail: AdminMemberDetailType }>();
const { t } = useI18n();

const {
  mutate: updateMemo,
  isPending: memoPending,
  isSuccess: memoSaved,
  isError: memoFailed,
  reset: resetMemo,
} = useUpdateMemberMemo();

const memoInput = ref(props.detail.memo ?? '');
const memoChanged = computed<boolean>(() => memoInput.value !== (props.detail.memo ?? ''));

const setMemo = (value: string | number): void => {
  memoInput.value = String(value);
};

const submitMemo = (): void => {
  if (!memoChanged.value) return;
  resetMemo();
  updateMemo({ mbId: props.detail.mbId, memo: memoInput.value });
};
</script>

<template>
  <SectionCard :title="t('admin.members.drawer.memo')">
    <Panel v-if="props.detail.status === 'left'" tone="muted" class="text-sm whitespace-pre-wrap">
      {{ props.detail.memo ?? '-' }}
    </Panel>
    <template v-else>
      <Textarea
        :model-value="memoInput"
        rows="3"
        :aria-label="t('admin.members.drawer.memo')"
        :placeholder="t('admin.members.drawer.memoEdit.placeholder')"
        @update:model-value="setMemo"
      />
      <div class="flex flex-wrap items-center gap-2">
        <Button :disabled="!memoChanged || memoPending" @click="submitMemo">
          {{ t('admin.members.drawer.memoEdit.save') }}
        </Button>
        <span v-if="memoFailed" class="text-destructive text-xs">{{ t('admin.members.drawer.memoEdit.failed') }}</span>
        <span v-else-if="memoSaved" class="text-success text-xs">{{ t('admin.members.drawer.memoEdit.success') }}</span>
      </div>
    </template>
  </SectionCard>
</template>
