<script setup lang="ts">
import { PCB_PAYMENT_TERM_OPTIONS } from '@sp/api-contract';
import { pcbMoneyWithSub } from '@/lib/pcb-money';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';
import { usePcbCaseContext } from '../usePcbCase';

// 발주 조건 수정 — 결제조건·납기·메모(발주가·환율은 서버 규칙이 따로다).
const {
  editPo,
  editTerms,
  editIsNet7,
  editIsCustomPaymentDate,
  editRemittanceDue,
  editRemittanceDuePreview,
  editDelivery,
  editMemo,
  editCanSubmit,
  submitPoEdit,
} = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) editPo.value = null;
};
</script>

<template>
  <Dialog :open="editPo !== null" @update:open="onOpenChange">
    <DialogContent v-if="editPo !== null" class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>발주 조건 수정</DialogTitle>
        <DialogDescription>
          {{ editPo.partnerName }} · {{ pcbMoneyWithSub(editPo.currency, editPo.priceOriginal, editPo.subCurrency, editPo.subPriceOriginal) }}
          — 발주가·환율은 여기서 바꾸지 않습니다.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <Field>
          <FieldLabel for="pcb-po-edit-terms">결제조건</FieldLabel>
          <Input id="pcb-po-edit-terms" v-model="editTerms" type="text" list="pcb-next-payment-terms-edit" placeholder="T/T in Advance" />
          <datalist id="pcb-next-payment-terms-edit">
            <option v-for="term in PCB_PAYMENT_TERM_OPTIONS" :key="term" :value="term" />
          </datalist>
        </Field>
        <Field v-if="editIsNet7 || editIsCustomPaymentDate">
          <FieldLabel for="pcb-po-edit-remit">송금 예정일 *</FieldLabel>
          <Input v-if="editIsCustomPaymentDate" id="pcb-po-edit-remit" v-model="editRemittanceDue" type="date" />
          <Input v-else id="pcb-po-edit-remit" :model-value="editRemittanceDuePreview" type="date" disabled />
          <FieldDescription>
            {{ editIsNet7 ? '최초 발주일 기준 7일 후로 서버가 다시 확정합니다.' : '실제 송금일과는 별도인 예정 날짜입니다.' }}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel for="pcb-po-edit-delivery">납기</FieldLabel>
          <Input id="pcb-po-edit-delivery" v-model="editDelivery" type="date" />
        </Field>
        <Field>
          <FieldLabel for="pcb-po-edit-memo">메모</FieldLabel>
          <Textarea id="pcb-po-edit-memo" v-model="editMemo" rows="2" />
        </Field>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="editPo = null">취소</Button>
        <Button :disabled="!editCanSubmit" @click="void submitPoEdit()">저장</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
