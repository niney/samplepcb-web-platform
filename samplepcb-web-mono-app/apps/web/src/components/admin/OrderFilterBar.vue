<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  AdminOrderFilters,
  OrderQField,
  OrderSortField,
} from '../../admin/useAdminOrders';

// 주문 필터 행 — 검색대상+검색어(디바운스 300ms)·기간(프리셋)·결제수단·기타플래그·정렬.
// 상태는 부모(AdminOrders)가 단일 소유하고, 여기서는 변경분만 emit 한다(견적/회원 관례).
const props = defineProps<{ filters: AdminOrderFilters }>();
const emit = defineEmits<{ change: [patch: Partial<AdminOrderFilters>] }>();
const { t } = useI18n();

// 검색대상(레거시 sel_field 10종) — value 는 컬럼명, 라벨은 i18n.
const Q_FIELDS: OrderQField[] = [
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

// 결제수단(레거시 od_settle_case 라디오) — value 는 DB 저장값(한글), 라벨은 i18n.
// '간편결제' 는 서버에서 IN 확장(계약 주석). '' = 전체(미지정).
const SETTLE_CASES = ['무통장', '가상계좌', '계좌이체', '휴대폰', '신용카드', '간편결제', 'KAKAOPAY'];

// 기타선택 체크박스 5종 — 필터 키와 i18n slug.
type FlagKey = 'misu' | 'cancelled' | 'refund' | 'point' | 'coupon';
const FLAGS: FlagKey[] = ['misu', 'cancelled', 'refund', 'point', 'coupon'];

// 날짜 프리셋(레거시 set_date 시맨틱). '전체' = 기간 해제.
const PRESETS = ['today', 'yesterday', 'thisWeek', 'thisMonth', 'lastMonth', 'all'] as const;
type Preset = (typeof PRESETS)[number];

// 정렬 대상(계약 sort enum). 각 필드 × desc/asc + '기본 정렬'.
const SORT_FIELDS: OrderSortField[] = [
  'od_id',
  'od_cart_price',
  'od_receipt_price',
  'od_cancel_price',
  'od_misu',
];

const q = ref(props.filters.q);
let debounceId: ReturnType<typeof setTimeout> | null = null;

const onSearchInput = (): void => {
  if (debounceId !== null) clearTimeout(debounceId);
  debounceId = setTimeout(() => {
    emit('change', { q: q.value });
  }, 300);
};

const onQFieldChange = (e: Event): void => {
  emit('change', { qField: (e.target as HTMLSelectElement).value as OrderQField });
};

// 체크박스 → 단일 플래그 patch. 계산된 키는 Partial 인덱스 쓰기로 타입 안전하게 담는다.
const onFlagChange = (key: FlagKey, e: Event): void => {
  const patch: Partial<AdminOrderFilters> = {};
  patch[key] = (e.target as HTMLInputElement).checked;
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

// 프리셋 → { from, to } 산출(레거시 orderlist.php set_date 이식, 주 시작은 일요일).
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

const applyPreset = (preset: Preset): void => {
  emit('change', presetRange(preset));
};

// 정렬 select: '' = 기본, 그 외 `${field}:${dir}`. 상태의 sort/order 로 역조립.
const sortValue = computed<string>(() =>
  props.filters.sort === '' ? '' : `${props.filters.sort}:${props.filters.order}`,
);
const onSortChange = (e: Event): void => {
  const raw = (e.target as HTMLSelectElement).value;
  if (raw === '') {
    emit('change', { sort: '' });
    return;
  }
  const [field, dir] = raw.split(':') as [OrderSortField, 'asc' | 'desc'];
  emit('change', { sort: field, order: dir });
};

onBeforeUnmount(() => {
  if (debounceId !== null) clearTimeout(debounceId);
});
</script>

<template>
  <div class="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3">
    <!-- 1행: 검색대상 + 검색어 + 기간 + 프리셋 -->
    <div class="flex flex-wrap items-center gap-2">
      <select
        class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        :value="props.filters.qField"
        @change="onQFieldChange"
      >
        <option v-for="f in Q_FIELDS" :key="f" :value="f">
          {{ t(`admin.orders.filter.qField.${f}`) }}
        </option>
      </select>
      <input
        v-model="q"
        type="search"
        class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        :placeholder="t('admin.orders.filter.searchPlaceholder')"
        @input="onSearchInput"
        @keydown.enter="emit('change', { q })"
      >
      <label class="flex items-center gap-1 text-sm text-gray-600">
        <span class="sr-only">{{ t('admin.orders.filter.from') }}</span>
        <input
          type="date"
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          :value="props.filters.from"
          @change="emit('change', { from: ($event.target as HTMLInputElement).value })"
        >
        <span class="text-gray-400">~</span>
        <span class="sr-only">{{ t('admin.orders.filter.to') }}</span>
        <input
          type="date"
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          :value="props.filters.to"
          @change="emit('change', { to: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="p in PRESETS"
          :key="p"
          type="button"
          class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          @click="applyPreset(p)"
        >
          {{ t(`admin.orders.filter.preset.${p}`) }}
        </button>
      </div>
    </div>

    <!-- 2행: 결제수단 + 기타선택 체크박스 + 정렬 -->
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <label class="flex items-center gap-1.5 text-sm text-gray-600">
        <span class="text-gray-400">{{ t('admin.orders.filter.settleLabel') }}</span>
        <select
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          :value="props.filters.settleCase"
          @change="emit('change', { settleCase: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">{{ t('admin.orders.filter.settleAll') }}</option>
          <option v-for="s in SETTLE_CASES" :key="s" :value="s">
            {{ t(`admin.orders.filter.settle.${s}`) }}
          </option>
        </select>
      </label>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <label
          v-for="flag in FLAGS"
          :key="flag"
          class="flex cursor-pointer items-center gap-1 text-sm text-gray-600"
        >
          <input
            type="checkbox"
            class="rounded border-gray-300"
            :checked="props.filters[flag]"
            @change="onFlagChange(flag, $event)"
          >
          {{ t(`admin.orders.filter.flags.${flag}`) }}
        </label>
      </div>

      <label class="ml-auto flex items-center gap-1.5 text-sm text-gray-600">
        <span class="text-gray-400">{{ t('admin.orders.filter.sortLabel') }}</span>
        <select
          class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          :value="sortValue"
          @change="onSortChange"
        >
          <option value="">{{ t('admin.orders.filter.sortDefault') }}</option>
          <template v-for="field in SORT_FIELDS" :key="field">
            <option :value="`${field}:desc`">
              {{ t(`admin.orders.filter.sort.${field}`) }} {{ t('admin.orders.filter.sortDesc') }}
            </option>
            <option :value="`${field}:asc`">
              {{ t(`admin.orders.filter.sort.${field}`) }} {{ t('admin.orders.filter.sortAsc') }}
            </option>
          </template>
        </select>
      </label>
    </div>
  </div>
</template>
