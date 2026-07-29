<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomQuoteItemType } from '@sp/api-contract';
import { isSevereOrderSurplus } from '@sp/utils';
import PartImage from '../ui/PartImage.vue';
import BomPriceBreaks from './BomPriceBreaks.vue';
import { SUPPLIER_FALLBACK_ICON, SUPPLIER_META } from '../../bom/supplier-meta';
import statusCheckIcon from '../../assets/bom/ic-status-check.svg';

// 매칭 결과 테이블의 한 행 — 컴포넌트 경계로 재렌더를 행 단위로 격리한다.
// item 은 부모 소유의 로컬 편집 객체(참조 안정 유지) — 여기서는 읽기만, 변경은 emit.
// 부모가 재렌더돼도 props 가 그대로면 Vue 가 이 행의 patch 를 건너뛴다.

const props = defineProps<{
  item: BomQuoteItemType;
  needed: number;
  isDraft: boolean;
  editingLocked: boolean;
  enriching: boolean;
}>();

const emit = defineEmits<{
  'toggle-include': [];
  'qty-change': [qty: number];
  'confirm-quantity': [qty: number];
  'open-offers': [];
  'open-candidates': [];
  'open-search': [];
}>();

const quantityDraft = ref(props.item.bomQty);

watch(
  () => props.item.bomQty,
  (value) => {
    quantityDraft.value = value;
  },
);

const EDIT_LOCK_TITLE = '공급사 확인이 완료되면 수정할 수 있습니다';

const procurementUnavailabilityReason = computed(() =>
  props.item.matchEvidence?.procurementUnavailabilityReason ?? null,
);

const catalogInquiry = computed(() =>
  props.item.catalogInquiry
  || procurementUnavailabilityReason.value === 'catalog_inquiry',
);
const catalogSelectionApplied = computed(() =>
  catalogInquiry.value && props.item.matchStatus !== 'none',
);
const quantityMissing = computed(() => props.item.quantityState === 'missing');

const engineSearchExcluded = computed(() =>
  props.item.matchEvidence?.componentStatus === 'excluded'
  || props.item.matchEvidence?.searchRequirementGuidance?.readiness === 'excluded',
);

const engineStockStatusLabel = computed(() => {
  if (procurementUnavailabilityReason.value === 'out_of_stock') return '재고 없음';
  if (procurementUnavailabilityReason.value === 'insufficient_stock') return '재고 부족';
  if (procurementUnavailabilityReason.value === 'stock_unverified') return '재고 확인 필요';
  return null;
});

const stockShort = computed(() => {
  if (
    procurementUnavailabilityReason.value === 'out_of_stock'
    || procurementUnavailabilityReason.value === 'insufficient_stock'
  ) return true;
  const o = props.item.selectedOffer;
  return o !== null && o.stock !== null && o.stock < props.item.orderQty;
});

const stockStatusLabel = computed(() => {
  if (engineStockStatusLabel.value !== null) return engineStockStatusLabel.value;
  if (!stockShort.value) return null;
  return props.item.selectedOffer?.stock === 0 ? '재고 없음' : '재고 부족';
});

const procurementUnavailabilitySummary = computed(() => {
  switch (procurementUnavailabilityReason.value) {
    case 'out_of_stock':
      return '구매 가능한 후보 오퍼의 재고가 모두 없습니다';
    case 'insufficient_stock':
      return '모든 후보 오퍼의 재고가 필요 수량보다 부족합니다';
    case 'stock_unverified':
      return '후보 오퍼의 재고를 확인할 수 없습니다';
    case 'catalog_inquiry':
      return catalogSelectionApplied.value
        ? '제조사 카탈로그로 부품은 선정됐으며 실제 재고 확인과 가격 문의가 필요합니다'
        : '제조사 카탈로그 취급 후보이며 선정 전 검토와 재고·가격 문의가 필요합니다';
    case 'price_unavailable':
      return '재고 가능한 후보 오퍼의 가격을 확인할 수 없습니다';
    case 'technical_unavailable':
      return '재고 가능한 후보가 있으나 필수 기술 조건으로 선정할 수 없습니다';
    case 'supplier_unavailable':
      return '허용된 공급사에서 구매 가능한 오퍼를 찾지 못했습니다';
    case 'no_offer':
      return '구매 가능한 공급사 오퍼를 찾지 못했습니다';
    case 'input_incomplete':
      return '수량 등 구매 판단에 필요한 입력값이 부족합니다';
    case 'other':
      return '구매 가능한 후보를 선정하지 못했습니다';
    case null:
      return null;
  }
});

