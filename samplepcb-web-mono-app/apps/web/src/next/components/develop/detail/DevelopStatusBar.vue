<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { BanIcon, CircleXIcon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import { DEVELOP_REQUEST_STATUS_LABELS, isDevelopClosed } from '@sp/api-contract';
import type { AdminDevelopStatusBodyType, DevelopRequestStatusType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopStatus, usePatchAdminDevelop } from '@/admin/useAdminDevelop';
import { Button } from '@/next/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import Panel from '@/next/components/common/Panel.vue';
import ActionNotice from './ActionNotice.vue';

// 상태 전이 + 담당자 배정(옛 components/admin/develop/DevelopStatusBar.vue 와 같은 props·동작).
// 나머지 전이(견적 발송·수락·결제·납품)는 그 행동의 부수효과라 버튼이 없다.
// 사유가 필요한 전이(진행 불가·취소)는 그 자리 패널로 받는다 — 서버 가드 사유(REASON_REQUIRED·INVALID_TRANSITION)를
// 입력 옆에 그대로 남긴다.
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

async function onAssignee(value: AcceptableValue): Promise<void> {
  const mbId = typeof value === 'string' ? value : '';
  notice.value = '';
  try {
    await patch.mutateAsync({ requestId: props.requestId, body: { assigneeMbId: mbId === '' ? null : mbId } });
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
      <label class="text-muted-foreground flex items-center gap-1.5 text-sm">
        {{ t('admin.develop.status.assignee') }}
        <NativeSelect
          :model-value="props.assigneeMbId ?? ''"
          :disabled="busy"
          @update:model-value="(v) => void onAssignee(v)"
        >
          <NativeSelectOption value="">{{ t('admin.develop.status.unassigned') }}</NativeSelectOption>
          <NativeSelectOption v-for="mbId in assigneeOptions" :key="mbId" :value="mbId">{{ mbId }}</NativeSelectOption>
        </NativeSelect>
      </label>

      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <Button v-if="canReview" size="sm" :disabled="busy" @click="void go('reviewing', null)">
          {{ t('admin.develop.status.toReviewing') }}
        </Button>
        <Button v-if="canStart" size="sm" :disabled="busy" @click="void go('in_progress', null)">
          {{ t('admin.develop.status.toInProgress') }}
        </Button>
        <Button v-if="canComplete" variant="success" size="sm" :disabled="busy" @click="void go('completed', null)">
          {{ t('admin.develop.status.toCompleted') }}
        </Button>
        <Button v-if="canDecline" variant="outline" size="sm" :disabled="busy" @click="openReason('declined')">
          <BanIcon class="text-destructive" />
          {{ t('admin.develop.status.toDeclined') }}
        </Button>
        <Button v-if="canCancel" variant="outline" size="sm" :disabled="busy" @click="openReason('cancelled')">
          <CircleXIcon class="text-destructive" />
          {{ t('admin.develop.status.toCancelled') }}
        </Button>
      </div>
    </div>

    <!-- 사유 입력 — 진행 불가·취소는 사유가 필수(서버 REASON_REQUIRED)라 비어 있으면 확인을 막는다. -->
    <Panel v-if="reasonTarget !== null" size="sm" class="grid gap-2">
      <p class="text-destructive text-sm font-semibold">
        {{ reasonTarget === 'declined' ? t('admin.develop.status.declineTitle') : t('admin.develop.status.cancelTitle') }}
      </p>
      <Textarea
        v-model="reason"
        :rows="2"
        :maxlength="1000"
        :placeholder="t('admin.develop.status.reasonPlaceholder')"
        :aria-label="reasonTarget === 'declined' ? t('admin.develop.status.declineTitle') : t('admin.develop.status.cancelTitle')"
      />
      <div class="flex items-center gap-2">
        <Button variant="destructive" size="sm" :disabled="busy || reason.trim() === ''" @click="void confirmReason()">
          {{ t('admin.develop.status.reasonConfirm') }}
        </Button>
        <Button variant="outline" size="sm" @click="reasonTarget = null">
          {{ t('admin.develop.cancel') }}
        </Button>
      </div>
    </Panel>

    <ActionNotice :text="notice" :error="noticeError" />
  </div>
</template>
