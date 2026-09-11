<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_DOC_FIELDS,
  DEVELOP_DOC_TYPE_LABELS,
  developDocContentEmpty,
  developDocContentIssues,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopDocContentType } from '@sp/api-contract';
import { apiErrorMessage, canPreview } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import {
  useAdminDevelopDocumentDelete,
  useAdminDevelopDocumentFileAdd,
  useAdminDevelopDocumentFileDelete,
  useAdminDevelopDocumentPatch,
  useInvalidateAdminDevelop,
} from '../../../admin/useAdminDevelop';
import { formatBytes } from '../../../lib/format';
import DevelopDocSendPanel from './DevelopDocSendPanel.vue';
import { downloadAdminDevelopFile } from './develop-files';
import {
  developDocCodes,
  developDocFormContent,
  developDocRows,
  developDocText,
  emptyDevelopDocRow,
  parseDevelopDocIssues,
} from './develop-doc-edit';

// 문서 편집기(draft 전용, docs/DEVELOP_FLOW.md §13) — 폼은 계약 필드 스펙(DEVELOP_DOC_FIELDS)이 그린다.
// 서버가 400 CONTENT_INVALID 로 막는 자리를 developDocContentIssues 로 먼저 검사해 필드 옆에 붙인다.
// 본문은 로컬 상태로 든다(상세는 AI 잡·다른 액션으로 재조회되므로 편집 중 초안이 덮이면 안 된다).
// 저장은 마지막으로 본 updatedAt 을 함께 보내(낙관적 잠금, 2026-09-10) 다른 사람이 먼저 고쳤으면 409 → '새로 불러오기'.
const props = defineProps<{
  doc: AdminDevelopDocumentViewType;
  requestTitle: string;
  customerName: string;
  customerCompany: string | null;
  customerEmail: string | null;
}>();
const emit = defineEmits<{ dirty: [value: boolean]; preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const patch = useAdminDevelopDocumentPatch();
const remove = useAdminDevelopDocumentDelete();
const fileAdd = useAdminDevelopDocumentFileAdd();
const fileDelete = useAdminDevelopDocumentFileDelete();
const invalidate = useInvalidateAdminDevelop();

const content = ref<DevelopDocContentType>(developDocFormContent(props.doc.type, props.doc.content));
const internalNote = ref(props.doc.internalNote ?? '');
const replyDueOn = ref(props.doc.replyDueOn ?? '');
const dirty = ref(false);
const notice = ref('');
const noticeError = ref(false);
const confirmDelete = ref(false);
const sendOpen = ref(false);
const fileError = ref('');
const conflict = ref(false);

const markDirty = (): void => {
  dirty.value = true;
  emit('dirty', true);
};
const clearDirty = (): void => {
  dirty.value = false;
  emit('dirty', false);
};

// 재시드 키 — 서버가 문서를 바꿨을 때만(첨부 추가·저장 응답). 편집 중이면 덮지 않는다.
const seedKey = computed(() => `${String(props.doc.documentId)}:${props.doc.updatedAt}`);
watch(seedKey, () => {
  if (dirty.value) return;
  content.value = developDocFormContent(props.doc.type, props.doc.content);
  internalNote.value = props.doc.internalNote ?? '';
  replyDueOn.value = props.doc.replyDueOn ?? '';
});

const fields = computed(() => DEVELOP_DOC_FIELDS[props.doc.type]);
const metaFields = computed(() => fields.value.filter((f) => f.meta === true));
const bodyFields = computed(() => fields.value.filter((f) => f.meta !== true));

const issues = computed(() => parseDevelopDocIssues(developDocContentIssues(props.doc.type, content.value)));
const issueCodeText = (code: string): string => {
  switch (code) {
    case 'DATE':
      return t('admin.develop.docs.editor.errDate');
    case 'OPTION':
      return t('admin.develop.docs.editor.errOption');
    case 'DUPLICATE':
      return t('admin.develop.docs.editor.errDuplicate');
    default:
      return t('admin.develop.docs.editor.errField');
  }
};
const issueOf = (key: string): string =>
  issues.value
    .filter((i) => i.key === key)
    .map((i) => issueCodeText(i.code))
    .join(' · ');

const isEmpty = computed(() => developDocContentEmpty(content.value));

// ── 값 접근자(계약 값 형태 그대로: string · 코드 배열 · 행 배열) ─────────────────
const textOf = (key: string): string => developDocText(content.value, key);
const setText = (key: string, value: string): void => {
  content.value[key] = value;
  markDirty();
};
const onInput = (key: string, event: Event): void => {
  setText(key, (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
};

const codesOf = (key: string): string[] => developDocCodes(content.value, key);
const toggleCode = (key: string, code: string, event: Event): void => {
  const on = (event.target as HTMLInputElement).checked;
  const codes = codesOf(key);
  content.value[key] = on ? (codes.includes(code) ? codes : [...codes, code]) : codes.filter((c) => c !== code);
  markDirty();
};

const rowsOf = (key: string): Record<string, string>[] => developDocRows(content.value, key);
const setCell = (key: string, index: number, col: string, event: Event): void => {
  const rows = rowsOf(key);
  const row = rows[index];
  if (row === undefined) return;
  row[col] = (event.target as HTMLInputElement | HTMLSelectElement).value;
  content.value[key] = rows;
  markDirty();
};
const addRow = (key: string): void => {
  content.value[key] = [...rowsOf(key), emptyDevelopDocRow(props.doc.type, key)];
  markDirty();
};
const removeRow = (key: string, index: number): void => {
  content.value[key] = rowsOf(key).filter((_, i) => i !== index);
  markDirty();
};

// ── 저장·삭제·첨부·발송 ───────────────────────────────────────────────────────
const patchBody = () => ({
  content: content.value,
  internalNote: internalNote.value.trim() === '' ? null : internalNote.value.trim(),
  replyDueOn: replyDueOn.value === '' ? null : replyDueOn.value,
  expectedUpdatedAt: props.doc.updatedAt,
});

const saveFail = (error: unknown): string =>
  apiErrorMessage(error, t('admin.develop.docs.editor.saveFail'), {
    CONTENT_INVALID: t('admin.develop.docs.editor.errContent'),
    DOC_NOT_DRAFT: t('admin.develop.docs.editor.errNotDraft'),
    REVISION_CONFLICT: t('admin.develop.docs.editor.errConflict'),
  });

// 충돌 뒤 새로 불러오기 — 로컬 편집을 버리고 서버 판을 다시 받는다(dirty 를 내려야 seedKey watch 가 덮어 준다).
function reload(): void {
  conflict.value = false;
  notice.value = '';
  clearDirty();
  invalidate();
}

async function save(): Promise<boolean> {
  conflict.value = false;
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.editor.saveBlocked');
    return false;
  }
  try {
    await patch.mutateAsync({ docId: props.doc.documentId, body: patchBody() });
    clearDirty();
    noticeError.value = false;
    notice.value = t('admin.develop.docs.editor.saved');
    return true;
  } catch (error) {
    noticeError.value = true;
    notice.value = saveFail(error);
    conflict.value = (error as { payload?: { error?: string } }).payload?.error === 'REVISION_CONFLICT';
    return false;
  }
}

async function onDelete(): Promise<void> {
  try {
    await remove.mutateAsync(props.doc.documentId);
    confirmDelete.value = false;
    clearDirty();
  } catch (error) {
    noticeError.value = true;
    notice.value = saveFail(error);
  }
}

// 발송 패널은 저장된 본문을 근거로 메일 초안을 만든다 — 열기 전에 미저장분을 먼저 저장한다.
async function openSend(): Promise<void> {
  notice.value = '';
  if (isEmpty.value) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.editor.errEmptyDocument');
    return;
  }
  if (dirty.value && !(await save())) return;
  if (issues.value.length > 0) {
    noticeError.value = true;
    notice.value = t('admin.develop.docs.editor.saveBlocked');
    return;
  }
  sendOpen.value = true;
}

async function onPickFiles(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  if (files.length === 0) return;
  fileError.value = '';
  try {
    await fileAdd.mutateAsync({ docId: props.doc.documentId, files });
  } catch (error) {
    fileError.value = apiErrorMessage(error, t('admin.develop.docs.editor.fileFail'));
  }
  input.value = '';
}

async function onRemoveFile(fileId: number): Promise<void> {
  fileError.value = '';
  try {
    await fileDelete.mutateAsync({ docId: props.doc.documentId, fileId });
  } catch (error) {
    fileError.value = apiErrorMessage(error, t('admin.develop.docs.editor.fileFail'));
  }
}

async function onDownload(fileId: number, name: string): Promise<void> {
  fileError.value = '';
  try {
    await downloadAdminDevelopFile(fileId, name);
  } catch (error) {
    fileError.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}

const inputClass = 'h-8 w-full min-w-0 rounded border border-gray-300 px-2 text-xs';
const areaClass = 'w-full rounded border border-gray-300 px-2 py-1.5 text-xs leading-relaxed';
</script>

<template>
  <div class="grid gap-3">
    <!-- 문서 머리(메타) -->
    <div v-if="metaFields.length > 0" class="grid gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-2.5 sm:grid-cols-2 xl:grid-cols-4">
      <label v-for="f in metaFields" :key="f.key" class="grid gap-0.5 text-[11px] font-semibold text-gray-600">
        {{ f.label }}
        <select v-if="f.kind === 'select'" :value="textOf(f.key)" class="h-8 w-full rounded border border-gray-300 bg-white px-1.5 text-xs" @change="onInput(f.key, $event)">
          <option value="">{{ t('admin.develop.docs.editor.selectEmpty') }}</option>
          <option v-for="o in f.options ?? []" :key="o.code" :value="o.code">{{ o.label }}</option>
        </select>
        <input
          v-else
          :value="textOf(f.key)"
          :type="f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : 'text'"
          :placeholder="f.placeholder ?? ''"
          :class="inputClass"
          @input="onInput(f.key, $event)"
        >
        <span v-if="issueOf(f.key) !== ''" class="font-semibold text-red-600">{{ issueOf(f.key) }}</span>
      </label>
    </div>

    <!-- 본문 2열 격자 — 표는 전폭 -->
    <div class="grid gap-2.5 lg:grid-cols-2">
      <div v-for="f in bodyFields" :key="f.key" class="grid gap-0.5" :class="f.kind === 'table' ? 'lg:col-span-2' : ''">
        <span class="text-[11px] font-semibold text-gray-600">{{ f.label }}</span>

        <!-- 체크박스 격자 -->
        <div v-if="f.kind === 'checklist'" class="grid grid-cols-2 gap-1 rounded border border-gray-200 p-2 sm:grid-cols-3">
          <label v-for="o in f.options ?? []" :key="o.code" class="inline-flex items-center gap-1.5 text-xs text-gray-700">
            <input type="checkbox" class="h-3.5 w-3.5" :checked="codesOf(f.key).includes(o.code)" @change="toggleCode(f.key, o.code, $event)">
            {{ o.label }}
          </label>
        </div>

        <!-- 표 -->
        <div v-else-if="f.kind === 'table'" class="overflow-x-auto rounded border border-gray-200">
          <table class="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50 text-left text-[11px] text-gray-500">
                <th v-for="c in f.columns ?? []" :key="c.key" class="px-1.5 py-1 font-semibold" :class="c.width === 'narrow' ? 'w-24' : ''">{{ c.label }}</th>
                <th class="w-10 px-1.5 py-1" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in rowsOf(f.key)" :key="index" class="border-b border-gray-100">
                <td v-for="c in f.columns ?? []" :key="c.key" class="px-1.5 py-1">
                  <select
                    v-if="c.kind === 'select'"
                    :value="row[c.key] ?? ''"
                    class="h-8 w-full rounded border border-gray-300 bg-white px-1 text-xs"
                    @change="setCell(f.key, index, c.key, $event)"
                  >
                    <option value="">{{ t('admin.develop.docs.editor.selectEmpty') }}</option>
                    <option v-for="o in c.options ?? []" :key="o.code" :value="o.code">{{ o.label }}</option>
                  </select>
                  <input
                    v-else
                    :value="row[c.key] ?? ''"
                    :type="c.kind === 'date' ? 'date' : 'text'"
                    :class="inputClass"
                    @input="setCell(f.key, index, c.key, $event)"
                  >
                </td>
                <td class="px-1.5 py-1 text-right">
                  <button type="button" class="text-[11px] font-bold text-red-600 hover:text-red-700" @click="removeRow(f.key, index)">
                    {{ t('admin.develop.docs.task.remove') }}
                  </button>
                </td>
              </tr>
              <tr v-if="rowsOf(f.key).length === 0">
                <td :colspan="(f.columns ?? []).length + 1" class="px-1.5 py-3 text-center text-[11px] text-gray-400">
                  {{ t('admin.develop.docs.editor.tableEmpty') }}
                </td>
              </tr>
            </tbody>
          </table>
          <div class="border-t border-gray-100 p-1.5">
            <button type="button" class="rounded border border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-700 hover:bg-gray-50" @click="addRow(f.key)">
              {{ t('admin.develop.docs.editor.addRow') }}
            </button>
          </div>
        </div>

        <select v-else-if="f.kind === 'select'" :value="textOf(f.key)" class="h-8 w-full rounded border border-gray-300 bg-white px-1.5 text-xs" @change="onInput(f.key, $event)">
          <option value="">{{ t('admin.develop.docs.editor.selectEmpty') }}</option>
          <option v-for="o in f.options ?? []" :key="o.code" :value="o.code">{{ o.label }}</option>
        </select>

        <textarea
          v-else-if="f.kind === 'textarea'"
          :value="textOf(f.key)"
          rows="3"
          :maxlength="20000"
          :placeholder="f.placeholder ?? ''"
          :class="areaClass"
          @input="onInput(f.key, $event)"
        />

        <input
          v-else
          :value="textOf(f.key)"
          :type="f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : 'text'"
          :placeholder="f.placeholder ?? ''"
          :class="inputClass"
          @input="onInput(f.key, $event)"
        >

        <span v-if="f.hint !== undefined" class="text-[11px] text-gray-400">{{ f.hint }}</span>
        <span v-if="issueOf(f.key) !== ''" class="text-[11px] font-semibold text-red-600">{{ issueOf(f.key) }}</span>
      </div>
    </div>

    <!-- 회신 요청일 · 내부 메모 -->
    <div class="grid gap-2.5 lg:grid-cols-[200px_minmax(0,1fr)]">
      <label class="grid gap-0.5 text-[11px] font-semibold text-gray-600">
        {{ t('admin.develop.docs.editor.replyDueOn') }}
        <input v-model="replyDueOn" type="date" :class="inputClass" @change="markDirty">
      </label>
      <label class="grid gap-0.5 text-[11px] font-semibold text-gray-600">
        {{ t('admin.develop.docs.editor.internalNote') }}
        <textarea v-model="internalNote" rows="2" :maxlength="4000" :placeholder="t('admin.develop.docs.editor.internalNoteHint')" :class="areaClass" @input="markDirty" />
      </label>
    </div>

    <!-- 첨부 -->
    <div class="grid gap-1.5 rounded-lg border border-gray-200 p-2.5">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-semibold text-gray-600">{{ t('admin.develop.docs.editor.files') }}</span>
        <input type="file" multiple class="text-xs" :disabled="fileAdd.isPending.value" @change="onPickFiles">
        <span v-if="fileAdd.isPending.value" class="text-[11px] text-gray-400">{{ t('admin.develop.saving') }}</span>
      </div>
      <ul v-if="doc.files.length > 0" class="grid gap-1">
        <li v-for="f in doc.files" :key="f.fileId" class="flex min-w-0 items-center gap-2 rounded border border-gray-100 bg-gray-50/60 px-2 py-1 text-xs">
          <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
          <span class="shrink-0 text-gray-400">{{ formatBytes(f.size) }}</span>
          <button v-if="canPreview(f)" type="button" class="shrink-0 font-bold text-gray-600 hover:text-gray-900" @click="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })">
            {{ t('admin.develop.content.preview') }}
          </button>
          <button type="button" class="shrink-0 font-bold text-blue-600 hover:text-blue-700" @click="onDownload(f.fileId, f.name)">
            {{ t('admin.develop.content.download') }}
          </button>
          <button type="button" class="shrink-0 font-bold text-red-600 hover:text-red-700" @click="onRemoveFile(f.fileId)">
            {{ t('admin.develop.docs.task.remove') }}
          </button>
        </li>
      </ul>
      <p v-if="fileError !== ''" class="text-[11px] font-semibold text-red-600">{{ fileError }}</p>
    </div>

    <!-- 버튼 -->
    <div class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2.5">
      <button
        type="button"
        class="rounded-md border border-red-300 px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
        @click="confirmDelete = true"
      >
        {{ t('admin.develop.docs.editor.delete') }}
      </button>
      <span v-if="dirty" class="text-[11px] font-semibold text-amber-700">{{ t('admin.develop.docs.editor.unsaved') }}</span>
      <button
        type="button"
        class="ml-auto rounded-md border border-gray-300 px-3 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        :disabled="patch.isPending.value"
        @click="save"
      >
        {{ patch.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.editor.save') }}
      </button>
      <button
        type="button"
        class="rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="isEmpty || sendOpen"
        @click="openSend"
      >
        {{ t('admin.develop.docs.editor.openSend') }}
      </button>
    </div>
    <p v-if="isEmpty" class="text-[11px] text-gray-400">{{ t('admin.develop.docs.editor.emptyHint') }}</p>
    <div v-if="notice !== ''" class="flex flex-wrap items-center gap-2">
      <p class="text-xs font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
      <button
        v-if="conflict"
        type="button"
        class="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
        @click="reload"
      >
        {{ t('admin.develop.docs.editor.reload') }}
      </button>
    </div>

    <div v-if="confirmDelete" class="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800">
      <span>{{ t('admin.develop.docs.editor.deleteConfirm', { docNo: doc.docNo }) }}</span>
      <button type="button" class="ml-auto rounded border border-red-300 bg-white px-2 py-1 font-bold" @click="confirmDelete = false">
        {{ t('admin.develop.cancel') }}
      </button>
      <button type="button" class="rounded bg-red-600 px-2 py-1 font-bold text-white" :disabled="remove.isPending.value" @click="onDelete">
        {{ t('admin.develop.docs.editor.deleteOk') }}
      </button>
    </div>

    <DevelopDocSendPanel
      v-if="sendOpen"
      :doc="doc"
      :content="content"
      :reply-due-on="replyDueOn === '' ? null : replyDueOn"
      :request-title="requestTitle"
      :customer-name="customerName"
      :customer-company="customerCompany"
      :customer-email="customerEmail"
      @close="sendOpen = false"
    />
    <p class="text-[11px] text-gray-400">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }} · {{ doc.docNo }} v{{ doc.version }}</p>
  </div>
</template>
