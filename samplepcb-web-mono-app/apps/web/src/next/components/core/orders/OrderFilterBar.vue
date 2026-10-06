<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AcceptableValue } from 'reka-ui';
import type { AdminOrderFilters, OrderQField, OrderSortField } from '@/admin/useAdminOrders';
import Panel from '@/next/components/common/Panel.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';

// 주문 필터 — 옛 components/admin/OrderFilterBar.vue 와 같은 props·emits·동작.
// 1행: 검색대상+검색어(입력 300ms 뒤 조회, Enter 는 즉시)·기간(프리셋) / 2행: 결제수단·기타 조건·정렬.
// 상태는 부모(OrdersPage)가 단일 소유하고, 여기서는 변경분만 emit 한다.
const props = defineProps<{ filters: AdminOrderFilters }>();
const emit = defineEmits<{ change: [patch: Partial<AdminOrderFilters>] }>();
const { t } = useI18n();

// 검색대상(레거시 sel_field 10종) — value 는 컬럼명, 라벨은 i18n.
const Q_FIELDS: readonly OrderQField[] = [
  'od_id',
  'mb_id',
  'od_name',
  'od_tel',
  'od_hp',
  'od_b_name',
  'od_b_tel',
  'od_b_hp',
  'od_deposit_name',
  'od_invoice',
];

// 결제수단(레거시 od_settle_case) — value 는 DB 저장값(한글). '간편결제' 는 서버에서 IN 확장. '' = 전체.
const SETTLE_CASES = ['무통장', '가상계좌', '계좌이체', '휴대폰', '신용카드', '간편결제', 'KAKAOPAY'] as const;

// 기타선택 5종 — 필터 키와 i18n slug.
type FlagKey = 'misu' | 'cancelled' | 'refund' | 'point' | 'coupon';
const FLAGS: readonly FlagKey[] = ['misu', 'cancelled', 'refund', 'point', 'coupon'];

// 날짜 프리셋(레거시 set_date 시맨틱). 'all' = 기간 해제.
const PRESETS = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'all'] as const;
type Preset = (typeof PRESETS)[number];

// 정렬 대상(계약 sort enum). 각 필드 × desc/asc + '기본 정렬'.
const SORT_FIELDS: readonly OrderSortField[] = [
  'od_id',
  'od_cart_price',
  'od_receipt_price',
  'od_cancel_price',
  'od_misu',
];

// ── 검색어 — 입력 300ms 뒤 조회(옛 화면과 같음), Enter 는 기다리지 않고 바로.
const q = ref(props.filters.q);
let debounceId: ReturnType<typeof setTimeout> | null = null;
const cancelDebounce = (): void => {
  if (debounceId !== null) clearTimeout(debounceId);
  debounceId = null;
};
watch(q, () => {
  cancelDebounce();
  debounceId = setTimeout(() => {
    debounceId = null;
    emit('change', { q: q.value });
  }, 300);
});
const submitSearch = (): void => {
  cancelDebounce();
  emit('change', { q: q.value });
};

// 선택 상자는 v-model 로 묶는다(ui NativeSelect 의 update 이벤트 타입이 v-model 경로로만 맞는다) — 값은 부모 상태에서
// 읽고, 바꾸면 변경분만 emit 한다.
const qFieldModel = computed<AcceptableValue>({
  get: () => props.filters.qField,
  set: (value) => {
    const field = Q_FIELDS.find((f) => f === value);
    if (field !== undefined) emit('change', { qField: field });
  },
});

const settleModel = computed<AcceptableValue>({
  get: () => props.filters.settleCase,
  set: (value) => {
    emit('change', { settleCase: typeof value === 'string' ? value : '' });
  },
});

const onDateChange = (key: 'from' | 'to', value: string | number): void => {
  const patch: Partial<AdminOrderFilters> = {};
  patch[key] = String(value);
  emit('change', patch);
};

// 체크박스 → 단일 플래그 patch.
const onFlagChange = (key: FlagKey, value: boolean | 'indeterminate'): void => {
  const patch: Partial<AdminOrderFilters> = {};
  patch[key] = value === true;
  emit('change', patch);
};

// KST 자정 기준 Date(UTC 앵커) — 프리셋 날짜 산술을 시간대 흔들림 없이 처리한다.
const kstMidnight = (): Date => {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return new Date(`${ymd}T00:00:00Z`);
};
const toYmd = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86_400_000);

