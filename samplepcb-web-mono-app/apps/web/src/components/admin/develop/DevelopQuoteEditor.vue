<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_MILESTONE_TRIGGERS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_VAT_MODES,
  DEVELOP_VAT_MODE_LABELS,
  devReviewScheduleTotals,
  parseDevelopQuoteLines,
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
} from '../../../admin/useAdminDevelop';
import { formatKrw } from '../../../lib/format';
import {
  DEVELOP_QUOTE_LIMITS,
  developQuoteAmounts,
  developQuoteFormFrom,
  developQuoteFormToBody,
  developQuoteIssues,
  developQuoteMilestoneAmounts,
  developQuoteRatioSum,
  emptyQuoteItemRow,
  formatAmountInput,
  newDevelopQuoteForm,
} from './develop-quote-edit';

// 견적서 편집기(docs/DEVELOP_FLOW.md §5) — draft 전용.
// 초안 저장(생성/전체 교체) → 발송 순서로 쓴다. 발송이 금액·마일스톤 금액을 확정하므로
// 발송 버튼은 저장부터 하고(내용이 화면과 어긋나지 않게) 인라인 확인을 한 번 거친다.
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
const confirmMode = ref<'none' | 'send' | 'delete'>('none');
const pasteText = ref('');
const pasteNote = ref('');

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

// ── 항목 편집 ────────────────────────────────────────────────────────────────

const addItem = (): void => {
  if (form.value.items.length >= DEVELOP_QUOTE_LIMITS.items) return;
  form.value.items.push(emptyQuoteItemRow());
};

const moveItem = (index: number, delta: number): void => {
  const next = index + delta;
  const rows = form.value.items;
  const from = rows[index];
  const to = rows[next];
  if (from === undefined || to === undefined) return;
  rows[index] = to;
  rows[next] = from;
};

// 붙여넣기로 채우기 — 빈 행은 버리고 읽어낸 줄을 뒤에 붙인다. 금액을 못 읽은 줄은 그대로 알려 준다.
const applyPaste = (): void => {
  const parsed = parseDevelopQuoteLines(pasteText.value);
  if (parsed.items.length === 0) {
    pasteNote.value = t('admin.develop.quote.pasteEmpty');
    return;
  }
  const kept = form.value.items.filter((it) => it.title.trim() !== '' || it.amount.trim() !== '');
  form.value.items = [
    ...kept,
    ...parsed.items.map((it) => ({
      title: it.title,
      description: '',
      amount: it.amount.toLocaleString('ko-KR'),
      durationDays: '',
    })),
  ].slice(0, DEVELOP_QUOTE_LIMITS.items);
  pasteText.value = '';
  pasteNote.value =
    parsed.rejected.length === 0
      ? t('admin.develop.quote.pasteAdded', { count: parsed.items.length })
      : `${t('admin.develop.quote.pasteAdded', { count: parsed.items.length })} ${t('admin.develop.quote.pasteRejected', { lines: parsed.rejected.join(' / ') })}`;
};

// ── 결제 조건 편집 ────────────────────────────────────────────────────────────

const addMilestone = (): void => {
  if (form.value.milestones.length >= DEVELOP_QUOTE_LIMITS.milestones) return;
  form.value.milestones.push({ title: '', percent: '0', trigger: 'manual', unlocksDeliverables: false });
};

// 산출물 해제는 하나만(계약 superRefine) — 체크하면 나머지를 끈다.
const setUnlocks = (index: number, checked: boolean): void => {
  form.value.milestones = form.value.milestones.map((m, i) => ({ ...m, unlocksDeliverables: checked && i === index }));
};

// ── 검토서 예상 일정 가져오기(docs/DEVELOP_FLOW.md §6) ────────────────────────
// 검토서의 일정은 **예상**, 견적서의 기간은 **약속**이다. 그래서 자동 반영이 아니라 관리자가 누르는
// 버튼이고, 이미 값이 있으면 인라인 확인을 한 번 거친다(네이티브 confirm 금지).
const scheduleTotals = computed(() => devReviewScheduleTotals(props.schedule));
const hasSchedule = computed(() => (props.schedule?.phases.length ?? 0) > 0);
const scheduleApplied = ref('');
const scheduleConfirm = ref<'none' | 'duration' | 'milestones'>('none');

