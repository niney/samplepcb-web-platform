<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { BomQuoteSearchRequirementsBodyType, PartHitType } from '@sp/api-contract';
import type { OfferPick } from '@sp/utils';
import { Badge } from '@/next/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/next/components/ui/sheet';
import { Spinner } from '@/next/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/next/components/ui/tabs';
import CandidateListSection from './candidate/CandidateListSection.vue';
import CatalogSearchView from './candidate/CatalogSearchView.vue';
import CurrentSelectionSection from './candidate/CurrentSelectionSection.vue';
import ExternalSearchNotice from './candidate/ExternalSearchNotice.vue';
import OriginalBomSection from './candidate/OriginalBomSection.vue';
import OutsideSearchSections from './candidate/OutsideSearchSections.vue';
import RequirementTooltip from './candidate/RequirementTooltip.vue';
import RequirementsSection from './candidate/RequirementsSection.vue';
import ReviewSelectionDialog from './candidate/ReviewSelectionDialog.vue';
import SearchTraceSection from './candidate/SearchTraceSection.vue';
import type { CandidateDrawerProps } from './candidate/types';
import { createCandidateDrawer, provideCandidateDrawer } from './candidate/useCandidateDrawer';

// 부품 선택 서랍 — 옛 components/admin/bom/BomCandidateDrawer.vue 의 짝(같은 props·emits). Case 상세·확인 요청
// 작성·BOM 작업대가 함께 쓴다. 한 행의 엔진 후보(추천 후보)와 카탈로그 직접 검색(전체 부품 검색)을 오간다.
//   · 틀은 shadcn Sheet(오른쪽, 최대 4xl). Esc·바깥 클릭은 맨 위 층부터 닫는다(필수조건 판 → 검토 확인창 → 서랍).
//   · 상태·판정은 candidate/useCandidateDrawer.ts 가 한 번 만들어 섹션들에 provide 한다.
const props = withDefaults(defineProps<CandidateDrawerProps>(), {
  readOnly: false,
  selecting: false,
  catalogSelecting: false,
  hasCatalogPart: false,
  selectionError: '',
  selectionLockedReason: '',
  forceSelectionAllowed: false,
  requirementsSaving: false,
  requirementsError: '',
  requirementsProgress: '',
  requirementsNotice: '',
  externalSearchRunning: false,
  externalSearchError: '',
  interactionLocked: false,
  searchRefreshEnabled: true,
  initialView: 'candidates',
  searchInitialQuery: '',
  currentPartId: null,
  needed: 1,
  usdKrwRate: null,
});

const emit = defineEmits<{
  close: [];
  select: [candidateKey: string, offerKey: string | null];
  catalogSelect: [part: PartHitType, pick: OfferPick | null];
  catalogOffers: [];
  searchRequirements: [requirements: BomQuoteSearchRequirementsBodyType];
  externalSupplierSearch: [];
}>();

const state = createCandidateDrawer(props, emit);
provideCandidateDrawer(state);
const { view, hideRequirementTooltipNow } = state;

// 열 때 첫 프레임엔 위쪽(원본 BOM·검색 조건·현재 선정)만 그리고 후보 목록·선택 이력은 다음 프레임에 붙인다 —
// 후보 카드는 배지·버튼이 수백 개라 한 번에 만들면 서랍이 뜨는 첫 프레임이 옛 서랍보다 늦다. 목록은 첫 화면 아래라
// 서랍이 미끄러져 들어오는 동안 채워진다. 닫힐 때는 그대로 둔다(닫히는 동안 내용이 비지 않게).
const lowerSectionsReady = ref(false);
let lowerSectionsFrame = 0;
watch(
  () => props.open,
  (open) => {
    cancelAnimationFrame(lowerSectionsFrame);
    if (!open) return;
    lowerSectionsReady.value = false;
    // 두 번: 한 번이면 붙이는 일이 첫 그리기 직전 같은 프레임에 들어간다.
    lowerSectionsFrame = requestAnimationFrame(() => {
      lowerSectionsFrame = requestAnimationFrame(() => {
        lowerSectionsReady.value = true;
      });
    });
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  cancelAnimationFrame(lowerSectionsFrame);
});

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
const setView = (value: string | number): void => {
  if (value === 'candidates' || value === 'search') view.value = value;
};
</script>

