<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_DOC_TYPE_LABELS, developDocStatusLabel } from '@sp/api-contract';
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import type { PreviewTarget } from '@sp/ui';
import { formatDateTime } from '../../../lib/format';
import DevelopDocEditor from './DevelopDocEditor.vue';
import DevelopDocView from './DevelopDocView.vue';
import { developDocStatusClass } from './develop-doc-edit';

// 문서 카드 한 장 = 같은 종류·번호(docNo)의 한 판. 최신 판이 위, 이전 판은 접어 둔다.
// draft 면 편집기, 발송 뒤면 읽기 뷰다(발송이 판을 고정한다 — 고치려면 새 판).
defineProps<{
  doc: AdminDevelopDocumentViewType;
  older: readonly AdminDevelopDocumentViewType[];
  requestTitle: string;
  customerName: string;
  customerCompany: string | null;
  customerEmail: string | null;
}>();
const emit = defineEmits<{ dirty: [value: boolean]; preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const olderOpen = ref(false);
</script>

<template>
  <article :id="`develop-doc-${String(doc.documentId)}`" class="rounded-lg border border-gray-200 bg-white p-3">
    <header class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-sm font-bold text-gray-900">{{ doc.docNo }}</span>
      <span class="text-sm font-semibold text-gray-700">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }}</span>
      <span class="text-xs text-gray-400">v{{ doc.version }}</span>
      <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="developDocStatusClass(doc.status)">
        {{ developDocStatusLabel(doc.type, doc.status) }}
      </span>
      <span v-if="doc.approval" class="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
        {{ t('admin.develop.docs.card.approval') }}
      </span>
      <span v-if="doc.sentAt !== null" class="text-xs text-gray-400">{{ formatDateTime(doc.sentAt) }}</span>
      <span v-if="doc.replyDueOn !== null" class="text-xs font-semibold text-amber-700">
        {{ t('admin.develop.docs.status.replyDue', { date: doc.replyDueOn }) }}
      </span>
      <span v-if="doc.files.length > 0" class="text-xs text-gray-400">{{ t('admin.develop.docs.card.files', { count: doc.files.length }) }}</span>
    </header>

    <div class="mt-2.5">
      <DevelopDocEditor
        v-if="doc.status === 'draft'"
        :doc="doc"
        :request-title="requestTitle"
        :customer-name="customerName"
        :customer-company="customerCompany"
        :customer-email="customerEmail"
        @dirty="emit('dirty', $event)"
        @preview="emit('preview', $event)"
      />
      <DevelopDocView v-else :doc="doc" @preview="emit('preview', $event)" />
    </div>

    <div v-if="older.length > 0" class="mt-2 border-t border-gray-100 pt-2 print:hidden">
      <button type="button" class="text-[11px] font-bold text-gray-500 hover:text-gray-800" @click="olderOpen = !olderOpen">
        {{ t('admin.develop.docs.card.older', { count: older.length }) }}
        <span class="ml-1 font-normal text-gray-400">{{ olderOpen ? t('admin.develop.side.memoClose') : t('admin.develop.side.memoOpen') }}</span>
      </button>
      <ul v-if="olderOpen" class="mt-2 grid gap-2">
        <li v-for="o in older" :id="`develop-doc-${String(o.documentId)}`" :key="o.documentId" class="rounded border border-gray-100 bg-gray-50/60 p-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-gray-500">v{{ o.version }}</span>
            <span class="rounded-full px-2 py-0.5 text-[11px] font-bold" :class="developDocStatusClass(o.status)">
              {{ developDocStatusLabel(o.type, o.status) }}
            </span>
            <span v-if="o.sentAt !== null" class="text-xs text-gray-400">{{ formatDateTime(o.sentAt) }}</span>
          </div>
          <div class="mt-1.5">
            <DevelopDocView :doc="o" @preview="emit('preview', $event)" />
          </div>
        </li>
      </ul>
    </div>
  </article>
</template>
