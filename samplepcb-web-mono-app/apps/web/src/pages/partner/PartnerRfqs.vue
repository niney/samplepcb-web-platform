<script setup lang="ts">
import { computed } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_PO_STATUS_LABELS, BOM_RFQ_STATUS_LABELS } from '@sp/api-contract';
import { usePartnerPos, usePartnerRfqs } from '../../partner/usePartnerRfqs';

// 파트너 포털 워크큐 — 받은 견적요청(회신할 것/한 것) + 받은 발주(D18).
// 서버가 소속을 판정하므로 403 은 "파트너 계정 아님" 안내로 처리한다.

const { data, error, isLoading } = usePartnerRfqs();
const poQuery = usePartnerPos();
const poItems = computed(() => poQuery.data.value?.data.items ?? []);

const notPartner = computed(
  () => error.value instanceof ApiRequestError && error.value.status === 403,
);
const items = computed(() => data.value?.data.items ?? []);
const pending = computed(() => items.value.filter((r) => r.status === 'requested'));
const done = computed(() => items.value.filter((r) => r.status !== 'requested'));

const fmtDate = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
const fmtWon = (v: number | null, currency: string): string =>
  v === null ? '—' : `${v.toLocaleString('ko-KR')} ${currency}`;

const statusCls = (s: string): string =>
  s === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-bold">받은 견적요청</h1>
      <p v-if="data !== undefined" class="mt-0.5 text-sm text-gray-500">
        {{ data.data.partnerName }} 님에게 요청된 부품 견적입니다.
      </p>
    </div>

    <div v-if="notPartner" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      승인된 파트너 계정이 아닙니다. 파트너 등록·계정 연결은 샘플피씨비 담당자에게 문의해 주세요.
    </div>
    <p v-else-if="isLoading" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else>
      <section>
        <h2 class="text-sm font-bold text-gray-700">회신할 것 ({{ pending.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="rfq in pending"
            :key="rfq.rfqId"
            :to="{ name: 'partner-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex items-center gap-3 rounded-xl border border-gray-200 bg-surface px-4 py-3 hover:border-blue-300 hover:bg-blue-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.quoteTitle }}</p>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ rfq.itemCount }}개 품목 · 요청일 {{ fmtDate(rfq.requestedAt) }}
              </p>
            </div>
            <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(rfq.status)">
              {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
            </span>
            <span class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">회신하기</span>
          </RouterLink>
          <p v-if="pending.length === 0" class="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
            회신 대기 중인 요청이 없습니다.
          </p>
        </div>
      </section>

      <!-- 받은 발주(D18) — 확인 대기 건이 위로 오도록 서버가 상태순 정렬 -->
      <section v-if="poItems.length > 0">
        <h2 class="text-sm font-bold text-gray-700">받은 발주 ({{ poItems.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="po in poItems"
            :key="po.poId"
            :to="{ name: 'partner-po', params: { id: String(po.poId) } }"
            class="flex items-center gap-3 rounded-xl border border-gray-200 bg-surface px-4 py-3 hover:border-emerald-300 hover:bg-emerald-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ po.quoteTitle }}</p>
              <p class="mt-0.5 text-xs text-gray-500">
                {{ po.itemCount }}개 품목 ·
                합계 {{ po.totalAmount.toLocaleString('ko-KR') }} {{ po.currency }} (VAT 별도) ·
                발행 {{ fmtDate(po.issuedAt) }}
              </p>
            </div>
            <span
              class="rounded px-2 py-0.5 text-xs font-semibold"
              :class="po.status === 'issued' ? 'bg-blue-100 text-blue-700' : po.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'"
            >
              {{ BOM_PO_STATUS_LABELS[po.status] }}
            </span>
            <span v-if="po.status === 'issued'" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">확인하기</span>
          </RouterLink>
        </div>
      </section>

      <section>
        <h2 class="text-sm font-bold text-gray-700">회신한 것 ({{ done.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="rfq in done"
            :key="rfq.rfqId"
            :to="{ name: 'partner-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex items-center gap-3 rounded-xl border border-gray-200 bg-surface px-4 py-3 hover:bg-gray-50"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.quoteTitle }}</p>
              <p class="mt-0.5 text-xs text-gray-500">
                회신 {{ rfq.repliedItemCount }}/{{ rfq.itemCount }}행 ·
                합계 {{ fmtWon(rfq.totalAmount, rfq.currency) }} ·
                회신일 {{ fmtDate(rfq.respondedAt) }}
              </p>
            </div>
            <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(rfq.status)">
              {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
            </span>
          </RouterLink>
          <p v-if="done.length === 0" class="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
            아직 회신한 요청이 없습니다.
          </p>
        </div>
      </section>
    </template>
  </div>
</template>
