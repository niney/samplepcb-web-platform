<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toDataURL } from 'qrcode';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PART_PACKAGE_STATUS_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type BomShipmentPackingItemType,
  type BomShipmentPackingListSaveBodyType,
  type BomShipmentPackingListType,
  type BomShipmentPackingPackageType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// 선적 리스트·QR 라벨(D24) — 파트너/관리자 공용. 상업송장과 분리된 Packing List이며
// 릴·트레이·튜브·봉투·박스 같은 실물 관리 단위마다 QR 1개를 생성한다. 저장된 token은
// 재인쇄해도 바뀌지 않고 관리자 스캔 화면으로 연결된다.

const props = defineProps<{
  open: boolean;
  load: () => Promise<BomShipmentPackingListType>;
  save: (body: BomShipmentPackingListSaveBodyType) => Promise<BomShipmentPackingListType>;
  markPrinted: () => Promise<BomShipmentPackingListType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomShipmentPackingListType | null>(null);
const loading = ref(false);
const busy = ref<'' | 'save' | 'print'>('');
const error = ref('');
const view = ref<'edit' | 'preview'>('edit');
const qrImages = ref<Record<string, string>>({});
const qrLoading = ref(false);

const packageKey = (pkg: BomShipmentPackingPackageType): string =>
  pkg.token ?? `draft-${String(pkg.packageNo)}`;

const qrTarget = (token: string): string =>
  new URL(
    `/app/admin/smartbom/packages/${encodeURIComponent(token)}`,
    window.location.origin,
  ).toString();

async function rebuildQrImages(): Promise<void> {
  const current = data.value;
  if (current === null) {
    qrImages.value = {};
    return;
  }
  qrLoading.value = true;
  try {
    const entries = await Promise.all(
      current.items.flatMap((item) =>
        item.packages.flatMap((pkg) =>
          pkg.token === null
            ? []
            : [
                toDataURL(qrTarget(pkg.token), {
                  errorCorrectionLevel: 'M',
                  margin: 1,
                  width: 240,
                }).then((url) => [pkg.token ?? '', url] as const),
              ],
        ),
      ),
    );
    qrImages.value = Object.fromEntries(entries);
  } finally {
    qrLoading.value = false;
  }
}

async function loadPacking(): Promise<void> {
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const loaded = await props.load();
    data.value = structuredClone(loaded);
    view.value = loaded.editable ? 'edit' : 'preview';
    await rebuildQrImages();
  } catch (cause) {
    error.value =
      cause instanceof ApiRequestError ? cause.message : '선적 리스트를 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadPacking();
  },
  { immediate: true },
);

const packageQuantity = (pkg: BomShipmentPackingPackageType): number => {
  const value: unknown = pkg.quantity;
  return typeof value === 'number' ? value : Number.NaN;
};

const itemPackedQty = (item: BomShipmentPackingItemType): number =>
  item.packages.reduce((sum, pkg) => sum + packageQuantity(pkg), 0);

function addPackage(item: BomShipmentPackingItemType): void {
  if (!data.value?.editable || item.packages.length >= 20) return;
  const donor = [...item.packages].reverse().find((pkg) => pkg.quantity > 1);
  if (donor === undefined) {
    error.value = '더 나눌 수량이 없습니다.';
    return;
  }
  donor.quantity -= 1;
  item.packages.push({
    packageId: null,
    token: null,
    labelCode: null,
    packageNo: item.packages.length + 1,
    quantity: 1,
    lotNo: null,
    dateCode: null,
    status: 'prepared',
    storageLocation: null,
    receivedAt: null,
    inspectedAt: null,
    issuedAt: null,
    events: [],
  });
  error.value = '';
}

function removePackage(item: BomShipmentPackingItemType, index: number): void {
  if (!data.value?.editable || item.packages.length <= 1) return;
  const removed = item.packages[index];
  if (removed === undefined) return;
  const target = item.packages.find((_pkg, candidateIndex) => candidateIndex !== index);
  if (target === undefined) return;
  target.quantity += removed.quantity;
  item.packages.splice(index, 1);
  item.packages.forEach((pkg, packageIndex) => {
    pkg.packageNo = packageIndex + 1;
  });
  error.value = '';
}

