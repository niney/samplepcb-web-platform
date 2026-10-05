<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from '@lucide/vue';
import type { BomQuoteCandidateType } from '@sp/api-contract';
import { formatLifecycleDate, lifecycleLabel, replacementSourceBadgeLabel, replacementSourceNoticeDescription, replacementSourceNoticeLabel } from '@/bom/lifecycle-presentation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import PartImage from '@/next/components/bom/PartImage.vue';
import {
  candidateActionReasonId,
  candidateHasCatalogInquiry,
  candidateLifecycleTitle,
  candidateReplacementTitle,
  cautionLabel,
  conflictNoticePrefix,
  conflictText,
  fmtAge,
  fmtDelta,
  fmtOfferTotal,
  fmtRate,
  fmtUnit,
  fmtWon,
  isPartnerCandidate,
  lifecycleTone,
  missingNoticePrefix,
  missingText,
  offerActionReasonId,
  offersForDisplay,
  offerStockLabel,
  offerStockState,
  offerStockTone,
  requirementBadgeLabel,
  statusLabel,
  verificationTone,
} from './labels';
import { useCandidateDrawer } from './useCandidateDrawer';

// 후보 한 장 — 왼쪽은 부품 식별(배지·품번·제조사·근거 배지), 오른쪽은 필요수량 기준 구매 조건과 [선택] 동작.
// 펼치면 공급사별 구매 조건(재고·MOQ·단가·합계)과 조건별 [선택]. 비활성 이유는 버튼 아래에 늘 글로 남긴다.
const props = defineProps<{ candidate: BomQuoteCandidateType }>();

const {
  props: drawer,
  expanded,
  provisionalSelectionPending,
  technicalTopCandidate,
  requirementTooltipCandidateKey,
  requirementTooltipId,
  showRequirementTooltip,
  scheduleRequirementTooltipClose,
  toggleCandidate,
  candidateEmphasis,
  recommendationLabel,
  recommendationTone,
  candidateSelectedOffer,
  candidateTotalLabel,
  candidateDisplayOfferUnitLabel,
  candidateDisplayOfferCaption,
  severeOfferSurplus,
  offerSurplusLabel,
  candidateHasSevereDisplayOffer,
  candidateDisplayOfferSurplusLabel,
  candidateOfferIssueSummary,
  candidateUnavailableLabel,
  candidateActionDisabled,
  candidateActionLabel,
  candidateActionDisabledReason,
  offerActionDisabled,
  offerActionLabel,
  offerActionDisabledReason,
  selectBest,
  selectOffer,
} = useCandidateDrawer();

// 카드 테두리 강조 — 바탕은 칠하지 않는다(상태는 배지가 말한다).
const EMPHASIS = {
  pending: 'border-warning ring-2 ring-warning/30',
  selected: 'border-primary ring-1 ring-primary/20',
  blocked: 'border-destructive/40',
  caution: 'border-warning/40',
  plain: '',
} as const;

const isExpanded = computed(() => expanded.value.has(props.candidate.candidateKey));
const actionReason = computed(() => candidateActionDisabledReason(props.candidate));
const issueOrUnavailable = computed(
  () => candidateOfferIssueSummary(props.candidate) ?? candidateUnavailableLabel(props.candidate),
);
const lastBuyDate = computed(() => formatLifecycleDate(props.candidate.lastBuyDate));
const currentBadgeLabel = computed(() =>
  provisionalSelectionPending.value
    ? '현재 선택 · 검토 대기'
    : candidateHasCatalogInquiry(props.candidate)
      ? '현재 선정 · 문의'
      : '현재 선택',
);
</script>

