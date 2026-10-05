<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PartHitType } from '@sp/api-contract';
import { neededQty, type OfferPick } from '@sp/utils';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import PartSearchPanel from '@/next/components/bom/PartSearchPanel.vue';

// SmartBOM 관리자 수동 행 추가 — 옛 components/admin/smartbom/BomPartAddModal.vue 의 짝(같은 props·emits,
// v-if 로 열린 채 마운트). 세트당 BOM 수량을 먼저 확정하고 같은 수량 문맥으로 카탈로그 구매 조건의
// MOQ·주문배수·가격을 비교한다. 실제 값은 서버가 다시 계산한다.
const props = defineProps<{
  setQty: number;
  spareQty: number;
  usdKrwRate: number | null;
  selecting: boolean;
  readOnly: boolean;
  lockedReason: string;
  error: string;
}>();

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null, bomQty: number];
  close: [];
}>();

const bomQty = ref(1);
const quantityValid = computed(() => Number.isInteger(bomQty.value) && bomQty.value >= 1 && bomQty.value <= 100000);
const normalizedBomQty = computed(() => (quantityValid.value ? bomQty.value : 1));
const needed = computed(() => neededQty(normalizedBomQty.value, props.setQty, props.spareQty));

function onSelect(part: PartHitType, pick: OfferPick | null): void {
  if (props.readOnly || props.selecting || !quantityValid.value) return;
  emit('select', part, pick, bomQty.value);
}

function onQtyInput(value: string | number): void {
  const parsed = typeof value === 'number' ? value : Number(value);
  bomQty.value = Number.isFinite(parsed) ? parsed : 0;
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-3xl">
      <DialogHeader>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2 pr-8">
          <DialogTitle class="mr-auto">견적에 부품 추가</DialogTitle>
          <Field orientation="horizontal" class="w-auto">
            <FieldLabel for="next-part-add-qty" class="whitespace-nowrap">세트당</FieldLabel>
            <Input
              id="next-part-add-qty"
              :model-value="bomQty"
              type="number"
              min="1"
              max="100000"
              step="1"
              class="w-24 text-right"
              :disabled="selecting"
              @update:model-value="onQtyInput"
            />
          </Field>
        </div>
        <DialogDescription>세트당 수량을 정하면 그 수량 기준으로 MOQ·주문배수·가격을 비교합니다.</DialogDescription>
      </DialogHeader>

      <DialogScrollBody>
        <div class="flex flex-col gap-3">
          <p v-if="!quantityValid" class="text-destructive text-xs font-medium">세트당 수량은 1~100,000 사이 정수로 입력해 주세요.</p>
          <Alert v-if="readOnly" variant="warning" size="sm">
            <AlertDescription>지금은 검색·가격 비교만 가능합니다. {{ lockedReason }}</AlertDescription>
          </Alert>
          <Alert v-if="error !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>

          <PartSearchPanel
            initial-query=""
            :needed="needed"
            :usd-krw-rate="usdKrwRate"
            :selecting="selecting || !quantityValid"
            :browse="readOnly"
            selection-action="add"
            @select="onSelect"
          />
        </div>
      </DialogScrollBody>
    </DialogContent>
  </Dialog>
</template>
