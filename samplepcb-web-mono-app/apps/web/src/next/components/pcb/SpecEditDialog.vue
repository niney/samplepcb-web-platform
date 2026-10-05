<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowRightIcon, TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { ADMIN_SPEC_REVISE_BLOCK_TEXT, type AdminSpecReviseResponseType } from '@sp/api-contract';
import {
  fetchPcbPricingPreview,
  useReviseSpec,
  type PcbPricingPreviewResult,
} from '@/admin/useAdminQuotes';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { PCB_SPEC_LABELS, pcbSpecFormFields } from '@/lib/pcb-spec';
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
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import SpecComboInput from './case-parts/SpecComboInput.vue';

// 제작 사양 수정(P4.2, D17) — 관리자가 전 필드를 고친다(사용자 결정 2026-08-07). 옛 PcbSpecEditModal 과 같은 API.
//
// 사양은 **가격의 입력**이라 저장하면 서버가 재견적까지 한 번에 한다(새 견적 발급 → 가격 재계산 →
// 장바구니 동기화). 그래서 이 화면의 일은 **무엇이 달라지고 무엇이 흔들리는지 보여주는 것**이다.
// 거버에서 파생된 값(크기·층수·파일 개수)도 막지 않는다 — 대신 그 사실을 경고한다(D14 와 같은 결).
const props = defineProps<{
  projectId: number;
  spec: Record<string, string | number>;
  qty: number;
  category: string;
  orderCategory?: string | null | undefined;
  finalPrice: number | null;
  autoPrice: number | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

/** 거버 업로드에서 뽑힌 값 — 손으로 고치면 실제 파일과 어긋난 채 제조로 넘어간다. */
const GERBER_DERIVED = new Set(['width', 'length', 'layers', 'differentDesign']);

// 항목 이름·순서·선택지는 거버 앱이 정본 — **이 유형에서 거버가 물어본 것만** 고객이 본 순서대로.
// 유형이 안 잡히면(이관분) 합집합을 낸다 — 그때는 좁힐 근거가 없다.
const fields = pcbSpecFormFields({
  category: props.category,
  orderCategory: props.orderCategory,
  kindPcb: typeof props.spec.kindPcb === 'string' ? props.spec.kindPcb : null,
});

const draft = ref<Record<string, string>>(
  Object.fromEntries(fields.map((f) => [f.key, String(props.spec[f.key] ?? '')])),
);
// 유형 밖 키(이관분·수기 입력)도 draft 에 싣는다 — save() 는 draft 만 보내므로 여기서 빠뜨리면
// **저장하는 순간 그 값이 지워진다**. 값이 있는 것만 화면에도 낸다.
const extraKeys = Object.keys(props.spec).filter(
  (k) => !k.startsWith('_') && !fields.some((f) => f.key === k),
);
for (const k of extraKeys) draft.value[k] = String(props.spec[k] ?? '');
const offTypeKeys = extraKeys.filter((k) => String(props.spec[k] ?? '').trim() !== '');

const qtyDraft = ref(String(props.qty));
const reason = ref('');
const result = ref<AdminSpecReviseResponseType['data'] | null>(null);
const error = ref('');

const reviseMut = useReviseSpec();

// ── 실시간 가격 변동 미리보기 ─────────────────────────
const previewData = ref<PcbPricingPreviewResult | null>(null);
const previewLoading = ref(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const currentPrice = computed<number | null>(() => props.autoPrice ?? props.finalPrice);

const priceDiff = computed<{
  amount: number;
  percent: number | null;
  type: 'increase' | 'decrease' | 'same';
} | null>(() => {
  const current = currentPrice.value;
  const next = previewData.value?.price ?? null;
  if (current === null || next === null) return null;
  const diff = next - current;
  if (diff === 0) return { amount: 0, percent: 0, type: 'same' };
  const pct = current > 0 ? (diff / current) * 100 : null;
  return { amount: diff, percent: pct, type: diff > 0 ? 'increase' : 'decrease' };
});

const updatePreview = (): void => {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  const q = Number(qtyDraft.value);
  if (!Number.isInteger(q) || q <= 0) {
    previewData.value = null;
    previewLoading.value = false;
    return;
  }
  previewLoading.value = true;
  debounceTimer = setTimeout(() => {
    const cleanSpec: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft.value)) {
      if (v.trim() !== '') cleanSpec[k] = v.trim();
    }
    void fetchPcbPricingPreview(props.category, q, cleanSpec)
      .then((res) => {
        previewData.value = res;
      })
      .finally(() => {
        previewLoading.value = false;
      });
  }, 300);
};

