<script setup lang="ts">
import { PCB_PAYMENT_TERM_OPTIONS, PCB_PO_FULFILLMENT_MODE_LABELS } from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
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

// 발주서 발행 — 선정된 회신의 통화·금액·납기가 자동 승계된다(비우면 승계값).
const {
  poModalOpen,
  poTargetRfq,
  poPartnerId,
  poCurrencyOf,
  poPrice,
  poRate,
  poTerms,
  poIsNet7,
  poIsCustomPaymentDate,
  poRemittanceDue,
  poRemittanceDuePreview,
  poDelivery,
  poMemo,
  poCanSubmit,
  submitPo,
} = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) poModalOpen.value = false;
};
</script>

<template>
  <Dialog :open="poModalOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>발주서 발행</DialogTitle>
        <DialogDescription>선정된 회신의 통화·금액·납기가 자동 승계됩니다(비우면 승계값 사용).</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <Field>
          <FieldLabel>협력사 *</FieldLabel>
          <div class="bg-success-soft text-success rounded-md border px-3 py-2 text-sm font-semibold">
            {{ poTargetRfq?.partnerName ?? '선정된 협력사가 없습니다.' }}
            <span v-if="poTargetRfq !== null" class="ml-1 text-xs font-medium">({{ poTargetRfq.currency }})</span>
          </div>
          <FieldDescription v-if="poTargetRfq !== null">
            회신 승계:
            {{ pcbMoneyWithSub(poTargetRfq.currency, poTargetRfq.priceOriginal, poTargetRfq.subCurrency, poTargetRfq.subPriceOriginal) }}
            <template v-if="poTargetRfq.quotedDeliveryDate !== null"> · 납기 {{ fmtKstDate(poTargetRfq.quotedDeliveryDate) }}</template>
            · 진행 방식: {{ PCB_PO_FULFILLMENT_MODE_LABELS[poTargetRfq.selectedChildRfqId === null ? 'self' : 'delegated'] }}
          </FieldDescription>
        </Field>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel for="pcb-po-price">발주가 ({{ poCurrencyOf(poPartnerId) }})</FieldLabel>
            <Input
              id="pcb-po-price"
              v-model="poPrice"
              type="text"
              inputmode="decimal"
              :placeholder="poTargetRfq !== null ? '비우면 회신가' : '필수'"
            />
          </Field>
          <Field v-if="poCurrencyOf(poPartnerId) !== 'KRW'">
            <FieldLabel for="pcb-po-rate">KRW 회계 환율</FieldLabel>
            <Input
              id="pcb-po-rate"
              v-model="poRate"
              type="text"
              inputmode="decimal"
              :placeholder="poTargetRfq !== null && poTargetRfq.exchangeRate !== null ? '비우면 선정 환율' : '필수'"
            />
          </Field>
          <Field>
            <FieldLabel for="pcb-po-terms">결제조건</FieldLabel>
            <Input id="pcb-po-terms" v-model="poTerms" type="text" list="pcb-next-payment-terms" placeholder="T/T in Advance" />
            <datalist id="pcb-next-payment-terms">
              <option v-for="term in PCB_PAYMENT_TERM_OPTIONS" :key="term" :value="term" />
            </datalist>
          </Field>
          <Field v-if="poIsNet7 || poIsCustomPaymentDate">
            <FieldLabel for="pcb-po-remit-due">송금 예정일 *</FieldLabel>
            <Input v-if="poIsCustomPaymentDate" id="pcb-po-remit-due" v-model="poRemittanceDue" type="date" />
            <Input v-else id="pcb-po-remit-due" :model-value="poRemittanceDuePreview" type="date" disabled />
            <FieldDescription>
              {{ poIsNet7 ? '서버가 발주일 기준 7일 후로 확정합니다.' : '실제 송금일은 송금 원장에 별도로 기록합니다.' }}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel for="pcb-po-delivery">납기</FieldLabel>
            <Input id="pcb-po-delivery" v-model="poDelivery" type="date" />
          </Field>
        </div>
        <p class="text-muted-foreground text-xs">
          위 날짜는 송금 <b class="text-foreground">예정일</b>입니다. 실제 송금은 발행 뒤 발주서 행의
          <b class="text-foreground">[송금]</b>에서 금액·환율·증빙과 함께 기록합니다.
        </p>
        <Field>
          <FieldLabel for="pcb-po-memo">메모</FieldLabel>
          <Textarea id="pcb-po-memo" v-model="poMemo" rows="2" />
        </Field>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="poModalOpen = false">취소</Button>
        <Button :disabled="!poCanSubmit" @click="void submitPo()">발행</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
