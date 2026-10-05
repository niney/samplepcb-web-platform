<script setup lang="ts">
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
import Panel from '@/next/components/common/Panel.vue';
import { usePcbCaseContext } from '../usePcbCase';

// 협력사 선정 — 외화 환율 자동 프리필 + 판매가(확정가) 동시 등록(레거시 선정 모달의 마진%↔판매가 복원).
const {
  selectTarget,
  selectRate,
  selectRateDate,
  onSelectRateInput,
  selectCostKrw,
  canPriceInSelect,
  selectMargin,
  selectFinal,
  syncFinalFromMargin,
  syncMarginFromFinal,
  selectMut,
  selectFinalValid,
  submitSelect,
} = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) selectTarget.value = null;
};
</script>

<template>
  <Dialog :open="selectTarget !== null" @update:open="onOpenChange">
    <DialogContent v-if="selectTarget !== null" class="sm:max-w-sm">
      <DialogHeader>
        <DialogTitle>협력사 선정 — {{ selectTarget.partnerName }}</DialogTitle>
        <DialogDescription>
          회신 견적가:
          <b class="text-foreground tabular-nums">
            {{ pcbMoneyWithSub(selectTarget.currency, selectTarget.priceOriginal, selectTarget.subCurrency, selectTarget.subPriceOriginal) }}
          </b>
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <Field v-if="selectTarget.currency !== 'KRW'">
          <FieldLabel for="pcb-select-rate">적용 환율 ({{ selectTarget.currency }} → KRW) *</FieldLabel>
          <Input id="pcb-select-rate" v-model="selectRate" type="text" inputmode="decimal" placeholder="예) 1444.19" @input="onSelectRateInput" />
          <FieldDescription v-if="selectRateDate !== null">
            <span class="text-success">수출입은행 {{ selectRateDate }} 고시(송금 기준) 자동 반영 — 수정 가능. 선정 시점에 박제됩니다.</span>
          </FieldDescription>
          <FieldDescription v-else>선정 시점에 박제되어 KRW 환산(원가 회계)에 쓰입니다.</FieldDescription>
        </Field>
        <p v-if="selectCostKrw !== null" class="text-muted-foreground text-sm">
          원가(KRW 환산): <b class="text-foreground tabular-nums">₩{{ selectCostKrw.toLocaleString() }}</b>
        </p>
        <Panel v-if="canPriceInSelect" muted>
          <p class="text-sm font-medium">판매가(확정가) 함께 등록 — 고객 결제액의 기준</p>
          <div class="mt-2 flex gap-2">
            <Field class="w-24 shrink-0">
              <FieldLabel for="pcb-select-margin">마진 %</FieldLabel>
              <Input id="pcb-select-margin" v-model="selectMargin" type="text" inputmode="decimal" @input="syncFinalFromMargin" />
            </Field>
            <Field class="min-w-0 flex-1">
              <FieldLabel for="pcb-select-final">판매가 (VAT 포함, ₩)</FieldLabel>
              <Input id="pcb-select-final" v-model="selectFinal" type="text" inputmode="numeric" @input="syncMarginFromFinal" />
            </Field>
          </div>
          <p class="text-muted-foreground mt-2 text-xs">
            판매가 = 원가 KRW × (1+마진%) × 1.1(VAT). 비워 두고 [선정만] 하면 나중에 [확정가 등록]에서 정합니다.
          </p>
        </Panel>
        <p class="text-muted-foreground text-xs">
          선정하면 같은 트랙의 다른 회신은 '미선정'이 됩니다.<template v-if="!canPriceInSelect"> 진행 중 주문 건 — 판매가 없이 원가 선정만 합니다.</template>
        </p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="selectTarget = null">취소</Button>
        <template v-if="canPriceInSelect">
          <Button variant="secondary" :disabled="selectMut.isPending.value" @click="void submitSelect(false)">선정만</Button>
          <Button :disabled="selectMut.isPending.value || !selectFinalValid" @click="void submitSelect(true)">선정 + 확정가 등록</Button>
        </template>
        <Button v-else :disabled="selectMut.isPending.value" @click="void submitSelect(false)">선정 확정</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
