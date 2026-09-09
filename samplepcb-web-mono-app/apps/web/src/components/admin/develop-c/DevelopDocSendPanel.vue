<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_DOC_MAIL_BODY_MAX,
  DEVELOP_DOC_MAIL_SUBJECT_MAX,
  DevelopDocMailResult,
  buildDevelopDocMailDraft,
  developDocContentRows,
} from '@sp/api-contract/develop-c';
import type { AdminDevelopDocumentViewType, DevelopDocContentType } from '@sp/api-contract/develop-c';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopDocMailRun, useAdminDevelopDocumentSend } from '../../../admin/useAdminDevelopC';
import { useAiJob } from '../../../admin/useAdminSettings';

// 발송 패널(docs/DEVELOP_FLOW.md §13) — 왼쪽 문서 미리보기, 오른쪽 고객 메일.
// 메일 초안은 계약 순수 함수(buildDevelopDocMailDraft)가 정본이고, AI(develop.doc-mail)는 그 초안을
// 다듬는 선택지다(사용자 결정 6: 관리자가 확인한 글이 그대로 나간다). AI 결과는 인라인 확인 뒤에만 덮는다.
// 회신 요청일이 바뀌어도 자동으로 다시 만들지 않는다 — 편집 중인 글을 덮지 않기 위해서(버튼으로만).
const props = defineProps<{
  doc: AdminDevelopDocumentViewType;
  content: DevelopDocContentType;
  replyDueOn: string | null;
  requestTitle: string;
  customerName: string;
  customerCompany: string | null;
  customerEmail: string | null;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const send = useAdminDevelopDocumentSend();
const aiRun = useAdminDevelopDocMailRun();

const buildDraft = () =>
  buildDevelopDocMailDraft({
    type: props.doc.type,
    docNo: props.doc.docNo,
    requestTitle: props.requestTitle,
    customerName: props.customerName,
    customerCompany: props.customerCompany,
    replyDueOn: props.replyDueOn,
    content: props.content,
  });

const initial = buildDraft();
const subject = ref(initial.subject);
const body = ref(initial.body);
const sendMail = ref(true);
const confirming = ref(false);
const notice = ref('');
const noticeError = ref(false);

const rows = computed(() => developDocContentRows(props.doc.type, props.content));

function rebuild(): void {
  const draft = buildDraft();
  subject.value = draft.subject;
  body.value = draft.body;
  notice.value = '';
}

// ── AI 로 다듬기 ─────────────────────────────────────────────────────────────
const jobId = ref<string | null>(null);
const job = useAiJob(jobId);
const aiDraft = ref<{ subject: string; body: string } | null>(null);

const aiRunning = computed(() => aiRun.isPending.value || job.data.value?.data.status === 'running');

watch(
  () => job.data.value?.data,
  (value) => {
    if (value === undefined || jobId.value === null) return;
    if (value.status === 'error') {
      noticeError.value = true;
      notice.value = t('admin.developC.docs.send.aiFailed');
      jobId.value = null;
      return;
    }
    if (value.status !== 'done') return;
    const parsed = DevelopDocMailResult.safeParse(value.docMail);
    jobId.value = null;
    if (!parsed.success) {
      noticeError.value = true;
      notice.value = t('admin.developC.docs.send.aiFailed');
      return;
    }
    aiDraft.value = { subject: parsed.data.subject, body: parsed.data.body };
    notice.value = '';
  },
);

async function onAi(): Promise<void> {
  notice.value = '';
  aiDraft.value = null;
  try {
    const res = await aiRun.mutateAsync({ docId: props.doc.documentId, instructions: '' });
    jobId.value = res.data.jobId;
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.developC.docs.send.aiFailed'), {
      USECASE_DISABLED: t('admin.developC.docs.send.aiDisabled'),
    });
  }
}

function applyAi(): void {
  const draft = aiDraft.value;
  if (draft === null) return;
  subject.value = draft.subject;
  body.value = draft.body;
  aiDraft.value = null;
  noticeError.value = false;
  notice.value = t('admin.developC.docs.send.aiApplied');
}

// ── 발송 ─────────────────────────────────────────────────────────────────────
const canSend = computed(() => subject.value.trim() !== '' && body.value.trim() !== '' && !send.isPending.value);

async function onSend(): Promise<void> {
  notice.value = '';
  try {
    await send.mutateAsync({
      docId: props.doc.documentId,
      body: {
        replyDueOn: props.replyDueOn,
        mailSubject: subject.value.trim().slice(0, DEVELOP_DOC_MAIL_SUBJECT_MAX),
        mailBody: body.value.trim().slice(0, DEVELOP_DOC_MAIL_BODY_MAX),
        sendMail: sendMail.value,
      },
    });
    confirming.value = false;
    emit('close');
  } catch (error) {
    confirming.value = false;
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.developC.docs.send.sendFail'), {
      EMPTY_DOCUMENT: t('admin.developC.docs.editor.errEmptyDocument'),
      DOC_NOT_DRAFT: t('admin.developC.docs.editor.errNotDraft'),
      INVALID_TRANSITION: t('admin.developC.docs.send.errTransition'),
    });
  }
}
</script>

