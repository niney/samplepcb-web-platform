<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { apiGetBlob } from '@sp/shared';
import type { BomQuoteItemType, BomQuoteStatusType } from '@sp/api-contract';
import {
  useAdminBomQuote,
  useAdminBomQuoteCandidates,
  useAdminBomQuotes,
  usePatchAdminBomQuote,
} from '../../admin/useAdminBomQuotes';
import BomCandidateDrawer from '../../components/bom/BomCandidateDrawer.vue';

// 고객 BOM 견적요청 검토(1차 최소 화면) — 목록(상태 탭)·상세·상태 전이·확정가·메모·원본
// 다운로드. 협력사 RFQ·발주·선적 풀 워크벤치는 이 데이터 모델 위에서 후속(docs/BOM_QUOTE.md).

const STATUS_TABS: { key: BomQuoteStatusType | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'requested', label: '견적요청' },
  { key: 'reviewing', label: '검토 중' },
  { key: 'answered', label: '회신 완료' },
  { key: 'closed', label: '종료' },
  { key: 'canceled', label: '취소' },
];

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: '작성 중', cls: 'bg-gray-100 text-gray-600' },
  requested: { label: '견적요청', cls: 'bg-blue-100 text-blue-700' },
  reviewing: { label: '검토 중', cls: 'bg-amber-100 text-amber-700' },
  answered: { label: '회신 완료', cls: 'bg-emerald-100 text-emerald-700' },
  closed: { label: '종료', cls: 'bg-gray-200 text-gray-600' },
  canceled: { label: '취소', cls: 'bg-red-100 text-red-600' },
};

const statusFilter = ref<BomQuoteStatusType | null>(null);
const page = ref(1);
const detailId = ref<string | null>(null);

const list = useAdminBomQuotes(statusFilter, page);
const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / 20)));

