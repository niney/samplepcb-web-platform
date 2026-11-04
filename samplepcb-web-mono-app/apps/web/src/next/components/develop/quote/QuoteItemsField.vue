<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownIcon, ChevronUpIcon, ListPlusIcon, PlusIcon, XIcon } from '@lucide/vue';
import {
  DEVELOP_QUOTE_DIRECT_UNIT_SUGGESTIONS,
  DEVELOP_QUOTE_GRADE_SUGGESTIONS,
  DEVELOP_QUOTE_LABOR_UNIT,
  DEVELOP_QUOTE_SURCHARGE_BASIS,
  DEVELOP_QUOTE_WORKDAYS_PER_MONTH,
  developBpPercent,
} from '@sp/api-contract';
import type { DevelopLaborPresetType, DevelopQuoteBreakdown, DevelopQuoteItemCategoryType } from '@sp/api-contract';
import {
  DEVELOP_QUOTE_LIMITS,
  developQuoteRowAmount,
  emptyLaborRow,
  emptyQuoteItemRow,
  formatAmountInput,
  laborPresetRow,
  pctToBp,
  type DevelopQuoteItemRow,
} from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/next/components/ui/dropdown-menu';
import { Input } from '@/next/components/ui/input';

// 견적서 편집기의 산출 내역(docs/DEVELOP_FLOW.md §5.1) — 참고 자동견적 HTML 처럼 **인건비 칸**(직무 · 등급 · 담당 업무 ·
// 일일 노임비 × 참여 일수)과 **직접비 칸**(항목 · 내용 · 단가 × 수량 · 단위)을 나누고, 그 아래 가산율 3칸과 합계.
// 행 배열(items)은 하나이고 행마다 구분을 든다 — 칸은 그 구분으로 걸러 보일 뿐이고, 순서 바꾸기도 같은 칸 안에서만 한다
// (저장·미리보기는 인건비 → 직접비 순으로 세운다, develop-quote-edit.ts). 인건비 단위는 '일' 고정이라 단위 칸이 없다.
// 넓으면(칸 폭 56rem 이상) 머리줄 하나 + 한 줄 표, 좁으면 두 줄(이름 줄 / 금액 줄)로 접는다 — 칸 폭 기준(container query).
const items = defineModel<DevelopQuoteItemRow[]>('items', { required: true });
const indirectPct = defineModel<string | number>('indirectPct', { required: true });
const overheadPct = defineModel<string | number>('overheadPct', { required: true });
const profitPct = defineModel<string | number>('profitPct', { required: true });
const props = defineProps<{ amounts: DevelopQuoteBreakdown; laborPresets: readonly DevelopLaborPresetType[] }>();

const { t } = useI18n();
const uid = useId();

interface SectionRow {
  row: DevelopQuoteItemRow;
  index: number; // items 안의 위치(삭제·이동·포커스용)
  no: number; // 칸 안 번호(1부터) — 검사 문구의 'N번 줄'과 같다
  first: boolean;
  last: boolean;
}
const rowsOf = (category: DevelopQuoteItemCategoryType): SectionRow[] => {
  const picked = items.value.map((row, index) => ({ row, index })).filter((r) => r.row.category === category);
  return picked.map((r, i) => ({ ...r, no: i + 1, first: i === 0, last: i === picked.length - 1 }));
};
const laborRows = computed(() => rowsOf('labor'));
const directRows = computed(() => rowsOf('direct'));
const full = computed(() => items.value.length >= DEVELOP_QUOTE_LIMITS.items);

// 같은 구분의 이웃과 자리를 바꾼다(다른 칸 행은 건너뛴다).
const moveWithin = (index: number, delta: -1 | 1): void => {
  const rows = items.value;
  const from = rows[index];
  if (from === undefined) return;
  let j = index + delta;
  while (j >= 0 && j < rows.length && rows[j]?.category !== from.category) j += delta;
  const to = rows[j];
  if (to === undefined) return;
  rows[index] = to;
  rows[j] = from;
};
const removeRow = (index: number): void => {
  items.value.splice(index, 1);
};

