<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import { useSmartbomCaseContext } from '../useSmartbomCase';

// 견적 마감 — Case 완료가 아니라 고객의 신규 주문을 닫는 보조 작업이다.
const { detail, patch, quoteClosingOpen, quoteClosingError, submitQuoteClosing } = useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !patch.isPending.value) quoteClosingOpen.value = false;
};
</script>

<template>
  <Dialog :open="quoteClosingOpen && detail !== null" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[440px]">
      <DialogHeader>
        <DialogTitle>견적 마감</DialogTitle>
        <DialogDescription>
          고객이 이 견적으로 더 진행하지 않는 경우에만 마감해 주세요. 마감 후에는 고객이 새 주문을 시작할 수 없습니다.
        </DialogDescription>
      </DialogHeader>

      <Alert variant="warning" size="sm">
        <TriangleAlertIcon />
        <AlertDescription>
          기존 견적·회신 이력은 보존됩니다. 견적 마감은 주문·결제·발주·배송까지 완료됐다는 의미가 아닙니다.
        </AlertDescription>
      </Alert>
      <Alert v-if="quoteClosingError !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ quoteClosingError }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="patch.isPending.value" @click="quoteClosingOpen = false">취소</Button>
        <Button :disabled="patch.isPending.value" @click="void submitQuoteClosing()">
          <Spinner v-if="patch.isPending.value" />
          {{ patch.isPending.value ? '마감 중…' : '견적 마감' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
