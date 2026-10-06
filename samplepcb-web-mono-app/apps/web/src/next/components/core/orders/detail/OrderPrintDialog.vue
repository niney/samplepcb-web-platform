<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { PrinterIcon } from '@lucide/vue';
import { useAdminOrderPrint } from '@/admin/useAdminOrders';
// 인쇄 격리는 인쇄 문서라 옛 것을 그대로 쓴다(docs/ADMIN_NEXT_UI.md 허용 예외).
import { usePrintIsolation } from '@/lib/usePrintIsolation';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import OrderPrintDoc from '../print/OrderPrintDoc.vue';

// 주문서 미리보기·인쇄 — 옛 components/admin/OrderPrintModal.vue 의 짝(같은 props·emits), 견적서
// 대화상자(common/EstimateDialog)와 같은 구조. 부모가 v-if 로 마운트를 제어해 인쇄 규칙의 주입·제거가
// 이 대화상자의 수명과 맞는다.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

const odIdRef = computed(() => props.odId);
const { data, isLoading } = useAdminOrderPrint(odIdRef);
const printData = computed(() => data.value?.data ?? null);

const onPrint = (): void => {
  window.print();
};
const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// 인쇄 격리 — 대화상자는 body 로 나가는 포털이라, 인쇄할 때 body 의 다른 자식(#app·주문 상세 서랍 포털 등)을
// 전부 숨기고 주문서가 든 포털만 정상 흐름으로 되돌린다. 포털 껍데기(오버레이)에는 표지를 달 수 없어 :has() 로
// 찾는다. 대화상자 카드의 테두리·그림자·여백·닫기 버튼과 머리는 인쇄에서 걷어내고, 스크롤 잠금이 인쇄를 한 쪽으로
// 자르지 않게 푼다. 문서 자체 패딩이 여백을 맡으므로 @page margin:0(브라우저 머리글/URL 차단). 미리보기의
// A4 최소 높이는 인쇄에서 푼다(옛 시트의 @media print 규칙).
const PRINT_STYLE_ID = 'sp-next-order-print-style';
const PRINT_CSS = `
@media print {
  body { overflow: visible !important; padding-right: 0 !important; }
  body > :not(:has([data-order-print-host])) { display: none !important; }
  body > :has([data-order-print-host]) {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    background: none !important;
    padding: 0 !important;
  }
  [data-order-print-host] {
    position: static !important;
    display: block !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: none !important;
    transform: none !important;
  }
  [data-order-print-host] > button,
  [data-order-print-host] [data-no-print] { display: none !important; }
  [data-order-print-host] [data-order-print-frame] { overflow: visible !important; border: 0 !important; border-radius: 0 !important; }
  [data-order-print-host] [data-order-sheet] { min-height: auto !important; }
  @page { size: A4; margin: 0; }
}
`;
usePrintIsolation(PRINT_STYLE_ID, PRINT_CSS);
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogScrollContent class="max-w-fit" data-order-print-host>
      <DialogHeader data-no-print>
        <DialogTitle>주문서</DialogTitle>
        <DialogDescription>인쇄하면 주문서만 A4 로 나옵니다.</DialogDescription>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <Button :disabled="printData === null" @click="onPrint">
            <PrinterIcon />
            {{ t('admin.orders.print.print') }}
          </Button>
          <Button variant="outline" @click="emit('close')">{{ t('admin.orders.print.close') }}</Button>
        </div>
      </DialogHeader>

      <p v-if="isLoading" class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm" data-no-print>
        <Spinner />
        불러오는 중…
      </p>
      <!-- 주문서는 흰 A4 문서라 테마와 무관하게 그대로 둔다. 좁은 화면에선 가로 스크롤. -->
      <div v-else-if="printData !== null" class="overflow-x-auto rounded-md border" data-order-print-frame>
        <OrderPrintDoc :data="printData" />
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