const focusField = (field: 'role' | 'days' | 'item', index: number): void => {
  document.getElementById(`${uid}-${field}-${String(index)}`)?.focus();
};

// 기본값에서 추가 — 값을 복사한 줄을 넣고 참여 일수로 커서를 옮긴다. 메뉴가 닫히며 트리거로 돌려보내는 포커스를 막고
// 닫힌 뒤에 옮긴다(먼저 옮기면 메뉴의 포커스 가두기가 되찾아 간다).
const pendingDaysFocus = ref<number | null>(null);
const presetLabel = (p: DevelopLaborPresetType): string => [p.role, p.grade, p.task].filter((s) => s.trim() !== '').join(' · ');
const addPreset = (p: DevelopLaborPresetType): void => {
  if (full.value) return;
  items.value.push(laborPresetRow(p));
  pendingDaysFocus.value = items.value.length - 1;
};
const onPresetMenuCloseFocus = (event: Event): void => {
  const index = pendingDaysFocus.value;
  if (index === null) return;
  event.preventDefault();
  pendingDaysFocus.value = null;
  void nextTick(() => {
    focusField('days', index);
  });
};
const addLaborBlank = async (): Promise<void> => {
  if (full.value) return;
  items.value.push(emptyLaborRow());
  await nextTick();
  focusField('role', items.value.length - 1);
};
const addDirect = async (): Promise<void> => {
  if (full.value) return;
  items.value.push(emptyQuoteItemRow('direct'));
  await nextTick();
  focusField('item', items.value.length - 1);
};

// 옛 인건비 줄('개월' 등)은 저장된 단위를 그대로 보인다 — 새 줄은 늘 '일'.
const unitOf = (row: DevelopQuoteItemRow): string => (row.unit.trim() === '' ? DEVELOP_QUOTE_LABOR_UNIT : row.unit.trim());
const perUnitText = (row: DevelopQuoteItemRow): string =>
  unitOf(row) === DEVELOP_QUOTE_LABOR_UNIT ? t('admin.develop.quote.perDay') : `원/${unitOf(row)}`;

type RateKey = 'indirect' | 'overhead' | 'profit';
const rateRows = computed(() => [
  { key: 'indirect' as RateKey, label: t('admin.develop.quote.indirect'), aria: t('admin.develop.quote.rateIndirect'), basis: DEVELOP_QUOTE_SURCHARGE_BASIS.indirect },
  { key: 'overhead' as RateKey, label: t('admin.develop.quote.overhead'), aria: t('admin.develop.quote.rateOverhead'), basis: DEVELOP_QUOTE_SURCHARGE_BASIS.overhead },
  { key: 'profit' as RateKey, label: t('admin.develop.quote.profit'), aria: t('admin.develop.quote.rateProfit'), basis: DEVELOP_QUOTE_SURCHARGE_BASIS.profit },
]);
const rateModel = (key: RateKey): string =>
  String(key === 'indirect' ? indirectPct.value : key === 'overhead' ? overheadPct.value : profitPct.value);
const setRate = (key: RateKey, value: string | number): void => {
  if (key === 'indirect') indirectPct.value = String(value);
  else if (key === 'overhead') overheadPct.value = String(value);
  else profitPct.value = String(value);
};
// 합계의 가산 줄 이름 옆 비율('간접비 15%') — 입력 중 읽을 수 없으면 비율을 빼고 이름만.
const pctText = (raw: string | number): string => {
  const bp = pctToBp(raw);
  return Number.isFinite(bp) ? ` ${developBpPercent(Math.max(0, bp))}%` : '';
};

const asText = (value: string | number): string => String(value);
const amountOf = (row: DevelopQuoteItemRow): string => formatKrw(developQuoteRowAmount(row));

