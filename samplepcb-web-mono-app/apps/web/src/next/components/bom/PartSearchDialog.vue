<script setup lang="ts">
import type { PartHitType } from '@sp/api-contract';
import type { OfferPick } from '@sp/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import PartSearchPanel from './PartSearchPanel.vue';

// 부품 교체/추가 대화상자 — 옛 components/admin/bom/BomPartSearchModal.vue 의 짝(같은 props·emits, v-if 로
// 열린 채 마운트). 카탈로그(sp-parts) 검색 — 단위·표기 자유(4k7=0.0047M=472).
defineProps<{
  initialQuery: string;
  mode: 'swap' | 'add';
  needed: number;
  usdKrwRate: number | null;
}>();

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null];
  close: [];
}>();

function onSelect(part: PartHitType, pick: OfferPick | null): void {
  emit('select', part, pick);
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ mode === 'swap' ? '부품 교체' : '부품 추가' }}</DialogTitle>
        <DialogDescription>
          {{
            mode === 'swap'
              ? '부품과 공급 포장·공급사를 확인한 뒤 카탈로그 선택으로 변경합니다.'
              : '부품과 구매 조건을 확인한 뒤 견적에 추가합니다.'
          }}
        </DialogDescription>
      </DialogHeader>
      <DialogScrollBody>
        <PartSearchPanel :initial-query="initialQuery" :needed="needed" :usd-krw-rate="usdKrwRate" @select="onSelect" />
      </DialogScrollBody>
    </DialogContent>
  </Dialog>
</template>
