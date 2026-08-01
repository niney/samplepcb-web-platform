<script setup lang="ts">
import { computed } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_RFQ_STATUS_LABELS, type PartnerPoListItemType } from '@sp/api-contract';
import {
  usePartnerPos,
  usePartnerRfqs,
  usePartnerShipments,
} from '../../partner/usePartnerRfqs';
import { partnerPoDisplayStatus } from '../../partner/partnerPoStatus';
import PartnerShipmentCard from '../../components/partner/PartnerShipmentCard.vue';

// 파트너 포털 홈(§6.11 재구성) — 문서 나열이 아니라 "오늘 할 일" 중심:
// ① 회신할 견적 ② 확인할 발주 ③ 보낼 물건([보내기] 위저드) ④ 진행 중 발송(핑퐁).
// 발주서는 문서 열람용 보조 목록로 내려간다. 서버가 소속을 판정(403=파트너 아님).

const { data, error, isLoading } = usePartnerRfqs();
const poQuery = usePartnerPos();
const shipmentsQuery = usePartnerShipments();

const notPartner = computed(
  () => error.value instanceof ApiRequestError && error.value.status === 403,
);

// ── 할 일 파생 ───────────────────────────────────────────────────────────────
const rfqItems = computed(() => data.value?.data.items ?? []);
const pendingRfqs = computed(() => rfqItems.value.filter((r) => r.status === 'requested'));
const doneRfqs = computed(() => rfqItems.value.filter((r) => r.status !== 'requested'));

const poItems = computed(() => poQuery.data.value?.data.items ?? []);
const toConfirm = computed(() => poItems.value.filter((po) => po.status === 'issued'));
const toShip = computed(
  () => poItems.value.filter((po) => po.status !== 'issued' && !po.shipmentAttached),
);

// 서버 tab=active — 협력사 관점 완료(최종 상태·입고 확인)는 제외돼 온다(§6.11 분리).
const shipments = computed(() => shipmentsQuery.data.value?.data.items ?? []);
// 준비 중 박스는 홈에 카드로 두지 않는다 — 편집·발송은 [📦 보내기] 화면이 전담(바로 유도).
const preparingCount = computed(
  () => shipments.value.filter((s) => s.status === 'preparing').length,
);
const activeShipments = computed(() => shipments.value.filter((s) => s.status !== 'preparing'));
const myTurnCount = computed(() => activeShipments.value.filter((s) => s.myTurn).length);
// 완료된 발송은 양이 누적되므로 별도 페이지 — 홈엔 건수 링크만.
const doneCount = computed(() => shipmentsQuery.data.value?.data.counts.done ?? 0);

// 발주서 배지 = 협력사 관점 상태(관리자 문서 상태 '마감' 등은 노출하지 않음)
const poBadge = (po: PartnerPoListItemType): { label: string; cls: string } =>
  partnerPoDisplayStatus({
    poStatus: po.status,
    attached: po.shipmentAttached,
    shipmentMode: po.shipmentMode,
    shipmentStatus: po.shipmentStatus,
    received: po.shipmentReceived,
  });

const fmtDate = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
const fmtWon = (v: number | null, currency: string): string =>
  v === null ? '—' : `${v.toLocaleString('ko-KR')} ${currency}`;

