<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon, Trash2Icon } from '@lucide/vue';
import {
  DEV_REVIEW_GENERAL_AREA,
  developAreaLabel,
  devReviewScheduleFit,
  devReviewScheduleTotals,
} from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import {
  DEVELOP_REVIEW_LIMITS,
  cloneDevelopReview,
  emptyDevelopSchedule,
  emptyDevelopSchedulePhase,
} from '@/components/admin/develop/develop-review-edit';
import { confirmDialog } from '@/next/lib/dialog';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';
import ReviewListHead from './ReviewListHead.vue';
import ReviewRemoveButton from './ReviewRemoveButton.vue';

// 검토서 작업본 구조 편집기 — 옛 components/admin/develop/DevelopReviewEditor.vue 의 짝(같은 props·emits).
// 요약·핵심 요구사항·분야별 명세/관찰·개발 일정(예상)·상의 항목(확인 결과)·담당자 의견.
// 로컬 상태는 서버 응답의 **복사본**이다(같은 객체를 참조하면 미리보기가 저장 전 값으로 튄다).
// 재시드는 seedKey 가 바뀔 때만 — 폴링 재조회가 편집 중인 내용을 지우면 안 된다.
// dirty = 지금 JSON ≠ 시드 JSON(옛 편집기와 같은 판정 — 상세의 이탈 가드가 이 값을 쓴다).
// `evidence`(근거)와 `checks`(답변↔자료 정합)는 AI 산출 사실이라 표시만 한다.
const props = defineProps<{ source: MarketDevReviewType; seedKey: string; disabled: boolean }>();
const emit = defineEmits<{ update: [review: MarketDevReviewType, dirty: boolean] }>();

const { t } = useI18n();
const L = DEVELOP_REVIEW_LIMITS;

const local = ref(cloneDevelopReview(props.source));
const seedJson = ref(JSON.stringify(local.value));

watch(
  () => props.seedKey,
  () => {
    local.value = cloneDevelopReview(props.source);
    seedJson.value = JSON.stringify(local.value);
    emit('update', local.value, false);
  },
);

watch(
  local,
  (value) => {
    emit('update', value, JSON.stringify(value) !== seedJson.value);
  },
  { deep: true, immediate: true },
);

const areaTitle = (area: string): string =>
  area === DEV_REVIEW_GENERAL_AREA ? t('admin.devReview.generalArea') : developAreaLabel(area);

const addRequirement = (): void => {
  if (local.value.requirements.length >= L.requirements) return;
  local.value.requirements.push({ text: '', evidence: null });
};
const addSpec = (index: number): void => {
  const area = local.value.areas[index];
  if (area === undefined || area.spec.length >= L.spec) return;
  area.spec.push({ item: '', text: '', evidence: null });
};
const addObservation = (index: number): void => {
  const area = local.value.areas[index];
  if (area === undefined || area.observations.length >= L.observations) return;
  area.observations.push({ text: '', evidence: null });
};
const addQuestion = (): void => {
  if (local.value.openQuestions.length >= L.openQuestions) return;
  local.value.openQuestions.push({ question: '', why: '', area: DEV_REVIEW_GENERAL_AREA, resolution: null });
};

// 확인 결과·담당자 의견은 null 일 수 있다 — 입력하면 문자열(옛 편집기의 textarea v-model 과 같은 결과).
const setResolution = (index: number, value: string | number): void => {
  const row = local.value.openQuestions[index];
  if (row !== undefined) row.resolution = String(value);
};
const setAdminComment = (value: string | number): void => {
  local.value.adminComment = String(value);
};

const hasEvidence = (evidence: string | null | undefined): evidence is string =>
  evidence !== null && evidence !== undefined && evidence !== '';

// ── 개발 일정(예상) ──────────────────────────────────────────────────────────
// 합계·희망 시점 대조는 계약의 순수 함수로 매 입력마다 다시 낸다(저장값이 아니다).
const schedulePhases = computed(() => local.value.schedule?.phases ?? []);
const hasSchedule = computed(() => local.value.schedule !== null && local.value.schedule !== undefined);
const scheduleTotals = computed(() => devReviewScheduleTotals(local.value.schedule));
const scheduleFit = computed(() => devReviewScheduleFit(local.value.schedule));
const FIT_CLASS = {
  ok: 'text-success',
  tight: 'text-warning',
  over: 'text-destructive',
  unknown: 'text-muted-foreground',
} as const;

