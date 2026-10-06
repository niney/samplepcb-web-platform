<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { SendIcon, Trash2Icon, XIcon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import {
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_VAT_MODES,
  DEVELOP_VAT_MODE_LABELS,
  devReviewScheduleTotals,
} from '@sp/api-contract';
import type {
  AdminDevelopSettingsType,
  DevReviewScheduleType,
  DevelopQuoteKindType,
  DevelopQuoteViewType,
} from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import {
  useAdminDevelopQuoteCreate,
  useAdminDevelopQuoteDelete,
  useAdminDevelopQuotePatch,
  useAdminDevelopQuoteSend,
} from '@/admin/useAdminDevelop';
import {
  DEVELOP_QUOTE_LIMITS,
  developQuoteAmounts,
  developQuoteFormFrom,
  developQuoteFormToBody,
  developQuoteIssues,
  developQuoteMilestoneAmounts,
  developQuoteRatioSum,
  newDevelopQuoteForm,
} from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import { confirmDialog } from '@/next/lib/dialog';
import QuoteItemsField from './QuoteItemsField.vue';
import QuoteMilestonesField from './QuoteMilestonesField.vue';

// 견적서 편집기(docs/DEVELOP_FLOW.md §5) — 옛 components/admin/develop/DevelopQuoteEditor.vue 의 짝(같은 props·emits), draft 전용.
// 초안 저장(생성/전체 교체) → 발송 순서로 쓴다. 발송이 금액·마일스톤 금액을 확정하므로 발송 버튼은 저장부터 하고
// (내용이 화면과 어긋나지 않게) 확인을 한 번 거친다. 발송 확인은 합계·결제 조건 요약을 편집 내용 바로 아래에서
// 대조해야 해서 대화상자가 아니라 그 자리 알림(옛 화면과 같은 위치)이고, 나머지 확인(삭제·일정 덮어쓰기)은 대화상자다.
// 폼은 문자열로 들고 저장 직전에만 계약 모양으로 바꾼다(develop-quote-edit.ts — 옛 화면과 같은 순수 모듈).
const props = defineProps<{
  requestId: number;
  quote: (DevelopQuoteViewType & { internalNote: string | null }) | null;
  settings: AdminDevelopSettingsType;
  initialKind: DevelopQuoteKindType;
  allowedKinds: readonly DevelopQuoteKindType[];
  requestTitle: string;
  // 검토서(작업본 ?? 초안 ?? 공개본)의 개발 일정(예상) — 없으면 null 이고 가져오기 버튼이 아예 안 뜬다.
  schedule: DevReviewScheduleType | null;
}>();

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const uid = useId();

const create = useAdminDevelopQuoteCreate();
const patch = useAdminDevelopQuotePatch();
const remove = useAdminDevelopQuoteDelete();
const send = useAdminDevelopQuoteSend();

const quoteId = ref<number | null>(props.quote?.quoteId ?? null);
// 버전은 서버가 매긴다 — 새 초안을 이 편집기에서 만들면 저장 응답으로 처음 알게 된다.
const version = ref<number | null>(props.quote?.version ?? null);
const form = ref(
  props.quote === null
    ? newDevelopQuoteForm(props.settings, props.initialKind, props.requestTitle)
    : developQuoteFormFrom(props.quote),
);

const notice = ref('');
const noticeError = ref(false);
const issues = ref<string[]>([]);
const sendConfirmOpen = ref(false);
const scheduleApplied = ref('');

const setNotice = (message: string, isError: boolean): void => {
  notice.value = message;
  noticeError.value = isError;
};

const busy = computed(
  () => create.isPending.value || patch.isPending.value || send.isPending.value || remove.isPending.value,
);

const amounts = computed(() => developQuoteAmounts(form.value));
const milestoneAmounts = computed(() => developQuoteMilestoneAmounts(form.value));
const ratioSum = computed(() => developQuoteRatioSum(form.value));
const liveIssues = computed(() => developQuoteIssues(form.value));

const errorCodes = computed(() => ({
  KIND_MISMATCH: t('admin.develop.quote.errKindMismatch'),
  QUOTE_NOT_DRAFT: t('admin.develop.quote.errNotDraft'),
  QUOTE_NOT_OPEN: t('admin.develop.quote.errNotOpen'),
  QUOTE_EMPTY: t('admin.develop.quote.errEmpty'),
  INVALID_TRANSITION: t('admin.develop.quote.errClosed'),
}));

// NativeSelect 는 AcceptableValue 를 내므로 사전에 있는 값만 받는다.
const pickKind = (value: AcceptableValue): void => {
  const hit = props.allowedKinds.find((k) => k === value);
  if (hit !== undefined) form.value.kind = hit;
};
const pickVatMode = (value: AcceptableValue): void => {
  const hit = DEVELOP_VAT_MODES.find((mode) => mode === value);
  if (hit !== undefined) form.value.vatMode = hit;
};
const asText = (value: string | number): string => String(value);

// ── 검토서 예상 일정 가져오기(docs/DEVELOP_FLOW.md §6.1) ────────────────────────
// 검토서의 일정은 **예상**, 견적서의 기간은 **약속**이다. 그래서 자동 반영이 아니라 관리자가 누르는
// 버튼이고, 이미 값이 있으면 확인을 한 번 거친다.
const scheduleTotals = computed(() => devReviewScheduleTotals(props.schedule));
const hasSchedule = computed(() => (props.schedule?.phases.length ?? 0) > 0);

// 최대 주 × 7일 — 보수적으로 잡는다. 계약 상한(3650일)을 넘지 않게 자른다.
const applyScheduleDuration = (): void => {
  const days = Math.min(DEVELOP_QUOTE_LIMITS.durationDaysMax, scheduleTotals.value.maxWeeks * 7);
  if (days < 1) return;
  form.value.durationDays = String(days);
  scheduleApplied.value = t('admin.develop.quote.fromScheduleNote');
};

const onScheduleDurationClick = async (): Promise<void> => {
  if (String(form.value.durationDays).trim() !== '') {
    const ok = await confirmDialog({
      message: t('admin.develop.quote.fromScheduleConfirm'),
      confirmLabel: t('admin.develop.quote.confirmYes'),
      cancelLabel: t('admin.develop.quote.confirmNo'),
    });
    if (!ok) return;
  }
  applyScheduleDuration();
};

// ── 저장·발송·삭제 ───────────────────────────────────────────────────────────

async function saveDraft(): Promise<number | null> {
  const found = developQuoteIssues(form.value);
  issues.value = found;
  if (found.length > 0) {
    setNotice(t('admin.develop.quote.saveBlocked'), true);
    return null;
  }
  const body = developQuoteFormToBody(form.value);
  const id = quoteId.value;
  const saved =
    id === null
      ? await create.mutateAsync({ requestId: props.requestId, body })
      : await patch.mutateAsync({ quoteId: id, body });
  quoteId.value = saved.data.quoteId;
  version.value = saved.data.version;
  return saved.data.quoteId;
}

async function onSave(): Promise<void> {
  try {
    const id = await saveDraft();
    if (id !== null) setNotice(t('admin.develop.quote.saved'), false);
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.saveFail'), errorCodes.value), true);
  }
}

function onSendClick(): void {
  const found = developQuoteIssues(form.value);
  issues.value = found;
  if (found.length > 0) {
    setNotice(t('admin.develop.quote.saveBlocked'), true);
    return;
  }
  notice.value = '';
  sendConfirmOpen.value = true;
}

async function onSendConfirm(): Promise<void> {
  sendConfirmOpen.value = false;
  try {
    const id = await saveDraft();
    if (id === null) return;
    await send.mutateAsync(id);
    setNotice(t('admin.develop.quote.sent'), false);
    emit('close');
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.sendFail'), errorCodes.value), true);
  }
}

async function onDelete(): Promise<void> {
  sendConfirmOpen.value = false;
  const ok = await confirmDialog({
    message: t('admin.develop.quote.deleteConfirm'),
    confirmLabel: t('admin.develop.quote.confirmYes'),
    cancelLabel: t('admin.develop.quote.confirmNo'),
    tone: 'danger',
  });
  if (!ok) return;
  const id = quoteId.value;
  if (id === null) {
    emit('close');
    return;
  }
  try {
    await remove.mutateAsync(id);
    emit('close');
  } catch (error) {
    setNotice(apiErrorMessage(error, t('admin.develop.quote.deleteFail'), errorCodes.value), true);
  }
}
</script>

<template>
  <Panel size="md" tone="muted" class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-base font-semibold">
        {{ version === null ? t('admin.develop.quote.newTitle') : t('admin.develop.quote.editTitle', { version: version }) }}
      </h3>
      <Button variant="outline" size="sm" class="ml-auto" @click="emit('close')">
        <XIcon />
        {{ t('admin.develop.quote.close') }}
      </Button>
    </div>

    <!-- 헤더 -->
    <Panel size="sm" tone="card" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Field class="sm:col-span-2 xl:col-span-3">
        <FieldLabel :for="`${uid}-title`">{{ t('admin.develop.quote.fieldTitle') }}</FieldLabel>
        <Input :id="`${uid}-title`" v-model="form.title" :maxlength="DEVELOP_QUOTE_LIMITS.titleLen" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-kind`">{{ t('admin.develop.quote.kind') }}</FieldLabel>
        <NativeSelect :id="`${uid}-kind`" :model-value="form.kind" @update:model-value="pickKind">
          <NativeSelectOption v-for="k in allowedKinds" :key="k" :value="k">{{ DEVELOP_QUOTE_KIND_LABELS[k] }}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-vat`">{{ t('admin.develop.quote.vatMode') }}</FieldLabel>
        <NativeSelect :id="`${uid}-vat`" :model-value="form.vatMode" @update:model-value="pickVatMode">
          <NativeSelectOption v-for="mode in DEVELOP_VAT_MODES" :key="mode" :value="mode">
            {{ DEVELOP_VAT_MODE_LABELS[mode] }}
          </NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-valid`">{{ t('admin.develop.quote.validUntil') }}</FieldLabel>
        <Input :id="`${uid}-valid`" v-model="form.validUntil" type="date" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-duration`">{{ t('admin.develop.quote.durationDays') }}</FieldLabel>
        <div class="flex items-center gap-1.5">
          <Input
            :id="`${uid}-duration`"
            :model-value="asText(form.durationDays)"
            type="number"
            min="1"
            :max="DEVELOP_QUOTE_LIMITS.durationDaysMax"
            class="min-w-0 flex-1 tabular-nums"
            @update:model-value="(v) => (form.durationDays = String(v))"
          />
          <Button
            v-if="hasSchedule"
            variant="outline"
            size="sm"
            :title="t('admin.develop.quote.fromScheduleTitle')"
            @click="onScheduleDurationClick"
          >
            {{ t('admin.develop.quote.fromSchedule') }}
          </Button>
        </div>
        <FieldDescription v-if="hasSchedule">
          {{ t('admin.develop.quote.fromScheduleTitle') }} — {{ scheduleTotals.minWeeks }}~{{ scheduleTotals.maxWeeks }}주
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-review`">{{ t('admin.develop.quote.reviewDays') }}</FieldLabel>
        <Input
          :id="`${uid}-review`"
          :model-value="asText(form.reviewDays)"
          type="number"
          min="1"
          :max="DEVELOP_QUOTE_LIMITS.reviewDaysMax"
          class="tabular-nums"
          @update:model-value="(v) => (form.reviewDays = String(v))"
        />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-warranty`">{{ t('admin.develop.quote.warrantyDays') }}</FieldLabel>
        <Input
          :id="`${uid}-warranty`"
          :model-value="asText(form.warrantyDays)"
          type="number"
          min="0"
          :max="DEVELOP_QUOTE_LIMITS.warrantyDaysMax"
          class="tabular-nums"
          @update:model-value="(v) => (form.warrantyDays = String(v))"
        />
      </Field>
    </Panel>

    <QuoteItemsField v-model:items="form.items" :amounts="amounts" />

    <QuoteMilestonesField
      v-model:milestones="form.milestones"
      v-model:applied="scheduleApplied"
      :milestone-amounts="milestoneAmounts"
      :ratio-sum="ratioSum"
      :schedule="schedule"
      :id-prefix="uid"
    />

    <!-- 산출물·조건·비고 -->
    <Panel size="sm" tone="card" class="flex flex-col gap-3">
      <Field>
        <FieldLabel :for="`${uid}-deliverables`">{{ t('admin.develop.quote.deliverables') }}</FieldLabel>
        <Textarea :id="`${uid}-deliverables`" v-model="form.deliverables" rows="4" />
        <FieldDescription>{{ t('admin.develop.quote.deliverablesHint') }}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-schedule-note`">{{ t('admin.develop.quote.scheduleNote') }}</FieldLabel>
        <Textarea :id="`${uid}-schedule-note`" v-model="form.scheduleNote" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.scheduleNoteLen" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-exclusions`">{{ t('admin.develop.quote.exclusions') }}</FieldLabel>
        <Textarea :id="`${uid}-exclusions`" v-model="form.exclusions" rows="3" :maxlength="DEVELOP_QUOTE_LIMITS.exclusionsLen" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-terms`">{{ t('admin.develop.quote.terms') }}</FieldLabel>
        <Textarea :id="`${uid}-terms`" v-model="form.terms" rows="8" :maxlength="DEVELOP_QUOTE_LIMITS.termsLen" />
        <FieldDescription>{{ t('admin.develop.quote.termsHint') }}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-note`">{{ t('admin.develop.quote.note') }}</FieldLabel>
        <Textarea :id="`${uid}-note`" v-model="form.note" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.noteLen" />
      </Field>
      <Field>
        <FieldLabel :for="`${uid}-internal-note`">{{ t('admin.develop.quote.internalNote') }}</FieldLabel>
        <Textarea :id="`${uid}-internal-note`" v-model="form.internalNote" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.internalNoteLen" />
        <FieldDescription>{{ t('admin.develop.quote.internalNoteHint') }}</FieldDescription>
      </Field>
    </Panel>

    <!-- 검사 결과 -->
    <Alert v-if="issues.length > 0" variant="destructive" size="sm">
      <AlertDescription>
        <ul class="flex flex-col gap-0.5">
          <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
        </ul>
      </AlertDescription>
    </Alert>

    <!-- 발송 확인 — 합계·결제 조건을 편집 내용 바로 아래에서 대조한다 -->
    <Alert v-if="sendConfirmOpen" variant="warning">
      <SendIcon />
      <AlertTitle>{{ t('admin.develop.quote.sendConfirmTitle') }}</AlertTitle>
      <AlertDescription>
        <div class="flex flex-col gap-2">
          <p class="tabular-nums">
            {{ t('admin.develop.quote.total') }} <b>{{ formatKrw(amounts.totalAmount) }}</b>
            ({{ DEVELOP_VAT_MODE_LABELS[form.vatMode] }}) · {{ t('admin.develop.quote.itemsCount', { count: form.items.length }) }}
          </p>
          <ul class="flex flex-col gap-0.5 text-xs tabular-nums">
            <li v-for="(m, i) in form.milestones" :key="`c-${i}`">
              · {{ m.title }} — {{ m.percent }}% · {{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }} · {{ formatKrw(milestoneAmounts[i] ?? 0) }}
            </li>
          </ul>
          <div class="flex items-center gap-2">
            <Button size="sm" :disabled="busy" @click="onSendConfirm">
              {{ t('admin.develop.quote.sendConfirm') }}
            </Button>
            <Button variant="outline" size="sm" @click="sendConfirmOpen = false">
              {{ t('admin.develop.quote.confirmNo') }}
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>

    <!-- 버튼 줄 -->
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" :disabled="busy" @click="onSave">
        {{ busy ? t('admin.develop.saving') : t('admin.develop.quote.save') }}
      </Button>
      <Button :disabled="busy || liveIssues.length > 0" @click="onSendClick">
        <SendIcon />
        {{ t('admin.develop.quote.send') }}
      </Button>
      <Button v-if="quoteId !== null" variant="outline" :disabled="busy" @click="onDelete">
        <Trash2Icon class="text-destructive" />
        {{ t('admin.develop.quote.delete') }}
      </Button>
      <span
        v-if="notice !== ''"
        role="status"
        class="text-sm font-medium"
        :class="noticeError ? 'text-destructive' : 'text-success'"
      >{{ notice }}</span>
    </div>
  </Panel>
</template>
