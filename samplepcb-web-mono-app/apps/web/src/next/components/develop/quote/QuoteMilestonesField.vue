<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PlusIcon, Trash2Icon } from '@lucide/vue';
import { DEVELOP_MILESTONE_TRIGGERS, DEVELOP_MILESTONE_TRIGGER_LABELS } from '@sp/api-contract';
import type { AcceptableValue } from 'reka-ui';
import type { DevReviewScheduleType, DevelopMilestoneTriggerType } from '@sp/api-contract';
import { DEVELOP_QUOTE_LIMITS, type DevelopQuoteMilestoneRow } from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { confirmDialog } from '@/next/lib/dialog';

// 견적서 편집기의 결제 조건(마일스톤) — 행 편집 + 비율 합 + 「단계로 마일스톤 초안 만들기」(docs/DEVELOP_FLOW.md §6.1).
// 옛 DevelopQuoteEditor 의 결제 조건 블록을 떼어 왔다. 금액은 편집기가 계약 순수 함수로 나눠 넘긴다(끝 행이 반올림 차액 흡수).
const milestones = defineModel<DevelopQuoteMilestoneRow[]>('milestones', { required: true });
/** 검토서 일정을 가져왔을 때의 안내 한 줄(기간 가져오기와 같은 문구를 편집기와 함께 쓴다). */
const applied = defineModel<string>('applied', { required: true });
const props = defineProps<{
  milestoneAmounts: readonly number[];
  ratioSum: number;
  schedule: DevReviewScheduleType | null;
  /** 편집기 안에서 겹치지 않는 id 접두(체크박스 label 연결용). */
  idPrefix: string;
}>();

const { t } = useI18n();
const hasSchedule = computed(() => (props.schedule?.phases.length ?? 0) > 0);

const addMilestone = (): void => {
  if (milestones.value.length >= DEVELOP_QUOTE_LIMITS.milestones) return;
  milestones.value.push({ title: '', percent: '0', trigger: 'manual', unlocksDeliverables: false });
};

// 산출물 해제는 하나만(계약 superRefine) — 체크하면 나머지를 끈다.
const setUnlocks = (index: number, checked: boolean): void => {
  milestones.value = milestones.value.map((m, i) => ({ ...m, unlocksDeliverables: checked && i === index }));
};

const isTrigger = (value: AcceptableValue): value is DevelopMilestoneTriggerType =>
  typeof value === 'string' && (DEVELOP_MILESTONE_TRIGGERS as readonly string[]).includes(value);
const setTrigger = (row: DevelopQuoteMilestoneRow, value: AcceptableValue): void => {
  if (isTrigger(value)) row.trigger = value;
};

// 단계 → 결제 조건 초안. 첫 행은 수락 시, 마지막 행은 검수 확정 시(산출물 해제), 중간은 수동 청구.
// 비율은 균등 분할 정수이고 나머지는 마지막 행이 흡수한다(합 100%). 지금 결제 조건을 통째 바꾸므로 확인을 거친다.
const applyScheduleMilestones = async (): Promise<void> => {
  const ok = await confirmDialog({
    message: t('admin.develop.quote.fromScheduleMilestonesConfirm'),
    confirmLabel: t('admin.develop.quote.confirmYes'),
    cancelLabel: t('admin.develop.quote.confirmNo'),
  });
  if (!ok) return;
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
  milestones.value = Array.from({ length: count }, (_, i) => {
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
  applied.value = t('admin.develop.quote.fromScheduleNote');
};
</script>

<template>
  <Panel size="sm" tone="card" class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h4 class="text-sm font-semibold">{{ t('admin.develop.quote.milestones') }}</h4>
      <span class="text-xs tabular-nums" :class="ratioSum === 10000 ? 'text-muted-foreground' : 'text-destructive font-semibold'">
        {{ t('admin.develop.quote.ratioSum', { percent: (ratioSum / 100).toFixed(2) }) }}
      </span>
      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <Button v-if="hasSchedule" variant="outline" size="xs" @click="applyScheduleMilestones">
          {{ t('admin.develop.quote.fromScheduleMilestones') }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="milestones.length >= DEVELOP_QUOTE_LIMITS.milestones"
          @click="addMilestone"
        >
          <PlusIcon />
          {{ t('admin.develop.quote.addMilestone') }}
        </Button>
      </div>
    </div>

    <div v-for="(m, i) in milestones" :key="`ms-${i}`" class="flex flex-wrap items-center gap-1.5">
      <Input
        v-model="m.title"
        :maxlength="DEVELOP_QUOTE_LIMITS.milestoneTitleLen"
        :placeholder="t('admin.develop.quote.milestoneTitle')"
        :aria-label="`${String(i + 1)} ${t('admin.develop.quote.milestoneTitle')}`"
        class="min-w-32 flex-1"
      />
      <span class="text-muted-foreground flex items-center gap-1 text-xs">
        <Input
          :model-value="String(m.percent)"
          type="number"
          min="0.01"
          max="100"
          step="0.01"
          :aria-label="`${String(i + 1)} %`"
          class="w-20 text-right tabular-nums"
          @update:model-value="(v) => (m.percent = String(v))"
        />
        %
      </span>
      <NativeSelect
        :model-value="m.trigger"
        :aria-label="`${String(i + 1)} ${t('admin.develop.quote.milestones')}`"
        @update:model-value="(v) => setTrigger(m, v)"
      >
        <NativeSelectOption v-for="trig in DEVELOP_MILESTONE_TRIGGERS" :key="trig" :value="trig">
          {{ DEVELOP_MILESTONE_TRIGGER_LABELS[trig] }}
        </NativeSelectOption>
      </NativeSelect>
      <span class="flex items-center gap-1.5">
        <Checkbox
          :id="`${idPrefix}-unlocks-${String(i)}`"
          :model-value="m.unlocksDeliverables"
          @update:model-value="(v) => setUnlocks(i, v === true)"
        />
        <label :for="`${idPrefix}-unlocks-${String(i)}`" class="cursor-pointer text-xs">{{ t('admin.develop.quote.unlocks') }}</label>
      </span>
      <span class="w-28 text-right text-sm font-medium tabular-nums">{{ formatKrw(milestoneAmounts[i] ?? 0) }}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        :aria-label="t('admin.develop.quote.removeRow')"
        :title="t('admin.develop.quote.removeRow')"
        @click="milestones.splice(i, 1)"
      >
        <Trash2Icon class="text-destructive" />
      </Button>
    </div>
    <p class="text-muted-foreground text-xs">{{ t('admin.develop.quote.milestonesHint') }}</p>
    <p v-if="applied !== ''" class="text-muted-foreground text-xs">{{ applied }}</p>
  </Panel>
</template>
