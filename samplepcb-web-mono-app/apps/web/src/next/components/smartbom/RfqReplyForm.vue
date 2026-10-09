<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { ArrowLeftIcon, ArrowRightIcon } from '@lucide/vue';
import { BomRfqReplyBody, type BomRfqItemReplyInputType, type BomRfqReplyBodyType } from '@sp/api-contract';
import { effectiveRfqReplyQty, kstDateInput } from '@sp/utils';
import { usePartnerI18n } from '@/partner/i18n';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { RfqReplyFormRow } from './rfq-reply-form';

// 협력사 회신 폼 — 관리자 대리 입력용(옛 components/smartbom/RfqReplyForm 의 짝, 같은 props·emits).
// 협력사 포털·공개 회신 화면은 옛 폼을 계속 쓰고, 문구는 같은 partner i18n 원문 키(pt)를 쓴다.
// 행별 단가·회신수량·MOQ·재고·D/C·납기·메모 입력. 단가가 비어 있는 행은 미회신으로 제출에서 빠진다.
// 합계는 서버가 재계산·박제하므로 여기서는 참고 표시만 한다.
// MOQ → 회신수량은 한 방향으로만 따라간다(§6.38): MOQ 가 필요수량을 넘으면 회신수량을 MOQ 로 채우고,
// 사람이 직접 친 회신수량은 덮지 않는다. 회신수량 < MOQ 는 모순이라 막는다.
// 행 타입 RfqReplyFormRow 는 ./rfq-reply-form.ts 에서 가져다 쓴다.

const { pt, pn, locale } = usePartnerI18n();

const props = defineProps<{
  rows: RfqReplyFormRow[];
  currency: string;
  deliveryDate: string | null; // ISO — 폼에서는 YYYY-MM-DD
  memo: string | null;
  busy?: boolean;
  readOnly?: boolean;
}>();

const emit = defineEmits<{ submit: [body: BomRfqReplyBodyType] }>();

interface EditRow {
  quoteItemId: string;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  orderQty: number;
  unitPrice: number | null;
  replyQty: number | null;
  moq: number | null;
  stock: number | null;
  dateCode: string;
  leadTime: string;
  memo: string;
  /** 보유 부품에서 값을 채워 넣은 행 — 사람이 확인하도록 표시만 한다. */
  prefilled: boolean;
  /** 회신수량이 MOQ 에서 파생된 값인가 — true 인 동안만 MOQ 변경을 따라간다. */
  replyQtyAuto: boolean;
  /** 마지막으로 동기화에 반영한 MOQ — 변경 감지용(제출에는 안 실린다). */
  lastMoq: number | null;
}

const editRows = ref<EditRow[]>([]);
const deliveryDateInput = ref('');
const memoInput = ref('');
const validationIssue = ref<{ key: string; message: string } | null>(null);
watch(locale, () => {
  validationIssue.value = null;
});

const initRows = (): void => {
  editRows.value = props.rows.map((row) => {
    // 보유 부품 프리필(docs/PARTNER_PARTS.md) — 아직 회신하지 않은 행에만 제안한다(쓴 회신은 덮지 않음).
    const suggest = row.reply === null ? (row.myStock ?? null) : null;
    const moq = row.reply?.moq ?? suggest?.moq ?? null;
    const savedReplyQty = row.reply?.replyQty ?? null;
    // MOQ 가 필요수량을 넘는데 회신수량이 비었으면 MOQ 로 파생(§6.38). 저장된 회신수량이 정확히 MOQ 와
    // 같으면 파생값으로 보고 이후 MOQ 변경을 계속 따라가게 둔다.
    const moqAboveNeed = moq !== null && moq > row.orderQty;
    const replyQtyAuto = savedReplyQty === null ? moqAboveNeed : moqAboveNeed && savedReplyQty === moq;
    return {
      quoteItemId: row.quoteItemId,
      mpn: row.mpn,
      manufacturerName: row.manufacturerName,
      description: row.description,
      orderQty: row.orderQty,
      // 단가는 제안하지 않는다 — 재고표 단가는 견적가가 아니다(수량·환율·시점이 다르다).
      unitPrice: row.reply?.unitPrice ?? null,
      replyQty: savedReplyQty ?? (moqAboveNeed ? moq : null),
      moq,
      stock: row.reply?.stock ?? suggest?.stockQty ?? null,
      dateCode: row.reply?.dateCode ?? suggest?.dateCode ?? '',
      leadTime: row.reply?.leadTime ?? suggest?.leadTime ?? '',
      memo: row.reply?.memo ?? '',
      prefilled: suggest !== null,
      replyQtyAuto,
      lastMoq: moq,
    };
  });
  deliveryDateInput.value = kstDateInput(props.deliveryDate);
  memoInput.value = props.memo ?? '';
};
watch(() => props.rows, initRows, { immediate: true });
watch([deliveryDateInput, memoInput], () => {
  validationIssue.value = null;
});

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// 숫자 입력칸 값 → 숫자/빈 값. 빈 칸·숫자가 아닌 글자는 '입력 없음'(null)이다.
const toNumOrNull = (v: string | number): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v.trim() === '') return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};
const strOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim());
const hasValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

