<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PaperclipIcon, RotateCcwIcon, SaveIcon, SendIcon, Trash2Icon } from '@lucide/vue';
import {
  DEVELOP_DOC_FIELDS,
  DEVELOP_DOC_TYPE_LABELS,
  developDocContentEmpty,
  developDocContentIssues,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopDocContentType, DevelopDocFieldValueType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import {
  useAdminDevelopDocumentDelete,
  useAdminDevelopDocumentFileAdd,
  useAdminDevelopDocumentFileDelete,
  useAdminDevelopDocumentPatch,
  useInvalidateAdminDevelop,
} from '@/admin/useAdminDevelop';
import { downloadAdminDevelopFile } from '@/components/admin/develop/develop-files';
import {
  developDocFieldVisible,
  developDocFormContent,
  parseDevelopDocIssues,
} from '@/components/admin/develop/develop-doc-edit';
import { confirmDialog } from '@/next/lib/dialog';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { Textarea } from '@/next/components/ui/textarea';
import DevelopDocField from './DevelopDocField.vue';
import DevelopDocFileList from './DevelopDocFileList.vue';
import DevelopDocSendPanel from './DevelopDocSendPanel.vue';

// 문서 편집기(draft 전용, docs/DEVELOP_FLOW.md §13) — 옛 components/admin/develop/DevelopDocEditor.vue 의 짝(같은 props·emits·요청 본문).
// 폼은 계약 필드 스펙(DEVELOP_DOC_FIELDS)이 그린다 — 필드 하나는 DevelopDocField 한 부품(머리·본문 공용).
// 서버가 400 CONTENT_INVALID 로 막는 자리를 developDocContentIssues 로 먼저 검사해 필드 옆에 붙인다.
// 읽기 전용 필드(계약 요약 스냅샷)는 값만, 조건부 필드(when — 제작 단계에서만 뜨는 승인 범위)는 조건이 맞을 때만 그린다.
// 본문은 로컬 상태로 든다(상세는 AI 잡·다른 액션으로 재조회되므로 편집 중 초안이 덮이면 안 된다).
// 저장은 마지막으로 본 updatedAt 을 함께 보내(낙관적 잠금) 다른 사람이 먼저 고쳤으면 409 → '새로 불러오기'.
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
const sendOpen = ref(false);
const fileError = ref('');
const conflict = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

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

// 조건부 필드는 본문 값(예: 검토 단계)에 따라 나타나므로 content 를 읽는 computed 다.
const fields = computed(() => DEVELOP_DOC_FIELDS[props.doc.type].filter((f) => developDocFieldVisible(f, content.value)));
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
const idPrefix = computed(() => `doc-${String(props.doc.documentId)}`);

const setField = (key: string, value: DevelopDocFieldValueType): void => {
  content.value[key] = value;
  markDirty();
};
const setReplyDueOn = (value: string | number): void => {
  replyDueOn.value = String(value);
  markDirty();
};
const setInternalNote = (value: string | number): void => {
  internalNote.value = String(value);
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

// 초안 삭제 — 옛 화면의 인라인 확인 → 확인 대화상자(문구·'삭제' 버튼 이름 같음, 되돌릴 수 없어 danger).
async function onDelete(): Promise<void> {
  const ok = await confirmDialog({
    message: t('admin.develop.docs.editor.deleteConfirm', { docNo: props.doc.docNo }),
    confirmLabel: t('admin.develop.docs.editor.deleteOk'),
    cancelLabel: t('admin.develop.cancel'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await remove.mutateAsync(props.doc.documentId);
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
</script>

<template>
  <div class="grid gap-4">
    <!-- 문서 머리(메타) -->
    <Panel v-if="metaFields.length > 0" tone="muted" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <DevelopDocField
        v-for="f in metaFields"
        :key="f.key"
        :field="f"
        :doc-type="doc.type"
        :model-value="content[f.key]"
        :id-prefix="idPrefix"
        :issue="issueOf(f.key)"
        compact
        @update:model-value="(v) => setField(f.key, v)"
      />
    </Panel>

    <!-- 본문 2열 격자 — 표는 전폭 -->
    <div class="grid gap-3 lg:grid-cols-2">
      <DevelopDocField
        v-for="f in bodyFields"
        :key="f.key"
        :class="f.kind === 'table' ? 'lg:col-span-2' : ''"
        :field="f"
        :doc-type="doc.type"
        :model-value="content[f.key]"
        :id-prefix="idPrefix"
        :issue="issueOf(f.key)"
        @update:model-value="(v) => setField(f.key, v)"
      />
    </div>

    <!-- 회신 요청일 · 내부 메모 -->
    <div class="grid gap-3 lg:grid-cols-4">
      <div class="grid content-start gap-1.5">
        <Label :for="`${idPrefix}-replyDueOn`">{{ t('admin.develop.docs.editor.replyDueOn') }}</Label>
        <Input :id="`${idPrefix}-replyDueOn`" :model-value="replyDueOn" type="date" @update:model-value="setReplyDueOn" />
      </div>
      <div class="grid gap-1.5 lg:col-span-3">
        <Label :for="`${idPrefix}-internalNote`">{{ t('admin.develop.docs.editor.internalNote') }}</Label>
        <Textarea
          :id="`${idPrefix}-internalNote`"
          :model-value="internalNote"
          rows="2"
          :maxlength="4000"
          :placeholder="t('admin.develop.docs.editor.internalNoteHint')"
          @update:model-value="setInternalNote"
        />
      </div>
    </div>

    <!-- 첨부 -->
    <Panel class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground text-xs font-medium">{{ t('admin.develop.docs.editor.files') }}</span>
        <input ref="fileInput" type="file" multiple class="hidden" :disabled="fileAdd.isPending.value" @change="onPickFiles">
        <Button variant="outline" size="xs" :disabled="fileAdd.isPending.value" @click="fileInput?.click()">
          <PaperclipIcon />
          {{ fileAdd.isPending.value ? t('admin.develop.saving') : '파일 추가' }}
        </Button>
      </div>
      <DevelopDocFileList
        :files="doc.files"
        removable
        :busy="fileDelete.isPending.value"
        @preview="emit('preview', $event)"
        @download="onDownload"
        @remove="onRemoveFile"
      />
      <p v-if="fileError !== ''" class="text-destructive text-xs font-medium">{{ fileError }}</p>
    </Panel>

    <!-- 버튼 -->
    <div class="flex flex-wrap items-center gap-2 border-t pt-3">
      <Button variant="outline" size="sm" :disabled="remove.isPending.value" @click="onDelete">
        <Trash2Icon class="text-destructive" />
        {{ t('admin.develop.docs.editor.delete') }}
      </Button>
      <span v-if="dirty" class="text-warning text-xs font-medium">{{ t('admin.develop.docs.editor.unsaved') }}</span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" :disabled="patch.isPending.value" @click="save">
          <SaveIcon />
          {{ patch.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.editor.save') }}
        </Button>
        <Button size="sm" :disabled="isEmpty || sendOpen" @click="openSend">
          <SendIcon />
          {{ t('admin.develop.docs.editor.openSend') }}
        </Button>
      </div>
    </div>
    <p v-if="isEmpty" class="text-muted-foreground text-xs">{{ t('admin.develop.docs.editor.emptyHint') }}</p>
    <div v-if="notice !== ''" class="flex flex-wrap items-center gap-2">
      <p class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">{{ notice }}</p>
      <Button v-if="conflict" variant="outline" size="sm" @click="reload">
        <RotateCcwIcon />
        {{ t('admin.develop.docs.editor.reload') }}
      </Button>
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
    <p class="text-muted-foreground text-xs">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }} · {{ doc.docNo }} v{{ doc.version }}</p>
  </div>
</template>
