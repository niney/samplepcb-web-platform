<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL,
  BOM_SHIPMENT_DOMESTIC_STATUSES,
  BOM_SHIPMENT_FILE_DOMESTIC_LABELS,
  BOM_SHIPMENT_FILE_LABELS,
  BOM_SHIPMENT_FILE_TYPES,
  BOM_SHIPMENT_INTL_STATUSES,
  BOM_SHIPMENT_MODE_LABELS,
  BOM_SHIPMENT_MODES,
  BOM_SHIPMENT_STATUS_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusesOf,
  type AdminBomPoViewType,
  type BomShipmentFileTypeType,
  type BomShipmentModeType,
  type BomShipmentStatusType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  adminInvoiceApi,
  adminPackingApi,
  downloadBomShipmentFile,
  loadAdminPartnerQuotation,
  loadAdminShipmentStatement,
  useDeleteBomShipmentFile,
  useDetachBomShipmentPo,
  useReceiveBomShipment,
  useUploadBomShipmentFile,
  useUpsertBomShipment,
} from '../../../admin/useAdminBomPos';
import InvoiceEditorModal from '../../smartbom/InvoiceEditorModal.vue';
import ShipmentPackingModal from '../../smartbom/ShipmentPackingModal.vue';
import TradeDocumentModal from '../../smartbom/TradeDocumentModal.vue';

// 선적 관리 모달(D21·D22) — 발주서당 1건. 모드는 생성 시 박제(협력사 국가 기본값은 서버가
// 제안), 상태는 모드별 사전(국제 6단계/국내 3단계). 관리자는 전 단계 임의 조작(핑퐁 인가는
// 협력사 쪽만). 첨부 = Invoice/AWB 종류별 1건(교체), 입고 확인 = 검수(⑩) + 편차 메모.

const props = defineProps<{
  open: boolean;
  quoteId: string;
  po: AdminBomPoViewType | null;
}>();
const emit = defineEmits<{ close: [] }>();

const upsert = useUpsertBomShipment();
const receive = useReceiveBomShipment();
const uploadFile = useUploadBomShipmentFile();
const deleteFile = useDeleteBomShipmentFile();
const detach = useDetachBomShipmentPo();

