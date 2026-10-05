<script setup lang="ts">
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
import Panel from '@/next/components/common/Panel.vue';
import { conflictText, fmtWon, missingText } from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 검토 후보(manual_review) 선택 확인 — 자동선정 조건을 충족하지 않은 후보는 근거·구매 조건을 한 번 더 보이고
// [확인 후 선택]으로만 적용한다(명시적인 사람 선택으로 기록된다).
const { props, pendingReviewSelection, pendingReviewOffer, provisionalSelectionPending, confirmPendingReviewSelection } =
  useCandidateDrawer();

const onOpenChange = (open: boolean): void => {
  if (!open) pendingReviewSelection.value = null;
};
</script>

<template>
  <Dialog :open="pendingReviewSelection !== null" @update:open="onOpenChange">
    <DialogContent v-if="pendingReviewSelection !== null" class="sm:max-w-lg">
      <DialogHeader>
        <span class="text-warning text-xs font-semibold tracking-widest uppercase">Manual review</span>
        <DialogTitle>검토 후보를 선택할까요?</DialogTitle>
        <DialogDescription>
          자동 선정 조건을 충족하지 않은 후보입니다. 아래 근거와 구매 조건을 확인해 주세요.
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3">
        <Panel muted size="md">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-base font-semibold break-all">{{ pendingReviewSelection.candidate.mpn }}</p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                {{ pendingReviewSelection.candidate.manufacturerName ?? '제조사 미확인' }}
              </p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-muted-foreground text-xs">예상 행 금액</p>
              <p class="mt-0.5 text-lg font-semibold tabular-nums">
                {{ fmtWon(pendingReviewOffer?.applied?.lineTotalKrw ?? pendingReviewSelection.candidate.bestLineTotalKrw) }}
              </p>
            </div>
          </div>
          <div
            v-if="pendingReviewOffer !== null"
            class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs"
          >
            <span>공급사 <b class="text-foreground uppercase">{{ pendingReviewOffer.supplier }}</b></span>
            <span>주문 <b class="text-foreground">{{ pendingReviewOffer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}개</b></span>
            <span>재고 <b class="text-foreground">{{ pendingReviewOffer.stock?.toLocaleString('ko-KR') ?? '미확인' }}</b></span>
            <span>MOQ <b class="text-foreground">{{ pendingReviewOffer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
          </div>
        </Panel>

        <Alert v-if="pendingReviewSelection.candidate.conflicts.length > 0" variant="destructive" size="sm">
          <AlertDescription><b>충돌 확인:</b> {{ conflictText(pendingReviewSelection.candidate) }}</AlertDescription>
        </Alert>
        <Alert v-if="pendingReviewSelection.candidate.missingRequirements.length > 0" variant="warning" size="sm">
          <AlertDescription><b>추가 확인:</b> {{ missingText(pendingReviewSelection.candidate) }}</AlertDescription>
        </Alert>
        <Alert
          v-if="
            pendingReviewSelection.candidate.conflicts.length === 0 &&
              pendingReviewSelection.candidate.missingRequirements.length === 0
          "
          variant="muted"
          size="sm"
        >
          <AlertDescription>엔진 판정상 사용자 확인이 필요한 후보입니다. 선택하면 명시적인 고객 선택으로 기록됩니다.</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="pendingReviewSelection = null">취소</Button>
        <Button :disabled="props.selecting || props.interactionLocked" @click="confirmPendingReviewSelection">
          {{ pendingReviewSelection.candidate.selected && provisionalSelectionPending ? '검토 완료' : '확인 후 선택' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
