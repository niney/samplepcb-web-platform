<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { PCB_PO_STATUS_LABELS, PCB_REMITTANCE_STATUS_LABELS, type PcbRemittanceStatusType } from '@sp/api-contract';
import { fmtKstDate as dateOnly } from '@sp/utils';
import { usePartnerPcbRemittances } from '../../partner/usePartnerPcbPos';
import { fmtPcbAmount } from '../../lib/pcb-money';

// 협력사 수금 현황(P3.11) — 관리자 [송금] 워크큐의 협력사 버전.
// 발주서 상세에도 같은 내용이 있지만, **완료된 발주서는 포털 홈의 '진행할 발주'에 뜨지
// 않아 거기로 갈 길이 없었다**(2026-08-06 사용자 지적). 이 화면이 그 진입점이다.
const query = usePartnerPcbRemittances();
const items = computed(() => query.data.value?.data.items ?? []);
const totals = computed(() => query.data.value?.data.totals ?? []);
const unpaidCount = computed(() => query.data.value?.data.unpaidCount ?? 0);

/** 미수금이 남은 건만 보기 — 협력사가 이 화면을 여는 이유가 대개 그것이다. */
const onlyUnpaid = ref(false);
const visible = computed(() =>
  onlyUnpaid.value ? items.value.filter((i) => i.summary.balance > 0) : items.value,
);

const expanded = ref<number | null>(null);
const toggle = (poId: number): void => {
  expanded.value = expanded.value === poId ? null : poId;
};

const STATUS_CLS: Record<PcbRemittanceStatusType, string> = {
  unpaid: 'bg-gray-100 text-gray-600',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-700',
  over: 'bg-sky-100 text-sky-700',
};
const STATUS_TEXT: Record<PcbRemittanceStatusType, string> = {
  ...PCB_REMITTANCE_STATUS_LABELS,
  // 협력사 관점은 '받는 쪽' — 같은 상태라도 말이 다르다.
  unpaid: '입금 전',
  partial: '부분 입금',
  paid: '입금 완료',
  over: '초과 입금',
};
</script>

<template>
  <div class="pcb-readable space-y-5">
    <RouterLink :to="{ name: 'partner' }" class="text-sm text-gray-400 hover:text-gray-700">
      ← 파트너 홈
    </RouterLink>

    <header>
      <h1 class="text-xl font-bold">수금 현황</h1>
      <p class="mt-1 text-sm text-gray-500">
        받은 발주서별 입금 내역입니다. 금액이 다르면 발주처에 문의해 주세요.
      </p>
    </header>

    <!-- 통화별 미수금 총계 — 이 화면의 결론 -->
    <section v-if="totals.length > 0" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="t in totals"
        :key="t.currency"
        class="rounded-xl border p-4"
        :class="t.balance > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'"
      >
        <p class="text-xs" :class="t.balance > 0 ? 'text-amber-700' : 'text-emerald-700'">
          {{ t.currency }} 미수금 <span class="text-gray-400">({{ t.poCount }}건)</span>
        </p>
        <p
          class="mt-1 text-xl font-extrabold tabular-nums"
          :class="t.balance > 0 ? 'text-amber-800' : 'text-emerald-800'"
        >
          {{ fmtPcbAmount(t.currency, t.balance) }}
        </p>
        <p class="mt-0.5 text-[11px] text-gray-500">
          발주 {{ fmtPcbAmount(t.currency, t.poAmount) }} · 입금 {{ fmtPcbAmount(t.currency, t.paidAmount) }}
        </p>
      </div>
    </section>

    <label v-if="items.length > 0" class="flex items-center gap-2 text-sm text-gray-600">
      <input v-model="onlyUnpaid" type="checkbox" class="size-4 accent-amber-600">
      미수금 있는 건만 ({{ unpaidCount }})
    </label>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="px-4 py-2.5">프로젝트</th>
            <th class="px-4 py-2.5">발주처</th>
            <th class="whitespace-nowrap px-4 py-2.5">진행</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">발주가</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">입금액</th>
            <th class="whitespace-nowrap px-4 py-2.5 text-right">미수금</th>
            <th class="whitespace-nowrap px-4 py-2.5">상태</th>
            <th class="whitespace-nowrap px-4 py-2.5">최근 입금</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <template v-for="it in visible" :key="it.poId">
            <tr class="cursor-pointer hover:bg-gray-50" @click="toggle(it.poId)">
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ it.projectName }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ it.ordererName }}</td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {{ PCB_PO_STATUS_LABELS[it.poStatus] }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">
                {{ fmtPcbAmount(it.summary.currency, it.summary.poAmount) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">
                {{ fmtPcbAmount(it.summary.currency, it.summary.paidAmount) }}
                <span v-if="it.summary.count > 1" class="ml-1 text-[11px] text-gray-400">{{ it.summary.count }}회</span>
              </td>
              <td
                class="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums"
                :class="it.summary.balance > 0 ? 'text-amber-700' : 'text-gray-400'"
              >
                {{ fmtPcbAmount(it.summary.currency, it.summary.balance) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[it.summary.status]">
                  {{ STATUS_TEXT[it.summary.status] }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">
                {{ it.summary.lastRemittedOn === null ? '—' : dateOnly(it.summary.lastRemittedOn) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                <RouterLink
                  :to="{ name: 'partner-pcb-po', params: { id: String(it.poId) } }"
                  class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                  @click.stop
                >
                  발주서
                </RouterLink>
              </td>
            </tr>
            <!-- 입금 건별 — 부분 입금이면 언제 얼마가 들어왔는지가 핵심이다 -->
            <tr v-if="expanded === it.poId && it.remittances.length > 0" class="bg-gray-50/60">
              <td colspan="9" class="px-6 py-3">
                <ul class="space-y-1 text-xs">
                  <li v-for="r in it.remittances" :key="r.id" class="flex flex-wrap items-center gap-2">
                    <span class="text-gray-500">{{ dateOnly(r.remittedOn) }}</span>
                    <b class="tabular-nums text-gray-800">{{ fmtPcbAmount(r.currency, r.amount) }}</b>
                    <span v-if="r.memo !== null" class="text-gray-400">{{ r.memo }}</span>
                  </li>
                </ul>
              </td>
            </tr>
            <tr v-else-if="expanded === it.poId" class="bg-gray-50/60">
              <td colspan="9" class="px-6 py-3 text-xs text-gray-400">아직 입금 내역이 없습니다.</td>
            </tr>
          </template>
          <tr v-if="visible.length === 0">
            <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ query.isFetching.value ? '불러오는 중…' : onlyUnpaid ? '미수금이 없습니다.' : '받은 발주가 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
