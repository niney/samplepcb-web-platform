<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  SMARTSMT_REVIEW_STATUS_LABELS,
  computeSmartsmtSheet,
  readSmartsmtSheetInput,
  smartsmtLabel,
  type AdminSmtReviewType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Textarea } from '@/next/components/ui/textarea';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { smtBlockNames, smtLineStatusBadge } from './smt-badges';
import { smtAmount, smtCount, smtDateTime } from './smt-format';
import { parseSheetAmount, readSmtSheet, type SmtSheetRow } from './smt-sheet';
import { useResetSmtReview, useSaveSmtReview } from './useAdminSmt';

// 견적서 — SmartSMT 「통합 견적서」와 같은 순서의 표에서 **항목별로 금액을 고친다**(docs/SMARTSMT_INTEGRATION.md §9).
//
//   · 왼쪽 금액은 SmartSMT 가 계산해 온 값, 오른쪽 입력칸이 관리자가 정하는 값이다. 비워 두면 SmartSMT 금액 그대로.
//   · 총액은 입력하지 않는다 — 간접비 · 기업이윤 · 부가세는 항목에서 계산돼 나온다(계약 computeSmartsmtSheet,
//     요율은 견적서가 실어 온 값). 저장할 때 서버가 같은 계산을 다시 한다.
//   · 빈 금액(미정)이 하나도 없어야 확정할 수 있다. 0원은 정한 금액이다.
const props = defineProps<{
  quoteRowId: number;
  envelope: Readonly<Record<string, unknown>>;
  review: AdminSmtReviewType | null;
  currency: string | null;
}>();

const sheet = computed(() => readSmtSheet(props.envelope));
const input = computed(() => readSmartsmtSheetInput(props.envelope));
const NONE = { lineAmounts: {}, blockAmounts: {} };

// 입력칸의 글자 — 줄은 'line:코드', 블록은 'block:이름'. 저장된 값에서 채우고, 다른 견적으로 옮기거나 저장하면 다시 채운다.
const texts = reactive<Record<string, string>>({});
const note = ref('');
const rowKey = (row: SmtSheetRow): string => `${row.kind}:${row.key}`;
const textOf = (row: SmtSheetRow): string => texts[rowKey(row)] ?? '';
const setText = (row: SmtSheetRow, value: string | number): void => {
  texts[rowKey(row)] = String(value);
};

function fill(): void {
  for (const key of Object.keys(texts)) Reflect.deleteProperty(texts, key);
  for (const [code, amount] of Object.entries(props.review?.lineAmounts ?? {})) texts[`line:${code}`] = String(amount);
  for (const [name, amount] of Object.entries(props.review?.blockAmounts ?? {})) texts[`block:${name}`] = String(amount);
  note.value = props.review?.customerNote ?? '';
}
watch(() => [props.quoteRowId, props.review?.updatedAt ?? null], fill, { immediate: true });

const allRows = computed<SmtSheetRow[]>(() => [
  ...sheet.value.blocks,
  ...sheet.value.groups.flatMap((group) => group.rows),
  ...sheet.value.extras,
]);
const parsed = computed(() => new Map(allRows.value.map((row) => [rowKey(row), parseSheetAmount(textOf(row))])));
const invalidKeys = computed(() => [...parsed.value].filter(([, value]) => value === undefined).map(([key]) => key));
const isInvalid = (row: SmtSheetRow): boolean => parsed.value.get(rowKey(row)) === undefined;

const edits = computed(() => {
  const lineAmounts: Record<string, number> = {};
  const blockAmounts: Record<string, number> = {};
  for (const row of allRows.value) {
    const value = parsed.value.get(rowKey(row));
    if (typeof value !== 'number') continue;
    if (row.kind === 'line') lineAmounts[row.key] = value;
    else blockAmounts[row.key] = value;
  }
  return { lineAmounts, blockAmounts };
});

/** SmartSMT 금액 그대로의 계산(가견적)과, 고친 금액을 넣은 계산. */
const base = computed(() => computeSmartsmtSheet(input.value, NONE));
const totals = computed(() => computeSmartsmtSheet(input.value, edits.value));

