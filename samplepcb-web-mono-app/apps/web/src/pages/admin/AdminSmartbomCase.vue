<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { apiGetBlob } from '@sp/shared';
import type { BomQuoteItemType, BomQuoteStatusType } from '@sp/api-contract';
import type { AdminBomRfqViewType, BomRfqReplyBodyType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAdminBomQuote,
  useAdminBomQuoteCandidates,
  usePatchAdminBomQuote,
} from '../../admin/useAdminBomQuotes';
import { useAdminBomRfqs, useAdminRfqReply } from '../../admin/useAdminBomRfqs';
import {
  SMARTBOM_STATUS_META,
  SMARTBOM_STEPS,
  smartbomCaseNo,
  smartbomFmtDate,
  smartbomFmtWon,
  smartbomStepOf,
} from '../../admin/smartbom';
import BomCandidateDrawer from '../../components/admin/bom/BomCandidateDrawer.vue';
import BomRfqCompareModal from '../../components/admin/smartbom/BomRfqCompareModal.vue';
import BomRfqPanel from '../../components/admin/smartbom/BomRfqPanel.vue';
import BomRfqSendModal from '../../components/admin/smartbom/BomRfqSendModal.vue';
import RfqReplyForm, { type RfqReplyFormRow } from '../../components/smartbom/RfqReplyForm.vue';

// 스마트 BOM Case 상세 — 고객 견적요청 1건의 운영 화면(docs/SMARTBOM_PARTNER_RFQ.md §3.4).
// 데이터·검토 로직은 /api/admin/bom-quotes 그대로(BOM 견적요청 화면과 동일 계약).
// 협력사 RFQ 패널·발송 모달·비교 뷰는 이 화면 위에 단계적으로 확장한다(§5-4~6).

