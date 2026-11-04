<script setup lang="ts">
import { ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import type { AcceptableValue } from 'reka-ui';
import {
  DEVELOP_QUOTE_DEFAULT_UNIT,
  DEVELOP_QUOTE_ITEM_CATEGORIES,
  DEVELOP_QUOTE_ITEM_CATEGORY_LABELS,
  DEVELOP_QUOTE_SURCHARGE_BASIS,
  DEVELOP_QUOTE_UNIT_SUGGESTIONS,
  parseDevelopQuoteLines,
} from '@sp/api-contract';
import type { DevelopQuoteBreakdown, DevelopQuoteItemCategoryType } from '@sp/api-contract';
import {
  DEVELOP_QUOTE_LIMITS,
  developQuoteRowAmount,
  developQuoteRowCost,
  emptyQuoteItemRow,
  formatAmountInput,
  marginRateText,
  type DevelopQuoteItemRow,
} from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';

// 견적서 편집기의 산출 내역(docs/DEVELOP_FLOW.md §5.1) — 참고 견적서 표처럼 구분(인건비·직접비) × 단가 × 수량 행과
// 가산율 3칸(간접비 · 제경비 · 기업이윤), 그 아래 소계·가산·공급가·VAT·합계. 행 배열·가산율은 편집기 폼을 v-model 로
// 직접 고친다(저장·검사는 편집기 몫). 금액은 계약 함수로 서버와 같게 계산한다(props.amounts).
const items = defineModel<DevelopQuoteItemRow[]>('items', { required: true });
const indirectPct = defineModel<string | number>('indirectPct', { required: true });
const overheadPct = defineModel<string | number>('overheadPct', { required: true });
const profitPct = defineModel<string | number>('profitPct', { required: true });
defineProps<{ amounts: DevelopQuoteBreakdown }>();

const { t } = useI18n();
const uid = useId();
const pasteText = ref('');
const pasteNote = ref('');

// 내부 원가 줄(관리자 전용, §5.1) — 고객과 화면을 같이 볼 때 숨길 수 있게 접는다. 보기 설정은 이 브라우저에만 남긴다.
const INTERNAL_KEY = 'sp-develop-quote-internal';
const readInternal = (): boolean => {
  try {
    return localStorage.getItem(INTERNAL_KEY) !== 'hide';
  } catch {
    return true;
  }
};
const showInternal = ref(readInternal());
const toggleInternal = (): void => {
  showInternal.value = !showInternal.value;
  try {
    localStorage.setItem(INTERNAL_KEY, showInternal.value ? 'show' : 'hide');
  } catch {
    /* 저장 못 해도 이번 화면에선 동작 */
  }
};
const rowMarginText = (row: DevelopQuoteItemRow): string => {
  const cost = developQuoteRowCost(row);
  if (cost === null) return t('admin.develop.quote.costMissing');
  const amount = developQuoteRowAmount(row);
  const margin = amount - cost;
  return t('admin.develop.quote.rowMargin', {
    cost: formatKrw(cost),
    margin: formatKrw(margin),
    rate: marginRateText(amount > 0 ? margin / amount : null),
  });
};

const addItem = (category: DevelopQuoteItemCategoryType): void => {
  if (items.value.length >= DEVELOP_QUOTE_LIMITS.items) return;
  items.value.push(emptyQuoteItemRow(category));
};

const moveItem = (index: number, delta: number): void => {
  const next = index + delta;
  const rows = items.value;
  const from = rows[index];
  const to = rows[next];
  if (from === undefined || to === undefined) return;
  rows[index] = to;
  rows[next] = from;
};

// 구분을 바꾸면 단위가 그 구분의 기본값 그대로일 때만 새 기본값으로 옮긴다(관리자가 고친 단위는 둔다).
const pickCategory = (row: DevelopQuoteItemRow, value: AcceptableValue): void => {
  const hit = DEVELOP_QUOTE_ITEM_CATEGORIES.find((c) => c === value);
  if (hit === undefined || hit === row.category) return;
  if (row.unit.trim() === '' || row.unit === DEVELOP_QUOTE_DEFAULT_UNIT[row.category]) row.unit = DEVELOP_QUOTE_DEFAULT_UNIT[hit];
  row.category = hit;
};

// 붙여넣기로 채우기 — 한 줄 = 금액 한 덩어리라 인건비 1식(단가 = 금액)으로 넣는다. 빈 행은 버린다.
const applyPaste = (): void => {
  const parsed = parseDevelopQuoteLines(pasteText.value);
  if (parsed.items.length === 0) {
    pasteNote.value = t('admin.develop.quote.pasteEmpty');
    return;
  }
  const kept = items.value.filter((it) => it.title.trim() !== '' || it.unitPrice.trim() !== '');
  items.value = [
    ...kept,
    ...parsed.items.map((it) => ({
      ...emptyQuoteItemRow('labor'),
      title: it.title,
      unitPrice: it.amount.toLocaleString('ko-KR'),
      unit: '식',
    })),
  ].slice(0, DEVELOP_QUOTE_LIMITS.items);
  pasteText.value = '';
  pasteNote.value =
    parsed.rejected.length === 0
      ? t('admin.develop.quote.pasteAdded', { count: parsed.items.length })
      : `${t('admin.develop.quote.pasteAdded', { count: parsed.items.length })} ${t('admin.develop.quote.pasteRejected', { lines: parsed.rejected.join(' / ') })}`;
};

const asText = (value: string | number): string => String(value);
</script>

<template>
  <Panel size="sm" tone="card" class="flex flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <h4 class="text-sm font-semibold">{{ t('admin.develop.quote.items') }}</h4>
      <div class="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="xs" :aria-pressed="showInternal" @click="toggleInternal">
          {{ showInternal ? t('admin.develop.quote.internalHide') : t('admin.develop.quote.internalShow') }}
        </Button>
        <Button variant="outline" size="xs" :disabled="items.length >= DEVELOP_QUOTE_LIMITS.items" @click="addItem('labor')">
          <PlusIcon />
          {{ t('admin.develop.quote.addLabor') }}
        </Button>
        <Button variant="outline" size="xs" :disabled="items.length >= DEVELOP_QUOTE_LIMITS.items" @click="addItem('direct')">
          <PlusIcon />
          {{ t('admin.develop.quote.addDirect') }}
        </Button>
      </div>
    </div>

    <datalist :id="`${uid}-units`">
      <option v-for="u in DEVELOP_QUOTE_UNIT_SUGGESTIONS" :key="u" :value="u" />
    </datalist>

    <Panel v-for="(it, i) in items" :key="`item-${i}`" size="sm" class="flex flex-col gap-1.5" data-testid="quote-item-row">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground w-5 text-xs font-semibold tabular-nums">{{ i + 1 }}</span>
        <NativeSelect
          :model-value="it.category"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemCategory')}`"
          class="w-24"
          @update:model-value="(v) => pickCategory(it, v)"
        >
          <NativeSelectOption v-for="c in DEVELOP_QUOTE_ITEM_CATEGORIES" :key="c" :value="c">
            {{ DEVELOP_QUOTE_ITEM_CATEGORY_LABELS[c] }}
          </NativeSelectOption>
        </NativeSelect>
        <Input
          v-model="it.title"
          :maxlength="DEVELOP_QUOTE_LIMITS.itemTitleLen"
          :placeholder="it.category === 'labor' ? t('admin.develop.quote.itemTitleLabor') : t('admin.develop.quote.itemTitleDirect')"
          :aria-label="`${String(i + 1)} ${it.category === 'labor' ? t('admin.develop.quote.itemTitleLabor') : t('admin.develop.quote.itemTitleDirect')}`"
          class="min-w-32 flex-1"
        />
        <Input
          v-if="it.category === 'labor'"
          v-model="it.grade"
          :maxlength="DEVELOP_QUOTE_LIMITS.gradeLen"
          :placeholder="t('admin.develop.quote.itemGrade')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemGrade')}`"
          class="w-24"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('admin.develop.quote.moveUp')"
          title="위로"
          :disabled="i === 0"
          @click="moveItem(i, -1)"
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('admin.develop.quote.moveDown')"
          title="아래로"
          :disabled="i === items.length - 1"
          @click="moveItem(i, 1)"
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('admin.develop.quote.removeRow')"
          :title="t('admin.develop.quote.removeRow')"
          @click="items.splice(i, 1)"
        >
          <Trash2Icon class="text-destructive" />
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-1.5 pl-6.5">
        <Input
          v-model="it.description"
          :maxlength="DEVELOP_QUOTE_LIMITS.descriptionLen"
          :placeholder="it.category === 'labor' ? t('admin.develop.quote.itemDescriptionLabor') : t('admin.develop.quote.itemDescriptionDirect')"
          :aria-label="`${String(i + 1)} ${it.category === 'labor' ? t('admin.develop.quote.itemDescriptionLabor') : t('admin.develop.quote.itemDescriptionDirect')}`"
          class="min-w-40 flex-1"
        />
        <Input
          v-model="it.unitPrice"
          inputmode="numeric"
          :placeholder="t('admin.develop.quote.itemUnitPrice')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemUnitPrice')}`"
          class="w-32 text-right tabular-nums"
          @blur="it.unitPrice = formatAmountInput(it.unitPrice)"
        />
        <span class="text-muted-foreground text-xs">×</span>
        <Input
          :model-value="asText(it.qty)"
          inputmode="decimal"
          :placeholder="t('admin.develop.quote.itemQty')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemQty')}`"
          class="w-16 text-right tabular-nums"
          @update:model-value="(v) => (it.qty = String(v))"
        />
        <Input
          v-model="it.unit"
          :list="`${uid}-units`"
          :maxlength="DEVELOP_QUOTE_LIMITS.unitLen"
          :placeholder="t('admin.develop.quote.itemUnit')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemUnit')}`"
          class="w-20"
        />
        <span class="w-32 text-right text-sm font-medium tabular-nums" :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemAmount')}`">
          {{ formatKrw(developQuoteRowAmount(it)) }}
        </span>
      </div>
      <!-- 내부 원가(관리자 전용) — 고객 견적서·엑셀에는 나가지 않는다 -->
      <div v-if="showInternal" class="bg-warning/10 flex flex-wrap items-center gap-1.5 rounded-md py-1 pr-1 pl-6.5" data-testid="quote-item-internal">
        <span class="text-warning text-xs font-semibold">{{ t('admin.develop.quote.internal') }}</span>
        <Input
          v-model="it.costPrice"
          inputmode="numeric"
          :placeholder="t('admin.develop.quote.costPrice')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.costPrice')}`"
          class="w-32 text-right tabular-nums"
          @blur="it.costPrice = it.costPrice.trim() === '' ? '' : formatAmountInput(it.costPrice)"
        />
        <Input
          v-model="it.vendor"
          :maxlength="DEVELOP_QUOTE_LIMITS.vendorLen"
          :placeholder="t('admin.develop.quote.vendor')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.vendor')}`"
          class="min-w-32 flex-1"
        />
        <span class="text-muted-foreground text-xs tabular-nums" :data-testid="`quote-item-margin-${String(i + 1)}`">{{ rowMarginText(it) }}</span>
      </div>
    </Panel>
    <p v-if="items.length === 0" class="text-muted-foreground text-sm">{{ t('admin.develop.quote.noItems') }}</p>

    <!-- 붙여넣기로 채우기 -->
    <Panel size="sm" tone="muted" class="flex flex-col gap-1.5">
      <p class="text-xs font-semibold">{{ t('admin.develop.quote.paste') }}</p>
      <Textarea
        v-model="pasteText"
        rows="3"
        :placeholder="t('admin.develop.quote.pastePlaceholder')"
        :aria-label="t('admin.develop.quote.paste')"
      />
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-muted-foreground text-xs">{{ t('admin.develop.quote.pasteHint') }}</span>
        <Button variant="outline" size="xs" class="ml-auto" :disabled="pasteText.trim() === ''" @click="applyPaste">
          {{ t('admin.develop.quote.pasteApply') }}
        </Button>
      </div>
      <p v-if="pasteNote !== ''" role="status" class="text-warning text-xs">{{ pasteNote }}</p>
    </Panel>

    <!-- 가산율 -->
    <div class="grid gap-2 border-t pt-2 sm:grid-cols-3">
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold">{{ t('admin.develop.quote.rateIndirect') }}</span>
        <Input
          :model-value="asText(indirectPct)"
          inputmode="decimal"
          class="tabular-nums"
          :aria-label="t('admin.develop.quote.rateIndirect')"
          @update:model-value="(v) => (indirectPct = String(v))"
        />
        <span class="text-muted-foreground">{{ DEVELOP_QUOTE_SURCHARGE_BASIS.indirect }}</span>
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold">{{ t('admin.develop.quote.rateOverhead') }}</span>
        <Input
          :model-value="asText(overheadPct)"
          inputmode="decimal"
          class="tabular-nums"
          :aria-label="t('admin.develop.quote.rateOverhead')"
          @update:model-value="(v) => (overheadPct = String(v))"
        />
        <span class="text-muted-foreground">{{ DEVELOP_QUOTE_SURCHARGE_BASIS.overhead }}</span>
      </label>
      <label class="flex flex-col gap-1 text-xs">
        <span class="font-semibold">{{ t('admin.develop.quote.rateProfit') }}</span>
        <Input
          :model-value="asText(profitPct)"
          inputmode="decimal"
          class="tabular-nums"
          :aria-label="t('admin.develop.quote.rateProfit')"
          @update:model-value="(v) => (profitPct = String(v))"
        />
        <span class="text-muted-foreground">{{ DEVELOP_QUOTE_SURCHARGE_BASIS.profit }}</span>
      </label>
      <p class="text-muted-foreground text-xs sm:col-span-3">{{ t('admin.develop.quote.ratesHint') }}</p>
    </div>

    <!-- 산출 내역 합계 -->
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t pt-2 text-sm" data-testid="quote-breakdown">
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.laborSubtotal') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.laborSubtotal) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.directSubtotal') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.directSubtotal) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.indirect') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.indirectAmount) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.overhead') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.overheadAmount) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.profit') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.profitAmount) }}</dd>
      <dt class="text-muted-foreground border-t pt-0.5">{{ t('admin.develop.quote.supply') }}</dt>
      <dd class="border-t pt-0.5 text-right tabular-nums">{{ formatKrw(amounts.supplyAmount) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.vat') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.vatAmount) }}</dd>
      <dt class="font-semibold">{{ t('admin.develop.quote.total') }}</dt>
      <dd class="text-right text-base font-semibold tabular-nums">{{ formatKrw(amounts.totalAmount) }}</dd>
    </dl>
  </Panel>
</template>