const provisionalSelectionPending = computed(() =>
  props.item.selectionSource === 'auto'
  && props.item.matchEvidence?.selectionApplicationState === 'provisional_selected'
  && props.item.matchEvidence.confirmationRequired,
);

const technicalFallbackUsed = computed(() =>
  props.item.matchEvidence?.technicalFallbackUsed === true,
);

const surplusQty = computed(() => Math.max(0, props.item.orderQty - props.needed));
const orderRatio = computed(() => props.item.orderQty / Math.max(1, props.needed));
const severeOrderSurplus = computed(() =>
  isSevereOrderSurplus(props.needed, props.item.orderQty),
);
const severeOrderSurplusLabel = computed(() =>
  `필요 ${props.needed.toLocaleString('ko-KR')}개 · 주문 ${props.item.orderQty.toLocaleString('ko-KR')}개 · 초과 ${surplusQty.value.toLocaleString('ko-KR')}개 (${orderRatio.value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}배)`,
);

const searchTraceSummary = computed(() =>
  props.item.matchEvidence?.searchTraceSummary ?? null,
);
const searchLimitReasons = computed(() =>
  searchTraceSummary.value?.limitReasons ?? [],
);
const jobCallLimitReached = computed(() =>
  searchLimitReasons.value.includes('job_call_limit'),
);
const supplierQuotaReached = computed(() =>
  searchLimitReasons.value.includes('supplier_quota'),
);

const sortedPriceBreaks = computed(() => {
  const offer = props.item.selectedOffer;
  if (offer === null) return [];
  const rows = [...offer.priceBreaks].sort((a, b) => a.qty - b.qty);
  // 일부 레거시/수동 오퍼는 가격구간 배열 없이 적용 단가만 보존되어 있다.
  return rows.length > 0 ? rows : [{ qty: offer.breakQty, price: offer.unitPrice }];
});

function evidenceRequirementLabel(code: string): string {
  const labels: Record<string, string> = {
    mount_style: '실장 방식',
    package: '패키지',
    diameter_mm: '직경',
    capacitance_f: '정전용량',
    voltage_v: '정격전압',
    tolerance_percent: '허용오차',
    dielectric: '유전체',
    resistance_ohm: '저항값',
    power_w: '정격전력',
    inductance_h: '인덕턴스',
    impedance_ohm: '임피던스',
    impedance_frequency_hz: '임피던스 기준 주파수',
    current_a: '정격전류',
    frequency_hz: '주파수',
    color: '발광색',
    pin_count: '핀 수',
    row_count: '열 수',
    pitch_mm: '피치',
    part_type: '부품 유형',
    manufacturer: '제조사',
    part_number: '품번',
  };
  return labels[code] ?? code;
}

function evidenceConflictLabel(code: string): string {
  if (code.endsWith('_mismatch')) {
    return `${evidenceRequirementLabel(code.slice(0, -'_mismatch'.length))} 불일치`;
  }
  if (code.endsWith('_source_conflict')) {
    return `${evidenceRequirementLabel(code.slice(0, -'_source_conflict'.length))} 정보 충돌`;
  }
  return evidenceRequirementLabel(code);
}

