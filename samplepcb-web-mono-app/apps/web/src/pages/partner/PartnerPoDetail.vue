<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PO_STATUS_LABELS,
  BOM_SHIPMENT_FILE_DOMESTIC_LABELS,
  BOM_SHIPMENT_FILE_LABELS,
  BOM_SHIPMENT_FILE_TYPES,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  type BomShipmentFileTypeType,
  type BomShipmentModeType,
  type BomShipmentStatusType,
} from '@sp/api-contract';
import {
  downloadPartnerShipmentFile,
  partnerInvoiceApi,
  usePartnerPoConfirm,
  usePartnerPoDetail,
  usePartnerShipmentAdvance,
  usePartnerShipmentFileDelete,
  usePartnerShipmentFileUpload,
  usePartnerShipmentRevert,
} from '../../partner/usePartnerRfqs';
import InvoiceEditorModal from '../../components/smartbom/InvoiceEditorModal.vue';

// 파트너 포털 발주서 상세(D18) — 박제 문서(품목·수량·단가) + [발주 확인].
// 노출은 자기 발주서의 발주 내용뿐(고객 식별정보 없음).

const route = useRoute();
const poId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = usePartnerPoDetail(poId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const confirmMut = usePartnerPoConfirm();
const error = ref('');

async function confirmPo(): Promise<void> {
  if (poId.value === null) return;
  error.value = '';
  try {
    await confirmMut.mutateAsync(poId.value);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '확인 처리에 실패했습니다.';
  }
}

// ── 선적 핑퐁(D22 — 레거시 절차 승계) ───────────────────────────────────────
// 단계 사전은 계약 공용(bomShipment*). 협력사는 자기 차례 전이만 — 서버가 재검증한다.
const advanceMut = usePartnerShipmentAdvance();
const revertMut = usePartnerShipmentRevert();
const uploadMut = usePartnerShipmentFileUpload();
const deleteFileMut = usePartnerShipmentFileDelete();

const shipDate = ref('');
const carrier = ref('');
const trackingNumber = ref('');
const trackingUrl = ref('');
const shipError = ref('');

const shipment = computed(() => detail.value?.shipment ?? null);
// 선적 문서 생성 전엔 협력사 국가를 모른다 — 서버 기본값(국제)과 같은 가정으로 표시.
const shipMode = computed<BomShipmentModeType>(() => shipment.value?.mode ?? 'international');
const shipStatus = computed<BomShipmentStatusType>(() => shipment.value?.status ?? 'preparing');
const stepChain = computed(() => bomShipmentStatusesOf(shipMode.value));
const stepIndex = computed(() => stepChain.value.indexOf(shipStatus.value));
const nextStatus = computed(() => bomShipmentNextStatus(shipMode.value, shipStatus.value));
const isMyTurn = computed(
  () => nextStatus.value !== null && bomShipmentActorOf(shipMode.value, nextStatus.value) === 'PARTNER',
);
// 되돌리기 = 직전 전이를 내가 했을 때만(현 단계 진입 주체 = PARTNER)
const canRevert = computed(
  () => bomShipmentActorOf(shipMode.value, shipStatus.value) === 'PARTNER',
);
const statusLabel = (s: BomShipmentStatusType): string => bomShipmentStatusLabel(shipMode.value, s);
const fileLabel = (kind: BomShipmentFileTypeType): string =>
  shipMode.value === 'domestic'
    ? BOM_SHIPMENT_FILE_DOMESTIC_LABELS[kind]
    : BOM_SHIPMENT_FILE_LABELS[kind];
const fileOf = (kind: BomShipmentFileTypeType) =>
  shipment.value?.files.find((f) => f.fileType === kind) ?? null;

const shipBusy = computed(
  () =>
    advanceMut.isPending.value ||
    revertMut.isPending.value ||
    uploadMut.isPending.value ||
    deleteFileMut.isPending.value,
);

async function onFilePicked(kind: BomShipmentFileTypeType, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined || poId.value === null) return;
  shipError.value = '';
  try {
    await uploadMut.mutateAsync({ poId: poId.value, fileType: kind, file });
  } catch (e) {
    shipError.value = e instanceof ApiRequestError ? e.message : '파일 업로드에 실패했습니다.';
  }
}

