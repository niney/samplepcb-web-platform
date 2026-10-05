<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import { smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
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
import { Spinner } from '@/next/components/ui/spinner';
import { useSmartbomCaseContext } from '../useSmartbomCase';
import ForceImpactCard from './ForceImpactCard.vue';

// 부품 변경 확인 — 후보 서랍(Sheet) 위에 겹쳐 뜬다(서랍보다 늦게 열려 같은 층에서 위로 올라온다).
// 선택은 서버가 다시 검증하고 금액을 재계산한다. 강제 변경은 RFQ 회신 무효화 영향 확인 뒤에만.
const {
  pendingPartSelection,
  forcePartSelectionConfirmed,
  pendingLineDelta,
  candidateSelection,
  cancelPendingPartSelection,
  confirmPartSelection,
} = useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !candidateSelection.isPending.value) cancelPendingPartSelection();
};
</script>

<template>
  <Dialog :open="pendingPartSelection !== null" @update:open="onOpenChange">
    <DialogContent v-if="pendingPartSelection !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>이 부품으로 변경할까요?</DialogTitle>
        <DialogDescription>
          {{ pendingPartSelection.sourceLabel }} 선택을 서버가 다시 검증하고 견적 금액을 재계산합니다.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 text-sm">
        <Panel tone="muted" class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2">
          <span class="text-muted-foreground text-xs font-medium">기존 부품</span>
          <strong class="break-all">{{ pendingPartSelection.previousMpn || '품번 미기재' }}</strong>
          <span class="text-muted-foreground text-xs font-medium">변경 부품</span>
          <div>
            <strong class="text-primary break-all">{{ pendingPartSelection.nextMpn }}</strong>
            <p class="text-muted-foreground mt-0.5 text-xs">{{ pendingPartSelection.nextManufacturer ?? '제조사 미확인' }}</p>
          </div>
          <span class="text-muted-foreground text-xs font-medium">구매 조건</span>
          <span>
            {{ pendingPartSelection.nextSupplier ?? '가격·공급사 미확정' }} ·
            {{ pendingPartSelection.nextOrderQty.toLocaleString('ko-KR') }}개
          </span>
          <span class="text-muted-foreground text-xs font-medium">행 금액</span>
          <div class="flex flex-wrap items-center gap-2">
            <strong class="tabular-nums">
              {{
                pendingPartSelection.nextLineTotalKrw === null
                  ? '미산정'
                  : smartbomFmtWon(Math.round(pendingPartSelection.nextLineTotalKrw))
              }}
            </strong>
            <Badge
              v-if="pendingLineDelta !== null"
              :variant="pendingLineDelta > 0 ? 'danger' : pendingLineDelta < 0 ? 'success' : 'secondary'"
            >
              <span class="tabular-nums">{{ pendingLineDelta > 0 ? '+' : '' }}{{ smartbomFmtWon(Math.round(pendingLineDelta)) }}</span>
            </Badge>
          </div>
        </Panel>
        <Alert variant="warning" size="sm">
          <TriangleAlertIcon />
          <AlertDescription>
            적용하면 기존 확정금액은 초기화되며 다시 확인해야 합니다. 원본 BOM과 이전 선택 이력은 보존됩니다.
          </AlertDescription>
        </Alert>
        <ForceImpactCard
          v-if="pendingPartSelection.body.force"
          v-model:confirmed="forcePartSelectionConfirmed"
          title="관리자 강제 변경"
          :reason="pendingPartSelection.impact.forceReason"
          check-id="bom-part-selection-force"
          check-label="관련 RFQ 회신 무효화와 기존 주문·발주 스냅샷 유지 영향을 확인했습니다."
        >
          <li v-if="pendingPartSelection.impact.affectedRfqCount > 0">
            협력사 RFQ {{ pendingPartSelection.impact.affectedRfqCount }}건은 같은 링크에서 새 부품으로 바뀌며 재안내가
            필요합니다.
          </li>
          <li v-if="pendingPartSelection.impact.invalidatedReplyCount > 0">
            이 품목의 기존 협력사 회신 {{ pendingPartSelection.impact.invalidatedReplyCount }}건은 무효화되고 다시 회신받아야
            합니다.
          </li>
          <li v-if="pendingPartSelection.impact.hasOrderSnapshot">
            기존 장바구니·주문 금액은 과거 스냅샷으로 유지되어 변경 견적과 다를 수 있습니다.
          </li>
          <li v-if="pendingPartSelection.impact.poCount > 0">
            기존 발주서 {{ pendingPartSelection.impact.poCount }}건은 발행 당시 부품·금액 스냅샷을 그대로 보존합니다.
          </li>
          <li v-if="pendingPartSelection.impact.reopensQuote">
            회신 완료·마감 상태는 검토 중으로 되돌리고 기존 고객 회신 문구를 해제합니다.
          </li>
        </ForceImpactCard>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="candidateSelection.isPending.value" @click="cancelPendingPartSelection">
          취소
        </Button>
        <Button
          :variant="pendingPartSelection.body.force ? 'destructive' : 'default'"
          :disabled="candidateSelection.isPending.value || (pendingPartSelection.body.force && !forcePartSelectionConfirmed)"
          @click="void confirmPartSelection()"
        >
          <Spinner v-if="candidateSelection.isPending.value" />
          {{
            candidateSelection.isPending.value
              ? '적용 중…'
              : pendingPartSelection.body.force
                ? '강제 변경 적용'
                : '변경 적용'
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
