<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_FILE_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  type BomShipmentFileTypeType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import {
  downloadPartnerPcbShipmentFile,
  partnerPcbInvoiceApi,
  usePartnerPcbShipmentAdvance,
  usePartnerPcbShipmentRevert,
  useUploadPartnerPcbShipmentFile,
} from '../../partner/usePartnerPcbPos';
import InvoiceEditorModal from '../smartbom/InvoiceEditorModal.vue';
import { fmtKstDate as dateOnly } from '@sp/utils';
import { fmtPcbAmount } from '../../lib/pcb-money';
import { confirmDialog } from '../../lib/confirmDialog';

// PCB 발송 카드(보내는측 전용) — 스텝퍼·전이 폼·첨부·상업송장·되돌리기를 한 카드에.
// [📦 PCB 보내기] 보드가 발송 조작의 단일 창구다(§9 재구성 후속 — BOM
// PartnerShipmentCard 미러). 조작은 대표 발주서(poId) 경유 — 서버는 발송(묶음)
// 단위로 전이한다. 받는측(MD 입고) 액션은 여기 없다 — 발주한 하위 건 상세가 그 자리.

// readonly = 완료 아카이브처럼 조작이 끝난 자리 — 읽는 정보만 남기고 액션을 걷는다.
const props = withDefaults(
  defineProps<{ shipment: PcbShipmentViewType; readonly?: boolean }>(),
  { readonly: false },
);

const repPoId = computed(() => props.shipment.poId);
const shipNext = computed(() => bomShipmentNextStatus(props.shipment.mode, props.shipment.status));
const canAct = computed(
  () =>
    shipNext.value !== null &&
    bomShipmentActorOf(props.shipment.mode, shipNext.value) === 'PARTNER',
);

// Invoice·AWB 는 국제 통관 서류다 — 서버도 국제 'requested' 에서만 첨부를 보므로
// 국내 체인엔 올릴 자리가 없다(이미 올라온 첨부의 다운로드는 남긴다).
const canEditDocs = computed(() => !props.readonly && props.shipment.mode === 'international');

// 되돌리기 주체는 '지금 상태로 진입시킨 쪽'(서버 revert 판정과 동형) — 국내 '입고 완료'는
// 관리자 몫이라 협력사에 노출해봐야 NOT_YOUR_TURN 이다.
const canRevert = computed(
  () =>
    !props.readonly &&
    props.shipment.receivedAt === null &&
    bomShipmentActorOf(props.shipment.mode, props.shipment.status) === 'PARTNER',
);

const advance = usePartnerPcbShipmentAdvance();
const revert = usePartnerPcbShipmentRevert();
const upload = useUploadPartnerPcbShipmentFile();

const error = ref('');
const shipDateInput = ref('');
const carrierInput = ref('');
const trackingInput = ref('');
const invoiceOpen = ref(false);
const invoiceApi = computed(() => partnerPcbInvoiceApi(repPoId.value));

// 국내 '배송 중' 전이의 택배사·송장번호는 서버 필수값(MISSING_TRACKING) — 왕복 전에 막는다.
const advanceBlocked = computed(
  () =>
    shipNext.value === 'shipping' &&
    (carrierInput.value.trim() === '' || trackingInput.value.trim() === ''),
);

const surface = (e: unknown, fallback: string): void => {
  error.value = e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

async function runAdvance(): Promise<void> {
  if (shipNext.value === null) return;
  error.value = '';
  try {
    await advance.mutateAsync({
      poId: repPoId.value,
      body: {
        ...(shipNext.value === 'requested' ? { shipDate: shipDateInput.value } : {}),
        ...(shipNext.value === 'shipping'
          ? { carrier: carrierInput.value, trackingNumber: trackingInput.value }
          : {}),
      },
    });
  } catch (e) {
    surface(e, '발송 진행에 실패했습니다.');
  }
}

async function runRevert(): Promise<void> {
  if (!(await confirmDialog({ message: '발송을 한 단계 되돌릴까요?', confirmLabel: '되돌리기', tone: 'danger' }))) return;
  error.value = '';
  try {
    await revert.mutateAsync({ poId: repPoId.value });
  } catch (e) {
    surface(e, '되돌리기에 실패했습니다.');
  }
}

function pickFile(fileType: BomShipmentFileTypeType): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    error.value = '';
    try {
      await upload.mutateAsync({ poId: repPoId.value, file, fileType });
    } catch (e) {
      surface(e, '파일 업로드에 실패했습니다.');
    }
  };
  input.click();
}

const STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};
</script>