<template>
  <Sheet :open="open" @update:open="onOpenChange">
    <SheetContent side="right" class="w-full sm:max-w-4xl">
      <div class="flex h-full min-h-0 flex-col">
        <header class="shrink-0 border-b px-5 py-3 pr-12 sm:px-6">
          <div class="flex min-w-0 items-baseline gap-2">
            <SheetTitle>부품 선택</SheetTitle>
            <span class="text-primary shrink-0 text-xs font-semibold tracking-widest uppercase">Part selection</span>
          </div>
          <SheetDescription class="mt-0.5">
            <template v-if="context !== null">
              Excel 원본 {{ context.originalMpn ?? context.originalValue ?? '품번 미기재' }} · 필요수량
              {{ context.neededQty.toLocaleString('ko-KR') }}개
            </template>
            <template v-else-if="searchInitialQuery !== ''">현재 품번 {{ searchInitialQuery }}</template>
            <template v-else>한 행의 부품 후보를 비교하고 고릅니다.</template>
          </SheetDescription>
        </header>

        <nav class="shrink-0 border-b px-5 py-2 sm:px-6" aria-label="부품 선택 방식">
          <Tabs :model-value="view" @update:model-value="setView">
            <TabsList class="w-full">
              <TabsTrigger value="candidates">
                추천 후보
                <Badge v-if="context !== null" variant="secondary">{{ context.candidates.length }}</Badge>
              </TabsTrigger>
              <TabsTrigger value="search" :disabled="interactionLocked">전체 부품 검색</TabsTrigger>
            </TabsList>
          </Tabs>
        </nav>

        <div v-if="selectionLockedReason !== ''" class="shrink-0 px-4 pt-3 sm:px-6">
          <Alert variant="warning" size="sm" role="status">
            <AlertTitle>
              {{ forceSelectionAllowed ? '관리자 강제 변경으로 적용할 수 있습니다.' : '검색·비교는 가능합니다.' }}
            </AlertTitle>
            <AlertDescription>
              {{ forceSelectionAllowed ? '적용 전 영향 범위를 다시 확인합니다' : '현재 견적에는 적용할 수 없습니다' }}:
              {{ selectionLockedReason }}
            </AlertDescription>
          </Alert>
        </div>

        <div class="bg-muted/30 min-h-0 flex-1 overflow-y-auto" @scroll="hideRequirementTooltipNow">
          <CatalogSearchView v-if="view === 'search'" />
          <div v-else-if="loading" class="text-muted-foreground grid min-h-80 place-items-center p-8 text-sm">
            <div class="flex flex-col items-center gap-3">
              <Spinner class="size-6" />
              후보 스냅샷을 불러오는 중입니다.
            </div>
          </div>
          <div v-else-if="failed" class="p-4 sm:p-6">
            <Alert variant="destructive">
              <AlertTitle>후보 정보를 불러오지 못했습니다.</AlertTitle>
              <AlertDescription>견적은 유지되어 있습니다. 패널을 닫고 다시 시도해 주세요.</AlertDescription>
            </Alert>
          </div>
          <div v-else-if="context !== null" class="flex flex-col gap-3 p-3 sm:p-4">
            <Alert v-if="selectionError !== ''" variant="destructive" size="sm">
              <AlertDescription>{{ selectionError }}</AlertDescription>
            </Alert>
            <Alert v-if="requirementsProgress !== ''" variant="info" size="sm" role="status" aria-live="polite">
              <Spinner />
              <AlertTitle>{{ requirementsProgress }}</AlertTitle>
              <AlertDescription>현재 후보는 이전 검색 결과이며, 완료되면 이 패널 안에서 자동으로 교체됩니다.</AlertDescription>
            </Alert>
            <Alert v-else-if="requirementsNotice !== ''" variant="success" size="sm" role="status" aria-live="polite">
              <AlertTitle>{{ requirementsNotice }}</AlertTitle>
            </Alert>
            <OriginalBomSection />
            <RequirementsSection v-if="state.requirements.visible.value && !readOnly && searchRefreshEnabled" />
            <ExternalSearchNotice
              v-if="
                context.localCatalogTrace?.catalogType === 'ingested_rc' &&
                  context.localCatalogTrace.outcome === 'selected' &&
                  !readOnly &&
                  searchRefreshEnabled
              "
            />
            <SearchTraceSection v-if="context.localCatalogTrace !== null || context.searchTrace !== null" />
            <CurrentSelectionSection />
            <template v-if="lowerSectionsReady">
              <CandidateListSection />
              <OutsideSearchSections />
            </template>
          </div>
        </div>

        <footer class="text-muted-foreground shrink-0 border-t px-5 py-2 text-xs sm:px-6">
          <template v-if="view === 'candidates'">
            가격은 필요수량·MOQ·주문배수·재고·환율을 반영한 부품 예상금액입니다. 운송료·관리비·세금은 전체 견적에서 별도로
            계산됩니다.
          </template>
          <template v-else>전체 부품 검색 선택은 엔진 추천을 덮어쓰지 않고 관리자의 카탈로그 직접 선택으로 별도 기록됩니다.</template>
        </footer>
      </div>
    </SheetContent>
  </Sheet>
  <ReviewSelectionDialog />
  <RequirementTooltip />
</template>