// 일정이 없을 때 '단계 추가'는 빈 일정을 만든다(wishCode 는 고객 답변에서 온다).
const addSchedulePhase = (): void => {
  const schedule = local.value.schedule;
  if (schedule === null || schedule === undefined) {
    local.value.schedule = emptyDevelopSchedule(local.value);
    return;
  }
  if (schedule.phases.length >= L.schedulePhases) return;
  schedule.phases.push(emptyDevelopSchedulePhase());
};

const moveSchedulePhase = (index: number, delta: number): void => {
  const rows = local.value.schedule?.phases;
  if (rows === undefined) return;
  const next = index + delta;
  const from = rows[index];
  const to = rows[next];
  if (from === undefined || to === undefined) return;
  rows[index] = to;
  rows[next] = from;
};

const removeSchedulePhase = (index: number): void => {
  local.value.schedule?.phases.splice(index, 1);
};

// 주 입력 — 비우면 0 이 되고 저장 전 검사(1~104)가 잡는다. 조용히 1 로 되돌리면 관리자가 못 알아챈다.
const setWeeks = (index: number, key: 'minWeeks' | 'maxWeeks', raw: string | number): void => {
  const row = local.value.schedule?.phases[index];
  if (row === undefined) return;
  const n = Number.parseInt(String(raw), 10);
  row[key] = Number.isFinite(n) ? n : 0;
};

// 일정 통째 삭제 — 저장 전까지는 편집 중 상태일 뿐이지만, 적어 둔 단계가 한 번에 사라지므로 묻는다.
async function clearSchedule(): Promise<void> {
  const ok = await confirmDialog({
    message: t('admin.develop.review.schedule.clearConfirm'),
    confirmLabel: t('admin.develop.review.schedule.clearYes'),
    tone: 'danger',
  });
  if (ok) local.value.schedule = null;
}
</script>

