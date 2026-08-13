<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  PCB_PACKAGE_EVENT_LABELS,
  PCB_PACKAGE_STATUS_LABELS,
  bomShipmentStatusLabel,
} from '@sp/api-contract';
import { useAdminPcbPackage } from '../../admin/useAdminPcbPos';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';

// PCB QR 스캔 도착점. token은 식별자일 뿐이며 라우트와 API 모두 관리자 인증 뒤에 있다.
// 개별 QR에서 입고 상태를 따로 바꾸지 않는다 — PCB는 박스 선적 입고가 정본이고 서버가
// 그 사건을 현재 구성원 QR 전체에 동기화한다.

const route = useRoute();
const code = computed(() => {
  const raw = route.params.code;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
});
const query = useAdminPcbPackage(code);
const detail = computed(() => query.data.value?.data ?? null);

const loadError = computed(() => {
  const cause = query.error.value;
  if (cause === null) return '';
  return cause instanceof ApiRequestError ? cause.message : 'PCB QR을 조회하지 못했습니다.';
});

const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { hour12: false });
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5">
    <div class="flex flex-wrap items-center gap-2">
      <div>
        <p class="text-xs font-semibold text-teal-700">PCB QR 추적</p>
        <h1 class="text-xl font-extrabold">PCB 주문/견적 건 조회</h1>
      </div>
      <RouterLink
        :to="{ name: 'admin-pcb-shipments' }"
        class="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >
        ← PCB 선적·배송
      </RouterLink>
    </div>

    <p
      v-if="query.isFetching.value"
      class="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-400"
    >
      PCB QR을 조회하는 중…
    </p>
    <p
      v-else-if="loadError !== ''"
      class="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center text-sm font-semibold text-red-700"
    >
      {{ loadError }}
    </p>

    <template v-else-if="detail !== null">
      <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div class="flex flex-wrap items-start gap-3 border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div>
            <p class="font-mono text-xs font-bold text-gray-500">{{ detail.labelCode }}</p>
            <h2 class="mt-1 text-xl font-black text-gray-950">{{ detail.projectName }}</h2>
            <p class="mt-1 font-mono text-xs text-gray-500">
              PO-{{ detail.poId }} · Q{{ detail.specId }}
              <template v-if="detail.reorderRound > 0"> · A/S {{ detail.reorderRound }}차</template>
            </p>
          </div>
          <span
            class="ml-auto rounded-full px-3 py-1 text-sm font-bold"
            :class="detail.status === 'voided' ? 'bg-red-100 text-red-700' : detail.status === 'received' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'"
          >
            {{ PCB_PACKAGE_STATUS_LABELS[detail.status] }}
          </span>
        </div>

        <div
          v-if="detail.status === 'voided'"
          class="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700"
        >
          이 라벨은 박스 구성에서 제외되어 무효입니다. 실물에 붙어 있다면 사용하지 마세요.
        </div>

        <div class="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-3">
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">PCB 수량</p>
            <p class="mt-1 text-lg font-extrabold tabular-nums">
              {{ detail.qty.toLocaleString('ko-KR') }} PCS
            </p>
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">고객</p>
            <PcbCustomerCell :name="detail.customerName" :mb-id="detail.mbId" class="mt-1" />
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">제작 협력사</p>
            <p class="mt-1 text-sm font-bold">{{ detail.partnerName }}</p>
          </div>
          <div class="bg-white p-4 sm:col-span-2">
            <p class="text-[10px] font-bold uppercase text-gray-400">선적</p>
            <p class="mt-1 text-sm font-bold">
              SH-{{ detail.shipment.shipmentId }} · {{ detail.shipment.receiverName }} 수신
            </p>
            <p class="text-xs text-gray-500">
              {{ BOM_SHIPMENT_MODE_LABELS[detail.shipment.mode] }} ·
              {{ bomShipmentStatusLabel(detail.shipment.mode, detail.shipment.status) }}
            </p>
            <p v-if="detail.shipment.trackingNumber !== null" class="mt-1 text-xs text-gray-500">
              {{ detail.shipment.carrier ?? '' }} {{ detail.shipment.trackingNumber }}
            </p>
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">라벨 인쇄</p>
            <p class="mt-1 text-sm font-bold">
              {{ detail.printedAt === null ? '미인쇄' : fmtDateTime(detail.printedAt) }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap gap-2 border-t border-gray-100 px-5 py-4">
          <RouterLink
            :to="{ name: 'admin-pcb-case', params: { id: detail.specId }, query: { from: 'qr' } }"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
          >
            Case 상세 열기 →
          </RouterLink>
          <RouterLink
            :to="{ name: 'admin-pcb-shipments' }"
            class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            선적 큐 열기
          </RouterLink>
        </div>
      </section>

      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-extrabold">QR 추적 이력</h2>
        <p class="mt-1 text-xs leading-5 text-gray-500">
          입고는 개별 QR이 아니라 선적 박스 입고 확인과 함께 처리됩니다.
        </p>
        <ol class="mt-4 space-y-3 border-l-2 border-teal-100 pl-4">
          <li v-for="event in [...detail.events].reverse()" :key="event.eventId" class="relative">
            <span
              class="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-teal-500 ring-4 ring-white"
            />
            <div class="flex flex-wrap items-baseline gap-2">
              <b class="text-sm">{{ PCB_PACKAGE_EVENT_LABELS[event.eventType] }}</b>
              <span class="text-xs text-gray-400">{{ fmtDateTime(event.occurredAt) }}</span>
            </div>
            <p class="mt-0.5 text-xs text-gray-500">
              {{ event.actorType }}<template v-if="event.actorMbId !== null"> · {{ event.actorMbId }}</template>
              <template v-if="event.note !== null && event.note !== ''"> · {{ event.note }}</template>
            </p>
          </li>
          <li v-if="detail.events.length === 0" class="text-xs text-gray-400">이력이 없습니다.</li>
        </ol>
      </section>
    </template>
  </div>
</template>
