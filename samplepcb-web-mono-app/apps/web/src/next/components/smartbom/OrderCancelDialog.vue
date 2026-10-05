<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CircleCheckIcon, ExternalLinkIcon, TriangleAlertIcon } from '@lucide/vue';
import { BOM_ORDER_CANCEL_BLOCK_LABELS } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBomOrderCancelPreview, useCancelBomOrder } from '@/admin/useAdminBomOrders';
import { smartbomFmtWon } from '@/admin/smartbom';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
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
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';

// Smart BOM 주문 취소 — 옛 BomOrderCancelModal 의 짝(props·emits 동일: 주문·결제 목록과 Case 상세가 함께 쓴다).
// 묶음 주문에서는 고른 BOM Case 의 주문행만 취소한다. 서버 미리보기가 취소 가능 여부·범위를 정하고, 결제가
// 끝났거나 협력 진행이 있으면 여기서 막고 갈 곳(영카트 주문관리·Case)을 안내한다 — 결제 승인 취소·환불을
// 확인하기 전에 로컬 주문 상태를 먼저 바꾸지 않는다.

const props = defineProps<{ quoteId: string }>();
const emit = defineEmits<{ close: []; done: []; openCase: [] }>();

const quoteIdRef = computed<string | null>(() => props.quoteId);
const previewQuery = useBomOrderCancelPreview(quoteIdRef);
const preview = computed(() => previewQuery.data.value?.data ?? null);
const reason = ref('');
const validationError = ref('');
const cancelOrder = useCancelBomOrder();

watch(reason, () => {
  validationError.value = '';
});

const actionError = computed(() => {
  const error = cancelOrder.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : 'BOM 주문 취소에 실패했습니다.';
});

const previewError = computed(() => {
  const error = previewQuery.error.value;
  if (error === null) return '';
  return error instanceof ApiRequestError
    ? (error.payload?.message ?? error.message)
    : '취소 가능 여부를 확인하지 못했습니다.';
});

const showOpenCase = computed(
  () => preview.value !== null && !preview.value.cancelable && preview.value.blockReason === 'PARTNER_PROCESS_EXISTS',
);
const showYoungcart = computed(
  () =>
    preview.value !== null &&
    !preview.value.cancelable &&
    (preview.value.blockReason === 'PAYMENT_RECEIVED' || preview.value.blockReason === 'YOUNGCART_REQUIRED'),
);

async function submit(): Promise<void> {
  const value = reason.value.trim();
  if (value.length < 2) {
    validationError.value = '취소 사유를 2자 이상 입력해 주세요.';
    return;
  }
  validationError.value = '';
  try {
    await cancelOrder.mutateAsync({ quoteId: props.quoteId, reason: value });
  } catch {
    // mutation.error 를 본문에 표시한다. 버튼 이벤트의 Promise rejection 은 여기서 소비한다.
  }
}

function close(): void {
  if (cancelOrder.isPending.value) return;
  if (cancelOrder.isSuccess.value) emit('done');
  else emit('close');
}

