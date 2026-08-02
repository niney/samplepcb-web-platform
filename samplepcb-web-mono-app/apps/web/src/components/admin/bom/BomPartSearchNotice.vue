<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomPartSearchSupplementResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBomPartsSupplement } from '../../../bom/useBom';

const props = withDefaults(defineProps<{
  query: string;
  mode: 'mpn' | 'exact' | 'similar' | 'text';
  interpretedSpecCount: number;
  needed?: number;
  auto?: boolean;
  waitForCatalog?: boolean;
  disabled?: boolean;
}>(), {
  needed: 1,
  auto: false,
  waitForCatalog: false,
  disabled: false,
});

const emit = defineEmits<{
  start: [];
  complete: [data: BomPartSearchSupplementResponseType['data']];
  failed: [];
}>();

const supplement = useBomPartsSupplement();
const lastAutoKey = ref<string | null>(null);
const canSupplement = computed(() => props.query.trim() !== '');
const errorMessage = computed(() => {
  const reason = supplement.error.value;
  if (!(reason instanceof ApiRequestError)) return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (reason.payload?.error === 'SEARCH_DAILY_LIMIT') return '오늘 사용할 수 있는 공급사 추가 확인 횟수를 모두 사용했습니다.';
  if (reason.payload?.error === 'BOM_ENGINE_UNREACHABLE') return '부품 검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
});
const statusText = computed(() => {
  if (supplement.isPending.value) return '공급사 확인 중';
  if (supplement.isSuccess.value) {
    return supplement.data.value?.data.catalog.status === 'completed'
      ? '공급사 확인 완료'
      : '공급사 확인 완료 · 반영 중';
  }
  if (supplement.isError.value) return '공급사 확인 실패';
  if (props.mode === 'mpn') return '정확 MPN 일치';
  if (props.mode === 'exact') return `규격 ${String(props.interpretedSpecCount)}개 일치`;
  if (props.mode === 'similar') return '유사 후보';
  return '카탈로그 결과';
});
const toneClass = computed(() => {
  if (supplement.isError.value) return 'border-red-200 bg-red-50 text-red-800';
  if (supplement.isPending.value || supplement.isSuccess.value) return 'border-blue-200 bg-blue-50 text-blue-900';
  if (props.mode === 'mpn' || props.mode === 'exact') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (props.mode === 'similar') return 'border-amber-200 bg-amber-50 text-amber-900';
  return 'border-slate-200 bg-slate-50 text-slate-700';
});

watch(
  // 필요수량 편집은 기존 오퍼에 MOQ·주문배수를 다시 적용하면 되므로 유료 공급사
  // 검색을 반복하지 않는다. 관리자가 명시적으로 검색어를 확정한 경우에만 자동 1회.
  () => [props.query, props.auto] as const,
  () => {
    supplement.reset();
    if (props.auto) requestSupplement(true);
  },
  { immediate: true },
);

function requestSupplement(automatic = false): void {
  if (!canSupplement.value || props.disabled || supplement.isPending.value) return;
  const key = props.query.trim();
  if (automatic && lastAutoKey.value === key) return;
  if (automatic) lastAutoKey.value = key;
  emit('start');
  supplement.mutate(
    {
      q: props.query,
      needed: props.needed,
      waitForCatalog: props.waitForCatalog,
    },
    {
      onSuccess: (response) => {
        emit('complete', response.data);
      },
      onError: () => {
        emit('failed');
      },
    },
  );
}
</script>

<template>
  <div
    class="mt-3 flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-1.5 text-xs"
    :class="toneClass"
    aria-live="polite"
  >
    <span v-if="supplement.isPending.value" class="size-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
    <strong>{{ statusText }}</strong>
    <span v-if="supplement.isSuccess.value" class="text-[11px] opacity-75">
      후보 {{ supplement.data.value?.data.total ?? 0 }} · API {{ supplement.data.value?.data.engine.apiCalls ?? 0 }} · 캐시 {{ supplement.data.value?.data.engine.cacheHits ?? 0 }}
    </span>
    <span v-else-if="supplement.isError.value" class="text-[11px] opacity-80">{{ errorMessage }}</span>
    <button
      v-if="canSupplement && !supplement.isPending.value"
      type="button"
      class="ml-auto h-7 shrink-0 rounded-md border border-current bg-surface px-2.5 text-[11px] font-bold transition hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled"
      @click="requestSupplement(false)"
    >
      {{ supplement.isSuccess.value ? '다시 확인' : '추가 확인' }}
    </button>
  </div>
</template>
