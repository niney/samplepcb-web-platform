<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import {
  DEVELOP_TASK_PHASES,
  DEVELOP_TASK_PHASE_LABELS,
  DEVELOP_TASK_STATUSES,
  DEVELOP_TASK_STATUS_LABELS,
} from '@sp/api-contract';
import type {
  DevReviewScheduleType,
  DevelopRequestStatusType,
  DevelopScheduleInputType,
  DevelopTaskPhaseType,
  DevelopTaskStatusType,
  DevelopTaskViewType,
} from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { kstToday } from '@sp/utils';
import { useAdminDevelopTasksPut, useInvalidateAdminDevelop } from '@/admin/useAdminDevelop';
import {
  DEVELOP_TASK_MAX_ROWS,
  developTaskInputs,
  developTaskIssues,
  developTaskOverdueCount,
  developTaskProgressPreview,
  developTaskRowsAutoScheduled,
  developTaskRowsFromDefaults,
  developTaskRowsFromSchedule,
  developTaskRowsFromViews,
  emptyDevelopTaskRow,
  syncDevelopTaskProgress,
  syncDevelopTaskStatus,
} from '@/components/admin/develop/develop-doc-edit';
import type { DevelopTaskRow } from '@/components/admin/develop/develop-doc-edit';
import { confirmDialog } from '@/next/lib/dialog';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/next/components/ui/dropdown-menu';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import DevelopTaskGantt from './DevelopTaskGantt.vue';

// 업무표(WBS, docs/DEVELOP_FLOW.md §13) — 옛 components/admin/develop/DevelopTaskTable.vue 의 짝(같은 props·emits·저장 본문).
// 저장은 PUT 으로 표 전체를 보내되 행은 taskId 로 upsert 된다(2026-09-10, G 규칙 이식):
//   · 번호(taskId)가 저장마다 바뀌지 않는다 → 행 key 도 taskId(새 행은 로컬 임시 키).
//   · 진행 이력(진행률>0)이 있는 저장 행은 지울 수 없다 — 삭제 버튼이 그 행을 '제외'로 바꾼다(서버 409 TASK_HAS_PROGRESS 와 같은 규칙).
//   · 완료 ⇔ 100% · 예정 ⇒ 0% 정합은 입력 순간에 맞춰 준다(상태를 고르면 진행률이, 진행률을 치면 상태가 따라온다).
//   · revision 을 되돌려보내 다른 사람이 먼저 저장했으면 409 REVISION_CONFLICT → '새로 불러오기'.
// 단계·가중치 열은 없다(간편 서식 02) — 단계는 업무명 아래 칩(직전 행에서 물려받음), 달성도는 기간(일수) 자동 가중.
// 프로젝트 일정 3개는 이 표의 머리에서 같이 저장한다(schedule). 편집 중(dirty)에는 서버 값으로 덮지 않는다
// (상세는 AI 잡이 도는 동안 5초 폴링하고, 다른 액션이 ['admin','develop'] 를 무효화한다).
const props = defineProps<{
  requestId: number;
  tasks: readonly DevelopTaskViewType[];
  status: DevelopRequestStatusType;
  /** 프로젝트 일정 3개 — 상세 progress 의 baseStartOn·plannedEndOn·expectedEndOn. */
  schedule: DevelopScheduleInputType;
  /** 검토서 개발 일정(예상) — 시드 버튼 재료. */
  reviewSchedule: DevReviewScheduleType | null;
  /** 서버 progress.tasksRevision — 저장 요청에 그대로 실어 보낸다. */
  revision: string;
}>();
const emit = defineEmits<{ dirty: [value: boolean] }>();

const { t } = useI18n();
const tasksPut = useAdminDevelopTasksPut();
const invalidate = useInvalidateAdminDevelop();

const rows = ref<DevelopTaskRow[]>(developTaskRowsFromViews(props.tasks));
const baseStartOn = ref(props.schedule.baseStartOn ?? '');
const plannedEndOn = ref(props.schedule.plannedEndOn ?? '');
const expectedEndOn = ref(props.schedule.expectedEndOn ?? '');
const dirty = ref(false);
const notice = ref('');
const noticeError = ref(false);
const conflict = ref(false);
type SeedKind = 'defaults' | 'schedule' | 'auto';
// 새 행의 v-for key — taskId 가 없는 동안만 쓰는 로컬 임시 번호.
let localSeq = 0;
const localKeys = new WeakMap<DevelopTaskRow, number>();
const rowKey = (row: DevelopTaskRow): string => {
  if (row.taskId !== null) return `t${String(row.taskId)}`;
  let k = localKeys.get(row);
  if (k === undefined) {
    localSeq += 1;
    k = localSeq;
    localKeys.set(row, k);
  }
  return `n${String(k)}`;
};

