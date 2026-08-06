<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  ADMIN_PCB_REMITTANCE_TAB_LABELS,
  ADMIN_PCB_REMITTANCE_TABS,
  PCB_PO_STATUS_LABELS,
  PCB_REMITTANCE_STATUS_LABELS,
  type AdminPcbRemittanceItemType,
  type AdminPcbRemittanceTabType,
  type PcbRemittanceStatusType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import {
  useAdminPcbRemittancePartners,
  useAdminPcbRemittances,
  type AdminPcbRemittanceFilters,
} from '../../admin/useAdminPcbRemittances';
import { fmtPcbAmount } from '../../lib/pcb-money';
import PcbRemittancePanel from '../../components/admin/pcb/PcbRemittancePanel.vue';

// PCB 송금 워크큐(P3.11) — 경리·재무 역할 화면. 역할별 워크큐 교리(D12) 그대로
// 첫 탭이 대기 큐(= 발주됐는데 한 푼도 안 나간 건)이고 배지도 그 수다.
// '협력사별' 탭은 사용자가 요청한 "파트너사에 송금했는지" 조감 — 통화별 잔액 한 줄.

type View = AdminPcbRemittanceTabType | 'partners';
const view = ref<View>('pending');
const isPartnerView = computed(() => view.value === 'partners');

const router = useRouter();
const searchText = ref('');
const filters = ref<AdminPcbRemittanceFilters>({ tab: 'pending', q: '', page: 1, pageSize: 20 });
const list = useAdminPcbRemittances(filters);
const partners = useAdminPcbRemittancePartners(isPartnerView);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(
  () => list.data.value?.data.counts ?? { pending: 0, partial: 0, done: 0, all: 0 },
);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

function selectView(next: View): void {
  view.value = next;
  if (next !== 'partners') filters.value = { ...filters.value, tab: next, page: 1 };
}
function applySearch(): void {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
}

/** 협력사별 탭에서 행을 누르면 그 협력사의 발주만 추린다 — 조감 → 실행 동선. */
function drillPartner(partnerId: number): void {
  view.value = 'all';
  filters.value = { tab: 'all', q: '', page: 1, pageSize: 20, partnerId };
}
function clearPartnerFilter(): void {
  filters.value = { tab: filters.value.tab, q: filters.value.q, page: 1, pageSize: filters.value.pageSize };
}

const STATUS_CLS: Record<PcbRemittanceStatusType, string> = {
  unpaid: 'bg-gray-100 text-gray-600',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-700',
  over: 'bg-rose-100 text-rose-700',
};

// 송금 기록 패널 — 발주서 1건의 원장을 열고 닫는다.
const panelPoId = ref<number | null>(null);
const openPanel = (row: AdminPcbRemittanceItemType): void => {
  panelPoId.value = row.poId;
};

const openCase = (specId: number): void => {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: { from: 'remittances' },
  });
};
</script>