// 묶음 제외(§6.10) — 대표 불가·발송 준비 단계만(서버 재검증).
async function detachGroupPo(poId: number, title: string): Promise<void> {
  if (
    !window.confirm(`'${title}' 발주서를 묶음에서 제외할까요? 별도 선적으로 다시 진행하게 됩니다.`)
  ) {
    return;
  }
  error.value = '';
  try {
    await detach.mutateAsync({ quoteId: props.quoteId, poId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '묶음 제외에 실패했습니다.';
  }
}

const mode = ref<BomShipmentModeType>('international');
const status = ref<BomShipmentStatusType>('preparing');
const carrier = ref('');
const trackingNumber = ref('');
const trackingUrl = ref('');
const shipDate = ref('');
const receiveNote = ref('');
const error = ref('');

const existing = computed(() => props.po?.shipment ?? null);
const modeLocked = computed(() => existing.value !== null); // 생성 시 박제
const packingOpen = ref(false);
const quotationPoId = ref<number | null>(null);
const statementOpen = ref(false);
const packingApi = computed(() =>
  existing.value === null ? null : adminPackingApi(existing.value.shipmentId),
);
const tradeDocumentPos = computed<{ poId: number; quoteTitle: string }[]>(() => {
  if ((existing.value?.groupPos.length ?? 0) > 0) {
    return (existing.value?.groupPos ?? []).map((entry) => ({
      poId: entry.poId,
      quoteTitle: entry.quoteTitle,
    }));
  }
  return props.po === null ? [] : [{ poId: props.po.poId, quoteTitle: '' }];
});
const loadQuotation = () => {
  if (quotationPoId.value === null) return Promise.reject(new Error('quotation not selected'));
  return loadAdminPartnerQuotation(quotationPoId.value);
};
const loadStatement = () => {
  if (existing.value === null) return Promise.reject(new Error('shipment not selected'));
  return loadAdminShipmentStatement(existing.value.shipmentId);
};

// ── 핑퐁 안내(D22) — 저장된 상태 기준 "다음 단계·주체"를 모달이 말해준다 ─────
const savedNext = computed(() =>
  existing.value === null
    ? null
    : bomShipmentNextStatus(existing.value.mode, existing.value.status),
);
const savedNextActor = computed(() =>
  existing.value === null || savedNext.value === null
    ? null
    : bomShipmentActorOf(existing.value.mode, savedNext.value),
);
const savedLabel = (s: BomShipmentStatusType): string =>
  existing.value === null ? BOM_SHIPMENT_STATUS_LABELS[s] : statusLabel(existing.value.mode, s);

// 입고 확인 위계 — 도착 단계(국제 arrived·국내 shipping) 전엔 "조기 입고"로 접고 경고.
const arrivedOrLater = computed(() => {
  if (existing.value === null) return false;
  const chain = bomShipmentStatusesOf(existing.value.mode);
  const arrivedIdx = chain.indexOf(existing.value.mode === 'domestic' ? 'shipping' : 'arrived');
  return chain.indexOf(existing.value.status) >= arrivedIdx;
});
const earlyReceive = computed(() => !(arrivedOrLater.value || existing.value?.receivedAt != null));

watch(
  () => [props.open, props.po?.poId] as const,
  ([open]) => {
    if (!open) return;
    const shipment = props.po?.shipment ?? null;
    mode.value = shipment?.mode ?? 'international';
    status.value = shipment?.status ?? 'preparing';
    carrier.value = shipment?.carrier ?? '';
    trackingNumber.value = shipment?.trackingNumber ?? '';
    trackingUrl.value = shipment?.trackingUrl ?? '';
    shipDate.value = shipment?.shipDate ?? '';
    receiveNote.value = shipment?.receivedNote ?? '';
    packingOpen.value = false;
    quotationPoId.value = null;
    statementOpen.value = false;
    error.value = '';
  },
);

const statusOptions = computed(() =>
  (mode.value === 'domestic' ? BOM_SHIPMENT_DOMESTIC_STATUSES : BOM_SHIPMENT_INTL_STATUSES).map(
    (value) => ({ value, label: statusLabel(mode.value, value) }),
  ),
);

function statusLabel(m: BomShipmentModeType, s: BomShipmentStatusType): string {
  if (m === 'domestic' && s === 'preparing') return BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL;
  return BOM_SHIPMENT_STATUS_LABELS[s];
}

watch(mode, () => {
  // 모드 전환(생성 전) 시 상태를 해당 사전의 시작 단계로
  if (!modeLocked.value) status.value = 'preparing';
});

const toNullable = (v: string): string | null => (v.trim() === '' ? null : v.trim());

// 첨부(D22) — 종류별 1건. 라벨은 모드별(국내: 거래명세서/송장내역).
const fileLabel = (kind: BomShipmentFileTypeType): string =>
  mode.value === 'domestic'
    ? BOM_SHIPMENT_FILE_DOMESTIC_LABELS[kind]
    : BOM_SHIPMENT_FILE_LABELS[kind];
const fileOf = (kind: BomShipmentFileTypeType) =>
  existing.value?.files.find((f) => f.fileType === kind) ?? null;
const fileBusy = computed(() => uploadFile.isPending.value || deleteFile.isPending.value);
// 레거시 '선적' 전이의 AWB 필수를 관리자에겐 경고로만(임의 조작 원칙 유지)
const awbWarning = computed(
  () =>
    mode.value === 'international' && status.value === 'shipped' && fileOf('airwaybill') === null,
);

async function onFilePicked(kind: BomShipmentFileTypeType, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined || props.po === null) return;
  error.value = '';
  try {
    await uploadFile.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      fileType: kind,
      file,
    });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 업로드에 실패했습니다.';
  }
}

async function removeFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || props.po === null) return;
  if (!window.confirm(`${fileLabel(kind)} 파일을 삭제할까요?`)) return;
  error.value = '';
  try {
    await deleteFile.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      fileId: file.fileId,
    });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 삭제에 실패했습니다.';
  }
}

