<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_REQUEST_STATUS_LABELS, isDevelopClosed } from '@sp/api-contract';
import type { AdminDevelopStatusBodyType, DevelopRequestStatusType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopStatus, usePatchAdminDevelop } from '../../../admin/useAdminDevelop';

// 상태 전이 + 담당자 배정. 나머지 전이(견적 발송·수락·결제·납품)는 그 행동의 부수효과라 버튼이 없다.
// 사유가 필요한 전이(진행 불가·취소)는 네이티브 대화상자 대신 인라인 패널로 받는다.
const props = defineProps<{ requestId: number; status: DevelopRequestStatusType; assigneeMbId: string | null }>();

const { t } = useI18n();
const auth = useAuthStore();
const transition = useAdminDevelopStatus();
const patch = usePatchAdminDevelop();

const notice = ref('');
const noticeError = ref(false);

type ReasonTarget = 'declined' | 'cancelled';
const reasonTarget = ref<ReasonTarget | null>(null);
const reason = ref('');

const closed = computed(() => isDevelopClosed(props.status));
const canReview = computed(() => props.status === 'received');
const canStart = computed(() => props.status === 'accepted' || props.status === 'delivered');
const canComplete = computed(() => props.status === 'delivered');
const canDecline = computed(() => props.status === 'received' || props.status === 'reviewing' || props.status === 'quoted');
const canCancel = computed(() => !closed.value && props.status !== 'completed');

// 담당자 후보 — 관리자 계정은 실질 하나라 "내 계정 + 이미 배정된 사람"만 고른다.
const assigneeOptions = computed(() => {
  const mine = auth.me?.mbId ?? '';
  const list = new Set<string>();
  if (mine !== '') list.add(mine);
  if (props.assigneeMbId !== null) list.add(props.assigneeMbId);
  return [...list];
});

async function go(to: AdminDevelopStatusBodyType['to'], withReason: string | null): Promise<void> {
  notice.value = '';
  try {
    await transition.mutateAsync({
      requestId: props.requestId,
      body: withReason === null ? { to } : { to, reason: withReason },
    });
    noticeError.value = false;
    notice.value = t('admin.develop.status.done', { status: DEVELOP_REQUEST_STATUS_LABELS[to] });
    reasonTarget.value = null;
    reason.value = '';
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.status.fail'), {
      REASON_REQUIRED: t('admin.develop.status.reasonRequired'),
      INVALID_TRANSITION: t('admin.develop.status.invalid'),
    });
  }
}

const openReason = (target: ReasonTarget): void => {
  reasonTarget.value = target;
  reason.value = '';
  notice.value = '';
};

async function confirmReason(): Promise<void> {
  const target = reasonTarget.value;
  if (target === null || reason.value.trim() === '') return;
  await go(target, reason.value.trim());
}

async function onAssignee(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  notice.value = '';
  try {
    await patch.mutateAsync({ requestId: props.requestId, body: { assigneeMbId: value === '' ? null : value } });
    noticeError.value = false;
    notice.value = t('admin.develop.status.assigneeSaved');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.status.fail'));
  }
}

const busy = computed(() => transition.isPending.value || patch.isPending.value);
</script>

<template>
  <div class="grid gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        {{ t('admin.develop.status.assignee') }}
        <select
          :value="assigneeMbId ?? ''"
          class="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm"
          :disabled="busy"
          @change="onAssignee"
        >
          <option value="">{{ t('admin.develop.status.unassigned') }}</option>
          <option v-for="mbId in assigneeOptions" :key="mbId" :value="mbId">{{ mbId }}</option>
        </select>
      </label>

      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          v-if="canReview"
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="busy"
          @click="go('reviewing', null)"
        >
          {{ t('admin.develop.status.toReviewing') }}
        </button>
        <button
          v-if="canStart"
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="busy"
          @click="go('in_progress', null)"
        >
          {{ t('admin.develop.status.toInProgress') }}
        </button>
        <button
          v-if="canComplete"
          type="button"
          class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="busy"
          @click="go('completed', null)"
        >
          {{ t('admin.develop.status.toCompleted') }}
        </button>
        <button
          v-if="canDecline"
          type="button"
          class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
          :disabled="busy"
          @click="openReason('declined')"
        >
          {{ t('admin.develop.status.toDeclined') }}
        </button>
        <button
          v-if="canCancel"
          type="button"
          class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
          :disabled="busy"
          @click="openReason('cancelled')"
        >
          {{ t('admin.develop.status.toCancelled') }}
        </button>
      </div>
    </div>

    <!-- 사유 입력 인라인 패널 -->
    <div v-if="reasonTarget !== null" class="grid gap-2 rounded-lg border border-red-200 bg-red-50/40 p-3">
      <p class="text-sm font-bold text-red-700">
        {{ reasonTarget === 'declined' ? t('admin.develop.status.declineTitle') : t('admin.develop.status.cancelTitle') }}
      </p>
      <textarea
        v-model="reason"
        rows="2"
        :maxlength="1000"
        :placeholder="t('admin.develop.status.reasonPlaceholder')"
        class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed"
      />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
          :disabled="busy || reason.trim() === ''"
          @click="confirmReason"
        >
          {{ t('admin.develop.status.reasonConfirm') }}
        </button>
        <button
          type="button"
          class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-600"
          @click="reasonTarget = null"
        >
          {{ t('admin.develop.cancel') }}
        </button>
      </div>
    </div>

    <p v-if="notice !== ''" class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
  </div>
</template>