<template>
  <!-- fieldset 하나로 잠근다 — 저장·공개 처리 중에는 입력·행 버튼이 모두 멈춘다(옛 편집기와 같음). -->
  <fieldset class="grid min-w-0 gap-6" :disabled="props.disabled">
    <!-- 요약 -->
    <Field>
      <FieldLabel for="dev-review-summary">{{ t('admin.develop.editor.summary') }}</FieldLabel>
      <Textarea id="dev-review-summary" v-model="local.summary" rows="2" :maxlength="L.summaryLen" />
    </Field>

    <!-- 핵심 요구사항 -->
    <div class="grid gap-2">
      <ReviewListHead
        :title="t('admin.develop.editor.requirements')"
        :count="local.requirements.length"
        :limit="L.requirements"
        :add-label="t('admin.develop.editor.addRow')"
        @add="addRequirement"
      />
      <div v-for="(row, i) in local.requirements" :key="`req-${i}`" class="grid gap-1">
        <div class="flex items-start gap-1.5">
          <Input
            v-model="row.text"
            type="text"
            class="min-w-0 flex-1"
            :maxlength="L.factTextLen"
            :placeholder="t('admin.develop.editor.requirementPlaceholder')"
          />
          <ReviewRemoveButton @remove="local.requirements.splice(i, 1)" />
        </div>
        <p v-if="hasEvidence(row.evidence)" class="text-muted-foreground px-1 text-xs">
          {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
        </p>
      </div>
      <p v-if="local.requirements.length === 0" class="text-muted-foreground text-sm">
        {{ t('admin.develop.editor.noRows') }}
      </p>
    </div>

    <!-- 분야별 검토 -->
    <Panel v-for="(area, ai) in local.areas" :key="`area-${area.area}-${ai}`" size="md" class="grid gap-4">
      <div>
        <Badge variant="info">{{ areaTitle(area.area) }}</Badge>
      </div>
      <Field>
        <FieldLabel :for="`dev-review-area-${ai}`">{{ t('admin.develop.editor.areaSummary') }}</FieldLabel>
        <Input :id="`dev-review-area-${ai}`" v-model="area.summary" type="text" :maxlength="L.areaSummaryLen" />
      </Field>

      <div class="grid gap-2">
        <ReviewListHead
          size="sub"
          :title="t('admin.develop.editor.spec')"
          :count="area.spec.length"
          :limit="L.spec"
          :add-label="t('admin.develop.editor.addRow')"
          @add="addSpec(ai)"
        />
        <div v-for="(row, si) in area.spec" :key="`spec-${si}`" class="grid gap-1">
          <div class="flex items-start gap-1.5">
            <Input
              v-model="row.item"
              type="text"
              class="w-32 shrink-0"
              :maxlength="L.specItemLen"
              :placeholder="t('admin.develop.editor.specItemPlaceholder')"
            />
            <Input
              v-model="row.text"
              type="text"
              class="min-w-0 flex-1"
              :maxlength="L.factTextLen"
              :placeholder="t('admin.develop.editor.specTextPlaceholder')"
            />
            <ReviewRemoveButton @remove="area.spec.splice(si, 1)" />
          </div>
          <p v-if="hasEvidence(row.evidence)" class="text-muted-foreground px-1 text-xs">
            {{ t('admin.devReview.evidence') }}: {{ row.evidence }}
          </p>
        </div>
      </div>

      <div class="grid gap-2">
        <ReviewListHead
          size="sub"
          :title="t('admin.develop.editor.observations')"
          :count="area.observations.length"
          :limit="L.observations"
          :add-label="t('admin.develop.editor.addRow')"
          @add="addObservation(ai)"
        />
        <div v-for="(row, oi) in area.observations" :key="`obs-${oi}`" class="flex items-start gap-1.5">
          <Input v-model="row.text" type="text" class="min-w-0 flex-1" :maxlength="L.factTextLen" />
          <ReviewRemoveButton @remove="area.observations.splice(oi, 1)" />
        </div>
      </div>
    </Panel>

    <!-- 개발 일정(예상) — 검토서의 일정은 예상이고, 확정 기간은 견적서가 정한다(docs/DEVELOP_FLOW.md §6.1) -->
    <Panel size="md" class="grid gap-3">
      <ReviewListHead
        :title="t('admin.develop.review.schedule.title')"
        :count="schedulePhases.length"
        :limit="L.schedulePhases"
        :add-label="t('admin.develop.review.schedule.addPhase')"
        @add="addSchedulePhase"
      >
        <template #actions>
          <Button v-if="hasSchedule" variant="outline" size="xs" @click="clearSchedule">
            <Trash2Icon class="text-destructive" />
            {{ t('admin.develop.review.schedule.clear') }}
          </Button>
        </template>
      </ReviewListHead>
      <p class="text-muted-foreground text-xs">{{ t('admin.develop.review.schedule.hint') }}</p>

      <Panel v-for="(phase, pi) in schedulePhases" :key="`phase-${pi}`" tone="muted" class="grid gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-muted-foreground w-5 text-xs font-semibold tabular-nums">{{ pi + 1 }}</span>
          <Input
            v-model="phase.name"
            type="text"
            class="min-w-32 flex-1"
            :maxlength="L.schedulePhaseNameLen"
            :placeholder="t('admin.develop.review.schedule.namePlaceholder')"
          />
          <span class="text-muted-foreground flex items-center gap-1 text-xs">
            <Input
              type="number"
              min="1"
              :max="L.scheduleWeeksMax"
              class="w-16 tabular-nums"
              :model-value="phase.minWeeks"
              :aria-label="`${pi + 1}단계 최소 주`"
              @update:model-value="(v) => setWeeks(pi, 'minWeeks', v)"
            />
            ~
            <Input
              type="number"
              min="1"
              :max="L.scheduleWeeksMax"
              class="w-16 tabular-nums"
              :model-value="phase.maxWeeks"
              :aria-label="`${pi + 1}단계 최대 주`"
              @update:model-value="(v) => setWeeks(pi, 'maxWeeks', v)"
            />
            {{ t('admin.develop.review.schedule.weeks') }}
          </span>
          <span class="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="t('admin.develop.review.schedule.moveUp')"
              :disabled="pi === 0"
              @click="moveSchedulePhase(pi, -1)"
            >
              <ChevronUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              :aria-label="t('admin.develop.review.schedule.moveDown')"
              :disabled="pi === schedulePhases.length - 1"
              @click="moveSchedulePhase(pi, 1)"
            >
              <ChevronDownIcon />
            </Button>
            <ReviewRemoveButton @remove="removeSchedulePhase(pi)" />
          </span>
        </div>
        <div class="grid gap-1.5 sm:grid-cols-3">
          <Input
            v-model="phase.output"
            type="text"
            class="min-w-0"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.outputPlaceholder')"
          />
          <Input
            v-model="phase.prerequisite"
            type="text"
            class="min-w-0"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.prerequisitePlaceholder')"
          />
          <Input
            v-model="phase.note"
            type="text"
            class="min-w-0"
            :maxlength="L.schedulePhaseTextLen"
            :placeholder="t('admin.develop.review.schedule.notePlaceholder')"
          />
        </div>
      </Panel>

      <p v-if="schedulePhases.length === 0" class="text-muted-foreground text-sm">
        {{ t('admin.develop.review.schedule.empty') }}
      </p>

      <template v-if="local.schedule !== null && local.schedule !== undefined && schedulePhases.length > 0">
        <Field>
          <FieldLabel for="dev-review-assumptions">{{ t('admin.develop.review.schedule.assumptions') }}</FieldLabel>
          <Input
            id="dev-review-assumptions"
            v-model="local.schedule.assumptions"
            type="text"
            :maxlength="L.scheduleAssumptionsLen"
            :placeholder="t('admin.develop.review.schedule.assumptionsPlaceholder')"
          />
        </Field>
        <div class="grid gap-0.5">
          <p class="text-sm font-semibold tabular-nums">
            {{ t('admin.develop.review.schedule.total', { min: scheduleTotals.minWeeks, max: scheduleTotals.maxWeeks }) }}
          </p>
          <p class="text-xs font-semibold" :class="FIT_CLASS[scheduleFit.status]">{{ scheduleFit.text }}</p>
        </div>
      </template>
    </Panel>

    <!-- 상의 항목 + 확인 결과 -->
    <div class="grid gap-2">
      <ReviewListHead
        :title="t('admin.develop.editor.openQuestions')"
        :count="local.openQuestions.length"
        :limit="L.openQuestions"
        :add-label="t('admin.develop.editor.addRow')"
        @add="addQuestion"
      />
      <Panel v-for="(row, qi) in local.openQuestions" :key="`q-${qi}`" class="grid gap-1.5">
        <div class="flex items-start gap-1.5">
          <Badge variant="warning" class="mt-1.5 shrink-0">{{ areaTitle(row.area) }}</Badge>
          <Input
            v-model="row.question"
            type="text"
            class="min-w-0 flex-1"
            :maxlength="L.questionLen"
            :placeholder="t('admin.develop.editor.questionPlaceholder')"
          />
          <ReviewRemoveButton @remove="local.openQuestions.splice(qi, 1)" />
        </div>
        <Input
          v-model="row.why"
          type="text"
          :maxlength="L.whyLen"
          :placeholder="t('admin.develop.editor.whyPlaceholder')"
        />
        <Textarea
          :model-value="row.resolution ?? ''"
          rows="2"
          :maxlength="L.resolutionLen"
          :placeholder="t('admin.develop.editor.resolutionPlaceholder')"
          @update:model-value="(v) => setResolution(qi, v)"
        />
      </Panel>
      <p v-if="local.openQuestions.length === 0" class="text-muted-foreground text-sm">
        {{ t('admin.develop.editor.noRows') }}
      </p>
    </div>

    <!-- 답변↔자료 정합(표시만) -->
    <Panel v-if="local.checks.length > 0" tone="muted" class="grid gap-1">
      <span class="text-muted-foreground text-xs font-semibold">{{ t('admin.devReview.check') }}</span>
      <p v-for="(c, ci) in local.checks" :key="`chk-${ci}`" class="text-sm">{{ c.text }}</p>
    </Panel>

    <!-- 담당자 의견 -->
    <Field>
      <FieldLabel for="dev-review-admin-comment">{{ t('admin.develop.editor.adminComment') }}</FieldLabel>
      <Textarea
        id="dev-review-admin-comment"
        :model-value="local.adminComment ?? ''"
        rows="4"
        :maxlength="L.adminCommentLen"
        :placeholder="t('admin.develop.editor.adminCommentPlaceholder')"
        @update:model-value="setAdminComment"
      />
      <FieldDescription>{{ t('admin.develop.editor.adminCommentHint') }}</FieldDescription>
    </Field>
  </fieldset>
</template>
