<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import { smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import { itemLabel } from '../case-items';
import { useSmartbomCaseContext } from '../useSmartbomCase';
import ForceImpactCard from './ForceImpactCard.vue';

// 수동 추가 행 제거 확인 — 업로드 원본 행은 대상이 아니다. 강제 제거는 RFQ 회신 삭제 영향 확인 뒤에만.
const { pendingPartRemove, forcePartRemoveConfirmed, partRemove, cancelPendingPartRemove, confirmPartRemove } =
  useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !partRemove.isPending.value) cancelPendingPartRemove();
};
</script>

<template>
  <Dialog :open="pendingPartRemove !== null" @update:open="onOpenChange">
    <DialogContent v-if="pendingPartRemove !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>수동 추가 부품을 제거할까요?</DialogTitle>
        <DialogDescription>업로드 원본 행에는 영향을 주지 않지만 이 수동 행은 복구되지 않습니다.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-sm">
        <Panel tone="muted">
          <strong class="break-all">{{ itemLabel(pendingPartRemove.item) }}</strong>
          <p class="text-muted-foreground mt-1 text-xs">
            {{ pendingPartRemove.item.manufacturerName ?? '제조사 미확인' }} · 주문
            {{ pendingPartRemove.item.orderQty.toLocaleString('ko-KR') }}개 ·
            {{
              pendingPartRemove.item.lineTotalKrw === null
                ? '금액 미산정'
                : smartbomFmtWon(Math.round(pendingPartRemove.item.lineTotalKrw))
            }}
          </p>
        </Panel>
        <Alert variant="warning" size="sm">
          <TriangleAlertIcon />
          <AlertDescription>제거하면 견적 합계를 다시 계산하고 기존 확정금액을 초기화합니다.</AlertDescription>
        </Alert>
        <ForceImpactCard
          v-if="pendingPartRemove.body.force"
          v-model:confirmed="forcePartRemoveConfirmed"
          title="관리자 강제 제거"
          :reason="pendingPartRemove.impact.forceReason"
          check-id="bom-part-remove-force"
          check-label="RFQ 회신 삭제와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다."
        >
          <li v-if="pendingPartRemove.impact.affectedRfqCount > 0">
            이 부품을 요청한 RFQ {{ pendingPartRemove.impact.affectedRfqCount }}건에서 대상과 해당 행 회신을 제거하고, 남은
            품목이 있으면 요청중으로 되돌립니다.
          </li>
          <li v-if="pendingPartRemove.impact.invalidatedReplyCount > 0">
            이 부품의 기존 협력사 회신 {{ pendingPartRemove.impact.invalidatedReplyCount }}건도 함께 삭제됩니다.
          </li>
          <li v-if="pendingPartRemove.impact.hasOrderSnapshot">기존 장바구니·주문은 당시 품목·금액 스냅샷을 유지합니다.</li>
          <li v-if="pendingPartRemove.impact.poCount > 0">
            기존 발주서 {{ pendingPartRemove.impact.poCount }}건은 발행 당시 품목·금액 스냅샷을 유지합니다.
          </li>
          <li v-if="pendingPartRemove.impact.reopensQuote">
            회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.
          </li>
        </ForceImpactCard>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="partRemove.isPending.value" @click="cancelPendingPartRemove">취소</Button>
        <Button
          variant="destructive"
          :disabled="partRemove.isPending.value || (pendingPartRemove.body.force && !forcePartRemoveConfirmed)"
          @click="void confirmPartRemove()"
        >
          <Spinner v-if="partRemove.isPending.value" />
          {{ partRemove.isPending.value ? '제거 중…' : pendingPartRemove.body.force ? '강제 제거 적용' : '수동 행 제거' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
