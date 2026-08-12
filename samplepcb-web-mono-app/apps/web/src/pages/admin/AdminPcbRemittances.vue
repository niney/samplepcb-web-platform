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
import { fmtKstDate, kstDateOnly, kstToday } from '@sp/utils';
import {
  useAdminPcbRemittancePartners,
  useAdminPcbRemittances,
  type AdminPcbRemittanceFilters,
} from '../../admin/useAdminPcbRemittances';
import { fmtPcbAmount } from '../../lib/pcb-money';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';
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
/** 통화별 소계(서버 계산 — 페이지가 아니라 조건 전체). ₩와 $가 한 열에 섞여 서므로
 *  합계를 눈으로 더할 수 없다 = 이 화면에 "얼마 남았나"의 답이 없었다(재점검 #14). */
const byCurrency = computed(() => list.data.value?.data.byCurrency ?? []);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

/** 발주일로부터 며칠 지났나 — 결제조건(예: T/T 30 DAYS)과 짝이라야 뜻이 산다. */
const elapsedDays = (iso: string): number => {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
};

const DAY_MS = 86_400_000;
/** 미지급 잔액이 있는 행만 예정일의 남은 날/지연을 말한다. 완납 뒤에는 과거 일정 경고를 끈다. */
const dueTiming = (
  row: AdminPcbRemittanceItemType,
): { label: string; className: string } | null => {
  const dueOn = kstDateOnly(row.remittanceDueOn);
  if (dueOn === null || row.summary.balance <= 0) return null;
  const delta = Math.round(
    (Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${kstToday()}T00:00:00Z`)) / DAY_MS,
  );
  if (delta < 0) return { label: `${String(-delta)}일 지연`, className: 'text-rose-700' };
  if (delta === 0) return { label: '오늘', className: 'text-amber-700' };
  return { label: `D-${String(delta)}`, className: 'text-blue-600' };
};

function selectView(next: View): void {
  view.value = next;
  if (next !== 'partners') filters.value = { ...filters.value, tab: next, page: 1 };
}
function applySearch(): void {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
}

/** 협력사별 탭에서 행을 누르면 그 협력사의 발주만 추린다 — 조감 → 실행 동선.
 *  검색어도 함께 비운다 — 필터는 지워졌는데 입력창에 옛 검색어가 남아 있으면
 *  화면과 조건이 어긋나고, 엔터 한 번에 엉뚱한 결과가 나온다(재점검 #11). */
function drillPartner(partnerId: number): void {
  view.value = 'all';
  searchText.value = '';
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
          placeholder="프로젝트·협력사·고객명·견적번호"
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

      <!-- 통화별 소계 — 목록 한 열에 ₩·$가 섞이므로 합계는 통화별로만 뜻이 있다 -->
      <div v-if="byCurrency.length > 0" class="flex flex-wrap items-center gap-2 text-xs">
        <span class="font-semibold text-gray-500">통화별 소계</span>
        <span
          v-for="c in byCurrency"
          :key="c.currency"
          class="rounded-lg border border-gray-200 bg-surface px-2.5 py-1 tabular-nums text-gray-600"
        >
          <b class="mr-1 text-gray-700">{{ c.currency }}</b>
          발주 {{ fmtPcbAmount(c.currency, c.poAmount) }} ·
          송금 {{ fmtPcbAmount(c.currency, c.paidAmount) }} ·
          잔액
          <b :class="c.balance > 0 ? 'text-rose-700' : 'text-gray-400'">
            {{ fmtPcbAmount(c.currency, c.balance) }}
          </b>
          <span class="ml-1 text-gray-400">({{ c.poCount }}건)</span>
        </span>
        <span class="text-gray-400">무상 A/S 제외</span>
      </div>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">견적</th>
              <th class="px-4 py-2.5">프로젝트</th>
              <th class="px-4 py-2.5">고객명</th>
              <th class="px-4 py-2.5">협력사</th>
              <th class="whitespace-nowrap px-4 py-2.5">발주 상태</th>
              <th class="whitespace-nowrap px-4 py-2.5">결제조건</th>
              <th class="whitespace-nowrap px-4 py-2.5">송금 예정</th>
              <th class="whitespace-nowrap px-4 py-2.5">발주일</th>
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
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900" :title="row.projectName">
                {{ row.projectName }}
                <!-- A/S 회차 — 같은 프로젝트가 회차만큼 여러 줄로 선다(Case·포털과 같은 배지) -->
                <span v-if="row.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-700">
                  {{ row.reorderRound }}차
                </span>
              </td>
              <td class="px-4 py-2.5 text-gray-600">
                <PcbCustomerCell :name="row.customerName" :mb-id="row.mbId" />
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.partnerName }}</td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                  {{ PCB_PO_STATUS_LABELS[row.poStatus] }}
                </span>
              </td>
              <!-- 결제조건·경과일 — "언제까지 줘야 하나"를 이 화면에서 판단하려면 필요하다 -->
              <td class="max-w-[12rem] truncate px-4 py-2.5 text-xs text-gray-600" :title="row.paymentTerms ?? ''">
                {{ row.paymentTerms ?? '—' }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                {{ fmtKstDate(row.remittanceDueOn) }}
                <span
                  v-if="dueTiming(row) !== null"
                  class="ml-1 font-semibold tabular-nums"
                  :class="dueTiming(row)?.className"
                >{{ dueTiming(row)?.label }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs text-gray-500">
                {{ fmtKstDate(row.issuedAt) }}
                <span class="ml-1 tabular-nums text-gray-400">D+{{ elapsedDays(row.issuedAt) }}</span>
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
                <!-- 무상 A/S 회차 — 지급 대상이 아니다(잔액 0 취급). 지급 상태 대신 배지로. -->
                <span
                  v-if="row.isFreeAs"
                  class="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700"
                  title="무상 A/S 재생산 — 지급 대상이 아닙니다(발주가는 원가 참고)"
                >무상 A/S</span>
                <span v-else class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.summary.status]">
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
              <td colspan="14" class="px-4 py-10 text-center text-sm text-gray-400">
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
        협력사마다 통화가 달라 <b class="text-gray-700">통화별로 나눠</b> 셉니다.
        <b class="text-gray-700">KRW 환산 잔액</b>은 발주서의 회계 박제(발주 시점 환율) 기준 참고값이고,
        <b class="text-gray-700">실지급</b>은 송금 원장의 실제 환율로 나간 금액 합입니다 — 기준이 다르므로
        둘의 합이 발주 총액과 맞지 않는 것이 정상이며 그 차이가 환차입니다.
        <b class="text-gray-700">무상 A/S 회차는 모수에서 제외</b>됩니다.
      </p>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2.5">협력사</th>
              <th class="px-4 py-2.5">통화별 발주 · 송금 · 잔액</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">KRW 환산 잔액</th>
              <!-- '미송금'은 한 푼도 안 나간 건만 세는데 이름이 '잔액 있는 건'처럼 읽혔다
                   (0인데 옆 칸에 잔액이 뜨는 모순) — 이름을 사실대로 하고 잔여를 함께 낸다 -->
              <th class="whitespace-nowrap px-4 py-2.5 text-right">미착수 발주</th>
              <th class="whitespace-nowrap px-4 py-2.5 text-right">잔여 발주</th>
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
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                <span class="font-bold" :class="p.krwBalance > 0 ? 'text-rose-700' : 'text-gray-400'">
                  {{ fmtPcbAmount('KRW', p.krwBalance) }}
                </span>
                <!-- 실지급은 원장 실합(비례배분 추정 아님) — 환차가 여기서 드러난다 -->
                <p class="mt-0.5 text-[11px] font-normal text-gray-400">
                  실지급 {{ fmtPcbAmount('KRW', p.krwPaidAmount) }}
                  <span v-if="p.krwPaidRateMissing" class="ml-1 font-semibold text-amber-700" title="환율을 적지 않은 송금이 있어 실지급 합계에서 빠졌습니다">
                    일부 환율 미기입
                  </span>
                </p>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                <span :class="p.unpaidPoCount > 0 ? 'font-bold text-gray-800' : 'text-gray-400'">
                  {{ p.unpaidPoCount }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                <span :class="p.openPoCount > 0 ? 'font-bold text-rose-700' : 'text-gray-400'">
                  {{ p.openPoCount }}
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">
                {{ p.lastRemittedOn === null ? '—' : fmtKstDate(p.lastRemittedOn) }}
              </td>
            </tr>
            <tr v-if="(partners.data.value?.data.rows ?? []).length === 0">
              <td colspan="6" class="px-4 py-10 text-center text-sm text-gray-400">
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
