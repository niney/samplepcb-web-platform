<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, Trash2Icon, XIcon } from '@lucide/vue';
import {
  DEVELOP_LABOR_PRESETS_MAX,
  DEVELOP_MILESTONE_TRIGGERS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_AMOUNT_MAX,
  DEVELOP_QUOTE_GRADE_SUGGESTIONS,
  DEVELOP_VAT_MODES,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopMilestoneTriggerType, DevelopVatModeType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopSettings, useSaveAdminDevelopSettings } from '@/admin/useAdminDevelop';
import { developQuoteVatOptions, formatAmountInput, parseAmountInput } from '@/components/admin/develop/develop-quote-edit';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/next/components/ui/input-group';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';
import { Switch } from '@/next/components/ui/switch';
import { Textarea } from '@/next/components/ui/textarea';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 개발의뢰 설정 싱글턴(docs/DEVELOP_FLOW.md §7.3) — 옛 pages/admin/AdminDevelopSettings.vue 의 리뉴얼(같은 배치·검사·저장 본문).
// 견적 생성이 복사해 쓰는 기본값 + 알림 수신자 + AI 자동 초안. 마일스톤 비율은 bp(1/100 %)로 저장되고 합이 정확히
// 100% 여야 서버가 받는다 — 같은 검사를 저장 전에 먼저 해서 400 을 문구로 번역하지 않고 애초에 못 보내게 한다.
// 인건비 기본값(노임 단가표, §5.1) — 견적 편집기 인건비 칸의 '기본값에서 추가'가 이 목록을 줄로 복사한다.

type NumInput = string | number;
interface MilestoneRow {
  title: string;
  percent: NumInput;
  trigger: DevelopMilestoneTriggerType;
}
interface LaborPresetRow {
  role: string;
  grade: string;
  task: string;
  dailyRate: string; // 콤마 허용 — 저장 때 숫자로
}

const { t } = useI18n();
const { data, isLoading } = useAdminDevelopSettings();
const save = useSaveAdminDevelopSettings();

const terms = ref('');
const exclusions = ref('');
const warrantyDays = ref<NumInput>('0');
const reviewDays = ref<NumInput>('7');
const validDays = ref<NumInput>('30');
const vatMode = ref<DevelopVatModeType>('separate');
// 견적 산출 내역 가산율 기본값(%, 저장은 bp) — 새 견적이 복사한다(docs/DEVELOP_FLOW.md §5.1).
const indirectPct = ref<NumInput>('15');
const overheadPct = ref<NumInput>('5');
const profitPct = ref<NumInput>('10');
const milestones = ref<MilestoneRow[]>([]);
const laborPresets = ref<LaborPresetRow[]>([]);
const notifyEmails = ref('');
const aiAutoDraft = ref(false);
const aiDiagramAutoDraft = ref(false);
const notice = ref('');
const noticeError = ref(false);

watch(
  () => data.value?.data,
  (s) => {
    if (s === undefined) return;
    terms.value = s.defaultTerms;
    exclusions.value = s.defaultExclusions;
    warrantyDays.value = String(s.defaultWarrantyDays);
    reviewDays.value = String(s.defaultReviewDays);
    validDays.value = String(s.defaultValidDays);
    vatMode.value = s.defaultVatMode;
    indirectPct.value = String(s.defaultIndirectBp / 100);
    overheadPct.value = String(s.defaultOverheadBp / 100);
    profitPct.value = String(s.defaultProfitBp / 100);
    milestones.value = s.defaultMilestones.map((m) => ({
      title: m.title,
      percent: String(m.ratioBp / 100),
      trigger: m.trigger,
    }));
    laborPresets.value = s.laborPresets.map((lp) => ({
      role: lp.role,
      grade: lp.grade,
      task: lp.task,
      dailyRate: lp.dailyRate.toLocaleString('ko-KR'),
    }));
    notifyEmails.value = s.notifyEmails.join('\n');
    aiAutoDraft.value = s.aiAutoDraft;
    aiDiagramAutoDraft.value = s.aiDiagramAutoDraft;
  },
  { immediate: true },
);