const onOpenChange = (open: boolean): void => {
  if (!open) close();
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>
          <span class="text-destructive">Smart BOM 주문 취소</span>
        </DialogTitle>
        <DialogDescription>묶음 주문에서는 선택한 BOM Case의 주문행만 취소할 수 있습니다.</DialogDescription>
      </DialogHeader>

      <div class="grid gap-3">
        <p
          v-if="previewQuery.isLoading.value"
          class="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm"
        >
          <Spinner />
          취소 가능 여부를 확인하고 있습니다…
        </p>
        <Alert v-else-if="previewError !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ previewError }}</AlertDescription>
        </Alert>
        <template v-else-if="preview !== null">
          <Panel muted>
            <dl class="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt class="text-muted-foreground">대상</dt>
              <dd class="font-medium">{{ preview.title }}</dd>
              <dt class="text-muted-foreground">주문번호</dt>
              <dd class="text-muted-foreground font-mono text-xs leading-5">{{ preview.odId }}</dd>
              <dt class="text-muted-foreground">주문 / 항목</dt>
              <dd>{{ preview.odStatus }} / {{ preview.ctStatus }}</dd>
              <dt class="text-muted-foreground">결제</dt>
              <dd>
                {{ preview.settleCase || '—' }} · 수납
                <span class="tabular-nums">{{ smartbomFmtWon(preview.receiptPrice) }}</span>
              </dd>
            </dl>
          </Panel>

          <Alert v-if="cancelOrder.isSuccess.value" variant="success" size="sm" role="status">
            <CircleCheckIcon />
            <AlertTitle>BOM 주문 취소가 완료되었습니다.</AlertTitle>
            <AlertDescription>
              <p class="text-xs">
                {{
                  cancelOrder.data.value?.data.orderCancelled === true
                    ? '주문 전체가 취소 상태로 이동했습니다.'
                    : '선택한 BOM 항목만 취소됐고 나머지 주문은 유지됩니다.'
                }}
              </p>
            </AlertDescription>
          </Alert>

          <template v-else-if="preview.cancelable">
            <!-- 범위 안내 — 주문 전체가 사라지면 위험(destructive), 줄만이면 주의(warning) -->
            <Alert :variant="preview.cancelsWholeOrder ? 'destructive' : 'warning'" size="sm">
              <AlertDescription>
                <p v-if="preview.cancelsWholeOrder" class="text-destructive font-semibold">
                  이 Case가 마지막 활성 항목이어서 주문 전체가 취소됩니다.
                </p>
                <p v-else class="text-warning font-semibold">
                  이 BOM 항목만 취소되며 다른 활성 항목 {{ preview.activeSiblingCount }}개는 유지됩니다.
                </p>
                <p class="mt-1 text-xs">취소금액·미수금·세액은 영카트 규칙으로 다시 계산됩니다.</p>
              </AlertDescription>
            </Alert>

            <Field>
              <FieldLabel for="bom-order-cancel-reason">
                취소 사유
                <span class="text-destructive">*</span>
              </FieldLabel>
              <Textarea
                id="bom-order-cancel-reason"
                v-model="reason"
                rows="3"
                maxlength="500"
                placeholder="예: 고객 요청으로 결제 전 일부 주문 취소"
              />
              <FieldDescription>영카트 주문 변경이력에 기록됩니다.</FieldDescription>
            </Field>
            <p v-if="validationError !== ''" class="text-destructive text-sm">{{ validationError }}</p>
            <Alert v-if="actionError !== ''" variant="destructive" size="sm">
              <AlertDescription>{{ actionError }}</AlertDescription>
            </Alert>
            <p class="text-muted-foreground text-xs leading-5">
              고객 안내 메일은 자동 발송되지 않습니다. 취소된 견적은 고객 화면에서 다시 주문할 수 있습니다.
            </p>
          </template>

          <!-- 차단 사유는 긴 문장일 수 있어 본문 첫 줄에 둔다 -->
          <Alert v-else variant="warning" size="sm">
            <TriangleAlertIcon />
            <AlertDescription>
              <p class="text-warning font-semibold">
                {{
                  preview.blockReason === null
                    ? '이 화면에서 취소할 수 없습니다.'
                    : BOM_ORDER_CANCEL_BLOCK_LABELS[preview.blockReason]
                }}
              </p>
              <p v-if="preview.poCount > 0" class="mt-1 text-xs">연결된 발주서 {{ preview.poCount }}건</p>
              <p class="mt-1 text-xs">결제 승인 취소나 환불을 확인하기 전에 로컬 주문 상태를 먼저 변경하지 않습니다.</p>
            </AlertDescription>
          </Alert>
        </template>
      </div>

      <DialogFooter>
        <Button v-if="showOpenCase" variant="outline" @click="emit('openCase')">BOM Case 확인</Button>
        <Button v-if="showYoungcart && preview !== null" variant="outline" as-child>
          <a :href="preview.youngcartOrderUrl" target="_blank" rel="noopener noreferrer">
            영카트 주문관리에서 처리
            <ExternalLinkIcon />
          </a>
        </Button>
        <Button variant="outline" :disabled="cancelOrder.isPending.value" @click="close">
          {{ cancelOrder.isSuccess.value ? '확인' : '닫기' }}
        </Button>
        <Button
          v-if="preview?.cancelable === true && !cancelOrder.isSuccess.value"
          variant="destructive"
          :disabled="cancelOrder.isPending.value"
          @click="void submit()"
        >
          <Spinner v-if="cancelOrder.isPending.value" />
          {{ cancelOrder.isPending.value ? '취소 처리 중…' : 'BOM 주문 취소' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
