<script setup lang="ts">
import { computed } from 'vue';
import {
  BOM_PO_STATUS_LABELS,
  BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL,
  BOM_SHIPMENT_MODE_LABELS,
  BOM_SHIPMENT_STATUS_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type AdminBomPoViewType,
} from '@sp/api-contract';
import { smartbomFmtDate, smartbomFmtWon } from '../../../admin/smartbom';

// Case 상세의 협력사 발주서 패널(D18) — 발행·확인·마감 현황.
// 발주서는 박제 문서라 수정이 없고, 재발행 = 미확인(issued) 삭제 후 재생성.

const props = defineProps<{
  pos: AdminBomPoViewType[];
  loading: boolean;
  canIssue: boolean; // 결제 확인(isPaid) 후에만 발행 가능(D18-4)
  issueDisabledReason: string;
  busy: boolean;
}>();
const emit = defineEmits<{
  create: [];
  remove: [po: AdminBomPoViewType];
  close: [po: AdminBomPoViewType];
  external: [po: AdminBomPoViewType]; // 외부 실행 재시도/재발급(D20)
  shipment: [po: AdminBomPoViewType]; // 선적 관리(D21)
}>();

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

// 선적 요약 라벨 — 국내 preparing 은 '배송 준비'
function shipmentLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '—';
  const statusText =
    shipment.mode === 'domestic' && shipment.status === 'preparing'
      ? BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL
      : BOM_SHIPMENT_STATUS_LABELS[shipment.status];
  return `${BOM_SHIPMENT_MODE_LABELS[shipment.mode]} · ${statusText}`;
}

// 핑퐁 차례(D22 인지) — 다음 단계 주체가 관리자면 행·버튼 강조, 협력사면 대기 힌트.
function shipmentNextActor(po: AdminBomPoViewType): 'ADMIN' | 'PARTNER' | null {
  const shipment = po.shipment;
  if (shipment === null) return null;
  if (shipment.receivedAt !== null) return null;
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? null : bomShipmentActorOf(shipment.mode, next);
}
function shipmentNextLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '';
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? '' : bomShipmentStatusLabel(shipment.mode, next);
}
const adminPendingCount = computed(
  () => props.pos.filter((po) => shipmentNextActor(po) === 'ADMIN').length,
);