const ratioBpOf = (row: MilestoneRow): number => Math.round(Number(row.percent) * 100);
const rateBpOf = (pct: NumInput): number => (String(pct).trim() === '' ? 0 : Math.round(Number(pct) * 100));
const RATE_MAX_BP = 5000;
const ratioSum = computed(() => milestones.value.reduce((n, m) => n + ratioBpOf(m), 0));
const emailList = computed(() =>
  notifyEmails.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ''),
);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const badEmails = computed(() => emailList.value.filter((e) => !EMAIL_RE.test(e)));
const presetRateOf = (row: LaborPresetRow): number => parseAmountInput(row.dailyRate);
const presetRateBad = (row: LaborPresetRow): boolean => {
  const n = presetRateOf(row);
  return !Number.isFinite(n) || n < 0 || n > DEVELOP_QUOTE_AMOUNT_MAX || !Number.isInteger(n);
};

const issues = computed<string[]>(() => {
  const list: string[] = [];
  if (milestones.value.length === 0) list.push(t('admin.develop.settings.errNoMilestone'));
  if (milestones.value.some((m) => m.title.trim() === '')) list.push(t('admin.develop.settings.errMilestoneTitle'));
  if (milestones.value.some((m) => !Number.isFinite(ratioBpOf(m)) || ratioBpOf(m) < 1 || ratioBpOf(m) > 10_000)) {
    list.push(t('admin.develop.settings.errMilestoneRatio'));
  }
  if (milestones.value.length > 0 && ratioSum.value !== 10_000) list.push(t('admin.develop.settings.errRatioSum'));
  if (badEmails.value.length > 0) list.push(t('admin.develop.settings.errEmail', { emails: badEmails.value.join(', ') }));
  if ([indirectPct.value, overheadPct.value, profitPct.value].some((p) => !Number.isFinite(rateBpOf(p)) || rateBpOf(p) < 0 || rateBpOf(p) > RATE_MAX_BP)) {
    list.push(t('admin.develop.settings.errRate'));
  }
  laborPresets.value.forEach((row, i) => {
    if (row.role.trim() === '') list.push(t('admin.develop.settings.errPresetRole', { row: i + 1 }));
    if (presetRateBad(row)) list.push(t('admin.develop.settings.errPresetRate', { row: i + 1 }));
  });
  return list;
});

const addMilestone = (): void => {
  if (milestones.value.length >= 10) return;
  milestones.value.push({ title: '', percent: '0', trigger: 'manual' });
};
const addPreset = (): void => {
  if (laborPresets.value.length >= DEVELOP_LABOR_PRESETS_MAX) return;
  laborPresets.value.push({ role: '', grade: '', task: '', dailyRate: '' });
};
const movePreset = (index: number, delta: -1 | 1): void => {
  const rows = laborPresets.value;
  const from = rows[index];
  const to = rows[index + delta];
  if (from === undefined || to === undefined) return;
  rows[index] = to;
  rows[index + delta] = from;
};
const isTrigger = (value: unknown): value is DevelopMilestoneTriggerType =>
  typeof value === 'string' && (DEVELOP_MILESTONE_TRIGGERS as readonly string[]).includes(value);
const isVatMode = (value: unknown): value is DevelopVatModeType =>
  typeof value === 'string' && (DEVELOP_VAT_MODES as readonly string[]).includes(value);
const onVatModePick = (value: unknown): void => {
  if (isVatMode(value)) vatMode.value = value;
};
const onTriggerPick = (row: MilestoneRow, value: unknown): void => {
  if (isTrigger(value)) row.trigger = value;
};

