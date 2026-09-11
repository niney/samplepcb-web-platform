<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_TASK_PHASES,
  DEVELOP_TASK_PHASE_LABELS,
  DEVELOP_TASK_STATUSES,
  DEVELOP_TASK_STATUS_LABELS,
} from '@sp/api-contract';
import type { DevReviewScheduleType, DevelopRequestStatusType, DevelopTaskViewType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { kstToday } from '@sp/utils';
import { useAdminDevelopTasksPut, useInvalidateAdminDevelop } from '../../../admin/useAdminDevelop';
import DevelopTaskGantt from './DevelopTaskGantt.vue';
import {
  DEVELOP_TASK_MAX_ROWS,
  developTaskInputs,
  developTaskIssues,
  developTaskOverdueCount,
  developTaskProgressPreview,
  developTaskRowsFromDefaults,
  developTaskRowsFromSchedule,
  developTaskRowsFromViews,
  developTaskWeightSum,
  emptyDevelopTaskRow,
  syncDevelopTaskProgress,
  syncDevelopTaskStatus,
} from './develop-doc-edit';
import type { DevelopTaskRow } from './develop-doc-edit';

// 업무표(WBS, docs/DEVELOP_FLOW.md §13) — 저장은 PUT 으로 표 전체를 보내되 행은 taskId 로 upsert 된다(2026-09-10, G 규칙 이식):
//   · 번호(taskId)가 저장마다 바뀌지 않는다 → 행 key 도 taskId(새 행은 로컬 임시 키).
//   · 진행 이력(진행률>0)이 있는 행은 지울 수 없다 — 상태를 '제외'로 바꾼다(서버 409 TASK_HAS_PROGRESS 와 같은 규칙을 먼저 막는다).
//   · 완료 ⇔ 100% · 예정 ⇒ 0% 정합은 입력 순간에 맞춰 준다(상태를 고르면 진행률이, 진행률을 치면 상태가 따라온다).
//   · revision(행 id·updatedAt 해시)을 되돌려보내 다른 사람이 먼저 저장했으면 409 REVISION_CONFLICT → '새로 불러오기'.
// 편집 중(dirty)에는 서버 값으로 덮지 않는다: 상세는 AI 잡이 도는 동안 5초 폴링을 하고,
// 다른 액션(문서 발송 등)이 ['admin','develop'] 를 무효화하기 때문이다.
const props = defineProps<{
  requestId: number;
  tasks: readonly DevelopTaskViewType[];
  status: DevelopRequestStatusType;
  schedule: DevReviewScheduleType | null;
  /** 서버 progress.tasksRevision — 저장 요청에 그대로 실어 보낸다. */
  revision: string;
}>();
const emit = defineEmits<{ dirty: [value: boolean] }>();

const { t } = useI18n();
const tasksPut = useAdminDevelopTasksPut();
const invalidate = useInvalidateAdminDevelop();

const rows = ref<DevelopTaskRow[]>(developTaskRowsFromViews(props.tasks));
const dirty = ref(false);
const notice = ref('');
const noticeError = ref(false);
const conflict = ref(false);
const confirmSeed = ref<'defaults' | 'schedule' | null>(null);
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

const contractDone = computed(
  () => props.status === 'in_progress' || props.status === 'delivered' || props.status === 'completed',
);
const weightSum = computed(() => developTaskWeightSum(rows.value));
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

const scheduleRows = computed(() => developTaskRowsFromSchedule(props.schedule));

function addRow(): void {
  if (rows.value.length >= DEVELOP_TASK_MAX_ROWS) return;
  rows.value = [...rows.value, emptyDevelopTaskRow()];
  markDirty();
}

// 진행 이력이 있는 저장된 행은 지우지 않는다 — 서버도 409 TASK_HAS_PROGRESS 로 막는다. 대신 '제외'.
function removeRow(index: number): void {
  const row = rows.value[index];
  if (row === undefined) return;
  if (row.taskId !== null && Number(row.progressPct.replace(/[^\d.-]/g, '')) > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.errRemoveProgress');
    return;
  }
  rows.value = rows.value.filter((_, i) => i !== index);
  markDirty();
}

function onStatus(row: DevelopTaskRow): void {
  syncDevelopTaskStatus(row);
  markDirty();
}
function onProgress(row: DevelopTaskRow): void {
  syncDevelopTaskProgress(row);
  markDirty();
}

function seed(kind: 'defaults' | 'schedule'): void {
  // 시드는 표를 통째로 바꾸므로 진행 이력이 있는 저장 행이 있으면 시작하지 않는다(서버가 어차피 막는다).
  if (rows.value.some((r) => r.taskId !== null && Number(r.progressPct.replace(/[^\d.-]/g, '')) > 0)) {
    confirmSeed.value = null;
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.errSeedProgress');
    return;
  }
  rows.value = kind === 'defaults' ? developTaskRowsFromDefaults() : scheduleRows.value;
  confirmSeed.value = null;
  notice.value = '';
  markDirty();
}

function askSeed(kind: 'defaults' | 'schedule'): void {
  if (rows.value.length === 0) seed(kind);
  else confirmSeed.value = kind;
}

// 충돌 뒤 새로 불러오기 — 로컬 편집을 버리고 서버 값을 다시 받는다(dirty 를 먼저 내려야 watch 가 덮어 준다).
function reload(): void {
  conflict.value = false;
  notice.value = '';
  clearDirty();
  rows.value = developTaskRowsFromViews(props.tasks);
  invalidate();
}

async function onSave(): Promise<void> {
  notice.value = '';
  conflict.value = false;
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.task.saveBlocked');
    return;
  }
  try {
    await tasksPut.mutateAsync({ requestId: props.requestId, tasks: developTaskInputs(rows.value), revision: props.revision });
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

const inputClass = 'h-8 w-full min-w-0 rounded border border-gray-300 px-1.5 text-xs';
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-white p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-base font-bold text-gray-800">
        {{ t('admin.develop.docs.task.title') }}
        <span class="ml-1 text-xs font-normal text-gray-400">{{ rows.length }}</span>
      </h2>
      <span v-if="dirty" class="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
        {{ t('admin.develop.nav.badge.editing') }}
      </span>
      <span v-if="overdue > 0" class="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
        {{ t('admin.develop.docs.task.previewOverdue', { n: overdue }) }}
      </span>
      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          :disabled="rows.length >= DEVELOP_TASK_MAX_ROWS"
          @click="addRow"
        >
          {{ t('admin.develop.docs.task.add') }}
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
          @click="askSeed('defaults')"
        >
          {{ t('admin.develop.docs.task.seedDefaults') }}
        </button>
        <button
          v-if="scheduleRows.length > 0"
          type="button"
          class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50"
          @click="askSeed('schedule')"
        >
          {{ t('admin.develop.docs.task.seedSchedule') }}
        </button>
        <button
          type="button"
          class="rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="tasksPut.isPending.value"
          @click="onSave"
        >
          {{ tasksPut.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.task.save') }}
        </button>
      </div>
    </div>

    <!-- 인라인 확인(네이티브 confirm 금지) -->
    <div v-if="confirmSeed !== null" class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
      <span>{{ t('admin.develop.docs.task.seedConfirm') }}</span>
      <button type="button" class="ml-auto rounded border border-amber-300 bg-white px-2 py-1 font-bold" @click="confirmSeed = null">
        {{ t('admin.develop.cancel') }}
      </button>
      <button type="button" class="rounded bg-amber-600 px-2 py-1 font-bold text-white" @click="seed(confirmSeed)">
        {{ t('admin.develop.docs.task.seedConfirmOk') }}
      </button>
    </div>

    <div class="mt-3 overflow-x-auto">
      <table class="w-full min-w-[1040px] border-collapse text-xs">
        <thead>
          <tr class="border-b border-gray-200 text-left text-[11px] text-gray-500">
            <th class="w-8 py-1.5 pr-1 font-semibold">#</th>
            <th class="py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.name') }}</th>
            <th class="w-28 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.phase') }}</th>
            <th class="w-28 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.status') }}</th>
            <th class="w-32 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.startOn') }}</th>
            <th class="w-32 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.endOn') }}</th>
            <th class="w-16 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.weight') }}</th>
            <th class="w-16 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.progress') }}</th>
            <th class="w-40 py-1.5 pr-1 font-semibold">{{ t('admin.develop.docs.task.note') }}</th>
            <th class="w-14 py-1.5 pr-1 text-center font-semibold">{{ t('admin.develop.docs.task.visible') }}</th>
            <th class="w-10 py-1.5" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in rows"
            :key="rowKey(row)"
            class="border-b border-gray-100 align-top"
            :class="row.status === 'skipped' ? 'text-gray-400' : ''"
          >
            <td class="py-1 pr-1 text-gray-400">{{ index + 1 }}</td>
            <td class="py-1 pr-1">
              <input v-model="row.name" type="text" :maxlength="200" :class="inputClass" @input="markDirty">
              <p v-if="issueOf(index) !== ''" class="mt-0.5 text-[11px] font-semibold text-red-600">{{ issueOf(index) }}</p>
            </td>
            <td class="py-1 pr-1">
              <select v-model="row.phase" class="h-8 w-full rounded border border-gray-300 bg-white px-1 text-xs" @change="markDirty">
                <option v-for="p in DEVELOP_TASK_PHASES" :key="p" :value="p">{{ DEVELOP_TASK_PHASE_LABELS[p] }}</option>
              </select>
            </td>
            <td class="py-1 pr-1">
              <select v-model="row.status" class="h-8 w-full rounded border border-gray-300 bg-white px-1 text-xs" @change="onStatus(row)">
                <option v-for="s in DEVELOP_TASK_STATUSES" :key="s" :value="s">{{ DEVELOP_TASK_STATUS_LABELS[s] }}</option>
              </select>
            </td>
            <td class="py-1 pr-1"><input v-model="row.startOn" type="date" :class="inputClass" @change="markDirty"></td>
            <td class="py-1 pr-1"><input v-model="row.endOn" type="date" :class="inputClass" @change="markDirty"></td>
            <td class="py-1 pr-1"><input v-model="row.weightPct" type="text" inputmode="decimal" :class="inputClass" @input="markDirty"></td>
            <td class="py-1 pr-1"><input v-model="row.progressPct" type="text" inputmode="numeric" :class="inputClass" @input="onProgress(row)"></td>
            <td class="py-1 pr-1"><input v-model="row.note" type="text" :maxlength="500" :class="inputClass" @input="markDirty"></td>
            <td class="py-1 pr-1 text-center"><input v-model="row.visibleToCustomer" type="checkbox" class="h-3.5 w-3.5" @change="markDirty"></td>
            <td class="py-1 text-right">
              <button type="button" class="font-bold text-red-600 hover:text-red-700" @click="removeRow(index)">
                {{ t('admin.develop.docs.task.remove') }}
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="11" class="py-6 text-center text-sm text-gray-400">{{ t('admin.develop.docs.task.empty') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <span :class="Math.round(weightSum) === 100 ? 'text-gray-500' : 'font-semibold text-amber-700'">
        {{ t('admin.develop.docs.task.weightSum', { percent: weightSum }) }}
      </span>
      <span class="text-gray-500">{{ t('admin.develop.docs.task.previewProgress', { percent: preview.progressPct }) }}</span>
      <span class="text-gray-500">
        {{ t('admin.develop.docs.task.previewPhase') }}:
        {{ preview.currentPhase === null ? '—' : DEVELOP_TASK_PHASE_LABELS[preview.currentPhase] }}
      </span>
      <span v-if="dirty" class="text-amber-700">{{ t('admin.develop.docs.task.unsaved') }}</span>
    </div>
    <div v-if="notice !== ''" class="mt-1.5 flex flex-wrap items-center gap-2">
      <p class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
      <button
        v-if="conflict"
        type="button"
        class="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
        @click="reload"
      >
        {{ t('admin.develop.docs.task.reload') }}
      </button>
    </div>

    <DevelopTaskGantt class="mt-3" :rows="rows" />
  </section>
</template>
