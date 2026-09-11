<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_DOC_FIELDS,
  DEVELOP_DOC_TYPE_LABELS,
  developDocContentRows,
  developDocDecisionLabel,
  developDocStatusLabel,
} from '@sp/api-contract';
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import { apiErrorMessage, canPreview } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { useAdminDevelopDocumentRevise } from '../../../admin/useAdminDevelop';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { downloadAdminDevelopFile } from './develop-files';
import { developDocRows } from './develop-doc-edit';

// 문서 읽기 뷰(발송 이후) — 발송이 판을 고정하므로 여기서는 못 고친다. 고치려면 「새 판 만들기」.
// 인쇄는 이 카드 하나만 남긴다(프로토타입 @media print) — 상세 페이지의 다른 요소를 일일이
// print:hidden 으로 칠하는 대신, 인쇄 순간에만 문서 root 에 클래스를 붙여 나머지를 숨긴다.
const props = defineProps<{ doc: AdminDevelopDocumentViewType }>();
const emit = defineEmits<{ preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const revise = useAdminDevelopDocumentRevise();

const notice = ref('');
const noticeError = ref(false);
const mailOpen = ref(false);
const cardEl = ref<HTMLElement | null>(null);

const fields = computed(() => DEVELOP_DOC_FIELDS[props.doc.type]);
// 표가 아닌 필드는 계약의 표시 행(빈 값은 이미 빠져 있다)을 그대로 쓴다.
const textRows = computed(() => new Map(developDocContentRows(props.doc.type, props.doc.content).map((r) => [r.key, r])));
const tableRows = (key: string): Record<string, string>[] =>
  developDocRows(props.doc.content, key).filter((row) => Object.values(row).some((c) => c.trim() !== ''));
const cellText = (row: Record<string, string>, colKey: string, options: readonly { code: string; label: string }[] | undefined): string => {
  const raw = row[colKey] ?? '';
  if (options === undefined) return raw;
  return options.find((o) => o.code === raw)?.label ?? raw;
};
const hasBody = computed(() => textRows.value.size > 0 || fields.value.some((f) => f.kind === 'table' && tableRows(f.key).length > 0));

async function onRevise(): Promise<void> {
  notice.value = '';
  try {
    await revise.mutateAsync(props.doc.documentId);
    noticeError.value = false;
    notice.value = t('admin.develop.docs.view.revised');
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.docs.view.reviseFail'), {
      DOC_DRAFT_EXISTS: t('admin.develop.docs.view.errDraftExists'),
      DOC_IS_DRAFT: t('admin.develop.docs.view.errIsDraft'),
    });
  }
}

