<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type {
  BomQuoteCandidateOfferType,
  BomQuoteCandidateType,
  BomQuoteDecisionReasonType,
  BomQuoteItemCandidatesType,
  BomQuoteSelectionSourceType,
} from '@sp/api-contract';

const props = withDefaults(defineProps<{
  open: boolean;
  context: BomQuoteItemCandidatesType | null;
  loading: boolean;
  failed: boolean;
  readOnly?: boolean;
  selecting?: boolean;
  hasCatalogPart?: boolean;
  selectionError?: string;
}>(), {
  readOnly: false,
  selecting: false,
  hasCatalogPart: false,
  selectionError: '',
});

const emit = defineEmits<{
  close: [];
  select: [candidateKey: string, offerKey: string | null];
  catalogSearch: [];
  catalogOffers: [];
}>();

type CandidateTab = 'selectable' | 'all' | 'review';
type CandidateSort = 'technical' | 'price';

const tab = ref<CandidateTab>('selectable');
const sort = ref<CandidateSort>('technical');
const expanded = ref<Set<string>>(new Set());

watch(
  () => props.context?.rowIdx,
  () => {
    tab.value = 'selectable';
    sort.value = 'technical';
    expanded.value = new Set();
  },
);

const currentCandidate = computed(() =>
  props.context?.candidates.find((candidate) => candidate.selected) ?? null,
);

const candidates = computed(() => {
  const source = props.context?.candidates ?? [];
  const filtered = source.filter((candidate) => {
    if (tab.value === 'selectable') return candidate.safety !== 'blocked';
    if (tab.value === 'review') return candidate.safety === 'blocked';
    return true;
  });
  return [...filtered].sort((a, b) => {
    if (sort.value === 'price') {
      return (a.priceRank ?? Number.MAX_SAFE_INTEGER) - (b.priceRank ?? Number.MAX_SAFE_INTEGER)
        || a.technicalRank - b.technicalRank;
    }
    return a.technicalRank - b.technicalRank;
  });
});

const selectableCount = computed(() =>
  props.context?.candidates.filter((candidate) => candidate.safety !== 'blocked').length ?? 0,
);
const reviewCount = computed(() =>
  props.context?.candidates.filter((candidate) => candidate.safety === 'blocked').length ?? 0,
);

function toggleCandidate(candidateKey: string): void {
  const next = new Set(expanded.value);
  if (next.has(candidateKey)) next.delete(candidateKey);
  else next.add(candidateKey);
  expanded.value = next;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    verified_exact: '정확 일치',
    verified_variant: '검증 변형',
    spec_compatible: '스펙 호환',
    spec_partial: '스펙 일부',
    input_conflict: '입력 충돌',
    ambiguous: '모호함',
    not_found: '미검색',
    supplier_error: '공급사 오류',
    insufficient_input: '정보 부족',
  };
  return labels[status] ?? status;
}

function sourceLabel(source: BomQuoteSelectionSourceType): string {
  const labels: Record<BomQuoteSelectionSourceType, string> = {
    none: '미선정',
    auto: '자동 추천',
    customer: '고객 직접 선택',
    catalog: '카탈로그 직접 선택',
    admin: '관리자 선택',
    legacy: '기존 견적',
  };
  return labels[source];
}

function reasonLabel(reason: BomQuoteDecisionReasonType): string {
  const labels: Record<BomQuoteDecisionReasonType, string> = {
    'identity-exact': '원본 품번 정확 일치',
    'identity-variant': '검증된 품번 변형',
    'technical-top': '기술 검증 1순위',
    'same-part-lowest-total': '동일 부품 내 실효 총액 최저',
    'strict-spec-price-saving': '필수 스펙 완전 검증 후 유의미한 절감',
    'purchase-fit': '동급 후보 중 구매조건 최적',
    'lifecycle-improvement': 'NRND/EOL 대신 활성 부품 우선',
    availability: '구매 가능한 재고·가격 우선',
    'customer-choice': '고객 직접 선택',
    'catalog-choice': '카탈로그 직접 선택',
    'offer-choice': '공급사 오퍼 직접 선택',
    'no-safe-candidate': '안전 자동선정 후보 없음',
  };
  return labels[reason];
}

function safetyClass(candidate: BomQuoteCandidateType): string {
  if (candidate.safety === 'blocked') return 'border-red-200 bg-red-50/30';
  if (candidate.safety === 'caution') return 'border-amber-200 bg-amber-50/30';
  if (candidate.selected) return 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-200';
  return 'border-slate-200 bg-white';
}

