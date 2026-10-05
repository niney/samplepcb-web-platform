<script setup lang="ts">
import {
  BOM_SHIPMENT_MODE_LABELS,
  PCB_PACKAGE_STATUS_LABELS,
  bomShipmentStatusLabel,
  type PcbShipmentPackageListType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// PCB Case QR 라벨 인쇄 문서 — 화면이 아니라 종이에 붙는 물건이라 디자인 토큰을 쓰지 않는다.
//   · 색: 테마를 따라가면 다크 모드에서 흰 종이에 밝은 글자가 찍힌다(옛 라벨의 gray-900 은
//     다크 팔레트 반전으로 실제 그렇게 된다). 그래서 테마와 무관한 black/white 로 고정한다.
//   · 크기: 시트는 A4(794×1123px @96dpi), 글자는 라벨 실측 크기(8·9·10px)라 디자인 스케일 밖이다.
// 옛 components/pcb/PcbPackageLabelsModal 의 인쇄 부분과 내용·배치가 같다(협력사 포털은 옛 것을 쓴다).
// 고객명·연락처·가격은 라벨에 싣지 않는다 — 서버가 안전한 표시 정보만 내려준다.
defineProps<{
  data: PcbShipmentPackageListType;
  /** 라벨 token → QR 이미지 data URL. 없으면 그 칸은 비워 둔다(인쇄 버튼이 잠긴다). */
  qrImages: Readonly<Record<string, string>>;
}>();
</script>

<template>
  <section data-pcb-label-print class="w-[794px] max-w-full">
    <div data-pcb-label-sheet class="min-h-[1123px] bg-white p-8 text-black shadow-2xl">
      <header class="mb-5 border-b-2 border-black pb-3">
        <div class="flex items-end justify-between gap-4">
          <div>
            <h2 class="text-xl font-black">PCB CASE QR LABELS</h2>
            <p class="mt-1 text-[10px] text-black/60">
              {{ data.labelNo }} · {{ data.senderName }} → {{ data.receiverName }}
            </p>
          </div>
          <div class="text-right text-[9px] leading-4 text-black/60">
            <p>{{ BOM_SHIPMENT_MODE_LABELS[data.mode] }}</p>
            <p>{{ bomShipmentStatusLabel(data.mode, data.shipmentStatus) }}</p>
            <p v-if="data.shipDate !== null">출고예정 {{ fmtKstDate(data.shipDate) }}</p>
          </div>
        </div>
        <p class="mt-2 text-[9px] leading-4 text-black/60">
          박스 안 각 PCB 주문/견적 건에 맞는 라벨을 부착하세요. 고객명·연락처·가격은 라벨에 표시되지 않습니다.
        </p>
      </header>

      <div class="grid grid-cols-2 gap-3">
        <article
          v-for="pkg in data.packages"
          :key="pkg.packageId"
          data-pcb-label
          class="flex min-h-48 gap-3 border-2 border-black p-3"
        >
          <div class="w-28 shrink-0 text-center">
            <img
              v-if="qrImages[pkg.token] !== undefined"
              :src="qrImages[pkg.token]"
              alt="PCB QR"
              class="mx-auto size-28"
            >
            <p class="mt-1 font-mono text-[8px] font-black break-all">{{ pkg.labelCode }}</p>
          </div>
          <div class="min-w-0 flex-1 text-[9px] leading-5">
            <!-- text-xs 는 줄높이(16px)를 같이 바꾼다 — 옛 라벨(12px 글자 + 부모 leading-5)과 같게 되돌린다 -->
            <p class="font-mono text-xs leading-5 font-black">PO-{{ pkg.poId }}</p>
            <p class="font-mono text-[9px] text-black/60">Q{{ pkg.specId }}</p>
            <p class="mt-1 line-clamp-2 text-xs leading-4 font-extrabold">{{ pkg.projectName }}</p>
            <p class="mt-2"><b>QTY</b> {{ pkg.qty.toLocaleString('ko-KR') }} PCS</p>
            <p v-if="pkg.reorderRound > 0"><b>A/S</b>{{ pkg.reorderRound }}차</p>
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
</template>
