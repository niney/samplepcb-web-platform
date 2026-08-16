<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_FILE_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  SHIPMENT_TRANSPORTS,
  SHIPMENT_TRANSPORT_LABELS,
  bomShipmentActorOf,
  bomShipmentDocumentsLocked,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  shipmentTransportDocType,
  shipmentTransportOf,
  type BomShipmentFileTypeType,
  type BomShipmentStatusType,
  type PartnerShipmentViewType,
  type ShipmentTransportType,
} from '@sp/api-contract';
import {
  downloadPartnerShipmentFile,
  loadPartnerQuotation,
  loadPartnerShipmentStatement,
  partnerInvoiceApi,
  partnerPackingApi,
  usePartnerShipmentAdvance,
  usePartnerShipmentFileDelete,
  usePartnerShipmentFileUpload,
  usePartnerShipmentRevert,
} from '../../partner/usePartnerRfqs';
import InvoiceEditorModal from '../smartbom/InvoiceEditorModal.vue';
import ShipmentPackingModal from '../smartbom/ShipmentPackingModal.vue';
import TradeDocumentModal from '../smartbom/TradeDocumentModal.vue';
import { confirmDialog } from '../../lib/confirmDialog';
import { fmtKstDate } from '@sp/utils';

// 발송(박스) 진행 카드(§6.11) — 담긴 발주서·단계 스텝·서류·내 차례 폼·되돌리기를
// 발송 단위로 묶어 보여준다. 서버 조작은 대표 발주서(primaryPoId) 경유로 기존
// poId 라우트를 재사용한다(핑퐁 인가·필수 게이트는 서버가 검증).

const props = withDefaults(
  defineProps<{
    shipment: PartnerShipmentViewType;
    /** [📦 보내기] 유도 링크 노출 — 보내기 화면 안에서는 끈다(자체 버튼이 담당). */
    showBoxLink?: boolean;
  }>(),
  { showBoxLink: true },
);

const poId = computed(() => String(props.shipment.primaryPoId));
const advanceMut = usePartnerShipmentAdvance();
const revertMut = usePartnerShipmentRevert();
const uploadMut = usePartnerShipmentFileUpload();
const deleteFileMut = usePartnerShipmentFileDelete();

const shipDate = ref('');
const carrier = ref('');
const trackingNumber = ref('');
const trackingUrl = ref('');
const error = ref('');

// ── 운송수단(08-16, PCB 트랙과 같은 공용 축) — 발송을 "무엇으로 나르나".
// 국제 '선적 요청'에서 고르고, 이 값 하나에서 **첨부해야 할 운송서류가 갈린다**
// (항공 AWB / 해상 B/L). 초깃값은 박제값 유도, 없으면 항공(현행 관례).
const transport = ref<ShipmentTransportType>(shipmentTransportOf(props.shipment.transport));

const mode = computed(() => props.shipment.mode);
const status = computed(() => props.shipment.status);
const stepChain = computed(() => bomShipmentStatusesOf(mode.value));
const stepIndex = computed(() => stepChain.value.indexOf(status.value));
const nextStatus = computed(() => bomShipmentNextStatus(mode.value, status.value));
const documentsLocked = computed(() =>
  bomShipmentDocumentsLocked(mode.value, status.value, props.shipment.receivedAt),
);
const isMyTurn = computed(() => props.shipment.myTurn);
/** 화면이 지금 다루는 운송수단 — 요청 폼이 열려 있으면 **입력 중인 값**(서류 줄이
 *  라디오를 즉시 따라야 한다), 그 밖에는 박제값. */
const activeTransport = computed<ShipmentTransportType>(() =>
  nextStatus.value === 'requested' && isMyTurn.value
    ? transport.value
    : shipmentTransportOf(props.shipment.transport),
);
/** 이 발송에서 다루는 첨부 종류 — 사전 전체를 늘어놓으면 해상 발송에도 AWB 줄이 서서
 *  "둘 다 내야 하나"로 읽힌다. 인보이스(공통) + 수단이 정한 운송서류 1종만 세운다.
 *  이미 올라온 반대편 서류는 수단을 되돌리면 다시 보인다(삭제하지 않는다). */