function cautionLabel(candidate: BomQuoteCandidateType): string {
  if (candidate.missingRequirements.length > 0) return '검증 보완 필요';
  return '라이프사이클 주의';
}

function verificationPercent(candidate: BomQuoteCandidateType): number | null {
  if (candidate.requiredRequirementCount <= 0) return null;
  return Math.max(
    0,
    Math.min(100, Math.round(candidate.verifiedRequirementCount / candidate.requiredRequirementCount * 100)),
  );
}

function verificationClass(candidate: BomQuoteCandidateType): string {
  if (candidate.conflicts.length > 0) return 'bg-red-100 font-semibold text-red-800';
  if (candidate.missingRequirements.length > 0 || candidate.requiredRequirementCount <= 0) {
    return 'bg-amber-100 font-semibold text-amber-800';
  }
  return 'bg-emerald-50 font-semibold text-emerald-800';
}

function verificationLabel(candidate: BomQuoteCandidateType): string {
  const percent = verificationPercent(candidate);
  return percent === null ? '검증 기준 미확인' : `필수조건 ${String(percent)}%`;
}

function requirementLabel(code: string): string {
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
    current_a: '정격전류',
    frequency_hz: '주파수',
    part_type: '부품 유형',
  };
  return labels[code] ?? code;
}

function conflictLabel(code: string): string {
  if (code.endsWith('_mismatch')) return `${requirementLabel(code.slice(0, -'_mismatch'.length))} 불일치`;
  if (code.endsWith('_source_conflict')) return `${requirementLabel(code.slice(0, -'_source_conflict'.length))} 공급사 정보 충돌`;
  return requirementLabel(code);
}

function conflictText(candidate: BomQuoteCandidateType): string {
  return candidate.conflicts.map(conflictLabel).join(', ');
}

function missingText(candidate: BomQuoteCandidateType): string {
  return candidate.missingRequirements.map(requirementLabel).join(', ');
}

