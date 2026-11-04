<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DownloadIcon, FileDownIcon } from '@lucide/vue';
import { developQuoteFileName } from '@sp/api-contract';
import type { DevelopQuoteSheetQuote, DevelopQuoteSheetRecipient } from '@sp/api-contract';
import { DevelopQuoteSheet, apiErrorMessage, downloadElementsPdf } from '@sp/ui';
import { downloadAdminDevelopQuoteXlsx } from '@/admin/useAdminDevelop';
import { Button } from '@/next/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogScrollContent, DialogTitle } from '@/next/components/ui/dialog';

// 견적서 미리보기(docs/DEVELOP_FLOW.md §5.1) — 고객이 받는 1쪽(@sp/ui DevelopQuoteSheet)을 관리자 화면에서 그대로 본다.
// 편집기는 저장 전 폼으로(developQuotePreview), 카드는 저장된 견적으로 연다. 저장된 견적이면 엑셀(작성 중 포함)도 받는다.
// PDF(2026-11-04)는 이 1쪽을 그대로 찍어 내려받는다(@sp/ui downloadElementsPdf — 저장 전 미리보기도 된다, 이름의 견적번호
// 자리는 '발송 전'). 카드의 「PDF」는 autoPdf 로 열어 그려지자마자 한 번 내려받는다. 부모가 v-if 로 마운트를 제어한다.
const props = defineProps<{
  quote: DevelopQuoteSheetQuote;
  recipient: DevelopQuoteSheetRecipient;
  quoteNo: string;
  issuedOn: string;
  // 엑셀을 받을 저장된 견적(없으면 버튼이 안 뜬다) — 이름은 서버와 같은 계약 developQuoteXlsxName.
  xlsx: { quoteId: number; title: string; requestId: number; version: number } | null;
  autoPdf?: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const busy = ref(false);
const error = ref('');
async function onXlsx(): Promise<void> {
  const target = props.xlsx;
  if (target === null || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await downloadAdminDevelopQuoteXlsx(target);
  } catch (e) {
    error.value = apiErrorMessage(e, t('admin.develop.quote.xlsxFail'));
  } finally {
    busy.value = false;
  }
}

const sheetBox = ref<HTMLElement | null>(null);
const pdfBusy = ref(false);
async function onPdf(): Promise<void> {
  const sheet = sheetBox.value?.querySelector<HTMLElement>('[data-testid="develop-quote-sheet"]') ?? null;
  if (sheet === null || pdfBusy.value) return;
  pdfBusy.value = true;
  error.value = '';
  try {
    await downloadElementsPdf([sheet], developQuoteFileName(props.quote.title, props.quoteNo, 'pdf'));
  } catch (e) {
    error.value = apiErrorMessage(e, t('admin.develop.quote.pdfFail'));
  } finally {
    pdfBusy.value = false;
  }
}
onMounted(() => {
  if (props.autoPdf) void nextTick(onPdf);
});

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogScrollContent class="sm:max-w-[860px]" data-testid="develop-quote-preview">
      <DialogHeader>
        <DialogTitle>{{ t('admin.develop.quote.preview') }}</DialogTitle>
        <DialogDescription>{{ t('admin.develop.quote.previewHint') }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="xlsx !== null" variant="outline" size="sm" :disabled="busy" @click="onXlsx">
          <DownloadIcon />
          {{ t('admin.develop.quote.xlsx') }}
        </Button>
        <Button variant="outline" size="sm" :disabled="pdfBusy" @click="onPdf">
          <FileDownIcon />
          {{ pdfBusy ? t('admin.develop.quote.pdfBusy') : t('admin.develop.quote.pdf') }}
        </Button>
        <span v-if="error !== ''" role="alert" class="text-destructive text-xs">{{ error }}</span>
      </div>
      <div ref="sheetBox" class="overflow-x-auto rounded-md border bg-white">
        <DevelopQuoteSheet :quote="quote" :recipient="recipient" :quote-no="quoteNo" :issued-on="issuedOn" />
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
