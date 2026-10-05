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
import { useSmartbomCaseContext } from '../useSmartbomCase';
import ForceImpactCard from './ForceImpactCard.vue';

// 수동 부품 추가 확인 — 카탈로그·구매 조건·수량은 서버가 다시 읽고 최종 주문수량·합계를 계산한다.
// 강제 추가(회신·주문·발주 이후)는 영향 목록을 확인해야 적용 버튼이 열린다.
const { pendingPartAdd, forcePartAddConfirmed, partAdd, cancelPendingPartAdd, confirmPartAdd } = useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !partAdd.isPending.value) cancelPendingPartAdd();
};
</script>

<template>
  <Dialog :open="pendingPartAdd !== null" @update:open="onOpenChange">
    <DialogContent v-if="pendingPartAdd !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>이 부품을 견적에 추가할까요?</DialogTitle>
        <DialogDescription>카탈로그·구매 조건·수량을 서버가 다시 읽고 최종 주문수량과 견적 합계를 계산합니다.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-sm">
        <Panel tone="muted" class="grid grid-cols-[92px_1fr] gap-x-3 gap-y-2">
          <span class="text-muted-foreground text-xs font-medium">추가 부품</span>
          <div>
            <strong class="text-success break-all">{{ pendingPartAdd.mpn }}</strong>
            <p class="text-muted-foreground mt-0.5 text-xs">{{ pendingPartAdd.manufacturerName ?? '제조사 미확인' }}</p>
          </div>
          <span class="text-muted-foreground text-xs font-medium">수량</span>
          <span class="tabular-nums">
            세트당 {{ pendingPartAdd.body.bomQty.toLocaleString('ko-KR') }}개 · 필요
            {{ pendingPartAdd.needed.toLocaleString('ko-KR') }}개 · 주문 {{ pendingPartAdd.orderQty.toLocaleString('ko-KR') }}개
          </span>
          <span class="text-muted-foreground text-xs font-medium">구매 조건</span>
          <span>{{ pendingPartAdd.supplier ?? '가격·공급사 미확정' }}</span>
          <span class="text-muted-foreground text-xs font-medium">행 금액</span>
          <strong class="tabular-nums">
            {{ pendingPartAdd.lineTotalKrw === null ? '미산정' : smartbomFmtWon(Math.round(pendingPartAdd.lineTotalKrw)) }}
          </strong>
        </Panel>
        <Alert variant="warning" size="sm">
          <TriangleAlertIcon />
          <AlertDescription>
            추가하면 기존 확정금액은 초기화됩니다. 업로드 원본에는 합치지 않고 “수동 추가” 행으로 분리하며, 필요하면 이 행만
            다시 제거할 수 있습니다.
          </AlertDescription>
        </Alert>
        <ForceImpactCard
          v-if="pendingPartAdd.body.force"
          v-model:confirmed="forcePartAddConfirmed"
          title="관리자 강제 추가"
          :reason="pendingPartAdd.impact.forceReason"
          check-id="bom-part-add-force"
          check-label="RFQ 범위와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다."
        >
          <li v-if="pendingPartAdd.impact.dynamicFullRfqCount > 0">
            전체 품목 RFQ {{ pendingPartAdd.impact.dynamicFullRfqCount }}건은 새 부품을 자동 포함하고 요청중으로 되돌립니다. 기존
            행별 회신은 보존되지만 문서 합계·납기·메모는 다시 받아야 합니다.
          </li>
          <li v-if="pendingPartAdd.impact.partialRfqCount > 0">
            부분 품목 RFQ {{ pendingPartAdd.impact.partialRfqCount }}건에는 새 부품을 자동 추가하지 않습니다. 필요하면 새 범위로
            별도 RFQ를 보내야 합니다.
          </li>
          <li v-if="pendingPartAdd.impact.hasOrderSnapshot">
            기존 장바구니·주문은 당시 품목·금액 스냅샷을 유지하므로 변경 견적과 다를 수 있습니다.
          </li>
          <li v-if="pendingPartAdd.impact.poCount > 0">
            기존 발주서 {{ pendingPartAdd.impact.poCount }}건은 발행 당시 품목·금액 스냅샷을 그대로 보존합니다.
          </li>
          <li v-if="pendingPartAdd.impact.reopensQuote">
            회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.
          </li>
        </ForceImpactCard>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="partAdd.isPending.value" @click="cancelPendingPartAdd">취소</Button>
        <Button
          :variant="pendingPartAdd.body.force ? 'destructive' : 'default'"
          :disabled="partAdd.isPending.value || (pendingPartAdd.body.force && !forcePartAddConfirmed)"
          @click="void confirmPartAdd()"
        >
          <Spinner v-if="partAdd.isPending.value" />
          {{ partAdd.isPending.value ? '추가 중…' : pendingPartAdd.body.force ? '강제 추가 적용' : '부품 추가' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
