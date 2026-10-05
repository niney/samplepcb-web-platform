<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon, QrCodeIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_PO_STATUS_LABELS,
  SHIPMENT_TRANSPORT_LABELS,
  type AdminPcbOrderItemType,
  type AdminPcbShipmentTabType,
  type AdminPcbShipmentWorkItemType,
} from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '@/lib/pcb-shipment-label';
import { fmtPcbAmount } from '@/lib/pcb-money';
import {
  adminPcbPackageApi,
  useAdminPcbPoWork,
  useAdminPcbShipmentWork,
  type AdminPcbPoWorkFilters,
  type AdminPcbShipmentFilters,
} from '@/admin/useAdminPcbPos';
import {
  useAdminPcbOrderWork,
  usePcbCompleteCustomerOrder,
  type AdminPcbOrderFilters,
} from '@/admin/useAdminPcbOrders';
import { confirmDialog } from '@/next/lib/dialog';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import ListPagination from '@/next/components/common/ListPagination.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import CustomerCell from '@/next/components/pcb/CustomerCell.vue';
import CustomerShipDialog from '@/next/components/pcb/CustomerShipDialog.vue';
import PackageLabelsDialog from '@/next/components/pcb/PackageLabelsDialog.vue';
import { pcbShipmentStatusVariant } from '@/next/components/pcb/pcb-badges';

// PCB 선적·배송 워크큐(P3·P4.6) — 물류 담당의 화면. SmartBOM 물류와 같은 두 섹션 골격(D9 미러):
//   ① 협력사 선적(협력사 → 자사·MD): 발송 대기(생산완료·미편성 — 발주서 축) → 입고·처리 대기
//      (내 차례) → 이동 중 → 입고 완료 — 선적 축.
//   ② 고객 배송(자사 → 고객): 배송 처리 대기 → 배송 중 — 주문 축.
// 축이 세 번 바뀌는 이유: 발송 문서가 생기기 전 건은 선적 축 모수에 없고(발주서 축), 입고확인은
// 협력 축의 종점이라 그다음 일(고객 발송)은 od 를 모수로 잡아야 보인다. 방향이 뒤집히는 지점
// (자사 → 고객)만 섹션 경계다. 협력 축 조작(전이/입고확인/송장)은 Case 상세, 고객 발송·구매확정만
// 여기서 바로 처리한다.

type ShipTabKey = AdminPcbShipmentTabType | 'to_ship';

const route = useRoute();
const router = useRouter();
const tab = ref<ShipTabKey>(
  queryTab(route.query.tab, ['to_ship', 'pending', 'active', 'received', 'all'] as const, 'to_ship'),
);
const initialPage = queryPage(route.query.page);
const initialSearch = queryString(route.query.q);

// 협력사 구간(하위→MD) 표시 — MD 경유 건은 한 건이 선적 두 장으로 갈라져 같은 고객·프로젝트가
// 두 줄로 보인다. 기본은 숨김(사용자 결정 08-14): 물류의 일상 화면은 자사향 구간이고, 숨긴 수는
// hiddenMdCount 안내가 알린다. 켠 취향은 기억한다(옛 화면과 같은 키 — 같은 사람의 같은 취향).
const MD_LEGS_LS = 'pcb-ship-md-legs';
const readMdLegs = (): boolean => {
  try {
    return localStorage.getItem(MD_LEGS_LS) === '1';
  } catch {
    return false;
  }
};
const showMdLegs = ref(readMdLegs());
const filters = ref<AdminPcbShipmentFilters>({
  page: initialPage,
  pageSize: 20,
  tab: tab.value === 'to_ship' ? 'pending' : tab.value,
  q: initialSearch,
  mdLegs: showMdLegs.value ? 'show' : 'hide',
});
watch(showMdLegs, (show) => {
  try {
    localStorage.setItem(MD_LEGS_LS, show ? '1' : '0');
  } catch {
    // 저장 불가 환경에서는 이번 화면에만 적용한다.
  }
  filters.value = { ...filters.value, mdLegs: show ? 'show' : 'hide', page: 1 };
});
const list = useAdminPcbShipmentWork(filters);
// 숨김이 침묵하지 않게 — 검색 조건에서 걸러진 협력사 구간 수(서버 계산).
const hiddenMdCount = computed(() => list.data.value?.data.hiddenMdCount ?? 0);

