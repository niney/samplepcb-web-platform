<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CircleAlertIcon, TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  ADMIN_DELETE_BLOCK_TEXT,
  ADMIN_DELETE_WARNING_TEXT,
  type AdminDeletePreviewItemType,
} from '@sp/api-contract';
import { useDeletePreview, useDeleteQuotes } from '@/admin/useAdminQuotes';
import { formatKrw } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Label } from '@/next/components/ui/label';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';

// 견적 완전삭제 — 단건/다중 공통(ids 1개 = 단건). 옛 components/admin/DeleteQuoteModal.vue 의 포트.
// 호출부가 v-if 로 띄우고 close·deleted 로 내린다(열린 채로 마운트된다).
//
// 3단 위험 레이어(SmartBOM Case 삭제와 같은 구성):
//   ① impact  — 서버가 계산한 삭제 영향과 차단 사유를 건별로 확인
//   ② confirm — 강제 해제·감사 생략·사유·복구 불가 최종 확인
//   ③ result  — 삭제/차단/실패를 한 화면에서 정직하게 보고
// 차단은 서버 판정이 정본이지만 전부 우회할 수 있다(관리자 결정 2026-08-06). 그래서 이 화면의
// 일은 막는 게 아니라 무엇을 각오하는지 끝까지 보여주는 것 — 차단 사유는 건별로 빠짐없이,
// SHARED_ORDER(선택하지 않은 형제 견적의 주문까지 지움)는 강제 체크 옆에 따로 못 박는다.
const props = defineProps<{ ids: number[] }>();
const emit = defineEmits<{ close: []; deleted: [] }>();
const i18n = useI18n();
const { t } = i18n;

type Step = 'impact' | 'confirm' | 'result';
const step = ref<Step>('impact');
const reason = ref('');
const forceDeleteAll = ref(false);
const skipAudit = ref(false);
const acknowledged = ref(false);

const {
  mutate: loadPreview,
  data: previewData,
  isPending: previewLoading,
  isError: previewFailed,
} = useDeletePreview();
const preview = computed(() => previewData.value?.data ?? null);

const { mutate: runDelete, data: deleteData, isPending: deleting, error: deleteError } = useDeleteQuotes();
const deleteResult = computed(() => deleteData.value?.data ?? null);

// 강제 해제를 켜면 차단된 건이 전부 삭제 대상으로 옮겨온다 — 서버 판정과 같은 규칙.
const items = computed<AdminDeletePreviewItemType[]>(() => preview.value?.items ?? []);
const blockedItems = computed(() => items.value.filter((i) => !i.deletable));
const targetItems = computed(() => items.value.filter((i) => i.deletable || forceDeleteAll.value));
const sharedOrderItems = computed(() => items.value.filter((i) => i.blockReasons.includes('SHARED_ORDER')));

// 1차 합산은 선택분 전체 기준 — 삭제 가능분만 세면 "강제하면 무엇이 더 사라지는지"가 감춰진다.
const impact = computed(() => {
  const sum = { files: 0, rfqs: 0, pos: 0, shipments: 0, attachments: 0, orders: 0, carts: 0 };
  for (const i of items.value) {
    sum.files += i.fileCount;
    sum.rfqs += i.pcb.rfqs;
    sum.pos += i.pcb.pos;
    sum.shipments += i.pcb.shipments;
    sum.attachments += i.pcb.attachments;
    if (i.deletesOrder || i.odId !== null) sum.orders += 1;
    if (i.removesCartRow) sum.carts += 1;
  }
  return sum;
});
const impactCells = computed(() => [
  { label: t('admin.quotes.deleteModal.impactFiles'), value: String(impact.value.files) },
  {
    label: t('admin.quotes.deleteModal.impactPartner'),
    value: `${String(impact.value.rfqs)} · ${String(impact.value.pos)} · ${String(impact.value.shipments)}`,
  },
  { label: t('admin.quotes.deleteModal.impactAttach'), value: String(impact.value.attachments) },
  {
    label: t('admin.quotes.deleteModal.impactOrder'),
    value: `${String(impact.value.orders)} · ${String(impact.value.carts)}`,
  },
]);
const summaryWarnings = computed(() => preview.value?.summary.warnings ?? []);
const failedResults = computed(() => deleteResult.value?.results.filter((r) => r.outcome !== 'deleted') ?? []);