const allQuantitiesValid = computed(
  () =>
    data.value?.items.every(
      (item) =>
        item.packages.every((pkg) => {
          const quantity = packageQuantity(pkg);
          return Number.isInteger(quantity) && quantity > 0;
        }) && itemPackedQty(item) === item.expectedQty,
    ) ?? false,
);

const allPackages = computed(() =>
  (data.value?.items ?? []).flatMap((item) => item.packages.map((pkg) => ({ item, pkg }))),
);

const canPrint = computed(
  () =>
    data.value !== null &&
    data.value.revision > 0 &&
    !qrLoading.value &&
    allPackages.value.length > 0 &&
    allPackages.value.every(
      ({ pkg }) => pkg.token !== null && qrImages.value[pkg.token] !== undefined,
    ),
);

function saveBody(): BomShipmentPackingListSaveBodyType {
  const current = data.value;
  if (current === null) return { items: [] };
  return {
    items: current.items.map((item) => ({
      poItemId: item.poItemId,
      packages: item.packages.map((pkg) => ({
        packageId: pkg.packageId,
        quantity: pkg.quantity,
        lotNo: pkg.lotNo === null || pkg.lotNo.trim() === '' ? null : pkg.lotNo.trim(),
        dateCode: pkg.dateCode === null || pkg.dateCode.trim() === '' ? null : pkg.dateCode.trim(),
      })),
    })),
  };
}