const rfqStatusCls = (s: string): string =>
  s === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-bold">파트너 홈</h1>
      <p v-if="data !== undefined" class="mt-0.5 text-sm text-gray-500">
        {{ data.data.partnerName }} 님, 오늘 처리할 일입니다.
      </p>
    </div>

    <div v-if="notPartner" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      승인된 파트너 계정이 아닙니다. 파트너 등록·계정 연결은 샘플피씨비 담당자에게 문의해 주세요.
    </div>
    <p v-else-if="isLoading" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else>
      <!-- 오늘 할 일 — 카드 4개 -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href="#reply"
          class="rounded-xl border bg-surface p-4 hover:border-blue-300"
          :class="pendingRfqs.length > 0 ? 'border-blue-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">회신할 견적</p>
          <p class="mt-1 text-2xl font-bold" :class="pendingRfqs.length > 0 ? 'text-blue-700' : 'text-gray-300'">
            {{ pendingRfqs.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <a
          href="#confirm"
          class="rounded-xl border bg-surface p-4 hover:border-emerald-300"
          :class="toConfirm.length > 0 ? 'border-emerald-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">확인할 발주</p>
          <p class="mt-1 text-2xl font-bold" :class="toConfirm.length > 0 ? 'text-emerald-700' : 'text-gray-300'">
            {{ toConfirm.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <RouterLink
          :to="{ name: 'partner-ship' }"
          class="rounded-xl border bg-surface p-4 hover:border-indigo-300"
          :class="toShip.length > 0 || preparingCount > 0 ? 'border-indigo-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">📦 보낼 물건</p>
          <p class="mt-1 text-2xl font-bold" :class="toShip.length > 0 ? 'text-indigo-700' : 'text-gray-300'">
            {{ toShip.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="preparingCount > 0" class="mt-0.5 text-xs font-bold text-indigo-600">
            준비 중인 박스 {{ preparingCount }}건 — 계속하기 →
          </p>
          <p v-else-if="toShip.length > 0" class="mt-0.5 text-xs font-semibold text-indigo-600">보내기 →</p>
        </RouterLink>
        <a
          href="#shipments"
          class="rounded-xl border bg-surface p-4 hover:border-blue-300"
          :class="myTurnCount > 0 ? 'border-blue-300' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">진행 중 발송</p>
          <p class="mt-1 text-2xl font-bold" :class="activeShipments.length > 0 ? 'text-gray-800' : 'text-gray-300'">
            {{ activeShipments.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="myTurnCount > 0" class="mt-0.5 text-xs font-bold text-blue-600">내 차례 {{ myTurnCount }}건!</p>
        </a>
      </div>

      <!-- ① 회신할 견적 -->
      <section v-if="pendingRfqs.length > 0" id="reply">
        <h2 class="text-sm font-bold text-gray-700">회신할 견적 ({{ pendingRfqs.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="rfq in pendingRfqs"
            :key="rfq.rfqId"
            :to="{ name: 'partner-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex items-center gap-3 rounded-xl border border-gray-200 bg-surface px-4 py-3 hover:border-blue-300 hover:bg-blue-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.quoteTitle }}</p>
              <p class="mt-0.5 text-sm text-gray-500">
                {{ rfq.itemCount }}개 품목 · 요청일 {{ fmtDate(rfq.requestedAt) }}
              </p>
            </div>
            <span class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-bold text-white">회신하기</span>
          </RouterLink>
        </div>
      </section>

      <!-- ② 확인할 발주 -->
      <section v-if="toConfirm.length > 0" id="confirm">
        <h2 class="text-sm font-bold text-gray-700">확인할 발주 ({{ toConfirm.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="po in toConfirm"
            :key="po.poId"
            :to="{ name: 'partner-po', params: { id: String(po.poId) } }"
            class="flex items-center gap-3 rounded-xl border border-emerald-200 bg-surface px-4 py-3 hover:bg-emerald-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ po.quoteTitle }}</p>
              <p class="mt-0.5 text-sm text-gray-500">
                {{ po.itemCount }}개 품목 · {{ po.totalAmount.toLocaleString('ko-KR') }} {{ po.currency }} (VAT 별도)
              </p>
            </div>
            <span class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white">확인하기</span>
          </RouterLink>
        </div>
      </section>

      <!-- ④ 진행 중 발송 — 발송(박스) 단위 추적·핑퐁 -->
      <section v-if="activeShipments.length > 0" id="shipments">
        <h2 class="text-sm font-bold text-gray-700">진행 중 발송 ({{ activeShipments.length }})</h2>
        <div class="mt-2 space-y-3">
          <PartnerShipmentCard v-for="s in activeShipments" :key="s.shipmentId" :shipment="s" />
        </div>
      </section>

      <!-- 보조: 모든 발주서(문서 열람) -->
      <details v-if="poItems.length > 0" class="rounded-xl border border-gray-200 bg-surface">
        <summary class="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
          모든 발주서 ({{ poItems.length }})
        </summary>
        <div class="grid gap-2 px-4 pb-4">
          <RouterLink
            v-for="po in poItems"
            :key="po.poId"
            :to="{ name: 'partner-po', params: { id: String(po.poId) } }"
            class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-gray-800">{{ po.quoteTitle }}</span>
            <span class="text-xs text-gray-400">{{ po.totalAmount.toLocaleString('ko-KR') }} {{ po.currency }}</span>
            <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="poBadge(po).cls">
              {{ poBadge(po).label }}
            </span>
          </RouterLink>
        </div>
      </details>

      <!-- 보조: 회신한 견적 -->
      <details v-if="doneRfqs.length > 0" class="rounded-xl border border-gray-200 bg-surface">
        <summary class="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
          회신한 견적 ({{ doneRfqs.length }})
        </summary>
        <div class="grid gap-2 px-4 pb-4">
          <RouterLink
            v-for="rfq in doneRfqs"
            :key="rfq.rfqId"
            :to="{ name: 'partner-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-gray-800">{{ rfq.quoteTitle }}</span>
            <span class="text-xs text-gray-400">
              회신 {{ rfq.repliedItemCount }}/{{ rfq.itemCount }}행 · {{ fmtWon(rfq.totalAmount, rfq.currency) }}
            </span>
            <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="rfqStatusCls(rfq.status)">
              {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
            </span>
          </RouterLink>
        </div>
      </details>

      <!-- 보조: 완료된 발송 — 누적 목록은 별도 페이지(§6.11 분리) -->
      <RouterLink
        v-if="doneCount > 0"
        :to="{ name: 'partner-shipments-done' }"
        class="block rounded-xl border border-gray-200 bg-surface px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
      >
        완료된 발송 {{ doneCount }}건 보기 →
      </RouterLink>

      <p
        v-if="pendingRfqs.length === 0 && toConfirm.length === 0 && toShip.length === 0 && activeShipments.length === 0"
        class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400"
      >
        지금 처리할 일이 없습니다 🎉
      </p>
    </template>
  </div>
</template>
