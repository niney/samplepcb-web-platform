<script setup lang="ts">
import { ref } from 'vue';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
} from '@lucide/vue';
import { smartbomFmtWon } from '@/admin/smartbom';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/next/components/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import { ADMIN_ATTENTION_META, type ItemRfqBadgeTone } from '@/next/components/smartbom/smartbom-badges';
import {
  ADMIN_ITEM_FILTER_OPTIONS,
  isManualQuoteItem,
  itemLabel,
  itemLocation,
  RFQ_ROW_PICKER_ID,
  rfqEngineComponentType,
  type AdminItemView,
} from './case-items';
import { useSmartbomCaseContext } from './useSmartbomCase';

// 품목·검토 표 — 관리자 확인 대기열(엔진 판정은 그대로 두고 업무 우선순위·완료 이력만 투영) +
// 다음 RFQ 발송 행 선택(§6.13 — 체크는 이 표에서, 발송 대화상자는 확인만) + 행별 후보·검색·교체·제거.
// 옛 화면은 확인 대상 행을 바탕·왼쪽 막대로 칠했지만, 리뉴얼은 '검토 상태' 배지 하나로만 말한다.
const {
  detail,
  scopeItems,
  rfqItemSelection,
  rfqSelectable,
  allRfqRowsSelected,
  rfqQuickSelectionGroups,
  selectRfqComponentRows,
  toggleRfqRow,
  toggleAllRfqRows,
  useFullRfqScope,
  rfqRowPickerFlash,
  selectUnofferedRfqRows,
  itemPartnerHolders,
  partnerStockItemIds,
  selectPartnerStockRows,
  partnerHolderTitle,
  rfqBadgesFor,
  itemRfqBadgeTitle,
  openRfqReply,
  partMutationUnavailableReason,
  partChangeButtonTitle,
  openPartSelection,
  partAddUnavailableReason,
  openPartAdd,
  partRemove,
  partRemoveError,
  requestPartRemove,
  itemReview,
  adminItemFilter,
  adminItemSearch,
  attentionFirst,
  itemReviewError,
  reviewingItemIds,
  adminItemFilterCounts,
  adminReviewPendingCount,
  visibleAdminItemViews,
  visiblePendingReviewIds,
  canUpdateItemReview,
  adminReviewSummaryLabel,
  adminReviewSummaryVariant,
  adminAttentionTitle,
  adminAttentionReasonSummary,
  itemReviewActionLabel,
  updateItemReviews,
  completeItemReviews,
} = useSmartbomCaseContext();

// 품목 관점 RFQ 칩의 상태 점 — 칩 자체는 버튼(누르면 그 협력사 회신을 연다), 상태는 점 색이 말한다.
const RFQ_DOT: Record<ItemRfqBadgeTone, string> = {
  waiting: 'bg-info',
  replied: 'bg-success',
  missing: 'bg-warning',
  closed: 'bg-muted-foreground',
};

const reviewBadgeVariant = (view: AdminItemView) =>
  view.attention.reviewRequired && view.item.adminReview.completed
    ? 'success'
    : ADMIN_ATTENTION_META[view.attention.kind].variant;

const reviewBadgeLabel = (view: AdminItemView): string => {
  if (view.attention.reviewRequired && view.item.adminReview.completed) {
    return view.attention.reasons.includes('unmatched') ? '미매칭 확인' : '확인 완료';
  }
  if (view.item.adminReview.stale) return '재확인 필요';
  return ADMIN_ATTENTION_META[view.attention.kind].label;
};

const reviewActionTitle = (view: AdminItemView): string =>
  view.item.adminReview.completed
    ? '품목을 다시 확인 대상으로 돌립니다'
    : view.attention.reasons.includes('unmatched')
      ? '부품·가격을 생성하지 않고 미매칭 상태를 예외로 확인합니다'
      : adminAttentionTitle(view);

function toggleReview(view: AdminItemView): void {
  if (view.item.adminReview.completed) void updateItemReviews([view.item.id], false);
  else void completeItemReviews([view.item.id]);
}

// 좁은 화면 — 표가 카드 안에서 가로로 스크롤한다. 이동 버튼은 표 컨테이너를 움직인다.
const tableWrap = ref<HTMLElement | null>(null);
function moveTable(direction: -1 | 1): void {
  tableWrap.value?.querySelector<HTMLElement>('[data-slot="table-container"]')?.scrollBy({
    left: direction * 320,
    behavior: 'smooth',
  });
}
</script>