// 최대 주 × 7일 — 보수적으로 잡는다. 계약 상한(3650일)을 넘지 않게 자른다.
const applyScheduleDuration = (): void => {
  scheduleConfirm.value = 'none';
  const days = Math.min(DEVELOP_QUOTE_LIMITS.durationDaysMax, scheduleTotals.value.maxWeeks * 7);
  if (days < 1) return;
  form.value.durationDays = String(days);
  scheduleApplied.value = t('admin.develop.quote.fromScheduleNote');
};

const onScheduleDurationClick = (): void => {
  if (form.value.durationDays.trim() === '') {
    applyScheduleDuration();
    return;
  }
  scheduleConfirm.value = 'duration';
};

// 단계 → 결제 조건 초안. 첫 행은 수락 시, 마지막 행은 검수 확정 시(산출물 해제), 중간은 수동 청구.
// 비율은 균등 분할 정수이고 나머지는 마지막 행이 흡수한다(합 100%).
const applyScheduleMilestones = (): void => {
  scheduleConfirm.value = 'none';
  const phases = props.schedule?.phases ?? [];
  if (phases.length === 0) return;
  const first = t('admin.develop.quote.fromScheduleFirstTitle');
  const last = t('admin.develop.quote.fromScheduleLastTitle');
  // 단계가 결제 조건 상한을 넘으면 중간 단계를 앞에서부터 묶어 상한에 맞춘다(현재 단계 상한 8 < 10 이라 방어용).
  const max = DEVELOP_QUOTE_LIMITS.milestones;
  const names =
    phases.length <= max
      ? phases.map((p) => p.name)
      : [phases[0]?.name ?? '', ...phases.slice(phases.length - max + 1).map((p) => p.name)];
  const count = phases.length === 1 ? 2 : names.length;
  const base = Math.floor(100 / count);
  form.value.milestones = Array.from({ length: count }, (_, i) => {
    const isFirst = i === 0;
    const isLast = i === count - 1;
    const percent = isLast ? 100 - base * (count - 1) : base;
    return {
      title: isFirst ? first : isLast ? last : (names[i] ?? ''),
      percent: String(percent),
      trigger: isFirst ? 'on_accept' : isLast ? 'on_completion' : 'manual',
      unlocksDeliverables: isLast,
    };
  });
  scheduleApplied.value = t('admin.develop.quote.fromScheduleNote');
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
  confirmMode.value = 'send';
}