// MOQ → 회신수량 한 방향 동기화. 사람이 직접 친 회신수량(replyQtyAuto=false·값 있음)은 덮지 않는다.
// MOQ 가 필요수량 이하로 내려가면 파생값은 비워 "미입력 = 필요수량" 의미로 돌아간다.
const syncReplyQtyFromMoq = (row: EditRow): void => {
  if (!row.replyQtyAuto && hasValue(row.replyQty)) return;
  const moq = num(row.moq);
  if (moq !== null && moq > row.orderQty) {
    row.replyQty = moq;
    row.replyQtyAuto = true;
  } else if (row.replyQtyAuto) {
    row.replyQty = null;
    row.replyQtyAuto = false;
  }
};
// 회신수량을 손으로 고치면 파생 표지를 떼고, 비우면 다시 MOQ 파생 대상이 된다.
const onReplyQtyInput = (row: EditRow, value: string | number): void => {
  row.replyQty = toNumOrNull(value);
  row.replyQtyAuto = false;
};
const onReplyQtyChange = (row: EditRow): void => {
  if (!hasValue(row.replyQty)) syncReplyQtyFromMoq(row);
};
watch(
  editRows,
  (rows) => {
    validationIssue.value = null;
    for (const row of rows) {
      const moq = num(row.moq);
      if (moq === row.lastMoq) continue;
      row.lastMoq = moq;
      syncReplyQtyFromMoq(row);
    }
  },
  { deep: true },
);

// 서버 박제와 같은 자릿수 — 원화 0자리·외화 2자리.
const roundMoney = (amount: number): number =>
  props.currency === 'KRW' ? Math.round(amount) : Math.round(amount * 100) / 100;

const lineTotal = (row: EditRow): number | null => {
  const price = num(row.unitPrice);
  if (price === null) return null;
  // 서버 합계·관리자 비교표와 같은 공식 — 회신수량(?? 필요수량)에 MOQ 바닥.
  const qty = effectiveRfqReplyQty(row.orderQty, num(row.replyQty), num(row.moq));
  return roundMoney(price * qty);
};
const repliedCount = (): number => editRows.value.filter((r) => num(r.unitPrice) !== null).length;
const grandTotal = (): number => roundMoney(editRows.value.reduce((sum, row) => sum + (lineTotal(row) ?? 0), 0));

const partLabel = (row: EditRow): string =>
  row.mpn.trim() !== '' ? row.mpn : (row.manufacturerName ?? row.description ?? pt('품목 {value1}', { value1: row.quoteItemId }));

const tableHost = ref<HTMLElement | null>(null);
type NumericField = 'unitPrice' | 'replyQty' | 'moq' | 'stock';
type RowField = NumericField | 'dateCode' | 'leadTime' | 'memo';

const fieldKey = (row: EditRow, field: RowField): string => `${row.quoteItemId}:${field}`;
const isInvalid = (row: EditRow, field: RowField): boolean => validationIssue.value?.key === fieldKey(row, field);
const isGlobalInvalid = (key: string): boolean => validationIssue.value?.key === key;

function rejectInput(key: string, message: string): false {
  validationIssue.value = { key, message };
  void nextTick(() => {
    const input =
      tableHost.value?.querySelector<HTMLInputElement>(`[data-rfq-key="${key}"]`) ??
      document.querySelector<HTMLInputElement>(`[data-rfq-key="${key}"]`);
    input?.focus();
    input?.scrollIntoView({ block: 'nearest', inline: 'center' });
  });
  return false;
}

