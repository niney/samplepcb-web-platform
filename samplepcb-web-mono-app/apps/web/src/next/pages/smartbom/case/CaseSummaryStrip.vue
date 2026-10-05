<script setup lang="ts">
import { computed } from 'vue';
import { DownloadIcon, PlayIcon } from '@lucide/vue';
import { smartbomFmtDate, smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 요약 줄 — 세트·예비, 부품 합계, 예상 합계(운송료·관리비·VAT 별도), 미산정, 요청일, 주문·결제 파생(D16 —
// ct/od 조인, 저장 아님), 원본 BOM 다운로드. 아래에 고객 메모와, 견적요청 상태의 첫 행동(검토 시작).
const { detail, downloadOriginal, patch, saveReview } = useSmartbomCaseContext();

const orderBadge = computed<{ label: string; variant: BadgeVariant } | null>(() => {
  const d = detail.value;
  if (d === null) return null;
  if (d.orderInfo !== null) {
    if (d.orderState === 'canceled') {
      return { label: `이전 주문 ${d.orderInfo.odId} · ${d.orderInfo.ctStatus} · 고객 재주문 가능`, variant: 'danger' };
    }
    const paid = d.orderInfo.isPaid ? ` · 수납 ${smartbomFmtWon(d.orderInfo.receiptPrice)}` : '';
    return { label: `주문 ${d.orderInfo.odId} · ${d.orderInfo.odStatus}${paid}`, variant: d.orderInfo.isPaid ? 'success' : 'info' };
  }
  return d.orderState === 'cart' ? { label: '고객 장바구니 담김', variant: 'warning' } : null;
});
</script>

<template>
  <template v-if="detail !== null">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span class="text-muted-foreground">세트 {{ detail.setQty }} · 예비 {{ detail.spareQty }}</span>
      <span class="text-muted-foreground">
        부품 합계 <b class="text-foreground tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b>
      </span>
      <span class="text-muted-foreground">
        예상 합계 <b class="text-foreground tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b>
        <span class="text-xs">
          (운송료 {{ smartbomFmtWon(detail.shippingFee) }} · 관리비 {{ smartbomFmtWon(detail.managementFee) }} · VAT 별도)
        </span>
      </span>
      <Badge v-if="detail.uncostedCount > 0" variant="warning">미산정 {{ detail.uncostedCount }}건</Badge>
      <span class="text-muted-foreground text-xs">요청 {{ smartbomFmtDate(detail.requestedAt) }}</span>
      <Badge v-if="orderBadge !== null" :variant="orderBadge.variant">{{ orderBadge.label }}</Badge>
      <Button v-if="detail.fileUrl !== null" variant="link" size="xs" @click="void downloadOriginal()">
        <DownloadIcon />
        원본 BOM 다운로드
      </Button>
    </div>
    <Panel v-if="detail.customerMemo" size="xs" tone="muted" class="text-muted-foreground text-sm">
      고객 메모: {{ detail.customerMemo }}
    </Panel>

    <!-- 견적요청 상태의 첫 행동을 긴 품목표보다 앞에 둔다. 이후 RFQ·품목 검토가 열리는 순서를 화면에서도
         서버 상태 머신(requested→reviewing)과 같게 보장한다. -->
    <Panel
      v-if="detail.status === 'requested'"
      tone="warning"
      class="flex flex-wrap items-center gap-3"
      aria-label="다음 작업"
    >
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">다음 작업 · 검토 시작</p>
        <p class="text-foreground/80 mt-0.5 text-xs">검토를 시작하면 품목 확인과 협력사 견적요청을 순서대로 진행할 수 있습니다.</p>
      </div>
      <Button :disabled="patch.isPending.value" @click="void saveReview('reviewing')">
        <PlayIcon />
        {{ patch.isPending.value ? '시작 중…' : '검토 시작' }}
      </Button>
    </Panel>
  </template>
</template>