// 프리셋 → { from, to }(레거시 orderlist.php set_date 이식, 주 시작은 일요일).
const presetRange = (preset: Preset): { from: string; to: string } => {
  const today = kstMidnight();
  const dow = today.getUTCDay(); // 0=일요일
  switch (preset) {
    case 'today':
      return { from: toYmd(today), to: toYmd(today) };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: toYmd(y), to: toYmd(y) };
    }
    case 'thisWeek':
      return { from: toYmd(addDays(today, -dow)), to: toYmd(today) };
    case 'thisMonth': {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
      return { from: toYmd(first), to: toYmd(today) };
    }
    case 'lastMonth': {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: toYmd(first), to: toYmd(last) };
    }
    case 'all':
      return { from: '', to: '' };
  }
};

// 정렬: '' = 기본, 그 외 `${field}:${dir}`. 상태의 sort/order 로 역조립.
const sortModel = computed<AcceptableValue>({
  get: () => (props.filters.sort === '' ? '' : `${props.filters.sort}:${props.filters.order}`),
  set: (value) => {
    const raw = typeof value === 'string' ? value : '';
    const [field, dir] = raw.split(':');
    const sortField = SORT_FIELDS.find((f) => f === field);
    if (sortField === undefined || (dir !== 'asc' && dir !== 'desc')) {
      emit('change', { sort: '' });
      return;
    }
    emit('change', { sort: sortField, order: dir });
  },
});

onBeforeUnmount(cancelDebounce);
</script>

<template>
  <Panel class="flex flex-col gap-3">
    <!-- 1행: 검색대상 + 검색어 + 기간 + 프리셋 -->
    <div class="flex flex-wrap items-center gap-2">
      <NativeSelect v-model="qFieldModel" class="w-36" aria-label="검색 대상">
        <NativeSelectOption v-for="f in Q_FIELDS" :key="f" :value="f">
          {{ t(`admin.orders.filter.qField.${f}`) }}
        </NativeSelectOption>
      </NativeSelect>
      <SearchInput v-model="q" :placeholder="t('admin.orders.filter.searchPlaceholder')" @search="submitSearch" />
      <div class="flex items-center gap-1.5">
        <Input
          type="date"
          class="w-36"
          :model-value="props.filters.from"
          :aria-label="t('admin.orders.filter.from')"
          @update:model-value="onDateChange('from', $event)"
        />
        <span class="text-muted-foreground text-sm">~</span>
        <Input
          type="date"
          class="w-36"
          :model-value="props.filters.to"
          :aria-label="t('admin.orders.filter.to')"
          @update:model-value="onDateChange('to', $event)"
        />
      </div>
      <ButtonGroup aria-label="기간 빠른 선택">
        <Button v-for="p in PRESETS" :key="p" variant="outline" size="sm" @click="emit('change', presetRange(p))">
          {{ t(`admin.orders.filter.preset.${p}`) }}
        </Button>
      </ButtonGroup>
    </div>

    <!-- 2행: 결제수단 + 기타 조건 + 정렬 -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
      <div class="flex items-center gap-2">
        <label for="orders-filter-settle" class="text-muted-foreground text-sm">
          {{ t('admin.orders.filter.settleLabel') }}
        </label>
        <NativeSelect id="orders-filter-settle" v-model="settleModel" class="w-36">
          <NativeSelectOption value="">{{ t('admin.orders.filter.settleAll') }}</NativeSelectOption>
          <NativeSelectOption v-for="s in SETTLE_CASES" :key="s" :value="s">
            {{ t(`admin.orders.filter.settle.${s}`) }}
          </NativeSelectOption>
        </NativeSelect>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label v-for="flag in FLAGS" :key="flag" class="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox :model-value="props.filters[flag]" @update:model-value="onFlagChange(flag, $event)" />
          {{ t(`admin.orders.filter.flags.${flag}`) }}
        </label>
      </div>

      <div class="flex items-center gap-2 sm:ml-auto">
        <label for="orders-filter-sort" class="text-muted-foreground text-sm">
          {{ t('admin.orders.filter.sortLabel') }}
        </label>
        <NativeSelect id="orders-filter-sort" v-model="sortModel" class="w-40">
          <NativeSelectOption value="">{{ t('admin.orders.filter.sortDefault') }}</NativeSelectOption>
          <template v-for="field in SORT_FIELDS" :key="field">
            <NativeSelectOption :value="`${field}:desc`">
              {{ t(`admin.orders.filter.sort.${field}`) }} {{ t('admin.orders.filter.sortDesc') }}
            </NativeSelectOption>
            <NativeSelectOption :value="`${field}:asc`">
              {{ t(`admin.orders.filter.sort.${field}`) }} {{ t('admin.orders.filter.sortAsc') }}
            </NativeSelectOption>
          </template>
        </NativeSelect>
      </div>
    </div>
  </Panel>
</template>