/** 이 줄에 지금 적용되는 금액 — 고친 값이 있으면 그 값, 없으면 SmartSMT 금액. */
const effective = (row: SmtSheetRow): number | null => {
  const value = parsed.value.get(rowKey(row));
  return typeof value === 'number' ? value : row.original;
};
const isEdited = (row: SmtSheetRow): boolean => typeof parsed.value.get(rowKey(row)) === 'number';

// 수량 0 인 줄(SmartSMT 견적서에도 없는 "미적용")은 접어 둔다 — 고친 값이 있는 줄은 늘 보인다.
const showIdle = ref(false);
const idleCount = computed(() => sheet.value.groups.flatMap((group) => group.rows).filter((row) => row.idle).length);
const visibleRows = (rows: readonly SmtSheetRow[]): SmtSheetRow[] =>
  showIdle.value ? [...rows] : rows.filter((row) => !row.idle || textOf(row) !== '');
const groupSum = (rows: readonly SmtSheetRow[]): { amount: number; unknown: number } => {
  let amount = 0;
  let unknown = 0;
  for (const row of rows) {
    const value = effective(row);
    if (value === null) unknown += 1;
    else amount += value;
  }
  return { amount, unknown };
};

// 저장된 것과 달라졌는가 — 고친 금액과 안내 글.
const sameAmounts = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};
const dirty = computed(() => {
  const saved = props.review;
  if (saved === null) {
    return Object.keys(edits.value.lineAmounts).length > 0 || Object.keys(edits.value.blockAmounts).length > 0 || note.value.trim() !== '';
  }
  return (
    !sameAmounts(edits.value.lineAmounts, saved.lineAmounts) ||
    !sameAmounts(edits.value.blockAmounts, saved.blockAmounts) ||
    note.value.trim() !== saved.customerNote
  );
});

const emptyItems = computed(() => {
  const lineNames = totals.value.unknownLines.map(
    (code) => allRows.value.find((row) => row.kind === 'line' && row.key === code)?.item ?? code,
  );
  return [...lineNames, ...(totals.value.unknownBlocks.length > 0 ? [smtBlockNames(totals.value.unknownBlocks)] : [])];
});

const save = useSaveSmtReview();
const reset = useResetSmtReview();
const busy = computed(() => save.isPending.value || reset.isPending.value);
const error = ref('');
const notice = ref('');
watch(
  () => props.quoteRowId,
  () => {
    error.value = '';
    notice.value = '';
  },
);