const exactIdentityWarning = computed(() => {
  const item = props.item;
  const evidence = item.matchEvidence;
  if (
    evidence?.selectionMode !== 'exact'
    || item.selectionSource !== 'auto'
    || item.selectedOffer === null
  ) return null;
  const details: string[] = [];
  if (evidence.conflicts.length > 0) {
    details.push(`불일치: ${evidence.conflicts.map(evidenceConflictLabel).join(', ')}`);
  }
  if (evidence.missingRequirements.length > 0) {
    details.push(`미확인: ${evidence.missingRequirements.map(evidenceRequirementLabel).join(', ')}`);
  }
  return details.length === 0 ? null : `품번 정확 일치로 선정 · ${details.join(' · ')}`;
});

const rowClass = computed(() => {
  const item = props.item;
  if (quantityMissing.value) return 'bg-amber-50/70';
  if (!item.included) return 'opacity-45';
  if (severeOrderSurplus.value) return 'bg-orange-50/80';
  if (provisionalSelectionPending.value) return 'bg-surface';
  if (exactIdentityWarning.value !== null) return 'bg-amber-50/40';
  if (catalogInquiry.value) return 'bg-blue-50/50';
  // 보강 진행 중엔 분홍(경고) 대신 중립 — 미매칭은 아직 최종 판정이 아니다
  if (item.matchStatus === 'none') {
    if (props.enriching) return 'bg-surface';
    if (engineStockStatusLabel.value !== null) return 'bg-surface-warn';
    return item.recommendedCandidateKey !== null || item.matchEvidence?.selectionMode === 'review'
      ? 'bg-amber-50/60'
      : 'bg-surface-danger';
  }
  if (stockShort.value) return 'bg-surface-warn'; // 재고 부족 — 시안 노랑
  return 'bg-surface';
});

const evidenceTitle = computed(() => {
  const evidence = props.item.matchEvidence;
  if (evidence === null) return '';
  const details = [
    `엔진 판정: ${evidence.componentStatus}`,
    `안전 후보: ${String(evidence.eligibleCandidateCount)}/${String(evidence.candidateCount)}`,
  ];
  if (procurementUnavailabilitySummary.value !== null) {
    details.push(`구매 불가: ${procurementUnavailabilitySummary.value}`);
  }
  if (engineSearchExcluded.value) details.push('검색 제외: 엔진이 비조달 행으로 판정');
  if (severeOrderSurplus.value) details.push(`과다 주문수량: ${severeOrderSurplusLabel.value}`);
  if (provisionalSelectionPending.value) details.push('엔진 선정: 사용자 검토 권장');
  if (technicalFallbackUsed.value) details.push('기술 1순위 구매 불가: 엔진이 다음 구매 가능 후보를 적용');
  if (evidence.conflicts.length > 0) details.push(`충돌: ${evidence.conflicts.join(', ')}`);
  if (evidence.missingRequirements.length > 0) details.push(`누락: ${evidence.missingRequirements.join(', ')}`);
  return details.join('\n');
});

