<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ApiRequestError, apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';
import {
  WORK_DECISION_LABELS,
  WORK_DOCUMENT_KINDS,
  WORK_DOCUMENT_TEMPLATES,
  WORK_TASK_LABELS,
  WorkCommandBody,
  WorkDraftResponse,
  WorkMailResponse,
  WorkResponse,
  emptyWorkPlan,
  workPublishedVersion,
} from '@sp/api-contract';
import type {
  WorkCommandType,
  WorkDocumentDraftType,
  WorkDocumentKind,
  WorkDocumentVersionType,
  WorkFileType,
  WorkPlanType,
  WorkTaskType,
  WorkViewType,
} from '@sp/api-contract';
import WorkDocumentView from './WorkDocumentView.vue';
import WorkPlanView from './WorkPlanView.vue';

const props = defineProps<{
  requestId: number; admin?: boolean; basePath: string; focused?: boolean;
  activeSection?: 'overview' | 'plan' | 'documents'; documentKind?: WorkDocumentKind | null; documentId?: string | null;
}>();
const emit = defineEmits<{ changed: []; available: [value: boolean]; enabled: [value: boolean]; dirty: [value: boolean]; 'document-selected': [id: string] }>();
const path = computed(() => `${props.basePath}/${String(props.requestId)}/workflow`);
const view = ref<WorkViewType | null>(null);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const section = ref<'overview' | 'plan' | 'documents'>('overview');
const plan = ref<WorkPlanType>(emptyWorkPlan());
const materialsReady = ref(false);
const materialsNote = ref('');
const selectedId = ref('');
const selectedVersion = ref<number | null>(null);
const draft = ref<WorkDocumentDraftType | null>(null);
const selectedTask = ref('');
const newKind = ref<WorkDocumentKind>('kickoff');
const confirm = ref<'disable' | 'reload' | 'reset' | 'publish' | null>(null);
const decisionNote = ref('');
const decisionChoice = ref<keyof typeof WORK_DECISION_LABELS>('approved');
const mailOpen = ref(false);
const mailSubject = ref('');
const mailBody = ref('');
const mailConfirmed = ref(false);
const aiInput = ref('');
const aiOutput = ref('');
const aiField = ref('');
const printing = ref(false);

const doc = computed(
  () => view.value?.state?.documents.find((d) => d.id === selectedId.value) ?? null,
);
const published = computed(() => (doc.value === null ? null : workPublishedVersion(doc.value)));
const def = computed(() => (doc.value === null ? null : WORK_DOCUMENT_TEMPLATES[doc.value.kind]));
const documentKinds = computed(() => props.documentKind ? [props.documentKind] : WORK_DOCUMENT_KINDS);
const visibleDocuments = computed(() => (view.value?.state?.documents ?? []).filter((item) => !props.documentKind || item.kind === props.documentKind));
const panelTitle = computed(() => !props.focused ? '프로젝트 수행관리' : section.value === 'plan' ? '수행계획·일정' : section.value === 'documents' ? (props.documentKind ? WORK_DOCUMENT_TEMPLATES[props.documentKind].label : '문서·승인') : '착수 준비·진행현황');
const pending = computed(() =>
  (view.value?.state?.documents ?? []).filter((d) => {
    const v = workPublishedVersion(d);
    return v?.requiresApproval && v.decision === null;
  }),
);
const planDirty = computed(
  () =>
    view.value?.state !== null &&
    view.value?.state !== undefined &&
    JSON.stringify(plan.value) !== JSON.stringify(view.value.state.plan),
);
const documentDirty = computed(
  () => draft.value !== null && JSON.stringify(draft.value) !== JSON.stringify(doc.value?.draft),
);
const readinessDirty = computed(
  () => { const state = view.value?.state; return state !== undefined && state !== null && (materialsReady.value !== state.materialsReady || materialsNote.value !== state.materialsNote); },
);
const dirty = computed(() => {
  if (!props.admin || !view.value?.enabled) return false;
  return planDirty.value || documentDirty.value || readinessDirty.value;
});
watch(dirty, (value) => { emit('dirty', value); }, { immediate: true });
const editable = computed(
  () =>
    props.admin &&
    view.value?.enabled &&
    !['cancelled', 'declined'].includes(view.value.context?.requestStatus ?? ''),
);
const taskDetails = computed(
  () => plan.value.tasks.find((t) => t.id === selectedTask.value) ?? null,
);
const preview = computed<WorkDocumentVersionType | null>(() => {
  if (selectedVersion.value !== null)
    return doc.value?.versions.find((v) => v.version === selectedVersion.value) ?? null;
  if (draft.value === null) return published.value;
  return {
    version: (doc.value?.versions.at(-1)?.version ?? 0) + 1,
    title: draft.value.title,
    content: draft.value.content,
    requiresApproval: draft.value.requiresApproval,
    dueDate: draft.value.dueDate,
    files: (view.value?.state?.files ?? []).filter((f) => draft.value?.fileIds.includes(f.fileId)),
    quote: view.value?.context?.quotes.find((q) => q.quoteId === draft.value?.quoteId) ?? null,
    plan: doc.value?.kind === 'plan' ? (view.value?.state?.publishedPlan ?? null) : null,
    publishedAt: '',
    decision: null,
    deliveryEventId: null,
  };
});
const message = (err: unknown): string =>
  err instanceof ApiRequestError
    ? err.message
    : err instanceof Error
      ? err.message
      : '처리에 실패했습니다. 다시 시도해 주세요.';
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function resetDocument(): void {
  draft.value =
    doc.value?.draft === undefined || doc.value.draft === null ? null : clone(doc.value.draft);
  selectedVersion.value =
    props.admin && draft.value !== null ? null : (doc.value?.publishedVersion ?? null);
  decisionNote.value = '';
  decisionChoice.value = 'approved';
  mailOpen.value = false;
  aiInput.value = '';
  aiOutput.value = '';
  aiField.value = def.value?.fields[0] ?? '';
}
function acceptView(value: WorkViewType, resetPlan = false, resetDoc = false, resetReadiness = resetPlan): void {
  view.value = value;
  emit('available', value.available);
  emit('enabled', value.enabled);
  if (resetPlan) {
    plan.value = clone(value.state?.plan ?? emptyWorkPlan());
  }
  if (resetReadiness) {
    materialsReady.value = value.state?.materialsReady ?? false;
    materialsNote.value = value.state?.materialsNote ?? '';
  }
  if (!value.state?.documents.some((d) => d.id === selectedId.value)) {
    selectedId.value = value.state?.documents[0]?.id ?? '';
    resetDoc = true;
  }
  if (resetDoc) resetDocument();
  applyFocus();
}
function applyFocus(): void {
  if (props.activeSection) section.value = props.activeSection;
  newKind.value = props.documentKind ?? 'kickoff';
  if (!props.focused || section.value !== 'documents') return;
  const wanted = visibleDocuments.value.find((item) => item.id === props.documentId)
    ?? visibleDocuments.value.find((item) => item.id === selectedId.value)
    ?? visibleDocuments.value[0];
  if ((wanted?.id ?? '') === selectedId.value) return;
  // 세부 메뉴를 바꾸더라도 작성 중인 문서를 잃지 않는다.
  if (documentDirty.value) { error.value = '작성 중인 문서를 먼저 저장한 뒤 문서를 선택해 주세요.'; return; }
  selectedId.value = wanted?.id ?? '';
  resetDocument();
}
watch(() => [props.activeSection, props.documentKind, props.documentId], applyFocus);
async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    acceptView((await apiGet(path.value, WorkResponse)).data, true, true);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) {
      acceptView({ available: false, enabled: false, revision: 0, state: null, context: null }, true, true);
      return;
    }
    error.value = message(err);
    emit('available', props.admin);
  } finally {
    loading.value = false;
    confirm.value = null;
  }
}
watch(
  () => props.requestId,
  () => {
    view.value = null;
    selectedId.value = '';
    void load();
  },
  { immediate: true },
);
function beforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault();
  }
}
window.addEventListener('beforeunload', beforeUnload);
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
});

