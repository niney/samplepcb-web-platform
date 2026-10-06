<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon, CopyPlusIcon, PrinterIcon } from '@lucide/vue';
import { DEVELOP_DOC_TYPE_LABELS, developDocDecisionLabel, developDocStatusLabel } from '@sp/api-contract';
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { useAdminDevelopDocumentRevise } from '@/admin/useAdminDevelop';
import { downloadAdminDevelopFile } from '@/components/admin/develop/develop-files';
import { formatDateTime } from '@/lib/format';
import { usePrintIsolation } from '@/lib/usePrintIsolation';
import Panel from '@/next/components/common/Panel.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import DevelopDocFileList from './DevelopDocFileList.vue';
import { developDocDecisionAlert, developDocViewBlocks } from './doc-view-model';
import DevelopDocPrintDoc from './print/DevelopDocPrintDoc.vue';

// 문서 읽기 뷰(발송 이후) — 옛 components/admin/develop/DevelopDocView.vue 의 짝(같은 props·emits·새 판 요청).
// 발송이 판을 고정하므로 여기서는 못 고친다. 고치려면 「새 판 만들기」.
// 인쇄: 옛 화면은 SFC 전역 <style> 로 카드만 남겼다 — 여기서는 인쇄 순간에만 body 직속 인쇄 호스트(print/DevelopDocPrintDoc)를
// 띄우고 usePrintIsolation 으로 그 호스트 밖을 숨긴다(규칙은 인쇄하는 동안만 문서에 존재 — 다른 인쇄를 깨지 않는다).
// 인쇄 문서는 밝은 바탕 고정이라 다크 화면에서 눌러도 종이는 같다.
const props = defineProps<{ doc: AdminDevelopDocumentViewType }>();
const emit = defineEmits<{ preview: [file: PreviewTarget] }>();

const { t } = useI18n();
const revise = useAdminDevelopDocumentRevise();

const notice = ref('');
const noticeError = ref(false);
const mailOpen = ref(false);
const printing = ref(false);

const blocks = computed(() => developDocViewBlocks(props.doc));
const statusDiffers = computed(
  () =>
    props.doc.decision !== null &&
    developDocStatusLabel(props.doc.type, props.doc.status) !== developDocDecisionLabel(props.doc.type, props.doc.decision),
);

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

const PRINT_STYLE_ID = 'sp-develop-doc-print';
const PRINT_CSS = `
@media print {
  body { overflow: visible !important; padding-right: 0 !important; }
  body > :not([data-develop-doc-print-host]) { display: none !important; }
}
`;
usePrintIsolation(PRINT_STYLE_ID, PRINT_CSS, printing);

