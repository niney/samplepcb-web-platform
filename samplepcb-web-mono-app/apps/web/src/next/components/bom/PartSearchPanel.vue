<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ArrowLeftIcon, ArrowRightIcon, SearchIcon } from '@lucide/vue';
import type { BomPartHitType, BomPartSearchSupplementResponseType, PartHitType } from '@sp/api-contract';
import { normalizeManufacturer, normalizeMpn, type OfferPick } from '@sp/utils';
import { useBomPartsSearch } from '@/bom/useBom';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Empty, EmptyDescription } from '@/next/components/ui/empty';
import { Input } from '@/next/components/ui/input';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/next/components/ui/item';
import { Spinner } from '@/next/components/ui/spinner';
import PartImage from './PartImage.vue';
import PartOfferOptions from './PartOfferOptions.vue';
import PartSearchNotice from './PartSearchNotice.vue';
import { searchOriginMeta, type SearchResultOrigin } from './search/search-origin';

// 카탈로그 검색 + 결과 목록 + 부품 1건 구매 조건 비교(PartOfferOptions) 셸 — 옛 components/admin/bom/
// BomPartSearchPanel.vue 의 짝(같은 props·emits). 견적의 부품 교체/추가(선택 문맥)와 단일 검색 대화상자류가 공유한다.
const props = withDefaults(
  defineProps<{
    initialQuery: string;
    currentPartId?: string | null;
    selecting?: boolean;
    needed?: number;
    usdKrwRate?: number | null;
    /** 열람 전용(단일 검색 화면) — 부품 변경 CTA 없이 구매 조건 비교만 제공한다. */
    browse?: boolean;
    /** 확정 CTA의 업무 문맥. 기본은 기존 품목 변경이며 수동 행 대화상자에서는 추가로 표시한다. */
    selectionAction?: 'change' | 'add';
    /** 관리자는 명시 검색마다 공급사 캐시/API 최신 확인까지 기본 수행한다. */
    autoSupplierCheck?: boolean;
  }>(),
  {
    currentPartId: null,
    selecting: false,
    needed: 1,
    usdKrwRate: null,
    browse: false,
    selectionAction: 'change',
    autoSupplierCheck: true,
  },
);

const emit = defineEmits<{
  select: [part: PartHitType, pick: OfferPick | null];
}>();

const input = ref(props.initialQuery);
const q = ref(props.initialQuery.trim());
const selectedPart = ref<BomPartHitType | null>(null);
const neededRef = computed(() => props.needed);
const search = useBomPartsSearch(
  q,
  computed(() => true),
  neededRef,
);
const items = computed(() => search.data.value?.data.items ?? []);
const supplierChecking = ref(false);
const supplierCheckCompleted = ref(false);
const localIdentityKeys = ref<Set<string>>(new Set());
const localMpnKeys = ref<Set<string>>(new Set());
const supplierIdentityKeys = ref<Set<string>>(new Set());
const supplierMpnKeys = ref<Set<string>>(new Set());

function identityKey(part: Pick<BomPartHitType, 'mpn' | 'manufacturerName'>): string {
  return `${normalizeMpn(part.mpn)}\u001f${normalizeManufacturer(part.manufacturerName)}`;
}

function mpnKey(part: Pick<BomPartHitType, 'mpn'>): string {
  return normalizeMpn(part.mpn);
}

function resetSupplierOrigins(): void {
  supplierChecking.value = false;
  supplierCheckCompleted.value = false;
  localIdentityKeys.value = new Set();
  localMpnKeys.value = new Set();
  supplierIdentityKeys.value = new Set();
  supplierMpnKeys.value = new Set();
}

function onSupplierCheckStart(): void {
  selectedPart.value = null;
  supplierChecking.value = true;
  supplierCheckCompleted.value = false;
  localIdentityKeys.value = new Set(items.value.map(identityKey));
  localMpnKeys.value = new Set(items.value.map(mpnKey));
  supplierIdentityKeys.value = new Set();
  supplierMpnKeys.value = new Set();
}

function onSupplierCheckComplete(data: BomPartSearchSupplementResponseType['data']): void {
  supplierIdentityKeys.value = new Set(data.items.map(identityKey));
  supplierMpnKeys.value = new Set(data.items.map(mpnKey));
  supplierCheckCompleted.value = true;
  supplierChecking.value = false;
}