<template>
  <section class="rounded-xl border border-teal-200 bg-surface p-4">
    <h2 class="text-sm font-bold text-teal-700">
      → {{ shipment.receiverName }}
      <template v-if="shipment.destinationCountry !== null"> · 직송 {{ shipment.destinationCountry }}</template>
      <span class="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[shipment.status]">
        {{ bomShipmentStatusLabel(shipment.mode, shipment.status) }}
      </span>
      <span class="ml-1 text-xs font-normal text-gray-400">
        {{ BOM_SHIPMENT_MODE_LABELS[shipment.mode] }}
      </span>
    </h2>

    <!-- 스텝퍼 -->
    <ol class="mt-3 flex flex-wrap items-center gap-1">
      <template v-for="(step, i) in bomShipmentStatusesOf(shipment.mode)" :key="step">
        <li
          class="rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="bomShipmentStatusesOf(shipment.mode).indexOf(shipment.status) > i ? 'bg-emerald-50 text-emerald-700' : bomShipmentStatusesOf(shipment.mode).indexOf(shipment.status) === i ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400'"
        >
          {{ bomShipmentStatusLabel(shipment.mode, step) }}
        </li>
        <span v-if="i < bomShipmentStatusesOf(shipment.mode).length - 1" class="text-gray-300">→</span>
      </template>
    </ol>
    <p v-if="shipment.receivedAt !== null" class="mt-1.5 text-xs font-semibold text-emerald-700">
      입고 확인 완료 {{ dateOnly(shipment.receivedAt) }}
      <template v-if="shipment.receivedNote !== null && shipment.receivedNote !== ''"> — 메모: {{ shipment.receivedNote }}</template>
    </p>
    <p v-if="shipment.trackingNumber !== null" class="mt-1 text-xs text-gray-500">
      운송장: {{ shipment.carrier ?? '' }} {{ shipment.trackingNumber }}
    </p>

    <!-- 담긴 발주서 -->
    <ul class="mt-3 space-y-1 rounded-lg border border-gray-100 p-3">
      <li v-for="g in shipment.groupPos" :key="g.poId" class="flex items-center gap-2 text-xs">
        <RouterLink
          :to="{ name: 'partner-pcb-po', params: { id: String(g.poId) } }"
          class="min-w-0 flex-1 truncate font-medium text-gray-700 hover:text-teal-700 hover:underline"
        >
          {{ g.projectName }}
        </RouterLink>
        <span class="shrink-0 text-gray-400">
          {{ g.qty.toLocaleString('ko-KR') }}pcs · {{ fmtPcbAmount(g.currency, g.priceOriginal) }}
        </span>
      </li>
    </ul>

    <!-- 보내는측 전이 폼 -->
    <template v-if="!readonly">
      <div v-if="canAct && shipNext !== null" class="mt-3 space-y-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <label v-if="shipNext === 'requested'" class="block">
            <span class="text-xs font-semibold text-gray-500">출고예정일 *</span>
            <input v-model="shipDateInput" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none">
          </label>
          <template v-if="shipNext === 'shipping'">
            <label class="block">
              <span class="text-xs font-semibold text-gray-500">택배사 *</span>
              <input v-model="carrierInput" type="text" placeholder="CJ대한통운 / SF Express" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none">
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-gray-500">송장번호 *</span>
              <input v-model="trackingInput" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-teal-500 focus:outline-none">
            </label>
          </template>
        </div>
        <p v-if="shipNext === 'requested'" class="text-xs text-gray-400">
          선적 요청에는 <b>Invoice 첨부</b>가 필요합니다 — [상업송장 만들기]로 PDF를 만들어 자동 첨부하세요.
        </p>
        <button
          type="button"
          class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          :disabled="advance.isPending.value || advanceBlocked"
          @click="void runAdvance()"
        >
          {{ bomShipmentStatusLabel(shipment.mode, shipNext) }} 진행
        </button>
      </div>
      <p v-else-if="shipNext !== null" class="mt-3 text-sm text-gray-500">
        {{ shipment.receiverName }} 측 처리를 기다리고 있습니다.
      </p>
    </template>

    <!-- 첨부·송장·되돌리기 — readonly 아카이브엔 다운로드만 남는다 -->
    <div v-if="!readonly || shipment.files.length > 0" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <template v-for="f in shipment.files" :key="f.fileId">
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
          @click="void downloadPartnerPcbShipmentFile(repPoId, f.fileId, f.name)"
        >
          ⬇ {{ BOM_SHIPMENT_FILE_LABELS[f.fileType] }}
        </button>
      </template>
      <template v-if="canEditDocs">
        <button type="button" class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50" @click="pickFile('invoice')">
          ⬆ Invoice
        </button>
        <button type="button" class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50" @click="pickFile('airwaybill')">
          ⬆ AWB/송장내역
        </button>
        <button
          type="button"
          class="rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-50"
          @click="invoiceOpen = true"
        >
          🧾 상업송장 만들기
        </button>
      </template>
      <button
        v-if="canRevert"
        type="button"
        class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
        @click="void runRevert()"
      >
        ↩ 되돌리기
      </button>
    </div>

    <p v-if="error !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ error }}</p>

    <!-- 상업송장 편집 — BOM InvoiceEditorModal 재사용(콜백 주입) -->
    <InvoiceEditorModal
      :open="invoiceOpen"
      :load-draft="invoiceApi.loadDraft"
      :save-draft="invoiceApi.saveDraft"
      :render-xlsx="invoiceApi.renderXlsx"
      :attach-pdf="invoiceApi.attachPdf"
      @close="invoiceOpen = false"
    />
  </section>
</template>
