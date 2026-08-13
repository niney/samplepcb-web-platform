<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  PCB_PO_STATUS_LABELS,
  isPcbDeliveryOverdue,
  type AdminPcbPoTabType,
  type AdminPcbPoWorkItemType,
} from '@sp/api-contract';
import { fmtKstDate as fmtDate, kstDateOnly, kstToday } from '@sp/utils';
import { useAdminPcbPoWork, type AdminPcbPoWorkFilters } from '../../admin/useAdminPcbPos';
import { useAdminPcbTodoCounts } from '../../admin/useAdminPcbCases';
import PcbCustomerCell from '../../components/admin/pcb/PcbCustomerCell.vue';
import PcbTodoQueue from '../../components/admin/pcb/PcbTodoQueue.vue';
import { fmtPcbAmount, pcbKrwSuffix } from '../../lib/pcb-money';
import {
  PCB_EQ_REVIEW_BADGE_CLS,
  pcbEqReviewBadgeLabel,
  pcbEqReviewState,
  pcbEqReviewTitle,
} from '../../lib/pcb-eq-review';
import {
  pcbDetailQuery,
  queryPage,
  queryString,
  queryTab,
  replacePcbListQuery,
} from '../../admin/pcb-navigation';

// PCB 발주·EQ 워크큐(P2) — 구매 담당의 화면. 큐 흐름:
//   발주 대기(결제 완료+미발주 — 스펙 축) → EQ 승인 대기 → 생산 진행 → 생산완료.
// 첫 탭이 스펙 축인 이유: 발주서가 아직 없는 건은 PO 축 모수에 들어올 수 없어,
// "발주해야 할 건"이 어느 화면에도 안 보였다(SmartBOM 발주 메뉴와 같은 해법).
// 실작업 발주서 단위(MD 경유 상위는 서버가 제외)이고, 조작은 전부 Case 상세.

type PosTabKey = AdminPcbPoTabType | 'awaiting';
type DeliveryFilterMode = 'single' | 'range';

const route = useRoute();
const router = useRouter();
const tab = ref<PosTabKey>(
  queryTab(
    route.query.tab,
    ['awaiting', 'waiting', 'eq_pending', 'producing', 'produced', 'all'] as const,
    'awaiting',
  ),
);
const filters = ref<AdminPcbPoWorkFilters>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: tab.value === 'awaiting' ? 'eq_pending' : tab.value,
  q: queryString(route.query.q),
  deliveryFrom: queryString(route.query.deliveryFrom),
  deliveryTo: queryString(route.query.deliveryTo),
});
const list = useAdminPcbPoWork(filters);
const isAdminUser = computed(() => true); // 이 화면 자체가 관리자 전용 라우트
const { todoPo } = useAdminPcbTodoCounts(isAdminUser);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const TABS: { key: PosTabKey; label: string }[] = [
  { key: 'awaiting', label: '발주 대기' },
  // 협력사 차례 — 관리자가 지금 누를 것은 없지만 **재촉해야 할 대상**이라 조감한다.
  // 이 탭이 없던 동안 발주 후 무소식인 건(반려 뒤 보완 대기 포함)이 '전체'에만 있었다.
  { key: 'waiting', label: '협력사 진행' },
  { key: 'eq_pending', label: 'EQ 승인 대기' },
  { key: 'producing', label: '생산 진행' },
  { key: 'produced', label: '생산완료' },
  { key: 'all', label: '전체' },
];
// 납기 경과 — 판정은 계약의 순수 함수(Case 상세와 같은 규칙). KST 날짜로 넘겨야 한다:
// 납기는 KST 자정 앵커라 ISO 를 그냥 자르면 하루 앞당겨진다.
const isOverdueRow = (row: AdminPcbPoWorkItemType): boolean =>
  isPcbDeliveryOverdue(row.status, kstDateOnly(row.deliveryDate), kstToday());

const tabCount = (key: PosTabKey): number | null =>
  key === 'awaiting' ? todoPo.value : counts.value === null ? null : counts.value[key];
const setTab = (key: PosTabKey): void => {
  tab.value = key;
  if (key !== 'awaiting') filters.value = { ...filters.value, tab: key, page: 1 };
};
const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