// 넓은 표의 칸 — 행마다 따로 그리드라 머리줄과 열이 맞도록 끝 칸(순서·삭제)까지 폭을 고정한다.
const LABOR_COLS =
  'grid-cols-[1.5rem_minmax(0,8rem)_minmax(0,4.5rem)_minmax(0,1fr)_4.75rem] @4xl:grid-cols-[1.5rem_8rem_5rem_minmax(0,1fr)_7.5rem_6.75rem_7.5rem_4.75rem]';
const DIRECT_COLS =
  'grid-cols-[1.5rem_minmax(0,9rem)_minmax(0,1fr)_4.75rem] @4xl:grid-cols-[1.5rem_9rem_minmax(0,1fr)_7.5rem_4.5rem_4.5rem_7.5rem_4.75rem]';
const LABOR_HEAD = 'grid-cols-[1.5rem_8rem_5rem_minmax(0,1fr)_7.5rem_6.75rem_7.5rem_4.75rem]';
const DIRECT_HEAD = 'grid-cols-[1.5rem_9rem_minmax(0,1fr)_7.5rem_4.5rem_4.5rem_7.5rem_4.75rem]';
const unitsListId = `${uid}-units`;
const gradesListId = `${uid}-grades`;
const monthHint = computed(() => t('admin.develop.quote.laborMonthHint', { days: DEVELOP_QUOTE_WORKDAYS_PER_MONTH }));
const laborSubtotalText = computed(() => formatKrw(props.amounts.laborSubtotal));
const directSubtotalText = computed(() => formatKrw(props.amounts.directSubtotal));
</script>