async function onSubmit(): Promise<void> {
  notice.value = '';
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.settings.blocked');
    return;
  }
  try {
    await save.mutateAsync({
      defaultTerms: terms.value,
      defaultExclusions: exclusions.value,
      defaultWarrantyDays: Number(warrantyDays.value),
      defaultReviewDays: Number(reviewDays.value),
      defaultValidDays: Number(validDays.value),
      defaultVatMode: vatMode.value,
      defaultIndirectBp: rateBpOf(indirectPct.value),
      defaultOverheadBp: rateBpOf(overheadPct.value),
      defaultProfitBp: rateBpOf(profitPct.value),
      laborPresets: laborPresets.value.map((row) => ({
        role: row.role.trim(),
        grade: row.grade.trim(),
        task: row.task.trim(),
        dailyRate: Math.round(presetRateOf(row)),
      })),
      defaultMilestones: milestones.value.map((m) => ({
        title: m.title.trim(),
        ratioBp: ratioBpOf(m),
        trigger: m.trigger,
      })),
      notifyEmails: emailList.value,
      aiAutoDraft: aiAutoDraft.value,
      aiDiagramAutoDraft: aiDiagramAutoDraft.value,
    });
    noticeError.value = false;
    notice.value = t('admin.develop.settings.saved');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.settings.saveFail'));
  }
}
</script>

