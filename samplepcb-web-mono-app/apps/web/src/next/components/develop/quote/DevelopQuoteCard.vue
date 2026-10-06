<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { PencilIcon, Undo2Icon } from '@lucide/vue';
import {
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopQuoteViewType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopMilestoneMarkPaid,
  useAdminDevelopMilestoneOpen,
  useAdminDevelopQuoteWithdraw,
} from '@/admin/useAdminDevelop';
import { formatDateTime, formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import { developMilestoneStatusBadge, developQuoteStatusBadge } from '@/next/components/develop/develop-badges';

// 견적서 한 장(읽기) — 옛 components/admin/develop/DevelopQuoteCard.vue 의 짝(같은 props·emits).
// 항목·금액·결제 조건·수락 흔적. 초안이면 편집으로 넘기고, 발송분은 철회만 할 수 있다(고친 값을 보내려면
// 수정 견적을 새로 만든다). 마일스톤의 `payment` 는 영카트 주문(od) 파생이라 결제 화면 대신 여기서 읽기만 한다.
// trigger=manual(담당자가 청구할 때) 마일스톤은 「고객 결제 열기」로 열어야 payable 이 된다(2026-09-10, G milestone.open 이식).
// 확인은 리뉴얼 대화상자(@/next/lib/dialog) — 옛 인라인 확인 패널과 같은 문구·같은 버튼 이름(확인/취소).
// 수동 입금 확인은 메모를 함께 받으므로 입력 대화상자에서 연 채로 처리하고, 실패하면 입력을 둔 채 오류를 보인다.
const props = defineProps<{ quote: DevelopQuoteViewType & { internalNote: string | null } }>();

const emit = defineEmits<{ edit: [] }>();

const { t } = useI18n();
const withdraw = useAdminDevelopQuoteWithdraw();
const markPaid = useAdminDevelopMilestoneMarkPaid();
const openMilestone = useAdminDevelopMilestoneOpen();

const notice = ref('');
const noticeError = ref(false);

const setNotice = (message: string, isError: boolean): void => {
  notice.value = message;
  noticeError.value = isError;
};

const statusBadge = computed(() => developQuoteStatusBadge(props.quote.status));

const errorCodes = computed(() => ({
  QUOTE_NOT_OPEN: t('admin.develop.quote.errNotOpen'),
  NOT_PAYABLE: t('admin.develop.quote.errNotPayable'),
  ALREADY_PAID: t('admin.develop.quote.errAlreadyPaid'),
  NOT_MANUAL: t('admin.develop.quote.errNotManual'),
}));

// 열 수 있는 수동 청구 = manual ∧ pending ∧ 아직 payable 아님(payable 은 서버 파생 — 열리면 true).
interface MilestoneGate {
  trigger: string;
  status: string;
  payable: boolean;
}
const canOpen = (m: MilestoneGate): boolean => m.trigger === 'manual' && m.status === 'pending' && !m.payable;
const isOpened = (m: MilestoneGate): boolean => m.trigger === 'manual' && m.status === 'pending' && m.payable;

// 수동 청구 열기 — 고객이 결제할 수 있게 되며 되돌릴 수 없어 확인을 한 번 거친다.
async function onOpenMilestone(milestoneId: number): Promise<void> {
  notice.value = '';
  const ok = await confirmDialog({
    message: t('admin.develop.quote.openMilestoneConfirm'),
    confirmLabel: t('admin.develop.quote.confirmYes'),
    cancelLabel: t('admin.develop.quote.confirmNo'),
  });
  if (!ok) return;
  try {
    await openMilestone.mutateAsync(milestoneId);
    setNotice(t('admin.develop.quote.openDone'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.openFail'), errorCodes.value), true);
  }
}

async function onWithdraw(): Promise<void> {
  const ok = await confirmDialog({
    message: t('admin.develop.quote.withdrawConfirm'),
    confirmLabel: t('admin.develop.quote.confirmYes'),
    cancelLabel: t('admin.develop.quote.confirmNo'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await withdraw.mutateAsync(props.quote.quoteId);
    setNotice(t('admin.develop.quote.withdrawn'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.withdrawFail'), errorCodes.value), true);
  }
}

// 오프라인 입금 수동 확인 — 메모(선택)는 비면 보내지 않는다(옛 화면과 같은 본문: {} | { note }).
async function onMarkPaid(milestoneId: number, title: string): Promise<void> {
  notice.value = '';
  const result = await promptDialog({
    title: `${t('admin.develop.quote.markPaid')} — ${title}`,
    description: t('admin.develop.quote.markPaidConfirm'),
    fields: [
      {
        name: 'note',
        label: t('admin.develop.quote.markPaidNote'),
        placeholder: t('admin.develop.quote.markPaidNote'),
        maxlength: 500,
      },
    ],
    confirmLabel: t('admin.develop.quote.confirmYes'),
    errorFallback: t('admin.develop.quote.markPaidFail'),
    submit: async (values) => {
      const note = (values.note ?? '').trim();
      await markPaid.mutateAsync({ milestoneId, body: note === '' ? {} : { note } });
    },
  });
  if (result !== null) setNotice(t('admin.develop.quote.markPaidDone'), false);
}
</script>

<template>
  <Panel size="sm" class="flex flex-col gap-2">
    <!-- 머리 -->
    <div class="flex flex-col gap-0.5">
      <div class="flex flex-wrap items-center gap-1.5">
        <b class="text-base tabular-nums">v{{ quote.version }}</b>
        <span class="text-muted-foreground text-xs">{{ DEVELOP_QUOTE_KIND_LABELS[quote.kind] }}</span>
        <Badge :variant="statusBadge.variant">{{ statusBadge.label }}</Badge>
        <span class="ml-auto text-base font-semibold tabular-nums">{{ formatKrw(quote.totalAmount) }}</span>
        <span class="text-muted-foreground text-xs">{{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }}</span>
      </div>
      <p class="text-sm">{{ quote.title }}</p>
      <p class="text-muted-foreground text-xs tabular-nums">
        {{ t('admin.develop.quote.validUntil') }} {{ quote.validUntil }}
        <template v-if="quote.durationDays !== null"> · {{ t('admin.develop.quote.durationDaysShort', { days: quote.durationDays }) }}</template>
        <template v-if="quote.sentAt !== null"> · {{ t('admin.develop.quote.sentAt') }} {{ formatDateTime(quote.sentAt) }}</template>
        <template v-if="quote.acceptedAt !== null">
          · {{ t('admin.develop.quote.acceptedAt') }} {{ formatDateTime(quote.acceptedAt) }}<template v-if="quote.acceptedName !== null"> ({{ quote.acceptedName }})</template>
        </template>
        <template v-if="quote.declinedAt !== null"> · {{ t('admin.develop.quote.declinedAt') }} {{ formatDateTime(quote.declinedAt) }}</template>
      </p>
      <p v-if="quote.declineReason !== null" class="text-destructive text-xs">
        {{ t('admin.develop.quote.declineReason') }}: {{ quote.declineReason }}
      </p>
      <p v-if="quote.poFile !== null" class="text-muted-foreground text-xs">
        {{ t('admin.develop.quote.poFile') }}: {{ quote.poFile.name }}
      </p>
    </div>

    <!-- 항목 -->
    <ul class="flex flex-col gap-0.5 border-t pt-2 text-sm">
      <li v-for="it in quote.items" :key="it.itemId" class="flex flex-wrap items-baseline gap-2">
        <span class="min-w-0 flex-1 truncate" :title="it.title">{{ it.title }}</span>
        <span v-if="it.durationDays !== null" class="text-muted-foreground text-xs">
          {{ t('admin.develop.quote.durationDaysShort', { days: it.durationDays }) }}
        </span>
        <span class="font-medium tabular-nums">{{ formatKrw(it.amount) }}</span>
      </li>
    </ul>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 border-t pt-1.5 text-xs">
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.supply') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(quote.supplyAmount) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.vat') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(quote.vatAmount) }}</dd>
    </dl>

    <!-- 결제 조건 -->
    <div class="flex flex-col gap-1 border-t pt-2">
      <h3 class="text-muted-foreground text-xs font-semibold">{{ t('admin.develop.quote.milestones') }}</h3>
      <Panel v-for="m in quote.milestones" :key="m.milestoneId" size="xs" tone="muted" class="flex flex-col gap-1 text-xs">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="font-medium">{{ m.title }}</span>
          <span class="text-muted-foreground">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</span>
          <Badge v-if="m.unlocksDeliverables" variant="outline">{{ t('admin.develop.quote.unlocks') }}</Badge>
          <Badge :variant="developMilestoneStatusBadge(m.status).variant">{{ developMilestoneStatusBadge(m.status).label }}</Badge>
          <Badge v-if="isOpened(m)" variant="info">{{ t('admin.develop.quote.opened') }}</Badge>
          <span class="ml-auto font-semibold tabular-nums">{{ formatKrw(m.amount) }}</span>
        </div>
        <p v-if="m.payment !== null" class="text-muted-foreground tabular-nums">
          {{ t('admin.develop.quote.payment', {
            odId: m.payment.odId,
            status: m.payment.odStatus,
            receipt: formatKrw(m.payment.receiptPrice),
          }) }}
          <template v-if="m.payment.misu > 0"> · {{ t('admin.develop.quote.misu', { amount: formatKrw(m.payment.misu) }) }}</template>
        </p>
        <p v-if="m.paidAt !== null" class="text-success tabular-nums">
          {{ t('admin.develop.quote.paidAt') }} {{ formatDateTime(m.paidAt) }}
        </p>
        <div v-if="canOpen(m) || m.status === 'pending'" class="flex flex-wrap items-center gap-1.5">
          <Button
            v-if="canOpen(m)"
            variant="outline"
            size="xs"
            :disabled="openMilestone.isPending.value"
            @click="onOpenMilestone(m.milestoneId)"
          >
            {{ t('admin.develop.quote.openMilestone') }}
          </Button>
          <Button
            v-if="m.status === 'pending'"
            variant="outline"
            size="xs"
            :disabled="markPaid.isPending.value"
            @click="onMarkPaid(m.milestoneId, m.title)"
          >
            {{ t('admin.develop.quote.markPaid') }}
          </Button>
        </div>
      </Panel>
    </div>

    <Panel v-if="quote.internalNote !== null" size="xs" tone="muted" class="text-muted-foreground text-xs">
      {{ t('admin.develop.quote.internalNote') }}: {{ quote.internalNote }}
    </Panel>

    <div class="flex flex-wrap items-center gap-2">
      <Button v-if="quote.status === 'draft'" variant="outline" size="sm" @click="emit('edit')">
        <PencilIcon />
        {{ t('admin.develop.quote.edit') }}
      </Button>
      <Button
        v-if="quote.status === 'sent'"
        variant="outline"
        size="sm"
        :disabled="withdraw.isPending.value"
        @click="onWithdraw"
      >
        <Undo2Icon class="text-destructive" />
        {{ t('admin.develop.quote.withdraw') }}
      </Button>
      <span
        v-if="notice !== ''"
        role="status"
        class="text-xs font-medium"
        :class="noticeError ? 'text-destructive' : 'text-success'"
      >{{ notice }}</span>
    </div>
  </Panel>
</template>
