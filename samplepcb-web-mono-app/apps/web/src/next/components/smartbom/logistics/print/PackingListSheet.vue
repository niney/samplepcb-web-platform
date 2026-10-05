<script setup lang="ts">
import { computed } from 'vue';
import {
  BOM_PART_PACKAGE_STATUS_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type BomShipmentPackingListType,
  type BomShipmentPackingPackageType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// 선적 리스트(Packing List) + 부품 QR 라벨 인쇄 문서 — 옛 components/smartbom/ShipmentPackingModal 의
// 인쇄 부분과 내용·배치가 같다(협력사 포털은 옛 것을 쓴다). 화면이 아니라 종이라 디자인 토큰을 쓰지 않는다:
//   · 색: 테마를 따라가면 다크 모드에서 흰 종이에 밝은 글자가 찍힌다(옛 gray-* 는 다크 팔레트 반전으로 실제
//     그렇게 된다). 그래서 테마와 무관한 black(투명도)/white 로 고정한다.
//   · 크기: 시트는 A4(794×1123px @96dpi), 글자는 서류 실측 크기(7~11px)라 디자인 스케일 밖이다.
const props = defineProps<{
  data: BomShipmentPackingListType;
  /** 포장 token → QR 이미지 data URL. 없으면 그 칸은 비워 둔다(인쇄 버튼이 잠긴다). */
  qrImages: Readonly<Record<string, string>>;
}>();

const packageKey = (pkg: BomShipmentPackingPackageType): string => pkg.token ?? `draft-${String(pkg.packageNo)}`;
const n = (value: number): string => value.toLocaleString('ko-KR');
const allPackages = computed(() =>
  props.data.items.flatMap((item) => item.packages.map((pkg) => ({ item, pkg }))),
);
</script>

<template>
  <section data-packing-print class="w-[794px] max-w-full">
    <div data-packing-sheet class="min-h-[1123px] bg-white p-8 text-[11px] text-black shadow-2xl">
      <header class="border-b-2 border-black pb-4 text-center">
        <h1 class="text-2xl font-black tracking-[0.18em]">PACKING LIST</h1>
        <p class="mt-1 text-xs font-semibold text-black/60">부품 식별·입고 리스트</p>
      </header>
      <div class="mt-4 grid grid-cols-2 border border-black/50">
        <div class="border-r border-black/50 p-3">
          <p class="text-[9px] font-bold text-black/60">SHIPPER / PARTNER</p>
          <p class="mt-1 text-sm font-bold">{{ data.partnerName }}</p>
        </div>
        <div class="p-3">
          <p class="text-[9px] font-bold text-black/60">CONSIGNEE</p>
          <p class="mt-1 text-sm font-bold">{{ data.consigneeCompany }}</p>
          <p class="mt-1 text-[10px] text-black/70">{{ data.consigneeAddress }}</p>
        </div>
      </div>
      <div class="grid grid-cols-4 border-x border-b border-black/50">
        <div class="border-r border-black/30 p-2"><b>PACKING NO.</b><br>{{ data.packingNo }}</div>
        <div class="border-r border-black/30 p-2"><b>REVISION</b><br>{{ data.revision }}</div>
        <div class="border-r border-black/30 p-2"><b>MODE</b><br>{{ BOM_SHIPMENT_MODE_LABELS[data.mode] }}</div>
        <div class="p-2"><b>SHIP DATE</b><br>{{ data.shipDate ?? '—' }}</div>
      </div>

      <table class="mt-5 w-full border-collapse text-[9px]">
        <thead>
          <tr class="bg-black/5">
            <th class="border border-black/50 p-1.5">NO.</th>
            <th class="border border-black/50 p-1.5 text-left">PART / MPN</th>
            <th class="border border-black/50 p-1.5 text-left">MANUFACTURER</th>
            <th class="border border-black/50 p-1.5">PO / CASE</th>
            <th class="border border-black/50 p-1.5">QTY</th>
            <th class="border border-black/50 p-1.5">LOT / DATE</th>
            <th class="w-24 border border-black/50 p-1.5">QR</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in data.items" :key="item.poItemId">
            <tr v-for="pkg in item.packages" :key="packageKey(pkg)">
              <td class="border border-black/30 p-1.5 text-center">{{ pkg.packageNo }}</td>
              <td class="border border-black/30 p-1.5">
                <b class="font-mono text-[10px]">{{ item.mpn }}</b>
                <div class="mt-0.5 text-[8px] text-black/60">{{ item.description ?? '' }}</div>
              </td>
              <td class="border border-black/30 p-1.5">{{ item.manufacturerName ?? '—' }}</td>
              <td class="border border-black/30 p-1.5 text-center">#{{ item.poId }}<br>{{ item.quoteTitle }}</td>
              <td class="border border-black/30 p-1.5 text-right font-bold">{{ n(pkg.quantity) }}</td>
              <td class="border border-black/30 p-1.5 text-center">{{ pkg.lotNo ?? '—' }}<br>{{ pkg.dateCode ?? '—' }}</td>
              <td class="border border-black/30 p-1 text-center">
                <img
                  v-if="pkg.token !== null && qrImages[pkg.token] !== undefined"
                  :src="qrImages[pkg.token]"
                  alt="QR"
                  class="mx-auto h-16 w-16"
                >
                <div class="mt-0.5 font-mono text-[7px] font-bold break-all">{{ pkg.labelCode ?? 'SAVE REQUIRED' }}</div>
                <div class="mt-0.5 text-[7px] font-bold">{{ BOM_PART_PACKAGE_STATUS_LABELS[pkg.status] }}</div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div class="mt-4 flex justify-between border-t border-black/30 pt-3 text-[9px] text-black/60">
        <span>
          ITEMS {{ n(data.totalItems) }} · PACKAGES {{ n(data.totalPackages) }} · TOTAL QTY {{ n(data.totalQuantity) }}
        </span>
        <span>{{ bomShipmentStatusLabel(data.mode, data.shipmentStatus) }} · updated {{ fmtKstDate(data.updatedAt) }}</span>
      </div>
      <p class="mt-3 text-[8px] leading-4 text-black/60">
        QR은 포장 식별용이며 내용물 진위를 보증하지 않습니다. 입고 시 제조사 라벨·수량·LOT/DATE CODE를 함께 검수해 주세요.
      </p>
    </div>

    <div data-packing-sheet data-packing-labels class="min-h-[1123px] bg-white p-8 text-black shadow-2xl">
      <header class="mb-4 border-b border-black pb-2">
        <h2 class="text-lg font-black">QR PACKAGE LABELS</h2>
        <p class="text-[10px] text-black/60">
          {{ data.packingNo }} · revision {{ data.revision }} · 라벨을 해당 릴·트레이·튜브·봉투·박스에 부착하세요.
        </p>
      </header>
      <div class="grid grid-cols-3 gap-2">
        <article
          v-for="entry in allPackages"
          :key="`${entry.item.poItemId}-${packageKey(entry.pkg)}`"
          data-packing-label
          class="flex min-h-40 gap-2 border-2 border-black/85 p-2"
        >
          <div class="w-[84px] shrink-0 text-center">
            <img
              v-if="entry.pkg.token !== null && qrImages[entry.pkg.token] !== undefined"
              :src="qrImages[entry.pkg.token]"
              alt="QR"
              class="mx-auto h-20 w-20"
            >
            <p class="mt-0.5 font-mono text-[7px] font-black break-all">{{ entry.pkg.labelCode ?? 'SAVE REQUIRED' }}</p>
          </div>
          <div class="min-w-0 flex-1 text-[8px] leading-4">
            <p class="truncate font-mono text-[11px] font-black" :title="entry.item.mpn">{{ entry.item.mpn }}</p>
            <p class="truncate font-semibold">{{ entry.item.manufacturerName ?? '제조사 미상' }}</p>
            <p class="mt-1"><b>QTY</b> {{ n(entry.pkg.quantity) }}</p>
            <p><b>LOT</b> {{ entry.pkg.lotNo ?? '—' }}</p>
            <p><b>DATE</b> {{ entry.pkg.dateCode ?? '—' }}</p>
            <p><b>PO</b> #{{ entry.item.poId }}</p>
            <p class="truncate"><b>CASE</b> {{ entry.item.quoteTitle }}</p>
            <p><b>STATUS</b> {{ BOM_PART_PACKAGE_STATUS_LABELS[entry.pkg.status] }}</p>
            <p class="mt-1 text-[7px] text-black/60">{{ data.packingNo }} / #{{ entry.pkg.packageNo }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
