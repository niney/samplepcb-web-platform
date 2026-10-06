<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { ExternalLinkIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { useDeletePart, usePartDetail, useRefreshPart } from '@/admin/useAdminParts';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import { fmtAge, fmtPrice, supplierLabel } from './part-format';

// 부품 상세(검색 결과 행을 펼친 칸) — 구매 조건·가격 구간·스펙 충돌 + [공급사 갱신]·하드 삭제.
// 삭제는 되돌릴 수 없어 2단계 인라인 확인(같은 자리 버튼이 확정으로 바뀌고 5초 안에 안 누르면 풀린다) — 옛 화면 그대로.
// 견적에 연결된 부품은 서버가 삭제를 거부한다(PART_IN_USE). 삭제에 성공하면 deleted 를 낸다.
const props = defineProps<{ partId: string }>();
const emit = defineEmits<{ deleted: [] }>();

const partIdRef = computed<string | null>(() => props.partId);
const detail = usePartDetail(partIdRef);
const detailData = computed(() => detail.data.value?.data ?? null);
const refresh = useRefreshPart();
const del = useDeletePart();
const refreshError = ref('');
const deleteError = ref('');
const deleteArmed = ref(false);
let armTimer: ReturnType<typeof setTimeout> | null = null;
onBeforeUnmount(() => {
  if (armTimer !== null) clearTimeout(armTimer);
});

async function onRefresh(): Promise<void> {
  refreshError.value = '';
  try {
    await refresh.mutateAsync(props.partId); // 성공 시 검색·상세 쿼리 자동 무효화 → 화면 갱신
  } catch {
    refreshError.value = '갱신 실패 — 엔진(sp-engine) 상태를 확인하세요.';
  }
}

function armDelete(): void {
  deleteArmed.value = true;
  if (armTimer !== null) clearTimeout(armTimer);
  armTimer = setTimeout(() => {
    deleteArmed.value = false; // 5초 내 미확정 시 해제
  }, 5_000);
}

async function onDelete(): Promise<void> {
  deleteError.value = '';
  deleteArmed.value = false;
  try {
    await del.mutateAsync(props.partId);
    emit('deleted');
  } catch (error) {
    deleteError.value =
      error instanceof ApiRequestError && error.payload?.error === 'PART_IN_USE'
        ? '견적에 연결된 부품은 삭제할 수 없습니다.'
        : '삭제 실패 — 잠시 후 다시 시도하세요.';
  }
}
</script>

<template>
  <p v-if="detail.isLoading.value" class="text-muted-foreground flex items-center gap-2 text-sm">
    <Spinner />
    불러오는 중…
  </p>
  <div v-else-if="detailData !== null" class="flex flex-col gap-2">
    <!-- 수동 갱신 — 공급사 API 강제 호출 후 재색인 -->
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <Button variant="outline" size="sm" :disabled="refresh.isPending.value" @click="void onRefresh()">
        <RefreshCwIcon />
        {{ refresh.isPending.value ? '공급사 조회 중…' : '공급사 갱신' }}
      </Button>
      <Button v-if="!deleteArmed" variant="outline" size="sm" :disabled="del.isPending.value" @click="armDelete">
        <Trash2Icon class="text-destructive" />
        <span class="text-destructive">{{ del.isPending.value ? '삭제 중…' : '삭제' }}</span>
      </Button>
      <Button v-else variant="destructive" size="sm" @click="void onDelete()">정말 삭제 — 되돌릴 수 없습니다</Button>
      <span class="text-muted-foreground text-xs">데이터 기준: {{ fmtAge(detailData.offersFetchedAt) }}</span>
      <span v-if="refreshError !== ''" class="text-destructive text-xs">{{ refreshError }}</span>
      <span v-if="deleteError !== ''" class="text-destructive text-xs">{{ deleteError }}</span>
    </div>

    <!-- 스펙 충돌 — 채택값(첫 그룹)과 나머지 공급사 값을 병기 -->
    <Alert v-if="detailData.specConflicts !== null" variant="warning" size="sm">
      <AlertTitle>공급사 간 스펙 충돌 — 첫 값이 채택값(다수결→신뢰순위→최신)</AlertTitle>
      <AlertDescription>
        <p v-for="(groups, field) in detailData.specConflicts" :key="field">
          <span class="font-medium">{{ field }}</span>:
          <span v-for="(g, gi) in groups" :key="gi" class="ml-1.5">
            <span :class="gi === 0 ? 'font-semibold' : 'line-through opacity-70'">{{ g.value }}</span>
            <span class="opacity-70">({{ g.suppliers.join(',') }})</span>
          </span>
        </p>
      </AlertDescription>
    </Alert>

    <Panel v-for="offer in detailData.offers" :key="`${offer.supplier}-${offer.supplierSku}`" tone="card" class="text-sm">
      <div class="flex flex-wrap items-center gap-3">
        <span class="font-medium">{{ supplierLabel(offer.supplier) }}</span>
        <Badge
          v-if="offer.derivedFrom !== null"
          variant="success"
          :title="`원천: ${offer.derivedFrom.supplier} ${offer.derivedFrom.supplierSku}`"
        >
          자체 · {{ offer.derivedFrom.supplier }} 기반
        </Badge>
        <Badge v-if="offer.offerKind === 'manufacturer_catalog'" variant="info">취급 가능 · 재고 확인</Badge>
        <span class="text-muted-foreground">{{ offer.supplierSku }}</span>
        <span>
          재고
          <span class="tabular-nums">{{ offer.offerKind === 'manufacturer_catalog' ? '확인 필요' : (offer.stock ?? '—') }}</span>
        </span>
        <span>MOQ <span class="tabular-nums">{{ offer.moq ?? '—' }}</span></span>
        <span class="text-muted-foreground text-xs">{{ fmtAge(offer.fetchedAt) }}</span>
        <a
          v-if="offer.productUrl !== null"
          :href="offer.productUrl"
          target="_blank"
          rel="noopener"
          class="text-primary inline-flex items-center gap-1 hover:underline"
        >
          제품 페이지
          <ExternalLinkIcon class="size-3.5" />
        </a>
      </div>
      <div v-if="offer.priceBreaks.length > 0" class="mt-1.5 flex flex-wrap gap-1.5">
        <Badge v-for="pb in offer.priceBreaks" :key="pb.qty" variant="outline" class="tabular-nums">
          {{ pb.qty }}+ : {{ fmtPrice(pb.price, offer.currency) }}
        </Badge>
      </div>
      <p v-else-if="offer.offerKind === 'manufacturer_catalog'" class="text-info mt-1.5 text-xs font-semibold">가격: 문의 견적</p>
    </Panel>
  </div>
</template>