// 확정 납기 필터 — 단일일도 API에서는 from=to인 범위로 보내 서버 규칙을 한 벌만 둔다.
// 발주 대기 탭은 아직 PO와 확정 납기가 없으므로 필터 자체를 노출하지 않는다.
const hasDeliveryRange =
  filters.value.deliveryFrom !== '' && filters.value.deliveryTo !== '';
const deliveryMode = ref<DeliveryFilterMode>(
  hasDeliveryRange && filters.value.deliveryFrom !== filters.value.deliveryTo ? 'range' : 'single',
);
const deliverySingle = ref(
  hasDeliveryRange && filters.value.deliveryFrom === filters.value.deliveryTo
    ? filters.value.deliveryFrom
    : '',
);
const deliveryFrom = ref(filters.value.deliveryFrom);
const deliveryTo = ref(filters.value.deliveryTo);
const deliveryError = ref('');
const deliveryFiltered = computed(
  () => filters.value.deliveryFrom !== '' && filters.value.deliveryTo !== '',
);
const deliveryFilterLabel = computed(() =>
  filters.value.deliveryFrom === filters.value.deliveryTo
    ? filters.value.deliveryFrom
    : `${filters.value.deliveryFrom} ~ ${filters.value.deliveryTo}`,
);

const setDeliveryMode = (mode: DeliveryFilterMode): void => {
  deliveryMode.value = mode;
  deliveryError.value = '';
};
const applyDeliveryFilter = (): void => {
  const from = deliveryMode.value === 'single' ? deliverySingle.value : deliveryFrom.value;
  const to = deliveryMode.value === 'single' ? deliverySingle.value : deliveryTo.value;
  if (from === '' || to === '') {
    deliveryError.value =
      deliveryMode.value === 'single'
        ? '납기일을 선택해 주세요.'
        : '시작일과 종료일을 모두 선택해 주세요.';
    return;
  }
  if (from > to) {
    deliveryError.value = '종료일은 시작일보다 빠를 수 없습니다.';
    return;
  }
  deliveryError.value = '';
  filters.value = { ...filters.value, deliveryFrom: from, deliveryTo: to, page: 1 };
};
const clearDeliveryFilter = (): void => {
  deliverySingle.value = '';
  deliveryFrom.value = '';
  deliveryTo.value = '';
  deliveryError.value = '';
  filters.value = { ...filters.value, deliveryFrom: '', deliveryTo: '', page: 1 };
};
watch(
  [tab, filters],
  () => {
    replacePcbListQuery(router, route.query, {
      tab: tab.value,
      page: filters.value.page,
      q: filters.value.q,
      extra: {
        deliveryFrom: filters.value.deliveryFrom,
        deliveryTo: filters.value.deliveryTo,
      },
    });
  },
  { deep: true, immediate: true },
);

// EQ 고객 확인 축(D16) — 'EQ 승인 대기' 탭의 행들은 발주 상태가 모두 eq_requested 라
// 그것만으로는 "지금 승인하면 되는 건"과 "고객 답을 기다리는 건"이 섞인다. 그 갈림을
// 배지가 말한다. 승인 대기가 아니어도 결정이 있으면 남긴다(승인의 근거 — Case 와 동형).
const showEqReview = (row: AdminPcbPoWorkItemType): boolean =>
  row.status === 'eq_requested' || row.eqReview !== null;

const STATUS_CLS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-700',
  eq_requested: 'bg-amber-100 text-amber-700',
  eq_done: 'bg-sky-100 text-sky-700',
  producing: 'bg-indigo-100 text-indigo-700',
  produced: 'bg-emerald-100 text-emerald-700',
};

function openCase(specId: number): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: pcbDetailQuery('pos', route.fullPath),
  });
}
</script>

