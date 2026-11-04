<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_QUOTE_AMOUNT_MAX, computeDevelopQuoteMargin, developQuoteItemAmount, developQuoteQtyText } from '@sp/api-contract';
import type { AdminDevelopQuoteViewType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { useAdminDevelopQuoteCosts } from '@/admin/useAdminDevelop';
import { DEVELOP_QUOTE_LIMITS, formatAmountInput, marginRateText, parseCostInput } from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import { Button } from '@/next/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/next/components/ui/dialog';
import { Input } from '@/next/components/ui/input';

// 내부 원가 고치기(docs/DEVELOP_FLOW.md §5.1) — 발송·수락 뒤에도 원가 단가·업체만 고친다(PATCH …/costs). 고객 금액·마일스톤은
// 그대로라 안전하고, 수락 뒤 들어온 실제 매입가를 반영하는 자리다. 작성 중 초안은 편집기에서 같이 고친다.
// 부모가 v-if 로 마운트를 제어한다(열릴 때만 마운트).
const props = defineProps<{ quote: AdminDevelopQuoteViewType }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const save = useAdminDevelopQuoteCosts();

interface CostRow {
  itemId: number;
  title: string;
  amount: number;
  qty: number;
  qtyText: string;
  costPrice: string;
  vendor: string;
}
const rows = ref<CostRow[]>(
  props.quote.items.map((it) => ({
    itemId: it.itemId,
    title: it.title,
    amount: it.amount,
    qty: it.qty,
    qtyText: developQuoteQtyText(it.qty, it.unit),
    costPrice: it.costPrice === null ? '' : it.costPrice.toLocaleString('ko-KR'),
    vendor: it.vendor ?? '',
  })),
);
const error = ref('');

const costOf = (row: CostRow): number | null => {
  const cost = parseCostInput(row.costPrice);
  return cost === null || !Number.isFinite(cost) ? null : Math.round(cost);
};
const margin = computed(() =>
  computeDevelopQuoteMargin(
    rows.value.map((r) => ({ amount: r.amount, qty: r.qty, costPrice: costOf(r) })),
    props.quote.supplyAmount,
  ),
);
const rowMargin = (row: CostRow): string => {
  const cost = costOf(row);
  if (cost === null) return t('admin.develop.quote.costMissing');
  const costAmount = developQuoteItemAmount(cost, row.qty);
  const m = row.amount - costAmount;
  return `${formatKrw(m)} (${marginRateText(row.amount > 0 ? m / row.amount : null)})`;
};

async function onSave(): Promise<void> {
  error.value = '';
  const bad = rows.value.findIndex((r) => {
    const cost = parseCostInput(r.costPrice);
    return (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > DEVELOP_QUOTE_AMOUNT_MAX)) || r.vendor.trim().length > DEVELOP_QUOTE_LIMITS.vendorLen;
  });
  if (bad >= 0) {
    error.value = t('admin.develop.quote.costInvalid', { row: bad + 1 });
    return;
  }
  try {
    await save.mutateAsync({
      quoteId: props.quote.quoteId,
      body: {
        items: rows.value.map((r) => ({ itemId: r.itemId, costPrice: costOf(r), vendor: r.vendor.trim() === '' ? null : r.vendor.trim() })),
      },
    });
    emit('close');
  } catch (e) {
    error.value = apiErrorMessage(e, t('admin.develop.quote.costSaveFail'), { ITEM_MISMATCH: t('admin.develop.quote.costSaveFail') });
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogScrollContent class="sm:max-w-[760px]" data-testid="develop-quote-costs">
      <DialogHeader>
        <DialogTitle>{{ t('admin.develop.quote.costEdit') }} — v{{ quote.version }}</DialogTitle>
        <DialogDescription>{{ t('admin.develop.quote.costEditHint') }}</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-1.5">
        <div
          v-for="(r, i) in rows"
          :key="r.itemId"
          class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b pb-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_8rem_minmax(0,10rem)]"
        >
          <span class="min-w-0 truncate" :title="r.title">{{ i + 1 }}. {{ r.title }}</span>
          <span class="text-muted-foreground text-right text-xs tabular-nums">{{ formatKrw(r.amount) }} · {{ r.qtyText }}</span>
          <Input
            v-model="r.costPrice"
            inputmode="numeric"
            :placeholder="t('admin.develop.quote.costPrice')"
            :aria-label="`${String(i + 1)} ${t('admin.develop.quote.costPrice')}`"
            class="text-right tabular-nums"
            @blur="r.costPrice = r.costPrice.trim() === '' ? '' : formatAmountInput(r.costPrice)"
          />
          <Input
            v-model="r.vendor"
            :maxlength="DEVELOP_QUOTE_LIMITS.vendorLen"
            :placeholder="t('admin.develop.quote.vendor')"
            :aria-label="`${String(i + 1)} ${t('admin.develop.quote.vendor')}`"
          />
          <span class="text-muted-foreground col-span-full text-right text-xs tabular-nums">{{ t('admin.develop.quote.margin') }} {{ rowMargin(r) }}</span>
        </div>
      </div>
      <p class="text-sm tabular-nums" data-testid="develop-quote-costs-total">
        {{ t('admin.develop.quote.costTotal') }} {{ formatKrw(margin.costTotal) }} ·
        {{ t('admin.develop.quote.margin') }} <b>{{ formatKrw(margin.totalMargin) }}</b> ({{ marginRateText(margin.marginRate) }})
        <span v-if="margin.missingRows > 0" class="text-warning ml-1 text-xs font-semibold">{{ t('admin.develop.quote.costMissingRows', { count: margin.missingRows }) }}</span>
      </p>
      <p v-if="error !== ''" role="alert" class="text-destructive text-sm">{{ error }}</p>
      <DialogFooter>
        <Button variant="outline" @click="emit('close')">{{ t('admin.develop.quote.confirmNo') }}</Button>
        <Button :disabled="save.isPending.value" @click="onSave">{{ t('admin.develop.quote.costSave') }}</Button>
      </DialogFooter>
    </DialogScrollContent>
  </Dialog>
</template>