const markDirty = (): void => {
  dirty.value = true;
  emit('dirty', true);
};
const clearDirty = (): void => {
  dirty.value = false;
  emit('dirty', false);
};

watch(
  () => props.tasks,
  (next) => {
    if (dirty.value) return; // 편집 중이면 서버 값으로 덮지 않는다
    rows.value = developTaskRowsFromViews(next);
  },
);
watch(
  () => props.schedule,
  (next) => {
    if (dirty.value) return;
    baseStartOn.value = next.baseStartOn ?? '';
    plannedEndOn.value = next.plannedEndOn ?? '';
    expectedEndOn.value = next.expectedEndOn ?? '';
  },
);

const contractDone = computed(
  () => props.status === 'in_progress' || props.status === 'delivered' || props.status === 'completed',
);
const preview = computed(() => developTaskProgressPreview(rows.value, contractDone.value));
const overdue = computed(() => developTaskOverdueCount(rows.value, kstToday()));
const issues = computed(() => developTaskIssues(rows.value));
const issueOf = (index: number): string =>
  issues.value
    .filter((i) => i.index === index)
    .map((i) =>
      i.code === 'NAME'
        ? t('admin.develop.docs.task.errName')
        : i.code === 'ORDER'
          ? t('admin.develop.docs.task.errOrder')
          : t('admin.develop.docs.task.errCoherence'),
    )
    .join(' · ');

const scheduleRows = computed(() => developTaskRowsFromSchedule(props.reviewSchedule));
const progressOf = (row: DevelopTaskRow): number => Number(row.progressPct.replace(/[^\d.-]/g, '')) || 0;
const hasDates = computed(() => rows.value.some((r) => r.startOn !== '' || r.endOn !== ''));
const skippedCount = computed(() => rows.value.filter((r) => r.status === 'skipped').length);

// 상태 선택 — '제외'는 고르는 값이 아니라 삭제 버튼이 만드는 상태라 목록에서 숨긴다(이미 제외된 행만 보인다).
const statusOptions = (row: DevelopTaskRow): readonly DevelopTaskStatusType[] =>
  DEVELOP_TASK_STATUSES.filter((s) => s !== 'skipped' || row.status === 'skipped');

// 새 행은 직전 행의 단계를 물려받는다(단계 열이 숨어 있어 매번 고르게 하지 않는다).
function addRow(): void {
  if (rows.value.length >= DEVELOP_TASK_MAX_ROWS) return;
  const last = rows.value.at(-1);
  const phase: DevelopTaskPhaseType = last?.phase ?? 'design';
  rows.value = [...rows.value, emptyDevelopTaskRow(phase)];
  markDirty();
}

// 삭제 — 진행 이력이 있는 저장된 행은 지우지 않고 '제외'로(서버도 409 TASK_HAS_PROGRESS 로 막는다). 그 밖은 실제로 뺀다.
function removeRow(index: number): void {
  const row = rows.value[index];
  if (row === undefined) return;
  if (row.taskId !== null && progressOf(row) > 0) {
    row.status = 'skipped';
    markDirty();
    return;
  }
  rows.value = rows.value.filter((_, i) => i !== index);
  markDirty();
}
function restoreRow(row: DevelopTaskRow): void {
  row.status = 'planned';
  row.progressPct = '0';
  markDirty();
}

function onPhase(row: DevelopTaskRow, value: AcceptableValue): void {
  const hit = DEVELOP_TASK_PHASES.find((p) => p === value);
  if (hit === undefined) return;
  row.phase = hit;
  markDirty();
}
function onStatus(row: DevelopTaskRow, value: AcceptableValue): void {
  const hit = DEVELOP_TASK_STATUSES.find((s) => s === value);
  if (hit === undefined) return;
  row.status = hit;
  syncDevelopTaskStatus(row);
  markDirty();
}
function onProgress(row: DevelopTaskRow, value: string | number): void {
  row.progressPct = String(value);
  syncDevelopTaskProgress(row);
  markDirty();
}
function onVisible(row: DevelopTaskRow, value: boolean | 'indeterminate'): void {
  row.visibleToCustomer = value === true;
  markDirty();
}
// 칸 입력(이름·날짜·비고) — 값을 넣고 편집 중으로 표시한다.
function setCell(row: DevelopTaskRow, key: 'name' | 'startOn' | 'endOn' | 'note', value: string | number): void {
  row[key] = String(value);
  markDirty();
}
// 템플릿은 ref 를 풀어 넘기므로 어느 칸인지는 이름으로 받는다.
const SCHEDULE_REFS = { baseStartOn, plannedEndOn, expectedEndOn } as const;
function setSchedule(key: keyof typeof SCHEDULE_REFS, value: string | number): void {
  SCHEDULE_REFS[key].value = String(value);
  markDirty();
}