<template>
  <SectionCard v-if="detail !== null" title="관리자 품목 확인" flush>
    <template #meta>
      <Badge
        :variant="adminReviewSummaryVariant"
        :title="!canUpdateItemReview && adminReviewPendingCount > 0
          ? '검토 이력 기능 도입 전에 회신된 견적입니다. 기존 회신 상태는 변경하지 않습니다.'
          : undefined"
      >
        {{ adminReviewSummaryLabel }}
      </Badge>
    </template>
    <template #actions>
      <Button
        v-if="canUpdateItemReview && visiblePendingReviewIds.length > 0"
        variant="secondary"
        size="sm"
        :disabled="itemReview.isPending.value"
        title="현재 검색·필터에 표시된 확인 대상만 완료 처리합니다"
        @click="void completeItemReviews(visiblePendingReviewIds)"
      >
        <CheckIcon />
        표시된 {{ visiblePendingReviewIds.length }}건 확인 완료
      </Button>
    </template>

    <!-- 확인 대기열 필터·검색 -->
    <div class="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
      <Button
        v-for="option in ADMIN_ITEM_FILTER_OPTIONS"
        :key="option.key"
        :variant="adminItemFilter === option.key ? 'default' : 'outline'"
        size="xs"
        @click="adminItemFilter = option.key"
      >
        {{ option.label }} <span class="tabular-nums">{{ adminItemFilterCounts[option.key] }}</span>
      </Button>
      <div class="ml-auto flex flex-wrap items-center gap-3">
        <InputGroup class="w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            :model-value="adminItemSearch"
            type="search"
            placeholder="MPN·제조사·Excel 행 검색"
            aria-label="MPN·제조사·Excel 행 검색"
            @update:model-value="adminItemSearch = String($event)"
          />
        </InputGroup>
        <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs font-medium">
          <Checkbox :model-value="attentionFirst" @update:model-value="attentionFirst = $event === true" />
          확인 대상 우선
        </label>
      </div>
    </div>
    <NoticeBand v-if="itemReviewError !== ''" tone="destructive" class="font-medium">{{ itemReviewError }}</NoticeBand>

    <!-- 다음 RFQ 발송 행 선택(§6.13) — 체크는 이 표에서, 발송 대화상자는 확인만. 선택이 없으면 전체 발송.
         발송 대화상자 [품목 표에서 고르기]가 이 줄로 데려와 잠깐 테두리를 칠한다. -->
    <div
      :id="RFQ_ROW_PICKER_ID"
      tabindex="-1"
      class="bg-muted/40 text-muted-foreground flex min-h-10 flex-wrap items-center gap-2 border-b px-4 py-1.5 text-xs outline-none transition-shadow"
      :class="rfqRowPickerFlash ? 'ring-primary ring-2 ring-inset' : ''"
    >
      <span>다음 RFQ 발송 행 선택 — 선택 없으면 전체 {{ scopeItems.length }}행 발송</span>
      <Badge v-if="rfqItemSelection.size > 0" variant="info">{{ rfqItemSelection.size }}행 선택됨</Badge>
      <span class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        <Button
          variant="outline"
          size="xs"
          :title="partAddUnavailableReason ?? '카탈로그에서 부품을 검색해 견적에 수동 행으로 추가합니다'"
          @click="openPartAdd"
        >
          <PlusIcon />
          부품 추가
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="rfqQuickSelectionGroups.resistorIds.length === 0"
          title="sp-engine이 저항으로 분류한 행만 선택합니다"
          @click="selectRfqComponentRows('resistor')"
        >
          저항 {{ rfqQuickSelectionGroups.resistorIds.length }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="rfqQuickSelectionGroups.capacitorIds.length === 0"
          title="sp-engine이 캐패시터로 분류한 행만 선택합니다"
          @click="selectRfqComponentRows('capacitor')"
        >
          캐패시터 {{ rfqQuickSelectionGroups.capacitorIds.length }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="rfqQuickSelectionGroups.passiveIds.length === 0"
          title="sp-engine이 저항 또는 캐패시터로 분류한 행을 함께 선택합니다"
          @click="selectRfqComponentRows('passive')"
        >
          저항+캐패시터 {{ rfqQuickSelectionGroups.passiveIds.length }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="rfqQuickSelectionGroups.unofferedIds.length === 0"
          title="선정 구매 조건이 없는 행만 선택합니다"
          @click="selectUnofferedRfqRows"
        >
          구매 조건 없음 {{ rfqQuickSelectionGroups.unofferedIds.length }}
        </Button>
        <Button
          variant="outline"
          size="xs"
          :disabled="partnerStockItemIds.length === 0"
          title="협력사가 보유하고 있다고 알린 행만 선택합니다 (docs/PARTNER_PARTS.md)"
          @click="selectPartnerStockRows"
        >
          협력사 보유 {{ partnerStockItemIds.length }}
        </Button>
        <span
          v-if="rfqQuickSelectionGroups.unclassifiedCount > 0"
          title="엔진 부품 유형이 없는 과거 견적·수동 행은 유형 자동 선택에서 제외됩니다"
        >
          분류 미확인 {{ rfqQuickSelectionGroups.unclassifiedCount }}행 제외
        </span>
        <Button
          v-if="rfqItemSelection.size > 0"
          variant="ghost"
          size="xs"
          title="체크 선택을 지우고 전체 발송 상태로 돌아갑니다"
          @click="useFullRfqScope"
        >
          <RotateCcwIcon />
          선택 해제(전체 발송)
        </Button>
      </span>
    </div>
    <NoticeBand v-if="partRemoveError !== ''" tone="destructive" class="font-medium">{{ partRemoveError }}</NoticeBand>
    <NoticeBand tone="info" class="flex items-center gap-2 text-xs min-[1760px]:hidden">
      <span class="min-w-0 flex-1">좌우로 이동해 협력사 RFQ, 주문수량, 합계와 작업 버튼을 확인할 수 있습니다.</span>
      <Button variant="outline" size="icon-xs" aria-label="품목표 왼쪽으로 이동" @click="moveTable(-1)">
        <ChevronLeftIcon />
      </Button>
      <Button variant="outline" size="icon-xs" aria-label="품목표 오른쪽으로 이동" @click="moveTable(1)">
        <ChevronRightIcon />
      </Button>
    </NoticeBand>

    <div ref="tableWrap">
      <Table class="min-w-260">
        <TableHeader>
          <TableRow>
            <TableHead class="w-12 text-center" title="다음 협력사 RFQ에 포함할 품목 선택">
              <span class="inline-flex flex-col items-center gap-0.5">
                <RowCheckbox
                  :checked="allRfqRowsSelected ? true : rfqItemSelection.size > 0 ? 'indeterminate' : false"
                  label="다음 RFQ 발송 행 전체 선택/해제"
                  @change="toggleAllRfqRows"
                />
                <span class="text-xs">RFQ</span>
              </span>
            </TableHead>
            <TableHead class="min-w-28">검토 상태</TableHead>
            <TableHead>Excel 위치</TableHead>
            <TableHead>부품</TableHead>
            <TableHead>선정 구매 조건</TableHead>
            <TableHead>협력사 RFQ</TableHead>
            <TableHead class="text-right">주문수량</TableHead>
            <TableHead class="text-right">합계</TableHead>
            <TableHead class="text-right">작업</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="view in visibleAdminItemViews" :key="view.item.id">
            <TableCell class="text-center">
              <RowCheckbox
                v-if="rfqSelectable(view.item)"
                :checked="rfqItemSelection.has(view.item.id)"
                :label="`${itemLabel(view.item)} RFQ 포함`"
                @change="toggleRfqRow(view.item.id)"
              />
            </TableCell>
            <TableCell class="min-w-28 align-top">
              <Badge :variant="reviewBadgeVariant(view)" :title="adminAttentionTitle(view)">
                <CheckIcon v-if="view.attention.reviewRequired && view.item.adminReview.completed" />
                {{ reviewBadgeLabel(view) }}
              </Badge>
              <p
                v-if="view.attention.reasons.length > 0"
                class="text-muted-foreground mt-1 max-w-32 text-xs whitespace-normal"
                :title="adminAttentionTitle(view)"
              >
                {{ adminAttentionReasonSummary(view) }}
              </p>
            </TableCell>
            <TableCell class="text-muted-foreground whitespace-nowrap">{{ itemLocation(view.item) }}</TableCell>
            <TableCell>
              <div class="flex flex-wrap items-center gap-1">
                <span class="font-medium">{{ itemLabel(view.item) }}</span>
                <Badge v-if="rfqEngineComponentType(view.item) === 'resistor'" variant="outline" title="sp-engine 분류">저항</Badge>
                <Badge
                  v-else-if="rfqEngineComponentType(view.item) === 'capacitor'"
                  variant="outline"
                  title="sp-engine 분류"
                >
                  캐패시터
                </Badge>
              </div>
              <div class="text-muted-foreground text-xs">{{ view.item.manufacturerName }}</div>
            </TableCell>
            <TableCell class="whitespace-normal">
              <template v-if="view.item.selectedOffer !== null">
                {{ view.item.selectedOffer.supplier }} · {{ view.item.selectedOffer.unitPrice }}
                {{ view.item.selectedOffer.currency }} @{{ view.item.selectedOffer.breakQty }}+
              </template>
              <span v-else class="text-warning">{{ view.item.matchStatus === 'none' ? '미매칭' : '구매 조건 없음' }}</span>
              <!-- 협력사 보유(docs/PARTNER_PARTS.md) — 누구에게 견적요청을 걸지 판단 -->
              <div
                v-if="itemPartnerHolders(view.item.id).length > 0"
                class="text-warning mt-0.5 max-w-60 truncate text-xs font-medium"
                :title="partnerHolderTitle(view.item.id)"
              >
                협력사 보유 · {{ itemPartnerHolders(view.item.id).map((h) => h.partnerName).join(', ') }}
              </div>
            </TableCell>
            <TableCell class="min-w-52">
              <div v-if="rfqBadgesFor(view.item.id).length > 0" class="flex flex-wrap gap-1">
                <Button
                  v-for="badge in rfqBadgesFor(view.item.id)"
                  :key="badge.rfq.rfqId"
                  variant="outline"
                  size="xs"
                  class="max-w-48"
                  :title="itemRfqBadgeTitle(badge)"
                  @click="openRfqReply(badge.rfq)"
                >
                  <span class="size-2 shrink-0 rounded-full" :class="RFQ_DOT[badge.tone]" />
                  <span class="truncate">{{ badge.rfq.partnerName }}</span>
                  <span class="shrink-0">· {{ badge.label }}</span>
                </Button>
              </div>
              <span v-else-if="rfqSelectable(view.item)" class="text-muted-foreground text-xs">미요청</span>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ view.item.orderQty.toLocaleString('ko-KR') }}</TableCell>
            <TableCell class="text-right tabular-nums">
              {{ view.item.lineTotalKrw === null ? '—' : smartbomFmtWon(Math.round(view.item.lineTotalKrw)) }}
            </TableCell>
            <TableCell class="text-right">
              <div class="flex flex-col items-end gap-1">
                <Button
                  v-if="view.attention.reviewRequired && canUpdateItemReview"
                  :variant="view.item.adminReview.completed ? 'ghost' : 'secondary'"
                  size="xs"
                  :disabled="!canUpdateItemReview || reviewingItemIds.has(view.item.id)"
                  :title="reviewActionTitle(view)"
                  @click="toggleReview(view)"
                >
                  <CheckIcon v-if="!view.item.adminReview.completed" />
                  {{ itemReviewActionLabel(view) }}
                </Button>
                <Button variant="outline" size="xs" @click="openPartSelection(view.item, 'candidates')">
                  {{ view.pending ? '검토하기' : '후보·근거' }}
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  :title="partChangeButtonTitle(view.item)"
                  @click="openPartSelection(view.item, 'search')"
                >
                  <SearchIcon />
                  부품 검색·변경
                </Button>
                <Button
                  v-if="isManualQuoteItem(view.item)"
                  variant="outline"
                  size="xs"
                  :disabled="partRemove.isPending.value || partMutationUnavailableReason() !== null"
                  :title="partMutationUnavailableReason() ?? '관리자가 수동 추가한 이 품목을 견적에서 제거합니다'"
                  @click="requestPartRemove(view.item)"
                >
                  <Trash2Icon class="text-destructive" />
                  수동 행 제거
                </Button>
              </div>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="visibleAdminItemViews.length === 0" :colspan="9" text="검색·필터 조건에 맞는 품목이 없습니다." />
        </TableBody>
      </Table>
    </div>
  </SectionCard>
</template>