async function onSendConfirm(): Promise<void> {
  confirmMode.value = 'none';
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

async function onDeleteConfirm(): Promise<void> {
  confirmMode.value = 'none';
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
  <section class="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-base font-bold text-gray-900">
        {{ version === null ? t('admin.develop.quote.newTitle') : t('admin.develop.quote.editTitle', { version: version }) }}
      </h3>
      <button
        type="button"
        class="ml-auto rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50"
        @click="emit('close')"
      >
        {{ t('admin.develop.quote.close') }}
      </button>
    </div>

    <!-- 헤더 -->
    <div class="mt-3 grid gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-2 xl:grid-cols-3">
      <label class="block text-sm sm:col-span-2 xl:col-span-3">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.fieldTitle') }}</span>
        <input
          v-model="form.title"
          type="text"
          :maxlength="DEVELOP_QUOTE_LIMITS.titleLen"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.kind') }}</span>
        <select v-model="form.kind" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
          <option v-for="k in allowedKinds" :key="k" :value="k">{{ DEVELOP_QUOTE_KIND_LABELS[k] }}</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.vatMode') }}</span>
        <select v-model="form.vatMode" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm">
          <option v-for="mode in DEVELOP_VAT_MODES" :key="mode" :value="mode">{{ DEVELOP_VAT_MODE_LABELS[mode] }}</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.validUntil') }}</span>
        <input v-model="form.validUntil" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.durationDays') }}</span>
        <div class="mt-1 flex items-center gap-1.5">
          <input v-model="form.durationDays" type="number" min="1" :max="DEVELOP_QUOTE_LIMITS.durationDaysMax" class="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm">
          <button
            v-if="hasSchedule"
            type="button"
            class="shrink-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
            :title="t('admin.develop.quote.fromScheduleTitle')"
            @click="onScheduleDurationClick"
          >
            {{ t('admin.develop.quote.fromSchedule') }}
          </button>
        </div>
        <span v-if="hasSchedule" class="mt-0.5 block text-xs text-gray-500">
          {{ t('admin.develop.quote.fromScheduleTitle') }} — {{ scheduleTotals.minWeeks }}~{{ scheduleTotals.maxWeeks }}주
        </span>
        <div v-if="scheduleConfirm === 'duration'" class="mt-1 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
          <span class="text-xs font-bold text-amber-900">{{ t('admin.develop.quote.fromScheduleConfirm') }}</span>
          <button type="button" class="rounded-md bg-amber-600 px-2 py-1 text-xs font-bold text-white hover:bg-amber-700" @click="applyScheduleDuration">
            {{ t('admin.develop.quote.confirmYes') }}
          </button>
          <button type="button" class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-bold text-gray-600" @click="scheduleConfirm = 'none'">
            {{ t('admin.develop.quote.confirmNo') }}
          </button>
        </div>
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.reviewDays') }}</span>
        <input v-model="form.reviewDays" type="number" min="1" :max="DEVELOP_QUOTE_LIMITS.reviewDaysMax" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.warrantyDays') }}</span>
        <input v-model="form.warrantyDays" type="number" min="0" :max="DEVELOP_QUOTE_LIMITS.warrantyDaysMax" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
      </label>
    </div>

    <!-- 항목표 -->
    <div class="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div class="flex flex-wrap items-center gap-2">
        <h4 class="text-sm font-bold text-gray-800">{{ t('admin.develop.quote.items') }}</h4>
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="form.items.length >= DEVELOP_QUOTE_LIMITS.items"
          @click="addItem"
        >
          {{ t('admin.develop.quote.addItem') }}
        </button>
      </div>

      <div v-for="(it, i) in form.items" :key="`item-${i}`" class="mt-2 grid gap-1.5 rounded-md border border-gray-100 p-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="w-5 text-xs font-bold text-gray-400">{{ i + 1 }}</span>
          <input
            v-model="it.title"
            type="text"
            :maxlength="DEVELOP_QUOTE_LIMITS.itemTitleLen"
            :placeholder="t('admin.develop.quote.itemTitle')"
            class="h-9 min-w-40 flex-1 rounded-md border border-gray-300 px-3 text-sm"
          >
          <input
            v-model="it.amount"
            type="text"
            inputmode="numeric"
            :placeholder="t('admin.develop.quote.itemAmount')"
            class="h-9 w-36 rounded-md border border-gray-300 px-3 text-right text-sm"
            @blur="it.amount = formatAmountInput(it.amount)"
          >
          <input
            v-model="it.durationDays"
            type="number"
            min="1"
            :max="DEVELOP_QUOTE_LIMITS.durationDaysMax"
            :placeholder="t('admin.develop.quote.itemDays')"
            class="h-9 w-24 rounded-md border border-gray-300 px-2 text-sm"
          >
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            :disabled="i === 0"
            @click="moveItem(i, -1)"
          >
            {{ t('admin.develop.quote.moveUp') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            :disabled="i === form.items.length - 1"
            @click="moveItem(i, 1)"
          >
            {{ t('admin.develop.quote.moveDown') }}
          </button>
          <button
            type="button"
            class="rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
            @click="form.items.splice(i, 1)"
          >
            {{ t('admin.develop.quote.removeRow') }}
          </button>
        </div>
        <input
          v-model="it.description"
          type="text"
          :maxlength="DEVELOP_QUOTE_LIMITS.descriptionLen"
          :placeholder="t('admin.develop.quote.itemDescription')"
          class="h-9 w-full rounded-md border border-gray-200 px-3 text-xs"
        >
      </div>
      <p v-if="form.items.length === 0" class="mt-2 text-sm text-gray-400">{{ t('admin.develop.quote.noItems') }}</p>

      <!-- 붙여넣기로 채우기 -->
      <div class="mt-3 rounded-md border border-dashed border-gray-300 p-2">
        <p class="text-xs font-bold text-gray-600">{{ t('admin.develop.quote.paste') }}</p>
        <textarea
          v-model="pasteText"
          rows="3"
          :placeholder="t('admin.develop.quote.pastePlaceholder')"
          class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed"
        />
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <span class="text-xs text-gray-500">{{ t('admin.develop.quote.pasteHint') }}</span>
          <button
            type="button"
            class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            :disabled="pasteText.trim() === ''"
            @click="applyPaste"
          >
            {{ t('admin.develop.quote.pasteApply') }}
          </button>
        </div>
        <p v-if="pasteNote !== ''" class="mt-1 text-xs text-amber-700">{{ pasteNote }}</p>
      </div>

      <!-- 합계 -->
      <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-gray-100 pt-2 text-sm">
        <dt class="text-gray-500">{{ t('admin.develop.quote.supply') }}</dt>
        <dd class="text-right text-gray-800">{{ formatKrw(amounts.supplyAmount) }}</dd>
        <dt class="text-gray-500">{{ t('admin.develop.quote.vat') }}</dt>
        <dd class="text-right text-gray-800">{{ formatKrw(amounts.vatAmount) }}</dd>
        <dt class="font-bold text-gray-800">{{ t('admin.develop.quote.total') }}</dt>
        <dd class="text-right text-base font-bold text-gray-900">{{ formatKrw(amounts.totalAmount) }}</dd>
      </dl>
    </div>

    <!-- 결제 조건 -->
    <div class="mt-3 rounded-lg border border-gray-200 bg-white p-3">
      <div class="flex flex-wrap items-center gap-2">
        <h4 class="text-sm font-bold text-gray-800">{{ t('admin.develop.quote.milestones') }}</h4>
        <span class="text-xs" :class="ratioSum === 10000 ? 'text-gray-500' : 'font-bold text-red-600'">
          {{ t('admin.develop.quote.ratioSum', { percent: (ratioSum / 100).toFixed(2) }) }}
        </span>
        <button
          v-if="hasSchedule"
          type="button"
          class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
          @click="scheduleConfirm = 'milestones'"
        >
          {{ t('admin.develop.quote.fromScheduleMilestones') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="form.milestones.length >= DEVELOP_QUOTE_LIMITS.milestones"
          @click="addMilestone"
        >
          {{ t('admin.develop.quote.addMilestone') }}
        </button>
      </div>
      <div v-if="scheduleConfirm === 'milestones'" class="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2">
        <span class="text-xs font-bold text-amber-900">{{ t('admin.develop.quote.fromScheduleMilestonesConfirm') }}</span>
        <button type="button" class="rounded-md bg-amber-600 px-2 py-1 text-xs font-bold text-white hover:bg-amber-700" @click="applyScheduleMilestones">
          {{ t('admin.develop.quote.confirmYes') }}
        </button>
        <button type="button" class="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-bold text-gray-600" @click="scheduleConfirm = 'none'">
          {{ t('admin.develop.quote.confirmNo') }}
        </button>
      </div>
      <div v-for="(m, i) in form.milestones" :key="`ms-${i}`" class="mt-2 flex flex-wrap items-center gap-1.5">
        <input
          v-model="m.title"
          type="text"
          :maxlength="DEVELOP_QUOTE_LIMITS.milestoneTitleLen"
          :placeholder="t('admin.develop.quote.milestoneTitle')"
          class="h-9 min-w-32 flex-1 rounded-md border border-gray-300 px-3 text-sm"
        >
        <label class="flex items-center gap-1 text-xs text-gray-600">
          <input v-model="m.percent" type="number" min="0.01" max="100" step="0.01" class="h-9 w-20 rounded-md border border-gray-300 px-2 text-sm">
          %
        </label>
        <select v-model="m.trigger" class="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs">
          <option v-for="trig in DEVELOP_MILESTONE_TRIGGERS" :key="trig" :value="trig">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[trig] }}</option>
        </select>
        <label class="flex items-center gap-1 text-xs text-gray-600">
          <input type="checkbox" :checked="m.unlocksDeliverables" @change="setUnlocks(i, ($event.target as HTMLInputElement).checked)">
          {{ t('admin.develop.quote.unlocks') }}
        </label>
        <span class="w-28 text-right text-sm font-semibold text-gray-700">{{ formatKrw(milestoneAmounts[i] ?? 0) }}</span>
        <button
          type="button"
          class="rounded-md border border-red-200 px-2 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
          @click="form.milestones.splice(i, 1)"
        >
          {{ t('admin.develop.quote.removeRow') }}
        </button>
      </div>
      <p class="mt-2 text-xs text-gray-500">{{ t('admin.develop.quote.milestonesHint') }}</p>
      <p v-if="scheduleApplied !== ''" class="mt-1 text-xs text-gray-500">{{ scheduleApplied }}</p>
    </div>

    <!-- 산출물·조건·비고 -->
    <div class="mt-3 grid gap-3 rounded-lg border border-gray-200 bg-white p-3">
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.deliverables') }}</span>
        <textarea v-model="form.deliverables" rows="4" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
        <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.quote.deliverablesHint') }}</span>
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.scheduleNote') }}</span>
        <textarea v-model="form.scheduleNote" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.scheduleNoteLen" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.exclusions') }}</span>
        <textarea v-model="form.exclusions" rows="3" :maxlength="DEVELOP_QUOTE_LIMITS.exclusionsLen" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.terms') }}</span>
        <textarea v-model="form.terms" rows="8" :maxlength="DEVELOP_QUOTE_LIMITS.termsLen" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
        <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.quote.termsHint') }}</span>
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.note') }}</span>
        <textarea v-model="form.note" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.noteLen" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
      </label>
      <label class="block text-sm">
        <span class="font-medium text-gray-800">{{ t('admin.develop.quote.internalNote') }}</span>
        <textarea v-model="form.internalNote" rows="2" :maxlength="DEVELOP_QUOTE_LIMITS.internalNoteLen" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed" />
        <span class="mt-0.5 block text-xs text-gray-500">{{ t('admin.develop.quote.internalNoteHint') }}</span>
      </label>
    </div>

    <!-- 검사 결과 -->
    <ul v-if="issues.length > 0" class="mt-3 grid gap-0.5 text-xs text-red-600">
      <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
    </ul>

    <!-- 발송 확인 -->
    <div v-if="confirmMode === 'send'" class="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p class="text-sm font-bold text-amber-900">{{ t('admin.develop.quote.sendConfirmTitle') }}</p>
      <p class="mt-1 text-sm text-amber-900">
        {{ t('admin.develop.quote.total') }} <b>{{ formatKrw(amounts.totalAmount) }}</b>
        ({{ DEVELOP_VAT_MODE_LABELS[form.vatMode] }}) · {{ t('admin.develop.quote.itemsCount', { count: form.items.length }) }}
      </p>
      <ul class="mt-1 grid gap-0.5 text-xs text-amber-900">
        <li v-for="(m, i) in form.milestones" :key="`c-${i}`">
          · {{ m.title }} — {{ m.percent }}% · {{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }} · {{ formatKrw(milestoneAmounts[i] ?? 0) }}
        </li>
      </ul>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="busy"
          @click="onSendConfirm"
        >
          {{ t('admin.develop.quote.sendConfirm') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
          @click="confirmMode = 'none'"
        >
          {{ t('admin.develop.quote.confirmNo') }}
        </button>
      </div>
    </div>

    <!-- 삭제 확인 -->
    <div v-if="confirmMode === 'delete'" class="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
      <p class="text-sm font-bold text-red-800">{{ t('admin.develop.quote.deleteConfirm') }}</p>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          class="rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
          :disabled="busy"
          @click="onDeleteConfirm"
        >
          {{ t('admin.develop.quote.confirmYes') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
          @click="confirmMode = 'none'"
        >
          {{ t('admin.develop.quote.confirmNo') }}
        </button>
      </div>
    </div>

    <!-- 버튼 줄 -->
    <div class="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        :disabled="busy"
        @click="onSave"
      >
        {{ busy ? t('admin.develop.saving') : t('admin.develop.quote.save') }}
      </button>
      <button
        type="button"
        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="busy || liveIssues.length > 0"
        @click="onSendClick"
      >
        {{ t('admin.develop.quote.send') }}
      </button>
      <button
        v-if="quoteId !== null"
        type="button"
        class="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
        :disabled="busy"
        @click="confirmMode = 'delete'"
      >
        {{ t('admin.develop.quote.delete') }}
      </button>
      <span v-if="notice !== ''" class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</span>
    </div>
  </section>
</template>