<template>
  <article class="bg-card overflow-hidden rounded-lg border transition" :class="EMPHASIS[candidateEmphasis(candidate)]">
    <div class="flex flex-col gap-2 p-3">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="flex min-w-0 flex-1 items-start gap-2.5">
          <PartImage :src="candidate.imageUrl" :alt="`${candidate.mpn} 부품 이미지`" class="size-14 shrink-0 rounded-md border" />
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <Badge v-if="candidate.selected" :variant="provisionalSelectionPending ? 'warning' : 'default'">
                {{ currentBadgeLabel }}
              </Badge>
              <Badge v-if="recommendationLabel(candidate) !== ''" :variant="recommendationTone(candidate)">
                {{ recommendationLabel(candidate) }}
              </Badge>
              <Badge v-if="candidate.technicalReviewRank !== null" variant="warning">검토 {{ candidate.technicalReviewRank }}순위</Badge>
              <Badge v-if="candidate.candidateKey === drawer.context?.technicalTopCandidateKey" variant="info">기술 1위</Badge>
              <Badge variant="secondary">{{ statusLabel(candidate.status) }}</Badge>
              <Badge
                v-if="candidate.lifecycleCode !== 'unknown'"
                :variant="lifecycleTone(candidate.lifecycleCode)"
                :title="candidateLifecycleTitle(candidate)"
              >
                {{ lifecycleLabel(candidate.lifecycleCode) }}
              </Badge>
              <Badge v-if="candidate.replacementSources.length > 0" variant="outline" :title="candidateReplacementTitle(candidate)">
                {{ replacementSourceBadgeLabel(candidate.replacementSources) }}
              </Badge>
              <Badge v-if="candidate.safety === 'caution'" variant="warning">{{ cautionLabel(candidate) }}</Badge>
              <Badge v-if="candidate.safety === 'blocked'" variant="danger">호환성 확인 필요</Badge>
            </div>
            <h4 class="text-base font-semibold break-words">{{ candidate.mpn }}</h4>
            <p class="text-muted-foreground text-sm">
              {{ candidate.manufacturerName ?? '제조사 미확인'
              }}<span v-if="candidate.packageCode"> · {{ candidate.packageCode }}</span><span v-if="candidate.lifecycleStatus">
                · {{ candidate.lifecycleStatus }}</span>
            </p>
            <p v-if="lastBuyDate !== null" class="text-destructive text-xs font-semibold">최종 구매 가능일 {{ lastBuyDate }}</p>
            <p v-if="candidate.description" class="text-muted-foreground line-clamp-1 text-xs" :title="candidate.description">
              {{ candidate.description }}
            </p>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <Badge
                as="button"
                type="button"
                :variant="verificationTone(candidate)"
                :aria-describedby="requirementTooltipCandidateKey === candidate.candidateKey ? requirementTooltipId : undefined"
                @mouseenter="showRequirementTooltip(candidate, $event)"
                @mouseleave="scheduleRequirementTooltipClose"
                @focus="showRequirementTooltip(candidate, $event)"
                @blur="scheduleRequirementTooltipClose"
                @click.stop="showRequirementTooltip(candidate, $event)"
              >
                {{ requirementBadgeLabel(candidate) }}
              </Badge>
              <Badge v-if="drawer.context?.originalMpn !== null" variant="info">
                품번 {{ Math.round(candidate.identityConfidence * 100) }}%
              </Badge>
              <Badge variant="secondary">공급사 {{ candidate.corroboratingSuppliers.length }}</Badge>
              <Badge
                v-if="isPartnerCandidate(candidate)"
                variant="warning"
                title="협력사가 보유를 알린 부품입니다 — 가격·납기는 견적요청 회신이 정본입니다"
              >
                협력사 보유
              </Badge>
            </div>
          </div>
        </div>

        <Panel size="sm" class="flex w-full shrink-0 flex-col gap-0.5 md:w-52">
          <p class="text-muted-foreground text-xs">
            {{
              isPartnerCandidate(candidate)
                ? '협력사 보유'
                : candidateSelectedOffer(candidate) !== null
                  ? '현재 선정 구매 조건'
                  : '필요수량 기준 최적 구매 조건'
            }}
          </p>
          <strong class="text-lg tabular-nums">{{ candidateTotalLabel(candidate) }}</strong>
          <p v-if="candidateDisplayOfferUnitLabel(candidate) !== null" class="text-muted-foreground text-xs tabular-nums">
            단가 {{ candidateDisplayOfferUnitLabel(candidate) }}
          </p>
          <p v-if="candidateDisplayOfferCaption(candidate) !== null" class="text-info text-xs font-semibold">
            {{ candidateDisplayOfferCaption(candidate) }}
          </p>
          <p
            v-else-if="candidate.bestLineTotalKrw !== null"
            class="text-xs font-semibold"
            :class="(candidate.lineDeltaKrw ?? 0) <= 0 ? 'text-success' : 'text-warning'"
          >
            현재 대비 {{ fmtDelta(candidate.lineDeltaKrw) }}
          </p>
          <p v-else-if="isPartnerCandidate(candidate)" class="text-warning text-xs font-semibold">견적요청 후 확정</p>
          <p
            v-else
            class="text-xs font-semibold"
            :class="candidateUnavailableLabel(candidate) === '재고 없음' ? 'text-destructive' : 'text-warning'"
          >
            {{ issueOrUnavailable }}
          </p>
          <Badge
            v-if="candidateHasSevereDisplayOffer(candidate)"
            variant="warning"
            class="mt-1"
            :title="candidateDisplayOfferSurplusLabel(candidate)"
          >
            주문수량 과다 · 자동추천 제외
          </Badge>
          <p
            v-if="candidate.savingsVsTechnicalKrw !== null && candidate.savingsVsTechnicalKrw > 0"
            class="text-muted-foreground text-xs"
          >
            기술 1위 대비 {{ fmtWon(candidate.savingsVsTechnicalKrw) }} 절감 {{ fmtRate(candidate.savingsVsTechnicalRate) }}
          </p>
          <Button
            v-if="!drawer.readOnly"
            class="mt-2 w-full"
            :disabled="candidateActionDisabled(candidate)"
            :aria-describedby="actionReason === null ? undefined : candidateActionReasonId(candidate)"
            @click="selectBest(candidate)"
          >
            {{ candidateActionLabel(candidate) }}
          </Button>
          <p v-if="actionReason !== null" :id="candidateActionReasonId(candidate)" class="text-muted-foreground mt-1 text-xs">
            {{ candidate.selected && candidateHasCatalogInquiry(candidate) ? '선정 완료:' : '선택 비활성:' }}
            {{ actionReason }}
          </p>
        </Panel>
      </div>

      <Alert v-if="candidate.conflicts.length > 0" :variant="candidate.selectionEligibility === 'blocked' ? 'destructive' : 'warning'" size="sm">
        <AlertDescription><b>{{ conflictNoticePrefix(candidate) }}:</b> {{ conflictText(candidate) }}</AlertDescription>
      </Alert>
      <Alert v-if="candidate.selectionEligibility === 'manual_review'" variant="warning" size="sm">
        <AlertDescription>
          <template v-if="candidateHasCatalogInquiry(candidate)">
            <b>제조사 카탈로그 취급:</b> 부품 식별은 확인됐지만 실제 재고와 가격은 문의 후 확정해야 합니다.
          </template>
          <template v-else-if="candidate.recommended">
            <b>엔진 검토 권장:</b> 구매 가능한 재고·가격을 포함해 실제 적용 후보로 임시 선정했습니다. 예상 견적에는 반영되며,
            확인 후 검토를 완료할 수 있습니다.
          </template>
          <template v-else-if="drawer.context?.technicalFallbackUsed && candidate.candidateKey === technicalTopCandidate?.candidateKey">
            <b>기술 1순위:</b> 기술 근거상 가장 앞선 후보지만 적용 가능한 구매 조건이 없어 현재 견적에는 적용하지 않았습니다.
          </template>
          <template v-else-if="candidate.reviewRecommended">
            <b>엔진 기술 검토 1순위:</b> 기술 근거상 가장 유력하지만 구매 조건을 충족하지 못해 적용 후보와 분리했습니다.
          </template>
          <template v-else>
            <b>엔진 검토 필요:</b> 자동 선정 조건을 충족하지 않았습니다. 근거와 누락·충돌 항목을 확인한 뒤 직접 선택할 수 있습니다.
          </template>
        </AlertDescription>
      </Alert>
      <Alert v-if="candidate.replacementSources.length > 0" variant="info" size="sm">
        <AlertDescription>
          <b>{{ replacementSourceNoticeLabel(candidate.replacementSources) }}:</b>
          {{ replacementSourceNoticeDescription(candidate.replacementSources, candidate.replacementForMpn) }}
        </AlertDescription>
      </Alert>
      <Alert v-if="candidate.missingRequirements.length > 0" variant="warning" size="sm">
        <AlertDescription><b>{{ missingNoticePrefix(candidate) }}:</b> {{ missingText(candidate) }}</AlertDescription>
      </Alert>

      <div>
        <Button variant="link" size="sm" :aria-expanded="isExpanded" @click="toggleCandidate(candidate.candidateKey)">
          공급사 구매 조건 {{ candidate.offers.length }}개 {{ isExpanded ? '접기' : '보기' }}
          <ChevronUpIcon v-if="isExpanded" />
          <ChevronDownIcon v-else />
        </Button>
      </div>
    </div>

    <div v-if="isExpanded" class="border-t">
      <div v-if="candidate.offers.length > 0" class="divide-y">
        <div
          v-for="offer in offersForDisplay(candidate)"
          :key="offer.offerKey"
          class="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5 text-sm">
              <strong class="uppercase">{{ offer.supplier }}</strong>
              <span class="text-muted-foreground text-xs">{{ offer.supplierSku || 'SKU 미확인' }}</span>
              <Badge v-if="offer.packaging" variant="outline">{{ offer.packaging }}</Badge>
              <Badge v-if="offerStockState(offer) !== null" :variant="offerStockTone(offer)">{{ offerStockLabel(offer) }}</Badge>
              <Badge v-if="severeOfferSurplus(offer)" variant="warning" :title="offerSurplusLabel(offer)">
                주문수량 과다 · 자동추천 제외
              </Badge>
              <Badge v-if="offer.recommendation === 'automatic'" variant="success">자동 추천 구매 조건</Badge>
              <Badge v-else-if="offer.recommendation === 'manual_review'" variant="warning">검토 권장 구매 조건</Badge>
              <Badge v-else-if="candidate.bestOfferKey === offer.offerKey" variant="secondary">구매 조건 1위</Badge>
              <Badge v-if="drawer.context?.selectedOfferKey === offer.offerKey">사용 중</Badge>
            </div>
            <div class="text-muted-foreground mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>단가 <b class="text-foreground">{{ fmtUnit(offer) }}</b></span>
              <span>주문 <b class="text-foreground">{{ offer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}</b></span>
              <span v-if="severeOfferSurplus(offer)" class="text-warning font-semibold">{{ offerSurplusLabel(offer) }}</span>
              <span>합계 <b class="text-foreground">{{ fmtOfferTotal(offer) }}</b></span>
              <span v-if="offer.purchaseFitRank !== null">구매적합 <b class="text-foreground">{{ offer.purchaseFitRank }}위</b></span>
              <span v-if="offer.priceRank !== null">가격 <b class="text-foreground">{{ offer.priceRank }}위</b></span>
              <span>
                재고
                <b class="text-foreground">{{
                  offer.offerKind === 'manufacturer_catalog' ? '확인 필요' : (offer.stock?.toLocaleString('ko-KR') ?? '—')
                }}</b>
              </span>
              <span>MOQ <b class="text-foreground">{{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
              <span>기준 {{ fmtAge(offer.fetchedAt) }}</span>
            </div>
          </div>
          <div class="flex items-start gap-2">
            <Button v-if="offer.productUrl" variant="outline" size="sm" as-child>
              <a :href="offer.productUrl" target="_blank" rel="noopener noreferrer">
                제품
                <ExternalLinkIcon />
              </a>
            </Button>
            <div v-if="!drawer.readOnly" class="flex max-w-48 flex-col gap-1">
              <Button
                variant="outline"
                size="sm"
                :disabled="offerActionDisabled(candidate, offer)"
                :aria-describedby="offerActionDisabledReason(candidate, offer) === null ? undefined : offerActionReasonId(offer)"
                @click="selectOffer(candidate, offer)"
              >
                {{ offerActionLabel(candidate, offer) }}
              </Button>
              <p
                v-if="offerActionDisabledReason(candidate, offer) !== null"
                :id="offerActionReasonId(offer)"
                class="text-muted-foreground text-xs"
              >
                선택 비활성: {{ offerActionDisabledReason(candidate, offer) }}
              </p>
            </div>
          </div>
        </div>
      </div>
      <p v-else class="text-muted-foreground p-4 text-sm">가격이 있는 공급사 구매 조건이 없습니다.</p>
    </div>
  </article>
</template>
