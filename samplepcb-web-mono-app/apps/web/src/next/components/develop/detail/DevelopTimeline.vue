<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { PaperclipIcon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import { DEVELOP_ADMIN_EVENT_TYPES, DEVELOP_EVENT_TYPE_LABELS } from '@sp/api-contract';
import type { AdminDevelopEventPayloadType, DevelopEventViewType, DevelopRequestStatusType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { useAdminDevelopEventCreate } from '@/admin/useAdminDevelop';
import { downloadAdminDevelopFile } from '@/components/admin/develop/develop-files';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import ActionNotice from './ActionNotice.vue';
import DevelopFileRow from '@/next/components/develop/DevelopFileRow.vue';

// 진행 타임라인(옛 components/admin/develop/DevelopTimeline.vue 와 같은 props·emits·동작) — 관리자는 비공개 이벤트까지
// 전부 본다(고객 화면은 visibleToCustomer 만). 작성 폼은 관리자가 직접 만드는 5종(note·comment·review_request·
// deliverable·tax_invoice). deliverable + final 은 상태 전이(in_progress → delivered)까지 일으키므로 서버가 상태를 검사한다.
const props = defineProps<{
  requestId: number;
  events: readonly DevelopEventViewType[];
  status: DevelopRequestStatusType;
}>();
const emit = defineEmits<{ preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const create = useAdminDevelopEventCreate();

// 문서 이벤트(document_sent·document_decided, docs/DEVELOP_FLOW.md §13) — payload 의 문서번호를 제목 옆 칩으로 띄우고,
// 누르면 프로젝트 문서 탭의 그 카드(id develop-doc-{documentId})로 데려간다(탭 패널은 v-show 라 이미 마운트되어 있다).
const docChip = (payload: Record<string, unknown> | null): { docNo: string; documentId: number } | null => {
  if (payload === null) return null;
  const { docNo, documentId } = payload;
  if (typeof docNo !== 'string' || typeof documentId !== 'number') return null;
  return { docNo, documentId };
};

function openDocument(documentId: number): void {
  void router.replace({ query: { ...route.query, tab: 'documents' } }).then(async () => {
    await nextTick();
    document.getElementById(`develop-doc-${String(documentId)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

type AdminEventType = (typeof DEVELOP_ADMIN_EVENT_TYPES)[number];
const type = ref<AdminEventType>('note');
const title = ref('');
const body = ref('');
const visibleToCustomer = ref(true);
const isFinal = ref(false);
const isLocked = ref(false);
const invoiceIssuedAt = ref('');
const invoiceSupply = ref('');
const invoiceVat = ref('');
const invoiceMemo = ref('');
const files = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const notice = ref('');
const noticeError = ref(false);
const downloadError = ref('');

const onType = (value: AcceptableValue): void => {
  const hit = DEVELOP_ADMIN_EVENT_TYPES.find((et) => et === value);
  if (hit !== undefined) type.value = hit;
};

const canDeliverFinal = computed(() => props.status === 'in_progress' || props.status === 'delivered');
// 세금계산서는 원장 성격이라 발행일·금액만으로도 등록된다(서버도 payload 만 있으면 받는다).
// 나머지 종류는 제목·본문·첨부 중 하나가 있어야 EMPTY_EVENT 로 막히지 않는다.
const canSubmit = computed(() => {
  if (create.isPending.value) return false;
  if (type.value === 'tax_invoice') return invoiceIssuedAt.value.trim() !== '';
  return title.value.trim() !== '' || body.value.trim() !== '' || files.value.length > 0;
});

const onPickFiles = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  files.value = [...(input.files ?? [])];
};
const pickedNames = computed(() => files.value.map((f) => f.name).join(', '));

const resetForm = (): void => {
  title.value = '';
  body.value = '';
  files.value = [];
  isFinal.value = false;
  isLocked.value = false;
  invoiceIssuedAt.value = '';
  invoiceSupply.value = '';
  invoiceVat.value = '';
  invoiceMemo.value = '';
  if (fileInput.value !== null) fileInput.value.value = '';
};

const invoicePayload = (): Record<string, unknown> => ({
  issuedAt: invoiceIssuedAt.value,
  supplyAmount: Number(invoiceSupply.value.replace(/[^\d]/g, '')),
  vatAmount: Number(invoiceVat.value.replace(/[^\d]/g, '')),
  memo: invoiceMemo.value.trim(),
});

async function onSubmit(): Promise<void> {
  notice.value = '';
  const payload: AdminDevelopEventPayloadType = {
    type: type.value,
    title: title.value.trim(),
    body: body.value.trim(),
    // 고객 공개 토글은 진행 메모에서만 의미가 있다 — 문의 답변·확인 요청·산출물은 고객에게 가야 하고,
    // 세금계산서는 서버가 공개로 고정한다.
    visibleToCustomer: type.value === 'note' ? visibleToCustomer.value : true,
    final: type.value === 'deliverable' && isFinal.value,
    locked: type.value === 'deliverable' && isLocked.value,
    ...(type.value === 'tax_invoice' ? { payload: invoicePayload() } : {}),
  };
  try {
    await create.mutateAsync({ requestId: props.requestId, payload, files: files.value });
    noticeError.value = false;
    notice.value = t('admin.develop.timeline.created');
    resetForm();
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.timeline.createFail'), {
      EMPTY_EVENT: t('admin.develop.timeline.errorEmpty'),
      INVALID_TRANSITION: t('admin.develop.timeline.errorNotInProgress'),
      PAYLOAD_SCHEMA_MISMATCH: t('admin.develop.timeline.errorPayload'),
      FILE_UPLOAD_FAILED: t('admin.develop.timeline.errorUpload'),
    });
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  downloadError.value = '';
  try {
    await downloadAdminDevelopFile(fileId, name);
  } catch (error) {
    downloadError.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}

// payload 는 이벤트 종류마다 형태가 달라 화면은 "키: 값" 한 줄씩만 보인다(원장 확인용).
const payloadRows = (payload: Record<string, unknown> | null): { key: string; value: string }[] =>
  payload === null
    ? []
    : Object.entries(payload).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
</script>

<template>
  <SectionCard :title="t('admin.develop.timeline.title')">
    <div class="grid gap-4">
      <!-- 작성 폼 -->
      <Panel tone="muted">
        <form class="grid gap-2" @submit.prevent="onSubmit">
          <div class="flex flex-wrap items-center gap-2">
            <NativeSelect :model-value="type" aria-label="이벤트 종류" @update:model-value="onType">
              <NativeSelectOption v-for="et in DEVELOP_ADMIN_EVENT_TYPES" :key="et" :value="et">
                {{ DEVELOP_EVENT_TYPE_LABELS[et] }}
              </NativeSelectOption>
            </NativeSelect>
            <Input
              v-model="title"
              type="text"
              :maxlength="200"
              :placeholder="t('admin.develop.timeline.titlePlaceholder')"
              class="min-w-0 flex-1"
            />
          </div>
          <Textarea v-model="body" :rows="3" :maxlength="10000" :placeholder="t('admin.develop.timeline.bodyPlaceholder')" />

          <label v-if="type === 'note'" class="inline-flex w-fit items-center gap-2 text-sm">
            <Checkbox :model-value="visibleToCustomer" @update:model-value="(v) => (visibleToCustomer = v === true)" />
            {{ t('admin.develop.timeline.visible') }}
          </label>

          <div v-if="type === 'deliverable'" class="flex flex-wrap items-center gap-3 text-sm">
            <label class="inline-flex items-center gap-2" :class="canDeliverFinal ? '' : 'text-muted-foreground'">
              <Checkbox
                :model-value="isFinal"
                :disabled="!canDeliverFinal"
                @update:model-value="(v) => (isFinal = v === true)"
              />
              {{ t('admin.develop.timeline.final') }}
            </label>
            <label class="inline-flex items-center gap-2">
              <Checkbox :model-value="isLocked" @update:model-value="(v) => (isLocked = v === true)" />
              {{ t('admin.develop.timeline.locked') }}
            </label>
            <span v-if="!canDeliverFinal" class="text-warning text-xs">{{ t('admin.develop.timeline.finalHint') }}</span>
          </div>

          <div v-if="type === 'tax_invoice'" class="grid gap-2 sm:grid-cols-2">
            <label class="text-muted-foreground grid gap-1 text-xs">
              {{ t('admin.develop.timeline.issuedAt') }}
              <Input v-model="invoiceIssuedAt" type="date" class="tabular-nums" />
            </label>
            <label class="text-muted-foreground grid gap-1 text-xs">
              {{ t('admin.develop.timeline.memo') }}
              <Input v-model="invoiceMemo" type="text" :maxlength="200" />
            </label>
            <label class="text-muted-foreground grid gap-1 text-xs">
              {{ t('admin.develop.timeline.supplyAmount') }}
              <Input v-model="invoiceSupply" type="text" inputmode="numeric" class="text-right tabular-nums" />
            </label>
            <label class="text-muted-foreground grid gap-1 text-xs">
              {{ t('admin.develop.timeline.vatAmount') }}
              <Input v-model="invoiceVat" type="text" inputmode="numeric" class="text-right tabular-nums" />
            </label>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <input ref="fileInput" type="file" multiple class="hidden" @change="onPickFiles">
            <Button type="button" variant="outline" size="sm" @click="fileInput?.click()">
              <PaperclipIcon />
              파일 선택
            </Button>
            <span class="text-muted-foreground min-w-0 truncate text-xs" :title="pickedNames">
              {{ files.length > 0 ? pickedNames : '첨부 없음' }}
            </span>
            <Button type="submit" size="sm" class="ml-auto" :disabled="!canSubmit">
              {{ create.isPending.value ? t('admin.develop.saving') : t('admin.develop.timeline.submit') }}
            </Button>
          </div>
          <ActionNotice :text="notice" :error="noticeError" />
        </form>
      </Panel>

      <!-- 이벤트 목록 -->
      <ActionNotice :text="downloadError" error />
      <ul class="grid gap-2">
        <li v-for="e in props.events" :key="e.eventId">
          <Panel size="sm" :tone="e.visibleToCustomer ? 'default' : 'muted'" class="grid gap-1.5 text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{{ DEVELOP_EVENT_TYPE_LABELS[e.type] }}</Badge>
              <Badge v-if="!e.visibleToCustomer" variant="outline">{{ t('admin.develop.timeline.internal') }}</Badge>
              <Button
                v-if="docChip(e.payload) !== null"
                variant="outline"
                size="xs"
                @click="openDocument(docChip(e.payload)?.documentId ?? 0)"
              >
                <span class="font-mono">{{ docChip(e.payload)?.docNo }}</span>
              </Button>
              <b class="min-w-0 truncate">{{ e.title }}</b>
              <span class="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">
                {{ e.actorName }} · {{ formatDateTime(e.createdAt) }}
              </span>
            </div>
            <p v-if="e.body !== null" class="leading-relaxed whitespace-pre-line">{{ e.body }}</p>
            <dl v-if="payloadRows(e.payload).length > 0" class="text-muted-foreground grid grid-cols-[112px_1fr] gap-y-0.5 text-xs">
              <template v-for="row in payloadRows(e.payload)" :key="row.key">
                <dt class="font-mono">{{ row.key }}</dt>
                <dd class="break-all">{{ row.value }}</dd>
              </template>
            </dl>
            <ul v-if="e.files.length > 0" class="grid gap-1">
              <li v-for="f in e.files" :key="f.fileId">
                <DevelopFileRow
                  :file="f"
                  @preview="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })"
                  @download="void downloadFile(f.fileId, f.name)"
                />
              </li>
            </ul>
          </Panel>
        </li>
        <li v-if="props.events.length === 0" class="text-muted-foreground py-6 text-center text-sm">
          {{ t('admin.develop.timeline.empty') }}
        </li>
      </ul>
    </div>
  </SectionCard>
</template>