watch([draft, qtyDraft], updatePreview, { deep: true, immediate: true });

onBeforeUnmount(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
});

const rows = computed(() => [
  ...fields.map((f) => ({ key: f.key, label: f.label })),
  ...extraKeys.map((k) => ({ key: k, label: PCB_SPEC_LABELS[k] ?? k })),
]);

/** 지금 무엇이 달라졌나 — 저장 전에 보여준다(사양은 값이 많아 놓치기 쉽다). */
const changed = computed(() =>
  rows.value
    .filter((r) => String(props.spec[r.key] ?? '') !== draft.value[r.key])
    .map((r) => ({
      key: r.key,
      label: r.label,
      before: String(props.spec[r.key] ?? '') === '' ? '—' : String(props.spec[r.key] ?? ''),
      after: draft.value[r.key] === '' ? '—' : draft.value[r.key],
      gerber: GERBER_DERIVED.has(r.key),
    })),
);
const qtyChanged = computed(() => Number(qtyDraft.value) !== props.qty);
const touchedGerber = computed(() => changed.value.some((c) => c.gerber));

// 사유는 선택 입력 — 바뀐 게 있고 수량이 유효하면 저장할 수 있다.
const canSave = computed(
  () =>
    (changed.value.length > 0 || qtyChanged.value) &&
    Number(qtyDraft.value) > 0 &&
    !reviseMut.isPending.value,
);

