<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toDataURL } from 'qrcode';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  PCB_PACKAGE_STATUS_LABELS,
  bomShipmentStatusLabel,
  type PcbShipmentPackageListType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { usePrintIsolation } from '../../lib/usePrintIsolation';

// PCB Case QR — BOM 포장 편집기를 복제하지 않는다. 합배송 박스의 현재 PO마다 서버가
// 라벨 1개를 자동 보장하고, 이 모달은 안전한 표시 정보만 미리보기·일괄 인쇄한다.

const props = defineProps<{
  open: boolean;
  load: () => Promise<PcbShipmentPackageListType>;
  markPrinted: () => Promise<PcbShipmentPackageListType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<PcbShipmentPackageListType | null>(null);
const loading = ref(false);
const printing = ref(false);
const error = ref('');
const qrImages = ref<Record<string, string>>({});

const qrTarget = (token: string): string =>
  new URL(`/app/admin/pcb/packages/${encodeURIComponent(token)}`, window.location.origin).toString();

async function rebuildQrImages(): Promise<void> {
  const current = data.value;
  if (current === null) {
    qrImages.value = {};
    return;
  }
  const entries = await Promise.all(
    current.packages.map(async (pkg) => [
      pkg.token,
      await toDataURL(qrTarget(pkg.token), {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
      }),
    ] as const),
  );
  qrImages.value = Object.fromEntries(entries);
}

async function loadLabels(): Promise<void> {
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    data.value = structuredClone(await props.load());
    await rebuildQrImages();
  } catch (cause) {
    error.value =
      cause instanceof ApiRequestError ? cause.message : 'PCB QR 라벨을 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadLabels();
  },
  { immediate: true },
);

const canPrint = computed(
  () =>
    data.value !== null &&
    data.value.packages.length > 0 &&
    data.value.packages.every((pkg) => qrImages.value[pkg.token] !== undefined),
);

async function printLabels(): Promise<void> {
  if (!canPrint.value || printing.value) return;
  printing.value = true;
  error.value = '';
  try {
    data.value = structuredClone(await props.markPrinted());
    await rebuildQrImages();
    await nextTick();
    window.print();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '인쇄 준비에 실패했습니다.';
  } finally {
    printing.value = false;
  }
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close');
};

watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

// 인쇄 격리 — 열려 있는 동안만 문서에 둔다(상주하면 같은 화면의 다른 인쇄를 백지로
// 만든다: body > :not(.sp-pcb-label-host) 가 남의 호스트까지 지운다). lib/usePrintIsolation 참조.
const PRINT_CSS = `
@media print {
  body > :not(.sp-pcb-label-host) {
    display: none !important;
  }

  .sp-pcb-label-host,
  .sp-pcb-label-scroll {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    background: none !important;
    display: block !important;
  }

  .sp-pcb-label-host .no-print {
    display: none !important;
  }

  .pcb-label-print {
    display: block !important;
  }

  .sp-pcb-label-sheet {
    box-shadow: none !important;
    margin: 0 !important;
  }

  .sp-pcb-label {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @page {
    size: A4 portrait;
    margin: 8mm;
  }
}
`;
usePrintIsolation('sp-pcb-label-print-style', PRINT_CSS, () => props.open);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sp-pcb-label-host fixed inset-0 z-[70] bg-black/45">
      <div
        class="sp-pcb-label-scroll flex h-full flex-col items-center overflow-auto p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <div
          class="no-print mb-3 flex w-full max-w-5xl flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-xl"
        >
          <div class="mr-auto">
            <h2 class="text-sm font-extrabold text-gray-900">PCB QR 라벨</h2>
            <p v-if="data !== null" class="text-[11px] text-gray-500">
              {{ data.labelNo }} · SH-{{ data.shipmentId }} · {{ data.totalLabels }}장
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
            :disabled="!canPrint || printing"
            @click="void printLabels()"
          >
            {{ printing ? '인쇄 준비 중…' : 'QR 라벨 인쇄' }}
          </button>
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="emit('close')"
          >
            닫기
          </button>
          <p v-if="error !== ''" class="basis-full text-xs font-semibold text-red-600">
            {{ error }}
          </p>
        </div>

        <p
          v-if="loading"
          class="no-print w-full max-w-5xl rounded-xl bg-white px-5 py-16 text-center text-sm text-gray-400"
        >
          QR 라벨을 준비하는 중…
        </p>

        <section v-else-if="data !== null" class="pcb-label-print w-[794px] max-w-full">
          <div class="sp-pcb-label-sheet min-h-[1123px] bg-white p-8 shadow-2xl">
            <header class="mb-5 border-b-2 border-gray-900 pb-3">
              <div class="flex items-end justify-between gap-4">
                <div>
                  <h2 class="text-xl font-black">PCB CASE QR LABELS</h2>
                  <p class="mt-1 text-[10px] text-gray-500">
                    {{ data.labelNo }} · {{ data.senderName }} → {{ data.receiverName }}
                  </p>
                </div>
                <div class="text-right text-[9px] leading-4 text-gray-500">
                  <p>{{ BOM_SHIPMENT_MODE_LABELS[data.mode] }}</p>
                  <p>{{ bomShipmentStatusLabel(data.mode, data.shipmentStatus) }}</p>
                  <p v-if="data.shipDate !== null">출고예정 {{ fmtKstDate(data.shipDate) }}</p>
                </div>
              </div>
              <p class="mt-2 text-[9px] leading-4 text-gray-500">
                박스 안 각 PCB 주문/견적 건에 맞는 라벨을 부착하세요. 고객명·연락처·가격은
                라벨에 표시되지 않습니다.
              </p>
            </header>

            <div class="grid grid-cols-2 gap-3">
              <article
                v-for="pkg in data.packages"
                :key="pkg.packageId"
                class="sp-pcb-label flex min-h-48 gap-3 border-2 border-gray-900 p-3 text-gray-900"
              >
                <div class="w-[112px] shrink-0 text-center">
                  <img
                    v-if="qrImages[pkg.token] !== undefined"
                    :src="qrImages[pkg.token]"
                    alt="PCB QR"
                    class="mx-auto h-28 w-28"
                  >
                  <p class="mt-1 break-all font-mono text-[8px] font-black">
                    {{ pkg.labelCode }}
                  </p>
                </div>
                <div class="min-w-0 flex-1 text-[9px] leading-5">
                  <p class="font-mono text-[12px] font-black">PO-{{ pkg.poId }}</p>
                  <p class="font-mono text-[9px] text-gray-500">Q{{ pkg.specId }}</p>
                  <p class="mt-1 line-clamp-2 text-[12px] font-extrabold leading-4">
                    {{ pkg.projectName }}
                  </p>
                  <p class="mt-2"><b>QTY</b> {{ pkg.qty.toLocaleString('ko-KR') }} PCS</p>
                  <p v-if="pkg.reorderRound > 0"><b>A/S</b> {{ pkg.reorderRound }}차</p>
                  <p><b>SHIPMENT</b> SH-{{ data.shipmentId }}</p>
                  <p v-if="data.trackingNumber !== null" class="truncate">
                    <b>TRACKING</b> {{ data.carrier ?? '' }} {{ data.trackingNumber }}
                  </p>
                  <p><b>STATUS</b> {{ PCB_PACKAGE_STATUS_LABELS[pkg.status] }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>
