<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { BOM_SHIPMENT_MODE_LABELS, bomShipmentStatusLabel } from '@sp/api-contract';
import { usePartnerPoConfirm, usePartnerPoDetail } from '../../partner/usePartnerRfqs';
import { partnerPoDisplayStatus } from '../../partner/partnerPoStatus';

// 파트너 포털 발주서 상세(D18·§6.11 축소) — 문서 열람 전용: 박제 품목·금액 + [발주 확인].
// 발송(선적) 작업은 홈의 [📦 보내기]·진행 중 발송 카드가 담당한다 — 여기엔 소속 안내만.

const route = useRoute();
const poId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = usePartnerPoDetail(poId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const confirmMut = usePartnerPoConfirm();
const error = ref('');

async function confirmPo(): Promise<void> {
  if (poId.value === null) return;
  error.value = '';
  try {
    await confirmMut.mutateAsync(poId.value);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '확인 처리에 실패했습니다.';
  }
}

const shipment = computed(() => detail.value?.shipment ?? null);

// 배지 = 협력사 관점 상태 — 관리자 문서 상태(마감 등)를 그대로 노출하지 않는다
const badge = computed(() =>
  detail.value === null
    ? null
    : partnerPoDisplayStatus({
        poStatus: detail.value.status,
        attached: shipment.value !== null,
        shipmentStatus: shipment.value?.status ?? null,
        received: (shipment.value?.receivedAt ?? null) !== null,
      }),
);

const fmt = (v: number): string => v.toLocaleString('ko-KR');
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 홈
      </RouterLink>
      <template v-if="detail !== null">
        <h1 class="text-xl font-bold">발주서 — {{ detail.quoteTitle }}</h1>
        <span v-if="badge !== null" class="rounded px-2 py-0.5 text-xs font-semibold" :class="badge.cls">
          {{ badge.label }}
        </span>
      </template>
    </div>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">발주서를 찾을 수 없습니다.</p>

    <template v-else>
      <p class="text-sm text-gray-500">
        발행 {{ detail.issuedAt.slice(0, 10) }}
        <template v-if="detail.confirmedAt !== null"> · 확인 {{ detail.confirmedAt.slice(0, 10) }}</template>
      </p>
      <p v-if="detail.memo !== null" class="rounded bg-gray-50 px-3 py-2 text-sm text-gray-600">{{ detail.memo }}</p>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-3 py-2">부품</th>
              <th class="px-3 py-2 text-right">수량</th>
              <th class="px-3 py-2 text-right">단가(KRW)</th>
              <th class="px-3 py-2 text-right">금액</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in detail.items" :key="item.poItemId">
              <td class="px-3 py-2">
                <div class="font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</div>
                <div class="text-gray-400">{{ item.manufacturerName ?? item.description ?? '' }}</div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.qty) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.unitPrice) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.lineTotal) }}원</td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50">
            <tr>
              <td colspan="3" class="px-3 py-2 text-right font-bold">합계 (VAT 별도)</td>
              <td class="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">
                {{ fmt(detail.totalAmount) }}원
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="flex items-center gap-3">
        <button
          v-if="detail.status === 'issued'"
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="confirmMut.isPending.value"
          @click="confirmPo"
        >
          발주 확인
        </button>
        <p v-else-if="detail.status === 'confirmed'" class="text-sm font-semibold text-emerald-700">
          확인 완료 — 진행 부탁드립니다.
        </p>
        <p v-if="error !== ''" class="text-sm font-semibold text-red-600">{{ error }}</p>
      </div>

      <!-- 발송 안내(§6.11) — 작업은 홈에서, 여기선 소속 상태만 -->
      <div
        v-if="shipment !== null"
        class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-900"
      >
        📦 이 발주서는 발송에 담겨 있습니다 —
        {{ BOM_SHIPMENT_MODE_LABELS[shipment.mode] }} ·
        {{ bomShipmentStatusLabel(shipment.mode, shipment.status) }}
        <template v-if="shipment.groupPos.length > 1">
          · 발주서 {{ shipment.groupPos.length }}건 묶음
        </template>
        <RouterLink :to="{ name: 'partner' }" class="ml-1 font-semibold underline">
          홈의 진행 중 발송에서 처리 →
        </RouterLink>
      </div>
      <div
        v-else-if="detail.status !== 'issued'"
        class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
      >
        아직 발송에 담기지 않았습니다 —
        <RouterLink :to="{ name: 'partner-ship' }" class="font-semibold text-indigo-700 underline">
          📦 보내기에서 담기 →
        </RouterLink>
      </div>
    </template>
  </div>
</template>