async function onDownload(fileId: number, name: string): Promise<void> {
  notice.value = '';
  try {
    await downloadAdminDevelopFile(fileId, name);
  } catch (error) {
    noticeError.value = true;
    notice.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}

function onPrint(): void {
  // 카드 머리(문서번호·종류·상태)까지 인쇄되도록 그 판의 카드를 대상으로 삼는다(없으면 본문만).
  const el = cardEl.value?.closest('[id^="develop-doc-"]') ?? cardEl.value;
  if (el === null) return;
  el.classList.add('sp-doc-print-target');
  document.documentElement.classList.add('sp-doc-printing');
  const cleanup = (): void => {
    el.classList.remove('sp-doc-print-target');
    document.documentElement.classList.remove('sp-doc-printing');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 2000); // afterprint 를 안 쏘는 브라우저 대비
}
</script>

<template>
  <div ref="cardEl" class="grid gap-2.5">
    <dl v-if="hasBody" class="grid gap-2 lg:grid-cols-2">
      <template v-for="f in fields" :key="f.key">
        <div v-if="f.kind === 'table' && tableRows(f.key).length > 0" class="grid gap-0.5 lg:col-span-2">
          <dt class="text-[11px] font-semibold text-gray-500">{{ f.label }}</dt>
          <dd class="overflow-x-auto rounded border border-gray-200">
            <table class="w-full min-w-[420px] border-collapse text-xs">
              <thead>
                <tr class="border-b border-gray-200 bg-gray-50 text-left text-[11px] text-gray-500">
                  <th v-for="c in f.columns ?? []" :key="c.key" class="px-2 py-1 font-semibold">{{ c.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, index) in tableRows(f.key)" :key="index" class="border-b border-gray-100">
                  <td v-for="c in f.columns ?? []" :key="c.key" class="px-2 py-1 text-gray-800">{{ cellText(row, c.key, c.options) }}</td>
                </tr>
              </tbody>
            </table>
          </dd>
        </div>
        <div v-else-if="textRows.get(f.key) !== undefined" class="grid gap-0.5">
          <dt class="text-[11px] font-semibold text-gray-500">{{ f.label }}</dt>
          <dd class="whitespace-pre-line text-xs leading-relaxed text-gray-800">{{ textRows.get(f.key)?.text }}</dd>
        </div>
      </template>
    </dl>
    <p v-else class="text-xs text-gray-400">{{ t('admin.develop.docs.view.empty') }}</p>

    <!-- 첨부 -->
    <ul v-if="doc.files.length > 0" class="grid gap-1">
      <li v-for="f in doc.files" :key="f.fileId" class="flex min-w-0 items-center gap-2 rounded border border-gray-100 bg-gray-50/60 px-2 py-1 text-xs">
        <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
        <span class="shrink-0 text-gray-400">{{ formatBytes(f.size) }}</span>
        <button v-if="canPreview(f)" type="button" class="shrink-0 font-bold text-gray-600 hover:text-gray-900 print:hidden" @click="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })">
          {{ t('admin.develop.content.preview') }}
        </button>
        <button type="button" class="shrink-0 font-bold text-blue-600 hover:text-blue-700 print:hidden" @click="onDownload(f.fileId, f.name)">
          {{ t('admin.develop.content.download') }}
        </button>
      </li>
    </ul>

    <!-- 결정 결과 -->
    <div v-if="doc.decision !== null" class="rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-xs">
      <p class="font-bold text-emerald-800">
        {{ developDocDecisionLabel(doc.type, doc.decision) }}
        <span class="ml-1 font-normal text-gray-600">{{ developDocStatusLabel(doc.type, doc.status) }}</span>
      </p>
      <p class="mt-0.5 text-gray-600">
        {{ doc.decidedName ?? '' }}
        <template v-if="doc.decidedAt !== null"> · {{ formatDateTime(doc.decidedAt) }}</template>
      </p>
      <p v-if="doc.decisionNote !== null && doc.decisionNote !== ''" class="mt-1 whitespace-pre-line leading-relaxed text-gray-800">{{ doc.decisionNote }}</p>
    </div>

    <!-- 내부 메모(고객 비공개) -->
    <p v-if="doc.internalNote !== null && doc.internalNote !== ''" class="rounded border border-gray-200 bg-gray-50 p-2 text-[11px] whitespace-pre-line text-gray-600 print:hidden">
      <b>{{ t('admin.develop.docs.editor.internalNote') }}</b> · {{ doc.internalNote }}
    </p>

    <!-- 메일 확인본 -->
    <div v-if="doc.mailSubject !== null" class="rounded border border-gray-200 print:hidden">
      <button type="button" class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-bold text-gray-600" @click="mailOpen = !mailOpen">
        {{ t('admin.develop.docs.view.mail') }}
        <span class="ml-auto font-normal text-gray-400">{{ mailOpen ? t('admin.develop.side.memoClose') : t('admin.develop.side.memoOpen') }}</span>
      </button>
      <div v-if="mailOpen" class="border-t border-gray-100 px-2 py-1.5 text-xs">
        <p class="font-semibold text-gray-800">{{ doc.mailSubject }}</p>
        <p class="mt-1 whitespace-pre-line leading-relaxed text-gray-700">{{ doc.mailBody ?? '' }}</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 print:hidden">
      <span class="text-[11px] text-gray-400">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }} · {{ doc.docNo }} v{{ doc.version }}</span>
      <button type="button" class="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs font-bold text-gray-700 hover:bg-gray-50" @click="onPrint">
        {{ t('admin.develop.docs.view.print') }}
      </button>
      <button
        v-if="doc.isCurrent"
        type="button"
        class="rounded-md border border-blue-300 px-2.5 py-1 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
        :disabled="revise.isPending.value"
        @click="onRevise"
      >
        {{ t('admin.develop.docs.view.revise') }}
      </button>
    </div>
    <p v-if="notice !== ''" class="text-xs font-semibold print:hidden" :class="noticeError ? 'text-red-600' : 'text-emerald-700'">{{ notice }}</p>
  </div>
</template>

<style>
/* 인쇄 격리 — 인쇄를 누른 문서 카드만 남긴다(관리자 상세의 헤더·탭·다른 카드는 숨김).
   전역 스타일이지만 sp-doc-printing 클래스가 붙은 인쇄 순간에만 작동한다. */
@media print {
  html.sp-doc-printing body * {
    visibility: hidden;
  }
  html.sp-doc-printing .sp-doc-print-target,
  html.sp-doc-printing .sp-doc-print-target * {
    visibility: visible;
  }
  html.sp-doc-printing .sp-doc-print-target {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
}
</style>
