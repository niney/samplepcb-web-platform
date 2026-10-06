<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { parseDevelopQuoteLines } from '@sp/api-contract';
import type { DevelopQuoteAmounts } from '@sp/api-contract';
import {
  DEVELOP_QUOTE_LIMITS,
  emptyQuoteItemRow,
  formatAmountInput,
  type DevelopQuoteItemRow,
} from '@/components/admin/develop/develop-quote-edit';
import { formatKrw } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';

// 견적서 편집기의 항목표 — 행 편집(추가·이동·삭제) + 붙여넣기로 채우기 + 합계. 옛 DevelopQuoteEditor 의 항목 블록을
// 그대로 떼어 왔다(행 배열은 편집기의 폼을 v-model 로 직접 고친다 — 저장·검사는 편집기 몫).
const items = defineModel<DevelopQuoteItemRow[]>('items', { required: true });
defineProps<{ amounts: DevelopQuoteAmounts }>();

const { t } = useI18n();
const pasteText = ref('');
const pasteNote = ref('');

const addItem = (): void => {
  if (items.value.length >= DEVELOP_QUOTE_LIMITS.items) return;
  items.value.push(emptyQuoteItemRow());
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

// 붙여넣기로 채우기 — 빈 행은 버리고 읽어낸 줄을 뒤에 붙인다. 금액을 못 읽은 줄은 그대로 알려 준다.
const applyPaste = (): void => {
  const parsed = parseDevelopQuoteLines(pasteText.value);
  if (parsed.items.length === 0) {
    pasteNote.value = t('admin.develop.quote.pasteEmpty');
    return;
  }
  const kept = items.value.filter((it) => it.title.trim() !== '' || it.amount.trim() !== '');
  items.value = [
    ...kept,
    ...parsed.items.map((it) => ({
      title: it.title,
      description: '',
      amount: it.amount.toLocaleString('ko-KR'),
      durationDays: '',
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
      <Button
        variant="outline"
        size="xs"
        class="ml-auto"
        :disabled="items.length >= DEVELOP_QUOTE_LIMITS.items"
        @click="addItem"
      >
        <PlusIcon />
        {{ t('admin.develop.quote.addItem') }}
      </Button>
    </div>

    <Panel v-for="(it, i) in items" :key="`item-${i}`" size="sm" class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-muted-foreground w-5 text-xs font-semibold tabular-nums">{{ i + 1 }}</span>
        <Input
          v-model="it.title"
          :maxlength="DEVELOP_QUOTE_LIMITS.itemTitleLen"
          :placeholder="t('admin.develop.quote.itemTitle')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemTitle')}`"
          class="min-w-40 flex-1"
        />
        <Input
          v-model="it.amount"
          inputmode="numeric"
          :placeholder="t('admin.develop.quote.itemAmount')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemAmount')}`"
          class="w-36 text-right tabular-nums"
          @blur="it.amount = formatAmountInput(it.amount)"
        />
        <Input
          :model-value="asText(it.durationDays)"
          type="number"
          min="1"
          :max="DEVELOP_QUOTE_LIMITS.durationDaysMax"
          :placeholder="t('admin.develop.quote.itemDays')"
          :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemDays')}`"
          class="w-24 tabular-nums"
          @update:model-value="(v) => (it.durationDays = String(v))"
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
      <Input
        v-model="it.description"
        :maxlength="DEVELOP_QUOTE_LIMITS.descriptionLen"
        :placeholder="t('admin.develop.quote.itemDescription')"
        :aria-label="`${String(i + 1)} ${t('admin.develop.quote.itemDescription')}`"
      />
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

    <!-- 합계 -->
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t pt-2 text-sm">
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.supply') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.supplyAmount) }}</dd>
      <dt class="text-muted-foreground">{{ t('admin.develop.quote.vat') }}</dt>
      <dd class="text-right tabular-nums">{{ formatKrw(amounts.vatAmount) }}</dd>
      <dt class="font-semibold">{{ t('admin.develop.quote.total') }}</dt>
      <dd class="text-right text-base font-semibold tabular-nums">{{ formatKrw(amounts.totalAmount) }}</dd>
    </dl>
  </Panel>
</template>