async function save(): Promise<void> {
  if (!canSave.value) return;
  error.value = '';
  // 빈 값은 키 자체를 뺀다 — 빈 문자열을 남기면 사양에 유령 키가 쌓인다.
  const spec: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.value)) {
    if (v.trim() !== '') spec[k] = v.trim();
  }
  try {
    const res = await reviseMut.mutateAsync({
      projectId: props.projectId,
      body: {
        spec,
        ...(qtyChanged.value ? { qty: Number(qtyDraft.value) } : {}),
        ...(reason.value.trim() === '' ? {} : { reason: reason.value.trim() }),
      },
    });
    result.value = res.data;
    emit('saved');
  } catch (e) {
    if (e instanceof ApiRequestError) {
      const code = e.payload?.error;
      error.value =
        code === 'PO_ISSUED' || code === 'REQUOTE_RFQ_IN_CART'
          ? ADMIN_SPEC_REVISE_BLOCK_TEXT[code]
          : (e.payload?.message ?? '저장에 실패했습니다.');
    } else {
      error.value = '저장에 실패했습니다.';
    }
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
const setDraft = (key: string, value: string): void => {
  draft.value[key] = value;
};
const setQty = (value: string | number): void => {
  qtyDraft.value = String(value);
};
const setReason = (value: string | number): void => {
  reason.value = String(value);
};
const previewPriceLabel = computed(() => {
  const price = previewData.value?.price ?? null;
  if (price !== null) return fmtPcbAmount('KRW', price);
  return previewLoading.value ? '계산 중…' : '자동견적 불가 (RFQ)';
});
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-5xl">
      <DialogHeader>
        <p class="text-primary text-xs font-semibold">제작 사양 수정</p>
        <DialogTitle>{{ category }} · Q{{ projectId }}</DialogTitle>
        <DialogDescription>
          저장하면 <b class="text-foreground">견적이 새로 발급되고 가격이 다시 계산</b>됩니다.
          이전 사양은 견적 이력에 그대로 남습니다.
        </DialogDescription>
      </DialogHeader>

      <!-- ③ 결과 -->
      <template v-if="result !== null">
        <div class="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
          <div class="border-success/30 bg-success-soft text-success rounded-lg border p-4 text-sm">
            <p class="font-semibold">사양을 수정했습니다 — {{ result.changedKeys.length }}개 항목</p>
            <p class="mt-1 text-xs">새 견적 {{ result.quoteId.slice(0, 8) }}… 발급</p>
          </div>

          <div class="rounded-lg border p-4">
            <p class="text-muted-foreground text-xs font-semibold">자동견적가</p>
            <p class="mt-1 flex flex-wrap items-center gap-2 text-sm tabular-nums">
              <span class="text-muted-foreground line-through">{{ fmtPcbAmount('KRW', result.previousAutoPrice) }}</span>
              <ArrowRightIcon class="text-muted-foreground size-4" />
              <b :class="result.autoPrice === null ? 'text-warning' : ''">
                {{ result.autoPrice === null ? '자동견적 불가 — 확정가를 매겨야 합니다' : fmtPcbAmount('KRW', result.autoPrice) }}
              </b>
            </p>
          </div>

          <p v-if="result.orderRowSynced" class="border-info/30 bg-info-soft text-info rounded-lg border p-3 text-sm font-medium">
            주문된 건이라 주문행의 사양 표기도 함께 갱신했습니다 — 결제 금액은 바뀌지 않습니다.
          </p>
          <p v-if="result.finalPriceStale" class="border-warning/30 bg-warning-soft text-warning flex gap-2 rounded-lg border p-3 text-sm font-medium">
            <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
            확정가의 근거가 된 사양이 바뀌었습니다 — 확정가를 다시 매겨 주세요.
          </p>
          <p v-if="result.answeredRfqCount > 0" class="border-warning/30 bg-warning-soft text-warning flex gap-2 rounded-lg border p-3 text-sm font-medium">
            <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
            이미 회신받은 협력사 견적이 {{ result.answeredRfqCount }}건 있습니다 — 바뀐 사양으로 재확인이 필요합니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="emit('close')">닫기</Button>
        </DialogFooter>
      </template>

      <!-- ① 편집 -->
      <template v-else>
        <div class="-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">
          <Field class="max-w-52">
            <FieldLabel for="spec-edit-qty">수량 (매)</FieldLabel>
            <Input id="spec-edit-qty" :model-value="qtyDraft" type="number" min="1" @update:model-value="setQty" />
          </Field>

          <!-- 이 유형에서 거버가 물어보는 칸만, 거버가 물어본 순서로. 선택지가 있으면 콤보로
               유도하되 직접 입력을 막지 않는다(협의 사양은 선택지에 없다). -->
          <div class="mt-4 grid gap-x-3.5 gap-y-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            <div v-for="f in fields" :key="f.key">
              <span
                class="flex items-center gap-1 text-xs font-medium"
                :class="GERBER_DERIVED.has(f.key) ? 'text-warning' : 'text-muted-foreground'"
              >
                {{ f.label }}
                <TriangleAlertIcon v-if="GERBER_DERIVED.has(f.key)" class="size-3" aria-label="거버 파일에서 뽑은 값입니다" />
                <span v-if="String(spec[f.key] ?? '') !== draft[f.key]" class="text-primary" title="수정됨">•</span>
              </span>
              <div class="mt-1">
                <SpecComboInput
                  :model-value="draft[f.key]"
                  :options="f.options"
                  @update:model-value="(value: string) => setDraft(f.key, value)"
                />
              </div>
            </div>
          </div>

          <!-- 이 유형에 없는데 값이 들어 있는 칸 — 이관분·수기 입력. 숨기면 고칠 수도 없다. -->
          <details v-if="offTypeKeys.length > 0" class="mt-4">
            <summary class="text-muted-foreground hover:bg-accent inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium">
              이 유형에 없는 항목 {{ offTypeKeys.length }}개
            </summary>
            <div class="mt-2.5 grid gap-x-3.5 gap-y-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              <div v-for="k in offTypeKeys" :key="k">
                <span class="text-muted-foreground text-xs font-medium">{{ PCB_SPEC_LABELS[k] ?? k }}</span>
                <div class="mt-1">
                  <SpecComboInput
                    :model-value="draft[k]"
                    :options="[]"
                    @update:model-value="(value: string) => setDraft(k, value)"
                  />
                </div>
              </div>
            </div>
          </details>
        </div>

        <div class="-mx-6 max-h-[45dvh] shrink-0 space-y-2.5 overflow-y-auto overscroll-contain border-t px-6 pt-4">
          <!-- 변경 요약 — 사양은 값이 많아 무엇을 건드렸는지 놓치기 쉽다 -->
          <div v-if="changed.length > 0 || qtyChanged" class="border-info/30 bg-info-soft/40 rounded-lg border p-3">
            <p class="text-info text-xs font-semibold">변경 {{ changed.length + (qtyChanged ? 1 : 0) }}건</p>
            <ul class="mt-1.5 space-y-0.5 text-xs">
              <li v-if="qtyChanged">
                <b>수량</b> <span class="text-muted-foreground">{{ qty }}</span> → <b>{{ qtyDraft }}</b>
              </li>
              <li v-for="c in changed" :key="c.key" class="flex flex-wrap items-center gap-1" :class="c.gerber ? 'text-warning' : ''">
                <b>{{ c.label }}</b>
                <span class="text-muted-foreground">{{ c.before }}</span> → <b>{{ c.after }}</b>
                <Badge v-if="c.gerber" variant="warning">거버 파생</Badge>
              </li>
            </ul>
          </div>

          <!-- 실시간 예상 가격 미리보기 -->
          <div class="border-info/30 bg-info-soft/40 rounded-lg border p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-info text-xs font-semibold">실시간 예상 가격 미리보기</span>
                <span v-if="previewLoading" class="text-info inline-flex items-center gap-1 text-xs">
                  <Spinner class="size-3" />
                  계산 중…
                </span>
              </div>
              <span v-if="previewData?.eta" class="text-muted-foreground text-xs">
                예상 납기: {{ previewData.eta }} ({{ previewData.buildTimeWithUnit }})
              </span>
            </div>

            <div class="border-info/20 mt-1.5 flex flex-wrap items-baseline justify-between gap-2 border-t pt-2 text-xs">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="text-muted-foreground">현재:</span>
                <span class="font-semibold tabular-nums">
                  {{ currentPrice !== null ? fmtPcbAmount('KRW', currentPrice) : '—' }}
                </span>
                <ArrowRightIcon class="text-muted-foreground size-3" />
                <span class="text-muted-foreground">변경 예상:</span>
                <b
                  class="text-sm tabular-nums"
                  :class="previewData !== null && previewData.price === null ? 'text-warning' : ''"
                >
                  {{ previewPriceLabel }}
                </b>
              </div>

              <!-- 변동액 -->
              <template v-if="priceDiff !== null && !previewLoading">
                <Badge v-if="priceDiff.type === 'increase'" variant="warning">
                  ▲ +{{ fmtPcbAmount('KRW', priceDiff.amount) }}
                  <template v-if="priceDiff.percent !== null">({{ priceDiff.percent > 0 ? '+' : '' }}{{ priceDiff.percent.toFixed(1) }}%)</template>
                </Badge>
                <Badge v-else-if="priceDiff.type === 'decrease'" variant="success">
                  ▼ {{ fmtPcbAmount('KRW', priceDiff.amount) }}
                  <template v-if="priceDiff.percent !== null">({{ priceDiff.percent.toFixed(1) }}%)</template>
                </Badge>
                <Badge v-else variant="secondary">변동 없음</Badge>
              </template>
            </div>
          </div>

          <p v-if="touchedGerber" class="border-warning/40 bg-warning-soft text-warning flex gap-2 rounded-lg border p-3 text-xs leading-5 font-medium">
            <TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
            거버 파일에서 뽑은 값을 고쳤습니다. 화면 사양과 실제 거버가 어긋난 채로 제조에 넘어갈 수
            있습니다 — 파일이 바뀐 것이라면 거버를 다시 받는 편이 안전합니다.
          </p>
          <p v-if="finalPrice !== null" class="text-muted-foreground text-xs">
            확정가 {{ fmtPcbAmount('KRW', finalPrice) }} 가 매겨져 있습니다 — 사양이 바뀌면 다시 매겨야 합니다.
          </p>

          <Field>
            <FieldLabel for="spec-edit-reason">
              수정 사유 <span class="text-muted-foreground font-normal">선택</span>
            </FieldLabel>
            <Input
              id="spec-edit-reason"
              :model-value="reason"
              type="text"
              maxlength="1000"
              placeholder="예) 고객 요청 — 표면처리 무연HASL → OSP 변경"
              @update:model-value="setReason"
            />
          </Field>

          <p v-if="error !== ''" class="text-destructive text-sm font-medium">{{ error }}</p>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="emit('close')">취소</Button>
          <Button :disabled="!canSave" @click="void save()">
            {{ reviseMut.isPending.value ? '저장 중…' : '저장하고 재견적' }}
          </Button>
        </DialogFooter>
      </template>
    </DialogContent>
  </Dialog>
</template>