<template>
  <div class="pcb-readable space-y-4">
    <h1 class="text-xl font-bold">PCB 발주·EQ</h1>

    <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-gray-200">
      <div class="flex flex-wrap gap-1">
        <button
          v-for="entry in TABS"
          :key="entry.key"
          type="button"
          class="-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium"
          :class="tab === entry.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:bg-gray-50'"
          @click="setTab(entry.key)"
        >
          {{ entry.label }}
          <span v-if="tabCount(entry.key) !== null" class="ml-0.5 text-xs opacity-60">{{ tabCount(entry.key) }}</span>
        </button>
      </div>
      <div v-if="tab !== 'awaiting'" class="flex min-w-0 flex-col items-end gap-1 pb-1">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <!-- 납기 도구를 일반 검색 바로 왼쪽에 둔다. 전부 h-8로 맞춰 한 줄 정렬하고,
               폭이 좁으면 두 form이 함께 다음 줄로 자연스럽게 감긴다. -->
          <form class="flex flex-wrap items-center justify-end gap-1.5" @submit.prevent="applyDeliveryFilter">
            <span
              class="text-xs font-semibold text-gray-600"
              title="발주서의 확정 납기 기준입니다. 기간은 양끝 날짜를 모두 포함합니다."
            >납기</span>
            <fieldset class="inline-flex h-8 items-center rounded-md border border-gray-300 bg-surface p-0.5">
              <legend class="sr-only">납기일 검색 방식</legend>
              <button
                type="button"
                class="h-7 rounded px-2 text-xs font-semibold"
                :class="deliveryMode === 'single' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
                @click="setDeliveryMode('single')"
              >
                단일일
              </button>
              <button
                type="button"
                class="h-7 rounded px-2 text-xs font-semibold"
                :class="deliveryMode === 'range' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
                @click="setDeliveryMode('range')"
              >
                기간
              </button>
            </fieldset>

            <input
              v-if="deliveryMode === 'single'"
              v-model="deliverySingle"
              type="date"
              aria-label="납기일"
              class="h-8 w-[9.25rem] rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none"
            >
            <template v-else>
              <input
                v-model="deliveryFrom"
                type="date"
                aria-label="납기 시작일"
                class="h-8 w-[9.25rem] rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none"
              >
              <span class="text-gray-400">~</span>
              <input
                v-model="deliveryTo"
                type="date"
                aria-label="납기 종료일"
                class="h-8 w-[9.25rem] rounded-md border border-gray-300 bg-surface px-2 text-sm focus:border-blue-500 focus:outline-none"
              >
            </template>

            <button
              type="submit"
              class="h-8 rounded-md bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              적용
            </button>
            <button
              v-if="deliveryFiltered"
              type="button"
              class="h-8 rounded-md border border-gray-300 bg-surface px-2.5 text-xs text-gray-600 hover:bg-gray-100"
              @click="clearDeliveryFilter"
            >
              초기화
            </button>
          </form>

          <form @submit.prevent="applySearch">
            <input
              v-model="searchText"
              type="search"
              placeholder="프로젝트·협력사·고객명 검색"
              class="h-8 w-56 rounded-md border border-gray-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
            >
          </form>
        </div>
        <p v-if="deliveryError !== ''" role="alert" class="text-xs font-semibold text-red-600">
          {{ deliveryError }}
        </p>
        <p v-else-if="deliveryFiltered" class="text-xs font-semibold text-blue-700">
          납기 {{ deliveryFilterLabel }} 적용 · 납기 미정 제외
        </p>
      </div>
    </div>

    <!-- 발주 대기 — 발주서가 아직 없는 스펙 축(PO 축에는 존재하지 않는 모수) -->
    <PcbTodoQueue
      v-if="tab === 'awaiting'"
      kind="todo_po"
      from="pos"
      action-label="발주하기 →"
      empty-text="발주 대기 건이 없습니다."
    />

    <template v-else>
      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="whitespace-nowrap px-4 py-2.5">발주</th>
              <th class="px-4 py-2.5">프로젝트</th>
              <th class="px-4 py-2.5">고객명</th>
              <th class="px-4 py-2.5">협력사</th>
              <th class="whitespace-nowrap px-4 py-2.5">발주가</th>
              <th class="whitespace-nowrap px-4 py-2.5">상태</th>
              <th class="whitespace-nowrap px-4 py-2.5">납기</th>
              <th class="whitespace-nowrap px-4 py-2.5">발주일</th>
              <th class="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr
              v-for="row in rows"
              :key="row.poId"
              class="cursor-pointer hover:bg-blue-50/40"
              :class="row.adminTurn ? 'bg-amber-50/50' : ''"
              @click="openCase(row.specId)"
            >
              <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">
                PO-{{ row.poId }}<span v-if="row.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-semibold text-rose-700">{{ row.reorderRound }}차</span>
              </td>
              <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                <span class="font-mono text-xs text-gray-400">Q{{ row.specId }}</span>
                {{ row.projectName }}
              </td>
              <td class="px-4 py-2.5 text-gray-600">
                <PcbCustomerCell :name="row.customerName" :mb-id="row.mbId" />
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">
                {{ row.partnerName }}
                <span v-if="row.parentPartnerName !== null" class="ml-1 text-xs text-indigo-500">
                  (MD {{ row.parentPartnerName }})
                </span>
                <!-- 이 줄은 협력사가 스스로 진행할 수 없다 — 큐에서 기다리면 영영 안 온다. -->
                <span
                  v-if="!row.partnerHasPortal"
                  class="ml-1 rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700"
                  title="포털 연결 계정이 없는 조직입니다 — 이 단계는 관리자 대행으로만 진행됩니다."
                >
                  대행 필요
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 tabular-nums">
                {{ fmtPcbAmount(row.currency, row.priceOriginal) }}
                <span class="text-xs text-gray-400">{{ pcbKrwSuffix(row.currency, row.krwAmount) }}</span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[row.status]">
                  {{ PCB_PO_STATUS_LABELS[row.status] }}
                </span>
                <span v-if="row.adminTurn" class="ml-1 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                  내 차례
                </span>
                <!-- 반려 뒤 보완 대기 — 같은 '발주접수'라도 "아직 안 온 건"과 "돌려보낸 건"은
                     관리자가 할 말이 다르다(후자는 사유가 이미 나갔다). -->
                <span
                  v-if="row.status === 'issued' && row.rejectedAt !== null"
                  class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
                  :title="`${fmtDate(row.rejectedAt)} 반려 — 협력사가 보완 중입니다. 사유·회신 첨부는 Case 상세에서 볼 수 있습니다.`"
                >
                  반려됨 {{ fmtDate(row.rejectedAt) }}
                </span>
                <span
                  v-if="showEqReview(row)"
                  class="ml-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
                  :class="PCB_EQ_REVIEW_BADGE_CLS[pcbEqReviewState(row.eqReview)]"
                  :title="pcbEqReviewTitle(row.eqReview)"
                >
                  {{ pcbEqReviewBadgeLabel(row.eqReview) }}
                </span>
              </td>
              <!-- 납기가 지났으면 그렇게 말한다(여정 14호) — 날짜만 회색으로 찍으면 관리자가
                   목록에서 오늘과 하나하나 비교해야 하고, 탭이 수십 건이면 넘긴 건이 묻힌다. -->
              <td
                class="whitespace-nowrap px-4 py-2.5"
                :class="isOverdueRow(row) ? 'font-semibold text-red-600' : 'text-gray-500'"
              >
                {{ fmtDate(row.deliveryDate) }}
                <span
                  v-if="isOverdueRow(row)"
                  class="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700"
                  title="납기일이 지났는데 아직 생산완료가 아닙니다."
                >
                  납기 초과
                </span>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.issuedAt) }}</td>
              <td class="whitespace-nowrap px-4 py-2.5 text-right">
                <button
                  type="button"
                  class="rounded-md border border-blue-200 px-2.5 py-[3px] text-xs font-semibold text-blue-700 hover:bg-blue-50"
                  @click.stop="openCase(row.specId)"
                >
                  Case 열기 →
                </button>
              </td>
            </tr>
            <tr v-if="rows.length === 0">
              <td colspan="9" class="px-4 py-10 text-center text-sm text-gray-400">
                해당 상태의 발주서가 없습니다 — 발행은 [발주 대기] 탭에서 시작합니다.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="totalPages > 1" class="flex items-center gap-2 text-sm">
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
    </template>
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