const route = useRoute();
const detailId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = useAdminBomQuote(detailId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const patch = usePatchAdminBomQuote();
const candidateItemId = ref<string | null>(null);
const candidateQuery = useAdminBomQuoteCandidates(detailId, candidateItemId);

// RFQ 반영 파생 단계 — reviewing 에서 RFQ 가 있으면 ③(발송)·④(회신 도착)로 세분화(§3.3).
const rfqQuery = useAdminBomRfqs(detailId);
const rfqs = computed(() => rfqQuery.data.value?.data.rfqs ?? []);
const currentStep = computed(() => {
  if (detail.value === null) return 0;
  // 주문 파생이 우선(⑥ 주문서 접수 · ⑧ 결제) — 이후 RFQ 세분화(③④), 마지막이 상태 기반.
  const orderStep = smartbomStepOf(
    detail.value.status,
    detail.value.orderState,
    detail.value.orderInfo?.isPaid ?? false,
  );
  if (orderStep >= 6) return orderStep;
  const base = smartbomStepOf(detail.value.status);
  if (detail.value.status !== 'reviewing' || rfqs.value.length === 0) return base;
  return rfqs.value.some((r) => r.status === 'quoted') ? 4 : 3;
});

// 요청 부품행 범위(서버 loadRfqScopeItems 와 동일 파생) — 시트 선택 + included.
const scopeItems = computed(() => {
  if (detail.value === null) return [];
  const sheets = detail.value.sheets;
  const selected = new Set(sheets.filter((s) => s.selected).map((s) => s.sheetIndex));
  return detail.value.items.filter(
    (item) =>
      item.included &&
      (sheets.length === 0 || item.sourceSheetIndex === null || selected.has(item.sourceSheetIndex)),
  );
});

// ── RFQ 발송·대리 입력·비교 선정 ────────────────────────────────────────────
const sendOpen = ref(false);
const compareOpen = ref(false);
const replyRfq = ref<AdminBomRfqViewType | null>(null);
const replyError = ref('');
const rfqReply = useAdminRfqReply();

const replyRows = computed<RfqReplyFormRow[]>(() => {
  const rfq = replyRfq.value;
  if (rfq === null) return [];
  const replyByItem = new Map(rfq.items.map((item) => [item.quoteItemId, item]));
  return scopeItems.value.map((item) => {
    const reply = replyByItem.get(item.id);
    const price = reply?.unitPrice ?? null;
    return {
      quoteItemId: item.id,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderQty: item.orderQty,
      reply:
        reply === undefined || price === null
          ? null
          : {
              unitPrice: price,
              replyQty: reply.replyQty,
              moq: reply.moq,
              stock: reply.stock,
              dateCode: reply.dateCode,
              leadTime: reply.leadTime,
              memo: reply.memo,
            },
    };
  });
});

async function submitReply(body: BomRfqReplyBodyType): Promise<void> {
  if (detailId.value === null || replyRfq.value === null) return;
  replyError.value = '';
  try {
    await rfqReply.mutateAsync({ quoteId: detailId.value, rfqId: replyRfq.value.rfqId, body });
    replyRfq.value = null;
  } catch (e) {
    replyError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

// 검토 폼(상세 로드 시 프리필) — BOM 견적요청 화면과 동일 로직.
const form = ref({
  adminMemo: '',
  answerNote: '',
  confirmedShippingFee: null as number | null,
  confirmedManagementFee: null as number | null,
  confirmedTotal: null as number | null,
});
const actionError = ref('');

// 확정가 = 토글식 직접 입력 — 기본은 예상(자동) 금액만 보여 관리자 혼동을 막는다.
// 토글 OFF 저장 = 확정 해제(고객에게 예상 금액 안내), ON 시 예상값으로 프리필.
const confirmedOverride = ref(false);

watch(detail, (d) => {
  if (d === null) return;
  form.value = {
    adminMemo: d.adminMemo ?? '',
    answerNote: d.answerNote ?? '',
    confirmedShippingFee: d.confirmedShippingFee,
    confirmedManagementFee: d.confirmedManagementFee,
    confirmedTotal: d.confirmedTotal,
  };
  confirmedOverride.value =
    d.confirmedShippingFee !== null || d.confirmedManagementFee !== null || d.confirmedTotal !== null;
  actionError.value = '';
});

function toggleConfirmedOverride(): void {
  confirmedOverride.value = !confirmedOverride.value;
  const d = detail.value;
  if (!confirmedOverride.value || d === null) return;
  // 켜는 순간 예상값(운송료·관리비 기본값 + 선정 반영 총액)으로 제안 프리필 — 기존 확정값은 유지.
  form.value.confirmedShippingFee ??= d.shippingFee;
  form.value.confirmedManagementFee ??= d.managementFee;
  form.value.confirmedTotal ??= d.finalTotal;
}

// v-model.number 는 빈 입력을 '' 로 만들 수 있어 저장 직전 정규화한다.
const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

// 부가세는 저장·계산하지 않는 정책(전 금액 VAT 별도) — 참고 환산 표시만 한다.
const withVat = (v: number | null): string =>
  v === null ? '—' : `${Math.round(v * 1.1).toLocaleString('ko-KR')}원`;
const confirmedTotalVat = computed(() => withVat(numOrNull(form.value.confirmedTotal)));

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
        // 토글 OFF = 확정 해제(null) — 고객에게는 예상 금액으로 안내된다.
        confirmedShippingFee: confirmedOverride.value ? numOrNull(form.value.confirmedShippingFee) : null,
        confirmedManagementFee: confirmedOverride.value ? numOrNull(form.value.confirmedManagementFee) : null,
        confirmedTotal: confirmedOverride.value ? numOrNull(form.value.confirmedTotal) : null,
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
    <!-- 헤더 -->
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'admin-smartbom' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 진행현황
      </RouterLink>
      <template v-if="detail !== null">
        <span class="font-mono text-xs text-gray-500">
          {{ smartbomCaseNo(detail.id, detail.requestedAt, detail.createdAt) }}
        </span>
        <h1 class="text-xl font-bold">{{ detail.title }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="SMARTBOM_STATUS_META[detail.status].cls">
          {{ SMARTBOM_STATUS_META[detail.status].label }}
        </span>
      </template>
    </div>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">Case 를 찾을 수 없습니다.</p>

    <template v-else>
      <!-- 12단계 파생 타임라인 -->
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface px-4 py-3">
        <ol class="flex min-w-max items-center gap-1">
          <li v-for="(step, idx) in SMARTBOM_STEPS" :key="step" class="flex items-center gap-1">
            <div class="flex flex-col items-center gap-1">
              <span
                class="grid size-5 place-items-center rounded-full text-[10px] font-bold"
                :class="idx + 1 === currentStep
                  ? 'bg-blue-600 text-white'
                  : idx + 1 < currentStep
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-400'"
              >
                {{ idx + 1 }}
              </span>
              <span
                class="whitespace-nowrap text-[10px]"
                :class="idx + 1 === currentStep ? 'font-bold text-blue-700' : idx + 1 < currentStep ? 'text-gray-600' : 'text-gray-400'"
              >
                {{ step }}
              </span>
            </div>
            <span
              v-if="idx < SMARTBOM_STEPS.length - 1"
              class="mb-4 h-px w-4"
              :class="idx + 1 < currentStep ? 'bg-blue-300' : 'bg-gray-200'"
            />
          </li>
        </ol>
      </div>

      <!-- 요약 스트립 -->
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="text-gray-600">고객 <b>{{ detail.mbId }}</b></span>
        <span class="text-gray-600">세트 {{ detail.setQty }} · 예비 {{ detail.spareQty }}</span>
        <span class="text-gray-600">부품 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></span>
        <span class="text-gray-600">
          예상 합계 <b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b>
          <span class="text-xs text-gray-400">
            (운송료 {{ smartbomFmtWon(detail.shippingFee) }} · 관리비 {{ smartbomFmtWon(detail.managementFee) }} · VAT 별도)
          </span>
        </span>
        <span v-if="detail.uncostedCount > 0" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          미산정 {{ detail.uncostedCount }}건
        </span>
        <span class="text-xs text-gray-400">요청 {{ smartbomFmtDate(detail.requestedAt) }}</span>
        <!-- 주문·결제 파생(D16) — ct/od 조인, 저장 아님 -->
        <span
          v-if="detail.orderInfo !== null"
          class="rounded px-1.5 py-0.5 text-xs font-semibold"
          :class="detail.orderInfo.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'"
        >
          주문 {{ detail.orderInfo.odId }} · {{ detail.orderInfo.odStatus }}
          <template v-if="detail.orderInfo.isPaid"> · 수납 {{ smartbomFmtWon(detail.orderInfo.receiptPrice) }}</template>
        </span>
        <span v-else-if="detail.orderState === 'cart'" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
          고객 장바구니 담김
        </span>
        <button
          v-if="detail.fileUrl !== null"
          type="button"
          class="text-xs text-blue-600 hover:underline"
          @click="downloadOriginal"
        >
          원본 BOM 다운로드
        </button>
      </div>
      <p v-if="detail.customerMemo" class="rounded bg-surface-sunken p-2 text-xs text-gray-600">
        고객 메모: {{ detail.customerMemo }}
      </p>

      <!-- 협력사 RFQ 현황 -->
      <BomRfqPanel
        :rfqs="rfqs"
        :loading="rfqQuery.isLoading.value"
        :can-send="detail.status === 'requested' || detail.status === 'reviewing'"
        @send="sendOpen = true"
        @compare="compareOpen = true"
        @reply="(rfq) => { replyRfq = rfq; replyError = ''; }"
      />

      <div class="grid gap-4 xl:grid-cols-[1fr_340px]">
        <!-- 품목 -->
        <div class="overflow-hidden rounded-xl border border-gray-200 bg-surface">
          <table class="min-w-full divide-y divide-gray-100 text-xs">
            <thead class="bg-gray-50 text-left text-gray-500">
              <tr>
                <th class="px-3 py-2">Excel 위치</th>
                <th class="px-3 py-2">부품</th>
                <th class="px-3 py-2">선정 오퍼</th>
                <th class="px-3 py-2 text-right">주문수량</th>
                <th class="px-3 py-2 text-right">합계</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="item in detail.items" :key="item.id" :class="{ 'opacity-40': !item.included }">
                <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ itemLocation(item) }}</td>
                <td class="px-3 py-2">
                  <div class="font-medium">{{ itemLabel(item) }}</div>
                  <div class="text-gray-400">{{ item.manufacturerName }}</div>
                </td>
                <td class="px-3 py-2">
                  <template v-if="item.selectedOffer !== null">
                    {{ item.selectedOffer.supplier }} · {{ item.selectedOffer.unitPrice }} {{ item.selectedOffer.currency }} @{{ item.selectedOffer.breakQty }}+
                  </template>
                  <span v-else class="text-amber-600">{{ item.matchStatus === 'none' ? '미매칭' : '오퍼 없음' }}</span>
                </td>
                <td class="px-3 py-2 text-right tabular-nums">{{ item.orderQty.toLocaleString('ko-KR') }}</td>
                <td class="px-3 py-2 text-right tabular-nums">
                  {{ item.lineTotalKrw === null ? '—' : smartbomFmtWon(Math.round(item.lineTotalKrw)) }}
                </td>
                <td class="px-3 py-2 text-right">
                  <button
                    type="button"
                    class="rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                    @click="candidateItemId = item.id"
                  >
                    후보·근거
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 검토 폼 -->
        <div class="h-fit space-y-3 rounded-xl border border-gray-200 bg-surface p-4 text-sm">
          <p class="text-xs font-bold text-gray-700">검토·고객 회신</p>
          <!-- 비용 — 기본은 예상(자동: 부품 합계 + 설정 기본 운송료·관리비) 읽기 전용 표시.
               확정가는 토글을 켠 경우에만 입력(D9 수동 확정 — 관리자 혼동 방지 UX) -->
          <div class="space-y-0.5 rounded bg-surface-sunken px-2.5 py-2 text-xs text-gray-600">
            <div class="flex justify-between"><span>부품 합계(선정 반영)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.itemsTotal) }}</b></div>
            <div class="flex justify-between"><span>운송료(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.shippingFee) }}</span></div>
            <div class="flex justify-between"><span>관리비(설정 기본값)</span><span class="tabular-nums">{{ smartbomFmtWon(detail.managementFee) }}</span></div>
            <div class="flex justify-between border-t border-gray-200 pt-1"><span>예상 총액(VAT 별도)</span><b class="tabular-nums">{{ smartbomFmtWon(detail.finalTotal) }}</b></div>
            <div class="flex justify-between text-gray-400"><span>참고: VAT 포함 시</span><span class="tabular-nums">{{ withVat(detail.finalTotal) }}</span></div>
          </div>

          <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-700">
            <input type="checkbox" class="size-3.5" :checked="confirmedOverride" @change="toggleConfirmedOverride">
            확정가 직접 입력 <span class="font-normal text-gray-400">(고객에게 확정 금액으로 안내)</span>
          </label>
          <p v-if="!confirmedOverride" class="text-[11px] text-gray-400">
            꺼진 상태로 저장하면 확정가가 해제되고 고객에게는 위 예상 금액으로 안내됩니다.
          </p>
          <template v-else>
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
            <p class="text-[11px] text-gray-400">참고: VAT 포함 시 {{ confirmedTotalVat }} — 부가세는 저장하지 않습니다(전 금액 VAT 별도).</p>
          </template>
          <label class="block text-xs text-gray-500">고객 회신 메모(고객에게 표시)
            <textarea v-model="form.answerNote" rows="3" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
          </label>
          <label class="block text-xs text-gray-500">내부 메모(고객 미노출)
            <textarea v-model="form.adminMemo" rows="2" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1" />
          </label>
          <div class="flex flex-wrap gap-2 border-t border-gray-100 pt-2">
            <button
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              :disabled="patch.isPending.value"
              @click="saveReview()"
            >
              저장
            </button>
            <button
              v-if="detail.status === 'requested'"
              type="button"
              class="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
              :disabled="patch.isPending.value"
              @click="saveReview('reviewing')"
            >
              검토 시작
            </button>
            <button
              v-if="detail.status === 'requested' || detail.status === 'reviewing'"
              type="button"
              class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
              :disabled="patch.isPending.value"
              @click="saveReview('answered')"
            >
              회신 완료
            </button>
            <button
              v-if="detail.status === 'answered' || detail.status === 'reviewing'"
              type="button"
              class="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50"
              :disabled="patch.isPending.value"
              @click="saveReview('closed')"
            >
              종료
            </button>
          </div>
          <p v-if="actionError !== ''" class="text-xs text-red-600">{{ actionError }}</p>
        </div>
      </div>
    </template>

    <BomCandidateDrawer
      :open="candidateItemId !== null"
      :context="candidateQuery.data.value?.data ?? null"
      :loading="candidateQuery.isLoading.value"
      :failed="candidateQuery.isError.value"
      read-only
      @close="candidateItemId = null"
    />

    <BomRfqSendModal
      v-if="detail !== null && detailId !== null"
      :open="sendOpen"
      :quote-id="detailId"
      :item-count="scopeItems.length"
      :rfqs="rfqs"
      @close="sendOpen = false"
    />

    <BomRfqCompareModal
      v-if="detail !== null && detailId !== null"
      :open="compareOpen"
      :quote-id="detailId"
      :rfqs="rfqs"
      :scope-items="scopeItems"
      @close="compareOpen = false"
    />

    <!-- 대리 입력(회신 보기·수정) 모달 — 포털 회신과 같은 폼·저장 경로 -->
    <div
      v-if="replyRfq !== null"
      class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
      @click.self="replyRfq = null"
    >
      <div class="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">
            {{ replyRfq.partnerName }} — 회신 {{ replyRfq.status === 'quoted' ? '수정' : '대리 입력' }}
          </h2>
          <button type="button" class="text-gray-400 hover:text-gray-700" @click="replyRfq = null">✕</button>
        </div>
        <p class="mt-1 text-xs text-gray-500">
          전화·메일로 받은 회신을 기록합니다 — 협력사 포털 회신과 같은 저장 경로(source=manual)입니다.
        </p>
        <div class="mt-4">
          <RfqReplyForm
            :rows="replyRows"
            :currency="replyRfq.currency"
            :delivery-date="replyRfq.deliveryDate"
            :memo="replyRfq.memo"
            :busy="rfqReply.isPending.value"
            @submit="submitReply"
          />
        </div>
        <p v-if="replyError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ replyError }}</p>
      </div>
    </div>
  </div>
</template>