async function run(command: WorkCommandType): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    const body = WorkCommandBody.safeParse({ revision: view.value?.revision ?? 0, command });
    if (!body.success) {
      error.value = body.error.issues[0]?.message ?? '입력값을 확인해 주세요';
      return false;
    }
    const response = await apiSend('POST', path.value, body.data, WorkResponse);
    acceptView(
      response.data,
      command.type === 'plan.save' || command.type === 'enable',
      command.type === 'document.save' ||
        command.type === 'document.restore' ||
        command.type === 'document.create',
      command.type === 'readiness.save' || command.type === 'enable',
    );
    notice.value =
      command.type === 'document.publish'
        ? '새 버전을 고객에게 공개했습니다. 메일은 아래에서 확인 후 보내실 수 있습니다.'
        : command.type === 'document.decide'
          ? '문서에 대한 응답을 기록했습니다.'
          : '저장했습니다.';
    emit('changed');
    return true;
  } catch (err) {
    error.value = message(err);
    return false;
  } finally {
    busy.value = false;
    confirm.value = null;
  }
}
async function savePlan(): Promise<boolean> {
  return run({ type: 'plan.save', plan: clone(plan.value) });
}
async function publishPlan(): Promise<void> {
  if (planDirty.value && !(await savePlan())) return;
  await run({ type: 'plan.publish' });
}
async function saveDocument(): Promise<boolean> {
  if (draft.value === null) return false;
  return run({ type: 'document.save', id: selectedId.value, draft: clone(draft.value) });
}
async function publishDocument(): Promise<void> {
  if (!(await saveDocument())) return;
  if (await run({ type: 'document.publish', id: selectedId.value }))
    selectedVersion.value = doc.value?.publishedVersion ?? null;
}
async function createDocument(): Promise<void> {
  if (documentDirty.value) {
    error.value = '작성 중인 문서를 먼저 저장해 주세요.';
    return;
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  if (await run({ type: 'document.create', id, kind: newKind.value })) {
    selectedId.value = id;
    resetDocument();
    section.value = 'documents';
    emit('document-selected', id);
  }
}
function selectDocument(id: string): void {
  if (id === selectedId.value) {
    section.value = 'documents';
    emit('document-selected', id);
    return;
  }
  if (documentDirty.value) {
    error.value = '작성 중인 문서를 먼저 저장하거나 새로 불러와 주세요.';
    return;
  }
  selectedId.value = id;
  resetDocument();
  section.value = 'documents';
  emit('document-selected', id);
}
function addTask(): void {
  plan.value.tasks.push({
    id: crypto.randomUUID().replace(/-/g, ''),
    title: '새 작업',
    assignee: '',
    status: 'planned',
    start: null,
    end: null,
    weight: 10,
    progress: 0,
    customerVisible: true,
    dependencies: [],
    approvalDocumentIds: [],
    note: '',
  });
}
function taskStatus(task: WorkTaskType): void {
  if (task.status === 'completed') task.progress = 100;
  else if (task.status === 'planned') task.progress = 0;
  else if (task.progress === 100) task.progress = 99;
}
function taskProgress(task: WorkTaskType): void {
  if (task.progress === 100) task.status = 'completed';
  else if (task.progress > 0 && (task.status === 'planned' || task.status === 'completed'))
    task.status = 'in_progress';
}
function removeTask(id: string): void {
  const task = plan.value.tasks.find((t) => t.id === id);
  if (task && task.progress > 0) {
    error.value = '진행 이력이 있는 작업은 제외로 변경해 주세요.';
    return;
  }
  plan.value.tasks = plan.value.tasks.filter((t) => t.id !== id);
  for (const t of plan.value.tasks) t.dependencies = t.dependencies.filter((d) => d !== id);
}
function moveTask(index: number, direction: number): void {
  const a = plan.value.tasks[index];
  const b = plan.value.tasks[index + direction];
  if (a && b) {
    plan.value.tasks[index] = b;
    plan.value.tasks[index + direction] = a;
  }
}
async function start(): Promise<void> {
  if (
    readinessDirty.value &&
    !(await run({
      type: 'readiness.save',
      materialsReady: materialsReady.value,
      materialsNote: materialsNote.value,
    }))
  )
    return;
  await run({ type: 'start' });
}
async function respond(): Promise<void> {
  if (published.value)
    await run({
      type: 'document.decide',
      id: selectedId.value,
      version: published.value.version,
      decision: decisionChoice.value,
      note: decisionNote.value,
    });
}
async function downloadPath(url: string, name: string): Promise<void> {
  try {
    const blob = await apiGetBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  } catch (err) {
    error.value = message(err);
  }
}
async function download(file: WorkFileType): Promise<void> {
  await downloadPath(`${path.value}/files/${String(file.fileId)}`, file.name);
}
async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length === 0 || busy.value) return;
  if (documentDirty.value && !(await saveDocument())) return;
  const form = new FormData();
  form.append(
    'payload',
    JSON.stringify({ revision: view.value?.revision, documentId: selectedId.value }),
  );
  for (const file of files) form.append('file', file);
  busy.value = true;
  error.value = '';
  try {
    acceptView(
      (await apiSendForm('POST', `${path.value}/files`, form, WorkResponse)).data,
      false,
      true,
    );
    notice.value = '파일을 첨부했습니다.';
  } catch (err) {
    error.value = message(err);
  } finally {
    busy.value = false;
  }
}
async function generateDraft(): Promise<void> {
  if (busy.value || aiInput.value.trim() === '') return;
  busy.value = true;
  error.value = '';
  try {
    const response = await apiSend(
      'POST',
      `${path.value}/ai-draft`,
      { documentId: selectedId.value, input: aiInput.value },
      WorkDraftResponse,
    );
    aiOutput.value = response.data.text;
    notice.value = 'AI 정리 초안입니다. 내용을 확인한 뒤 필요한 항목에 적용해 주세요.';
  } catch (err) {
    error.value = message(err);
  } finally {
    busy.value = false;
  }
}
function prepareMail(): void {
  const v = published.value;
  if (v === null) return;
  mailSubject.value = `[샘플피씨비] ${v.title} · v${String(v.version)}`;
  mailBody.value = `${view.value?.context?.customer ?? '고객'} 담당자님, 안녕하세요.\n\n${v.title} 문서를 전달드립니다.\n\n${Object.entries(
    v.content.fields,
  )
    .filter(([, value]) => value.trim() !== '')
    .map(([key, value]) => `${key}: ${value}`)
    .join(
      '\n\n',
    )}\n\n${v.requiresApproval ? '문서를 확인하신 뒤 의뢰 화면에서 승인 또는 수정·협의 요청을 남겨 주세요.' : '공유드린 진행 내용을 확인해 주세요.'}${v.dueDate ? `\n회신 요청일: ${v.dueDate}` : ''}\n\n감사합니다.\n샘플피씨비 개발팀`;
  mailConfirmed.value = false;
  mailOpen.value = true;
}
async function sendCustomerMail(): Promise<void> {
  if (!mailConfirmed.value || published.value === null || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const response = await apiSend(
      'POST',
      `${path.value}/mail`,
      {
        documentId: selectedId.value,
        version: published.value.version,
        subject: mailSubject.value,
        body: mailBody.value,
      },
      WorkMailResponse,
    );
    if (!response.data.sent)
      error.value = '메일 전송에 실패했습니다. 관리자 메일 이력을 확인해 주세요.';
    else {
      notice.value = '고객 연락처 이메일로 발송했습니다.';
      mailOpen.value = false;
    }
  } catch (err) {
    error.value = message(err);
  } finally {
    busy.value = false;
  }
}
async function printDocument(): Promise<void> {
  printing.value = true;
  await nextTick();
  window.print();
  printing.value = false;
}
function resetTasks(): void {
  plan.value.tasks = clone(view.value?.state?.plan.tasks ?? []);
  confirm.value = null;
}
</script>

