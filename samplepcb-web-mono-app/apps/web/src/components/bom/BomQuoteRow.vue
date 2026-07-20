<script setup lang="ts">
import { computed } from 'vue';
import type { BomQuoteItemType } from '@sp/api-contract';
import PartImage from '../ui/PartImage.vue';
import BomPriceBreaks from './BomPriceBreaks.vue';
import { SUPPLIER_FALLBACK_ICON, SUPPLIER_META } from '../../bom/supplier-meta';

// 매칭 결과 테이블의 한 행 — 컴포넌트 경계로 재렌더를 행 단위로 격리한다.
// item 은 부모 소유의 로컬 편집 객체(참조 안정 유지) — 여기서는 읽기만, 변경은 emit.
// 부모가 재렌더돼도 props 가 그대로면 Vue 가 이 행의 patch 를 건너뛴다.

const props = defineProps<{
  item: BomQuoteItemType;
  isDraft: boolean;
  editingLocked: boolean;
  enriching: boolean;
}>();

const emit = defineEmits<{
  'toggle-include': [];
  'qty-change': [qty: number];
  'open-offers': [];
  'open-candidates': [];
  'open-search': [];
}>();

const EDIT_LOCK_TITLE = '공급사 확인이 완료되면 수정할 수 있습니다';

const stockShort = computed(() => {
  const o = props.item.selectedOffer;
  return o !== null && o.stock !== null && o.stock < props.item.orderQty;
});

const hasEngineCandidates = computed(() =>
  (props.item.matchEvidence?.groupedCandidateCount ?? 0) > 0
  || props.item.selectedCandidateKey !== null
  || props.item.recommendedCandidateKey !== null,
);

const sortedPriceBreaks = computed(() => {
  const offer = props.item.selectedOffer;
  if (offer === null) return [];
  const rows = [...offer.priceBreaks].sort((a, b) => a.qty - b.qty);
  // 일부 레거시/수동 오퍼는 가격구간 배열 없이 적용 단가만 보존되어 있다.
  return rows.length > 0 ? rows : [{ qty: offer.breakQty, price: offer.unitPrice }];
});

const rowClass = computed(() => {
  const item = props.item;
  if (!item.included) return 'opacity-45';
  // 보강 진행 중엔 분홍(경고) 대신 중립 — 미매칭은 아직 최종 판정이 아니다
  if (item.matchStatus === 'none') {
    if (props.enriching) return 'bg-white';
    return item.matchEvidence?.selectionMode === 'review' ? 'bg-amber-50/60' : 'bg-[#fdf2f2]';
  }
  if (stockShort.value) return 'bg-[#fdf8e7]'; // 재고 부족 — 시안 노랑
  return 'bg-white';
});

const evidenceTitle = computed(() => {
  const evidence = props.item.matchEvidence;
  if (evidence === null) return '';
  const details = [
    `엔진 판정: ${evidence.componentStatus}`,
    `안전 후보: ${String(evidence.eligibleCandidateCount)}/${String(evidence.candidateCount)}`,
  ];
  if (evidence.conflicts.length > 0) details.push(`충돌: ${evidence.conflicts.join(', ')}`);
  if (evidence.missingRequirements.length > 0) details.push(`누락: ${evidence.missingRequirements.join(', ')}`);
  return details.join('\n');
});

const sourceLabel = computed(() => {
  if (props.item.selectionSource === 'customer') return '고객 선택';
  if (props.item.selectionSource === 'catalog') return '직접 검색';
  if (props.item.selectionSource === 'admin') return '관리자 선택';
  if (props.item.matchEvidence?.recommendationType === 'price') return '가격 최적';
  if (props.item.matchEvidence?.recommendationType === 'purchase-fit') return '구매조건 우선';
  if (props.item.matchEvidence?.recommendationType === 'lifecycle') return '수명주기 추천';
  if (props.item.matchEvidence?.selectionMode === 'exact') return '정확 일치';
  if (props.item.matchEvidence?.selectionMode === 'variant') return '검증 변형';
  if (props.item.matchEvidence?.selectionMode === 'spec-compatible') return '기술 추천';
  return props.item.matchStatus === 'manual' ? '직접 선택' : '자동 매칭';
});