function onSupplierCheckFailed(): void {
  supplierChecking.value = false;
  supplierCheckCompleted.value = false;
}

function resultOrigin(part: BomPartHitType): SearchResultOrigin {
  if (!supplierCheckCompleted.value) return 'local-catalog';
  const supplierMatched = supplierIdentityKeys.value.has(identityKey(part)) || supplierMpnKeys.value.has(mpnKey(part));
  if (!supplierMatched) return 'local-catalog';
  const existedLocally = localIdentityKeys.value.has(identityKey(part)) || localMpnKeys.value.has(mpnKey(part));
  return existedLocally ? 'supplier-refreshed' : 'supplier-new';
}

const resultGroups = computed(() => {
  const grouped: Record<SearchResultOrigin, BomPartHitType[]> = {
    'supplier-new': [],
    'supplier-refreshed': [],
    'local-catalog': [],
  };
  for (const part of items.value) grouped[resultOrigin(part)].push(part);
  return (['supplier-new', 'supplier-refreshed', 'local-catalog'] as const)
    .map((origin) => ({ origin, items: grouped[origin] }))
    .filter((group) => group.items.length > 0);
});

watch(
  () => props.initialQuery,
  (value) => {
    input.value = value;
    q.value = value.trim();
    selectedPart.value = null;
    resetSupplierOrigins();
  },
);

function submit(): void {
  resetSupplierOrigins();
  q.value = input.value.trim();
  selectedPart.value = null;
}

function previewPart(part: BomPartHitType): void {
  if (props.selecting || supplierChecking.value) return;
  selectedPart.value = part;
}

function returnToResults(): void {
  if (props.selecting || supplierChecking.value) return;
  selectedPart.value = null;
}

const supplierChannels = (part: BomPartHitType): string =>
  part.suppliers.filter((supplier) => supplier !== 'samplepcb').join(', ') || '외부 공급사 없음';
</script>