<template>
  <section v-if="loading || (view?.available && (admin || view.enabled)) || error" id="workflow" class="develop-workflow">
    <p v-if="loading" class="muted">수행관리를 불러오고 있습니다…</p>
    <template v-else>
      <header class="workflow-header">
        <div>
          <p class="eyebrow">PROJECT WORKSPACE</p>
          <h2>{{ panelTitle }}</h2>
          <p class="muted">일정과 주요 결정사항을 공유하고, 필요한 시점에 확인합니다.</p>
        </div>
        <div class="actions">
          <span v-if="dirty" class="pill">저장하지 않은 내용</span><button type="button" :disabled="busy" @click="dirty ? (confirm = 'reload') : load()">
            새로 불러오기
          </button><button
            v-if="admin && view?.enabled"
            type="button"
            :disabled="busy"
            @click="downloadPath(`${path}/export`, `develop-workflow-${requestId}.json`)"
          >
            기록 내보내기
          </button>
        </div>
      </header>
      <p v-if="error" class="feedback error" role="alert">{{ error }}</p>
      <p v-if="notice" class="feedback success" role="status">{{ notice }}</p>
      <div v-if="confirm === 'reload'" class="confirmation">
        <p>저장하지 않은 내용을 버리고 최신 내용을 불러옵니다.</p>
        <button type="button" @click="load()">불러오기</button><button type="button" @click="confirm = null">계속 작성</button>
      </div>
      <div v-if="admin && !view?.enabled" class="empty-state">
        <h3>이 의뢰에 수행관리를 적용합니다</h3>
        <p>
          수락한 견적을 기준으로 계약·착수·일정·승인 문서를 관리합니다. 적용하면 결제 후에도
          담당자가 착수 준비를 확인해야 합니다.
        </p>
        <button type="button" class="primary" :disabled="busy" @click="run({ type: 'enable' })">
          수행관리 켜기
        </button>
      </div>
      <template v-if="view?.enabled && view.state && view.context">
        <nav v-if="!focused" class="workflow-nav" aria-label="수행관리 메뉴">
          <button
            type="button"
            :class="{ active: section === 'overview' }"
            @click="section = 'overview'"
          >
            프로젝트 현황
          </button><button
            v-if="admin"
            type="button"
            :class="{ active: section === 'plan' }"
            @click="section = 'plan'"
          >
            수행계획·일정
          </button><button
            type="button"
            :class="{ active: section === 'documents' }"
            @click="section = 'documents'"
          >
            문서·승인 <span class="count">{{ view.state.documents.length }}</span>
          </button><span v-if="pending.length" class="pill">확인 대기 {{ pending.length }}건</span>
        </nav>

        <div v-show="section === 'overview'" class="stack">
          <section v-if="admin" class="card readiness">
            <div class="section-title">
              <h3>착수 준비</h3>
              <span class="pill">{{ view.context.startedAt ? '착수 완료' : '담당자 확인' }}</span>
            </div>
            <div class="check-list">
              <span :class="{ checked: view.context.contractReady }">{{ view.context.contractReady ? '✓' : '○' }} 견적·조건 수락</span><span :class="{ checked: view.context.paymentReady }">{{ view.context.paymentReady ? '✓' : '○' }} 착수금 확인 또는 후불 조건</span><label><input v-model="materialsReady" type="checkbox" :disabled="!editable || busy">
                필수자료 준비 완료</label>
            </div>
            <label class="field"><span>자료 준비 메모 · 내부용</span><textarea
              v-model="materialsNote"
              rows="2"
              maxlength="4000"
              :disabled="!editable || busy"
              placeholder="고객 제공자료, 장비, 샘플과 확인 내용을 기록하세요."
            />
            </label>
            <div class="actions">
              <button
                type="button"
                :disabled="!editable || busy"
                @click="run({ type: 'readiness.save', materialsReady, materialsNote })"
              >
                준비사항 저장
              </button><button
                v-if="view.context.requestStatus === 'accepted'"
                type="button"
                class="primary"
                :disabled="
                  busy ||
                    !materialsReady ||
                    !view.context.contractReady ||
                    !view.context.paymentReady
                "
                @click="start()"
              >
                준비 확인 후 개발 착수
              </button>
            </div>
          </section>
          <section class="card">
            <div class="section-title">
              <h3>{{ admin ? '고객에게 공개된 진행 현황' : '진행 현황' }}</h3>
              <small v-if="view.state.planPublishedAt" class="muted">{{ new Date(view.state.planPublishedAt).toLocaleString('ko-KR') }} 갱신</small>
            </div>
            <WorkPlanView v-if="view.state.publishedPlan" :plan="view.state.publishedPlan" />
            <p v-else class="muted">담당자가 수행계획을 준비하고 있습니다.</p>
          </section>
          <section v-if="admin && view.context.quotes.some((q) => q.status === 'accepted' && q.milestones.some((m) => m.trigger === 'manual' && m.status === 'pending'))" class="card">
            <h3>중도금 청구</h3><p class="muted">수락된 견적의 수동 청구를 열면 고객이 기존 견적서에서 결제할 수 있습니다.</p>
            <div v-for="milestone in view.context.quotes.filter((q) => q.status === 'accepted').flatMap((q) => q.milestones).filter((m) => m.trigger === 'manual' && m.status === 'pending')" :key="milestone.milestoneId" class="document-link">
              <span>{{ milestone.title }} · {{ milestone.amount.toLocaleString('ko-KR') }}원</span><button type="button" :disabled="!editable || busy || view.state.openedMilestoneIds.includes(milestone.milestoneId)" @click="run({ type: 'milestone.open', milestoneId: milestone.milestoneId })">{{ view.state.openedMilestoneIds.includes(milestone.milestoneId) ? '청구 열림' : '고객 결제 열기' }}</button>
            </div>
          </section>
          <section class="card">
            <h3>고객 확인 대기</h3>
            <p v-if="pending.length === 0" class="muted">현재 확인을 기다리는 문서가 없습니다.</p>
            <button
              v-for="item in pending"
              :key="item.id"
              type="button"
              class="document-link"
              @click="selectDocument(item.id)"
            >
              <span>{{ workPublishedVersion(item)?.title
              }}<small>{{ WORK_DOCUMENT_TEMPLATES[item.kind].label }} · v{{ item.publishedVersion
              }}<template v-if="workPublishedVersion(item)?.dueDate">
                · 회신 {{ workPublishedVersion(item)?.dueDate }}</template></small></span><span>문서 보기 →</span>
            </button>
          </section>
          <div v-if="admin" class="actions">
            <button type="button" :disabled="busy" @click="confirm = 'disable'">
              이 의뢰의 수행관리 끄기
            </button>
          </div>
          <div v-if="confirm === 'disable'" class="confirmation">
            <p>
              고객에게 수행관리가 표시되지 않고 기존 진행 방식으로 돌아갑니다. 작성한
              문서·승인·일정은 보관됩니다. 미결 승인 건은 담당자가 이어서 확인해 주세요.
            </p>
            <button type="button" :disabled="busy" @click="run({ type: 'disable' })">
              보관하고 끄기
            </button><button type="button" @click="confirm = null">유지</button>
          </div>
        </div>

        <div v-show="section === 'plan' && admin" class="stack">
          <fieldset class="card" :disabled="!editable || busy">
            <div class="section-title">
              <h3>수행계획 편집</h3>
              <span class="muted">저장 후 공개해야 고객 화면에 반영됩니다.</span>
            </div>
            <div class="grid three">
              <label class="field"><span>기준 착수일</span><input
                v-model="plan.baseStart"
                type="date"
                @change="plan.baseStart ||= null"
              ></label><label class="field"><span>기준 완료일</span><input
                v-model="plan.baselineEnd"
                type="date"
                @change="plan.baselineEnd ||= null"
              ></label><label class="field"><span>현재 예상 완료일</span><input v-model="plan.forecastEnd" type="date" @change="plan.forecastEnd ||= null"></label>
            </div>
            <div class="grid three">
              <label class="field"><span>완료 업무</span><textarea v-model="plan.completedReport" rows="3" maxlength="4000" /></label><label class="field"><span>현재 진행 업무</span><textarea v-model="plan.currentReport" rows="3" maxlength="4000" /></label><label class="field"><span>다음 예정 업무</span><textarea v-model="plan.nextReport" rows="3" maxlength="4000" />
              </label>
            </div>
            <div class="table-scroll">
              <table class="task-table">
                <thead>
                  <tr>
                    <th>순서</th>
                    <th>작업</th>
                    <th>상태</th>
                    <th>시작일</th>
                    <th>완료일</th>
                    <th>가중치</th>
                    <th>진행률</th>
                    <th>고객 공개</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(task, i) in plan.tasks" :key="task.id">
                    <td>
                      <div class="reorder">
                        <button
                          type="button"
                          :disabled="i === 0"
                          aria-label="작업 위로"
                          @click="moveTask(i, -1)"
                        >
                          ↑
                        </button>{{ i + 1
                        }}<button
                          type="button"
                          :disabled="i === plan.tasks.length - 1"
                          aria-label="작업 아래로"
                          @click="moveTask(i, 1)"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <input
                        v-model="task.title"
                        :aria-label="`작업 ${i + 1} 이름`"
                        maxlength="160"
                      ><button
                        type="button"
                        class="text-button"
                        @click="selectedTask = selectedTask === task.id ? '' : task.id"
                      >
                        선행·승인 {{ task.dependencies.length + task.approvalDocumentIds.length }}건
                      </button>
                    </td>
                    <td>
                      <select
                        v-model="task.status"
                        :aria-label="`${task.title} 상태`"
                        @change="taskStatus(task)"
                      >
                        <option v-for="(label, code) in WORK_TASK_LABELS" :key="code" :value="code">
                          {{ label }}
                        </option>
                      </select>
                    </td>
                    <td>
                      <input
                        v-model="task.start"
                        type="date"
                        :aria-label="`${task.title} 시작일`"
                        @change="task.start ||= null"
                      >
                    </td>
                    <td>
                      <input
                        v-model="task.end"
                        type="date"
                        :aria-label="`${task.title} 완료일`"
                        @change="task.end ||= null"
                      >
                    </td>
                    <td>
                      <input
                        v-model.number="task.weight"
                        type="number"
                        min="0"
                        max="100"
                        :aria-label="`${task.title} 가중치`"
                      >
                    </td>
                    <td>
                      <input
                        v-model.number="task.progress"
                        type="number"
                        min="0"
                        max="100"
                        :aria-label="`${task.title} 진행률`"
                        @change="taskProgress(task)"
                      >
                    </td>
                    <td>
                      <input
                        v-model="task.customerVisible"
                        type="checkbox"
                        :aria-label="`${task.title} 고객 공개`"
                      >
                    </td>
                    <td><button type="button" @click="removeTask(task.id)">삭제</button></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <section v-if="taskDetails" class="task-details">
              <h4>{{ taskDetails.title }} · 작업 조건</h4>
              <div class="grid two">
                <div>
                  <h4>먼저 완료할 작업</h4>
                  <label
                    v-for="item in plan.tasks.filter((t) => t.id !== taskDetails?.id)"
                    :key="item.id"
                    class="checkbox"
                  ><input v-model="taskDetails.dependencies" type="checkbox" :value="item.id">{{
                    item.title
                  }}</label>
                </div>
                <div>
                  <h4>시작 전에 승인받을 문서</h4>
                  <p v-if="view.state.documents.length === 0" class="muted">
                    문서·승인 메뉴에서 승인 문서를 먼저 만들어 주세요.
                  </p>
                  <label v-for="item in view.state.documents" :key="item.id" class="checkbox"><input
                    v-model="taskDetails.approvalDocumentIds"
                    type="checkbox"
                    :value="item.id"
                  >{{ item.draft?.title ?? workPublishedVersion(item)?.title
                  }}<small>{{
                    workPublishedVersion(item)?.decision?.decision === 'approved'
                      ? '승인'
                      : '승인 필요'
                  }}</small></label>
                </div>
              </div>
              <div class="grid two">
                <label class="field"><span>담당자 · 내부용</span><input v-model="taskDetails.assignee" maxlength="100"></label><label class="field"><span>비고 · 내부용</span><textarea v-model="taskDetails.note" rows="2" maxlength="2000" />
                </label>
              </div>
              <p class="muted">
                승인은 최신 공개 버전을 기준으로 합니다. 조건부 승인·협의 요청은 작업을 열지
                않습니다.
              </p>
            </section>
            <div class="actions">
              <button type="button" :disabled="plan.tasks.length >= 100" @click="addTask()">
                작업 추가
              </button><button
                type="button"
                :disabled="plan.tasks.some((t) => t.progress > 0)"
                @click="confirm = 'reset'"
              >
                저장된 작업 불러오기
              </button><button type="button" @click="savePlan()">일정 저장</button><button type="button" class="primary" @click="publishPlan()">
                저장하고 현황 공개
              </button>
            </div>
            <div v-if="confirm === 'reset'" class="confirmation">
              <p>현재 작업 목록을 마지막 저장본으로 되돌립니다.</p>
              <button type="button" @click="resetTasks()">교체</button><button type="button" @click="confirm = null">취소</button>
            </div>
          </fieldset>
          <section class="card">
            <h3>작성 중인 일정 미리보기</h3>
            <WorkPlanView :plan="plan" />
          </section>
        </div>

        <div v-show="section === 'documents'" class="documents-layout">
          <aside class="card document-nav">
            <div v-if="admin" class="stack">
              <label class="field"><span>새 문서 유형</span><select v-model="newKind" :disabled="busy">
                <option v-for="kind in documentKinds" :key="kind" :value="kind">
                  {{ WORK_DOCUMENT_TEMPLATES[kind].label }}
                </option>
              </select></label><button
                type="button"
                class="primary"
                :disabled="!editable || busy || view.state.documents.length >= 100"
                @click="createDocument()"
              >
                문서 만들기
              </button>
            </div>
            <p v-if="visibleDocuments.length === 0" class="muted">등록된 문서가 없습니다.</p>
            <button
              v-for="item in visibleDocuments"
              :key="item.id"
              type="button"
              class="doc-nav-item"
              :class="{ selected: item.id === selectedId }"
              @click="selectDocument(item.id)"
            >
              <strong>{{ WORK_DOCUMENT_TEMPLATES[item.kind].label }}</strong><small>{{ item.draft?.title ?? workPublishedVersion(item)?.title }}</small><span>{{ item.publishedVersion ? `공개 v${item.publishedVersion}` : '작업본'
              }}<template v-if="workPublishedVersion(item)?.decision">
                ·
                {{
                  WORK_DECISION_LABELS[workPublishedVersion(item)!.decision!.decision]
                }}</template></span>
            </button>
          </aside>
          <div v-if="doc && def" class="stack document-main">
            <div class="card">
              <div class="section-title">
                <div>
                  <h3>{{ def.label }}</h3>
                  <p class="muted">{{ def.description }}</p>
                </div>
                <button v-if="preview" type="button" @click="printDocument()">
                  현재 문서 인쇄
                </button>
              </div>
              <div class="actions version-list">
                <button
                  v-if="admin && draft"
                  type="button"
                  :class="{ primary: selectedVersion === null }"
                  @click="selectedVersion = null"
                >
                  작업본{{ documentDirty ? ' · 수정 중' : '' }}
                </button><button
                  v-for="version in doc.versions"
                  :key="version.version"
                  type="button"
                  :class="{ primary: selectedVersion === version.version }"
                  @click="selectedVersion = version.version"
                >
                  v{{ version.version
                  }}{{ doc.publishedVersion === version.version ? ' · 공개' : '' }}
                </button>
              </div>
            </div>
            <fieldset
              v-if="admin && draft && selectedVersion === null"
              class="card document-editor"
              :disabled="!editable || busy"
            >
              <div class="grid two">
                <label class="field"><span>문서 제목</span><input v-model="draft.title" maxlength="200"></label><label class="field"><span>회신 요청일</span><input v-model="draft.dueDate" type="date" @change="draft.dueDate ||= null"></label>
              </div>
              <label class="checkbox"><input
                v-model="draft.requiresApproval"
                type="checkbox"
                :disabled="doc.kind === 'delivery'"
              >고객 승인 요청</label><label v-if="doc.kind === 'contract' || doc.kind === 'change'" class="field"><span>{{ doc.kind === 'contract' ? '수락한 기본 견적' : '연결할 추가 견적' }}</span><select v-model="draft.quoteId">
                <option :value="null">견적 선택</option>
                <option
                  v-for="quote in view.context.quotes.filter((q) =>
                    doc?.kind === 'contract'
                      ? q.status === 'accepted' && q.kind !== 'change'
                      : q.kind === 'change',
                  )"
                  :key="quote.quoteId"
                  :value="quote.quoteId"
                >
                  v{{ quote.version }} · {{ quote.title }} ·
                  {{ quote.totalAmount.toLocaleString() }}원
                </option></select><small>금액·조건은 공개할 때 해당 견적에서 가져옵니다.</small></label>
              <div class="grid two">
                <label v-for="field in def.fields" :key="field" class="field"><span>{{ field }}</span><textarea v-model="draft.content.fields[field]" rows="3" maxlength="12000" />
                </label>
              </div>
              <div v-if="def.columns.length" class="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th v-for="column in def.columns" :key="column">{{ column }}</th>
                      <th>관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, i) in draft.content.rows" :key="i">
                      <td v-for="column in def.columns" :key="column">
                        <input
                          v-model="row[column]"
                          :aria-label="`${i + 1}행 ${column}`"
                          maxlength="2000"
                        >
                      </td>
                      <td>
                        <button type="button" @click="draft.content.rows.splice(i, 1)">삭제</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
                <button
                  type="button"
                  :disabled="draft.content.rows.length >= 100"
                  @click="
                    draft.content.rows.push(Object.fromEntries(def.columns.map((c) => [c, ''])))
                  "
                >
                  행 추가
                </button>
              </div>
              <div v-if="def.checks.length" class="grid two">
                <label v-for="check in def.checks" :key="check" class="checkbox"><input v-model="draft.content.checks" type="checkbox" :value="check">{{
                  check
                }}</label>
              </div>
              <section class="attachments">
                <h4>첨부자료·날인본</h4>
                <input type="file" multiple aria-label="문서 첨부자료 업로드" @change="upload">
                <p class="muted">
                  한 번에 10개, 합계 50MB까지. 공개본에 포함한 자료만 고객에게 보입니다.
                </p>
                <label v-for="file in view.state.files" :key="file.fileId" class="checkbox"><input v-model="draft.fileIds" type="checkbox" :value="file.fileId">{{
                  file.name
                }}<button type="button" class="text-button" @click="download(file)">
                  받기
                </button></label>
              </section>
              <details class="ai-editor">
                <summary>AI 문장 정리</summary>
                <p class="muted">
                  담당자가 입력한 자료를 정리합니다. 개발의뢰 AI 검토서 설정을 사용하며, 생성 결과는
                  확인 후 적용합니다.
                </p>
                <label class="field"><span>정리할 내용</span><textarea v-model="aiInput" rows="5" maxlength="24000" />
                </label>
                <div class="actions">
                  <button
                    type="button"
                    @click="
                      aiInput = Object.entries(draft.content.fields)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n')
                    "
                  >
                    현재 입력 가져오기
                  </button><button
                    type="button"
                    :disabled="!view.context.aiConsent || !aiInput.trim()"
                    @click="generateDraft()"
                  >
                    {{ busy ? '정리 중…' : 'AI 정리 초안 만들기' }}
                  </button>
                </div>
                <p v-if="!view.context.aiConsent" class="muted">
                  고객이 AI 분석에 동의하지 않았습니다.
                </p>
                <template v-if="aiOutput">
                  <label class="field"><span>정리 결과 · 편집 가능</span><textarea v-model="aiOutput" rows="8" />
                  </label>
                  <div class="actions">
                    <select v-model="aiField" aria-label="AI 결과를 적용할 항목">
                      <option v-for="field in def.fields" :key="field">{{ field }}</option>
                    </select><button
                      type="button"
                      @click="draft.content.fields[aiField] = aiOutput.slice(0, 12000)"
                    >
                      이 항목에 적용
                    </button>
                  </div>
                </template>
              </details>
              <div class="actions">
                <button type="button" @click="saveDocument()">작업본 저장</button><button type="button" class="primary" @click="confirm = 'publish'">
                  {{ doc.kind === 'delivery' ? '저장하고 납품' : '저장하고 고객 공개' }}
                </button>
              </div>
              <div v-if="confirm === 'publish'" class="confirmation">
                <p>
                  {{
                    doc.kind === 'delivery'
                      ? '이 버전을 납품하고 검수기간을 시작합니다.'
                      : '현재 작업본을 새 버전으로 공개합니다.'
                  }}
                  기존 승인과 별도로 새 버전에 대한 확인이 필요합니다. 메일은 공개 후 따로
                  발송합니다.
                </p>
                <button type="button" class="primary" @click="publishDocument()">공개 확정</button><button type="button" @click="confirm = null">계속 편집</button>
              </div>
            </fieldset>
            <WorkDocumentView
              v-if="preview"
              :kind="doc.kind"
              :version="preview"
              :project="view.context.title"
              :customer="view.context.customer"
              @download="download"
            />
            <div v-if="admin && selectedVersion !== null" class="actions">
              <button
                type="button"
                :disabled="!editable || busy || documentDirty"
                @click="run({ type: 'document.restore', id: doc.id, version: selectedVersion })"
              >
                이 버전을 작업본으로 가져오기
              </button><button
                v-if="published"
                type="button"
                :disabled="!editable || busy"
                @click="run({ type: 'document.withdraw', id: doc.id })"
              >
                고객 공개 중단
              </button><button
                v-if="published"
                type="button"
                :disabled="!editable || busy"
                @click="prepareMail()"
              >
                공개 문서 이메일 작성
              </button>
            </div>
            <section
              v-if="
                !admin &&
                  published?.requiresApproval &&
                  !published.decision &&
                  !['cancelled', 'declined', 'completed'].includes(view.context.requestStatus)
              "
              class="card decision"
            >
              <h3>문서 v{{ published.version }} 확인</h3>
              <p class="muted">
                조건부 승인·협의 요청은 후속 작업을 시작하지 않습니다. 확인이 끝난 수정본에 다시
                승인해 주세요.
              </p>
              <fieldset :disabled="busy">
                <div class="grid two">
                  <label v-for="(label, code) in WORK_DECISION_LABELS" :key="code" class="checkbox"><input
                    v-model="decisionChoice"
                    type="radio"
                    name="workflow-decision"
                    :value="code"
                  >{{ label }}</label>
                </div>
                <label class="field"><span>고객 의견</span><textarea
                  v-model="decisionNote"
                  rows="3"
                  maxlength="2000"
                  placeholder="수정·협의·조건부 승인은 내용을 적어 주세요."
                /></label><button type="button" class="primary" @click="respond()">
                  {{ WORK_DECISION_LABELS[decisionChoice] }} 기록
                </button>
              </fieldset>
            </section>
            <section v-if="admin && mailOpen" class="card">
              <h3>고객 이메일 확인</h3>
              <p class="muted">
                의뢰에 등록된 고객 연락처 이메일로 발송합니다. 첨부파일은 로그인 후 문서에서
                확인합니다.
              </p>
              <fieldset :disabled="busy">
                <label class="field"><span>제목</span><input v-model="mailSubject" maxlength="200"></label><label class="field"><span>본문</span><textarea v-model="mailBody" rows="12" maxlength="16000" /></label><label class="checkbox"><input v-model="mailConfirmed" type="checkbox">공개 버전과 메일 내용을
                  확인했습니다.</label>
                <div class="actions">
                  <button
                    type="button"
                    class="primary"
                    :disabled="!mailConfirmed"
                    @click="sendCustomerMail()"
                  >
                    고객에게 발송
                  </button><button type="button" @click="mailOpen = false">닫기</button>
                </div>
              </fieldset>
            </section>
          </div>
          <div v-else class="card empty-state">
            <h3>프로젝트 문서</h3>
            <p>
              {{
                admin
                  ? '왼쪽에서 문서 유형을 선택해 작성을 시작하세요.'
                  : '담당자가 검토한 문서가 이곳에 공개됩니다.'
              }}
            </p>
          </div>
        </div>
      </template>
    </template>
    <Teleport to="body">
      <div v-if="printing && preview && doc && view?.context" class="workflow-print">
        <WorkDocumentView
          :kind="doc.kind"
          :version="preview"
          :project="view.context.title"
          :customer="view.context.customer"
        />
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.develop-workflow {
  --wf-line: var(--color-line, #d9e1ec);
  --wf-ink: var(--color-tx-1, #152033);
  --wf-muted: var(--color-tx-3, #64748b);
  --wf-accent: var(--color-brand-600, #2864dc);
  color: var(--wf-ink);
  font-size: 13px;
  line-height: 1.6;
  scroll-margin-top: 90px;
}
.workflow-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 20px 0;
}
.eyebrow {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: var(--wf-accent);
  margin: 0 0 4px;
}
h2 {
  font-size: 23px;
  font-weight: 800;
  margin: 0;
}
h3 {
  font-size: 16px;
  font-weight: 750;
  margin: 0 0 12px;
}
h4 {
  font-size: 13px;
  font-weight: 700;
  margin: 0 0 8px;
}
p {
  margin: 0 0 10px;
}
.muted {
  color: var(--wf-muted);
  font-size: 12px;
}
.stack {
  display: grid;
  gap: 16px;
  min-width: 0;
}
.card {
  min-width: 0;
  margin: 0;
  padding: 20px;
  background: var(--color-paper, #fff);
  border: 1px solid var(--wf-line);
  border-radius: 12px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
}
.workflow-header .actions {
  margin: 0;
}
button {
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  border: 1px solid var(--wf-line);
  border-radius: 7px;
  background: var(--color-paper, #fff);
  color: var(--wf-ink);
  padding: 8px 12px;
  line-height: 1.4;
}
button:hover {
  border-color: var(--wf-accent);
}
button:disabled,
fieldset:disabled button {
  opacity: 0.45;
  cursor: default;
}
.primary {
  background: var(--wf-accent);
  border-color: var(--wf-accent);
  color: var(--color-paper, #fff);
}
input:not([type='checkbox']):not([type='radio']):not([type='file']),
textarea,
select {
  font: inherit;
  box-sizing: border-box;
  min-width: 0;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--wf-line);
  border-radius: 6px;
  background: var(--color-paper, #fff);
  color: var(--wf-ink);
}
input[type='checkbox'],
input[type='radio'] {
  accent-color: var(--wf-accent);
  flex: none;
}
textarea {
  resize: vertical;
}
input:focus,
textarea:focus,
select:focus,
button:focus-visible {
  outline: 2px solid var(--wf-accent);
  outline-offset: 2px;
}
fieldset {
  min-width: 0;
  margin: 0;
}
fieldset:not(.card) {
  border: 0;
  padding: 0;
}
.field {
  display: grid;
  gap: 6px;
  margin-bottom: 14px;
}
.field > span {
  font-size: 12px;
  font-weight: 700;
}
.field small {
  font-size: 11px;
  color: var(--wf-muted);
}
.grid {
  display: grid;
  gap: 14px;
}
.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.section-title h3 {
  margin: 0;
}
.pill {
  display: inline-flex;
  padding: 4px 9px;
  border: 1px solid var(--wf-line);
  border-radius: 20px;
  font-size: 11px;
  white-space: nowrap;
  color: var(--wf-accent);
}
.workflow-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  border-bottom: 1px solid var(--wf-line);
  margin-bottom: 20px;
  padding-bottom: 8px;
}
.workflow-nav button {
  border: 0;
  background: transparent;
}
.workflow-nav .active {
  background: var(--wf-accent);
  color: var(--color-paper, #fff);
}
.count {
  font-size: 10px;
  margin-left: 4px;
}
.check-list {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 16px 0;
  color: var(--wf-muted);
}
.check-list label {
  display: flex;
  gap: 7px;
  align-items: center;
  color: var(--wf-ink);
}
.checked {
  color: var(--wf-accent);
}
.checkbox {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
}
.checkbox small {
  color: var(--wf-muted);
  margin-left: auto;
}
.feedback,
.confirmation {
  padding: 14px 16px;
  border: 1px solid var(--wf-line);
  border-left: 4px solid var(--wf-accent);
  border-radius: 8px;
  margin-bottom: 16px;
  background: var(--color-paper, #fff);
}
.error {
  border-left-color: var(--color-tx-1, #152033);
  font-weight: 650;
}
.confirmation button {
  margin-right: 8px;
}
.empty-state {
  text-align: center;
  padding: 32px;
  max-width: 760px;
  margin: auto;
}
.empty-state p {
  color: var(--wf-muted);
  margin: 12px 0 20px;
}
.document-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 14px 0;
  border: 0;
  border-bottom: 1px solid var(--wf-line);
  border-radius: 0;
  text-align: left;
}
.document-link small {
  display: block;
  margin-top: 5px;
  color: var(--wf-muted);
}
.table-scroll {
  overflow: auto;
  margin: 16px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  border: 1px solid var(--wf-line);
  padding: 8px;
  text-align: left;
}
th {
  font-weight: 700;
  white-space: nowrap;
  background: var(--color-paper, #f3f6fa);
}
.task-table {
  min-width: 1020px;
}
.task-table td:nth-child(2) {
  min-width: 160px;
}
.task-table td:nth-child(6),
.task-table td:nth-child(7) {
  width: 72px;
}
.task-table td:nth-child(3) {
  min-width: 100px;
}
.task-table td:nth-child(4),
.task-table td:nth-child(5) {
  min-width: 130px;
}
.task-table button {
  padding: 5px 7px;
  white-space: nowrap;
}
.reorder {
  display: flex;
  align-items: center;
  gap: 4px;
}
.text-button {
  padding: 4px !important;
  font-size: 11px !important;
  border: 0;
  color: var(--wf-accent);
  background: transparent;
}
.task-details {
  padding: 16px;
  background: var(--color-paper, #f3f6fa);
  border: 1px solid var(--wf-line);
  border-radius: 8px;
}
.task-details .grid {
  margin-top: 12px;
}
.documents-layout {
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.document-nav {
  padding: 14px;
  position: sticky;
  top: 80px;
}
.doc-nav-item {
  display: grid;
  gap: 5px;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 6px;
  padding: 12px 8px;
  margin-top: 8px;
}
.doc-nav-item small {
  font-size: 10px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.doc-nav-item span {
  font-size: 10px;
  color: var(--wf-muted);
}
.doc-nav-item.selected {
  outline: 1px solid var(--wf-accent);
  color: var(--wf-accent);
}
.document-main {
  min-width: 0;
}
.version-list {
  justify-content: flex-start;
}
.attachments,
.ai-editor {
  padding-top: 18px;
  margin-top: 16px;
  border-top: 1px solid var(--wf-line);
}
.attachments input[type='file'] {
  max-width: 100%;
  font-size: 12px;
}
.ai-editor summary {
  cursor: pointer;
  font-weight: 700;
  margin-bottom: 12px;
}
.decision {
  border-color: var(--wf-accent);
}
.workflow-print {
  display: none;
}
@media (max-width: 900px) {
  .workflow-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .documents-layout {
    grid-template-columns: 1fr;
  }
  .document-nav {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .document-nav > .stack {
    grid-column: 1/-1;
  }
  .two,
  .three {
    grid-template-columns: 1fr;
  }
  .card {
    padding: 16px;
  }
  .section-title {
    align-items: flex-start;
    flex-wrap: wrap;
  }
}
@media print {
  :global(body:has(> .workflow-print) > *:not(.workflow-print)) {
    display: none !important;
  }
  .workflow-print {
    display: block !important;
    width: 100%;
    background: white;
  }
  @page {
    size: A4;
    margin: 14mm;
  }
}
</style>