async function removeFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || poId.value === null) return;
  if (!window.confirm(`${fileLabel(kind)} 파일을 삭제할까요?`)) return;
  shipError.value = '';
  try {
    await deleteFileMut.mutateAsync({ poId: poId.value, fileId: file.fileId });
  } catch (e) {
    shipError.value = e instanceof ApiRequestError ? e.message : '파일 삭제에 실패했습니다.';
  }
}

async function downloadFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || poId.value === null) return;
  try {
    await downloadPartnerShipmentFile(poId.value, file.fileId, file.name);
  } catch {
    shipError.value = '파일 다운로드에 실패했습니다.';
  }
}

async function advance(): Promise<void> {
  if (poId.value === null || nextStatus.value === null) return;
  shipError.value = '';
  // 단계별 필수는 서버가 최종 검증 — 프론트는 안내만 선제(레거시 fieldsForTransition 미러)
  if (nextStatus.value === 'requested') {
    if (shipDate.value === '') {
      shipError.value = '출고예정일을 입력해 주세요.';
      return;
    }
    if (fileOf('invoice') === null) {
      shipError.value = `${fileLabel('invoice')} 파일을 먼저 첨부해 주세요.`;
      return;
    }
  }
  if (
    nextStatus.value === 'shipping' &&
    (carrier.value.trim() === '' || trackingNumber.value.trim() === '')
  ) {
    shipError.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  try {
    await advanceMut.mutateAsync({
      poId: poId.value,
      body: {
        ...(shipDate.value !== '' ? { shipDate: shipDate.value } : {}),
        ...(carrier.value.trim() !== '' ? { carrier: carrier.value.trim() } : {}),
        ...(trackingNumber.value.trim() !== ''
          ? { trackingNumber: trackingNumber.value.trim() }
          : {}),
        ...(trackingUrl.value.trim() !== '' ? { trackingUrl: trackingUrl.value.trim() } : {}),
      },
    });
    carrier.value = '';
    trackingNumber.value = '';
    trackingUrl.value = '';
  } catch (e) {
    shipError.value = e instanceof ApiRequestError ? e.message : '진행에 실패했습니다.';
  }
}

async function revert(): Promise<void> {
  if (poId.value === null) return;
  if (!window.confirm('이전 단계로 되돌릴까요? 입력값과 첨부는 유지됩니다.')) return;
  shipError.value = '';
  try {
    await revertMut.mutateAsync(poId.value);
  } catch (e) {
    shipError.value = e instanceof ApiRequestError ? e.message : '되돌리기에 실패했습니다.';
  }
}

// ── 상업송장 생성기(D23) — 자동 초안 편집 → PDF 생성·Invoice 자동 첨부 ────────
const invoiceOpen = ref(false);
const invoiceApi = computed(() => (poId.value === null ? null : partnerInvoiceApi(poId.value)));
async function attachInvoicePdf(file: File): Promise<void> {
  if (poId.value === null) return;
  await uploadMut.mutateAsync({ poId: poId.value, fileType: 'invoice', file });
}

const fmt = (v: number): string => v.toLocaleString('ko-KR');
const statusCls = (s: string): string =>
  s === 'confirmed'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 목록
      </RouterLink>
      <template v-if="detail !== null">
        <h1 class="text-xl font-bold">발주서 — {{ detail.quoteTitle }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(detail.status)">
          {{ BOM_PO_STATUS_LABELS[detail.status] }}
        </span>
      </template>
    </div>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">발주서를 찾을 수 없습니다.</p>

    <template v-else>
      <p class="text-xs text-gray-500">
        발행 {{ detail.issuedAt.slice(0, 10) }}
        <template v-if="detail.confirmedAt !== null"> · 확인 {{ detail.confirmedAt.slice(0, 10) }}</template>
      </p>
      <p v-if="detail.memo !== null" class="rounded bg-gray-50 px-3 py-2 text-xs text-gray-600">{{ detail.memo }}</p>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
        <table class="min-w-full divide-y divide-gray-100 text-xs">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-3 py-2">부품</th>
              <th class="px-3 py-2 text-right">수량</th>
              <th class="px-3 py-2 text-right">단가(KRW)</th>
              <th class="px-3 py-2 text-right">금액</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in detail.items" :key="item.poItemId">
              <td class="px-3 py-2">
                <div class="font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</div>
                <div class="text-gray-400">{{ item.manufacturerName ?? item.description ?? '' }}</div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.qty) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.unitPrice) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.lineTotal) }}원</td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50">
            <tr>
              <td colspan="3" class="px-3 py-2 text-right font-bold">합계 (VAT 별도)</td>
              <td class="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">
                {{ fmt(detail.totalAmount) }}원
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="flex items-center gap-3">
        <button
          v-if="detail.status === 'issued'"
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="confirmMut.isPending.value"
          @click="confirmPo"
        >
          발주 확인
        </button>
        <p v-else-if="detail.status === 'confirmed'" class="text-sm font-semibold text-emerald-700">
          확인 완료 — 진행 부탁드립니다.
        </p>
        <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
      </div>

      <!-- 선적 진행(D22) — 핑퐁: 협력사는 자기 차례 단계만, 나머지는 샘플피씨비가 진행 -->
      <div class="rounded-xl border border-gray-200 bg-surface p-4">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-sm font-bold text-gray-800">선적 진행</p>
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-600">
            {{ BOM_SHIPMENT_MODE_LABELS[shipMode] }}
          </span>
          <button
            v-if="canRevert"
            type="button"
            class="ml-auto rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            :disabled="shipBusy"
            @click="revert"
          >
            ← 이전 단계로
          </button>
        </div>

        <!-- 단계 스텝 -->
        <ol class="mt-3 flex flex-wrap items-center gap-1 text-[11px]">
          <li v-for="(step, idx) in stepChain" :key="step" class="flex items-center gap-1">
            <span
              class="rounded-full px-2 py-0.5 font-semibold"
              :class="idx < stepIndex ? 'bg-emerald-100 text-emerald-700' : idx === stepIndex ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'"
            >{{ statusLabel(step) }}</span>
            <span v-if="idx < stepChain.length - 1" class="text-gray-300">→</span>
          </li>
        </ol>
        <p class="mt-1.5 text-[11px] text-gray-400">
          <template v-if="shipment?.shipDate != null">출고예정 {{ shipment.shipDate }} · </template>
          <template v-if="shipment?.shippedAt != null">발송 {{ shipment.shippedAt.slice(0, 10) }} · </template>
          <template v-if="shipment?.carrier != null">{{ shipment.carrier }} </template>
          <span v-if="shipment?.trackingNumber != null" class="font-mono">{{ shipment.trackingNumber }}</span>
          <a
            v-if="shipment?.trackingUrl != null"
            :href="shipment.trackingUrl"
            target="_blank"
            rel="noopener"
            class="ml-1 text-blue-600 underline"
          >추적</a>
        </p>

        <!-- 첨부 — 종류별 1건, 재업로드=교체. 인보이스는 '선적 요청' 진행의 필수 조건 -->
        <div class="mt-3 space-y-1.5">
          <div v-for="kind in BOM_SHIPMENT_FILE_TYPES" :key="kind" class="flex flex-wrap items-center gap-2 text-xs">
            <span class="w-20 shrink-0 font-semibold text-gray-600">{{ fileLabel(kind) }}</span>
            <template v-if="fileOf(kind) !== null">
              <button type="button" class="text-blue-600 underline" @click="downloadFile(kind)">
                {{ fileOf(kind)?.name }}
              </button>
              <span class="text-[10px] text-gray-400">{{ fileOf(kind)?.uploadedBy === 'ADMIN' ? '샘플피씨비 첨부' : '협력사 첨부' }}</span>
              <button type="button" class="text-red-500 underline disabled:opacity-40" :disabled="shipBusy" @click="removeFile(kind)">삭제</button>
            </template>
            <span v-else class="text-gray-300">없음</span>
            <button
              v-if="kind === 'invoice' && shipMode === 'international'"
              type="button"
              class="ml-auto rounded border border-indigo-200 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
              :disabled="shipBusy"
              title="발주 데이터로 자동 초안을 만들어 편집 후 PDF로 첨부합니다"
              @click="invoiceOpen = true"
            >
              🧾 생성
            </button>
            <label
              class="cursor-pointer rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
              :class="kind === 'invoice' && shipMode === 'international' ? '' : 'ml-auto'"
            >
              {{ fileOf(kind) === null ? '첨부' : '교체' }}
              <input type="file" class="hidden" :disabled="shipBusy" @change="(e) => onFilePicked(kind, e)">
            </label>
          </div>
        </div>

        <!-- 입고 확인(검수) 결과 — 편차 메모가 있으면 재발송 협의 근거 -->
        <p v-if="shipment?.receivedAt != null" class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          입고 확인 완료 — {{ shipment.receivedAt.slice(0, 10) }}
          <template v-if="shipment.receivedNote != null && shipment.receivedNote !== ''">
            · 검수 메모: <b>{{ shipment.receivedNote }}</b>
          </template>
        </p>

        <!-- 다음 단계 — 내 차례일 때만 폼+버튼(서버도 같은 규칙으로 인가) -->
        <div v-if="isMyTurn && nextStatus !== null" class="mt-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <p class="text-xs font-bold text-blue-800">
            다음 단계: {{ statusLabel(nextStatus) }}
            <span v-if="nextStatus === 'arrived'" class="font-normal text-blue-700"> — 물품이 국내(목적지)에 도착했으면 진행해 주세요. 추가 입력은 없습니다.</span>
          </p>
          <div v-if="nextStatus === 'requested'" class="mt-2 grid gap-2 sm:grid-cols-2">
            <label class="text-xs text-gray-600">출고예정일 (필수)
              <input v-model="shipDate" type="date" class="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs">
            </label>
            <p class="self-end pb-1 text-[11px] text-gray-500">
              {{ fileLabel('invoice') }} 첨부가 필요합니다{{ fileOf('invoice') === null ? ' — 위에서 먼저 첨부해 주세요.' : ' ✓' }}
            </p>
          </div>
          <div v-else-if="nextStatus === 'shipping'" class="mt-2 grid gap-2 sm:grid-cols-3">
            <input v-model="carrier" type="text" maxlength="50" placeholder="택배사 (필수)" class="h-9 rounded-lg border border-gray-200 px-3 text-xs">
            <input v-model="trackingNumber" type="text" maxlength="100" placeholder="송장번호 (필수)" class="h-9 rounded-lg border border-gray-200 px-3 font-mono text-xs">
            <input v-model="trackingUrl" type="url" maxlength="500" placeholder="추적 URL (선택)" class="h-9 rounded-lg border border-gray-200 px-3 text-xs">
          </div>
          <button
            type="button"
            class="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="shipBusy"
            @click="advance"
          >
            '{{ statusLabel(nextStatus) }}'(으)로 진행 →
          </button>
        </div>
        <p v-else-if="nextStatus !== null" class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
          ⏳ 샘플피씨비의 '{{ statusLabel(nextStatus) }}' 처리를 기다리고 있습니다.
        </p>
        <p v-else class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          🎉 선적이 완료되었습니다.
        </p>

        <p v-if="shipError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ shipError }}</p>
      </div>

      <InvoiceEditorModal
        v-if="invoiceApi !== null"
        :open="invoiceOpen"
        :load-draft="invoiceApi.loadDraft"
        :save-draft="invoiceApi.saveDraft"
        :render-xlsx="invoiceApi.renderXlsx"
        :attach-pdf="attachInvoicePdf"
        @close="invoiceOpen = false"
      />
    </template>
  </div>
</template>
