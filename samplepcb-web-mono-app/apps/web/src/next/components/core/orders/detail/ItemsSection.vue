<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType } from '@sp/api-contract';
import { CANCEL_ITEM_TARGETS, isCancelledItemStatus, type CancelItemTarget } from '@/admin/useAdminOrders';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { linePrice, quoteStatusVariant } from './order-detail';

// 주문 상품(카트행 ct_id 단위) — 썸네일·품명·금액·사양 요약·수량·행 상태·협력 트랙·견적 상태·확정가,
// 무통장이고 아직 취소류가 아닌 행에는 취소/반품/품절 버튼(되돌릴 수 없어 확인 대화상자를 거친다 — 서랍이 띄운다).
const props = defineProps<{ items: readonly AdminOrderCartItemType[]; isBankTransfer: boolean }>();
const emit = defineEmits<{ action: [payload: { ctId: number; target: CancelItemTarget; label: string }] }>();
const { t } = useI18n();

const ITEM_TARGET_SLUG: Record<CancelItemTarget, string> = {
  취소: 'cancel',
  반품: 'return',
  품절: 'soldOut',
};
const itemTargetLabel = (target: CancelItemTarget): string =>
  t(`admin.orders.itemCancel.target.${ITEM_TARGET_SLUG[target]}`);

const canProcessItem = (it: AdminOrderCartItemType): boolean => props.isBankTransfer && !isCancelledItemStatus(it.ctStatus);
</script>

<template>
  <SectionCard>
    <template #title>
      {{ t('admin.orders.drawer.items') }}
      <span class="text-muted-foreground font-normal tabular-nums">({{ items.length }})</span>
    </template>

    <ul v-if="items.length > 0" class="flex flex-col gap-2">
      <li v-for="it in items" :key="it.ctId">
        <Panel class="flex gap-3">
          <img
            v-if="it.quote !== null && it.quote.thumbUrl !== null"
            :src="it.quote.thumbUrl"
            alt=""
            class="size-14 shrink-0 rounded border object-cover"
          >
          <div
            v-else
            class="text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded border border-dashed text-xs"
            aria-hidden="true"
          >
            PCB
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <p class="min-w-0 text-sm font-medium break-words">{{ it.itName }}</p>
              <span class="shrink-0 text-sm tabular-nums">{{ formatKrw(linePrice(it)) }}</span>
            </div>
            <p v-if="it.quote !== null && it.quote.specSummary !== ''" class="text-muted-foreground mt-0.5 text-xs">
              {{ it.quote.specSummary }}
            </p>
            <p v-else-if="it.ctOption !== ''" class="text-muted-foreground mt-0.5 text-xs">{{ it.ctOption }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span class="text-muted-foreground text-xs tabular-nums">
                {{ t('admin.orders.drawer.itemQty', { n: it.ctQty }) }}
              </span>
              <Badge v-if="it.ctStatus !== ''" :variant="isCancelledItemStatus(it.ctStatus) ? 'danger' : 'secondary'">
                {{ it.ctStatus }}
              </Badge>
              <Badge v-if="it.pcbProgress !== null" variant="info" :title="it.pcbProgress.label">
                {{ it.pcbProgress.shortLabel }}
              </Badge>
              <Badge v-if="it.quote !== null" :variant="quoteStatusVariant(it.quote.quoteStatus)">
                {{ t(`admin.quotes.badge.${it.quote.quoteStatus}`) }}
              </Badge>
              <span v-if="it.quote !== null && it.quote.finalPrice !== null" class="text-muted-foreground text-xs tabular-nums">
                {{ t('admin.orders.drawer.finalPrice') }} {{ formatKrw(it.quote.finalPrice) }}
              </span>
            </div>
            <!-- 행별 취소/반품/품절(무통장 · 취소류 아님) — 되돌릴 수 없어 확인 대화상자 경유 -->
            <div v-if="canProcessItem(it)" class="mt-2 flex flex-wrap gap-1">
              <Button
                v-for="target in CANCEL_ITEM_TARGETS"
                :key="target"
                variant="outline"
                size="xs"
                @click="emit('action', { ctId: it.ctId, target, label: it.itName })"
              >
                {{ itemTargetLabel(target) }}
              </Button>
            </div>
          </div>
        </Panel>
      </li>
    </ul>
    <p v-else class="text-muted-foreground text-sm">{{ t('admin.orders.drawer.noItems') }}</p>
  </SectionCard>
</template>