const docKinds = computed<BomShipmentFileTypeType[]>(() => [
  'invoice',
  shipmentTransportDocType(activeTransport.value),
]);
const canRevert = computed(
  () =>
    props.shipment.receivedAt === null &&
    bomShipmentActorOf(mode.value, status.value) === 'PARTNER',
);
const statusLabel = (s: BomShipmentStatusType): string => bomShipmentStatusLabel(mode.value, s);
const fileLabel = (kind: BomShipmentFileTypeType): string =>
  BOM_SHIPMENT_FILE_LABELS[kind];
const fileOf = (kind: BomShipmentFileTypeType) =>
  props.shipment.files.find((f) => f.fileType === kind) ?? null;

const busy = computed(
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
  if (file === undefined || documentsLocked.value) return;
  error.value = '';
  try {
    await uploadMut.mutateAsync({ poId: poId.value, fileType: kind, file });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 업로드에 실패했습니다.';
  }
}

async function removeFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || documentsLocked.value) return;
  if (
    !(await confirmDialog({
      message: `${fileLabel(kind)} 파일을 삭제할까요?`,
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    await deleteFileMut.mutateAsync({ poId: poId.value, fileId: file.fileId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 삭제에 실패했습니다.';
  }
}

async function downloadFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null) return;
  try {
    await downloadPartnerShipmentFile(poId.value, file.fileId, file.name);
  } catch {
    error.value = '파일 다운로드에 실패했습니다.';
  }
}

async function advance(): Promise<void> {
  if (nextStatus.value === null) return;
  error.value = '';
  if (nextStatus.value === 'requested') {
    if (shipDate.value === '') {
      error.value = '출고예정일을 입력해 주세요.';
      return;
    }
    if (fileOf('invoice') === null) {
      error.value = `${fileLabel('invoice')} 파일을 먼저 첨부해 주세요.`;
      return;
    }
  }
  if (
    nextStatus.value === 'shipping' &&
    (carrier.value.trim() === '' || trackingNumber.value.trim() === '')
  ) {
    error.value = '택배사와 송장번호를 입력해 주세요.';
    return;
  }
  try {
    await advanceMut.mutateAsync({
      poId: poId.value,
      body: {
        ...(shipDate.value !== '' ? { shipDate: shipDate.value } : {}),
        // 운송수단은 '선적 요청'에서만 실린다(국내엔 그 전이가 없고, 서버도 국제에서만
        // 저장한다). 뒤 단계에서 보내면 이미 박힌 값을 덮을 뿐이라 보내지 않는다.
        ...(nextStatus.value === 'requested' ? { transport: transport.value } : {}),
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
    error.value = e instanceof ApiRequestError ? e.message : '진행에 실패했습니다.';
  }
}

async function revert(): Promise<void> {
  if (
    !(await confirmDialog({
      message: '이전 단계로 되돌릴까요? 입력값과 첨부는 유지됩니다.',
      confirmLabel: '되돌리기',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    await revertMut.mutateAsync(poId.value);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '되돌리기에 실패했습니다.';
  }
}

// 상업송장 생성기(D23) — 대표 발주서 기준 초안(품목은 발주 데이터), 편집·PDF 첨부.
const invoiceOpen = ref(false);
const invoiceApi = computed(() => partnerInvoiceApi(poId.value));
const packingOpen = ref(false);
const packingApi = computed(() => partnerPackingApi(props.shipment.shipmentId));
const quotationPoId = ref<number | null>(null);
const statementOpen = ref(false);
const tradeDocumentPos = computed<{ poId: number; quoteTitle: string }[]>(() =>
  props.shipment.groupPos.length > 0
    ? props.shipment.groupPos.map((entry) => ({
        poId: entry.poId,
        quoteTitle: entry.quoteTitle,
      }))
    : [{ poId: props.shipment.primaryPoId, quoteTitle: '' }],
);
const loadQuotation = () => {
  if (quotationPoId.value === null) return Promise.reject(new Error('quotation not selected'));
  return loadPartnerQuotation(quotationPoId.value);
};
const loadStatement = () => loadPartnerShipmentStatement(props.shipment.shipmentId);
async function attachInvoicePdf(file: File): Promise<void> {
  if (documentsLocked.value) return;
  await uploadMut.mutateAsync({ poId: poId.value, fileType: 'invoice', file });
}
</script>

<template>
  <div
    class="rounded-xl border bg-surface p-4"
    :class="isMyTurn ? 'border-blue-300' : 'border-gray-200'"
  >
    <!-- 헤더: 발송 번호·모드·차례 -->
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm font-bold text-gray-800">📦 발송 #{{ shipment.shipmentId }}</p>
      <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-semibold text-gray-600">
        {{ BOM_SHIPMENT_MODE_LABELS[mode] }}
      </span>
      <span
        v-if="isMyTurn"
        class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-700"
      >
        내 차례
      </span>
      <span
        v-if="shipment.receivedAt !== null"
        class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-700"
      >
        입고 완료
      </span>
      <button
        v-if="canRevert"
        type="button"
        class="ml-auto rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
        :disabled="busy"
        @click="revert"
      >
        ← 이전 단계로
      </button>
    </div>

    <!-- 담긴 발주서 — 넣고 빼기는 [📦 보내기]의 두 칸 화면이 전담(작업 공간 단일화) -->
    <ul class="mt-2 space-y-0.5 text-sm text-gray-700">
      <li v-for="entry in shipment.groupPos" :key="entry.poId" class="flex items-center gap-2">
        <span>{{ entry.quoteTitle }}</span>
        <span class="text-xs text-gray-400">{{ entry.totalAmount.toLocaleString('ko-KR') }}원</span>
      </li>
    </ul>
    <RouterLink
      v-if="status === 'preparing' && showBoxLink"
      :to="{ name: 'partner-bom-ship' }"
      class="mt-1.5 inline-block text-sm font-semibold text-indigo-600 hover:underline"
    >
      📦 보내기에서 담기·꺼내기 →
    </RouterLink>

    <!-- 단계 스텝 -->
    <ol class="mt-3 flex flex-wrap items-center gap-1 text-xs">
      <li v-for="(step, idx) in stepChain" :key="step" class="flex items-center gap-1">
        <span
          class="rounded-full px-2 py-0.5 font-semibold"
          :class="
            idx < stepIndex
              ? 'bg-emerald-100 text-emerald-700'
              : idx === stepIndex
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-400'
          "
        >{{ statusLabel(step) }}</span>
        <span v-if="idx < stepChain.length - 1" class="text-gray-300">→</span>
      </li>
    </ol>
    <p class="mt-1.5 text-xs text-gray-400">
      <!-- 운송수단 — 박제된 값이 있을 때만(null 은 이 축 도입 전 발송이다). -->
      <template v-if="shipment.transport !== null">{{ SHIPMENT_TRANSPORT_LABELS[shipment.transport] }} · </template>
      <template v-if="mode === 'international' && shipment.shipDate !== null">출고예정 {{ shipment.shipDate }} · </template>
      <template v-if="shipment.shippedAt !== null">
        발송 {{ fmtKstDate(shipment.shippedAt) }} ·
      </template>
      <template v-if="shipment.carrier !== null">{{ shipment.carrier }} </template>
      <span v-if="shipment.trackingNumber !== null" class="font-mono">{{
        shipment.trackingNumber
      }}</span>
      <a
        v-if="shipment.trackingUrl !== null"
        :href="shipment.trackingUrl"
        target="_blank"
        rel="noopener"
        class="ml-1 text-blue-600 underline"
      >추적</a>
    </p>

    <!-- 서류 -->
    <div class="mt-3 space-y-1.5">
      <div class="grid gap-1.5 lg:grid-cols-2">
        <div
          class="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-2 py-2 text-sm"
        >
          <span class="w-20 shrink-0 font-semibold text-emerald-800">선적 리스트</span>
          <span class="text-xs text-emerald-700">부품별 실물 포장 QR·라벨</span>
          <button
            type="button"
            class="ml-auto rounded bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-700"
            @click="packingOpen = true"
          >
            {{ status === 'preparing' ? '📦 만들기·인쇄' : '📦 보기·재인쇄' }}
          </button>
        </div>
        <div
          v-if="mode === 'domestic'"
          class="flex flex-wrap items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/50 px-2 py-2 text-sm"
        >
          <span class="w-20 shrink-0 font-semibold text-violet-800">거래 문서</span>
          <span class="text-[11px] text-violet-500">선택</span>
          <button
            v-for="entry in tradeDocumentPos"
            :key="`quotation-${entry.poId}`"
            type="button"
            class="max-w-44 truncate rounded border border-violet-200 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:bg-violet-100"
            :title="`${entry.quoteTitle} 협력사 견적서`"
            @click="quotationPoId = entry.poId"
          >
            견적서{{ tradeDocumentPos.length > 1 ? ` #${entry.poId}` : '' }}
          </button>
          <button
            type="button"
            class="rounded bg-violet-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-violet-700"
            @click="statementOpen = true"
          >
            거래명세서
          </button>
        </div>
      </div>
      <template v-if="mode === 'international'">
        <p
          v-if="documentsLocked"
          class="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600"
        >
          🔒 완료된 발송 · 문서 잠금 — Invoice와 {{ fileLabel(docKinds[1]!) }}는 내려받기만 할 수 있습니다.
        </p>
        <div
          v-for="kind in docKinds"
          :key="kind"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <span class="w-20 shrink-0 font-semibold text-gray-600">{{ fileLabel(kind) }}</span>
          <template v-if="fileOf(kind) !== null">
            <button type="button" class="text-blue-600 underline" @click="downloadFile(kind)">
              {{ fileOf(kind)?.name }}
            </button>
            <button
              v-if="!documentsLocked"
              type="button"
              class="text-red-500 underline disabled:opacity-40"
              :disabled="busy"
              @click="removeFile(kind)"
            >
              삭제
            </button>
          </template>
          <span v-else class="text-gray-300">없음</span>
          <button
            v-if="kind === 'invoice' && !documentsLocked"
            type="button"
            class="ml-auto rounded border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
            :disabled="busy"
            @click="invoiceOpen = true"
          >
            🧾 만들기
          </button>
          <label
            v-if="!documentsLocked"
            class="cursor-pointer rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            :class="kind === 'invoice' ? '' : 'ml-auto'"
          >
            {{ fileOf(kind) === null ? '첨부' : '교체' }}
            <input
              type="file"
              class="hidden"
              :disabled="busy"
              @change="(e) => onFilePicked(kind, e)"
            >
          </label>
        </div>
      </template>
    </div>

    <!-- 검수 결과 -->
    <p
      v-if="shipment.receivedAt !== null"
      class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
    >
      입고 확인 완료 — {{ fmtKstDate(shipment.receivedAt) }}
      <template v-if="shipment.receivedNote !== null && shipment.receivedNote !== ''">
        · 검수 메모: <b>{{ shipment.receivedNote }}</b>
      </template>
    </p>

    <!-- 내 차례 폼 -->
    <div
      v-if="isMyTurn && nextStatus !== null"
      class="mt-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3"
    >
      <p class="text-sm font-bold text-blue-800">다음 단계: {{ statusLabel(nextStatus) }}</p>
      <div v-if="nextStatus === 'requested'" class="mt-2 space-y-2">
        <!-- 운송수단 — 출고예정일보다 **먼저**다: 이 값이 정해져야 위 서류 줄이 AWB 인지
             B/L 인지 정해진다(순서가 곧 의존이다). PCB 트랙과 같은 사전·같은 문구. -->
        <div class="flex flex-wrap items-center gap-4">
          <span class="text-sm font-semibold text-gray-600">운송수단</span>
          <label
            v-for="t in SHIPMENT_TRANSPORTS"
            :key="t"
            class="flex cursor-pointer items-center gap-1.5 text-sm text-gray-700"
          >
            <input v-model="transport" type="radio" :value="t">
            <b>{{ SHIPMENT_TRANSPORT_LABELS[t] }}</b>
            <span class="text-xs font-normal text-gray-400">{{ t === 'air' ? '(특송·AWB)' : '(선박·B/L)' }}</span>
          </label>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="text-sm text-gray-600">출고예정일 (필수)
            <input
              v-model="shipDate"
              type="date"
              class="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-sm"
            >
          </label>
          <p class="self-end pb-1 text-xs text-gray-500">
            {{ fileLabel('invoice') }} 첨부가 필요합니다{{
              fileOf('invoice') === null ? ' — 위에서 먼저 첨부해 주세요.' : ' ✓'
            }}
            <br><span class="font-semibold text-emerald-700">선적 리스트·QR 저장도 필수입니다.</span>
          </p>
        </div>
      </div>
      <div v-else-if="nextStatus === 'shipping'" class="mt-2 grid gap-2 sm:grid-cols-3">
        <input
          v-model="carrier"
          type="text"
          maxlength="50"
          placeholder="택배사 (필수)"
          class="h-9 rounded-lg border border-gray-200 px-3 text-sm"
        >
        <input
          v-model="trackingNumber"
          type="text"
          maxlength="100"
          placeholder="송장번호 (필수)"
          class="h-9 rounded-lg border border-gray-200 px-3 font-mono text-sm"
        >
        <input
          v-model="trackingUrl"
          type="url"
          maxlength="500"
          placeholder="추적 URL (선택)"
          class="h-9 rounded-lg border border-gray-200 px-3 text-sm"
        >
      </div>
      <p v-if="nextStatus === 'shipping'" class="mt-1 text-xs font-semibold text-emerald-700">
        배송 진행 전 선적 리스트·QR 저장이 필요합니다.
      </p>
      <button
        type="button"
        class="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="busy"
        @click="advance"
      >
        '{{ statusLabel(nextStatus) }}'(으)로 진행 →
      </button>
    </div>
    <p
      v-else-if="shipment.receivedAt === null && nextStatus !== null"
      class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500"
    >
      ⏳ 샘플피씨비의 '{{ statusLabel(nextStatus) }}' 처리를 기다리고 있습니다.
    </p>

    <p v-if="error !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ error }}</p>

    <InvoiceEditorModal
      v-if="mode === 'international' && !documentsLocked"
      :open="invoiceOpen"
      :load-draft="invoiceApi.loadDraft"
      :save-draft="invoiceApi.saveDraft"
      :render-xlsx="invoiceApi.renderXlsx"
      :attach-pdf="attachInvoicePdf"
      @close="invoiceOpen = false"
    />
    <ShipmentPackingModal
      :open="packingOpen"
      :load="packingApi.load"
      :save="packingApi.save"
      :mark-printed="packingApi.markPrinted"
      @close="packingOpen = false"
    />
    <TradeDocumentModal
      v-if="mode === 'domestic'"
      :open="quotationPoId !== null"
      label="협력사 견적서"
      :load="loadQuotation"
      @close="quotationPoId = null"
    />
    <TradeDocumentModal
      v-if="mode === 'domestic'"
      :open="statementOpen"
      label="거래명세서"
      :load="loadStatement"
      @close="statementOpen = false"
    />
  </div>
</template>
