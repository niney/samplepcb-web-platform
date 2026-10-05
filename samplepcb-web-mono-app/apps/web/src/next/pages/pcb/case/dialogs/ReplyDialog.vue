<script setup lang="ts">
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import RfqReplyForm from '@/next/components/pcb/RfqReplyForm.vue';
import { usePcbCaseContext } from '../usePcbCase';

// 대리 회신 — 전화·메일로 받은 견적을 관리자가 대신 입력한다(포털·매직링크와 같은 저장 코어).
const { replyTarget, adminReply, submitAdminReply } = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) replyTarget.value = null;
};
</script>

<template>
  <Dialog :open="replyTarget !== null" @update:open="onOpenChange">
    <DialogContent v-if="replyTarget !== null" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>대리 회신 — {{ replyTarget.partnerName }}</DialogTitle>
        <DialogDescription>전화·메일로 받은 견적을 관리자가 대신 입력합니다(결제통화 {{ replyTarget.currency }}).</DialogDescription>
      </DialogHeader>
      <RfqReplyForm
        :key="replyTarget.rfqId"
        :settlement-currency="replyTarget.currency"
        :initial="{
          priceOriginal: replyTarget.priceOriginal,
          subCurrency: replyTarget.subCurrency,
          subPriceOriginal: replyTarget.subPriceOriginal,
          quotedDeliveryDate: replyTarget.quotedDeliveryDate,
          memo: replyTarget.memo,
        }"
        :suggested-delivery-date="replyTarget.suggestedDeliveryDate"
        :busy="adminReply.isPending.value"
        @submit="(body) => void submitAdminReply(body)"
      />
      <DialogFooter>
        <Button variant="outline" @click="replyTarget = null">닫기</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
