<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_ADMIN_EVENT_TYPES,
  DEVELOP_EVENT_TYPE_LABELS,
  apiRoutes,
} from '@sp/api-contract';
import type { AdminDevelopEventPayloadType, DevelopEventViewType, DevelopRequestStatusType } from '@sp/api-contract';
import { apiGetBlob } from '@sp/shared';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopEventCreate } from '../../../admin/useAdminDevelop';
import { formatBytes, formatDateTime } from '../../../lib/format';

// 진행 타임라인 — 관리자는 비공개 이벤트까지 전부 본다(고객 화면은 visibleToCustomer 만).
// 작성 폼은 관리자가 직접 만드는 5종(note·comment·review_request·deliverable·tax_invoice).
// deliverable + final 은 상태 전이(in_progress → delivered)까지 일으키므로 서버가 상태를 검사한다.
const props = defineProps<{
  requestId: number;
  events: readonly DevelopEventViewType[];
  status: DevelopRequestStatusType;
}>();

const { t } = useI18n();
const create = useAdminDevelopEventCreate();

const type = ref<(typeof DEVELOP_ADMIN_EVENT_TYPES)[number]>('note');
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
    const blob = await apiGetBlob(`${apiRoutes.adminDevelopFiles}/${String(fileId)}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
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
  <section class="rounded-xl border border-gray-200 bg-white p-4">
    <h2 class="text-base font-bold text-gray-800">{{ t('admin.develop.timeline.title') }}</h2>

    <!-- 작성 폼 -->
    <form class="mt-3 grid gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3" @submit.prevent="onSubmit">
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="type" class="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs">
          <option v-for="et in DEVELOP_ADMIN_EVENT_TYPES" :key="et" :value="et">{{ DEVELOP_EVENT_TYPE_LABELS[et] }}</option>
        </select>
        <input
          v-model="title"
          type="text"
          :maxlength="200"
          :placeholder="t('admin.develop.timeline.titlePlaceholder')"
          class="h-9 min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 text-xs"
        >
      </div>
      <textarea
        v-model="body"
        rows="3"
        :maxlength="10000"
        :placeholder="t('admin.develop.timeline.bodyPlaceholder')"
        class="w-full rounded-md border border-gray-300 px-3 py-2 text-xs leading-relaxed"
      />

      <label v-if="type === 'note'" class="inline-flex items-center gap-1.5 text-sm text-gray-700">
        <input v-model="visibleToCustomer" type="checkbox">
        {{ t('admin.develop.timeline.visible') }}
      </label>

      <div v-if="type === 'deliverable'" class="flex flex-wrap items-center gap-3 text-sm text-gray-700">
        <label class="inline-flex items-center gap-1.5" :class="canDeliverFinal ? '' : 'text-gray-400'">
          <input v-model="isFinal" type="checkbox" :disabled="!canDeliverFinal">
          {{ t('admin.develop.timeline.final') }}
        </label>
        <label class="inline-flex items-center gap-1.5">
          <input v-model="isLocked" type="checkbox">
          {{ t('admin.develop.timeline.locked') }}
        </label>
        <span v-if="!canDeliverFinal" class="text-xs text-amber-700">{{ t('admin.develop.timeline.finalHint') }}</span>
      </div>

      <div v-if="type === 'tax_invoice'" class="grid gap-2 sm:grid-cols-2">
        <label class="grid gap-0.5 text-xs text-gray-600">
          {{ t('admin.develop.timeline.issuedAt') }}
          <input v-model="invoiceIssuedAt" type="date" class="h-9 rounded-md border border-gray-300 px-2 text-xs">
        </label>
        <label class="grid gap-0.5 text-xs text-gray-600">
          {{ t('admin.develop.timeline.memo') }}
          <input v-model="invoiceMemo" type="text" :maxlength="200" class="h-9 rounded-md border border-gray-300 px-2 text-xs">
        </label>
        <label class="grid gap-0.5 text-xs text-gray-600">
          {{ t('admin.develop.timeline.supplyAmount') }}
          <input v-model="invoiceSupply" type="text" inputmode="numeric" class="h-9 rounded-md border border-gray-300 px-2 text-xs">
        </label>
        <label class="grid gap-0.5 text-xs text-gray-600">
          {{ t('admin.develop.timeline.vatAmount') }}
          <input v-model="invoiceVat" type="text" inputmode="numeric" class="h-9 rounded-md border border-gray-300 px-2 text-xs">
        </label>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input ref="fileInput" type="file" multiple class="text-xs" @change="onPickFiles">
        <button
          type="submit"
          class="ml-auto rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="!canSubmit"
        >
          {{ create.isPending.value ? t('admin.develop.saving') : t('admin.develop.timeline.submit') }}
        </button>
      </div>
      <p v-if="notice !== ''" class="text-sm font-semibold" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
    </form>

    <!-- 이벤트 목록 -->
    <p v-if="downloadError !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ downloadError }}</p>
    <ul class="mt-4 grid gap-2">
      <li
        v-for="e in events"
        :key="e.eventId"
        class="rounded-lg border p-3 text-sm"
        :class="e.visibleToCustomer ? 'border-gray-100' : 'border-gray-200 bg-gray-50'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
            {{ DEVELOP_EVENT_TYPE_LABELS[e.type] }}
          </span>
          <span v-if="!e.visibleToCustomer" class="rounded-full bg-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-700">
            {{ t('admin.develop.timeline.internal') }}
          </span>
          <b class="min-w-0 truncate text-gray-800">{{ e.title }}</b>
          <span class="ml-auto shrink-0 text-xs text-gray-400">{{ e.actorName }} · {{ formatDateTime(e.createdAt) }}</span>
        </div>
        <p v-if="e.body !== null" class="mt-1.5 whitespace-pre-line leading-relaxed text-gray-700">{{ e.body }}</p>
        <dl v-if="payloadRows(e.payload).length > 0" class="mt-1.5 grid grid-cols-[112px_1fr] gap-y-0.5 text-xs text-gray-500">
          <template v-for="row in payloadRows(e.payload)" :key="row.key">
            <dt class="font-mono">{{ row.key }}</dt>
            <dd>{{ row.value }}</dd>
          </template>
        </dl>
        <ul v-if="e.files.length > 0" class="mt-1.5 grid gap-1">
          <li v-for="f in e.files" :key="f.fileId" class="flex min-w-0 items-center gap-2 rounded border border-gray-100 bg-white px-2 py-1">
            <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
            <span v-if="f.locked" class="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700">
              {{ t('admin.develop.timeline.lockedFile') }}
            </span>
            <span class="shrink-0 text-xs text-gray-400">{{ formatBytes(f.size) }}</span>
            <button type="button" class="shrink-0 font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
              {{ t('admin.develop.content.download') }}
            </button>
          </li>
        </ul>
      </li>
      <li v-if="events.length === 0" class="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400">
        {{ t('admin.develop.timeline.empty') }}
      </li>
    </ul>
  </section>
</template>