// 착수일 기준 자동배치 — 날짜만 새로 깐다. 계획·예상 완료일이 비어 있으면 가장 늦은 완료일로 채운다.
function applyAutoSchedule(): void {
  if (baseStartOn.value === '') return;
  rows.value = developTaskRowsAutoScheduled(rows.value, baseStartOn.value);
  const latest = rows.value.map((r) => r.endOn).filter((d) => d !== '').sort().at(-1) ?? '';
  if (latest !== '') {
    if (plannedEndOn.value === '') plannedEndOn.value = latest;
    if (expectedEndOn.value === '') expectedEndOn.value = latest;
  }
  notice.value = '';
  markDirty();
}

function seed(kind: SeedKind): void {
  if (kind === 'auto') {
    applyAutoSchedule();
    return;
  }
  // 시드는 표를 통째로 바꾸므로 진행 이력이 있는 저장 행이 있으면 시작하지 않는다(서버가 어차피 막는다).
  if (rows.value.some((r) => r.taskId !== null && progressOf(r) > 0)) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.errSeedProgress');
    return;
  }
  const seeded = kind === 'defaults' ? developTaskRowsFromDefaults() : scheduleRows.value;
  // 기본 업무는 오프셋을 알고 있다 — 착수일이 있으면 바로 날짜까지 깐다.
  rows.value = kind === 'defaults' && baseStartOn.value !== '' ? developTaskRowsAutoScheduled(seeded, baseStartOn.value) : seeded;
  notice.value = '';
  markDirty();
}

// 표를 대체·재배치하기 전에 묻는다(옛 화면의 인라인 확인 → 확인 대화상자, 문구·버튼 이름 같음).
async function askSeed(kind: SeedKind): Promise<void> {
  notice.value = '';
  if (kind === 'auto') {
    if (baseStartOn.value === '') {
      noticeError.value = true;
      notice.value = t('admin.develop.docs.task.autoScheduleNeedStart');
      return;
    }
    if (!hasDates.value) {
      seed('auto');
      return;
    }
    const ok = await confirmDialog({
      message: t('admin.develop.docs.task.autoScheduleConfirm'),
      confirmLabel: t('admin.develop.docs.task.autoSchedule'),
      cancelLabel: t('admin.develop.cancel'),
    });
    if (ok) seed('auto');
    return;
  }
  if (rows.value.length === 0) {
    seed(kind);
    return;
  }
  const ok = await confirmDialog({
    message: t('admin.develop.docs.task.seedConfirm'),
    confirmLabel: t('admin.develop.docs.task.seedConfirmOk'),
    cancelLabel: t('admin.develop.cancel'),
  });
  if (ok) seed(kind);
}

// 충돌 뒤 새로 불러오기 — 로컬 편집을 버리고 서버 값을 다시 받는다(dirty 를 먼저 내려야 watch 가 덮어 준다).
function reload(): void {
  conflict.value = false;
  notice.value = '';
  clearDirty();
  rows.value = developTaskRowsFromViews(props.tasks);
  baseStartOn.value = props.schedule.baseStartOn ?? '';
  plannedEndOn.value = props.schedule.plannedEndOn ?? '';
  expectedEndOn.value = props.schedule.expectedEndOn ?? '';
  invalidate();
}

const scheduleBody = (): DevelopScheduleInputType => ({
  baseStartOn: baseStartOn.value === '' ? null : baseStartOn.value,
  plannedEndOn: plannedEndOn.value === '' ? null : plannedEndOn.value,
  expectedEndOn: expectedEndOn.value === '' ? null : expectedEndOn.value,
});

async function onSave(): Promise<void> {
  notice.value = '';
  conflict.value = false;
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.saveBlocked');
    return;
  }
  if (baseStartOn.value !== '' && plannedEndOn.value !== '' && plannedEndOn.value < baseStartOn.value) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.errScheduleOrder');
    return;
  }
  try {
    await tasksPut.mutateAsync({ requestId: props.requestId, tasks: developTaskInputs(rows.value), revision: props.revision, schedule: scheduleBody() });
    clearDirty();
    noticeError.value = false;
    notice.value = t('admin.develop.docs.task.saved');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.docs.task.saveFail'), {
      REVISION_CONFLICT: t('admin.develop.docs.task.errConflict'),
      TASK_HAS_PROGRESS: t('admin.develop.docs.task.errRemoveProgress'),
      TASK_NOT_FOUND: t('admin.develop.docs.task.errNotFound'),
    });
    const code = (error as { payload?: { error?: string } }).payload?.error;
    conflict.value = code === 'REVISION_CONFLICT' || code === 'TASK_NOT_FOUND';
  }
}
</script>

