<script setup lang="ts">
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import RfqReplyForm from '@/next/components/smartbom/RfqReplyForm.vue';
import { useSmartbomCaseContext } from '../useSmartbomCase';

// 대리 입력(회신 보기·수정) — 포털 회신과 같은 폼·저장 경로(source=manual). 마감된 RFQ 는 읽기 전용.
const { replyRfq, replyRows, replyError, rfqReply, submitReply } = useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) replyRfq.value = null;
};
</script>

<template>
  <Dialog :open="replyRfq !== null" @update:open="onOpenChange">
    <DialogContent v-if="replyRfq !== null" class="sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>
          {{ replyRfq.partnerName }} —
          {{ replyRfq.status === 'closed' ? '회신 보기' : replyRfq.status === 'quoted' ? '회신 수정' : '회신 대리 입력' }}
        </DialogTitle>
        <DialogDescription>
          {{
            replyRfq.status === 'closed'
              ? '마감된 RFQ의 최종 회신 내용입니다. 기록 보존을 위해 읽기 전용으로 표시합니다.'
              : '전화·메일로 받은 회신을 기록합니다 — 협력사 포털 회신과 같은 저장 경로(source=manual)입니다.'
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogScrollBody>
        <RfqReplyForm
          :key="replyRfq.rfqId"
          :rows="replyRows"
          :currency="replyRfq.currency"
          :delivery-date="replyRfq.deliveryDate"
          :memo="replyRfq.memo"
          :busy="rfqReply.isPending.value"
          :read-only="replyRfq.status === 'closed'"
          @submit="(body) => void submitReply(body)"
        />
      </DialogScrollBody>
      <Alert v-if="replyError !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ replyError }}</AlertDescription>
      </Alert>
    </DialogContent>
  </Dialog>
</template>
