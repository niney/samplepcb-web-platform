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
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { usePcbCaseContext } from '../usePcbCase';

// 확정가 등록 — 부가세 포함가 역산 체계(고객 결제액의 기준).
const { priceModalOpen, priceInput, confirmPrice, submitPrice } = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) priceModalOpen.value = false;
};
</script>

<template>
  <Dialog :open="priceModalOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>확정가 등록</DialogTitle>
        <DialogDescription>부가세 포함가 역산 체계 — 고객 결제액의 기준이 됩니다.</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel for="pcb-final-price">확정가 (VAT 포함, ₩)</FieldLabel>
        <Input id="pcb-final-price" v-model="priceInput" type="text" inputmode="numeric" />
      </Field>
      <DialogFooter>
        <Button variant="outline" @click="priceModalOpen = false">취소</Button>
        <Button :disabled="confirmPrice.isPending.value" @click="void submitPrice()">등록</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
