<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import {
  ADMIN_PCB_REMITTANCE_TAB_LABELS,
  ADMIN_PCB_REMITTANCE_TABS,
  PCB_PO_STATUS_LABELS,
  type AdminPcbRemittanceItemType,
  type AdminPcbRemittanceTabType,
} from '@sp/api-contract';
import { fmtKstDate, kstDateOnly, kstToday } from '@sp/utils';
import {
  useAdminPcbRemittancePartners,
  useAdminPcbRemittances,
  type AdminPcbRemittanceFilters,
} from '@/admin/useAdminPcbRemittances';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CustomerCell from '@/next/components/pcb/CustomerCell.vue';
import RemittancePanel from '@/next/components/pcb/RemittancePanel.vue';
import {
  PCB_FREE_AS_BADGE,
  pcbReorderRoundBadge,
  pcbRemittanceStatusBadge,
} from '@/next/components/pcb/remittance/remittance-badges';

// PCB 송금 워크큐(P3.11) — 경리·재무 역할 화면. 역할별 워크큐 교리(D12) 그대로 첫 탭이 대기 큐
// (= 발주됐는데 한 푼도 안 나간 건)이고 배지도 그 수다. '협력사별' 탭은 "파트너사에 송금했는지"
// 조감 — 통화별 잔액 한 줄.

type View = AdminPcbRemittanceTabType | 'partners';
type LastRemittedFilterMode = 'single' | 'range';
type LastRemittedPreset = 'today' | 'thisMonth' | 'lastMonth';
const route = useRoute();
const router = useRouter();
const VIEW_KEYS: readonly View[] = [...ADMIN_PCB_REMITTANCE_TABS, 'partners'];
const initialView = queryTab(route.query.tab, VIEW_KEYS, 'pending');
const view = ref<View>(initialView);
const isPartnerView = computed(() => view.value === 'partners');

const searchText = ref(queryString(route.query.q));
const partnerIdParam = Number(queryString(route.query.partnerId));
const filters = ref<AdminPcbRemittanceFilters>({
  tab: initialView === 'partners' ? 'pending' : initialView,
  q: searchText.value,
  page: queryPage(route.query.page),
  pageSize: 20,
  lastRemittedFrom: queryString(route.query.lastRemittedFrom),
  lastRemittedTo: queryString(route.query.lastRemittedTo),
  ...(Number.isInteger(partnerIdParam) && partnerIdParam > 0 ? { partnerId: partnerIdParam } : {}),
});
const list = useAdminPcbRemittances(filters);
const partners = useAdminPcbRemittancePartners(isPartnerView);
const partnerRows = computed(() => partners.data.value?.data.rows ?? []);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? { pending: 0, partial: 0, done: 0, all: 0 });
/** 통화별 소계(서버 계산 — 페이지가 아니라 조건 전체). ₩와 $가 한 열에 섞이므로 합계는
 *  통화별로만 뜻이 있다 = 이게 없으면 이 화면에 "얼마 남았나"의 답이 없다. */
const byCurrency = computed(() => list.data.value?.data.byCurrency ?? []);

const tabs = computed<QueueTab<View>[]>(() => [
  ...ADMIN_PCB_REMITTANCE_TABS.map((key) => ({
    key,
    label: ADMIN_PCB_REMITTANCE_TAB_LABELS[key],
    count: counts.value[key],
    attention: key === 'pending',
  })),
  { key: 'partners', label: '협력사별' },
]);

/** 발주일로부터 며칠 지났나 — 결제조건(예: T/T 30 DAYS)과 짝이라야 뜻이 산다. */
const elapsedDays = (iso: string): number => {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
};