async function submit(confirm: boolean): Promise<void> {
  if (busy.value || invalidKeys.value.length > 0) return;
  error.value = '';
  notice.value = '';
  try {
    await save.mutateAsync({ id: props.quoteRowId, body: { ...edits.value, customerNote: note.value.trim(), confirm } });
    notice.value = confirm ? '확정했습니다.' : '임시 저장했습니다.';
  } catch (e) {
    error.value = e instanceof ApiRequestError && e.message !== '' ? e.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

async function revert(): Promise<void> {
  if (busy.value) return;
  error.value = '';
  notice.value = '';
  try {
    if (props.review !== null) await reset.mutateAsync(props.quoteRowId);
    else fill();
    notice.value = 'SmartSMT 가 보낸 금액으로 되돌렸습니다.';
  } catch (e) {
    error.value = e instanceof ApiRequestError && e.message !== '' ? e.message : '되돌리지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

const statusBadge = computed(() => {
  if (props.review === null) return { label: '고치지 않음', variant: 'secondary' as const };
  return {
    label: smartsmtLabel(SMARTSMT_REVIEW_STATUS_LABELS, props.review.status),
    variant: props.review.status === 'confirmed' ? ('success' as const) : ('warning' as const),
  };
});
const rateText = (rate: number): string => `${String(rate)}%`;
const hasRows = computed(() => allRows.value.length > 0);
</script>

<template>
  <SectionCard title="견적서" flush>
    <template #meta>
      <span class="inline-flex flex-wrap items-center gap-2">
        <Badge :variant="statusBadge.variant" data-testid="smt-review-status">{{ statusBadge.label }}</Badge>
        <span v-if="review !== null">
          {{ smtDateTime(review.updatedAt) }}<template v-if="review.updatedBy !== null"> · {{ review.updatedBy }}</template>
        </span>
        <span>항목의 금액을 고치면 간접비 · 기업이윤 · 부가세가 다시 계산됩니다. 비워 두면 SmartSMT 금액 그대로입니다.</span>
      </span>
    </template>
    <template #actions>
      <Button v-if="idleCount > 0" variant="ghost" size="xs" data-testid="smt-sheet-idle" @click="showIdle = !showIdle">
        {{ showIdle ? '수량 0 인 줄 접기' : `수량 0 인 줄 보기 (${String(idleCount)})` }}
      </Button>
    </template>
    <template #notice>
      <NoticeBand v-if="error !== ''" tone="destructive" role="alert">{{ error }}</NoticeBand>
      <NoticeBand v-else-if="notice !== ''" tone="info" role="status">{{ notice }}</NoticeBand>
      <NoticeBand v-if="emptyItems.length > 0" tone="warning" data-testid="smt-sheet-empty">
        금액이 비어 있는 항목 {{ emptyItems.length }}건 — {{ emptyItems.join(', ') }}. 모두 채워야 확정할 수 있습니다(받지 않으면 0).
      </NoticeBand>
    </template>

    <Table data-testid="smt-lines">
      <TableHeader>
        <TableRow>
          <TableHead>구분</TableHead>
          <TableHead>항목</TableHead>
          <TableHead>적용</TableHead>
          <TableHead class="text-right">수량</TableHead>
          <TableHead class="text-right">단가</TableHead>
          <TableHead class="text-right">SmartSMT 금액</TableHead>
          <TableHead class="w-40 text-right">확정 금액</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <!-- PCB · 부품 — 이 주문에서 사는 블록 -->
        <TableRow v-for="row in sheet.blocks" :key="rowKey(row)" :data-testid="`smt-row-${row.key}`">
          <TableCell class="text-muted-foreground text-xs">{{ row.item }}</TableCell>
          <TableCell class="font-medium">{{ row.item }}</TableCell>
          <TableCell class="text-muted-foreground">—</TableCell>
          <TableCell class="text-right tabular-nums">
            {{ smtCount(row.count) }}<span v-if="row.countUnit !== ''" class="text-muted-foreground ml-1 text-xs">{{ row.countUnit }}</span>
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ row.unitPrice === null ? '—' : smtAmount(row.unitPrice, currency) }}</TableCell>
          <TableCell class="text-right tabular-nums" :class="row.original === null ? 'text-warning' : ''">{{ smtAmount(row.original, currency) }}</TableCell>
          <TableCell class="text-right">
            <Input
              :model-value="textOf(row)"
              inputmode="numeric"
              class="h-7 text-right tabular-nums"
              :aria-label="`${row.item} 확정 금액`"
              :aria-invalid="isInvalid(row)"
              :placeholder="row.original === null ? '미정' : smtAmount(row.original, currency)"
              @update:model-value="(value) => setText(row, value)"
            />
          </TableCell>
          <TableCell>
            <Badge v-if="isEdited(row)" variant="info">고침</Badge>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
        </TableRow>

        <!-- 견적 줄 — 묶음별 -->
        <template v-for="group in sheet.groups" :key="group.key">
          <TableRow
            v-for="(row, index) in visibleRows(group.rows)"
            :key="rowKey(row)"
            :data-testid="`smt-row-${row.key}`"
          >
            <TableCell class="text-muted-foreground text-xs">{{ index === 0 ? group.label : '' }}</TableCell>
            <TableCell>
              <span class="block max-w-xs truncate font-medium" :title="row.item">{{ row.item }}</span>
              <span class="text-muted-foreground font-mono text-xs">{{ row.key }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground">
              <span class="block max-w-xs truncate" :title="row.formula">{{ row.formula === '' ? '—' : row.formula }}</span>
            </TableCell>
            <TableCell class="text-right tabular-nums">
              {{ smtCount(row.count) }}<span v-if="row.countUnit !== ''" class="text-muted-foreground ml-1 text-xs">{{ row.countUnit }}</span>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ row.unitPrice === null ? '—' : smtAmount(row.unitPrice, currency) }}</TableCell>
            <TableCell class="text-right tabular-nums" :class="row.original === null ? 'text-warning' : ''">{{ smtAmount(row.original, currency) }}</TableCell>
            <TableCell class="text-right">
              <Input
                :model-value="textOf(row)"
                inputmode="numeric"
                class="h-7 text-right tabular-nums"
                :aria-label="`${row.item} 확정 금액`"
                :aria-invalid="isInvalid(row)"
                :placeholder="row.original === null ? '미정' : smtAmount(row.original, currency)"
                @update:model-value="(value) => setText(row, value)"
              />
            </TableCell>
            <TableCell>
              <span class="inline-flex flex-wrap items-center gap-1">
                <Badge v-if="isEdited(row)" variant="info">고침</Badge>
                <Badge v-if="row.status !== null && row.status !== ''" :variant="smtLineStatusBadge(row.status).variant">
                  {{ smtLineStatusBadge(row.status).label }}
                </Badge>
                <span v-if="!isEdited(row) && (row.status === null || row.status === '')" class="text-muted-foreground">—</span>
              </span>
            </TableCell>
          </TableRow>
          <TableRow :data-testid="`smt-subtotal-${group.key}`">
            <TableCell colspan="6" class="text-right text-xs font-semibold">{{ group.label }} 소계</TableCell>
            <TableCell class="text-right font-semibold tabular-nums">
              <span class="mr-3">
                <span v-if="groupSum(group.rows).unknown > 0" class="text-warning mr-1 text-xs font-normal">미정 {{ groupSum(group.rows).unknown }}건 +</span>{{ smtAmount(groupSum(group.rows).amount, currency) }}
              </span>
            </TableCell>
            <TableCell />
          </TableRow>
        </template>

        <!-- 기타 — 간접비 · 기업이윤은 계산, 배송은 입력 -->
        <template v-if="hasRows">
          <TableRow data-testid="smt-row-indirect">
            <TableCell class="text-muted-foreground text-xs">기타</TableCell>
            <TableCell class="font-medium">간접비</TableCell>
            <TableCell class="text-muted-foreground">직접공정비 × 간접비율 {{ rateText(totals.rates.indirect) }}</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right tabular-nums">{{ smtAmount(base.indirectCost, currency) }}</TableCell>
            <TableCell class="text-right font-medium tabular-nums"><span class="mr-3">{{ smtAmount(totals.indirectCost, currency) }}</span></TableCell>
            <TableCell class="text-muted-foreground text-xs">자동 계산</TableCell>
          </TableRow>
          <TableRow data-testid="smt-row-profit">
            <TableCell />
            <TableCell class="font-medium">기업이윤</TableCell>
            <TableCell class="text-muted-foreground">(직접공정비 + 간접비) × 기업이윤율 {{ rateText(totals.rates.profit) }}</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right tabular-nums">{{ smtAmount(base.profit, currency) }}</TableCell>
            <TableCell class="text-right font-medium tabular-nums"><span class="mr-3">{{ smtAmount(totals.profit, currency) }}</span></TableCell>
            <TableCell class="text-muted-foreground text-xs">자동 계산</TableCell>
          </TableRow>
          <TableRow v-for="row in sheet.extras" :key="rowKey(row)" :data-testid="`smt-row-${row.key}`">
            <TableCell />
            <TableCell class="font-medium">{{ row.item }}</TableCell>
            <TableCell class="text-muted-foreground">관리자가 정합니다</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right text-muted-foreground">—</TableCell>
            <TableCell class="text-right tabular-nums" :class="row.original === null ? 'text-warning' : ''">{{ smtAmount(row.original, currency) }}</TableCell>
            <TableCell class="text-right">
              <Input
                :model-value="textOf(row)"
                inputmode="numeric"
                class="h-7 text-right tabular-nums"
                :aria-label="`${row.item} 확정 금액`"
                :aria-invalid="isInvalid(row)"
                :placeholder="row.original === null ? '미정' : smtAmount(row.original, currency)"
                @update:model-value="(value) => setText(row, value)"
              />
            </TableCell>
            <TableCell>
              <Badge v-if="isEdited(row)" variant="info">고침</Badge>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
          </TableRow>
        </template>
        <TableEmptyRow v-if="!hasRows" :colspan="8" text="견적서에 항목이 없습니다." />
      </TableBody>
    </Table>

    <!-- 합계 — 왼쪽은 SmartSMT 금액 그대로(고객 화면의 가견적과 같은 값), 오른쪽은 고친 금액을 넣은 계산 -->
    <div class="grid gap-x-8 gap-y-4 border-t px-4 py-3 md:grid-cols-2">
      <div class="flex flex-col gap-2">
        <label for="smt-review-note" class="text-muted-foreground text-xs font-medium">고객 안내 글</label>
        <Textarea
          id="smt-review-note"
          v-model="note"
          rows="4"
          maxlength="2000"
          placeholder="확정 금액과 함께 고객에게 알릴 내용 (납기, 확인할 것 등)"
        />
      </div>
      <dl class="flex flex-col gap-1 text-sm" data-testid="smt-costs">
        <div class="text-muted-foreground flex justify-between gap-4 text-xs">
          <dt />
          <dd class="flex gap-6"><span class="w-28 text-right">SmartSMT 금액</span><span class="w-28 text-right">확정 금액</span></dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">직접공정비 <span class="text-xs">(견적 줄의 합)</span></dt>
          <dd class="flex gap-6 tabular-nums"><span class="w-28 text-right">{{ smtAmount(base.directCost, currency) }}</span><span class="w-28 text-right">{{ smtAmount(totals.directCost, currency) }}</span></dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">간접비 · 기업이윤</dt>
          <dd class="flex gap-6 tabular-nums"><span class="w-28 text-right">{{ smtAmount(base.indirectCost + base.profit, currency) }}</span><span class="w-28 text-right">{{ smtAmount(totals.indirectCost + totals.profit, currency) }}</span></dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">PCB · 부품 · 배송</dt>
          <dd class="flex gap-6 tabular-nums"><span class="w-28 text-right">{{ smtAmount(base.blockSum, currency) }}</span><span class="w-28 text-right">{{ smtAmount(totals.blockSum, currency) }}</span></dd>
        </div>
        <div class="flex justify-between gap-4 border-t pt-1">
          <dt>공급가액</dt>
          <dd class="flex gap-6 tabular-nums"><span class="w-28 text-right">{{ smtAmount(base.supplyPrice, currency) }}</span><span class="w-28 text-right">{{ smtAmount(totals.supplyPrice, currency) }}</span></dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt>부가세 <span class="text-muted-foreground text-xs">{{ rateText(totals.rates.vat) }}</span></dt>
          <dd class="flex gap-6 tabular-nums"><span class="w-28 text-right">{{ smtAmount(base.vat, currency) }}</span><span class="w-28 text-right">{{ smtAmount(totals.vat, currency) }}</span></dd>
        </div>
        <div class="flex justify-between gap-4 border-t pt-1 font-semibold">
          <dt>총합계 <span class="text-muted-foreground text-xs font-normal">(VAT 포함)</span></dt>
          <dd class="flex gap-6 tabular-nums">
            <span class="w-28 text-right">{{ smtAmount(base.total, currency) }}</span>
            <span class="w-28 text-right" :class="totals.complete ? 'text-success' : 'text-warning'" data-testid="smt-review-total">{{ smtAmount(totals.total, currency) }}</span>
          </dd>
        </div>
        <p v-if="!totals.complete" class="text-muted-foreground text-xs">빈 금액은 0 으로 넣어 계산한 값입니다.</p>
      </dl>
    </div>

    <div class="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
      <span v-if="invalidKeys.length > 0" class="text-destructive mr-auto text-sm">금액은 0 이상의 숫자로 넣어 주세요.</span>
      <span v-else-if="dirty" class="text-muted-foreground mr-auto text-sm">저장하지 않은 변경이 있습니다.</span>
      <Button variant="ghost" size="sm" :disabled="busy || (review === null && !dirty)" data-testid="smt-review-revert" @click="void revert()">
        SmartSMT 금액으로 되돌리기
      </Button>
      <Button variant="outline" size="sm" :disabled="busy || invalidKeys.length > 0 || !dirty" data-testid="smt-review-save" @click="void submit(false)">
        <Spinner v-if="save.isPending.value" />
        임시 저장
      </Button>
      <Button
        size="sm"
        :disabled="busy || invalidKeys.length > 0 || !totals.complete || (!dirty && review?.status === 'confirmed')"
        :title="totals.complete ? '' : '금액이 비어 있는 항목을 모두 채워야 확정할 수 있습니다'"
        data-testid="smt-review-confirm"
        @click="void submit(true)"
      >
        확정
      </Button>
    </div>
  </SectionCard>
</template>
