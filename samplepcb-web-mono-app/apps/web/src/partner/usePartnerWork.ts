import { computed, type Ref } from 'vue';
import { usePartnerPos, usePartnerRfqs, usePartnerShipments } from './usePartnerRfqs';
import { usePartnerPcbRfqs } from './usePartnerPcbRfqs';
import {
  usePartnerPcbPos,
  usePartnerPcbRemittances,
  usePartnerPcbShipBoard,
} from './usePartnerPcbPos';
import { usePartnerPcbAsCases } from './usePartnerPcbAsCases';

// "오늘 할 일" 파생의 단일 원본(포털 재설계 R3) — 홈 카드·사이드바 배지·워크큐 목록이
// 전부 이 파생을 쓴다. 같은 queryKey 를 구독하므로 어디서 보든 숫자가 같고, 셸이 추가로
// 부르는 요청도 없다(vue-query 캐시 공유). enabled 는 셸이 트랙별로 켠다 — 트랙 없는
// 모듈의 목록을 부르지 않기 위함이고, 홈·목록 페이지는 인자 없이 그대로 구독한다.

export function usePartnerBomWork(enabled?: Ref<boolean>) {
  const rfqsQuery = usePartnerRfqs(enabled);
  const posQuery = usePartnerPos(enabled);
  const shipmentsQuery = usePartnerShipments(enabled);

  const rfqItems = computed(() => rfqsQuery.data.value?.data.items ?? []);
  const pendingRfqs = computed(() => rfqItems.value.filter((r) => r.status === 'requested'));
  const doneRfqs = computed(() => rfqItems.value.filter((r) => r.status !== 'requested'));

  const poItems = computed(() => posQuery.data.value?.data.items ?? []);
  const toConfirm = computed(() => poItems.value.filter((po) => po.status === 'issued'));
  const toShip = computed(() =>
    poItems.value.filter((po) => po.status !== 'issued' && !po.shipmentAttached),
  );
  const countryBlockedCount = computed(
    () => toShip.value.filter((po) => !po.shipmentCountryReady).length,
  );

  // 서버 tab=active — 협력사 관점 완료(최종 상태·입고 확인)는 제외돼 온다(§6.11 분리).
  const shipments = computed(() => shipmentsQuery.data.value?.data.items ?? []);
  const preparingCount = computed(
    () => shipments.value.filter((s) => s.status === 'preparing').length,
  );
  const activeShipments = computed(() => shipments.value.filter((s) => s.status !== 'preparing'));
  const myTurnCount = computed(() => activeShipments.value.filter((s) => s.myTurn).length);
  const doneCount = computed(() => shipmentsQuery.data.value?.data.counts.done ?? 0);

  // 📦 보내기 배지 — 보낼 물건 + 준비 중 박스 + 내 차례 발송(전부 보내기 화면에서 움직인다).
  const shipTodoCount = computed(
    () => toShip.value.length + preparingCount.value + myTurnCount.value,
  );

  return {
    rfqsQuery,
    posQuery,
    shipmentsQuery,
    rfqItems,
    pendingRfqs,
    doneRfqs,
    poItems,
    toConfirm,
    toShip,
    countryBlockedCount,
    shipments,
    preparingCount,
    activeShipments,
    myTurnCount,
    doneCount,
    shipTodoCount,
  };
}

export function usePartnerPcbWork(enabled?: Ref<boolean>) {
  const rfqsQuery = usePartnerPcbRfqs(enabled);
  const posQuery = usePartnerPcbPos(enabled);
  const boardQuery = usePartnerPcbShipBoard(enabled);
  const asQuery = usePartnerPcbAsCases(enabled);
  const remitQuery = usePartnerPcbRemittances(enabled);

  const rfqItems = computed(() => rfqsQuery.data.value?.data.items ?? []);
  const pendingRfqs = computed(() => rfqItems.value.filter((r) => r.status === 'requested'));
  const doneRfqs = computed(() => rfqItems.value.filter((r) => r.status !== 'requested'));

  // 내 차례(수주 방향 RECEIVER 액션·MD 하위 발주 대기·MD 입고 차례) / 관전(하위 진행·수주 위임).
  const poItems = computed(() => posQuery.data.value?.data.items ?? []);
  const myTurnPos = computed(() => poItems.value.filter((po) => po.myTurn));
  const watchingPos = computed(() => poItems.value.filter((po) => !po.myTurn));

  // [📦 PCB 보내기] 보드 — BOM 은 확인 즉시 선반이지만 PCB 는 생산완료가 담기 조건.
  const shelf = computed(() => boardQuery.data.value?.data.shelf ?? []);
  const producing = computed(() => boardQuery.data.value?.data.producing ?? []);
  const boxes = computed(() => boardQuery.data.value?.data.boxes ?? []);
  const activeShipments = computed(() => boardQuery.data.value?.data.active ?? []);
  const doneCount = computed(() => boardQuery.data.value?.data.doneCount ?? 0);
  const shipTodoCount = computed(() => shelf.value.length + boxes.value.length);

  // A/S — 회신 주체가 나인 접수 건만 '할 일'.
  const asCases = computed(() => asQuery.data.value?.data.cases ?? []);
  const pendingAsCount = computed(() => {
    const data = asQuery.data.value?.data;
    if (data === undefined) return 0;
    return data.cases.filter((c) => c.status === 'submitted' && c.targetPartnerId === data.partnerId)
      .length;
  });

  // 미수금 — 무상 A/S 를 제외한 통화별 미수(서버 계산).
  const unpaidCount = computed(() => remitQuery.data.value?.data.unpaidCount ?? 0);
  const unpaidTotals = computed(() =>
    (remitQuery.data.value?.data.totals ?? []).filter((t) => t.balance > 0),
  );

  return {
    rfqsQuery,
    posQuery,
    boardQuery,
    asQuery,
    remitQuery,
    rfqItems,
    pendingRfqs,
    doneRfqs,
    poItems,
    myTurnPos,
    watchingPos,
    shelf,
    producing,
    boxes,
    activeShipments,
    doneCount,
    shipTodoCount,
    asCases,
    pendingAsCount,
    unpaidCount,
    unpaidTotals,
  };
}
