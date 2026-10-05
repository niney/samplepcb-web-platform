<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomPartSearchSupplementResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBomPartsSupplement } from '@/bom/useBom';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import Panel from '@/next/components/common/Panel.vue';

// 부품 검색 결과 위 상태 띠 + 공급사 추가 확인 — 옛 components/admin/bom/BomPartSearchNotice.vue 의 짝
// (같은 props·emits). 색은 검색 판정(정확·규격 일치=완료, 유사=주의, 확인 중=진행, 실패=오류).
const props = withDefaults(
  defineProps<{
    query: string;
    mode: 'mpn' | 'exact' | 'similar' | 'text';
    interpretedSpecCount: number;
    needed?: number;
    auto?: boolean;
    waitForCatalog?: boolean;
    disabled?: boolean;
  }>(),
  {
    needed: 1,
    auto: false,
    waitForCatalog: false,
    disabled: false,
  },
);

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
    return supplement.data.value?.data.catalog.status === 'completed' ? '공급사 확인 완료' : '공급사 확인 완료 · 반영 중';
  }
  if (supplement.isError.value) return '공급사 확인 실패';
  if (props.mode === 'mpn') return '정확 MPN 일치';
  if (props.mode === 'exact') return `규격 ${String(props.interpretedSpecCount)}개 일치`;
  if (props.mode === 'similar') return '유사 후보';
  return '카탈로그 결과';
});
const tone = computed<'muted' | 'info' | 'warning' | 'success' | 'destructive'>(() => {
  if (supplement.isError.value) return 'destructive';
  if (supplement.isPending.value || supplement.isSuccess.value) return 'info';
  if (props.mode === 'mpn' || props.mode === 'exact') return 'success';
  if (props.mode === 'similar') return 'warning';
  return 'muted';
});

watch(
  // 필요수량 편집은 기존 구매 조건에 MOQ·주문배수를 다시 적용하면 되므로 유료 공급사 검색을 반복하지
  // 않는다. 관리자가 명시적으로 검색어를 확정한 경우에만 자동 1회.
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
  <Panel size="xs" :tone="tone" class="mt-3 flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-live="polite">
    <Spinner v-if="supplement.isPending.value" class="size-3.5" />
    <strong>{{ statusText }}</strong>
    <span v-if="supplement.isSuccess.value" class="opacity-75">
      후보 {{ supplement.data.value?.data.total ?? 0 }} · API {{ supplement.data.value?.data.engine.apiCalls ?? 0 }} · 캐시
      {{ supplement.data.value?.data.engine.cacheHits ?? 0 }}
    </span>
    <span v-else-if="supplement.isError.value" class="opacity-80">{{ errorMessage }}</span>
    <Button
      v-if="canSupplement && !supplement.isPending.value"
      variant="outline"
      size="xs"
      class="ml-auto shrink-0"
      :disabled="disabled"
      @click="requestSupplement(false)"
    >
      {{ supplement.isSuccess.value ? '다시 확인' : '추가 확인' }}
    </Button>
  </Panel>
</template>