<template>
  <div>
    <form class="flex flex-col gap-2 sm:flex-row" role="search" @submit.prevent="submit">
      <Input
        v-model="input"
        type="search"
        placeholder="품번·스펙·패키지 자유 검색 (예: GRM155 / 4k7 0402 / 100nF 16V)"
        class="min-w-0 flex-1"
      />
      <Button type="submit" :disabled="selecting || supplierChecking">
        <SearchIcon />
        검색
      </Button>
    </form>

    <template v-if="selectedPart === null">
      <PartSearchNotice
        v-if="search.data.value !== undefined"
        :query="q"
        :mode="search.data.value.data.searchMode"
        :interpreted-spec-count="search.data.value.data.interpretedSpecCount"
        :needed="needed"
        :auto="autoSupplierCheck"
        wait-for-catalog
        :disabled="selecting"
        @start="onSupplierCheckStart"
        @complete="onSupplierCheckComplete"
        @failed="onSupplierCheckFailed"
      />
      <div
        v-if="search.isFetching.value"
        class="text-info mt-4 flex items-center justify-center gap-2 py-5 text-sm font-medium"
        aria-live="polite"
      >
        <Spinner />
        카탈로그를 검색하고 있습니다.
      </div>
      <Alert v-else-if="search.isError.value" variant="destructive" size="sm" class="mt-4">
        <AlertDescription>검색 결과를 불러오지 못했습니다. 잠시 후 다시 검색해 주세요.</AlertDescription>
      </Alert>
      <Empty v-else-if="q === ''" class="mt-4">
        <EmptyDescription>품번이나 스펙을 입력해 부품을 검색해 주세요.</EmptyDescription>
      </Empty>
      <Empty v-else-if="items.length === 0" class="mt-4">
        <EmptyDescription>
          {{
            supplierChecking
              ? '기존 카탈로그에는 결과가 없습니다. 공급사에서 추가 후보를 확인하고 있습니다.'
              : '기존 카탈로그와 공급사 추가 확인 결과에 선택 가능한 부품이 없습니다.'
          }}
        </EmptyDescription>
      </Empty>

      <div v-else class="mt-4 flex flex-col gap-5">
        <section v-for="resultGroup in resultGroups" :key="resultGroup.origin">
          <div class="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong class="text-xs" :class="searchOriginMeta[resultGroup.origin].textClass">
              {{ searchOriginMeta[resultGroup.origin].label }} {{ resultGroup.items.length }}개
            </strong>
            <span class="text-muted-foreground text-xs">{{ searchOriginMeta[resultGroup.origin].description }}</span>
          </div>
          <div class="flex flex-col gap-2">
            <Item
              v-for="part in resultGroup.items"
              :key="part.id"
              as="button"
              type="button"
              :variant="part.id === currentPartId ? 'muted' : 'outline'"
              size="sm"
              class="w-full text-left"
              :disabled="selecting || supplierChecking"
              @click="previewPart(part)"
            >
              <ItemMedia>
                <PartImage
                  :src="part.imageUrl"
                  :alt="`${part.mpn} 부품 이미지`"
                  :placeholder="null"
                  class="size-12 shrink-0 rounded-md border"
                />
              </ItemMedia>
              <ItemContent class="min-w-0">
                <ItemTitle class="flex-wrap">
                  <span class="break-all">{{ part.mpn }}</span>
                  <span class="text-muted-foreground font-normal">{{ part.manufacturerName ?? '제조사 미확인' }}</span>
                  <Badge :variant="searchOriginMeta[resultGroup.origin].variant">{{ searchOriginMeta[resultGroup.origin].label }}</Badge>
                  <Badge v-if="part.packageCode" variant="secondary">{{ part.packageCode }}</Badge>
                  <Badge v-if="part.id === currentPartId">현재 부품</Badge>
                </ItemTitle>
                <ItemDescription>{{ part.description ?? '설명 없음' }}</ItemDescription>
                <span class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span v-if="part.hasCatalogInquiryOffer && part.totalStock === 0" class="text-info font-medium">취급 가능 · 재고 확인</span>
                  <span v-else>재고 <b class="text-foreground">{{ part.totalStock.toLocaleString('ko-KR') }}</b></span>
                  <span v-if="part.hasCatalogInquiryOffer && part.minPrice === null" class="text-info font-medium">가격 문의 견적</span>
                  <span>구매 채널 <b class="text-foreground">{{ supplierChannels(part) }}</b></span>
                </span>
              </ItemContent>
              <ItemActions>
                <span class="text-primary inline-flex items-center gap-1 text-xs font-medium">
                  {{ part.id === currentPartId ? '공급 포장 변경' : '구매 조건 보기' }}
                  <ArrowRightIcon class="size-3.5" />
                </span>
              </ItemActions>
            </Item>
          </div>
        </section>
      </div>
    </template>

    <Card v-else class="mt-4 gap-0 overflow-hidden py-0">
      <div class="border-b p-4">
        <Button variant="link" size="xs" :disabled="selecting || supplierChecking" @click="returnToResults">
          <ArrowLeftIcon />
          검색 결과로
        </Button>
        <div class="mt-2 flex items-start gap-3">
          <PartImage
            :src="selectedPart.imageUrl"
            :alt="`${selectedPart.mpn} 부품 이미지`"
            :placeholder="null"
            class="size-14 shrink-0 rounded-md border"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm break-all">{{ selectedPart.mpn }}</strong>
              <Badge :variant="searchOriginMeta[resultOrigin(selectedPart)].variant">
                {{ searchOriginMeta[resultOrigin(selectedPart)].label }}
              </Badge>
              <Badge v-if="selectedPart.packageCode" variant="secondary">부품 패키지 {{ selectedPart.packageCode }}</Badge>
              <Badge v-if="selectedPart.id === currentPartId">현재 부품</Badge>
            </div>
            <p class="text-muted-foreground mt-1 text-xs">{{ selectedPart.manufacturerName ?? '제조사 미확인' }}</p>
            <p class="text-muted-foreground mt-1 line-clamp-2 text-xs">{{ selectedPart.description ?? '설명 없음' }}</p>
          </div>
        </div>
      </div>

      <PartOfferOptions
        :part="selectedPart"
        :needed="needed"
        :usd-krw-rate="usdKrwRate"
        :selecting="selecting || supplierChecking"
        :browse="browse"
        :selection-action="selectionAction"
        :current-part-id="currentPartId"
        @select="(part, pick) => emit('select', part, pick)"
      />
    </Card>
  </div>
</template>