const DAY_MS = 86_400_000;
/** 미지급 잔액이 있는 행만 예정일의 남은 날/지연을 말한다. 완납 뒤에는 과거 일정 경고를 끈다. */
const dueTiming = (row: AdminPcbRemittanceItemType): { label: string; className: string } | null => {
  const dueOn = kstDateOnly(row.remittanceDueOn);
  if (dueOn === null || row.summary.balance <= 0) return null;
  const delta = Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${kstToday()}T00:00:00Z`)) / DAY_MS);
  if (delta < 0) return { label: `${String(-delta)}일 지연`, className: 'text-destructive' };
  if (delta === 0) return { label: '오늘', className: 'text-warning' };
  return { label: `D-${String(delta)}`, className: 'text-info' };
};

// 최근 송금 필터 — 목록은 발주서 1행 + 전체 원장 누적이므로, 기간 중 임의 송금이 아니라 표에
// 보이는 summary.lastRemittedOn 을 검색한다. 송금 전·협력사 집계에는 적용하지 않는다.
const lastRemittedMode = ref<LastRemittedFilterMode>(
  filters.value.lastRemittedFrom !== '' && filters.value.lastRemittedFrom !== filters.value.lastRemittedTo
    ? 'range'
    : 'single',
);
const lastRemittedSingle = ref(
  filters.value.lastRemittedFrom === filters.value.lastRemittedTo ? filters.value.lastRemittedFrom : '',
);
const lastRemittedFrom = ref(filters.value.lastRemittedFrom);
const lastRemittedTo = ref(filters.value.lastRemittedTo);
const lastRemittedPreset = ref<'' | LastRemittedPreset>('');
const lastRemittedError = ref('');
const lastRemittedFiltered = computed(
  () => filters.value.lastRemittedFrom !== '' && filters.value.lastRemittedTo !== '',
);
const lastRemittedFilterLabel = computed(() =>
  filters.value.lastRemittedFrom === filters.value.lastRemittedTo
    ? filters.value.lastRemittedFrom
    : `${filters.value.lastRemittedFrom} ~ ${filters.value.lastRemittedTo}`,
);

const setLastRemittedMode = (mode: LastRemittedFilterMode): void => {
  lastRemittedMode.value = mode;
  lastRemittedPreset.value = '';
  lastRemittedError.value = '';
};

const commitLastRemittedFilter = (from: string, to: string): void => {
  if (from === '' || to === '') {
    lastRemittedError.value =
      lastRemittedMode.value === 'single' ? '최근 송금일을 선택해 주세요.' : '시작일과 종료일을 모두 선택해 주세요.';
    return;
  }
  if (from > to) {
    lastRemittedError.value = '종료일은 시작일보다 빠를 수 없습니다.';
    return;
  }
  lastRemittedError.value = '';
  filters.value = { ...filters.value, lastRemittedFrom: from, lastRemittedTo: to, page: 1 };
};

const applyLastRemittedFilter = (): void => {
  lastRemittedPreset.value = '';
  const from = lastRemittedMode.value === 'single' ? lastRemittedSingle.value : lastRemittedFrom.value;
  const to = lastRemittedMode.value === 'single' ? lastRemittedSingle.value : lastRemittedTo.value;
  commitLastRemittedFilter(from, to);
};

const resetLastRemittedInputs = (): void => {
  lastRemittedSingle.value = '';
  lastRemittedFrom.value = '';
  lastRemittedTo.value = '';
  lastRemittedPreset.value = '';
  lastRemittedError.value = '';
};

const clearLastRemittedFilter = (): void => {
  resetLastRemittedInputs();
  filters.value = { ...filters.value, lastRemittedFrom: '', lastRemittedTo: '', page: 1 };
};

const ymd = (date: Date): string => date.toISOString().slice(0, 10);
const presetLastRemittedRange = (preset: LastRemittedPreset): { from: string; to: string } => {
  const today = new Date(`${kstToday()}T00:00:00Z`);
  if (preset === 'today') return { from: ymd(today), to: ymd(today) };
  if (preset === 'thisMonth') {
    return { from: ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: ymd(today) };
  }
  return {
    from: ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))),
    to: ymd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))),
  };
};

const applyLastRemittedPreset = (event: Event): void => {
  const preset = (event.target as HTMLSelectElement).value;
  if (preset !== 'today' && preset !== 'thisMonth' && preset !== 'lastMonth') return;
  const range = presetLastRemittedRange(preset);
  lastRemittedPreset.value = preset;
  if (preset === 'today') {
    lastRemittedMode.value = 'single';
    lastRemittedSingle.value = range.from;
  } else {
    lastRemittedMode.value = 'range';
    lastRemittedFrom.value = range.from;
    lastRemittedTo.value = range.to;
  }
  commitLastRemittedFilter(range.from, range.to);
};

// 날짜를 손으로 고치면 빠른 선택 표시는 풀린다(선택값과 입력이 어긋나 보이지 않게).
const onDateInput = (target: 'single' | 'from' | 'to', value: string | number): void => {
  const text = String(value);
  if (target === 'single') lastRemittedSingle.value = text;
  else if (target === 'from') lastRemittedFrom.value = text;
  else lastRemittedTo.value = text;
  lastRemittedPreset.value = '';
};

watch(view, (next) => {
  if (next === 'partners' || next === 'pending') {
    // 협력사별 집계·송금 대기에는 실제 송금일이 없다 — 최근 송금 조건을 떼고 넘어간다.
    resetLastRemittedInputs();
    filters.value = {
      ...filters.value,
      ...(next === 'pending' ? { tab: next } : {}),
      lastRemittedFrom: '',
      lastRemittedTo: '',
      page: 1,
    };
    return;
  }
  filters.value = { ...filters.value, tab: next, page: 1 };
});
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
watch(
  [view, filters],
  () => {
    replacePcbListQuery(router, route.query, {
      tab: view.value,
      page: filters.value.page,
      q: filters.value.q,
      extra: {
        lastRemittedFrom: filters.value.lastRemittedFrom,
        lastRemittedTo: filters.value.lastRemittedTo,
        partnerId: filters.value.partnerId,
      },
    });
  },
  { deep: true, immediate: true },
);

/** 협력사별 탭에서 행을 누르면 그 협력사의 발주만 추린다 — 조감 → 실행 동선. 검색어도 함께
 *  비운다(필터는 지워졌는데 입력창에 옛 검색어가 남으면 화면과 조건이 어긋난다). */
function drillPartner(partnerId: number): void {
  searchText.value = '';
  resetLastRemittedInputs();
  const next: AdminPcbRemittanceFilters = {
    tab: 'all',
    q: '',
    page: 1,
    pageSize: 20,
    lastRemittedFrom: '',
    lastRemittedTo: '',
    partnerId,
  };
  // filters 를 먼저 세운다 — 뒤따르는 view 감시가 {...filters} 를 펼쳐 쓰므로 partnerId 가 살아남는다.
  filters.value = next;
  view.value = 'all';
}
function clearPartnerFilter(): void {
  filters.value = {
    tab: filters.value.tab,
    q: filters.value.q,
    page: 1,
    pageSize: filters.value.pageSize,
    lastRemittedFrom: filters.value.lastRemittedFrom,
    lastRemittedTo: filters.value.lastRemittedTo,
  };
}

// 송금 기록 패널 — 발주서 1건의 원장을 열고 닫는다.
const panelPoId = ref<number | null>(null);
const openPanel = (row: AdminPcbRemittanceItemType): void => {
  panelPoId.value = row.poId;
};

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'remittances', route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="PCB 송금">
      <template #description>
        협력사에 나가는 돈을 발주서 단위로 기록합니다. 부분·분할 송금이 가능하며
        <span class="text-foreground font-medium">미지급 잔액 = 발주가 − 송금 합계</span>입니다.
      </template>
    </PageHeader>

    <QueueTabs v-model="view" :tabs="tabs">
      <template v-if="!isPartnerView" #end>
        <div class="flex min-w-0 flex-col items-end gap-1">
          <div class="flex flex-wrap items-center justify-end gap-2">
            <!-- 최근 송금 도구를 검색 바로 왼쪽에 둔다. 송금 대기는 실제 송금일이 없으므로 숨긴다. -->
            <form
              v-if="view !== 'pending'"
              class="flex flex-wrap items-center justify-end gap-1.5"
              @submit.prevent="applyLastRemittedFilter"
            >
              <span
                class="text-muted-foreground text-xs font-medium"
                title="발주서별 가장 최근 실제 송금일 기준입니다. 기간은 양끝 날짜를 모두 포함합니다."
              >최근 송금</span>
              <ButtonGroup role="group" aria-label="최근 송금일 검색 방식">
                <Button
                  type="button"
                  size="sm"
                  :variant="lastRemittedMode === 'single' ? 'default' : 'outline'"
                  :aria-pressed="lastRemittedMode === 'single'"
                  @click="setLastRemittedMode('single')"
                >
                  단일일
                </Button>
                <Button
                  type="button"
                  size="sm"
                  :variant="lastRemittedMode === 'range' ? 'default' : 'outline'"
                  :aria-pressed="lastRemittedMode === 'range'"
                  @click="setLastRemittedMode('range')"
                >
                  기간
                </Button>
              </ButtonGroup>

              <Input
                v-if="lastRemittedMode === 'single'"
                :model-value="lastRemittedSingle"
                type="date"
                aria-label="최근 송금일"
                class="w-37"
                @update:model-value="onDateInput('single', $event)"
              />
              <template v-else>
                <Input
                  :model-value="lastRemittedFrom"
                  type="date"
                  aria-label="최근 송금 시작일"
                  class="w-37"
                  @update:model-value="onDateInput('from', $event)"
                />
                <span class="text-muted-foreground">~</span>
                <Input
                  :model-value="lastRemittedTo"
                  type="date"
                  aria-label="최근 송금 종료일"
                  class="w-37"
                  @update:model-value="onDateInput('to', $event)"
                />
              </template>

              <NativeSelect
                :model-value="lastRemittedPreset"
                aria-label="최근 송금일 빠른 선택"
                @change="applyLastRemittedPreset"
              >
                <NativeSelectOption value="">빠른 선택</NativeSelectOption>
                <NativeSelectOption value="today">오늘</NativeSelectOption>
                <NativeSelectOption value="thisMonth">이번 달</NativeSelectOption>
                <NativeSelectOption value="lastMonth">지난달</NativeSelectOption>
              </NativeSelect>
              <Button type="submit">적용</Button>
              <Button v-if="lastRemittedFiltered" type="button" variant="outline" @click="clearLastRemittedFilter">
                초기화
              </Button>
            </form>

            <SearchInput v-model="searchText" placeholder="프로젝트·협력사·고객명·견적번호" @search="applySearch" />
          </div>
          <p v-if="lastRemittedError !== ''" role="alert" class="text-destructive text-xs font-medium">
            {{ lastRemittedError }}
          </p>
          <p v-else-if="lastRemittedFiltered" class="text-info text-xs font-medium">
            최근 송금 {{ lastRemittedFilterLabel }} 적용 · 송금액과 잔액은 발주별 전체 누적
          </p>
        </div>
      </template>
    </QueueTabs>

    <!-- ── 발주서별 지급 목록 ─────────────────────────────────────────── -->
    <template v-if="!isPartnerView">
      <p v-if="filters.partnerId !== undefined" class="text-muted-foreground flex items-center gap-1 text-sm">
        협력사 필터가 걸려 있습니다.
        <Button variant="link" size="xs" @click="clearPartnerFilter">전체 보기</Button>
      </p>

      <!-- 통화별 소계 — 목록 한 열에 ₩·$가 섞이므로 합계는 통화별로만 뜻이 있다 -->
      <div v-if="byCurrency.length > 0" class="flex flex-wrap items-center gap-2 text-xs">
        <span class="text-muted-foreground font-medium">통화별 소계</span>
        <span
          v-for="c in byCurrency"
          :key="c.currency"
          class="bg-card text-muted-foreground rounded-lg border px-2.5 py-1 tabular-nums"
        >
          <span class="text-foreground mr-1 font-semibold">{{ c.currency }}</span>
          발주 {{ fmtPcbAmount(c.currency, c.poAmount) }} · 송금 {{ fmtPcbAmount(c.currency, c.paidAmount) }} · 잔액
          <span class="font-semibold" :class="c.balance > 0 ? 'text-destructive' : 'text-muted-foreground'">
            {{ fmtPcbAmount(c.currency, c.balance) }}
          </span>
          <span class="ml-1">({{ c.poCount }}건)</span>
        </span>
        <span class="text-muted-foreground">무상 A/S 제외</span>
      </div>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>견적</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>고객명</TableHead>
              <TableHead>협력사</TableHead>
              <TableHead>발주 상태</TableHead>
              <TableHead>결제조건</TableHead>
              <TableHead>송금 예정</TableHead>
              <TableHead>발주일</TableHead>
              <TableHead class="text-right">발주가</TableHead>
              <TableHead class="text-right">송금액</TableHead>
              <TableHead class="text-right">잔액</TableHead>
              <TableHead>지급</TableHead>
              <TableHead>최근 송금</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in rows" :key="row.poId" class="cursor-pointer" @click="openPanel(row)">
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  <span class="text-muted-foreground font-mono text-xs">Q{{ row.specId }}</span>
                  <Badge v-if="row.isLegacy" variant="outline" title="레거시 이관 건">이관</Badge>
                </span>
              </TableCell>
              <TableCell>
                <span class="inline-flex max-w-xs items-center gap-1.5">
                  <span class="truncate font-medium" :title="row.projectName">{{ row.projectName }}</span>
                  <!-- A/S 회차 — 같은 프로젝트가 회차만큼 여러 줄로 선다(Case·포털과 같은 배지) -->
                  <Badge v-if="row.reorderRound > 0" :variant="pcbReorderRoundBadge(row.reorderRound).variant">
                    {{ pcbReorderRoundBadge(row.reorderRound).label }}
                  </Badge>
                </span>
              </TableCell>
              <TableCell>
                <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground">{{ row.partnerName }}</span>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{{ PCB_PO_STATUS_LABELS[row.poTrack][row.poStatus] }}</Badge>
              </TableCell>
              <!-- 결제조건·경과일 — "언제까지 줘야 하나"를 이 화면에서 판단하려면 필요하다 -->
              <TableCell>
                <span class="text-muted-foreground block max-w-48 truncate text-xs" :title="row.paymentTerms ?? ''">
                  {{ row.paymentTerms ?? '—' }}
                </span>
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground text-xs">
                  {{ fmtKstDate(row.remittanceDueOn) }}
                  <span
                    v-if="dueTiming(row) !== null"
                    class="ml-1 font-semibold tabular-nums"
                    :class="dueTiming(row)?.className"
                  >{{ dueTiming(row)?.label }}</span>
                </span>
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground text-xs">
                  {{ fmtKstDate(row.issuedAt) }}
                  <span class="ml-1 tabular-nums">D+{{ elapsedDays(row.issuedAt) }}</span>
                </span>
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums">{{ fmtPcbAmount(row.summary.currency, row.summary.poAmount) }}</span>
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums">{{ fmtPcbAmount(row.summary.currency, row.summary.paidAmount) }}</span>
                <span v-if="row.summary.count > 1" class="text-muted-foreground ml-1 text-xs">{{ row.summary.count }}회</span>
              </TableCell>
              <TableCell class="text-right">
                <span
                  class="font-semibold tabular-nums"
                  :class="row.summary.balance > 0 ? 'text-destructive' : 'text-muted-foreground'"
                >
                  {{ fmtPcbAmount(row.summary.currency, row.summary.balance) }}
                </span>
              </TableCell>
              <TableCell>
                <!-- 무상 A/S 회차 — 지급 대상이 아니다(잔액 0 취급). 지급 상태 대신 배지로. -->
                <Badge
                  v-if="row.isFreeAs"
                  :variant="PCB_FREE_AS_BADGE.variant"
                  title="무상 A/S 재생산 — 지급 대상이 아닙니다(발주가는 원가 참고)"
                >
                  {{ PCB_FREE_AS_BADGE.label }}
                </Badge>
                <Badge v-else :variant="pcbRemittanceStatusBadge(row.summary.status).variant">
                  {{ pcbRemittanceStatusBadge(row.summary.status).label }}
                </Badge>
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground">
                  {{ row.summary.lastRemittedOn === null ? '—' : fmtKstDate(row.summary.lastRemittedOn) }}
                </span>
              </TableCell>
              <TableCell class="text-right">
                <span class="inline-flex items-center gap-1">
                  <Button size="sm" @click.stop="openPanel(row)">송금 기록</Button>
                  <Button variant="outline" size="sm" @click.stop="openCase(row.specId)">
                    Case
                    <ArrowRightIcon />
                  </Button>
                </span>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="rows.length === 0"
              :colspan="14"
              :loading="list.isFetching.value"
              text="해당하는 발주가 없습니다."
            />
          </TableBody>
        </Table>
      </TableCard>

      <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
    </template>

    <!-- ── 협력사별 잔액 조감 ─────────────────────────────────────────── -->
    <template v-else>
      <p class="text-muted-foreground text-sm">
        협력사마다 통화가 달라 <span class="text-foreground font-medium">통화별로 나눠</span> 셉니다.
        <span class="text-foreground font-medium">KRW 환산 잔액</span>은 발주서의 회계 박제(발주 시점 환율) 기준
        참고값이고, <span class="text-foreground font-medium">실지급</span>은 송금 원장의 실제 환율로 나간 금액 합입니다
        — 기준이 다르므로 둘의 합이 발주 총액과 맞지 않는 것이 정상이며 그 차이가 환차입니다.
        <span class="text-foreground font-medium">무상 A/S 회차는 모수에서 제외</span>됩니다.
      </p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>협력사</TableHead>
              <TableHead>통화별 발주 · 송금 · 잔액</TableHead>
              <TableHead class="text-right">KRW 환산 잔액</TableHead>
              <!-- '미착수'는 한 푼도 안 나간 건만 센다 — 이름을 사실대로 하고 잔여를 함께 낸다 -->
              <TableHead class="text-right">미착수 발주</TableHead>
              <TableHead class="text-right">잔여 발주</TableHead>
              <TableHead>최근 송금</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="p in partnerRows" :key="p.partnerId" class="cursor-pointer" @click="drillPartner(p.partnerId)">
              <TableCell>
                <span class="inline-flex items-baseline gap-1.5">
                  <span class="font-medium">{{ p.partnerName }}</span>
                  <span v-if="p.country !== null" class="text-muted-foreground text-xs">{{ p.country }}</span>
                </span>
              </TableCell>
              <TableCell>
                <div v-for="c in p.byCurrency" :key="c.currency" class="text-muted-foreground text-xs tabular-nums">
                  <span class="mr-1 font-semibold">{{ c.currency }}</span>
                  {{ fmtPcbAmount(c.currency, c.poAmount) }} · {{ fmtPcbAmount(c.currency, c.paidAmount) }} ·
                  <span class="font-semibold" :class="c.balance > 0 ? 'text-destructive' : 'text-muted-foreground'">
                    {{ fmtPcbAmount(c.currency, c.balance) }}
                  </span>
                  <span class="ml-1">({{ c.poCount }}건)</span>
                </div>
              </TableCell>
              <TableCell class="text-right">
                <span class="font-semibold tabular-nums" :class="p.krwBalance > 0 ? 'text-destructive' : 'text-muted-foreground'">
                  {{ fmtPcbAmount('KRW', p.krwBalance) }}
                </span>
                <!-- 실지급은 원장 실합(비례배분 추정 아님) — 환차가 여기서 드러난다 -->
                <span class="text-muted-foreground mt-0.5 block text-xs">
                  실지급 {{ fmtPcbAmount('KRW', p.krwPaidAmount) }}
                  <span
                    v-if="p.krwPaidRateMissing"
                    class="text-warning ml-1 font-semibold"
                    title="환율을 적지 않은 송금이 있어 실지급 합계에서 빠졌습니다"
                  >일부 환율 미기입</span>
                </span>
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums" :class="p.unpaidPoCount > 0 ? 'font-semibold' : 'text-muted-foreground'">
                  {{ p.unpaidPoCount }}
                </span>
              </TableCell>
              <TableCell class="text-right">
                <span class="tabular-nums" :class="p.openPoCount > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'">
                  {{ p.openPoCount }}
                </span>
              </TableCell>
              <TableCell>
                <span class="text-muted-foreground">{{ p.lastRemittedOn === null ? '—' : fmtKstDate(p.lastRemittedOn) }}</span>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="partnerRows.length === 0"
              :colspan="6"
              :loading="partners.isFetching.value"
              text="발주가 있는 협력사가 없습니다."
            />
          </TableBody>
        </Table>
      </TableCard>
    </template>

    <RemittancePanel v-if="panelPoId !== null" :po-id="panelPoId" @close="panelPoId = null" />
  </div>
</template>
