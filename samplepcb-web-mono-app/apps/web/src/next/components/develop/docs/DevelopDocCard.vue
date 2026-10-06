<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
import { DEVELOP_DOC_TYPE_LABELS, developDocStatusLabel } from '@sp/api-contract';
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import type { PreviewTarget } from '@sp/ui';
import { formatDateTime } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import DevelopDocEditor from './DevelopDocEditor.vue';
import DevelopDocView from './DevelopDocView.vue';
import { developDocStatusVariant } from '@/next/components/develop/develop-badges';

// 문서 카드 한 장 = 같은 종류·번호(docNo)의 한 판(옛 components/admin/develop/DevelopDocCard.vue 의 짝).
// 최신 판이 위, 이전 판은 접어 둔다. draft 면 편집기, 발송 뒤면 읽기 뷰다(발송이 판을 고정한다 — 고치려면 새 판).
// 카드·이전 판의 id(develop-doc-{documentId})는 현황 띠의 '문서로 가기' 스크롤 대상이다.
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
  <Panel :id="`develop-doc-${String(doc.documentId)}`" size="md" tone="card" class="scroll-mt-20">
    <header class="flex flex-wrap items-center gap-2">
      <span class="font-mono text-sm font-semibold">{{ doc.docNo }}</span>
      <span class="text-sm font-medium">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }}</span>
      <span class="text-muted-foreground text-xs tabular-nums">v{{ doc.version }}</span>
      <Badge :variant="developDocStatusVariant(doc.status)">{{ developDocStatusLabel(doc.type, doc.status) }}</Badge>
      <Badge v-if="doc.approval" variant="outline">{{ t('admin.develop.docs.card.approval') }}</Badge>
      <span v-if="doc.sentAt !== null" class="text-muted-foreground text-xs tabular-nums">{{ formatDateTime(doc.sentAt) }}</span>
      <span v-if="doc.replyDueOn !== null" class="text-warning text-xs font-semibold tabular-nums">
        {{ t('admin.develop.docs.status.replyDue', { date: doc.replyDueOn }) }}
      </span>
      <span v-if="doc.files.length > 0" class="text-muted-foreground text-xs">{{ t('admin.develop.docs.card.files', { count: doc.files.length }) }}</span>
    </header>

    <div class="mt-3">
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

    <div v-if="older.length > 0" class="mt-3 border-t pt-2">
      <Button variant="ghost" size="xs" :aria-expanded="olderOpen" @click="olderOpen = !olderOpen">
        <component :is="olderOpen ? ChevronUpIcon : ChevronDownIcon" />
        {{ t('admin.develop.docs.card.older', { count: older.length }) }}
        <span class="text-muted-foreground">{{ olderOpen ? t('admin.develop.side.memoClose') : t('admin.develop.side.memoOpen') }}</span>
      </Button>
      <ul v-if="olderOpen" class="mt-2 grid gap-2">
        <li v-for="o in older" :id="`develop-doc-${String(o.documentId)}`" :key="o.documentId" class="scroll-mt-20">
          <Panel tone="muted">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-muted-foreground text-xs tabular-nums">v{{ o.version }}</span>
              <Badge :variant="developDocStatusVariant(o.status)">{{ developDocStatusLabel(o.type, o.status) }}</Badge>
              <span v-if="o.sentAt !== null" class="text-muted-foreground text-xs tabular-nums">{{ formatDateTime(o.sentAt) }}</span>
            </div>
            <div class="mt-2">
              <DevelopDocView :doc="o" @preview="emit('preview', $event)" />
            </div>
          </Panel>
        </li>
      </ul>
    </div>
  </Panel>
</template>
