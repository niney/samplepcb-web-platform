<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RefreshCwIcon, SendIcon, SparklesIcon, XIcon } from '@lucide/vue';
import {
  DEVELOP_DOC_MAIL_BODY_MAX,
  DEVELOP_DOC_MAIL_SUBJECT_MAX,
  DevelopDocMailResult,
  buildDevelopDocMailDraft,
  developDocContentRows,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopDocContentType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopDocMailRun, useAdminDevelopDocumentSend } from '@/admin/useAdminDevelop';
import { useAiJob } from '@/admin/useAdminSettings';
import { confirmDialog } from '@/next/lib/dialog';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { Textarea } from '@/next/components/ui/textarea';

// 발송 패널(docs/DEVELOP_FLOW.md §13) — 옛 components/admin/develop/DevelopDocSendPanel.vue 의 짝(같은 props·emits·발송 본문).
// 왼쪽 문서 미리보기, 오른쪽 고객 메일. 메일 초안은 계약 순수 함수(buildDevelopDocMailDraft)가 정본이고, AI(develop.doc-mail)는
// 그 초안을 다듬는 선택지다(사용자 결정 6: 관리자가 확인한 글이 그대로 나간다). AI 결과는 확인 뒤에만 덮는다.
// 회신 요청일이 바뀌어도 자동으로 다시 만들지 않는다 — 편집 중인 글을 덮지 않기 위해서(버튼으로만).
// 발송 확인은 옛 화면의 인라인 확인 → 확인 대화상자(제목·요약·'발송' 버튼 이름 같음).
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
const idPrefix = computed(() => `doc-send-${String(props.doc.documentId)}`);

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
      notice.value = t('admin.develop.docs.send.aiFailed');
      jobId.value = null;
      return;
    }
    if (value.status !== 'done') return;
    const parsed = DevelopDocMailResult.safeParse(value.docMail);
    jobId.value = null;
    if (!parsed.success) {
      noticeError.value = true;
      notice.value = t('admin.develop.docs.send.aiFailed');
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
    notice.value = apiErrorMessage(error, t('admin.develop.docs.send.aiFailed'), {
      USECASE_DISABLED: t('admin.develop.docs.send.aiDisabled'),
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
  notice.value = t('admin.develop.docs.send.aiApplied');
}

// ── 발송 ─────────────────────────────────────────────────────────────────────
const canSend = computed(() => subject.value.trim() !== '' && body.value.trim() !== '' && !send.isPending.value);
const recipientText = computed(() =>
  sendMail.value ? (props.customerEmail ?? t('admin.develop.docs.send.noEmail')) : t('admin.develop.docs.send.noMail'),
);

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
    emit('close');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.docs.send.sendFail'), {
      EMPTY_DOCUMENT: t('admin.develop.docs.editor.errEmptyDocument'),
      DOC_NOT_DRAFT: t('admin.develop.docs.editor.errNotDraft'),
      INVALID_TRANSITION: t('admin.develop.docs.send.errTransition'),
    });
  }
}

async function onSubmit(): Promise<void> {
  confirming.value = true;
  const summary = [props.doc.docNo, recipientText.value];
  if (props.replyDueOn !== null) summary.push(t('admin.develop.docs.status.replyDue', { date: props.replyDueOn }));
  const ok = await confirmDialog({
    title: t('admin.develop.docs.send.confirmTitle'),
    message: summary.join(' · '),
    confirmLabel: t('admin.develop.docs.send.confirmOk'),
    cancelLabel: t('admin.develop.cancel'),
  });
  if (ok) await onSend();
  confirming.value = false;
}
</script>

<template>
  <Panel size="md" tone="muted" class="grid gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-semibold">{{ t('admin.develop.docs.send.title', { docNo: doc.docNo }) }}</h3>
      <Button variant="ghost" size="xs" class="ml-auto" @click="emit('close')">
        <XIcon />
        {{ t('admin.develop.docs.send.close') }}
      </Button>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      <!-- 문서 미리보기 -->
      <Panel tone="card" class="self-start">
        <p class="text-muted-foreground text-xs font-semibold">{{ t('admin.develop.docs.send.preview') }}</p>
        <dl v-if="rows.length > 0" class="mt-2 grid gap-2 text-sm">
          <div v-for="row in rows" :key="row.key" class="grid gap-0.5">
            <dt class="text-muted-foreground text-xs font-medium">{{ row.label }}</dt>
            <dd class="leading-relaxed whitespace-pre-line">{{ row.text }}</dd>
          </div>
        </dl>
        <p v-else class="text-muted-foreground mt-2 text-xs">{{ t('admin.develop.docs.send.previewEmpty') }}</p>
      </Panel>

      <!-- 메일 -->
      <div class="grid content-start gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="xs" @click="rebuild">
            <RefreshCwIcon />
            {{ t('admin.develop.docs.send.rebuild') }}
          </Button>
          <Button variant="outline" size="xs" :disabled="aiRunning" @click="onAi">
            <SparklesIcon />
            {{ aiRunning ? t('admin.develop.docs.send.aiRunning') : t('admin.develop.docs.send.ai') }}
          </Button>
        </div>

        <Alert v-if="aiDraft !== null" variant="info" size="sm">
          <AlertTitle>{{ t('admin.develop.docs.send.aiConfirm') }}</AlertTitle>
          <AlertDescription>
            <p class="text-foreground whitespace-pre-line">{{ aiDraft.subject }}</p>
            <div class="mt-2 flex justify-end gap-2">
              <Button variant="outline" size="xs" @click="aiDraft = null">{{ t('admin.develop.cancel') }}</Button>
              <Button size="xs" @click="applyAi">{{ t('admin.develop.docs.send.aiApply') }}</Button>
            </div>
          </AlertDescription>
        </Alert>

        <div class="grid gap-1.5">
          <Label :for="`${idPrefix}-subject`">{{ t('admin.develop.docs.send.subject') }}</Label>
          <Input :id="`${idPrefix}-subject`" v-model="subject" :maxlength="DEVELOP_DOC_MAIL_SUBJECT_MAX" />
        </div>
        <div class="grid gap-1.5">
          <Label :for="`${idPrefix}-body`">{{ t('admin.develop.docs.send.body') }}</Label>
          <Textarea :id="`${idPrefix}-body`" v-model="body" rows="10" :maxlength="DEVELOP_DOC_MAIL_BODY_MAX" />
        </div>

        <div class="flex flex-wrap items-center gap-2 text-sm">
          <Checkbox :id="`${idPrefix}-sendMail`" :model-value="sendMail" @update:model-value="(v) => (sendMail = v === true)" />
          <Label :for="`${idPrefix}-sendMail`">{{ t('admin.develop.docs.send.sendMail') }}</Label>
          <span class="text-muted-foreground">{{ customerEmail ?? t('admin.develop.docs.send.noEmail') }}</span>
        </div>
        <p v-if="replyDueOn !== null" class="text-muted-foreground text-xs tabular-nums">
          {{ t('admin.develop.docs.status.replyDue', { date: replyDueOn }) }}
        </p>

        <div class="flex justify-end">
          <Button size="sm" :disabled="!canSend || confirming" @click="onSubmit">
            <SendIcon />
            {{ send.isPending.value ? t('admin.develop.saving') : t('admin.develop.docs.send.submit') }}
          </Button>
        </div>

        <p v-if="notice !== ''" class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">{{ notice }}</p>
      </div>
    </div>
  </Panel>
</template>