function validateInteger(row: EditRow, field: 'replyQty' | 'moq' | 'stock', label: string, minimum: 0 | 1): boolean {
  const value = row[field];
  if (!hasValue(value)) return true;
  const parsed = num(value);
  if (parsed !== null && Number.isInteger(parsed) && parsed >= minimum) return true;
  return rejectInput(
    fieldKey(row, field),
    pt('{value1} {value2}은 {value3} 이상의 정수로 입력해 주세요.', {
      value1: partLabel(row),
      value2: label,
      value3: String(minimum),
    }),
  );
}

function validateRows(): boolean {
  for (const row of editRows.value) {
    const priceEntered = hasValue(row.unitPrice);
    const hasReplyDetail =
      hasValue(row.replyQty) ||
      hasValue(row.moq) ||
      hasValue(row.stock) ||
      row.dateCode.trim() !== '' ||
      row.leadTime.trim() !== '' ||
      row.memo.trim() !== '';
    if (!priceEntered) {
      if (hasReplyDetail) {
        return rejectInput(
          fieldKey(row, 'unitPrice'),
          pt('{value1}의 회신 내용을 저장하려면 단가를 입력해 주세요.', { value1: partLabel(row) }),
        );
      }
      continue;
    }
    const price = num(row.unitPrice);
    if (price === null || price < 0) {
      return rejectInput(
        fieldKey(row, 'unitPrice'),
        pt('{value1} 단가는 0 이상의 숫자로 입력해 주세요.', { value1: partLabel(row) }),
      );
    }
    if (!validateInteger(row, 'replyQty', pt('회신수량'), 1)) return false;
    if (!validateInteger(row, 'moq', 'MOQ', 1)) return false;
    const replyQty = num(row.replyQty);
    const moq = num(row.moq);
    if (replyQty !== null && moq !== null && replyQty < moq) {
      return rejectInput(
        fieldKey(row, 'replyQty'),
        pt('{value1} 회신수량은 MOQ({value2}) 이상이어야 합니다.', { value1: partLabel(row), value2: pn(moq) }),
      );
    }
    if (!validateInteger(row, 'stock', pt('재고'), 0)) return false;
    if (row.dateCode.trim().length > 100) {
      return rejectInput(fieldKey(row, 'dateCode'), pt('{value1} Date Code는 100자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
    if (row.leadTime.trim().length > 64) {
      return rejectInput(fieldKey(row, 'leadTime'), pt('{value1} 납기는 64자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
    if (row.memo.trim().length > 500) {
      return rejectInput(fieldKey(row, 'memo'), pt('{value1} 회신 메모는 500자 이내로 입력해 주세요.', { value1: partLabel(row) }));
    }
  }
  if (memoInput.value.trim().length > 2000) {
    return rejectInput('rfq:memo', pt('전체 회신 메모는 2,000자 이내로 입력해 주세요.'));
  }
  return true;
}

// 표는 shadcn Table 의 자체 가로 스크롤 칸 안에서 움직인다 — 그 칸을 찾아 민다.
function moveTable(direction: -1 | 1): void {
  tableHost.value
    ?.querySelector<HTMLElement>('[data-slot="table-container"]')
    ?.scrollBy({ left: direction * 280, behavior: 'smooth' });
}

function submit(): void {
  validationIssue.value = null;
  if (!validateRows()) return;
  const items: BomRfqItemReplyInputType[] = editRows.value
    .filter((row) => {
      const price = num(row.unitPrice);
      return price !== null && price >= 0;
    })
    .map((row) => ({
      quoteItemId: row.quoteItemId,
      unitPrice: num(row.unitPrice) ?? 0,
      replyQty: num(row.replyQty),
      moq: num(row.moq),
      stock: num(row.stock),
      dateCode: strOrNull(row.dateCode),
      leadTime: strOrNull(row.leadTime),
      memo: strOrNull(row.memo),
    }));
  const result = BomRfqReplyBody.safeParse({
    items,
    deliveryDate: deliveryDateInput.value === '' ? null : deliveryDateInput.value,
    memo: strOrNull(memoInput.value),
  });
  if (!result.success) {
    rejectInput('rfq:memo', pt('입력값을 다시 확인해 주세요. 숫자와 글자 수가 허용 범위여야 합니다.'));
    return;
  }
  emit('submit', result.data);
}
</script>

<template>
  <div class="space-y-3">
    <div ref="tableHost">
      <TableCard>
        <!-- 좁은 화면 안내 — 열이 많아 표 안에서 좌우로 움직인다 -->
        <NoticeBand tone="info" class="flex items-center gap-2 text-xs min-[1280px]:hidden">
          <span class="min-w-0 flex-1">{{ pt('좌우로 이동해 회신수량·재고·D/C·납기·메모와 금액을 확인하세요.') }}</span>
          <Button variant="outline" size="icon-xs" :aria-label="pt('RFQ 회신 표 왼쪽으로 이동')" @click="moveTable(-1)">
            <ArrowLeftIcon />
          </Button>
          <Button variant="outline" size="icon-xs" :aria-label="pt('RFQ 회신 표 오른쪽으로 이동')" @click="moveTable(1)">
            <ArrowRightIcon />
          </Button>
        </NoticeBand>
        <Table class="min-w-[1040px]">
          <TableHeader>
            <TableRow>
              <TableHead>{{ pt('부품') }}</TableHead>
              <TableHead class="text-right">{{ pt('필요수량') }}</TableHead>
              <TableHead class="text-right">{{ pt('단가({value1})', { value1: currency }) }}</TableHead>
              <TableHead class="text-right">{{ pt('회신수량') }}</TableHead>
              <TableHead class="text-right">MOQ</TableHead>
              <TableHead class="text-right">{{ pt('재고') }}</TableHead>
              <TableHead>D/C</TableHead>
              <TableHead>{{ pt('납기') }}</TableHead>
              <TableHead>{{ pt('메모') }}</TableHead>
              <TableHead class="text-right">{{ pt('금액') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in editRows" :key="row.quoteItemId">
              <TableCell class="max-w-56">
                <span class="block truncate font-medium">{{ row.mpn === '' ? pt('품번 미기재') : row.mpn }}</span>
                <span class="text-muted-foreground block truncate text-xs">{{ row.manufacturerName ?? row.description ?? '' }}</span>
                <!-- 보유 부품에서 채운 행 — 값은 제안이므로 확인하고 고칠 수 있게 알린다 -->
                <Badge
                  v-if="row.prefilled"
                  variant="warning"
                  class="mt-0.5"
                  :title="pt('올려 두신 보유 부품 목록에서 재고·D/C·납기를 채웠습니다. 확인하고 고쳐 주세요 (단가는 채우지 않습니다).')"
                >
                  {{ pt('보유 목록에서 채움') }}
                </Badge>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ pn(row.orderQty) }}</TableCell>
              <TableCell>
                <Input
                  :model-value="row.unitPrice ?? ''"
                  type="number"
                  min="0"
                  step="any"
                  class="w-28"
                  :disabled="readOnly"
                  :aria-label="pt('{value1} 단가({value2})', { value1: partLabel(row), value2: currency })"
                  :aria-invalid="isInvalid(row, 'unitPrice')"
                  :aria-describedby="isInvalid(row, 'unitPrice') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'unitPrice')"
                  @update:model-value="(v: string | number) => (row.unitPrice = toNumOrNull(v))"
                />
              </TableCell>
              <TableCell>
                <Input
                  :model-value="row.replyQty ?? ''"
                  type="number"
                  min="1"
                  step="1"
                  class="w-24"
                  :disabled="readOnly"
                  :placeholder="String(row.orderQty)"
                  :aria-label="pt('{value1} 회신수량', { value1: partLabel(row) })"
                  :aria-invalid="isInvalid(row, 'replyQty')"
                  :aria-describedby="isInvalid(row, 'replyQty') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'replyQty')"
                  :title="row.replyQtyAuto ? pt('MOQ에 맞춰 자동으로 채운 수량입니다. 직접 고칠 수 있습니다.') : undefined"
                  @update:model-value="(v: string | number) => onReplyQtyInput(row, v)"
                  @change="onReplyQtyChange(row)"
                />
                <!-- MOQ 에 맞춰 채운 수량 — 사람이 친 값과 구분해 보인다(옛 화면의 노란 칸 표시) -->
                <span v-if="row.replyQtyAuto" class="text-warning mt-0.5 block text-xs">MOQ</span>
              </TableCell>
              <TableCell>
                <Input
                  :model-value="row.moq ?? ''"
                  type="number"
                  min="1"
                  step="1"
                  class="w-20"
                  :disabled="readOnly"
                  :aria-label="`${partLabel(row)} MOQ`"
                  :aria-invalid="isInvalid(row, 'moq')"
                  :aria-describedby="isInvalid(row, 'moq') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'moq')"
                  @update:model-value="(v: string | number) => (row.moq = toNumOrNull(v))"
                />
              </TableCell>
              <TableCell>
                <Input
                  :model-value="row.stock ?? ''"
                  type="number"
                  min="0"
                  step="1"
                  class="w-24"
                  :disabled="readOnly"
                  :aria-label="pt('{value1} 재고', { value1: partLabel(row) })"
                  :aria-invalid="isInvalid(row, 'stock')"
                  :aria-describedby="isInvalid(row, 'stock') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'stock')"
                  @update:model-value="(v: string | number) => (row.stock = toNumOrNull(v))"
                />
              </TableCell>
              <TableCell>
                <Input
                  v-model="row.dateCode"
                  type="text"
                  maxlength="100"
                  class="w-24"
                  :disabled="readOnly"
                  :aria-label="`${partLabel(row)} Date Code`"
                  :aria-invalid="isInvalid(row, 'dateCode')"
                  :aria-describedby="isInvalid(row, 'dateCode') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'dateCode')"
                />
              </TableCell>
              <TableCell>
                <Input
                  v-model="row.leadTime"
                  type="text"
                  maxlength="64"
                  class="w-24"
                  :disabled="readOnly"
                  :placeholder="pt('예: 2주')"
                  :aria-label="pt('{value1} 납기', { value1: partLabel(row) })"
                  :aria-invalid="isInvalid(row, 'leadTime')"
                  :aria-describedby="isInvalid(row, 'leadTime') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'leadTime')"
                />
              </TableCell>
              <TableCell>
                <Input
                  v-model="row.memo"
                  type="text"
                  maxlength="500"
                  class="w-32"
                  :disabled="readOnly"
                  :aria-label="pt('{value1} 회신 메모', { value1: partLabel(row) })"
                  :aria-invalid="isInvalid(row, 'memo')"
                  :aria-describedby="isInvalid(row, 'memo') ? 'rfq-reply-validation-error' : undefined"
                  :data-rfq-key="fieldKey(row, 'memo')"
                />
              </TableCell>
              <TableCell class="text-right tabular-nums">
                {{ lineTotal(row) === null ? '—' : pn(lineTotal(row) ?? 0) }}
              </TableCell>
            </TableRow>
            <TableEmptyRow v-if="editRows.length === 0" :colspan="10" :text="pt('요청 부품행이 없습니다.')" />
          </TableBody>
        </Table>
      </TableCard>
    </div>

    <Alert v-if="validationIssue !== null" id="rfq-reply-validation-error" variant="destructive" size="sm">
      <AlertDescription>{{ validationIssue.message }}</AlertDescription>
    </Alert>

    <div class="flex flex-wrap items-end gap-3">
      <Field class="w-44">
        <FieldLabel for="bom-rfq-reply-delivery">{{ pt('납기(전체)') }}</FieldLabel>
        <Input id="bom-rfq-reply-delivery" v-model="deliveryDateInput" type="date" :disabled="readOnly" />
      </Field>
      <Field class="min-w-56 flex-1">
        <FieldLabel for="bom-rfq-reply-memo">{{ pt('회신 메모') }}</FieldLabel>
        <Input
          id="bom-rfq-reply-memo"
          v-model="memoInput"
          type="text"
          maxlength="2000"
          :disabled="readOnly"
          :aria-invalid="isGlobalInvalid('rfq:memo')"
          :aria-describedby="isGlobalInvalid('rfq:memo') ? 'rfq-reply-validation-error' : undefined"
          data-rfq-key="rfq:memo"
        />
      </Field>
      <div class="ml-auto text-right text-sm">
        <p class="text-muted-foreground text-xs">
          {{ pt('회신 {value1} / {value2}행', { value1: repliedCount(), value2: editRows.length }) }}
        </p>
        <p class="font-semibold tabular-nums">
          {{ pt('합계(참고) {value1} {value2}', { value1: pn(grandTotal()), value2: currency }) }}
        </p>
      </div>
      <Button v-if="!readOnly" :disabled="busy === true" @click="submit">{{ pt('회신 저장') }}</Button>
    </div>
  </div>
</template>