function fmtWon(value: number | null): string {
  if (value === null) return '가격 확인 필요';
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function fmtDelta(value: number | null): string {
  if (value === null || value === 0) return '현재와 동일';
  return `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`;
}

function fmtRate(value: number | null): string {
  if (value === null) return '';
  return `${Math.abs(value * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
}

function fmtUnit(offer: BomQuoteCandidateOfferType): string {
  const applied = offer.applied;
  if (applied === null) return '가격 없음';
  const prefix = applied.currency === 'KRW' ? '₩' : applied.currency === 'USD' ? '$' : `${applied.currency} `;
  return `${prefix}${applied.unitPrice.toLocaleString('ko-KR', { maximumFractionDigits: 4 })}`;
}

function fmtAge(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return '방금';
  if (elapsed < 3_600_000) return `${String(Math.floor(elapsed / 60_000))}분 전`;
  if (elapsed < 86_400_000) return `${String(Math.floor(elapsed / 3_600_000))}시간 전`;
  return `${String(Math.floor(elapsed / 86_400_000))}일 전`;
}

function selectBest(candidate: BomQuoteCandidateType): void {
  if (props.readOnly || props.selecting || candidate.safety === 'blocked') return;
  emit('select', candidate.candidateKey, null);
}

function bestOfferAlreadySelected(candidate: BomQuoteCandidateType): boolean {
  return candidate.selected && candidate.bestOfferKey === props.context?.selectedOfferKey;
}

function selectOffer(candidate: BomQuoteCandidateType, offer: BomQuoteCandidateOfferType): void {
  if (props.readOnly || props.selecting || candidate.safety === 'blocked' || offer.applied === null) return;
  emit('select', candidate.candidateKey, offer.offerKey);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] flex justify-end bg-slate-950/50" role="presentation" @mousedown.self="emit('close')">
      <aside class="flex h-full w-full max-w-4xl flex-col bg-[#f6f8fb] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="candidate-drawer-title">
        <header class="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
          <div class="flex items-start justify-between gap-5">
            <div class="min-w-0">
              <p class="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">Part selection</p>
              <h2 id="candidate-drawer-title" class="mt-1 truncate text-xl font-bold text-slate-950">후보 비교·선택</h2>
              <p v-if="context !== null" class="mt-1 text-sm text-slate-500">
                Excel 원본 {{ context.originalMpn ?? context.originalValue ?? '품번 미기재' }} · 필요수량 {{ context.neededQty.toLocaleString('ko-KR') }}개
              </p>
            </div>
            <button type="button" class="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-xl text-slate-500 hover:bg-slate-100" aria-label="후보 패널 닫기" @click="emit('close')">×</button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="loading" class="grid min-h-80 place-items-center p-8 text-sm text-slate-500">
            <div class="text-center"><span class="mx-auto mb-3 block size-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />후보 스냅샷을 불러오는 중입니다.</div>
          </div>
          <div v-else-if="failed" class="m-6 rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
            <strong>후보 정보를 불러오지 못했습니다.</strong>
            <p class="mt-1">견적은 유지되어 있습니다. 패널을 닫고 다시 시도해 주세요.</p>
          </div>
          <template v-else-if="context !== null">
            <div class="space-y-5 p-4 sm:p-6">
              <div v-if="selectionError !== ''" class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{{ selectionError }}</div>
              <section class="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
                <div class="flex flex-col gap-4 bg-gradient-to-r from-blue-700 to-blue-600 p-5 text-white sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">{{ sourceLabel(context.selectionSource) }}</span>
                      <span v-if="currentCandidate?.recommended" class="rounded-full bg-emerald-300 px-2.5 py-1 text-xs font-bold text-emerald-950">자동 추천과 동일</span>
                      <span v-else-if="currentCandidate !== null" class="rounded-full bg-amber-300 px-2.5 py-1 text-xs font-bold text-amber-950">추천에서 변경됨</span>
                    </div>
                    <h3 class="mt-3 break-words text-xl font-bold">{{ context.currentMpn || '선정 부품 없음' }}</h3>
                    <p v-if="currentCandidate?.manufacturerName" class="mt-1 text-sm text-blue-100">{{ currentCandidate.manufacturerName }}</p>
                  </div>
                  <div class="shrink-0 text-left sm:text-right">
                    <p class="text-xs text-blue-100">현재 행 예상금액</p>
                    <strong class="mt-1 block text-2xl tabular-nums">{{ fmtWon(context.currentLineTotalKrw) }}</strong>
                    <p class="mt-1 text-xs text-blue-100">공급사 배송비·세금 제외</p>
                  </div>
                </div>
                <div class="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-start">
                  <div>
                    <p class="text-xs font-bold uppercase tracking-wide text-slate-400">선정 이유</p>
                    <div v-if="context.decisionReasonCodes.length > 0" class="mt-2 flex flex-wrap gap-2">
                      <span v-for="reason in context.decisionReasonCodes" :key="reason" class="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">{{ reasonLabel(reason) }}</span>
                    </div>
                    <p v-else class="mt-2 text-sm text-slate-500">기존 견적 또는 직접 검색으로 선정된 부품입니다.</p>
                  </div>
                  <div v-if="currentCandidate !== null" class="rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p>기술 순위 <b class="text-slate-900">{{ currentCandidate.technicalRank }}위</b></p>
                    <p class="mt-1">가격 순위 <b class="text-slate-900">{{ currentCandidate.priceRank === null ? '산정 불가' : `${String(currentCandidate.priceRank)}위` }}</b></p>
                    <p class="mt-1">필수조건 <b class="text-slate-900">{{ currentCandidate.verifiedRequirementCount }}/{{ currentCandidate.requiredRequirementCount }} 검증</b></p>
                  </div>
                </div>
                <div v-if="context.decisionReasonCodes.includes('purchase-fit')" class="mx-5 mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                  일부 조건은 추가 확인이 필요하지만, 기술 근거가 같은 후보 중 필요수량·MOQ·예상금액이 가장 적합한 부품을 선택했습니다.
                </div>
              </section>

              <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div class="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 class="font-bold text-slate-900">부품 후보</h3>
                    <p class="mt-1 text-xs text-slate-500">기술 순위와 현재 수량 기준 구매 가격을 분리해 표시합니다.</p>
                  </div>
                  <select v-model="sort" class="h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-blue-500" aria-label="후보 정렬">
                    <option value="technical">기술 순위</option>
                    <option value="price">가격 순위</option>
                  </select>
                </div>
                <div class="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 pt-3">
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-semibold" :class="tab === 'selectable' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'selectable'">선택 가능 {{ selectableCount }}</button>
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-semibold" :class="tab === 'all' ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'all'">전체 {{ context.candidates.length }}</button>
                  <button type="button" class="whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-semibold" :class="tab === 'review' ? 'bg-red-50 text-red-700' : 'text-slate-500 hover:bg-slate-50'" @click="tab = 'review'">확인 필요 {{ reviewCount }}</button>
                </div>

                <div v-if="candidates.length > 0" class="space-y-3 p-4">
                  <article v-for="candidate in candidates" :key="candidate.candidateKey" class="overflow-hidden rounded-xl border transition" :class="safetyClass(candidate)">
                    <div class="p-4">
                      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div class="min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-1.5">
                            <span v-if="candidate.selected" class="rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white">현재 선택</span>
                            <span v-if="candidate.recommended" class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">자동 추천</span>
                            <span v-if="candidate.technicalRank === 1" class="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-800">기술 1위</span>
                            <span v-if="candidate.priceRank === 1" class="rounded-full bg-cyan-100 px-2.5 py-1 text-[11px] font-bold text-cyan-800">가격 1위</span>
                            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">{{ statusLabel(candidate.status) }}</span>
                            <span v-if="candidate.safety === 'caution'" class="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">{{ cautionLabel(candidate) }}</span>
                            <span v-if="candidate.safety === 'blocked'" class="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-bold text-red-800">호환성 확인 필요</span>
                          </div>
                          <h4 class="mt-2 break-words text-base font-bold text-slate-950">{{ candidate.mpn }}</h4>
                          <p class="mt-1 text-sm text-slate-500">{{ candidate.manufacturerName ?? '제조사 미확인' }}<span v-if="candidate.packageCode"> · {{ candidate.packageCode }}</span><span v-if="candidate.lifecycleStatus"> · {{ candidate.lifecycleStatus }}</span></p>
                          <p v-if="candidate.description" class="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{{ candidate.description }}</p>
                          <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <span class="rounded px-2 py-1" :class="verificationClass(candidate)">검증 {{ candidate.verifiedRequirementCount }}/{{ candidate.requiredRequirementCount }}</span>
                            <span v-if="context.originalMpn !== null" class="rounded bg-blue-50 px-2 py-1 font-semibold text-blue-800">품번 {{ Math.round(candidate.identityConfidence * 100) }}%</span>
                            <span v-if="candidate.selectionMode === 'spec-compatible' || candidate.specificationConfidence > 0" class="rounded px-2 py-1" :class="verificationClass(candidate)">{{ verificationLabel(candidate) }}</span>
                            <span v-if="candidate.reasons.includes('mount_style_match')" class="rounded bg-sky-50 px-2 py-1 font-semibold text-sky-800">실장 방식 일치</span>
                            <span v-if="candidate.reasons.includes('diameter_mm_match')" class="rounded bg-sky-50 px-2 py-1 font-semibold text-sky-800">직경 일치</span>
                            <span class="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700">공급사 {{ candidate.corroboratingSuppliers.length }}</span>
                          </div>
                        </div>
                        <div class="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 lg:w-60">
                          <p class="text-xs text-slate-400">필요수량 기준 최적 오퍼</p>
                          <strong class="mt-1 block text-xl tabular-nums text-slate-950">{{ fmtWon(candidate.bestLineTotalKrw) }}</strong>
                          <p class="mt-1 text-xs font-semibold" :class="(candidate.lineDeltaKrw ?? 0) <= 0 ? 'text-emerald-600' : 'text-amber-700'">현재 대비 {{ fmtDelta(candidate.lineDeltaKrw) }}</p>
                          <p v-if="candidate.savingsVsTechnicalKrw !== null && candidate.savingsVsTechnicalKrw > 0" class="mt-1 text-[11px] text-slate-500">기술 1위 대비 {{ fmtWon(candidate.savingsVsTechnicalKrw) }} 절감 {{ fmtRate(candidate.savingsVsTechnicalRate) }}</p>
                          <button
                            v-if="!readOnly"
                            type="button"
                            class="mt-3 h-9 w-full rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                            :disabled="selecting || candidate.safety === 'blocked' || bestOfferAlreadySelected(candidate)"
                            @click="selectBest(candidate)"
                          >
                            {{ bestOfferAlreadySelected(candidate) ? '현재 최적 오퍼' : candidate.selected ? '최적 오퍼로 변경' : candidate.recommended ? '자동 추천 적용' : '최적 오퍼로 선택' }}
                          </button>
                        </div>
                      </div>

                      <div v-if="candidate.conflicts.length > 0" class="mt-3 rounded-lg bg-red-100/70 px-3 py-2 text-xs text-red-800">자동선정 제외: {{ conflictText(candidate) }}</div>
                      <div v-if="candidate.missingRequirements.length > 0" class="mt-2 rounded-lg bg-amber-100/70 px-3 py-2 text-xs text-amber-800">추가 확인 필요: {{ missingText(candidate) }}</div>

                      <button type="button" class="mt-3 inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900" @click="toggleCandidate(candidate.candidateKey)">
                        공급사 오퍼 {{ candidate.offers.length }}개 {{ expanded.has(candidate.candidateKey) ? '접기 ▴' : '보기 ▾' }}
                      </button>
                    </div>

                    <div v-if="expanded.has(candidate.candidateKey)" class="border-t border-slate-200 bg-white">
                      <div v-if="candidate.offers.length > 0" class="divide-y divide-slate-100">
                        <div v-for="offer in candidate.offers" :key="offer.offerKey" class="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                          <div>
                            <div class="flex flex-wrap items-center gap-2 text-sm">
                              <strong class="uppercase text-slate-900">{{ offer.supplier }}</strong>
                              <span class="text-xs text-slate-500">{{ offer.supplierSku || 'SKU 미확인' }}</span>
                              <span v-if="offer.packaging" class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{{ offer.packaging }}</span>
                              <span v-if="offer.applied?.stockShort" class="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">재고 부족</span>
                              <span v-if="context.selectedOfferKey === offer.offerKey" class="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700">사용 중</span>
                            </div>
                            <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                              <span>단가 <b>{{ fmtUnit(offer) }}</b></span>
                              <span>주문 <b>{{ offer.applied?.orderQty.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span>합계 <b>{{ fmtWon(offer.applied?.lineTotalKrw ?? null) }}</b></span>
                              <span>재고 <b>{{ offer.stock?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span>MOQ <b>{{ offer.moq?.toLocaleString('ko-KR') ?? '—' }}</b></span>
                              <span class="text-slate-400">기준 {{ fmtAge(offer.fetchedAt) }}</span>
                            </div>
                          </div>
                          <div class="flex items-center gap-2">
                            <a v-if="offer.productUrl" :href="offer.productUrl" target="_blank" rel="noopener noreferrer" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">제품</a>
                            <button
                              v-if="!readOnly"
                              type="button"
                              class="rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40"
                              :disabled="selecting || candidate.safety === 'blocked' || offer.applied === null || context.selectedOfferKey === offer.offerKey"
                              @click="selectOffer(candidate, offer)"
                            >
                              이 오퍼 선택
                            </button>
                          </div>
                        </div>
                      </div>
                      <p v-else class="p-4 text-sm text-slate-400">가격이 있는 공급사 오퍼가 없습니다.</p>
                    </div>
                  </article>
                </div>
                <div v-else class="p-10 text-center text-sm text-slate-400">이 조건에 해당하는 후보가 없습니다.</div>
              </section>

              <section v-if="context.events.length > 0" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 class="font-bold text-slate-900">선택 이력</h3>
                <div class="mt-3 space-y-2">
                  <div v-for="event in context.events.slice(0, 5)" :key="event.id" class="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                    <span><b>{{ sourceLabel(event.source) }}</b> · {{ event.previousMpn ?? '미선정' }} → {{ event.selectedMpn ?? '미선정' }}</span>
                    <span class="text-slate-400">{{ new Date(event.createdAt).toLocaleString('ko-KR') }}</span>
                  </div>
                </div>
              </section>

              <section v-if="!readOnly" class="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div><h3 class="text-sm font-bold text-slate-900">엔진 후보 밖에서 찾기</h3><p class="mt-1 text-xs text-slate-500">품번·스펙으로 카탈로그를 직접 검색할 수 있습니다.</p></div>
                  <div class="flex flex-wrap gap-2">
                    <button v-if="hasCatalogPart" type="button" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" @click="emit('catalogOffers')">현재 부품 오퍼</button>
                    <button type="button" class="rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50" @click="emit('catalogSearch')">카탈로그 직접 검색</button>
                  </div>
                </div>
              </section>
            </div>
          </template>
        </div>

        <footer class="shrink-0 border-t border-slate-200 bg-white px-5 py-3 text-[11px] leading-5 text-slate-500 sm:px-7">
          가격은 필요수량·MOQ·주문배수·재고·환율을 반영한 부품 예상금액입니다. 운송료·관리비·세금은 전체 견적에서 별도로 계산됩니다.
        </footer>
      </aside>
    </div>
  </Teleport>
</template>