<template>
  <div class="space-y-4">
    <header>
      <h1 class="text-xl font-extrabold text-gray-900">PCB 송금</h1>
      <p class="mt-1 text-sm text-gray-500">
        협력사에 나가는 돈을 발주서 단위로 기록합니다. 부분·분할 송금이 가능하며
        <b class="text-gray-700">미지급 잔액 = 발주가 − 송금 합계</b>입니다.
      </p>
    </header>

    <div class="flex flex-wrap items-center justify-between gap-2">
      <nav class="flex flex-wrap gap-1 border-b border-gray-200">
        <button
          v-for="t in ADMIN_PCB_REMITTANCE_TABS"
          :key="t"
          type="button"
          class="-mb-px border-b-2 px-3 py-2 text-sm font-semibold"
          :class="view === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
          @click="selectView(t)"
        >
          {{ ADMIN_PCB_REMITTANCE_TAB_LABELS[t] }}
          <span class="ml-1 tabular-nums text-xs text-gray-400">{{ counts[t] }}</span>
        </button>
        <button
          type="button"
          class="-mb-px border-b-2 px-3 py-2 text-sm font-semibold"
          :class="isPartnerView ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'"
          @click="selectView('partners')"
        >
          협력사별
        </button>
      </nav>
      <form v-if="!isPartnerView" @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트·협력사·견적번호"
          class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <!-- ── 발주서별 지급 목록 ─────────────────────────────────────────── -->
    <template v-if="!isPartnerView">
      <p v-if="filters.partnerId !== undefined" class="text-xs text-gray-500">
        협력사 필터가 걸려 있습니다.
        <button type="button" class="ml-1 font-semibold text-blue-600 hover:underline" @click="clearPartnerFilter">
          전체 보기
        </button>
      </p>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">견적</th>
              <th class="px-4 py-2.5">프로젝트</th>
              <th class="px-4 py-2.5">협력사</th>
              <th class="whitespace-nowrap px-4 py-2.5">발주 상태</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">발주가</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">송금액</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">잔액</th>
              <th class="whitespace-nowrap px-4 py-2.5">지급</th>
              <th class="whitespace-nowrap px-4 py-2.5">최근 송금</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="row in rows"
              :key="row.poId"
              class="cursor-pointer hover:bg-blue-50/40"
              @click="openPanel(row)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
                Q{{ row.specId }}
                <span v-if="row.isLegacy" class="ml-1 rounded bg-gray-200 px-1 text-[10px] font-sans text-gray-600">이관</span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.partnerName }}</td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {{ PCB_PO_STATUS_LABELS[row.poStatus] }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">
                {{ fmtPcbAmount(row.summary.currency, row.summary.poAmount) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-gray-700">
                {{ fmtPcbAmount(row.summary.currency, row.summary.paidAmount) }}
                <span v-if="row.summary.count > 1" class="ml-1 text-[11px] text-gray-400">{{ row.summary.count }}회</span>
              </td>
              <td
                class="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums"
                :class="row.summary.balance > 0 ? 'text-rose-700' : 'text-gray-400'"
              >
                {{ fmtPcbAmount(row.summary.currency, row.summary.balance) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.summary.status]">
                  {{ PCB_REMITTANCE_STATUS_LABELS[row.summary.status] }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">
                {{ row.summary.lastRemittedOn === null ? '—' : fmtKstDate(row.summary.lastRemittedOn) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
                <button
                  type="button"
                  class="mr-1 rounded-md bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700"
                  @click.stop="openPanel(row)"
                >
                  송금 기록
                </button>
                <button
                  type="button"
                  class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
                  @click.stop="openCase(row.specId)"
                >
                  Case
                </button>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="10" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ list.isFetching.value ? '불러오는 중…' : '해당하는 발주가 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between text-sm">
        <p class="text-gray-500">총 {{ total }}건</p>
        <div v-if="totalPages > 1" class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="filters.page <= 1"
            @click="filters = { ...filters, page: filters.page - 1 }"
          >
            이전
          </button>
          <span class="text-gray-500">{{ filters.page }} / {{ totalPages }}</span>
          <button
            type="button"
            class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
            :disabled="filters.page >= totalPages"
            @click="filters = { ...filters, page: filters.page + 1 }"
          >
            다음
          </button>
        </div>
      </div>
    </template>

    <!-- ── 협력사별 잔액 조감 ─────────────────────────────────────────── -->
    <template v-else>
      <p class="text-xs text-gray-500">
        협력사마다 통화가 달라 <b class="text-gray-700">통화별로 나눠</b> 셉니다. KRW 환산 합계는
        발주서의 회계 박제(krwAmount) 기준 참고값입니다.
      </p>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2.5">협력사</th>
              <th class="px-4 py-2.5">통화별 발주 · 송금 · 잔액</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">KRW 환산 잔액</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">미송금 발주</th>
              <th class="whitespace-nowrap px-4 py-2.5">최근 송금</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="p in partners.data.value?.data.rows ?? []"
              :key="p.partnerId"
              class="cursor-pointer hover:bg-blue-50/40"
              @click="drillPartner(p.partnerId)"
            >
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="font-medium text-gray-900">{{ p.partnerName }}</span>
                <span v-if="p.country !== null" class="ml-1 text-[11px] text-gray-400">{{ p.country }}</span>
              </td>
              <td class="px-4 py-2.5">
                <div v-for="c in p.byCurrency" :key="c.currency" class="text-xs tabular-nums text-gray-600">
                  <span class="mr-1 font-semibold text-gray-500">{{ c.currency }}</span>
                  {{ fmtPcbAmount(c.currency, c.poAmount) }} ·
                  {{ fmtPcbAmount(c.currency, c.paidAmount) }} ·
                  <b :class="c.balance > 0 ? 'text-rose-700' : 'text-gray-400'">
                    {{ fmtPcbAmount(c.currency, c.balance) }}
                  </b>
                  <span class="ml-1 text-gray-400">({{ c.poCount }}건)</span>
                </div>
              </td>
              <td
                class="whitespace-nowrap px-4 py-2.5 text-right font-bold tabular-nums"
                :class="p.krwBalance > 0 ? 'text-rose-700' : 'text-gray-400'"
              >
                {{ fmtPcbAmount('KRW', p.krwBalance) }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                <span :class="p.unpaidPoCount > 0 ? 'font-bold text-gray-800' : 'text-gray-400'">
                  {{ p.unpaidPoCount }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">
                {{ p.lastRemittedOn === null ? '—' : fmtKstDate(p.lastRemittedOn) }}
              </td>
            </tr>
            <tr v-if="(partners.data.value?.data.rows ?? []).length === 0">
              <td colspan="5" class="px-4 py-10 text-center text-sm text-gray-400">
                {{ partners.isFetching.value ? '불러오는 중…' : '발주가 있는 협력사가 없습니다.' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <PcbRemittancePanel v-if="panelPoId !== null" :po-id="panelPoId" @close="panelPoId = null" />
  </div>
</template>
