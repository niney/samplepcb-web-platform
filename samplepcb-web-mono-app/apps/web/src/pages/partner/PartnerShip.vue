<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_SHIPMENT_MODE_LABELS } from '@sp/api-contract';
import {
  useAttachShipmentPo,
  useCreatePartnerShipment,
  usePartnerPos,
  usePartnerShipmentDetach,
  usePartnerShipments,
} from '../../partner/usePartnerRfqs';
import PartnerShipmentCard from '../../components/partner/PartnerShipmentCard.vue';

// [📦 보내기](§6.11 개정 — 두 칸 이동 UI) — 왼쪽 선반(보낼 물건)에서 오른쪽 박스로
// 카드를 "옮긴다". 체크박스 없이 [담기 →]/[← 꺼내기]로 물리적 이동이 눈에 보인다.
// 박스 = 준비 단계(preparing) 발송 그 자체(서버 실시간 반영 — 재진입해도 그대로).
// "기준 발주서" 개념은 서버가 은닉(꺼내면 승계·비면 소멸) — 규칙은 "발송 전엔 자유" 하나.

const poQuery = usePartnerPos();
const shipmentsQuery = usePartnerShipments();
const createMut = useCreatePartnerShipment();
const attachMut = useAttachShipmentPo();
const detachMut = usePartnerShipmentDetach();

const error = ref('');
// 담기(생성) 후 서류 단계로 넘어간 상태 — 박스가 비면 자동 해제
const readyMode = ref(false);

// 박스 = 가장 최근 준비 단계 발송(하나만 — 비우면 소멸하고 새로 시작)
const box = computed(
  () =>
    (shipmentsQuery.data.value?.data.items ?? []).find((s) => s.status === 'preparing') ?? null,
);
const boxTotal = computed(() =>
  (box.value?.groupPos ?? []).reduce((sum, g) => sum + g.totalAmount, 0),
);

// 선반 = 발주 확인 완료 + 어느 발송에도 안 담긴 발주서
const shelf = computed(() =>
  (poQuery.data.value?.data.items ?? []).filter(
    (po) => po.status !== 'issued' && !po.shipmentAttached,
  ),
);

const busy = computed(
  () => createMut.isPending.value || attachMut.isPending.value || detachMut.isPending.value,
);

async function putIn(poId: number): Promise<void> {
  error.value = '';
  try {
    if (box.value === null) {
      await createMut.mutateAsync([poId]);
    } else {
      await attachMut.mutateAsync({ shipmentId: box.value.shipmentId, poId });
    }
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '담기에 실패했습니다.';
  }
}

async function takeOut(poId: number): Promise<void> {
  error.value = '';
  try {
    await detachMut.mutateAsync(String(poId));
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '꺼내기에 실패했습니다.';
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner-bom' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 홈
      </RouterLink>
      <h1 class="text-xl font-bold">📦 보내기</h1>
      <p class="text-sm text-gray-400">보낼 발주서를 박스로 옮기고, 다 담았으면 발송을 준비하세요.</p>
    </div>

    <p v-if="error !== ''" class="text-sm font-semibold text-red-600">{{ error }}</p>

    <!-- 서류·발송 단계 — 박스 확정 후 -->
    <template v-if="readyMode && box !== null">
      <button type="button" class="text-sm text-blue-600 underline" @click="readyMode = false">
        ← 박스에 더 담기 / 꺼내기
      </button>
      <PartnerShipmentCard :shipment="box" :show-box-link="false" />
    </template>

    <!-- 두 칸: 선반 ↔ 박스 -->
    <div v-else class="grid gap-4 lg:grid-cols-2">
      <!-- 선반 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">
          보낼 물건 <span class="font-normal text-gray-400">({{ shelf.length }}건)</span>
        </h2>
        <div class="mt-2 space-y-2">
          <div
            v-for="po in shelf"
            :key="po.poId"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ po.quoteTitle }}</p>
              <p class="text-sm text-gray-500">
                {{ po.itemCount }}개 품목 · {{ po.totalAmount.toLocaleString('ko-KR') }} {{ po.currency }}
              </p>
              <p v-if="!po.shipmentCountryReady" class="mt-0.5 text-xs font-semibold text-red-600">
                국가 정보 필요 — 샘플피씨비 담당자에게 문의해 주세요.
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
              :disabled="busy || !po.shipmentCountryReady"
              @click="putIn(po.poId)"
            >
              담기 →
            </button>
          </div>
          <p v-if="shelf.length === 0" class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            {{ box === null ? '보낼 수 있는 발주서가 없습니다 — 발주 확인을 먼저 완료해 주세요.' : '전부 박스에 담겼습니다.' }}
          </p>
        </div>
      </section>

      <!-- 박스 -->
      <section
        class="rounded-xl border-2 border-dashed p-4"
        :class="box === null ? 'border-gray-200 bg-gray-50/50' : 'border-indigo-300 bg-indigo-50/40'"
      >
        <h2 class="text-sm font-bold" :class="box === null ? 'text-gray-500' : 'text-indigo-800'">
          📦 박스 (이번 발송)
          <span v-if="box !== null" class="font-normal text-indigo-500">— {{ box.groupPos.length }}건 담김</span>
          <span v-if="box !== null" class="ml-1 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">
            {{ BOM_SHIPMENT_MODE_LABELS[box.mode] }}
          </span>
        </h2>
        <div class="mt-2 space-y-2">
          <div
            v-for="entry in box?.groupPos ?? []"
            :key="entry.poId"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-indigo-200 bg-surface px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ entry.quoteTitle }}</p>
              <p class="text-sm text-gray-500">{{ entry.totalAmount.toLocaleString('ko-KR') }}원</p>
            </div>
            <button
              type="button"
              class="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              :disabled="busy"
              @click="takeOut(entry.poId)"
            >
              ← 꺼내기
            </button>
          </div>
          <p v-if="box === null || box.groupPos.length === 0" class="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400">
            비어 있습니다 — 왼쪽에서 [담기 →]를 눌러 옮겨 주세요.
          </p>
        </div>

        <div v-if="box !== null" class="mt-3 border-t border-indigo-100 pt-3">
          <p class="text-sm text-gray-600">
            담긴 발주서 <b>{{ box.groupPos.length }}</b>건 · 합계
            <b>{{ boxTotal.toLocaleString('ko-KR') }}</b>원 (VAT 별도)
          </p>
          <button
            type="button"
            class="mt-2 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            :disabled="busy"
            @click="readyMode = true"
          >
            이 박스로 발송 준비 →
            {{ box.mode === 'domestic' ? '(QR·택배 정보)' : '(QR·Invoice·출고예정일)' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