<template>
  <section class="rounded-lg border border-blue-200 bg-blue-50/40 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-bold text-gray-800">{{ t('admin.developC.docs.send.title', { docNo: doc.docNo }) }}</h3>
      <button type="button" class="ml-auto rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-bold text-gray-600" @click="emit('close')">
        {{ t('admin.developC.docs.send.close') }}
      </button>
    </div>

    <div class="mt-2 grid gap-3 lg:grid-cols-2">
      <!-- 문서 미리보기 -->
      <div class="rounded border border-gray-200 bg-white p-2.5">
        <p class="text-[11px] font-bold text-gray-500">{{ t('admin.developC.docs.send.preview') }}</p>
        <dl v-if="rows.length > 0" class="mt-1.5 grid gap-1 text-xs">
          <div v-for="row in rows" :key="row.key" class="grid gap-0.5">
            <dt class="font-semibold text-gray-500">{{ row.label }}</dt>
            <dd class="whitespace-pre-line leading-relaxed text-gray-800">{{ row.text }}</dd>
          </div>
        </dl>
        <p v-else class="mt-1.5 text-xs text-gray-400">{{ t('admin.developC.docs.send.previewEmpty') }}</p>
      </div>

      <!-- 메일 -->
      <div class="grid gap-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <button type="button" class="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-bold text-gray-700 hover:bg-gray-50" @click="rebuild">
            {{ t('admin.developC.docs.send.rebuild') }}
          </button>
          <button
            type="button"
            class="rounded border border-indigo-300 bg-white px-2 py-1 text-[11px] font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
            :disabled="aiRunning"
            @click="onAi"
          >
            {{ aiRunning ? t('admin.developC.docs.send.aiRunning') : t('admin.developC.docs.send.ai') }}
          </button>
        </div>

        <div v-if="aiDraft !== null" class="grid gap-1.5 rounded border border-indigo-200 bg-indigo-50 p-2 text-[11px] text-indigo-900">
          <span class="font-bold">{{ t('admin.developC.docs.send.aiConfirm') }}</span>
          <p class="whitespace-pre-line rounded border border-indigo-100 bg-white p-1.5 text-gray-700">{{ aiDraft.subject }}</p>
          <div class="flex gap-1.5">
            <button type="button" class="ml-auto rounded border border-indigo-300 bg-white px-2 py-1 font-bold" @click="aiDraft = null">
              {{ t('admin.developC.cancel') }}
            </button>
            <button type="button" class="rounded bg-indigo-600 px-2 py-1 font-bold text-white" @click="applyAi">
              {{ t('admin.developC.docs.send.aiApply') }}
            </button>
          </div>
        </div>

        <label class="grid gap-0.5 text-[11px] font-semibold text-gray-600">
          {{ t('admin.developC.docs.send.subject') }}
          <input v-model="subject" type="text" :maxlength="DEVELOP_DOC_MAIL_SUBJECT_MAX" class="h-8 w-full rounded border border-gray-300 px-2 text-xs">
        </label>
        <label class="grid gap-0.5 text-[11px] font-semibold text-gray-600">
          {{ t('admin.developC.docs.send.body') }}
          <textarea v-model="body" rows="10" :maxlength="DEVELOP_DOC_MAIL_BODY_MAX" class="w-full rounded border border-gray-300 px-2 py-1.5 text-xs leading-relaxed" />
        </label>

        <label class="inline-flex flex-wrap items-center gap-1.5 text-xs text-gray-700">
          <input v-model="sendMail" type="checkbox" class="h-3.5 w-3.5">
          {{ t('admin.developC.docs.send.sendMail') }}
          <span class="text-gray-400">{{ customerEmail ?? t('admin.developC.docs.send.noEmail') }}</span>
        </label>
        <p v-if="replyDueOn !== null" class="text-[11px] text-gray-500">
          {{ t('admin.developC.docs.status.replyDue', { date: replyDueOn }) }}
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="ml-auto rounded-md bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="!canSend || confirming"
            @click="confirming = true"
          >
            {{ t('admin.developC.docs.send.submit') }}
          </button>
        </div>

        <div v-if="confirming" class="grid gap-1.5 rounded border border-blue-300 bg-white p-2 text-[11px] text-gray-700">
          <span class="font-bold">{{ t('admin.developC.docs.send.confirmTitle') }}</span>
          <span>{{ doc.docNo }} · {{ sendMail ? (customerEmail ?? t('admin.developC.docs.send.noEmail')) : t('admin.developC.docs.send.noMail') }}
            <template v-if="replyDueOn !== null"> · {{ t('admin.developC.docs.status.replyDue', { date: replyDueOn }) }}</template>
          </span>
          <div class="flex gap-1.5">
            <button type="button" class="ml-auto rounded border border-gray-300 px-2 py-1 font-bold" @click="confirming = false">
              {{ t('admin.developC.cancel') }}
            </button>
            <button type="button" class="rounded bg-blue-600 px-2 py-1 font-bold text-white disabled:opacity-40" :disabled="send.isPending.value" @click="onSend">
              {{ send.isPending.value ? t('admin.developC.saving') : t('admin.developC.docs.send.confirmOk') }}
            </button>
          </div>
        </div>

        <p v-if="notice !== ''" class="text-xs font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
      </div>
    </div>
  </section>
</template>