const statusCls = (status: AdminBomPoViewType['status']): string =>
  status === 'confirmed'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
      <p class="text-sm font-bold text-gray-800">협력사 발주 (PO)</p>
      <p v-if="pos.length > 0" class="text-xs text-gray-500">
        발주서 <b>{{ pos.length }}</b> ·
        확인 <b class="text-emerald-600">{{ pos.filter((p) => p.status !== 'issued').length }}</b>
        <template v-if="adminPendingCount > 0">
          · <b class="text-blue-700">선적 처리 필요 {{ adminPendingCount }}</b>
        </template>
      </p>
      <button
        type="button"
        class="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        :disabled="!canIssue"
        :title="canIssue ? '' : issueDisabledReason"
        @click="emit('create')"
      >
        발주서 생성
      </button>
    </div>

    <p v-if="loading && pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">불러오는 중…</p>
    <p v-else-if="pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
      아직 발행한 발주서가 없습니다{{ canIssue ? '' : ` — ${issueDisabledReason}` }}.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="px-3 py-2">협력사</th>
            <th class="px-3 py-2">상태</th>
            <th class="px-3 py-2 text-right">품목</th>
            <th class="px-3 py-2 text-right">발주 합계(VAT 별도)</th>
            <th class="px-3 py-2">선적·입고</th>
            <th class="px-3 py-2">발행/확인</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="po in pos" :key="po.poId">
            <td class="px-3 py-2 font-medium text-gray-900">
              {{ po.partnerName }}
              <span v-if="po.supplierCode !== null" class="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">{{ po.supplierCode }}</span>
              <!-- 외부 실행 결과(D20) — 카트/리스트까지, 실결제는 공급사 사이트에서 -->
              <div v-if="po.externalRef !== null" class="mt-1 text-[11px] font-normal">
                <template v-if="po.externalRef.state === 'ok' && po.externalRef.cartKey !== undefined">
                  <span class="text-emerald-700">카트 담김 · {{ po.externalRef.lineCount ?? 0 }}행</span>
                  <span v-if="po.externalRef.merchandiseTotal !== null && po.externalRef.merchandiseTotal !== undefined" class="text-gray-500">
                    · {{ po.externalRef.merchandiseTotal }} {{ po.externalRef.currencyCode ?? '' }}
                  </span>
                  <button v-if="po.externalRef.cartWebUrl !== undefined" type="button" class="ml-1 text-blue-600 underline" @click="openExternal(po.externalRef.cartWebUrl)">
                    Mouser 카트 확인
                  </button>
                  <span v-if="(po.externalRef.errors?.length ?? 0) > 0" class="ml-1 text-amber-700" :title="po.externalRef.errors?.join('\n')">행 오류 {{ po.externalRef.errors?.length }}</span>
                </template>
                <template v-else-if="po.externalRef.state === 'ok' && po.externalRef.singleUseUrl !== undefined">
                  <span class="text-emerald-700">리스트 생성됨 · {{ po.externalRef.lineCount ?? 0 }}행</span>
                  <button type="button" class="ml-1 text-blue-600 underline" title="1회용 URL — 열면 소진되며 [재발급]으로 다시 만들 수 있습니다" @click="openExternal(po.externalRef.singleUseUrl)">
                    DigiKey 리스트 열기(1회용)
                  </button>
                  <button type="button" class="ml-1 text-gray-500 underline" :disabled="busy" @click="emit('external', po)">재발급</button>
                </template>
                <template v-else>
                  <span class="text-red-600" :title="po.externalRef.error">실행 실패: {{ (po.externalRef.error ?? '').slice(0, 40) }}</span>
                  <button type="button" class="ml-1 text-blue-600 underline" :disabled="busy" @click="emit('external', po)">재시도</button>
                </template>
                <span v-if="(po.externalRef.skippedNoSku ?? 0) > 0" class="ml-1 text-amber-700">SKU 없음 {{ po.externalRef.skippedNoSku }}행 제외</span>
              </div>
            </td>
            <td class="px-3 py-2">
              <span class="rounded px-1.5 py-0.5 font-semibold" :class="statusCls(po.status)">
                {{ BOM_PO_STATUS_LABELS[po.status] }}
              </span>
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{{ po.itemCount }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ smartbomFmtWon(po.totalAmount) }}</td>
            <!-- 선적(D21·D22) — 모드·상태·송장 + 차례 표시 + 입고 확인 -->
            <td class="whitespace-nowrap px-3 py-2">
              <span :class="po.shipment === null ? 'text-gray-300' : shipmentNextActor(po) === 'ADMIN' ? 'font-bold text-blue-700' : 'text-gray-700'">{{ shipmentLabel(po) }}</span>
              <span
                v-if="shipmentNextActor(po) === 'ADMIN'"
                class="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700"
                :title="`협력사가 단계를 넘겼습니다 — [선적 관리]에서 '${shipmentNextLabel(po)}' 처리를 진행해 주세요`"
              >
                {{ shipmentNextLabel(po) }} 처리 필요
              </span>
              <span
                v-else-if="shipmentNextActor(po) === 'PARTNER'"
                class="ml-1 text-[10px] text-gray-400"
                :title="`협력사의 '${shipmentNextLabel(po)}' 처리를 기다리는 중`"
              >
                협력사 차례
              </span>
              <!-- 선적 그룹(§6.10) — 여러 발주서 한 물류 묶음 -->
              <span
                v-if="(po.shipment?.groupPos.length ?? 0) > 1"
                class="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-bold text-indigo-700"
                :title="po.shipment?.groupPos.map((g) => g.quoteTitle).join('\n')"
              >
                📦 묶음 {{ po.shipment?.groupPos.length }}건
              </span>
              <span v-if="po.shipment?.trackingNumber != null" class="ml-1 font-mono text-[10px] text-gray-400" :title="po.shipment.carrier ?? ''">
                {{ po.shipment.trackingNumber }}
              </span>
              <span v-if="po.shipment?.receivedAt != null" class="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-700" :title="po.shipment.receivedNote ?? ''">
                입고 완료
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-400">
              {{ smartbomFmtDate(po.issuedAt) }}
              <template v-if="po.confirmedAt !== null"> → {{ smartbomFmtDate(po.confirmedAt) }}</template>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <button
                type="button"
                class="rounded px-2 py-1 font-semibold disabled:opacity-40"
                :class="shipmentNextActor(po) === 'ADMIN' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-blue-200 text-blue-700 hover:bg-blue-50'"
                :disabled="busy"
                @click="emit('shipment', po)"
              >
                선적 관리
              </button>
              <button
                v-if="po.status === 'issued'"
                type="button"
                class="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                :disabled="busy"
                title="미확인 발주서 발행 취소(재발행 = 삭제 후 재생성)"
                @click="emit('remove', po)"
              >
                발행 취소
              </button>
              <button
                v-if="po.status !== 'closed'"
                type="button"
                class="ml-1 rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                :disabled="busy"
                @click="emit('close', po)"
              >
                마감
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