<template>
  <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
    <Spinner />
    {{ t('admin.develop.loading') }}
  </p>

  <form v-else class="flex max-w-4xl flex-col gap-4" @submit.prevent="onSubmit">
    <!-- 견적서 기본값 -->
    <SectionCard :title="t('admin.develop.settings.quoteDefaults')">
      <Field>
        <FieldLabel for="develop-settings-terms">{{ t('admin.develop.settings.terms') }}</FieldLabel>
        <Textarea id="develop-settings-terms" v-model="terms" rows="8" :maxlength="20000" />
        <FieldDescription>{{ t('admin.develop.settings.termsHint') }}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel for="develop-settings-exclusions">{{ t('admin.develop.settings.exclusions') }}</FieldLabel>
        <Textarea id="develop-settings-exclusions" v-model="exclusions" rows="3" :maxlength="4000" />
        <FieldDescription>{{ t('admin.develop.settings.exclusionsHint') }}</FieldDescription>
      </Field>
      <div class="grid gap-4 sm:grid-cols-4">
        <Field>
          <FieldLabel for="develop-settings-warranty">{{ t('admin.develop.settings.warrantyDays') }}</FieldLabel>
          <Input id="develop-settings-warranty" v-model="warrantyDays" type="number" min="0" max="3650" class="text-right tabular-nums" />
        </Field>
        <Field>
          <FieldLabel for="develop-settings-review">{{ t('admin.develop.settings.reviewDays') }}</FieldLabel>
          <Input id="develop-settings-review" v-model="reviewDays" type="number" min="1" max="90" class="text-right tabular-nums" />
        </Field>
        <Field>
          <FieldLabel for="develop-settings-valid">{{ t('admin.develop.settings.validDays') }}</FieldLabel>
          <Input id="develop-settings-valid" v-model="validDays" type="number" min="1" max="365" class="text-right tabular-nums" />
        </Field>
        <Field>
          <FieldLabel for="develop-settings-vat">{{ t('admin.develop.settings.vatMode') }}</FieldLabel>
          <NativeSelect id="develop-settings-vat" :model-value="vatMode" class="w-full" @update:model-value="onVatModePick">
            <NativeSelectOption v-for="mode in developQuoteVatOptions(vatMode)" :key="mode" :value="mode">
              {{ DEVELOP_VAT_MODE_LABELS[mode] }}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
      </div>
      <div class="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel for="develop-settings-indirect">{{ t('admin.develop.settings.rateIndirect') }}</FieldLabel>
          <Input id="develop-settings-indirect" v-model="indirectPct" inputmode="decimal" class="text-right tabular-nums" />
        </Field>
        <Field>
          <FieldLabel for="develop-settings-overhead">{{ t('admin.develop.settings.rateOverhead') }}</FieldLabel>
          <Input id="develop-settings-overhead" v-model="overheadPct" inputmode="decimal" class="text-right tabular-nums" />
        </Field>
        <Field>
          <FieldLabel for="develop-settings-profit">{{ t('admin.develop.settings.rateProfit') }}</FieldLabel>
          <Input id="develop-settings-profit" v-model="profitPct" inputmode="decimal" class="text-right tabular-nums" />
        </Field>
      </div>
      <FieldDescription>{{ t('admin.develop.settings.ratesHint') }}</FieldDescription>
    </SectionCard>

    <!-- 인건비 기본값(노임 단가표) -->
    <SectionCard :title="t('admin.develop.settings.laborPresets')" data-testid="develop-settings-labor-presets">
      <template #meta>
        {{ t('admin.develop.settings.presetsCount', { count: laborPresets.length, max: DEVELOP_LABOR_PRESETS_MAX }) }}
      </template>
      <template #actions>
        <Button type="button" variant="outline" size="sm" :disabled="laborPresets.length >= DEVELOP_LABOR_PRESETS_MAX" @click="addPreset">
          <PlusIcon />
          {{ t('admin.develop.settings.addPreset') }}
        </Button>
      </template>
      <datalist id="develop-settings-grades">
        <option v-for="g in DEVELOP_QUOTE_GRADE_SUGGESTIONS" :key="g" :value="g" />
      </datalist>
      <div
        v-if="laborPresets.length > 0"
        class="text-muted-foreground hidden items-end gap-2 border-b pb-1 text-xs font-medium md:grid md:grid-cols-[1.5rem_9rem_6rem_minmax(0,1fr)_9.5rem_4.75rem]"
        aria-hidden="true"
      >
        <span>#</span>
        <span>{{ t('admin.develop.settings.presetRole') }}</span>
        <span>{{ t('admin.develop.settings.presetGrade') }}</span>
        <span>{{ t('admin.develop.settings.presetTask') }}</span>
        <span class="text-right">{{ t('admin.develop.settings.presetDailyRate') }}</span>
        <span />
      </div>
      <div
        v-for="(lp, i) in laborPresets"
        :key="`preset-${String(i)}`"
        class="flex flex-wrap items-center gap-2 md:grid md:grid-cols-[1.5rem_9rem_6rem_minmax(0,1fr)_9.5rem_4.75rem]"
        data-testid="develop-settings-preset-row"
      >
        <span class="text-muted-foreground w-6 text-xs font-semibold tabular-nums">{{ i + 1 }}</span>
        <Input
          v-model="lp.role"
          :maxlength="100"
          :placeholder="t('admin.develop.settings.presetRole')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.settings.presetRole')}`"
          class="w-36 md:w-full"
        />
        <Input
          v-model="lp.grade"
          list="develop-settings-grades"
          :maxlength="50"
          :placeholder="t('admin.develop.settings.presetGrade')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.settings.presetGrade')}`"
          class="w-24 md:w-full"
        />
        <Input
          v-model="lp.task"
          :maxlength="200"
          :placeholder="t('admin.develop.settings.presetTask')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.settings.presetTask')}`"
          class="min-w-48 flex-1 md:w-full"
        />
        <InputGroup class="w-40 md:w-full">
          <InputGroupInput
            v-model="lp.dailyRate"
            inputmode="numeric"
            :aria-label="`${String(i + 1)} ${t('admin.develop.settings.presetDailyRate')}`"
            class="text-right tabular-nums"
            @blur="lp.dailyRate = formatAmountInput(lp.dailyRate)"
          />
          <InputGroupAddon align="inline-end">원/일</InputGroupAddon>
        </InputGroup>
        <div class="flex items-center justify-end">
          <Button type="button" variant="ghost" size="icon-xs" aria-label="위로" title="위로" :disabled="i === 0" @click="movePreset(i, -1)">
            <ChevronUpIcon />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label="아래로" title="아래로" :disabled="i === laborPresets.length - 1" @click="movePreset(i, 1)">
            <ChevronDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            :aria-label="`${String(i + 1)} ${t('admin.develop.settings.removePreset')}`"
            :title="t('admin.develop.settings.removePreset')"
            @click="laborPresets.splice(i, 1)"
          >
            <XIcon class="text-destructive" />
          </Button>
        </div>
      </div>
      <p v-if="laborPresets.length === 0" class="text-muted-foreground text-sm">{{ t('admin.develop.settings.presetsEmpty') }}</p>
      <p class="text-muted-foreground text-sm">{{ t('admin.develop.settings.laborPresetsHint') }}</p>
    </SectionCard>

    <!-- 기본 마일스톤 -->
    <SectionCard :title="t('admin.develop.settings.milestones')">
      <template #meta>
        <span :class="ratioSum === 10000 ? '' : 'text-destructive font-semibold'">
          {{ t('admin.develop.settings.ratioSum', { percent: (ratioSum / 100).toFixed(2) }) }}
        </span>
      </template>
      <template #actions>
        <Button type="button" variant="outline" size="sm" :disabled="milestones.length >= 10" @click="addMilestone">
          <PlusIcon />
          {{ t('admin.develop.settings.addMilestone') }}
        </Button>
      </template>
      <div v-for="(m, i) in milestones" :key="`ms-${String(i)}`" class="flex flex-wrap items-center gap-2">
        <Input
          v-model="m.title"
          type="text"
          :maxlength="100"
          :placeholder="t('admin.develop.settings.milestoneTitle')"
          :aria-label="t('admin.develop.settings.milestoneTitle')"
          class="min-w-40 flex-1"
        />
        <InputGroup class="w-28">
          <InputGroupInput
            v-model="m.percent"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            :aria-label="`${t('admin.develop.settings.milestones')} %`"
            class="text-right tabular-nums"
          />
          <InputGroupAddon align="inline-end">%</InputGroupAddon>
        </InputGroup>
        <NativeSelect
          :model-value="m.trigger"
          :aria-label="t('admin.develop.settings.milestones')"
          @update:model-value="onTriggerPick(m, $event)"
        >
          <NativeSelectOption v-for="trig in DEVELOP_MILESTONE_TRIGGERS" :key="trig" :value="trig">
            {{ DEVELOP_MILESTONE_TRIGGER_LABELS[trig] }}
          </NativeSelectOption>
        </NativeSelect>
        <Button type="button" variant="outline" size="sm" @click="milestones.splice(i, 1)">
          <Trash2Icon />
          {{ t('admin.develop.settings.removeMilestone') }}
        </Button>
      </div>
      <p class="text-muted-foreground text-sm">{{ t('admin.develop.settings.milestonesHint') }}</p>
    </SectionCard>

    <!-- 알림·AI -->
    <SectionCard :title="t('admin.develop.settings.notifyAi')">
      <Field>
        <FieldLabel for="develop-settings-emails">{{ t('admin.develop.settings.notifyEmails') }}</FieldLabel>
        <Textarea id="develop-settings-emails" v-model="notifyEmails" rows="3" />
        <FieldDescription>{{ t('admin.develop.settings.notifyEmailsHint') }}</FieldDescription>
      </Field>
      <div class="flex items-center gap-2">
        <Switch id="develop-settings-ai-review" v-model="aiAutoDraft" />
        <Label for="develop-settings-ai-review">{{ t('admin.develop.settings.aiAutoDraft') }}</Label>
      </div>
      <div class="flex items-center gap-2">
        <Switch id="develop-settings-ai-diagram" v-model="aiDiagramAutoDraft" />
        <Label for="develop-settings-ai-diagram">{{ t('admin.develop.settings.aiDiagramAutoDraft') }}</Label>
      </div>
    </SectionCard>

    <Alert v-if="issues.length > 0" variant="destructive" size="sm">
      <AlertDescription>
        <ul class="grid gap-0.5">
          <li v-for="(issue, i) in issues" :key="i">· {{ issue }}</li>
        </ul>
      </AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-center gap-3">
      <Button type="submit" :disabled="save.isPending.value || issues.length > 0">
        {{ save.isPending.value ? t('admin.develop.saving') : t('admin.develop.settings.save') }}
      </Button>
      <span v-if="notice !== ''" class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">
        {{ notice }}
      </span>
      <span v-if="data !== undefined && data.data.updatedAt !== null" class="text-muted-foreground ml-auto text-sm tabular-nums">
        {{ t('admin.develop.settings.updatedAt') }} {{ formatDateTime(data.data.updatedAt) }}
      </span>
    </div>
  </form>
</template>