<template>
  <div class="@container flex flex-col gap-3">
    <datalist :id="unitsListId">
      <option v-for="u in DEVELOP_QUOTE_DIRECT_UNIT_SUGGESTIONS" :key="u" :value="u" />
    </datalist>
    <datalist :id="gradesListId">
      <option v-for="g in DEVELOP_QUOTE_GRADE_SUGGESTIONS" :key="g" :value="g" />
    </datalist>

    <!-- ── 인건비 ─────────────────────────────────────────────── -->
    <Panel size="sm" tone="card" class="flex flex-col gap-2" data-testid="quote-labor">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h4 class="text-sm font-semibold">{{ t('admin.develop.quote.laborTitle') }}</h4>
        <span class="text-muted-foreground text-xs">{{ t('admin.develop.quote.laborBasis') }}</span>
        <div class="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="xs" :disabled="full">
                <ListPlusIcon />
                {{ t('admin.develop.quote.addFromPreset') }}
                <ChevronDownIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="max-h-80 w-80 overflow-y-auto" @close-auto-focus="onPresetMenuCloseFocus">
              <DropdownMenuItem
                v-for="(p, pi) in laborPresets"
                :key="`preset-${String(pi)}`"
                data-testid="quote-preset-item"
                @select="addPreset(p)"
              >
                <span class="min-w-0 flex-1 truncate">{{ presetLabel(p) }}</span>
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ formatKrw(p.dailyRate) }}/{{ t('admin.develop.quote.dayUnit') }}</span>
              </DropdownMenuItem>
              <p v-if="laborPresets.length === 0" class="text-muted-foreground px-2 py-1.5 text-xs">{{ t('admin.develop.quote.presetEmpty') }}</p>
              <DropdownMenuSeparator />
              <p class="text-muted-foreground px-2 py-1.5 text-xs">{{ t('admin.develop.quote.presetManage') }}</p>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="xs" :disabled="full" :aria-label="t('admin.develop.quote.addLaborBlankAria')" @click="addLaborBlank">
            <PlusIcon />
            {{ t('admin.develop.quote.addLaborBlank') }}
          </Button>
        </div>
      </div>

      <div
        v-if="laborRows.length > 0"
        class="text-muted-foreground hidden items-end gap-x-1.5 border-b pb-1 text-xs font-medium @4xl:grid"
        :class="LABOR_HEAD"
        aria-hidden="true"
      >
        <span>#</span>
        <span>{{ t('admin.develop.quote.itemTitleLabor') }}</span>
        <span>{{ t('admin.develop.quote.itemGrade') }}</span>
        <span>{{ t('admin.develop.quote.itemDescriptionLabor') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.laborRate') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.laborDays') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.itemAmount') }}</span>
        <span />
      </div>

      <div
        v-for="r in laborRows"
        :key="`labor-${String(r.index)}`"
        class="grid items-center gap-x-1.5 gap-y-1.5"
        :class="LABOR_COLS"
        data-testid="quote-labor-row"
      >
        <span class="text-muted-foreground text-xs font-semibold tabular-nums">{{ r.no }}</span>
        <Input
          :id="`${uid}-role-${String(r.index)}`"
          v-model="r.row.title"
          :maxlength="DEVELOP_QUOTE_LIMITS.itemTitleLen"
          :placeholder="t('admin.develop.quote.itemTitleLabor')"
          :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.itemTitleLabor')}`"
        />
        <Input
          v-model="r.row.grade"
          :list="gradesListId"
          :maxlength="DEVELOP_QUOTE_LIMITS.gradeLen"
          :placeholder="t('admin.develop.quote.itemGrade')"
          :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.itemGrade')}`"
        />
        <Input
          v-model="r.row.description"
          :maxlength="DEVELOP_QUOTE_LIMITS.descriptionLen"
          :placeholder="t('admin.develop.quote.itemDescriptionLabor')"
          :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.itemDescriptionLabor')}`"
        />
        <div class="flex items-center justify-end @4xl:order-last">
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.moveUp')" title="위로" :disabled="r.first" @click="moveWithin(r.index, -1)">
            <ChevronUpIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.moveDown')" title="아래로" :disabled="r.last" @click="moveWithin(r.index, 1)">
            <ChevronDownIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.removeRow')" :title="t('admin.develop.quote.removeRow')" @click="removeRow(r.index)">
            <XIcon class="text-destructive" />
          </Button>
        </div>
        <!-- 금액 줄 — 좁으면 둘째 줄에 모이고, 넓으면 칸마다 풀려(contents) 표의 열이 된다 -->
        <div class="col-span-4 col-start-2 flex flex-wrap items-center gap-1.5 @4xl:contents">
          <div class="flex items-center gap-1">
            <Input
              v-model="r.row.unitPrice"
              inputmode="numeric"
              :placeholder="t('admin.develop.quote.laborRateShort')"
              :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.laborRate')}`"
              class="w-28 text-right tabular-nums @4xl:w-0 @4xl:flex-1"
              @blur="r.row.unitPrice = formatAmountInput(r.row.unitPrice)"
            />
            <span class="text-muted-foreground shrink-0 text-xs @4xl:hidden">{{ perUnitText(r.row) }} ×</span>
          </div>
          <div class="flex items-center gap-1">
            <Input
              :id="`${uid}-days-${String(r.index)}`"
              :model-value="asText(r.row.qty)"
              inputmode="decimal"
              :placeholder="t('admin.develop.quote.laborDays')"
              :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.laborDays')}`"
              class="w-22 text-right tabular-nums @4xl:w-0 @4xl:flex-1"
              @update:model-value="(v) => (r.row.qty = String(v))"
            />
            <span class="text-muted-foreground shrink-0 text-xs">{{ unitOf(r.row) }}</span>
          </div>
          <span
            class="ml-auto text-right text-sm font-medium tabular-nums @4xl:ml-0"
            :aria-label="`${t('admin.develop.quote.laborTitle')} ${String(r.no)} ${t('admin.develop.quote.itemAmount')}`"
          >
            {{ amountOf(r.row) }}
          </span>
        </div>
      </div>

      <p v-if="laborRows.length === 0" class="text-muted-foreground py-2 text-sm">{{ t('admin.develop.quote.laborEmpty') }}</p>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2">
        <span class="text-muted-foreground text-xs">{{ monthHint }}</span>
        <span class="ml-auto text-sm">
          <span class="text-muted-foreground">{{ t('admin.develop.quote.laborSubtotal') }}</span>
          <b class="ml-2 tabular-nums" data-testid="quote-labor-subtotal">{{ laborSubtotalText }}</b>
        </span>
      </div>
    </Panel>

    <!-- ── 직접비 ─────────────────────────────────────────────── -->
    <Panel size="sm" tone="card" class="flex flex-col gap-2" data-testid="quote-direct">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <h4 class="text-sm font-semibold">{{ t('admin.develop.quote.directTitle') }}</h4>
        <span class="text-muted-foreground text-xs">{{ t('admin.develop.quote.directBasis') }}</span>
        <Button variant="outline" size="xs" class="ml-auto" :disabled="full" @click="addDirect">
          <PlusIcon />
          {{ t('admin.develop.quote.addDirect') }}
        </Button>
      </div>

      <div
        v-if="directRows.length > 0"
        class="text-muted-foreground hidden items-end gap-x-1.5 border-b pb-1 text-xs font-medium @4xl:grid"
        :class="DIRECT_HEAD"
        aria-hidden="true"
      >
        <span>#</span>
        <span>{{ t('admin.develop.quote.itemTitleDirect') }}</span>
        <span>{{ t('admin.develop.quote.itemDescriptionDirect') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.itemUnitPrice') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.itemQty') }}</span>
        <span>{{ t('admin.develop.quote.itemUnit') }}</span>
        <span class="text-right">{{ t('admin.develop.quote.itemAmount') }}</span>
        <span />
      </div>

      <div
        v-for="r in directRows"
        :key="`direct-${String(r.index)}`"
        class="grid items-center gap-x-1.5 gap-y-1.5"
        :class="DIRECT_COLS"
        data-testid="quote-direct-row"
      >
        <span class="text-muted-foreground text-xs font-semibold tabular-nums">{{ r.no }}</span>
        <Input
          :id="`${uid}-item-${String(r.index)}`"
          v-model="r.row.title"
          :maxlength="DEVELOP_QUOTE_LIMITS.itemTitleLen"
          :placeholder="t('admin.develop.quote.itemTitleDirect')"
          :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemTitleDirect')}`"
        />
        <Input
          v-model="r.row.description"
          :maxlength="DEVELOP_QUOTE_LIMITS.descriptionLen"
          :placeholder="t('admin.develop.quote.itemDescriptionDirect')"
          :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemDescriptionDirect')}`"
        />
        <div class="flex items-center justify-end @4xl:order-last">
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.moveUp')" title="위로" :disabled="r.first" @click="moveWithin(r.index, -1)">
            <ChevronUpIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.moveDown')" title="아래로" :disabled="r.last" @click="moveWithin(r.index, 1)">
            <ChevronDownIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" :aria-label="t('admin.develop.quote.removeRow')" :title="t('admin.develop.quote.removeRow')" @click="removeRow(r.index)">
            <XIcon class="text-destructive" />
          </Button>
        </div>
        <div class="col-span-3 col-start-2 flex flex-wrap items-center gap-1.5 @4xl:contents">
          <div class="flex items-center gap-1">
            <Input
              v-model="r.row.unitPrice"
              inputmode="numeric"
              :placeholder="t('admin.develop.quote.itemUnitPrice')"
              :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemUnitPrice')}`"
              class="w-28 text-right tabular-nums @4xl:w-0 @4xl:flex-1"
              @blur="r.row.unitPrice = formatAmountInput(r.row.unitPrice)"
            />
            <span class="text-muted-foreground shrink-0 text-xs @4xl:hidden">×</span>
          </div>
          <Input
            :model-value="asText(r.row.qty)"
            inputmode="decimal"
            :placeholder="t('admin.develop.quote.itemQty')"
            :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemQty')}`"
            class="w-16 text-right tabular-nums @4xl:w-full"
            @update:model-value="(v) => (r.row.qty = String(v))"
          />
          <Input
            v-model="r.row.unit"
            :list="unitsListId"
            :maxlength="DEVELOP_QUOTE_LIMITS.unitLen"
            :placeholder="t('admin.develop.quote.itemUnit')"
            :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemUnit')}`"
            class="w-16 @4xl:w-full"
          />
          <span
            class="ml-auto text-right text-sm font-medium tabular-nums @4xl:ml-0"
            :aria-label="`${t('admin.develop.quote.directTitle')} ${String(r.no)} ${t('admin.develop.quote.itemAmount')}`"
          >
            {{ amountOf(r.row) }}
          </span>
        </div>
      </div>

      <p v-if="directRows.length === 0" class="text-muted-foreground py-2 text-sm">{{ t('admin.develop.quote.directEmpty') }}</p>

      <div class="flex items-center border-t pt-2">
        <span class="ml-auto text-sm">
          <span class="text-muted-foreground">{{ t('admin.develop.quote.directSubtotal') }}</span>
          <b class="ml-2 tabular-nums" data-testid="quote-direct-subtotal">{{ directSubtotalText }}</b>
        </span>
      </div>
    </Panel>

    <!-- ── 가산율 · 합계 ──────────────────────────────────────── -->
    <Panel size="sm" tone="card" class="grid gap-x-8 gap-y-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div class="flex flex-col gap-2.5">
        <h4 class="text-sm font-semibold">{{ t('admin.develop.quote.rates') }}</h4>
        <div v-for="rate in rateRows" :key="rate.key" class="grid grid-cols-[4.5rem_5.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
          <label :for="`${uid}-rate-${rate.key}`">{{ rate.label }}</label>
          <div class="flex items-center gap-1">
            <Input
              :id="`${uid}-rate-${rate.key}`"
              :model-value="rateModel(rate.key)"
              inputmode="decimal"
              class="w-16 text-right tabular-nums"
              :aria-label="rate.aria"
              @update:model-value="(v) => setRate(rate.key, v)"
            />
            <span class="text-muted-foreground text-xs">%</span>
          </div>
          <span class="text-muted-foreground text-xs">{{ rate.basis }}</span>
        </div>
        <p class="text-muted-foreground text-xs leading-relaxed">{{ t('admin.develop.quote.ratesHint') }}</p>
      </div>

      <dl class="flex flex-col text-sm" data-testid="quote-breakdown">
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.laborSubtotal') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.laborSubtotal) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.directSubtotal') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.directSubtotal) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.indirect') }}{{ pctText(indirectPct) }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.indirectAmount) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.overhead') }}{{ pctText(overheadPct) }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.overheadAmount) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.profit') }}{{ pctText(profitPct) }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.profitAmount) }}</dd>
        </div>
        <div class="mt-1 flex items-baseline justify-between gap-4 border-t pt-2 pb-1 font-medium">
          <dt>{{ t('admin.develop.quote.supply') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.supplyAmount) }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-4 py-1">
          <dt class="text-muted-foreground">{{ t('admin.develop.quote.vat') }}</dt>
          <dd class="tabular-nums">{{ formatKrw(amounts.vatAmount) }}</dd>
        </div>
        <div class="border-foreground/70 mt-1 flex items-baseline justify-between gap-4 border-t-2 pt-2.5">
          <dt class="font-semibold">{{ t('admin.develop.quote.total') }}</dt>
          <dd class="text-primary text-lg font-bold tabular-nums">{{ formatKrw(amounts.totalAmount) }}</dd>
        </div>
      </dl>
    </Panel>
  </div>
</template>