const canContinue = computed(() => !previewLoading.value && items.value.length > 0);
const canSubmit = computed(() => targetItems.value.length > 0 && acknowledged.value);

const errorMessage = computed<string>(() => {
  const err = deleteError.value;
  if (err === null) return '';
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.quotes.error.${code}`)) return t(`admin.quotes.error.${code}`);
    return err.payload?.message ?? t('admin.quotes.error.UNKNOWN');
  }
  return t('admin.quotes.error.UNKNOWN');
});

// 강제·감사 생략 선택을 바꾸면 복구 불가 확인을 다시 받는다.
const setForce = (value: boolean | 'indeterminate'): void => {
  forceDeleteAll.value = value === true;
  acknowledged.value = false;
};
const setSkipAudit = (value: boolean | 'indeterminate'): void => {
  skipAudit.value = value === true;
  acknowledged.value = false;
};
const setAcknowledged = (value: boolean | 'indeterminate'): void => {
  acknowledged.value = value === true;
};

function openConfirm(): void {
  if (!canContinue.value) return;
  step.value = 'confirm';
}
function backToImpact(): void {
  if (deleting.value) return;
  step.value = 'impact';
  forceDeleteAll.value = false;
  skipAudit.value = false;
  reason.value = '';
  acknowledged.value = false;
}
function submitDelete(): void {
  if (!canSubmit.value) return;
  runDelete(
    {
      ids: props.ids,
      reason: reason.value.trim(),
      ...(forceDeleteAll.value ? { forceDeleteAll: true } : {}),
      ...(skipAudit.value ? { skipAudit: true } : {}),
    },
    {
      onSuccess: () => {
        step.value = 'result';
      },
    },
  );
}
function close(): void {
  if (deleting.value) return;
  if (deleteResult.value !== null) emit('deleted');
  else emit('close');
}
const onOpenChange = (open: boolean): void => {
  if (!open) close();
};

onMounted(() => {
  loadPreview(props.ids);
});
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <!-- ① 1차 레이어 — 서버가 계산한 삭제 영향과 차단 사유 -->
    <DialogContent v-if="step === 'impact'" class="sm:max-w-3xl">
      <DialogHeader>
        <DialogDescription>{{ t('admin.quotes.deleteModal.step1Over') }}</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            {{ t('admin.quotes.deleteModal.step1Title', { n: ids.length }) }}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div class="-mx-6 max-h-[65vh] space-y-4 overflow-y-auto px-6">
        <p v-if="previewLoading" class="text-muted-foreground flex items-center justify-center gap-2 py-14 text-sm">
          <Spinner />
          {{ t('admin.quotes.deleteModal.loading') }}
        </p>
        <p
          v-else-if="previewFailed || preview === null"
          class="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border p-4 text-sm"
        >
          {{ t('admin.quotes.error.UNKNOWN') }}
        </p>
        <template v-else>
          <!-- 통계 3칸 — 차단은 전부 강제 가능하므로 '보호됨' 칸은 없다 -->
          <div class="grid grid-cols-3 gap-2">
            <div class="bg-muted/40 rounded-lg border p-3 text-center">
              <p class="text-muted-foreground text-xs">{{ t('admin.quotes.deleteModal.statSelected') }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums">{{ ids.length }}</p>
            </div>
            <div class="border-success/30 bg-success-soft text-success rounded-lg border p-3 text-center">
              <p class="text-xs">{{ t('admin.quotes.deleteModal.statDeletable') }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums">{{ preview.summary.deletableCount }}</p>
            </div>
            <div class="border-warning/30 bg-warning-soft text-warning rounded-lg border p-3 text-center">
              <p class="text-xs">{{ t('admin.quotes.deleteModal.statForceable') }}</p>
              <p class="mt-1 text-xl font-semibold tabular-nums">{{ blockedItems.length }}</p>
            </div>
          </div>

          <!-- 합산 영향 -->
          <section v-if="items.length > 0" class="border-destructive/30 rounded-lg border p-4">
            <p class="text-destructive text-sm font-semibold">
              {{ t('admin.quotes.deleteModal.impactTitle', { n: items.length }) }}
            </p>
            <dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div v-for="cell in impactCells" :key="cell.label" class="bg-muted/40 rounded-md p-3">
                <dt class="text-muted-foreground text-xs">{{ cell.label }}</dt>
                <dd class="mt-1 font-semibold tabular-nums">{{ cell.value }}</dd>
              </div>
            </dl>
          </section>

          <!-- 건별 카드 -->
          <ul class="space-y-2">
            <li
              v-for="it in items"
              :key="it.projectId"
              class="rounded-lg border p-3"
              :class="it.deletable ? '' : 'border-warning/40 bg-warning-soft/40'"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-muted-foreground flex items-center gap-1.5 font-mono text-xs">
                    Q{{ it.projectId }}
                    <Badge v-if="it.isLegacy" variant="outline">{{ t('admin.quotes.deleteModal.tagLegacy') }}</Badge>
                  </p>
                  <p class="truncate text-sm font-medium">{{ it.projectName }}</p>
                  <p class="text-muted-foreground mt-0.5 text-xs">
                    <template v-if="it.odId !== null">
                      {{ t('admin.quotes.deleteModal.orderTitle') }} {{ it.odId }} ({{ it.odStatus }})
                    </template>
                    <template v-else-if="it.cartState === 'cart'">{{ t('admin.quotes.deleteModal.tagCart') }}</template>
                    <template v-else>—</template>
                  </p>
                </div>
                <Badge :variant="it.deletable ? 'success' : 'warning'">
                  {{
                    it.deletable
                      ? t('admin.quotes.deleteModal.badgeDeletable')
                      : t('admin.quotes.deleteModal.badgeForceable')
                  }}
                </Badge>
              </div>
              <p class="text-muted-foreground mt-2 text-xs">
                {{ t('admin.quotes.deleteModal.totalFiles', { n: it.fileCount }) }} · RFQ {{ it.pcb.rfqs }} · 발주
                {{ it.pcb.pos }} · 선적 {{ it.pcb.shipments }}
              </p>
              <!-- 차단 사유는 전부 — 강제 삭제로 넘길 수 있는 만큼 대가를 다 보여준다 -->
              <ul v-if="it.blockReasons.length > 0" class="text-warning mt-2 space-y-1 text-xs">
                <li v-for="code in it.blockReasons" :key="code">• {{ ADMIN_DELETE_BLOCK_TEXT[code] }}</li>
              </ul>
            </li>
          </ul>

          <!-- 주문 그룹(1:N) — 선택 안 된 형제 견적 경고 -->
          <section
            v-for="g in preview.orderGroups"
            :key="g.odId"
            class="border-warning/30 bg-warning-soft rounded-lg border p-4 text-xs"
          >
            <p class="text-warning font-semibold">
              {{ t('admin.quotes.deleteModal.orderTitle') }} #{{ g.odId }}
              <span class="font-normal">({{ g.odStatus }} · {{ formatKrw(g.receiptPrice) }})</span>
            </p>
            <p v-if="g.selectedCount > 1" class="mt-1">
              {{ t('admin.quotes.deleteModal.orderSelected', { n: g.selectedCount }) }}
            </p>
            <div v-if="g.unselectedSiblings.length > 0" class="text-destructive mt-1">
              <p class="font-semibold">{{ t('admin.quotes.deleteModal.siblingsWarn') }}</p>
              <ul class="ml-4 list-disc">
                <li v-for="(name, i) in g.unselectedSiblings" :key="i">{{ name }}</li>
              </ul>
            </div>
          </section>

          <ul
            v-if="summaryWarnings.length > 0"
            class="border-warning/30 bg-warning-soft text-warning space-y-1 rounded-lg border p-4 text-xs"
          >
            <li v-for="w in summaryWarnings" :key="w" class="flex gap-1.5">
              <CircleAlertIcon class="mt-0.5 size-3.5 shrink-0" />
              {{ ADMIN_DELETE_WARNING_TEXT[w] }}
            </li>
          </ul>

          <p v-if="blockedItems.length > 0" class="text-warning text-xs font-medium">
            {{ t('admin.quotes.deleteModal.blockedForceable', { n: blockedItems.length }) }}
          </p>
          <p v-if="preview.notFound.length > 0" class="text-muted-foreground text-xs">
            {{ t('admin.quotes.deleteModal.notFound', { n: preview.notFound.length }) }}
          </p>
        </template>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="close">{{ t('admin.quotes.deleteModal.cancel') }}</Button>
        <Button variant="destructive" :disabled="!canContinue" @click="openConfirm">
          {{
            items.length === 0
              ? t('admin.quotes.deleteModal.continueNone')
              : t('admin.quotes.deleteModal.continueN', { n: items.length })
          }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ② 2차 레이어 — 강제 해제·사유·복구 불가 최종 확인 -->
    <DialogContent v-else-if="step === 'confirm' && preview !== null" class="sm:max-w-xl">
      <DialogHeader>
        <DialogDescription>{{ t('admin.quotes.deleteModal.step2Over') }}</DialogDescription>
        <DialogTitle>
          <span class="flex items-center gap-2">
            <TriangleAlertIcon class="text-destructive size-5" />
            {{ t('admin.quotes.deleteModal.step2Title') }}
          </span>
        </DialogTitle>
      </DialogHeader>

      <div class="-mx-6 max-h-[60vh] space-y-4 overflow-y-auto px-6">
        <section class="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border p-4 text-sm">
          <p class="font-semibold">{{ t('admin.quotes.deleteModal.confirmN', { n: targetItems.length }) }}</p>
          <ul class="mt-2 space-y-0.5 text-xs">
            <li v-for="it in targetItems" :key="it.projectId" class="truncate">
              <span class="font-mono">Q{{ it.projectId }}</span> {{ it.projectName }}
            </li>
          </ul>
        </section>

        <!-- 강제 해제 — 차단 전부를 넘긴다. 넘기는 대가를 사유별로 나열한다. -->
        <label
          v-if="blockedItems.length > 0"
          class="border-destructive/50 bg-destructive-soft flex cursor-pointer gap-3 rounded-lg border p-4"
        >
          <Checkbox :model-value="forceDeleteAll" class="mt-0.5" @update:model-value="setForce" />
          <span class="text-destructive min-w-0 space-y-1.5">
            <span class="block text-sm font-semibold">
              {{ t('admin.quotes.deleteModal.forceLabel', { n: blockedItems.length }) }}
            </span>
            <span class="block text-xs">{{ t('admin.quotes.deleteModal.forceDesc') }}</span>
            <span class="block space-y-0.5 text-xs">
              <span v-for="code in preview.summary.blockReasons" :key="code" class="block">
                • {{ ADMIN_DELETE_BLOCK_TEXT[code] }}
              </span>
            </span>
            <!-- 남의 견적까지 지우는 유일한 사유라 따로 못 박는다 -->
            <span
              v-if="sharedOrderItems.length > 0"
              class="bg-destructive text-destructive-foreground block rounded-md px-3 py-2 text-xs font-semibold"
            >
              {{ t('admin.quotes.deleteModal.forceSharedWarn', { n: sharedOrderItems.length }) }}
            </span>
          </span>
        </label>

        <!-- 감사기록 생략 — SmartBOM reset 모드와 같은 선택 -->
        <label class="border-destructive/30 flex cursor-pointer gap-3 rounded-lg border p-4">
          <Checkbox :model-value="skipAudit" class="mt-0.5" @update:model-value="setSkipAudit" />
          <span class="min-w-0 space-y-1">
            <span class="text-destructive block text-sm font-semibold">
              {{ t('admin.quotes.deleteModal.skipAuditLabel') }}
            </span>
            <span class="text-muted-foreground block text-xs">{{ t('admin.quotes.deleteModal.skipAuditDesc') }}</span>
          </span>
        </label>

        <div v-if="!skipAudit" class="space-y-1.5">
          <Label for="pcb-delete-reason">
            {{ t('admin.quotes.deleteModal.reasonLabel') }}
            <span class="text-muted-foreground font-normal">{{ t('admin.quotes.deleteModal.optional') }}</span>
          </Label>
          <Textarea
            id="pcb-delete-reason"
            v-model="reason"
            rows="3"
            maxlength="1000"
            :placeholder="t('admin.quotes.deleteModal.reasonPlaceholder')"
          />
        </div>

        <label class="border-warning/30 bg-warning-soft flex cursor-pointer items-start gap-2 rounded-lg border p-3">
          <Checkbox :model-value="acknowledged" class="mt-0.5" @update:model-value="setAcknowledged" />
          <span class="text-warning text-xs">{{ t('admin.quotes.deleteModal.ackLabel') }}</span>
        </label>

        <p v-if="errorMessage !== ''" class="text-destructive text-sm font-medium">{{ errorMessage }}</p>
      </div>

      <DialogFooter class="sm:justify-between">
        <Button variant="ghost" :disabled="deleting" @click="backToImpact">
          {{ t('admin.quotes.deleteModal.back') }}
        </Button>
        <Button variant="destructive" :disabled="!canSubmit || deleting" @click="submitDelete">
          <Spinner v-if="deleting" />
          {{
            deleting
              ? t('admin.quotes.deleteModal.deleting')
              : t('admin.quotes.deleteModal.confirmN', { n: targetItems.length })
          }}
        </Button>
      </DialogFooter>
    </DialogContent>

    <!-- ③ 결과 — 삭제·차단·실패를 한 화면에서 -->
    <DialogContent v-else-if="step === 'result' && deleteResult !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogDescription>{{ t('admin.quotes.deleteModal.resultOver') }}</DialogDescription>
        <DialogTitle>
          {{
            t('admin.quotes.deleteModal.resultTitle', {
              deleted: deleteResult.summary.deleted,
              kept: ids.length - deleteResult.summary.deleted,
            })
          }}
        </DialogTitle>
      </DialogHeader>

      <div class="-mx-6 max-h-[60vh] space-y-3 overflow-y-auto px-6">
        <section
          v-if="deleteResult.summary.deleted > 0"
          class="border-success/30 bg-success-soft text-success rounded-lg border p-4 text-sm"
        >
          <p class="font-semibold">{{ t('admin.quotes.deleteModal.confirmN', { n: deleteResult.summary.deleted }) }}</p>
          <p class="mt-2 text-xs">
            {{
              skipAudit ? t('admin.quotes.deleteModal.resultAuditSkipped') : t('admin.quotes.deleteModal.resultAudit')
            }}
          </p>
        </section>

        <section
          v-if="deleteResult.summary.blocked > 0 || deleteResult.summary.failed > 0"
          class="border-destructive/30 bg-destructive-soft text-destructive rounded-lg border p-4"
        >
          <p class="text-sm font-semibold">
            {{
              t('admin.quotes.deleteModal.resultSummary', {
                deleted: deleteResult.summary.deleted,
                blocked: deleteResult.summary.blocked,
                failed: deleteResult.summary.failed,
              })
            }}
          </p>
          <ul class="mt-2 space-y-1 text-xs">
            <li v-for="r in failedResults" :key="r.projectId">
              <span class="font-mono font-semibold">Q{{ r.projectId }}</span> —
              {{ r.blockReason === null ? '실패' : ADMIN_DELETE_BLOCK_TEXT[r.blockReason] }}
            </li>
          </ul>
        </section>
      </div>

      <DialogFooter>
        <Button @click="close">{{ t('admin.quotes.deleteModal.toList') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
