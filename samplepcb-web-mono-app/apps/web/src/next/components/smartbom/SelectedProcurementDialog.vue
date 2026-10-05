<script setup lang="ts">
import { computed } from 'vue';
import type { BomQuoteItemType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import { procurementKindBadge } from './smartbom-badges';

// 선정 공급처 한 곳의 품목 — 옛 components/admin/smartbom/BomSelectedProcurementModal.vue 의 짝(같은 props·emits).
// RFQ 패널의 '선정 공급사' 칸을 누르면 그 공급처로 선정된 부품행과 행 합계를 본다(읽기 전용).
const props = defineProps<{
  open: boolean;
  providerName: string;
  providerKind: 'supplier' | 'partner' | 'other';
  items: BomQuoteItemType[];
}>();
const emit = defineEmits<{ close: [] }>();

const kind = computed(() => procurementKindBadge(props.providerKind));
const selectedTotal = computed(() => props.items.reduce((sum, item) => sum + (item.lineTotalKrw ?? 0), 0));
const unpricedCount = computed(() => props.items.filter((item) => item.lineTotalKrw === null).length);

const fmt = (value: number): string => value.toLocaleString('ko-KR');
const fmtMoney = (value: number | null): string => (value === null ? '금액 미확정' : `${fmt(Math.round(value))}원`);

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="props.open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>
          <span class="flex flex-wrap items-center gap-2">
            {{ props.providerName }} 선정 품목
            <Badge :variant="kind.variant">{{ kind.label }}</Badge>
          </span>
        </DialogTitle>
        <DialogDescription>
          {{ props.items.length }}개 품목 · 선정 합계
          <b class="text-foreground tabular-nums">{{ fmtMoney(selectedTotal) }}</b>
          <template v-if="unpricedCount > 0"> · 금액 미확정 {{ unpricedCount }}개</template>
        </DialogDescription>
      </DialogHeader>

      <DialogScrollBody>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>품번·제조사</TableHead>
                <TableHead>공급사 SKU·포장</TableHead>
                <TableHead class="text-right">주문수량</TableHead>
                <TableHead class="text-right">선정 단가</TableHead>
                <TableHead class="text-right">행 합계</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in props.items" :key="item.id">
                <TableCell>
                  <span class="block max-w-64 truncate font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</span>
                  <span class="text-muted-foreground block max-w-64 truncate text-xs">
                    {{ item.manufacturerName ?? '제조사 미확인' }}
                  </span>
                </TableCell>
                <TableCell>
                  <span class="block max-w-64 truncate">{{ item.selectedOffer?.supplierSku || 'SKU 미제공' }}</span>
                  <span class="text-muted-foreground block max-w-64 truncate text-xs">
                    {{ item.selectedOffer?.packaging ?? '포장 미상' }}
                  </span>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ fmt(item.orderQty) }}</TableCell>
                <TableCell class="text-right tabular-nums">
                  <template v-if="item.selectedOffer !== null">
                    {{ item.selectedOffer.unitPrice.toLocaleString('ko-KR') }} {{ item.selectedOffer.currency }}
                  </template>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell class="text-primary text-right font-semibold tabular-nums">
                  {{ fmtMoney(item.lineTotalKrw) }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableCard>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">닫기</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
