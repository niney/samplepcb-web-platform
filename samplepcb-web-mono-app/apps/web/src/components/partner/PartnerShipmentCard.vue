<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
import { INTL_CARRIERS, isIntlCarrier } from '../../lib/shipment-carriers';

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

const shipDate = ref(props.shipment.shipDate ?? '');
const carrier = ref(props.shipment.carrier ?? '');
const trackingNumber = ref(props.shipment.trackingNumber ?? '');
const trackingUrl = ref(props.shipment.trackingUrl ?? '');
const error = ref('');
const shipMethod = ref<'self' | 'caseref'>(
  props.shipment.caseRefRequestedAt !== null ? 'caseref' : 'self',
);
const caseRefNote = ref(props.shipment.caseRefNote ?? '');

// ── 운송수단(08-16, PCB 트랙과 같은 공용 축) — 발송을 "무엇으로 나르나".
// 국제 '선적 요청'에서 고르고, 이 값 하나에서 **첨부해야 할 운송서류가 갈린다**
// (항공 AWB / 해상 B/L). 초깃값은 박제값 유도, 없으면 항공(현행 관례).
const transport = ref<ShipmentTransportType>(shipmentTransportOf(props.shipment.transport));
const CARRIER_CUSTOM = '__custom__';
const storedCarrier = props.shipment.carrier ?? '';
const storedCarrierPreset =
  shipmentTransportOf(props.shipment.transport) === 'air' && isIntlCarrier(storedCarrier);
const carrierChoice = ref(
  storedCarrierPreset ? storedCarrier : storedCarrier === '' ? '' : CARRIER_CUSTOM,
);
const carrierCustom = ref(storedCarrierPreset ? '' : storedCarrier);
const selfCarrier = computed(() =>
  transport.value === 'sea' || carrierChoice.value === CARRIER_CUSTOM
    ? carrierCustom.value.trim()
    : carrierChoice.value,
);

const mode = computed(() => props.shipment.mode);
const status = computed(() => props.shipment.status);
const stepChain = computed(() => bomShipmentStatusesOf(mode.value));
const stepIndex = computed(() => stepChain.value.indexOf(status.value));
const nextStatus = computed(() => bomShipmentNextStatus(mode.value, status.value));
const documentsLocked = computed(() =>
  bomShipmentDocumentsLocked(mode.value, status.value, props.shipment.receivedAt),
);
const isMyTurn = computed(() => props.shipment.myTurn);
const checklistMode = computed(
  () => mode.value === 'international' && isMyTurn.value && nextStatus.value === 'requested',
);
const caseRefBranch = computed(() => props.shipment.caseRefRequestedAt !== null);
const caseRefPending = computed(
  () => caseRefBranch.value && (props.shipment.caseRef === null || props.shipment.caseRef === ''),
);
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
const docKind = computed(() => shipmentTransportDocType(activeTransport.value));
const docLabel = computed(() => fileLabel(docKind.value));
const invoiceFile = computed(() => fileOf('invoice'));
const docFile = computed(() => fileOf(docKind.value));
const caseRefReady = computed(
  () =>
    caseRefBranch.value &&
    props.shipment.caseRef !== null &&
    props.shipment.caseRef !== '' &&
    props.shipment.trackingNumber !== null &&
    props.shipment.trackingNumber !== '' &&
    docFile.value !== null,
);
const myFiles = computed(() => props.shipment.files.filter((f) => f.uploadedBy !== 'ADMIN'));
const adminFiles = computed(() => props.shipment.files.filter((f) => f.uploadedBy === 'ADMIN'));

watch(transport, () => {
  carrierChoice.value = '';
  carrierCustom.value = '';
  trackingNumber.value = '';
  trackingUrl.value = '';
});

const requestBlockReason = computed<string | null>(() => {
  if (!checklistMode.value) return null;
  if (invoiceFile.value === null) return '② Invoice를 첨부해야 진행할 수 있습니다.';
  if (shipDate.value === '') return '⑤ 출고예정일을 입력해 주세요.';
  return null;
});
const advanceBlocked = computed(
  () =>
    requestBlockReason.value !== null ||
    (nextStatus.value === 'shipping' &&
      (carrier.value.trim() === '' || trackingNumber.value.trim() === '')),
);

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