<template>
  <SectionCard :title="t('admin.develop.docs.task.title')">
    <template #meta>
      <span class="inline-flex items-center gap-1.5">
        <span class="tabular-nums">{{ rows.length }}</span>
        <Badge v-if="dirty" variant="warning">{{ t('admin.develop.nav.badge.editing') }}</Badge>
        <Badge v-if="overdue > 0" variant="danger">{{ t('admin.develop.docs.task.previewOverdue', { n: overdue }) }}</Badge>
      </span>
    </template>
    <template #actions>
      <Button variant="outline" size="sm" :disabled="rows.length >= DEVELOP_TASK_MAX_ROWS" @click="addRow">
        <PlusIcon />
        {{ t('admin.develop.docs.task.add') }}
      </Button>
      <Button variant="outline" size="sm" @click="askSeed('defaults')">{{ t('admin.develop.docs.task.seedDefaults') }}</Button>
      <Button v-if="scheduleRows.length > 0" variant="outline" size="sm" @click="askSeed('schedule')">
        {{ t('admin.develop.docs.task.seedSchedule') }}
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="baseStartOn === '' || rows.length === 0"
        :title="baseStartOn === '' ? t('admin.develop.docs.task.autoScheduleNeedStart') : ''"
        @click="askSeed('auto')"
      >
        {{ t('admin.develop.docs.task.autoSchedule') }}
      </Button>
      <Button size="sm" :disabled="tasksPut.isPending.value" @click="onSave">
        {{ tasksPut.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.task.save') }}
      </Button>
    </template>

    <div class="grid gap-3">
      <!-- 프로젝트 일정 3개(간편 서식 02 머리) — 업무표와 같은 저장 버튼으로 나간다. 바뀌면 서버가 schedule_changed 이벤트로 이력을 남긴다. -->
      <Panel tone="muted" class="grid gap-3 sm:grid-cols-3">
        <div class="grid gap-1.5">
          <Label :for="`task-base-${String(requestId)}`">{{ t('admin.develop.docs.status.baseStartOn') }}</Label>
          <Input :id="`task-base-${String(requestId)}`" :model-value="baseStartOn" type="date" @update:model-value="(v) => setSchedule('baseStartOn', v)" />
        </div>
        <div class="grid gap-1.5">
          <Label :for="`task-planned-${String(requestId)}`">{{ t('admin.develop.docs.status.plannedEndOn') }}</Label>
          <Input :id="`task-planned-${String(requestId)}`" :model-value="plannedEndOn" type="date" @update:model-value="(v) => setSchedule('plannedEndOn', v)" />
        </div>
        <div class="grid gap-1.5">
          <Label :for="`task-expected-${String(requestId)}`">{{ t('admin.develop.docs.status.expectedEndOn') }}</Label>
          <Input :id="`task-expected-${String(requestId)}`" :model-value="expectedEndOn" type="date" @update:model-value="(v) => setSchedule('expectedEndOn', v)" />
        </div>
      </Panel>

      <TableCard>
        <Table class="min-w-225">
          <TableHeader>
            <TableRow>
              <TableHead class="w-8">#</TableHead>
              <TableHead>{{ t('admin.develop.docs.task.name') }}</TableHead>
              <TableHead class="w-32">{{ t('admin.develop.docs.task.status') }}</TableHead>
              <TableHead class="w-36">{{ t('admin.develop.docs.task.startOn') }}</TableHead>
              <TableHead class="w-36">{{ t('admin.develop.docs.task.endOn') }}</TableHead>
              <TableHead class="w-20">{{ t('admin.develop.docs.task.progress') }}</TableHead>
              <TableHead class="w-44">{{ t('admin.develop.docs.task.note') }}</TableHead>
              <TableHead class="w-14 text-center">{{ t('admin.develop.docs.task.visible') }}</TableHead>
              <TableHead class="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(row, index) in rows" :key="rowKey(row)">
              <TableCell class="text-muted-foreground align-top tabular-nums">{{ index + 1 }}</TableCell>
              <TableCell class="align-top">
                <Input
                  :model-value="row.name"
                  :maxlength="200"
                  :aria-label="t('admin.develop.docs.task.name')"
                  @update:model-value="(v) => setCell(row, 'name', v)"
                />
                <!-- 단계 칩 — 열 대신 이름 아래 작은 선택(눌러서 바꾼다). 제외된 행은 표지를 붙인다. -->
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button variant="secondary" size="xs" :title="t('admin.develop.docs.task.phase')">
                        {{ DEVELOP_TASK_PHASE_LABELS[row.phase] }}
                        <ChevronDownIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup :model-value="row.phase" @update:model-value="(v) => onPhase(row, v)">
                        <DropdownMenuRadioItem v-for="p in DEVELOP_TASK_PHASES" :key="p" :value="p">
                          {{ DEVELOP_TASK_PHASE_LABELS[p] }}
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Badge v-if="row.status === 'skipped'" variant="secondary">{{ DEVELOP_TASK_STATUS_LABELS.skipped }}</Badge>
                </div>
                <p v-if="issueOf(index) !== ''" class="text-destructive mt-1 text-xs font-medium">{{ issueOf(index) }}</p>
              </TableCell>
              <TableCell class="align-top">
                <NativeSelect
                  :model-value="row.status"
                  :aria-label="t('admin.develop.docs.task.status')"
                  @update:model-value="(v) => onStatus(row, v)"
                >
                  <NativeSelectOption v-for="s in statusOptions(row)" :key="s" :value="s">{{ DEVELOP_TASK_STATUS_LABELS[s] }}</NativeSelectOption>
                </NativeSelect>
              </TableCell>
              <TableCell class="align-top">
                <Input
                  :model-value="row.startOn"
                  type="date"
                  :aria-label="t('admin.develop.docs.task.startOn')"
                  @update:model-value="(v) => setCell(row, 'startOn', v)"
                />
              </TableCell>
              <TableCell class="align-top">
                <Input
                  :model-value="row.endOn"
                  type="date"
                  :aria-label="t('admin.develop.docs.task.endOn')"
                  @update:model-value="(v) => setCell(row, 'endOn', v)"
                />
              </TableCell>
              <TableCell class="align-top">
                <Input
                  :model-value="row.progressPct"
                  inputmode="numeric"
                  class="text-right tabular-nums"
                  :aria-label="t('admin.develop.docs.task.progress')"
                  :disabled="row.status === 'skipped'"
                  @update:model-value="(v) => onProgress(row, v)"
                />
              </TableCell>
              <TableCell class="align-top">
                <Input
                  :model-value="row.note"
                  :maxlength="500"
                  :aria-label="t('admin.develop.docs.task.note')"
                  @update:model-value="(v) => setCell(row, 'note', v)"
                />
              </TableCell>
              <TableCell class="text-center align-top">
                <span class="inline-flex h-8 items-center">
                  <Checkbox
                    :model-value="row.visibleToCustomer"
                    :aria-label="t('admin.develop.docs.task.visible')"
                    @update:model-value="(v) => onVisible(row, v)"
                  />
                </span>
              </TableCell>
              <TableCell class="text-right align-top">
                <Button v-if="row.status === 'skipped'" variant="ghost" size="xs" @click="restoreRow(row)">
                  <RotateCcwIcon />
                  {{ t('admin.develop.docs.task.restore') }}
                </Button>
                <Button v-else variant="ghost" size="xs" @click="removeRow(index)">
                  <Trash2Icon class="text-destructive" />
                  {{ t('admin.develop.docs.task.remove') }}
                </Button>
              </TableCell>
            </TableRow>
            <TableEmptyRow v-if="rows.length === 0" :colspan="9" :text="t('admin.develop.docs.task.empty')" />
          </TableBody>
        </Table>
      </TableCard>

      <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>{{ t('admin.develop.docs.task.weightAuto') }}</span>
        <span class="tabular-nums">{{ t('admin.develop.docs.task.previewProgress', { percent: preview.progressPct }) }}</span>
        <span>
          {{ t('admin.develop.docs.task.previewPhase') }}:
          {{ preview.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[preview.currentPhase] }}
        </span>
        <span v-if="skippedCount > 0">{{ t('admin.develop.docs.task.skippedHint') }}</span>
        <span v-if="dirty" class="text-warning font-medium">{{ t('admin.develop.docs.task.unsaved') }}</span>
      </div>
      <div v-if="notice !== ''" class="flex flex-wrap items-center gap-2">
        <p class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">{{ notice }}</p>
        <Button v-if="conflict" variant="outline" size="sm" @click="reload">
          <RotateCcwIcon />
          {{ t('admin.develop.docs.task.reload') }}
        </Button>
      </div>

      <DevelopTaskGantt :rows="rows" />
    </div>
  </SectionCard>
</template>