async function savePacking(): Promise<void> {
  if (busy.value !== '' || data.value?.editable !== true) return;
  if (!allQuantitiesValid.value) {
    error.value = '각 품목의 포장 수량 합계가 발주 수량과 같아야 합니다.';
    return;
  }
  busy.value = 'save';
  error.value = '';
  try {
    data.value = structuredClone(await props.save(saveBody()));
    await rebuildQrImages();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'QR 저장에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}

async function printDocument(): Promise<void> {
  if (busy.value !== '' || !canPrint.value) return;
  busy.value = 'print';
  error.value = '';
  try {
    data.value = structuredClone(await props.markPrinted());
    await rebuildQrImages();
    await nextTick();
    window.print();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '인쇄 준비에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}

const fmtDate = fmtKstDate;

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
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="sp-packing-host fixed inset-0 z-[70] bg-black/45">
      <div
        class="sp-packing-scroll flex h-full flex-col items-center overflow-auto p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <div
          class="no-print mb-3 flex w-full max-w-6xl flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-xl"
        >
          <div class="mr-auto">
            <h2 class="text-sm font-extrabold text-gray-900">선적 리스트·부품 QR 라벨</h2>
            <p v-if="data !== null" class="text-[11px] text-gray-500">
              {{ data.packingNo }} · revision {{ data.revision }} · 실물 포장
              {{ data.totalPackages }}개
            </p>
          </div>
          <button
            type="button"
            class="rounded-md border px-3 py-1.5 text-xs font-semibold"
            :class="
              view === 'edit'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 text-gray-600'
            "
            :disabled="data === null"
            @click="view = 'edit'"
          >
            포장 편집
          </button>
          <button
            type="button"
            class="rounded-md border px-3 py-1.5 text-xs font-semibold"
            :class="
              view === 'preview'
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-300 text-gray-600'
            "
            :disabled="data === null"
            @click="view = 'preview'"
          >
            인쇄 미리보기
          </button>
          <button
            v-if="data?.editable"
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            :disabled="busy !== '' || !allQuantitiesValid"
            @click="savePacking"
          >
            {{ busy === 'save' ? '저장 중…' : '저장·QR 생성' }}
          </button>
          <button
            type="button"
            class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
            :disabled="busy !== '' || !canPrint"
            @click="printDocument"
          >
            {{ busy === 'print' ? '인쇄 준비 중…' : 'Packing List·라벨 인쇄' }}
          </button>
          <button
            type="button"
            class="px-2 text-gray-400 hover:text-gray-700"
            @click="emit('close')"
          >
            ✕
          </button>
        </div>

        <p v-if="loading" class="no-print py-20 text-sm font-semibold text-white">불러오는 중…</p>
        <p
          v-else-if="error !== ''"
          class="no-print mb-3 w-full max-w-6xl rounded-lg bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
        >
          {{ error }}
        </p>

        <section
          v-if="data !== null && view === 'edit'"
          class="packing-editor no-print w-full max-w-6xl space-y-3 rounded-2xl bg-white p-4 shadow-2xl"
        >
          <div class="rounded-xl bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900">
            QR 1개는 부품 한 알이 아니라 <b>릴·트레이·튜브·봉투·박스 같은 실물 포장 1개</b>를
            뜻합니다. 포장 수량 합계는 발주 수량과 같아야 하며, 저장 후 재인쇄해도 같은 QR을
            사용합니다.
          </div>
          <p
            v-if="!data.editable"
            class="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700"
          >
            발송이 진행되어 편집할 수 없습니다. 기존 문서와 QR은 그대로 재인쇄할 수 있습니다.
          </p>

          <article
            v-for="item in data.items"
            :key="item.poItemId"
            class="rounded-xl border border-gray-200 p-3"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="font-mono text-sm font-extrabold text-gray-900">{{ item.mpn }}</p>
                <p class="text-xs text-gray-500">
                  {{ item.manufacturerName ?? '제조사 미상' }} · PO #{{ item.poId }} ·
                  {{ item.quoteTitle }}
                </p>
                <p v-if="item.partId !== null" class="mt-0.5 text-[10px] text-gray-400">
                  카탈로그 partId {{ item.partId }}
                </p>
              </div>
              <p
                class="rounded px-2 py-1 text-xs font-bold"
                :class="
                  itemPackedQty(item) === item.expectedQty
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-red-50 text-red-700'
                "
              >
                포장 {{ itemPackedQty(item).toLocaleString('ko-KR') }} / 발주
                {{ item.expectedQty.toLocaleString('ko-KR') }}
              </p>
            </div>

            <div class="mt-3 overflow-x-auto">
              <table class="min-w-full text-xs">
                <thead class="bg-gray-50 text-left text-gray-500">
                  <tr>
                    <th class="w-12 px-2 py-1.5">포장</th>
                    <th class="w-32 px-2 py-1.5">수량</th>
                    <th class="px-2 py-1.5">LOT NO.</th>
                    <th class="px-2 py-1.5">DATE CODE</th>
                    <th class="px-2 py-1.5">QR 코드</th>
                    <th class="w-20 px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  <tr v-for="(pkg, index) in item.packages" :key="packageKey(pkg)">
                    <td class="px-2 py-2 font-bold">#{{ index + 1 }}</td>
                    <td class="px-2 py-2">
                      <input
                        v-model.number="pkg.quantity"
                        type="number"
                        min="1"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        class="h-8 w-28 rounded border border-gray-300 px-2 text-right tabular-nums"
                      >
                    </td>
                    <td class="px-2 py-2">
                      <input
                        v-model="pkg.lotNo"
                        type="text"
                        maxlength="100"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        class="h-8 w-full min-w-28 rounded border border-gray-300 px-2"
                      >
                    </td>
                    <td class="px-2 py-2">
                      <input
                        v-model="pkg.dateCode"
                        type="text"
                        maxlength="100"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        class="h-8 w-full min-w-24 rounded border border-gray-300 px-2"
                      >
                    </td>
                    <td class="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-gray-500">
                      {{ pkg.labelCode ?? '저장 후 생성' }}
                      <span
                        v-if="pkg.packageId !== null"
                        class="ml-1 rounded bg-gray-100 px-1 py-0.5 font-sans text-[10px]"
                      >
                        {{ BOM_PART_PACKAGE_STATUS_LABELS[pkg.status] }}
                      </span>
                    </td>
                    <td class="px-2 py-2 text-right">
                      <button
                        type="button"
                        class="text-[11px] font-semibold text-red-500 hover:underline disabled:opacity-30"
                        :disabled="
                          !data.editable || item.packages.length <= 1 || pkg.status !== 'prepared'
                        "
                        @click="removePackage(item, index)"
                      >
                        제거
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button
              type="button"
              class="mt-2 text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-30"
              :disabled="!data.editable || item.packages.length >= 20"
              @click="addPackage(item)"
            >
              + 실물 포장 나누기
            </button>
          </article>
        </section>

        <!-- 화면 미리보기이자 실제 인쇄 대상: 1부 Packing List + 후속 QR 라벨 시트 -->
        <section
          v-if="data !== null"
          class="packing-print w-[794px] max-w-full"
          :class="view === 'preview' ? 'block' : 'hidden'"
        >
          <div
            class="sp-packing-sheet min-h-[1123px] bg-white p-8 text-[11px] text-gray-900 shadow-2xl"
          >
            <header class="border-b-2 border-gray-900 pb-4 text-center">
              <h1 class="text-2xl font-black tracking-[0.18em]">PACKING LIST</h1>
              <p class="mt-1 text-xs font-semibold text-gray-500">부품 식별·입고 리스트</p>
            </header>
            <div class="mt-4 grid grid-cols-2 border border-gray-400">
              <div class="border-r border-gray-400 p-3">
                <p class="text-[9px] font-bold text-gray-500">SHIPPER / PARTNER</p>
                <p class="mt-1 text-sm font-bold">{{ data.partnerName }}</p>
              </div>
              <div class="p-3">
                <p class="text-[9px] font-bold text-gray-500">CONSIGNEE</p>
                <p class="mt-1 text-sm font-bold">{{ data.consigneeCompany }}</p>
                <p class="mt-1 text-[10px] text-gray-600">{{ data.consigneeAddress }}</p>
              </div>
            </div>
            <div class="grid grid-cols-4 border-x border-b border-gray-400">
              <div class="border-r border-gray-300 p-2">
                <b>PACKING NO.</b><br>{{ data.packingNo }}
              </div>
              <div class="border-r border-gray-300 p-2">
                <b>REVISION</b><br>{{ data.revision }}
              </div>
              <div class="border-r border-gray-300 p-2">
                <b>MODE</b><br>{{ BOM_SHIPMENT_MODE_LABELS[data.mode] }}
              </div>
              <div class="p-2"><b>SHIP DATE</b><br>{{ data.shipDate ?? '—' }}</div>
            </div>

            <table class="mt-5 w-full border-collapse text-[9px]">
              <thead>
                <tr class="bg-gray-100">
                  <th class="border border-gray-400 p-1.5">NO.</th>
                  <th class="border border-gray-400 p-1.5 text-left">PART / MPN</th>
                  <th class="border border-gray-400 p-1.5 text-left">MANUFACTURER</th>
                  <th class="border border-gray-400 p-1.5">PO / CASE</th>
                  <th class="border border-gray-400 p-1.5">QTY</th>
                  <th class="border border-gray-400 p-1.5">LOT / DATE</th>
                  <th class="w-24 border border-gray-400 p-1.5">QR</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="item in data.items" :key="item.poItemId">
                  <tr v-for="pkg in item.packages" :key="packageKey(pkg)">
                    <td class="border border-gray-300 p-1.5 text-center">{{ pkg.packageNo }}</td>
                    <td class="border border-gray-300 p-1.5">
                      <b class="font-mono text-[10px]">{{ item.mpn }}</b>
                      <div class="mt-0.5 text-[8px] text-gray-500">
                        {{ item.description ?? '' }}
                      </div>
                    </td>
                    <td class="border border-gray-300 p-1.5">{{ item.manufacturerName ?? '—' }}</td>
                    <td class="border border-gray-300 p-1.5 text-center">
                      #{{ item.poId }}<br>{{ item.quoteTitle }}
                    </td>
                    <td class="border border-gray-300 p-1.5 text-right font-bold">
                      {{ pkg.quantity.toLocaleString('ko-KR') }}
                    </td>
                    <td class="border border-gray-300 p-1.5 text-center">
                      {{ pkg.lotNo ?? '—' }}<br>{{ pkg.dateCode ?? '—' }}
                    </td>
                    <td class="border border-gray-300 p-1 text-center">
                      <img
                        v-if="pkg.token !== null && qrImages[pkg.token] !== undefined"
                        :src="qrImages[pkg.token]"
                        alt="QR"
                        class="mx-auto h-16 w-16"
                      >
                      <div class="mt-0.5 break-all font-mono text-[7px] font-bold">
                        {{ pkg.labelCode ?? 'SAVE REQUIRED' }}
                      </div>
                      <div class="mt-0.5 text-[7px] font-bold">
                        {{ BOM_PART_PACKAGE_STATUS_LABELS[pkg.status] }}
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <div
              class="mt-4 flex justify-between border-t border-gray-300 pt-3 text-[9px] text-gray-500"
            >
              <span>ITEMS {{ data.totalItems }} · PACKAGES {{ data.totalPackages }} · TOTAL QTY
                {{ data.totalQuantity.toLocaleString('ko-KR') }}</span>
              <span>{{ bomShipmentStatusLabel(data.mode, data.shipmentStatus) }} · updated
                {{ fmtDate(data.updatedAt) }}</span>
            </div>
            <p class="mt-3 text-[8px] leading-4 text-gray-500">
              QR은 포장 식별용이며 내용물 진위를 보증하지 않습니다. 입고 시 제조사
              라벨·수량·LOT/DATE CODE를 함께 검수해 주세요.
            </p>
          </div>

          <div class="sp-packing-sheet sp-packing-labels min-h-[1123px] bg-white p-8 shadow-2xl">
            <header class="mb-4 border-b border-gray-900 pb-2">
              <h2 class="text-lg font-black">QR PACKAGE LABELS</h2>
              <p class="text-[10px] text-gray-500">
                {{ data.packingNo }} · revision {{ data.revision }} · 라벨을 해당
                릴·트레이·튜브·봉투·박스에 부착하세요.
              </p>
            </header>
            <div class="grid grid-cols-3 gap-2">
              <article
                v-for="entry in allPackages"
                :key="`${entry.item.poItemId}-${packageKey(entry.pkg)}`"
                class="sp-packing-label flex min-h-40 gap-2 border-2 border-gray-800 p-2 text-gray-900"
              >
                <div class="w-[84px] shrink-0 text-center">
                  <img
                    v-if="entry.pkg.token !== null && qrImages[entry.pkg.token] !== undefined"
                    :src="qrImages[entry.pkg.token]"
                    alt="QR"
                    class="mx-auto h-20 w-20"
                  >
                  <p class="mt-0.5 break-all font-mono text-[7px] font-black">
                    {{ entry.pkg.labelCode ?? 'SAVE REQUIRED' }}
                  </p>
                </div>
                <div class="min-w-0 flex-1 text-[8px] leading-4">
                  <p class="truncate font-mono text-[11px] font-black" :title="entry.item.mpn">
                    {{ entry.item.mpn }}
                  </p>
                  <p class="truncate font-semibold">
                    {{ entry.item.manufacturerName ?? '제조사 미상' }}
                  </p>
                  <p class="mt-1"><b>QTY</b> {{ entry.pkg.quantity.toLocaleString('ko-KR') }}</p>
                  <p><b>LOT</b> {{ entry.pkg.lotNo ?? '—' }}</p>
                  <p><b>DATE</b> {{ entry.pkg.dateCode ?? '—' }}</p>
                  <p><b>PO</b> #{{ entry.item.poId }}</p>
                  <p class="truncate"><b>CASE</b> {{ entry.item.quoteTitle }}</p>
                  <p><b>STATUS</b> {{ BOM_PART_PACKAGE_STATUS_LABELS[entry.pkg.status] }}</p>
                  <p class="mt-1 text-[7px] text-gray-500">
                    {{ data.packingNo }} / #{{ entry.pkg.packageNo }}
                  </p>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>

<style>
@media print {
  body > :not(.sp-packing-host) {
    display: none !important;
  }

  .sp-packing-host {
    position: static !important;
    overflow: visible !important;
    background: none !important;
    display: block !important;
  }

  .sp-packing-scroll {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }

  .sp-packing-host .no-print,
  .sp-packing-host .packing-editor {
    display: none !important;
  }

  .sp-packing-host .packing-print {
    display: block !important;
  }

  .sp-packing-sheet {
    box-shadow: none !important;
    margin: 0 !important;
  }

  .sp-packing-labels {
    break-before: page;
    page-break-before: always;
  }

  .sp-packing-label {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @page {
    size: A4 portrait;
    margin: 8mm;
  }
}
</style>