const detailQuery = useAdminBomQuote(detailId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const patch = usePatchAdminBomQuote();
const candidateRowIdx = ref<number | null>(null);
const candidateQuery = useAdminBomQuoteCandidates(detailId, candidateRowIdx);

watch(detailId, () => {
  candidateRowIdx.value = null;
});

// 검토 폼(상세 열 때 프리필)
const form = ref({
  adminMemo: '',
  answerNote: '',
  confirmedShippingFee: null as number | null,
  confirmedManagementFee: null as number | null,
  confirmedTotal: null as number | null,
});
const actionError = ref('');

watch(detail, (d) => {
  if (d === null) return;
  form.value = {
    adminMemo: d.adminMemo ?? '',
    answerNote: d.answerNote ?? '',
    confirmedShippingFee: d.confirmedShippingFee,
    confirmedManagementFee: d.confirmedManagementFee,
    confirmedTotal: d.confirmedTotal,
  };
  actionError.value = '';
});

function fmtWon(v: number | null): string {
  return v === null ? '—' : `${v.toLocaleString('ko-KR')}원`;
}

function fmtDate(iso: string | null): string {
  if (iso === null) return '—';
  return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function itemRows(item: BomQuoteItemType): number[] {
  const value = item.sourceRow?.sourceRows;
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is number => typeof row === 'number' && Number.isInteger(row) && row > 0);
}

function itemLocation(item: BomQuoteItemType): string {
  const rows = itemRows(item);
  if (item.sourceSheetName === null) return '수동 추가';
  return rows.length === 0 ? item.sourceSheetName : `${item.sourceSheetName} · ${rows.join(', ')}행`;
}

function itemLabel(item: BomQuoteItemType): string {
  if (item.mpn.trim() !== '') return item.mpn;
  const raw = item.sourceRow?.valueRaw;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : '품번 미기재';
}

function itemMatchLabel(item: BomQuoteItemType): string {
  if (item.matchStatus === 'manual') return '수동 선정';
  const evidence = item.matchEvidence;
  if (evidence === null) return item.matchStatus === 'none' ? '미매칭' : '카탈로그 매칭';
  if (evidence.selectionMode === 'exact') return '정확 일치';
  if (evidence.selectionMode === 'variant') return '검증 변형';
  if (evidence.selectionMode === 'spec-compatible') return '스펙 호환';
  if (evidence.selectionMode === 'review') return `검토 필요 · ${evidence.componentStatus}`;
  return '미매칭';
}

async function saveReview(nextStatus?: BomQuoteStatusType): Promise<void> {
  if (detailId.value === null) return;
  actionError.value = '';
  try {
    await patch.mutateAsync({
      quoteId: detailId.value,
      body: {
        ...(nextStatus !== undefined ? { status: nextStatus } : {}),
        adminMemo: form.value.adminMemo === '' ? null : form.value.adminMemo,
        answerNote: form.value.answerNote === '' ? null : form.value.answerNote,
        confirmedShippingFee: form.value.confirmedShippingFee,
        confirmedManagementFee: form.value.confirmedManagementFee,
        confirmedTotal: form.value.confirmedTotal,
      },
    });
  } catch {
    actionError.value = '저장에 실패했습니다 — 상태 전이 가능 여부를 확인하세요.';
  }
}

async function downloadOriginal(): Promise<void> {
  const fileUrl = detail.value?.fileUrl ?? null;
  if (fileUrl === null) return;
  const blob = await apiGetBlob(fileUrl);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = detail.value?.fileName ?? 'bom.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">BOM 견적요청</h1>

    <!-- 상태 탭 -->
    <div class="flex flex-wrap gap-1 border-b border-gray-200">
      <button
        v-for="tab in STATUS_TABS"
        :key="tab.key ?? 'all'"
        type="button"
        class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
        :class="statusFilter === tab.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
        @click="statusFilter = tab.key; page = 1"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 목록 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="px-4 py-2.5">견적명</th>
            <th class="px-4 py-2.5">회원</th>
            <th class="px-4 py-2.5">상태</th>
            <th class="whitespace-nowrap px-4 py-2.5">품목(매칭)</th>
            <th class="whitespace-nowrap px-4 py-2.5">예상 합계</th>
            <th class="whitespace-nowrap px-4 py-2.5">요청일</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <template v-for="q in rows" :key="q.id">
            <tr class="cursor-pointer hover:bg-blue-50/40" :class="{ 'bg-blue-50/60': detailId === q.id }" @click="detailId = detailId === q.id ? null : q.id">
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ q.title }}</td>
              <td class="px-4 py-2.5 text-gray-600">{{ q.mbId }}</td>
              <td class="px-4 py-2.5"><span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_LABEL[q.status]?.cls">{{ STATUS_LABEL[q.status]?.label }}</span></td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ q.includedCount }}/{{ q.itemCount }} ({{ q.matchedCount }})</td>
              <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">{{ fmtWon(q.finalTotal) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(q.requestedAt) }}</td>
            </tr>
            <!-- 상세 확장 -->
            <tr v-if="detailId === q.id">
              <td colspan="6" class="bg-gray-50 px-4 py-4">
                <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
                <div v-else-if="detail !== null" class="grid gap-4 lg:grid-cols-[1fr_320px]">
                  <!-- 라인 -->
                  <div class="space-y-2">
                    <div class="flex flex-wrap items-center gap-3 text-sm">
                      <span class="text-gray-600">세트 {{ detail.setQty }} · 예비 {{ detail.spareQty }}</span>
                      <span class="text-gray-600">부품 합계 <b class="tabular-nums">{{ fmtWon(detail.itemsTotal) }}</b></span>
                      <span class="text-gray-600">예상 합계 <b class="tabular-nums">{{ fmtWon(detail.finalTotal) }}</b> <span class="text-xs text-gray-400">(운송료 {{ fmtWon(detail.shippingFee) }} · 관리비 {{ fmtWon(detail.managementFee) }} · VAT 별도)</span></span>
                      <span v-if="detail.uncostedCount > 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">미산정 {{ detail.uncostedCount }}건</span>
                      <button v-if="detail.fileUrl !== null" type="button" class="text-xs text-blue-600 hover:underline" @click="downloadOriginal">원본 BOM 다운로드</button>
                    </div>
                    <p v-if="detail.customerMemo" class="rounded bg-white p-2 text-xs text-gray-600">고객 메모: {{ detail.customerMemo }}</p>
                    <div class="max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                      <table class="min-w-full divide-y divide-gray-100 text-xs">
                        <thead class="sticky top-0 bg-gray-50 text-left text-gray-500">
                          <tr><th class="px-2 py-1.5">Excel 위치</th><th class="px-2 py-1.5">부품</th><th class="px-2 py-1.5">오퍼</th><th class="px-2 py-1.5 text-right">주문수량</th><th class="px-2 py-1.5 text-right">합계</th><th class="px-2 py-1.5" /></tr>
                        </thead>
                        <tbody class="divide-y divide-gray-50">
                          <tr v-for="item in detail.items" :key="item.rowIdx" :class="{ 'opacity-40': !item.included }">
                            <td class="whitespace-nowrap px-2 py-1.5 text-gray-500">{{ itemLocation(item) }}</td>
                            <td class="px-2 py-1.5">
                              <div class="font-medium">{{ itemLabel(item) }}</div>
                              <div class="text-gray-400">{{ item.manufacturerName }}</div>
                            </td>
                            <td class="px-2 py-1.5">
                              <template v-if="item.selectedOffer !== null">
                                {{ item.selectedOffer.supplier }} · {{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }} @{{ item.selectedOffer.breakQty }}+
                                <span v-if="item.selectedOffer.pinned" class="ml-1 rounded bg-blue-100 px-1 text-[10px] text-blue-700">고정</span>
                              </template>
                              <span v-else class="text-amber-600">{{ item.matchStatus === 'none' ? '미매칭' : '오퍼 없음' }}</span>
                              <div class="mt-0.5 text-[10px] text-gray-400">{{ itemMatchLabel(item) }}</div>
                            </td>
                            <td class="px-2 py-1.5 text-right tabular-nums">{{ item.orderQty.toLocaleString('ko-KR') }}</td>
                            <td class="px-2 py-1.5 text-right tabular-nums">{{ item.lineTotalKrw === null ? '—' : fmtWon(Math.round(item.lineTotalKrw)) }}</td>
                            <td class="px-2 py-1.5 text-right"><button type="button" class="rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50" @click="candidateRowIdx = item.rowIdx">후보·근거</button></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <!-- 검토 폼 -->
                  <div class="space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <div class="grid grid-cols-2 gap-2">
                      <label class="text-xs text-gray-500">확정 운송료
                        <input v-model.number="form.confirmedShippingFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
                      </label>
                      <label class="text-xs text-gray-500">확정 관리비
                        <input v-model.number="form.confirmedManagementFee" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
                      </label>
                    </div>
                    <label class="block text-xs text-gray-500">확정 총액(VAT 별도)
                      <input v-model.number="form.confirmedTotal" type="number" min="0" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-right tabular-nums">
                    </label>
                    <label class="block text-xs text-gray-500">고객 회신 메모(고객에게 표시)
                      <textarea v-model="form.answerNote" rows="3" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
                    </label>
                    <label class="block text-xs text-gray-500">내부 메모(고객 미노출)
                      <textarea v-model="form.adminMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
                    </label>
                    <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
                      <button type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50" :disabled="patch.isPending.value" @click="saveReview()">저장</button>
                      <button v-if="detail.status === 'requested'" type="button" class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600" :disabled="patch.isPending.value" @click="saveReview('reviewing')">검토 시작</button>
                      <button v-if="detail.status === 'requested' || detail.status === 'reviewing'" type="button" class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700" :disabled="patch.isPending.value" @click="saveReview('answered')">회신 완료</button>
                      <button v-if="detail.status === 'answered' || detail.status === 'reviewing'" type="button" class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50" :disabled="patch.isPending.value" @click="saveReview('closed')">종료</button>
                    </div>
                    <p v-if="actionError !== ''" class="text-xs text-red-600">{{ actionError }}</p>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="rows.length === 0">
            <td colspan="6" class="px-4 py-10 text-center text-sm text-gray-400">해당 상태의 견적요청이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 페이지네이션 -->
    <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
      <button type="button" class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40" :disabled="page <= 1" @click="page -= 1">이전</button>
      <span class="text-gray-500">{{ page }} / {{ totalPages }}</span>
      <button type="button" class="rounded-md border border-gray-300 bg-white px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40" :disabled="page >= totalPages" @click="page += 1">다음</button>
    </div>
    <BomCandidateDrawer
      :open="candidateRowIdx !== null"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      read-only
      @close="candidateRowIdx = null"
    />
  </div>
</template>