async function downloadFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || props.po === null) return;
  try {
    await downloadBomShipmentFile(props.quoteId, props.po.poId, file.fileId, file.name);
  } catch {
    error.value = '파일 다운로드에 실패했습니다.';
  }
}

// ── 상업송장 생성기(D23) — 관리자 대리 작성(협력사와 같은 편집본 공유) ────────
const invoiceOpen = ref(false);
const invoiceApi = computed(() =>
  props.po === null ? null : adminInvoiceApi(props.quoteId, props.po.poId),
);
async function attachInvoicePdf(file: File): Promise<void> {
  if (props.po === null) return;
  await uploadFile.mutateAsync({
    quoteId: props.quoteId,
    poId: props.po.poId,
    fileType: 'invoice',
    file,
  });
}

async function save(): Promise<void> {
  if (props.po === null) return;
  error.value = '';
  try {
    await upsert.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      body: {
        ...(modeLocked.value ? {} : { mode: mode.value }),
        status: status.value,
        carrier: toNullable(carrier.value),
        trackingNumber: toNullable(trackingNumber.value),
        trackingUrl: toNullable(trackingUrl.value),
        shipDate: toNullable(shipDate.value),
      },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

// 관리자 차례 다음 단계로 진행 — 상태 셀렉트를 다음 단계로 맞추고 저장(임의 조작과 동일 경로).
async function advanceAsAdmin(): Promise<void> {
  if (savedNext.value === null) return;
  if (
    savedNext.value === 'shipped' &&
    fileOf('airwaybill') === null &&
    !window.confirm('AWB 파일이 아직 없습니다. 첨부 없이 선적 단계로 진행할까요?')
  ) {
    return;
  }
  status.value = savedNext.value;
  await save();
}

async function confirmReceive(): Promise<void> {
  if (props.po === null) return;
  const warn = earlyReceive.value
    ? `선적이 아직 '${existing.value === null ? '준비' : savedLabel(existing.value.status)}' 단계입니다. 시스템 밖으로 이미 수령한 경우에만 진행하세요.\n\n`
    : '';
  if (
    !window.confirm(
      `${warn}입고 확인 처리할까요? 선적이 최종 단계로 마감되고 검수 시점이 기록됩니다.`,
    )
  ) {
    return;
  }
  error.value = '';
  try {
    await receive.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      body: { note: toNullable(receiveNote.value) },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '입고 확인에 실패했습니다.';
  }
}
</script>

<template>
  <div
    v-if="open && po !== null"
    class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">선적 관리 — {{ po.partnerName }}</h2>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">
          ✕
        </button>
      </div>

      <!-- 핑퐁 안내(D22) — 지금 누구 차례인지, 관리자 차례면 주 버튼으로 바로 진행 -->
      <div
        v-if="existing !== null && savedNext !== null"
        class="mt-3 rounded-xl px-3 py-2.5 text-xs"
        :class="savedNextActor === 'ADMIN' ? 'border border-blue-100 bg-blue-50/60' : 'bg-gray-50'"
      >
        <template v-if="savedNextActor === 'ADMIN'">
          <p class="font-bold text-blue-800">
            다음 단계: {{ savedLabel(savedNext) }} — 샘플피씨비 차례입니다.
            <span v-if="savedNext === 'shipped'" class="font-normal text-blue-700">AWB 첨부와 송장번호를 확인해 주세요.</span>
          </p>
          <button
            type="button"
            class="mt-1.5 rounded-lg bg-blue-600 px-3 py-1.5 font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="upsert.isPending.value"
            @click="advanceAsAdmin"
          >
            '{{ savedLabel(savedNext) }}'(으)로 진행 →
          </button>
        </template>
        <p v-else class="text-gray-500">
          ⏳ 협력사의 '{{ savedLabel(savedNext) }}' 처리를 기다리는 중입니다 — 필요하면 아래에서
          관리자가 대신 진행할 수 있습니다.
        </p>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
        <label class="text-gray-500">모드{{ modeLocked ? ' (박제됨)' : '' }}
          <select
            v-model="mode"
            :disabled="modeLocked"
            class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
          >
            <option v-for="m in BOM_SHIPMENT_MODES" :key="m" :value="m">
              {{ BOM_SHIPMENT_MODE_LABELS[m] }}
            </option>
          </select>
        </label>
        <label class="text-gray-500">상태
          <select v-model="status" class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2">
            <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label class="text-gray-500">운송사
          <input
            v-model="carrier"
            type="text"
            maxlength="50"
            class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
          >
        </label>
        <label class="text-gray-500">송장번호
          <input
            v-model="trackingNumber"
            type="text"
            maxlength="100"
            class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 font-mono"
          >
        </label>
        <label class="text-gray-500">출고예정일
          <input
            v-model="shipDate"
            type="date"
            class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
          >
        </label>
        <label class="text-gray-500">추적 URL
          <input
            v-model="trackingUrl"
            type="url"
            maxlength="500"
            class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
          >
        </label>
      </div>
      <p
        v-if="awbWarning"
        class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
      >
        '선적' 단계인데 AWB 파일이 없습니다 — 첨부를 권장합니다(레거시 절차상 필수 서류).
      </p>
      <p v-if="existing?.shippedAt != null" class="mt-2 text-[11px] text-gray-400">
        발송 {{ existing.shippedAt.slice(0, 10) }}
        <template v-if="existing.completedAt !== null">
          · 최종 {{ existing.completedAt.slice(0, 10) }}
        </template>
      </p>

      <!-- 선적 그룹(§6.10) — 묶음 소속 발주서 목록 + 제외(발송 준비 단계·비대표만) -->
      <div
        v-if="(existing?.groupPos.length ?? 0) > 1"
        class="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3"
      >
        <p class="text-xs font-bold text-indigo-800">
          📦 묶음 발송 — 발주서 {{ existing?.groupPos.length }}건
        </p>
        <ul class="mt-1 space-y-1 text-xs text-gray-700">
          <li
            v-for="entry in existing?.groupPos ?? []"
            :key="entry.poId"
            class="flex items-center gap-2"
          >
            <span :class="entry.poId === po.poId ? 'font-bold' : ''">{{ entry.quoteTitle }}</span>
            <span class="text-gray-400">{{ entry.totalAmount.toLocaleString('ko-KR') }}원</span>
            <button
              v-if="existing?.status === 'preparing'"
              type="button"
              class="ml-auto rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              :disabled="detach.isPending.value"
              @click="detachGroupPo(entry.poId, entry.quoteTitle)"
            >
              제외
            </button>
          </li>
        </ul>
        <p class="mt-1 text-[10px] text-indigo-500">
          입고 확인은 묶음 전체가 함께 처리됩니다(선적 단위 검수).
        </p>
      </div>

      <!-- 첨부(D22) — 종류별 1건, 재업로드=교체. 협력사 포털과 같은 문서를 본다 -->
      <div class="mt-3 space-y-1.5 rounded-xl border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">선적 서류</p>
        <div
          v-if="existing !== null"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 px-2 py-2 text-xs"
        >
          <span class="w-20 shrink-0 font-semibold text-emerald-800">선적 리스트</span>
          <span class="text-emerald-700">부품별 실물 포장 QR·라벨</span>
          <button
            type="button"
            class="ml-auto rounded bg-emerald-600 px-2 py-1 font-bold text-white hover:bg-emerald-700"
            @click="packingOpen = true"
          >
            {{ existing.status === 'preparing' ? '대리 작성·인쇄' : '보기·재인쇄' }}
          </button>
        </div>
        <div
          class="flex flex-wrap items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50/50 px-2 py-2 text-xs"
        >
          <span class="w-20 shrink-0 font-semibold text-violet-800">거래 문서</span>
          <button
            v-for="entry in tradeDocumentPos"
            :key="`quotation-${entry.poId}`"
            type="button"
            class="max-w-36 truncate rounded border border-violet-200 bg-white px-2 py-1 font-semibold text-violet-700 hover:bg-violet-100"
            :title="entry.quoteTitle === '' ? '협력사 견적서' : `${entry.quoteTitle} 협력사 견적서`"
            @click="quotationPoId = entry.poId"
          >
            견적서{{ tradeDocumentPos.length > 1 ? ` #${entry.poId}` : '' }}
          </button>
          <button
            v-if="existing !== null"
            type="button"
            class="rounded bg-violet-600 px-2 py-1 font-bold text-white hover:bg-violet-700"
            @click="statementOpen = true"
          >
            거래명세서
          </button>
        </div>
        <div
          v-for="kind in BOM_SHIPMENT_FILE_TYPES"
          :key="kind"
          class="flex flex-wrap items-center gap-2 text-xs"
        >
          <span class="w-20 shrink-0 font-semibold text-gray-600">{{ fileLabel(kind) }}</span>
          <template v-if="fileOf(kind) !== null">
            <button type="button" class="text-blue-600 underline" @click="downloadFile(kind)">
              {{ fileOf(kind)?.name }}
            </button>
            <span class="text-[10px] text-gray-400">{{
              fileOf(kind)?.uploadedBy === 'PARTNER' ? '협력사 첨부' : '관리자 첨부'
            }}</span>
            <button
              type="button"
              class="text-red-500 underline disabled:opacity-40"
              :disabled="fileBusy"
              @click="removeFile(kind)"
            >
              삭제
            </button>
          </template>
          <span v-else class="text-gray-300">없음</span>
          <button
            v-if="kind === 'invoice' && mode === 'international'"
            type="button"
            class="ml-auto rounded border border-indigo-200 px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
            :disabled="fileBusy"
            title="발주 데이터로 자동 초안을 만들어 편집 후 PDF로 첨부합니다(협력사 대리 작성)"
            @click="invoiceOpen = true"
          >
            🧾 생성
          </button>
          <label
            class="cursor-pointer rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
            :class="kind === 'invoice' && mode === 'international' ? '' : 'ml-auto'"
          >
            {{ fileOf(kind) === null ? '첨부' : '교체' }}
            <input
              type="file"
              class="hidden"
              :disabled="fileBusy"
              @change="(e) => onFilePicked(kind, e)"
            >
          </label>
        </div>
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

      <ShipmentPackingModal
        v-if="packingApi !== null"
        :open="packingOpen"
        :load="packingApi.load"
        :save="packingApi.save"
        :mark-printed="packingApi.markPrinted"
        @close="packingOpen = false"
      />

      <TradeDocumentModal
        :open="quotationPoId !== null"
        :load="loadQuotation"
        @close="quotationPoId = null"
      />

      <TradeDocumentModal
        :open="statementOpen"
        :load="loadStatement"
        @close="statementOpen = false"
      />

      <div class="mt-4 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50"
          @click="emit('close')"
        >
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="upsert.isPending.value"
          @click="save"
        >
          저장
        </button>
      </div>

      <!-- 입고 확인(검수 ⑩) — 도착 단계부터가 정상 흐름. 그 전엔 시스템 밖 수령 예외용으로만
           (D22 위계 조정: 이른 단계에선 흐릿하게 + 경고, 기능 자체는 보존) -->
      <div
        class="mt-4 rounded-xl border p-3"
        :class="earlyReceive ? 'border-gray-100 opacity-80' : 'border-gray-200'"
      >
        <p class="text-xs font-bold text-gray-700">
          입고 확인(검수)
          <span v-if="existing?.receivedAt != null" class="ml-1 font-normal text-emerald-700">
            — {{ existing.receivedAt.slice(0, 10) }} 완료
          </span>
        </p>
        <p
          v-if="earlyReceive"
          class="mt-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700"
        >
          아직 도착 전 단계입니다 — 선적 추적 없이 물품을 이미 수령한 경우에만 사용하세요.
        </p>
        <label class="mt-2 block text-xs text-gray-500">편차 메모(수량 부족·불량 등 — 선택)
          <textarea
            v-model="receiveNote"
            rows="2"
            maxlength="2000"
            class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
          />
        </label>
        <button
          type="button"
          class="mt-2 rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-40"
          :class="
            earlyReceive ? 'bg-gray-400 hover:bg-gray-500' : 'bg-emerald-600 hover:bg-emerald-700'
          "
          :disabled="receive.isPending.value"
          @click="confirmReceive"
        >
          {{ existing?.receivedAt != null ? '입고 확인 갱신' : '입고 확인' }}
        </button>
      </div>

      <p v-if="error !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ error }}</p>
    </div>
  </div>
</template>