async function onPrint(): Promise<void> {
  printing.value = true;
  await nextTick(); // 인쇄 호스트 마운트 + 격리 규칙 주입이 끝난 뒤 인쇄 대화상자를 연다
  const cleanup = (): void => {
    printing.value = false;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  window.setTimeout(cleanup, 2000); // afterprint 를 안 쏘는 브라우저 대비
}
</script>

<template>
  <div class="grid gap-3">
    <dl v-if="blocks.length > 0" class="grid gap-3 lg:grid-cols-2">
      <template v-for="b in blocks" :key="b.key">
        <div v-if="b.kind === 'table'" class="grid gap-1 lg:col-span-2">
          <dt class="text-muted-foreground text-xs font-medium">{{ b.label }}</dt>
          <dd>
            <TableCard>
              <Table class="min-w-105">
                <TableHeader>
                  <TableRow>
                    <TableHead v-for="c in b.columns" :key="c.key">{{ c.label }}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(cells, index) in b.rows" :key="index">
                    <TableCell v-for="(cell, ci) in cells" :key="ci">{{ cell }}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableCard>
          </dd>
        </div>
        <div v-else class="grid gap-0.5">
          <dt class="text-muted-foreground text-xs font-medium">{{ b.label }}</dt>
          <dd class="text-sm leading-relaxed whitespace-pre-line">{{ b.text }}</dd>
        </div>
      </template>
    </dl>
    <p v-else class="text-muted-foreground text-sm">{{ t('admin.develop.docs.view.empty') }}</p>

    <!-- 첨부 -->
    <DevelopDocFileList :files="doc.files" @preview="emit('preview', $event)" @download="onDownload" />

    <!-- 결정 결과 -->
    <Alert v-if="doc.decision !== null" :variant="developDocDecisionAlert(doc.decision)" size="sm">
      <AlertTitle>
        {{ developDocDecisionLabel(doc.type, doc.decision) }}
        <!-- 결정 뒤 상태 라벨이 결정 라벨과 같으면(대부분) 한 번만 쓴다 — 다를 때(이후 대체됨 등)만 덧붙인다. -->
        <span v-if="statusDiffers" class="text-muted-foreground ml-1 font-normal">{{ developDocStatusLabel(doc.type, doc.status) }}</span>
      </AlertTitle>
      <AlertDescription>
        <p class="tabular-nums">
          {{ doc.decidedName ?? '' }}
          <template v-if="doc.decidedAt !== null"> · {{ formatDateTime(doc.decidedAt) }}</template>
        </p>
        <p v-if="doc.decisionNote !== null && doc.decisionNote !== ''" class="text-foreground mt-1 leading-relaxed whitespace-pre-line">
          {{ doc.decisionNote }}
        </p>
      </AlertDescription>
    </Alert>

    <!-- 내부 메모(고객 비공개) -->
    <Panel v-if="doc.internalNote !== null && doc.internalNote !== ''" size="xs" tone="muted" class="text-xs whitespace-pre-line">
      <b>{{ t('admin.develop.docs.editor.internalNote') }}</b> · {{ doc.internalNote }}
    </Panel>

    <!-- 메일 확인본 -->
    <Panel v-if="doc.mailSubject !== null" size="xs">
      <Button variant="ghost" size="xs" class="w-full justify-between" :aria-expanded="mailOpen" @click="mailOpen = !mailOpen">
        {{ t('admin.develop.docs.view.mail') }}
        <span class="text-muted-foreground inline-flex items-center gap-1 font-normal">
          {{ mailOpen ? t('admin.develop.side.memoClose') : t('admin.develop.side.memoOpen') }}
          <component :is="mailOpen ? ChevronUpIcon : ChevronDownIcon" class="size-3.5" />
        </span>
      </Button>
      <div v-if="mailOpen" class="mt-1 border-t px-2 pt-2 pb-1 text-sm">
        <p class="font-medium">{{ doc.mailSubject }}</p>
        <p class="text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">{{ doc.mailBody ?? '' }}</p>
      </div>
    </Panel>

    <div class="flex flex-wrap items-center gap-2 border-t pt-3">
      <span class="text-muted-foreground text-xs">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }} · {{ doc.docNo }} v{{ doc.version }}</span>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" @click="onPrint">
          <PrinterIcon />
          {{ t('admin.develop.docs.view.print') }}
        </Button>
        <Button v-if="doc.isCurrent" variant="outline" size="sm" :disabled="revise.isPending.value" @click="onRevise">
          <CopyPlusIcon />
          {{ t('admin.develop.docs.view.revise') }}
        </Button>
      </div>
    </div>
    <p v-if="notice !== ''" class="text-sm font-medium" :class="noticeError ? 'text-destructive' : 'text-success'">{{ notice }}</p>

    <!-- 인쇄 호스트 — 인쇄하는 동안만 body 직속으로 붙는다(화면에는 안 보인다). -->
    <Teleport v-if="printing" to="body">
      <div data-develop-doc-print-host class="hidden print:block">
        <DevelopDocPrintDoc :doc="doc" />
      </div>
    </Teleport>
  </div>
</template>