const reasonSummary = computed(() => {
  const item = props.item;
  const evidence = item.matchEvidence;
  if (evidence === null) return item.matchStatus === 'manual' ? '카탈로그에서 직접 선택' : '후보 근거 없음';
  if (item.selectionSource === 'customer') {
    if (evidence.decisionReasonCodes.includes('offer-choice')) return '공급사 오퍼 직접 선택';
    return evidence.selectedTechnicalRank === null
      ? '후보 직접 선택'
      : `기술 ${String(evidence.selectedTechnicalRank)}순위 후보 직접 선택`;
  }
  if (evidence.recommendationType === 'price' && evidence.priceEvidence?.savingsKrw !== null) {
    const saving = evidence.priceEvidence?.savingsKrw ?? null;
    const rateValue = evidence.priceEvidence?.savingsRate ?? null;
    return saving === null
      ? '필수 스펙 검증 후 가격 최적'
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

function fmtWon(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('ko-KR')}원`;
}

function onQtyInput(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return; // 빈 값·비정상 입력은 무시(다음 동기화가 복원)
  emit('qty-change', Math.max(1, Math.round(raw)));
}
</script>

<template>
  <tr class="border-b border-[#e5e8ed] align-top transition-colors" :class="rowClass">
    <!-- 포함 체크 + 원본 행. 시트명은 좁은 표를 위해 툴팁으로만 보존한다. -->
    <td class="px-1 py-3">
      <div class="flex flex-col items-center gap-1.5 pt-1">
        <input
          :checked="item.included"
          type="checkbox"
          class="h-4 w-4 rounded border-gray-300 disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!isDraft || editingLocked"
          :title="editingLocked ? EDIT_LOCK_TITLE : '합계·견적요청 포함'"
          @change="emit('toggle-include')"
        >
        <span
          class="block max-w-[48px] cursor-default truncate text-center text-[11px] font-semibold leading-[14px] tabular-nums text-[#667085]"
          :title="sourceLocationTitle"
        >
          {{ sourceRowText }}
        </span>
      </div>
    </td>
    <!-- MPN: 공급사 배지 + 이미지 자리 + 품번 + 데이터시트 -->
    <td class="px-2 py-3">
      <div class="flex gap-2.5">
        <!-- 고정폭 76px(최장 공급사명 UniKeyIC 기준) — 배지 유무와 무관하게 열 폭 일관 -->
        <div class="w-[76px] shrink-0">
          <div
            v-if="item.selectedOffer !== null"
            class="mb-1 flex h-[20px] w-full items-center justify-center gap-1 rounded-[3px] border border-gray-200 bg-white px-1 shadow-sm"
            :title="item.selectedOffer.supplierSku"
          >
            <img :src="SUPPLIER_META[item.selectedOffer.supplier]?.icon ?? SUPPLIER_FALLBACK_ICON" alt="" class="size-[12px] rounded-[2px]">
            <span class="truncate text-[10px] font-semibold text-[#3b4252]">{{ SUPPLIER_META[item.selectedOffer.supplier]?.name ?? item.selectedOffer.supplier }}</span>
          </div>
          <!-- 부품 이미지(카탈로그 정본 imageUrl) — 실사진이 정사각이라 1:1 유지 -->
          <PartImage
            :src="item.partImageUrl"
            class="size-[76px] rounded-md border border-gray-200"
          />
        </div>
        <div class="min-w-0 pt-[22px]">
          <p class="truncate text-[14px] font-medium leading-[20px] text-[#061023]" :title="partLabel">{{ partLabel }}</p>
          <p v-if="item.mpn.trim() === ''" class="truncate text-[10px] font-medium text-amber-600">MPN 미기재 · 원본 값</p>
          <p class="cursor-default text-[12px] leading-[16px] text-[#9db9dd]" title="데이터시트 (준비 중)">데이터시트</p>
        </div>
      </div>
    </td>
    <td class="px-2 py-3 pt-[42px] text-[12px] leading-[16px] text-[#5f6777]">{{ item.manufacturerName ?? '—' }}</td>
    <td class="max-w-[220px] px-2 py-3 pt-[42px]">
      <p class="truncate text-[12px] leading-[16px] text-[#8e97a5]" :title="item.description ?? ''">{{ item.description ?? '—' }}</p>
    </td>
    <!-- UNIT PRICE: Figma 87:13361 — 공용 가격구간 셀(BomPriceBreaks) -->
    <td class="px-2 py-2">
      <BomPriceBreaks
        v-if="item.selectedOffer !== null"
        :price-breaks="sortedPriceBreaks"
        :active-qty="item.selectedOffer.breakQty"
        :currency="item.selectedOffer.currency"
        :fetched-at="item.selectedOffer.fetchedAt"
        :locked="editingLocked"
        :locked-title="EDIT_LOCK_TITLE"
      />
      <p v-else class="pt-[24px] text-right text-[12px] text-gray-300">—</p>
    </td>
    <!-- QUANTITY / STOCK: 공급사 포장(→현재 부품 오퍼 선택) + 수량 -->
    <td class="px-2 py-3">
      <button
        type="button"
        class="flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d3d5dc] bg-[#f4f4f4] px-3 text-[13px] font-bold text-[#4c4c4c] disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!isDraft || editingLocked"
        :title="editingLocked ? EDIT_LOCK_TITLE : `공급사·포장 변경 — ${item.selectedOffer?.packaging ?? '오퍼 선택'}`"
        @click="emit('open-offers')"
      >
        <span class="truncate">{{ item.selectedOffer?.packaging ?? (item.selectedOffer !== null ? item.selectedOffer.supplier : '오퍼 없음') }}</span>
        <span class="text-[10px] text-gray-400">▾</span>
      </button>
      <div class="mt-[8px] flex h-[38px] w-[160px] items-center justify-between rounded-[6px] border border-[#d6dae7] bg-[#fafcff] pl-1 pr-3">
        <input
          :value="item.orderQty"
          type="number"
          min="1"
          class="w-[70px] bg-transparent px-2 text-right text-[15px] font-bold tabular-nums focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!isDraft || editingLocked || item.selectedOffer === null"
          :title="editingLocked ? EDIT_LOCK_TITLE : undefined"
          @change="onQtyInput"
        >
        <span class="text-[11px] text-[#8e97a5]">/ {{ item.selectedOffer?.stock?.toLocaleString('ko-KR') ?? '—' }}</span>
      </div>
    </td>
    <!-- TOTAL: 기존 매칭 배지(Found 대체) + 합계 -->
    <td class="px-2 py-3 text-right">
      <div class="flex flex-col items-end gap-1.5 pt-1">
        <!-- 보강 진행 중엔 "확인 중"(파랑) — 빨간 미매칭은 보강이 끝난 뒤의 최종 판정 -->
        <span v-if="item.matchStatus === 'none' && enriching" class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[12px] font-medium text-blue-600">
          <span class="size-1.5 animate-pulse rounded-full bg-blue-500" />확인 중
        </span>
        <span v-else-if="item.matchStatus === 'none' && item.matchEvidence?.selectionMode === 'review'" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700" :title="evidenceTitle">검토 필요</span>
        <span v-else-if="item.matchStatus === 'none'" class="rounded-full bg-red-100 px-2.5 py-0.5 text-[12px] font-medium text-red-600" :title="evidenceTitle">미매칭</span>
        <span v-else-if="stockShort" class="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-700">재고 부족</span>
        <span v-else-if="item.selectedOffer !== null" class="rounded-full bg-[#01bd46]/15 px-2.5 py-0.5 text-[12px] font-medium text-[#38b614]" :title="evidenceTitle">매칭</span>
        <span v-else class="rounded-full bg-sky-100 px-2.5 py-0.5 text-[12px] font-medium text-sky-700" :title="evidenceTitle">가격 확인 필요</span>
        <span v-if="item.matchStatus !== 'none'" class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{{ sourceLabel }}</span>
        <span v-if="item.matchEvidence?.recommendationType === 'purchase-fit'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" :title="evidenceTitle">일부 확인 필요</span>
        <span v-if="item.selectedOffer?.pinned" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700" title="직접 선택한 오퍼 — 수량이 바뀌어도 유지">고정</span>
        <p v-if="item.matchStatus !== 'none'" class="max-w-[190px] text-right text-[10px] leading-4 text-slate-500" :title="reasonSummary">{{ reasonSummary }}</p>
        <span v-if="(item.matchEvidence?.alternativeCandidateCount ?? 0) > 0" class="text-[10px] font-semibold text-blue-600">대체 후보 {{ item.matchEvidence?.alternativeCandidateCount }}개</span>
        <span class="text-[14px] font-bold tabular-nums" :class="item.lineTotalKrw === null ? 'text-gray-300' : 'text-[#38b614]'">
          {{ item.lineTotalKrw === null ? '—' : fmtWon(Math.round(item.lineTotalKrw)) }}
        </span>
        <span v-if="item.selectedOffer !== null && item.selectedOffer.currency !== 'KRW'" class="text-[10px] text-gray-400">
          {{ item.selectedOffer.unitPriceKrw === null ? '환산 불가' : `단가 ≈₩${item.selectedOffer.unitPriceKrw.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}` }}
        </span>
      </div>
    </td>
    <!-- 후보 비교와 전체 카탈로그 변경은 한 드로어의 다른 진입점. 제외는 실제 삭제가 아니라 견적 제외. -->
    <td class="px-2 py-3">
      <div v-if="isDraft" class="flex flex-col gap-[5px] pt-1">
        <button
          type="button"
          class="h-[28px] w-[88px] rounded-[5px] border text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
          :class="hasEngineCandidates ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'"
          :disabled="editingLocked"
          :title="editingLocked ? EDIT_LOCK_TITLE : '엔진 선정 이유·가격·차순위 후보 비교'"
          @click="emit('open-candidates')"
        >
          후보 비교
        </button>
        <button
          type="button"
          class="h-[28px] w-[88px] rounded-[5px] border text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
          :class="hasEngineCandidates ? 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'"
          :disabled="editingLocked"
          :title="editingLocked ? EDIT_LOCK_TITLE : '전체 카탈로그에서 다른 부품 검색'"
          @click="emit('open-search')"
        >
          부품 변경
        </button>
        <button type="button" class="h-[24px] w-[88px] rounded-[4px] border border-[#d3d5dc] bg-[#f4f4f4] text-[11px] font-medium text-[#4c4c4c] hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#f4f4f4]" :disabled="editingLocked" :title="editingLocked ? EDIT_LOCK_TITLE : (item.included ? '합계·견적요청에서 제외' : '합계·견적요청에 복원')" @click="emit('toggle-include')">{{ item.included ? '제외' : '복원' }}</button>
      </div>
    </td>
  </tr>
</template>