const reasonSummary = computed(() => {
  const item = props.item;
  const evidence = item.matchEvidence;
  if (quantityMissing.value) {
    return item.matchStatus === 'none'
      ? '원본 수량이 없어 견적에서 제외됐습니다. 수량 확인 후 검색·견적에 포함됩니다'
      : '부품은 선정됐지만 원본 수량이 없어 견적에서 제외됐습니다';
  }
  if (severeOrderSurplus.value) return severeOrderSurplusLabel.value;
  if (engineSearchExcluded.value) return '엔진 판정에 따라 공급사 검색 대상에서 제외된 행입니다';
  if (evidence === null) return item.matchStatus === 'manual' ? '카탈로그에서 직접 선택' : '후보 근거 없음';
  if (procurementUnavailabilitySummary.value !== null) return procurementUnavailabilitySummary.value;
  if (item.selectionSource === 'customer') {
    if (evidence.decisionReasonCodes.includes('offer-choice')) return '공급사 오퍼 직접 선택';
    return evidence.selectedTechnicalRank === null
      ? '후보 직접 선택'
      : `기술 ${String(evidence.selectedTechnicalRank)}순위 후보 직접 선택`;
  }
  if (exactIdentityWarning.value !== null) return exactIdentityWarning.value;
  if (evidence.technicalFallbackUsed === true) {
    return evidence.selectedTechnicalRank === null
      ? '기술 1순위 구매 불가 · 엔진 구매 가능 후보 적용'
      : `기술 1순위 구매 불가 · 기술 ${String(evidence.selectedTechnicalRank)}순위 적용`;
  }
  if (evidence.recommendationType === 'price' && evidence.priceEvidence?.savingsKrw !== null) {
    const saving = evidence.priceEvidence?.savingsKrw ?? null;
    const rateValue = evidence.priceEvidence?.savingsRate ?? null;
    return saving === null
      ? '동급 후보 중 가격 최적'
      : `기술 1위 대비 ${Math.round(saving).toLocaleString('ko-KR')}원 절감${rateValue === null ? '' : ` · ${(rateValue * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`}`;
  }
  if (evidence.recommendationType === 'lifecycle') return '기술 1순위 NRND/EOL · 활성 부품 추천';
  if (evidence.recommendationType === 'purchase-fit') {
    const price = evidence.priceEvidence;
    return price === null
      ? '동급 후보 중 구매조건 우선 · 일부 확인 필요'
      : `동급 후보 중 필요 ${price.neededQty.toLocaleString('ko-KR')}개 → 주문 ${price.orderQty.toLocaleString('ko-KR')}개 · 일부 확인 필요`;
  }
  const required = evidence.requiredRequirementCount;
  return required > 0
    ? `확인된 항목 ${String(evidence.verifiedRequirementCount)}/${String(required)} · 충돌 없음`
    : `안전 후보 ${String(evidence.eligibleCandidateCount)}개 중 기술 우선`;
});

interface TotalStatusPresentation {
  label: string;
  helperLabel: string | null;
  toneClass: string;
  priceClass: string;
  title: string;
  pulse: boolean;
}

const totalStatusPresentation = computed<TotalStatusPresentation>(() => {
  const item = props.item;
  if (quantityMissing.value) {
    return {
      label: item.matchStatus === 'none' ? 'Review' : 'Matched',
      helperLabel: '수량 확인 필요',
      toneClass: item.matchStatus === 'none'
        ? 'border border-line-neutral bg-surface text-state-review'
        : 'border border-line-neutral bg-surface text-state-matched',
      priceClass: item.matchStatus === 'none' ? 'text-state-review' : 'text-state-matched',
      title: reasonSummary.value,
      pulse: false,
    };
  }
  if (severeOrderSurplus.value) {
    return {
      label: 'Review',
      helperLabel: '수량 검토',
      toneClass: 'border border-line-neutral bg-surface text-state-review',
      priceClass: 'text-state-review',
      title: severeOrderSurplusLabel.value,
      pulse: false,
    };
  }
  if (engineSearchExcluded.value) {
    return {
      label: 'Excluded',
      helperLabel: null,
      toneClass: 'bg-slate-200 text-slate-700',
      priceClass: 'text-slate-500',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (item.matchStatus === 'none' && props.enriching) {
    return {
      label: 'Searching',
      helperLabel: null,
      toneClass: 'bg-blue-500/15 text-blue-600',
      priceClass: 'text-blue-600',
      title: '',
      pulse: true,
    };
  }
  if (catalogInquiry.value) {
    const selected = catalogSelectionApplied.value;
    return {
      label: selected ? 'Matched' : 'Review',
      helperLabel: selected ? '재고·가격 문의' : '취급 가능',
      toneClass: selected
        ? 'border border-line-neutral bg-surface text-state-matched'
        : 'border border-line-neutral bg-surface text-state-review',
      priceClass: selected ? 'text-state-matched' : 'text-state-review',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (item.matchStatus === 'none' && engineStockStatusLabel.value !== null) {
    const stockUnverified = procurementUnavailabilityReason.value === 'stock_unverified';
    const insufficientStock = procurementUnavailabilityReason.value === 'insufficient_stock';
    return {
      label: stockUnverified ? 'Unmatched' : 'No Stock',
      helperLabel: stockUnverified
        ? '재고 확인 필요'
        : insufficientStock ? '재고 부족' : null,
      toneClass: stockUnverified
        ? 'bg-state-unmatched/15 text-state-unmatched'
        : 'bg-state-nostock/15 text-state-nostock',
      priceClass: stockUnverified ? 'text-state-unmatched' : 'text-state-nostock',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (provisionalSelectionPending.value) {
    return {
      label: 'Matched',
      helperLabel: '검토 대기',
      toneClass: 'border border-line-neutral bg-surface text-state-matched',
      priceClass: 'text-state-matched',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (item.matchStatus === 'none' && item.matchEvidence?.selectionMode === 'review') {
    return {
      label: 'Review',
      helperLabel: '검토 필요',
      toneClass: 'border border-line-neutral bg-surface text-state-review',
      priceClass: 'text-state-review',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (item.matchStatus === 'none') {
    return {
      label: 'Unmatched',
      helperLabel: null,
      toneClass: 'bg-state-unmatched/15 text-state-unmatched',
      priceClass: 'text-state-unmatched',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (stockStatusLabel.value !== null) {
    const stockUnverified = stockStatusLabel.value === '재고 확인 필요';
    return {
      label: stockUnverified ? 'Matched' : 'No Stock',
      helperLabel: stockStatusLabel.value === '재고 부족' || stockUnverified
        ? stockStatusLabel.value
        : null,
      toneClass: stockUnverified
        ? 'border border-line-neutral bg-surface text-state-matched'
        : 'bg-state-nostock/15 text-state-nostock',
      priceClass: stockUnverified ? 'text-state-matched' : 'text-state-nostock',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  if (item.selectedOffer !== null) {
    return {
      label: 'Matched',
      helperLabel: item.selectionSource === 'customer' ? '고객 선택 완료' : null,
      toneClass: 'bg-state-matched/15 text-state-matched',
      priceClass: 'text-state-matched',
      title: evidenceTitle.value,
      pulse: false,
    };
  }
  return {
    label: 'Matched',
    helperLabel: '가격 확인 필요',
    toneClass: 'border border-line-neutral bg-surface text-state-matched',
    priceClass: 'text-state-matched',
    title: evidenceTitle.value,
    pulse: false,
  };
});

const sourceRowText = computed(() => {
  const value = props.item.sourceRow?.sourceRows;
  const rows = Array.isArray(value)
    ? value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0)
    : [];
  if (rows.length === 0) return props.item.sourceSheetName === null ? '추가' : '—';
  return `${rows.join(', ')}행`;
});

const sourceLocationTitle = computed(() => {
  const sheetName = props.item.sourceSheetName?.trim() ?? '';
  if (sheetName === '') return sourceRowText.value === '추가' ? '수동 추가' : sourceRowText.value;
  return sourceRowText.value === '—'
    ? `${sheetName} · 행 번호 없음`
    : `${sheetName} · ${sourceRowText.value}`;
});

const partLabel = computed(() => {
  const mpn = props.item.mpn.trim();
  const description = props.item.description?.trim() ?? '';
  if (mpn !== '') return mpn;
  const raw = props.item.sourceRow?.valueRaw;
  const sourceValue = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
  return sourceValue ?? (description !== '' ? description : '품번 미기재');
});

function onQtyInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return; // 빈 값·비정상 입력은 무시(다음 동기화가 복원)
  const qty = Math.max(1, Math.round(raw));
  if (quantityMissing.value) {
    quantityDraft.value = qty;
    return;
  }
  emit('qty-change', qty);
}
</script>

<template>
  <tr class="border-b border-line-soft align-top transition-colors" :class="rowClass">
    <!-- 포함 체크 + 원본 행. 시트명은 좁은 표를 위해 툴팁으로만 보존한다. -->
    <td class="px-1 py-3">
      <div class="flex flex-col items-center gap-1.5 pt-1">
        <input
          :checked="item.included"
          type="checkbox"
          class="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!isDraft || editingLocked || quantityMissing"
          :title="editingLocked ? EDIT_LOCK_TITLE : quantityMissing ? '수량을 먼저 확인해야 포함할 수 있습니다' : '합계·견적요청 포함'"
          @change="emit('toggle-include')"
        >
        <span
          class="block max-w-[48px] cursor-default truncate text-center text-[11px] font-semibold leading-[14px] tabular-nums text-ink-muted"
          :title="sourceLocationTitle"
        >
          {{ sourceRowText }}
        </span>
      </div>
    </td>
    <!-- MPN: 공급사 배지 + 이미지 + 품번/제조사 + 데이터시트 -->
    <td class="px-2 py-3">
      <div class="flex w-[220px] max-w-full min-w-0 gap-2.5">
        <!-- 고정폭 76px(최장 공급사명 UniKeyIC 기준) — 배지 유무와 무관하게 열 폭 일관 -->
        <div class="w-[76px] shrink-0">
          <div
            v-if="item.selectedOffer !== null"
            class="mb-1 flex h-[20px] w-full items-center justify-center gap-1 rounded-[3px] border border-gray-200 bg-surface px-1 shadow-sm"
            :title="item.selectedOffer.supplierSku"
          >
            <img :src="SUPPLIER_META[item.selectedOffer.supplier]?.icon ?? SUPPLIER_FALLBACK_ICON" alt="" class="size-[12px] rounded-[2px]">
            <span class="truncate text-[10px] font-semibold text-ink-soft">{{ SUPPLIER_META[item.selectedOffer.supplier]?.name ?? item.selectedOffer.supplier }}</span>
          </div>
          <!-- 부품 이미지(카탈로그 정본 imageUrl) — 실사진이 정사각이라 1:1 유지 -->
          <PartImage
            :src="item.partImageUrl"
            class="size-[76px] rounded-md border border-gray-200"
          />
        </div>
        <div class="min-w-0 flex-1 pt-[22px]">
          <p class="truncate text-[14px] font-medium leading-[20px] text-ink-strong" :title="partLabel">{{ partLabel }}</p>
          <p v-if="item.mpn.trim() === ''" class="truncate text-[10px] font-medium text-amber-600">MPN 미기재 · 원본 값</p>
          <!-- 파일 저장 없이 공급사/카탈로그 원본 URL 직링크 — 없으면 회색 비활성 표기 -->
          <a
            v-if="item.partDatasheetUrl !== null"
            :href="item.partDatasheetUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-[12px] leading-[16px] text-brand-strong hover:underline"
            title="데이터시트 새 창에서 열기"
          >데이터시트</a>
          <p v-else class="cursor-default text-[12px] leading-[16px] text-ink-faint" title="데이터시트 없음">데이터시트</p>
        </div>
      </div>
    </td>
    <!-- MANUFACTURER — 시안 87:12875 에서 MPN 과 분리된 열. Description 과 같은 높이에 맞춘다. -->
    <td class="px-2 py-3 pt-[42px]">
      <p class="truncate text-[12px] leading-[16px] text-ink-muted" :title="item.manufacturerName ?? ''">{{ item.manufacturerName ?? '—' }}</p>
    </td>
    <!-- 폭은 표의 colgroup 이 정한다(table-fixed) — 여기서 다시 제한하면 남는 폭을 못 쓴다 -->
    <td class="px-2 py-3 pt-[42px]">
      <p class="truncate text-[12px] leading-[16px] text-ink-subtle" :title="item.description ?? ''">{{ item.description ?? '—' }}</p>
    </td>
    <!-- UNIT PRICE: Figma 87:13361 — 공용 가격구간 셀(BomPriceBreaks) -->
    <td class="w-[130px] min-w-[124px] px-2 py-2">
      <BomPriceBreaks
        v-if="item.selectedOffer !== null"
        :price-breaks="sortedPriceBreaks"
        :active-qty="item.selectedOffer.breakQty"
        :currency="item.selectedOffer.currency"
        :fetched-at="item.selectedOffer.fetchedAt"
        :locked="editingLocked"
        :locked-title="EDIT_LOCK_TITLE"
      />
      <p v-else class="pt-[24px] text-right text-[12px]" :class="catalogInquiry ? 'font-bold text-blue-700' : 'text-gray-300'">{{ catalogInquiry ? '문의 견적' : '—' }}</p>
    </td>
    <!-- QUANTITY / STOCK: 공급사 포장(→현재 부품 오퍼 선택) + 수량 -->
    <td class="px-2 py-3">
      <button
        type="button"
        class="flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-line-strong bg-surface-neutral px-3 text-[13px] font-bold text-ink-neutral disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!isDraft || editingLocked"
        :title="editingLocked ? EDIT_LOCK_TITLE : `공급사·포장 변경 — ${item.selectedOffer?.packaging ?? '오퍼 선택'}`"
        @click="emit('open-offers')"
      >
        <span class="truncate">{{ item.selectedOffer?.packaging ?? (item.selectedOffer !== null ? item.selectedOffer.supplier : catalogInquiry ? '문의 견적' : '오퍼 없음') }}</span>
        <span class="text-[10px] text-gray-400">▾</span>
      </button>
      <div class="mt-[8px] flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-line bg-surface-brand-soft pl-1 pr-3">
        <input
          :value="quantityMissing ? quantityDraft : item.orderQty"
          type="number"
          min="1"
          class="w-[70px] bg-transparent px-2 text-right text-[15px] font-bold tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isDraft || editingLocked || (!quantityMissing && item.selectedOffer === null)"
          :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
          @input="quantityMissing && onQtyInput($event)"
          @change="!quantityMissing && onQtyInput($event)"
        >
        <span class="text-[11px] text-ink-subtle">/ {{ quantityMissing ? 'BOM 수량' : catalogInquiry ? '확인' : (item.selectedOffer?.stock?.toLocaleString('ko-KR') ?? '—') }}</span>
      </div>
      <button
        v-if="quantityMissing"
        type="button"
        class="mt-1.5 h-[26px] w-[160px] rounded border border-amber-300 bg-amber-100 text-[11px] font-bold text-amber-800 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!isDraft || editingLocked"
        :title="editingLocked ? EDIT_LOCK_TITLE : `${quantityDraft.toLocaleString('ko-KR')}개로 확인하고 견적에 포함`"
        @click="emit('confirm-quantity', quantityDraft)"
      >
        {{ quantityDraft.toLocaleString('ko-KR') }}개로 수량 확인
      </button>
      <p v-if="severeOrderSurplus" class="mt-1.5 w-[160px] text-right text-[10px] font-bold leading-4 text-orange-700" :title="severeOrderSurplusLabel">
        필요 {{ needed.toLocaleString('ko-KR') }} · 초과 {{ surplusQty.toLocaleString('ko-KR') }} ({{ orderRatio.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) }}배)
      </p>
    </td>
    <!-- TOTAL: 기존 매칭 배지(Found 대체) + 합계 -->
    <td class="w-[140px] min-w-[132px] px-2 py-3 text-center">
      <div class="flex flex-col items-center gap-1.5 pt-1">
        <!-- 내부 판정 우선순위는 유지하고 Figma의 보조 설명 + 영문 상태 pill로 표현한다. -->
        <span
          v-if="totalStatusPresentation.helperLabel !== null"
          class="inline-flex h-[14px] items-center justify-center gap-px whitespace-nowrap text-[10px] font-medium leading-[14px] text-ink-subtle"
        >
          <img :src="statusCheckIcon" alt="" class="size-[10px] shrink-0">
          {{ totalStatusPresentation.helperLabel }}
        </span>
        <span
          class="inline-flex min-h-[30px] items-center justify-center gap-1 whitespace-nowrap rounded-[50px] px-[10px] py-[2px] text-[13px] font-medium leading-[24px]"
          :class="totalStatusPresentation.toneClass"
          :title="totalStatusPresentation.title"
        >
          <span v-if="totalStatusPresentation.pulse" class="size-1.5 animate-pulse rounded-full bg-blue-500" />
          {{ totalStatusPresentation.label }}
        </span>
        <span
          v-if="exactIdentityWarning !== null"
          class="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-800"
          :title="exactIdentityWarning"
        >품번 우선 · 정보 확인</span>
        <span
          v-if="jobCallLimitReached"
          class="rounded border border-orange-400 bg-orange-100 px-1.5 py-0.5 text-[10px] font-extrabold text-orange-800"
          title="엔진의 작업당 호출 상한에 도달해 이 부품의 일부 공급사 검색이 실행되지 않았습니다."
        >호출 상한 미검색</span>
        <span
          v-if="supplierQuotaReached"
          class="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
          title="공급사 API 자체 한도로 이 부품의 일부 공급사 검색이 제한되었습니다."
        >공급사 한도 미검색</span>
        <span v-if="item.matchEvidence?.recommendationType === 'purchase-fit'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" :title="evidenceTitle">일부 확인 필요</span>
        <span v-if="item.selectedOffer?.pinned" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700" title="직접 선택한 오퍼 — 수량이 바뀌어도 유지">고정</span>
        <span class="text-[14px] leading-normal tabular-nums" :class="totalStatusPresentation.priceClass">
          <template v-if="item.lineTotalKrw !== null">
            <b>{{ Math.round(item.lineTotalKrw).toLocaleString('ko-KR') }}</b><span class="font-normal">원</span>
          </template>
          <span v-else class="font-normal">{{ catalogInquiry ? '문의 견적' : '—' }}</span>
        </span>
        <span v-if="item.selectedOffer !== null && item.selectedOffer.currency !== 'KRW'" class="text-[10px] text-gray-400">
          {{ item.selectedOffer.unitPriceKrw === null ? '환산 불가' : `단가 ≈₩${item.selectedOffer.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` }}
        </span>
      </div>
    </td>
    <!-- 후보 비교와 전체 카탈로그 변경은 한 드로어의 다른 진입점. 제외는 실제 삭제가 아니라 견적 제외. -->
    <td class="px-2 py-3">
      <div v-if="isDraft" class="flex flex-col gap-[6px]">
        <button
          type="button"
          class="h-[24px] w-[70px] rounded-[4px] bg-action-primary text-[13px] font-medium text-white transition hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-action-primary"
          :disabled="editingLocked && !enriching"
          :title="editingLocked && !enriching ? EDIT_LOCK_TITLE : '엔진 선정 이유·가격·차순위 후보 비교'"
          @click="emit('open-candidates')"
        >
          후보 비교
        </button>
        <button
          type="button"
          class="h-[24px] w-[70px] rounded-[4px] border border-line-strong bg-transparent text-[13px] font-medium text-ink transition hover:bg-action-quiet disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          :disabled="editingLocked && !enriching"
          :title="editingLocked && !enriching ? EDIT_LOCK_TITLE : '전체 카탈로그에서 다른 부품 검색'"
          @click="emit('open-search')"
        >
          부품 변경
        </button>
        <button type="button" class="h-[24px] w-[70px] rounded-[4px] border border-line-strong bg-action-quiet text-[13px] font-medium text-ink transition hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-action-quiet" :disabled="editingLocked || quantityMissing" :title="editingLocked ? EDIT_LOCK_TITLE : quantityMissing ? '수량을 먼저 확인해야 포함할 수 있습니다' : (item.included ? '합계·견적요청에서 제외' : '합계·견적요청에 복원')" @click="emit('toggle-include')">{{ item.included ? '제외' : '복원' }}</button>
      </div>
    </td>
  </tr>
</template>