// 발송 대기 = 발주서 축(produced·미편성) — 선적 문서가 아직 없으니 PO 워크큐에서 가져온다.
const poFilters = ref<AdminPcbPoWorkFilters>({
  page: initialPage,
  pageSize: 20,
  tab: 'to_ship',
  q: initialSearch,
  deliveryFrom: '',
  deliveryTo: '',
});
const poQuery = useAdminPcbPoWork(poFilters);
const toShipRows = computed(() => poQuery.data.value?.data.items ?? []);
const toShipTotal = computed(() => poQuery.data.value?.data.total ?? 0);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const poTotal = computed(() => list.data.value?.data.poTotal ?? 0);
const counts = computed(() => list.data.value?.data.counts ?? null);

const labelShipmentId = ref<number | null>(null);
const labelsApi = computed(() => (labelShipmentId.value === null ? null : adminPcbPackageApi(labelShipmentId.value)));

// 검색 — 두 축(발주서 축 to_ship · 선적 축 나머지 탭) 모두에 같은 검색어를 태운다. 탭을 오가며
// 같은 건을 찾는 화면이라 입력을 하나만 둔다(제출 시 적용).
const searchText = ref(initialSearch);
const applySearch = (): void => {
  poFilters.value = { ...poFilters.value, q: searchText.value, page: 1 };
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

// 입고·처리 대기는 관리자 차례(입고·수취 처리)라 건수를 강조한다. 발송 대기는 협력사가 움직일 칸.
const tabs = computed<QueueTab<ShipTabKey>[]>(() => [
  { key: 'to_ship', label: '발송 대기', count: poQuery.data.value?.data.counts.to_ship ?? null },
  { key: 'pending', label: '입고·처리 대기', count: counts.value?.pending ?? null, attention: true },
  { key: 'active', label: '이동 중', count: counts.value?.active ?? null },
  { key: 'received', label: '입고 완료', count: counts.value?.received ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);
watch(tab, (key) => {
  if (key !== 'to_ship') filters.value = { ...filters.value, tab: key, page: 1 };
});

// ── ② 고객 배송 — 주문 축(P4.6): 입고확인이 끝났는데 od 가 배송 전(to_ship)·배송 중.
//    판정·counts 는 서버(/admin/pcb-orders — 협력 축 입고 신호 기반, 이관분 자연 제외).
type OrderTabKey = 'to_ship' | 'shipping';
const orderFilters = ref<AdminPcbOrderFilters>({
  page: queryPage(route.query.customerPage),
  pageSize: 20,
  tab: queryTab(route.query.customerTab, ['to_ship', 'shipping'] as const, 'to_ship'),
  q: initialSearch,
});
const orderQuery = useAdminPcbOrderWork(orderFilters);
const orderRows = computed(() => orderQuery.data.value?.data.items ?? []);
const orderTotal = computed(() => orderQuery.data.value?.data.total ?? 0);
const orderTab = computed<OrderTabKey>({
  get: () => (orderFilters.value.tab === 'shipping' ? 'shipping' : 'to_ship'),
  set: (key) => {
    orderFilters.value = { ...orderFilters.value, tab: key, page: 1 };
  },
});
const orderTabs = computed<QueueTab<OrderTabKey>[]>(() => {
  const c = orderQuery.data.value?.data.counts ?? null;
  return [
    { key: 'to_ship', label: '배송 처리 대기', count: c?.toShip ?? null, attention: true },
    { key: 'shipping', label: '배송 중', count: c?.shipping ?? null },
  ];
});

watch(
  [tab, filters, poFilters, orderFilters],
  () => {
    replacePcbListQuery(router, route.query, {
      tab: tab.value,
      page: tab.value === 'to_ship' ? poFilters.value.page : filters.value.page,
      q: filters.value.q,
      extra: {
        customerTab: orderFilters.value.tab,
        customerPage: orderFilters.value.page > 1 ? orderFilters.value.page : undefined,
      },
    });
  },
  { deep: true, immediate: true },
);

// 고객 배송 액션 — 배송 처리(공용 대화상자)·구매확정
const allReceived = (item: AdminPcbOrderItemType): boolean =>
  item.poCount > 0 && item.receivedPoCount >= item.poCount;

const shipOdId = ref<string | null>(null);
const shipIncomplete = ref(false);
// 대화상자가 "어느 고객 건인지"를 말할 수 있게 행에서 같이 넘긴다(주문번호만으론 확인 불가).
const shipCustomerLabel = ref('');
const shipProjectName = ref('');
function openShip(item: AdminPcbOrderItemType): void {
  shipOdId.value = item.odId;
  shipIncomplete.value = !allReceived(item);
  shipCustomerLabel.value =
    item.customerName !== '' ? `${item.customerName} (${item.mbId ?? '비회원'})` : (item.mbId ?? '비회원');
  shipProjectName.value = item.projectName;
}

const completeMut = usePcbCompleteCustomerOrder();
const actionError = ref('');
async function completeOrder(item: AdminPcbOrderItemType): Promise<void> {
  if (!(await confirmDialog(`주문 ${item.odId} 을 구매확정(완료) 처리할까요?`))) return;
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '구매확정에 실패했습니다.';
  }
}

// [직송 완료](정책 확정 08-10) — 직송 건은 실물이 자사를 안 거쳐 관리자가 보낼 것이 없는데, od 종결
// 창구는 이 큐뿐이다. 그래서 큐에 남기되 운송장 입력 없이 코어 force-status '완료'(구매확정과 같은
// 전이 — 재고 앵커는 완료 진입 차감이라 보존)로 닫는다.
async function completeDirectOrder(item: AdminPcbOrderItemType): Promise<void> {
  if (item.directShipCountry === null) return;
  if (
    !(await confirmDialog(
      `직송 건 — 고객이 현지(${item.directShipCountry})에서 수령했습니다. 주문을 완료로 종결합니다.`,
    ))
  ) {
    return;
  }
  actionError.value = '';
  try {
    await completeMut.mutateAsync(item.odId);
  } catch (e) {
    actionError.value = e instanceof ApiRequestError ? e.message : '직송 완료 처리에 실패했습니다.';
  }
}

// 앞 구간(하위→MD) 미니칩 — 자사향 행에서 앞 구간 병목을 읽는다(서버 mdLeg 교차 표기).
type MdLegSignal = NonNullable<AdminPcbShipmentWorkItemType['members'][number]['mdLeg']>;
const mdLegLabel = (leg: MdLegSignal): string =>
  leg.receivedAt !== null ? 'MD 입고완료' : pcbShipmentStatusLabel(leg.mode, leg.status);

function openCase(specId: number): void {
  void router.push(pcbCaseTo(specId, 'shipments', route.fullPath));
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <PageHeader
      title="PCB 선적·배송"
      description="들어오는 것(협력사 → 자사 입고)과 나갈 것(자사 → 고객)을 위아래로 봅니다 — 협력사 선적 조작은 Case 상세, 고객 발송·구매확정은 여기서 합니다."
    />

    <TooltipProvider>
      <!-- ① 협력사 선적 — 협력사 발송 → 자사·MD 입고(발주서 축 + 선적 축) -->
      <SectionCard title="협력사 선적 — 협력사 발송 → 자사 입고" flush>
        <div class="flex flex-col gap-3 p-4">
          <QueueTabs v-model="tab" :tabs="tabs">
            <template #end>
              <!-- 협력사 구간 토글 — 서버 필터라 탭 건수와 목록이 함께 움직인다. -->
              <Tooltip>
                <TooltipTrigger as-child>
                  <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox v-model="showMdLegs" />
                    협력사 구간(하위→MD) 표시
                  </label>
                </TooltipTrigger>
                <TooltipContent>
                  MD 경유 건의 하위→MD 구간(협력사끼리의 운송)을 목록에 표시할지 정합니다. 자사 차례 판정에는 영향이 없습니다.
                </TooltipContent>
              </Tooltip>
              <!-- 검색 — 묶음의 동반 건(다른 고객)까지 서버가 구성원 필드로 맞춰 준다. -->
              <SearchInput v-model="searchText" placeholder="고객·프로젝트·PO·운송장 검색" @search="applySearch" />
            </template>
          </QueueTabs>
          <p v-if="tab === 'to_ship'" class="text-muted-foreground text-sm">
            생산이 끝났는데 아직 발송이 시작되지 않은 발주서입니다 — 발송 생성은 협력사 포털이 원칙이고, 관리자는
            Case 상세에서 대행할 수 있습니다.
          </p>
          <!-- 숨김이 침묵하지 않게 — 하위 발송~MD 입고 사이엔 자사향 선적이 아직 없어서, 걸러진 줄이
               있다는 사실 자체가 정보다. -->
          <Alert v-else-if="!showMdLegs && hiddenMdCount > 0" variant="info" size="sm">
            <AlertDescription>
              협력사 구간(하위→MD) {{ hiddenMdCount }}건이 숨겨져 있습니다 —
              <Button variant="link" size="xs" @click="showMdLegs = true">표시</Button>
            </AlertDescription>
          </Alert>
        </div>

        <!-- 발송 대기 — 생산완료인데 발송 문서가 아직 없는 발주서(선적 축 밖의 모수) -->
        <template v-if="tab === 'to_ship'">
          <TableCard bare class="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>발주</TableHead>
                  <TableHead>프로젝트</TableHead>
                  <TableHead>고객명</TableHead>
                  <TableHead>협력사</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>납기</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in toShipRows" :key="row.poId" class="cursor-pointer" @click="openCase(row.specId)">
                  <TableCell class="text-muted-foreground font-mono text-xs">PO-{{ row.poId }}</TableCell>
                  <TableCell class="max-w-xs">
                    <span class="block truncate font-medium" :title="row.projectName">
                      <span class="text-muted-foreground font-mono text-xs font-normal">Q{{ row.specId }}</span>
                      {{ row.projectName }}
                    </span>
                  </TableCell>
                  <TableCell>
                    <CustomerCell :name="row.customerName" :mb-id="row.mbId" />
                  </TableCell>
                  <TableCell>
                    {{ row.partnerName }}
                    <span v-if="row.parentPartnerName !== null" class="text-muted-foreground text-xs">
                      (MD {{ row.parentPartnerName }})
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="success">{{ PCB_PO_STATUS_LABELS[row.track][row.status] }}</Badge>
                  </TableCell>
                  <TableCell class="text-muted-foreground">{{ fmtDate(row.deliveryDate) }}</TableCell>
                  <TableCell class="text-right">
                    <Button size="sm" @click.stop="openCase(row.specId)">
                      발송 관리
                      <ArrowRightIcon />
                    </Button>
                  </TableCell>
                </TableRow>
                <TableEmptyRow
                  v-if="toShipRows.length === 0"
                  :colspan="7"
                  :loading="poQuery.isFetching.value"
                  text="발송 대기 발주서가 없습니다."
                />
              </TableBody>
            </Table>
          </TableCard>
          <div class="border-t p-4">
            <ListPagination
              :page="poFilters.page"
              :page-size="poFilters.pageSize"
              :total="toShipTotal"
              @update:page="(page: number) => (poFilters = { ...poFilters, page })"
            />
          </div>
        </template>

        <template v-else>
          <TableCard bare class="border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>발송</TableHead>
                  <TableHead>프로젝트</TableHead>
                  <TableHead>고객명</TableHead>
                  <TableHead>보내는 곳 → 받는 곳</TableHead>
                  <TableHead>구분</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>입고</TableHead>
                  <TableHead>생성일</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                <!-- 박스 1개 = 구성원 행 N개(여정 9호 후속 — 다중 고객 묶음의 동반 건도 1급 행으로).
                     물리 사실(운송장·상태·입고 — 박스당 한 번의 사건)은 rowspan 칸으로 한 번만 서고,
                     "무엇이·누구 것인지"(프로젝트·고객·Case)는 구성원마다 한 줄씩 선다. 이 표의 동작은
                     이동뿐이고 전이·입고확인은 Case 상세가 박스 단위로 다룬다. -->
                <template v-for="row in rows" :key="row.shipmentId">
                  <TableRow
                    v-for="(m, mi) in row.members"
                    :key="`${String(row.shipmentId)}-${String(m.poId)}`"
                    class="cursor-pointer"
                    @click="openCase(m.specId)"
                  >
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="align-top">
                      <div class="flex flex-col items-start gap-1.5">
                        <span class="inline-flex flex-wrap items-center gap-1">
                          <span class="text-muted-foreground font-mono text-xs">SH-{{ row.shipmentId }}</span>
                          <Badge v-if="row.poCount > 1" variant="outline">묶음 {{ row.poCount }}</Badge>
                          <Badge v-if="row.reorderRound > 0" variant="danger">{{ row.reorderRound }}차</Badge>
                          <!-- 운송수단 — 해상은 리드타임이 항공과 자릿수로 다르다. 이게 안 보이면 "왜 아직
                               안 왔나"를 운송장으로 역추론하게 된다(08-16). -->
                          <Badge v-if="row.transport !== null" variant="outline">
                            {{ SHIPMENT_TRANSPORT_LABELS[row.transport] }}
                          </Badge>
                        </span>
                        <span v-if="row.trackingNumber !== null" class="text-muted-foreground text-xs">
                          {{ row.carrier ?? '' }} {{ row.trackingNumber }}
                        </span>
                        <Button variant="outline" size="xs" @click.stop="labelShipmentId = row.shipmentId">
                          <QrCodeIcon />
                          QR 라벨 {{ row.poCount }}장
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell class="max-w-xs">
                      <span class="block truncate font-medium" :title="m.projectName">
                        <span class="text-muted-foreground font-mono text-xs font-normal">Q{{ m.specId }}</span>
                        {{ m.projectName }}
                      </span>
                      <!-- 앞 구간(하위→MD) 교차 표기 — 자사향 박스가 "언제 뜰 수 있나"는 앞 구간이 끝났는지에
                           달렸다. 협력사 구간을 숨겨도 여기서 읽힌다. -->
                      <Tooltip v-if="m.mdLeg !== null && m.mdLeg !== undefined">
                        <TooltipTrigger as-child>
                          <Badge :variant="m.mdLeg.receivedAt !== null ? 'success' : 'info'" class="mt-1">
                            하위 구간: {{ mdLegLabel(m.mdLeg) }}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>하위 협력사 → MD 구간 상태 — MD 입고가 끝나야 이 박스가 출고될 수 있습니다.</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <!-- 송장·입고를 다루는 사람이 읽는 열 — 묶음이면 회원이 다른 줄이 나란히 선다
                         (주문자명 정본 — 서버 lib/pcb-customer). -->
                    <TableCell>
                      <CustomerCell :name="m.customerName" :mb-id="m.mbId" />
                    </TableCell>
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="align-top">
                      <span class="inline-flex flex-wrap items-center gap-1">
                        <span>{{ row.senderName }} → {{ row.receiverName }}</span>
                        <!-- MD 경유 건의 앞 구간 — 협력사끼리의 운송이라 자사 차례가 아니다(관전 줄). -->
                        <Tooltip v-if="row.receiverKind === 'md'">
                          <TooltipTrigger as-child>
                            <Badge variant="secondary">협력사 구간</Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            하위 협력사 → MD 구간 — 자사 차례 없음. MD 입고가 끝나면 MD→자사 발송이 열립니다.
                          </TooltipContent>
                        </Tooltip>
                        <!-- 직송(D5) — 받는 곳이 자사여도 실물은 이 나라의 고객에게 간다 -->
                        <Tooltip v-if="row.destinationCountry !== null">
                          <TooltipTrigger as-child>
                            <Badge variant="info">직송 {{ row.destinationCountry }}</Badge>
                          </TooltipTrigger>
                          <TooltipContent>직송 — 실물은 자사 입고 없이 주문지로 갑니다</TooltipContent>
                        </Tooltip>
                      </span>
                    </TableCell>
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="text-muted-foreground align-top text-xs">
                      {{ row.mode === 'domestic' ? '국내(택배)' : '국제' }}
                    </TableCell>
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="align-top">
                      <span class="inline-flex flex-wrap items-center gap-1">
                        <Badge :variant="pcbShipmentStatusVariant(row.status)">
                          {{
                            pcbShipmentStatusLabel(row.mode, row.status, {
                              directShip: isPcbDirectShipIntl(row.destinationCountry),
                            })
                          }}
                        </Badge>
                        <Badge v-if="row.adminTurn" variant="warning">내 차례</Badge>
                        <!-- 협력사가 이 값을 기다리며 발송을 멈춘 상태 — Case 선적 줄에서 입력 -->
                        <Tooltip v-if="row.caseRefPending">
                          <TooltipTrigger as-child>
                            <Badge variant="warning">Case ID 요청</Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            협력사가 발송 참조번호(Case ID)를 기다리고 있습니다 — Case 선적 줄에서 입력하세요.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableCell>
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="align-top text-xs">
                      <!-- 받음의 주어를 명시 — 협력사 구간의 받음은 MD 창고이지 자사 입고가 아니다. -->
                      <span v-if="row.receivedAt !== null && row.receiverKind === 'md'" class="text-info font-medium">
                        MD 입고 {{ fmtDate(row.receivedAt) }}
                      </span>
                      <span v-else-if="row.receivedAt !== null" class="text-success font-medium">
                        {{ fmtDate(row.receivedAt) }}
                      </span>
                      <span v-else class="text-muted-foreground">—</span>
                    </TableCell>
                    <TableCell v-if="mi === 0" :rowspan="row.members.length" class="text-muted-foreground align-top">
                      {{ fmtDate(row.createdAt) }}
                    </TableCell>
                    <TableCell class="text-right">
                      <Button variant="outline" size="sm" @click.stop="openCase(m.specId)">
                        Case 열기
                        <ArrowRightIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                </template>
                <TableEmptyRow
                  v-if="rows.length === 0"
                  :colspan="9"
                  :loading="list.isFetching.value"
                  :text="
                    filters.q !== ''
                      ? '검색과 일치하는 발송이 없습니다.'
                      : '해당 상태의 발송이 없습니다 — 발송은 협력사 포털(또는 Case 상세 대행)에서 시작합니다.'
                  "
                />
              </TableBody>
            </Table>
          </TableCard>
          <div class="border-t p-4">
            <ListPagination
              :page="filters.page"
              :page-size="filters.pageSize"
              :total="total"
              @update:page="(page: number) => (filters = { ...filters, page })"
            >
              <!-- 행이 구성원(발주) 단위로 펼쳐져서, 페이징 축(박스)과 눈에 보이는 행 수(발주)를 함께 말한다. -->
              <template #summary>
                박스 <span class="text-foreground font-medium tabular-nums">{{ total.toLocaleString('ko-KR') }}</span>건 · 발주
                <span class="text-foreground font-medium tabular-nums">{{ poTotal.toLocaleString('ko-KR') }}</span>건
              </template>
            </ListPagination>
          </div>
        </template>
      </SectionCard>

      <!-- ② 고객 배송(P4.6) — 입고 끝난 주문을 고객에게 발송(주문 축). 판정은 협력 축 입고확인(관리자
           수신 선적 receivedAt)이라 이관·수동 처리 건은 여기 안 뜬다. -->
      <SectionCard title="고객 배송 — 입고 끝난 주문 발송" flush>
        <div class="flex flex-col gap-3 p-4">
          <QueueTabs v-model="orderTab" :tabs="orderTabs" />
          <Alert v-if="actionError !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ actionError }}</AlertDescription>
          </Alert>
        </div>
        <TableCard bare class="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>주문번호</TableHead>
                <TableHead>프로젝트</TableHead>
                <TableHead>고객명</TableHead>
                <TableHead>입고</TableHead>
                <TableHead class="text-right">결제액</TableHead>
                <TableHead>{{ orderTab === 'to_ship' ? '상태' : '운송장' }}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="item in orderRows" :key="item.odId" class="cursor-pointer" @click="openCase(item.specId)">
                <TableCell class="text-muted-foreground font-mono text-xs">{{ item.odId }}</TableCell>
                <TableCell class="max-w-xs">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <span class="text-muted-foreground shrink-0 font-mono text-xs">Q{{ item.specId }}</span>
                    <!-- 직송(D5) — 실물이 자사를 안 거쳤다: 이 행의 종결은 [직송 완료]다 -->
                    <Tooltip v-if="item.directShipCountry !== null">
                      <TooltipTrigger as-child>
                        <Badge variant="info">직송 {{ item.directShipCountry }}</Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        직송 — 실물은 자사 입고 없이 주문지로 갔습니다. 운송장 없이 [직송 완료]로 종결하세요.
                      </TooltipContent>
                    </Tooltip>
                    <span class="truncate font-medium" :title="item.projectName">{{ item.projectName }}</span>
                  </span>
                </TableCell>
                <!-- 송장을 붙이는 사람이 읽는 열 — 로그인 아이디만으로는 누구 물건인지 모른다. 묶음 발송이면
                     회원이 다른 두 주문이 나란히 서므로 주문자명이 정본이다(서버 lib/pcb-customer). -->
                <TableCell>
                  <CustomerCell :name="item.customerName" :mb-id="item.mbId" />
                </TableCell>
                <TableCell>
                  <Badge v-if="allReceived(item)" variant="success">입고 완료</Badge>
                  <Badge v-else variant="warning">입고 {{ item.receivedPoCount }}/{{ item.poCount }}</Badge>
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ fmtPcbAmount('KRW', item.receiptPrice) }}</TableCell>
                <TableCell>
                  <Badge v-if="orderTab === 'to_ship'" variant="info">{{ item.odStatus }}</Badge>
                  <span v-else class="text-xs">
                    {{ item.deliveryCompany !== '' ? item.deliveryCompany : '—' }}
                    <span v-if="item.invoiceNo !== ''" class="text-muted-foreground ml-1 font-mono">{{ item.invoiceNo }}</span>
                  </span>
                </TableCell>
                <TableCell class="text-right">
                  <span class="inline-flex items-center gap-1.5">
                    <!-- 직송 건 — 보낼 실물이 없다: 운송장 대화상자 대신 확인 후 완료 종결 -->
                    <Button
                      v-if="orderTab === 'to_ship' && item.directShipCountry !== null"
                      size="sm"
                      :disabled="completeMut.isPending.value"
                      @click.stop="completeDirectOrder(item)"
                    >
                      직송 완료
                    </Button>
                    <Button v-else-if="orderTab === 'to_ship'" size="sm" @click.stop="openShip(item)">배송 처리</Button>
                    <Button v-else size="sm" :disabled="completeMut.isPending.value" @click.stop="completeOrder(item)">
                      구매확정
                    </Button>
                    <Button variant="outline" size="sm" @click.stop="openCase(item.specId)">
                      Case
                      <ArrowRightIcon />
                    </Button>
                  </span>
                </TableCell>
              </TableRow>
              <TableEmptyRow
                v-if="orderRows.length === 0"
                :colspan="7"
                :loading="orderQuery.isFetching.value"
                :text="
                  orderTab === 'to_ship'
                    ? '배송 처리 대기 주문이 없습니다 — 입고확인이 끝나면 여기로 들어옵니다.'
                    : '배송 중인 주문이 없습니다.'
                "
              />
            </TableBody>
          </Table>
        </TableCard>
        <div class="border-t p-4">
          <ListPagination
            :page="orderFilters.page"
            :page-size="orderFilters.pageSize"
            :total="orderTotal"
            @update:page="(page: number) => (orderFilters = { ...orderFilters, page })"
          />
        </div>
      </SectionCard>
    </TooltipProvider>

    <CustomerShipDialog
      :od-id="shipOdId"
      :incomplete-receipt="shipIncomplete"
      :customer-label="shipCustomerLabel"
      :project-name="shipProjectName"
      @close="shipOdId = null"
    />
    <PackageLabelsDialog
      v-if="labelsApi !== null"
      :open="labelShipmentId !== null"
      :load="labelsApi.load"
      :mark-printed="labelsApi.markPrinted"
      @close="labelShipmentId = null"
    />
  </div>
</template>