async function downloadNamedFile(fileId: number, name: string): Promise<void> {
  try {
    await downloadPartnerShipmentFile(poId.value, fileId, name);
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
        ...(nextStatus.value === 'requested'
          ? {
              transport: transport.value,
              ...(shipMethod.value === 'caseref'
                ? {
                    caseRefRequested: true,
                    ...(caseRefNote.value.trim() === ''
                      ? {}
                      : { caseRefNote: caseRefNote.value.trim() }),
                  }
                : {
                    ...(selfCarrier.value === '' ? {} : { carrier: selfCarrier.value }),
                    ...(trackingNumber.value.trim() === ''
                      ? {}
                      : { trackingNumber: trackingNumber.value.trim() }),
                    ...(trackingUrl.value.trim() === ''
                      ? {}
                      : { trackingUrl: trackingUrl.value.trim() }),
                  }),
            }
          : {}),
        ...(nextStatus.value === 'shipping'
          ? {
              carrier: carrier.value.trim(),
              trackingNumber: trackingNumber.value.trim(),
              ...(trackingUrl.value.trim() === ''
                ? {}
                : { trackingUrl: trackingUrl.value.trim() }),
            }
          : {}),
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
      <span
        v-if="caseRefBranch"
        class="rounded px-1.5 py-0.5 text-xs font-bold"
        :class="caseRefPending ? 'bg-amber-100 text-amber-700' : 'bg-teal-100 text-teal-700'"
      >{{ caseRefPending ? 'Case ID 처리 대기' : '샘플피씨비 운송' }}</span>
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
          v-if="!checklistMode"
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
      <template v-if="mode === 'international' && !checklistMode && !caseRefBranch">
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

    <!-- Case ID 갈래는 PCB와 같이 제출 영역과 샘플피씨비 회신 영역을 분리한다. -->
    <template v-if="caseRefBranch && !checklistMode">
      <section class="mt-3 rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-500">내가 제출한 서류</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <button
            v-for="file in myFiles"
            :key="file.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
            :title="file.name"
            @click="downloadNamedFile(file.fileId, file.name)"
          >
            ⬇ {{ fileLabel(file.fileType) }}
          </button>
          <span v-if="myFiles.length === 0" class="text-gray-300">
            관리자 수정본으로 교체되어 아래 회신 영역에 있습니다.
          </span>
          <template v-if="!documentsLocked && shipment.shippedAt === null">
            <button
              type="button"
              class="rounded-md border border-indigo-200 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-50"
              @click="invoiceOpen = true"
            >
              🧾 인보이스 생성기
            </button>
            <label class="cursor-pointer rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50">
              ⬆ Invoice 교체
              <input type="file" class="hidden" :disabled="busy" @change="(e) => onFilePicked('invoice', e)">
            </label>
          </template>
        </div>
      </section>
      <section
        class="mt-2 rounded-lg px-3 py-2 text-xs"
        :class="
          caseRefPending
            ? 'bg-amber-50 text-amber-800'
            : caseRefReady
              ? 'border border-teal-200 bg-teal-50 text-teal-900'
              : 'border border-blue-200 bg-blue-50 text-blue-900'
        "
      >
        <template v-if="caseRefPending">
          <p class="font-bold">샘플피씨비 처리 대기 중</p>
          <p class="mt-0.5">
            Invoice 확인 후 Case ID·운송장·{{ docLabel }}를 준비합니다. 완료되면 메일로 안내됩니다.
          </p>
          <p v-if="shipment.caseRefNote" class="mt-1 text-amber-600">요청 메모: {{ shipment.caseRefNote }}</p>
        </template>
        <template v-else-if="caseRefReady">
          <p class="font-bold">샘플피씨비가 준비한 선적 정보 — 확인 후 라벨링·인계해 주세요</p>
          <p class="mt-1">
            발송 참조번호(Case ID): <b class="tracking-wide">{{ shipment.caseRef }}</b>
            <template v-if="shipment.trackingNumber !== null">
              · {{ docLabel }} No.: {{ shipment.carrier ?? '' }}
              <span class="font-mono">{{ shipment.trackingNumber }}</span>
            </template>
          </p>
          <div v-if="adminFiles.length > 0" class="mt-1.5 flex flex-wrap gap-2">
            <button
              v-for="file in adminFiles"
              :key="file.fileId"
              type="button"
              class="rounded-md border border-teal-300 bg-surface px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
              :title="file.name"
              @click="downloadNamedFile(file.fileId, file.name)"
            >
              ⬇ {{ fileLabel(file.fileType) }}
            </button>
          </div>
        </template>
        <template v-else>
          <p class="font-bold">Case ID 회신 완료 · 나머지 선적 정보 처리 중</p>
          <p class="mt-1">
            발송 참조번호(Case ID): <b class="tracking-wide">{{ shipment.caseRef }}</b>
          </p>
          <p class="mt-0.5 text-blue-700">
            운송장과 {{ docLabel }}가 준비되면 메일로 다시 안내됩니다.
          </p>
        </template>
      </section>
    </template>

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

    <!-- PCB와 같은 국제 선적 요청 체크리스트. BOM 고유 선적 리스트·QR을 첫 단계로 유지한다. -->
    <div v-if="checklistMode" class="mt-3 space-y-2.5">
      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">① 선적 리스트·QR 준비 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            class="rounded-md bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700"
            @click="packingOpen = true"
          >
            📦 만들기·인쇄
          </button>
          <span class="text-gray-400">부품별 수량·LOT·Date Code와 실물 포장 라벨을 저장합니다.</span>
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">② Invoice 준비 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            class="rounded-md bg-blue-600 px-3 py-1.5 font-bold text-white hover:bg-blue-700"
            @click="invoiceOpen = true"
          >
            🧾 인보이스 생성기
          </button>
          <span class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">권장</span>
          <label class="cursor-pointer rounded-md border border-gray-300 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
            ⬆ 직접 업로드
            <input type="file" class="hidden" :disabled="busy" @change="(e) => onFilePicked('invoice', e)">
          </label>
        </div>
        <p v-if="invoiceFile !== null" class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span class="font-semibold text-emerald-600">✓ 첨부됨</span>
          <span class="max-w-64 truncate text-gray-600" :title="invoiceFile.name">{{ invoiceFile.name }}</span>
          <button type="button" class="text-blue-700 hover:underline" @click="downloadFile('invoice')">내려받기</button>
          <button type="button" class="text-gray-500 hover:underline" @click="removeFile('invoice')">삭제</button>
        </p>
        <p v-else class="mt-2 text-xs text-gray-400">생성기를 쓰면 발주 품목·금액이 자동으로 채워지고 PDF로 첨부됩니다.</p>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">③ 운송수단 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap gap-5">
          <label
            v-for="item in SHIPMENT_TRANSPORTS"
            :key="item"
            class="flex cursor-pointer items-center gap-1.5 text-xs text-gray-700"
          >
            <input v-model="transport" type="radio" :value="item">
            <b>{{ SHIPMENT_TRANSPORT_LABELS[item] }}</b>
            <span class="text-gray-400">{{ item === 'air' ? '(특송·AWB)' : '(선박·B/L)' }}</span>
          </label>
        </div>
        <p class="mt-1.5 text-[11px] text-gray-400">운송서류는 <b>{{ docLabel }}</b>입니다.</p>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">④ 발송 방식 선택</p>
        <label class="mt-2 flex cursor-pointer items-start gap-2 text-xs text-gray-700">
          <input v-model="shipMethod" type="radio" value="self" class="mt-0.5">
          <span><b>내 운송 계정으로 직접 발송</b> — {{ docLabel }}와 운송 정보를 직접 준비합니다.</span>
        </label>
        <div v-if="shipMethod === 'self'" class="ml-6 mt-2 space-y-2 text-xs">
          <div class="flex flex-wrap items-center gap-2">
            <label class="cursor-pointer rounded-md border border-gray-300 px-2.5 py-1 font-semibold text-gray-600 hover:bg-gray-50">
              ⬆ {{ docLabel }} 첨부
              <input type="file" class="hidden" :disabled="busy" @change="(e) => onFilePicked(docKind, e)">
            </label>
            <span v-if="docFile !== null" class="font-semibold text-emerald-600">✓ {{ docFile.name }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-gray-500">{{ transport === 'sea' ? '선사·포워더' : '운송회사' }} <span class="font-normal text-gray-400">(선택)</span></span>
            <select
              v-if="transport === 'air'"
              v-model="carrierChoice"
              class="h-8 rounded-md border border-gray-300 bg-surface px-2 text-xs"
            >
              <option value="">선택 안 함</option>
              <option v-for="item in INTL_CARRIERS" :key="item" :value="item">{{ item }}</option>
              <option :value="CARRIER_CUSTOM">직접입력</option>
            </select>
            <input
              v-if="transport === 'sea' || carrierChoice === CARRIER_CUSTOM"
              v-model="carrierCustom"
              type="text"
              maxlength="50"
              :placeholder="transport === 'sea' ? '선사 또는 포워더명' : '운송회사명'"
              class="h-8 w-44 rounded-md border border-gray-300 px-2 text-xs"
            >
            <span class="font-semibold text-gray-500">{{ docLabel }} No. <span class="font-normal text-gray-400">(선택)</span></span>
            <input v-model="trackingNumber" type="text" maxlength="100" class="h-8 w-44 rounded-md border border-gray-300 px-2 font-mono text-xs">
          </div>
        </div>
        <label class="mt-3 flex cursor-pointer items-start gap-2 text-xs text-gray-700">
          <input v-model="shipMethod" type="radio" value="caseref" class="mt-0.5">
          <span><b>샘플피씨비 운송으로 발송 — 발송 참조번호(Case ID) 요청</b></span>
        </label>
        <div v-if="shipMethod === 'caseref'" class="ml-6 mt-2 space-y-2">
          <p class="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Case ID·운송장·{{ docLabel }}는 샘플피씨비가 처리합니다. 준비되면 메일로 안내됩니다.
          </p>
          <input
            v-model="caseRefNote"
            type="text"
            maxlength="255"
            placeholder="요청 메모(선택) — 예: DHL 착불 계정번호가 필요합니다"
            class="w-full rounded-md border border-amber-200 bg-surface px-3 py-1.5 text-xs"
          >
        </div>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">⑤ 출고예정일 <span class="text-red-500">*</span></p>
        <input v-model="shipDate" type="date" class="mt-2 w-48 rounded-md border border-gray-300 px-3 py-2 text-sm">
      </section>

      <button
        type="button"
        class="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="busy || advanceBlocked"
        @click="advance"
      >
        선적 요청 진행
      </button>
      <p v-if="requestBlockReason !== null" class="text-xs text-gray-400">ⓘ {{ requestBlockReason }}</p>
    </div>

    <!-- 국내 배송 중 등 체크리스트 밖의 협력사 전이. -->
    <div
      v-else-if="isMyTurn && nextStatus !== null"
      class="mt-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3"
    >
      <p class="text-sm font-bold text-blue-800">다음 단계: {{ statusLabel(nextStatus) }}</p>
      <div v-if="nextStatus === 'shipping'" class="mt-2 grid gap-2 sm:grid-cols-3">
        <input v-model="carrier" type="text" maxlength="50" placeholder="택배사 (필수)" class="h-9 rounded-lg border border-gray-200 px-3 text-sm">
        <input v-model="trackingNumber" type="text" maxlength="100" placeholder="송장번호 (필수)" class="h-9 rounded-lg border border-gray-200 px-3 font-mono text-sm">
        <input v-model="trackingUrl" type="url" maxlength="500" placeholder="추적 URL (선택)" class="h-9 rounded-lg border border-gray-200 px-3 text-sm">
      </div>
      <p v-if="nextStatus === 'shipping'" class="mt-1 text-xs font-semibold text-emerald-700">배송 진행 전 선적 리스트·QR 저장이 필요합니다.</p>
      <button
        type="button"
        class="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="busy || advanceBlocked"
        @click="advance"
      >
        '{{ statusLabel(nextStatus) }}'(으)로 진행 →
      </button>
    </div>
    <p
      v-else-if="shipment.receivedAt === null && nextStatus !== null"
      class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500"
    >
      <template v-if="caseRefPending">
        ⏳ 샘플피씨비가 Case ID·운송장·{{ docLabel }}를 준비하고 있습니다.
      </template>
      <template v-else>
        ⏳ 샘플피씨비의 '{{ statusLabel(nextStatus) }}' 처리를 기다리고 있습니다.
      </template>
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
