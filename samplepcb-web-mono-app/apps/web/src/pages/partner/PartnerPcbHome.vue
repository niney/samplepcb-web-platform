<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { PCB_RFQ_STATUS_LABELS } from '@sp/api-contract';
import { usePartnerPcbRfqs } from '../../partner/usePartnerPcbRfqs';
import {
  usePartnerPcbPos,
  usePartnerPcbRemittances,
  usePartnerPcbShipBoard,
} from '../../partner/usePartnerPcbPos';
import { usePartnerPcbAsCases } from '../../partner/usePartnerPcbAsCases';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { rememberPartnerModule } from '../../partner/partnerModule';
import { fmtPcbAmount, pcbMoneyWithSub } from '../../lib/pcb-money';
import { fmtKstDate } from '@sp/utils';

// PCB 제작 모듈 홈(포털 재설계 R1) — "오늘 할 일" 중심: ① 회신할 견적 ② 진행할
// 발주(EQ 5단계) ③ 보낼 물건([📦 PCB 보내기] 보드) ④ 진행 중 발송. PCB 트랙 어휘만
// 쓴다 — BOM 은 별도 모듈(관리자 D9 미러). 수금 현황은 공통 영역(셸 네비)이다.

const pcbQuery = usePartnerPcbRfqs();
const pcbPoQuery = usePartnerPcbPos();
const shipQuery = usePartnerPcbShipBoard();
const asQuery = usePartnerPcbAsCases();
const accessQuery = usePartnerAccess();
const remitQuery = usePartnerPcbRemittances();

// A/S 회신 대기(내가 회신 주체인 접수 건) — 있을 때만 배너.
const pendingAsCount = computed(() => {
  const data = asQuery.data.value?.data;
  if (data === undefined) return 0;
  return data.cases.filter((c) => c.status === 'submitted' && c.targetPartnerId === data.partnerId)
    .length;
});
// A/S 이력 진입점(재점검 #14) — 회신 대기 배너는 submitted 에서만 떠서, proceeded·
// rejected 이력은 URL 직접 입력 말고는 갈 길이 없었다. 케이스가 1건이라도 있으면
// 작은 링크를 상시 노출한다(상시 메뉴 신설은 과함 — 완료된 발송 링크와 같은 결).
const asCount = computed(() => asQuery.data.value?.data.cases.length ?? 0);

onMounted(() => {
  rememberPartnerModule('pcb');
});

const notPartner = computed(
  () => pcbQuery.error.value instanceof ApiRequestError && pcbQuery.error.value.status === 403,
);
// 트랙 가드 — capability 없는 모듈 URL 직접 진입 시 안내(데이터는 서버가 어차피 안 준다).
const noTrack = computed(() => accessQuery.data.value?.data.tracks.pcb === false);
const hasBomTrack = computed(() => accessQuery.data.value?.data.tracks.bom === true);
const partnerName = computed(() => accessQuery.data.value?.data.partnerName ?? null);

// ── 할 일 파생 ───────────────────────────────────────────────────────────────
const pcbItems = computed(() => pcbQuery.data.value?.data.items ?? []);
const pendingPcb = computed(() => pcbItems.value.filter((r) => r.status === 'requested'));
const donePcb = computed(() => pcbItems.value.filter((r) => r.status !== 'requested'));

// 발주·EQ(P2) — 내 차례(수주 방향 RECEIVER 액션·MD 입고 차례)만 홈에 띄운다.
const pcbPoItems = computed(() => pcbPoQuery.data.value?.data.items ?? []);
const myTurnPcbPos = computed(() => pcbPoItems.value.filter((po) => po.myTurn));

// [📦 PCB 보내기] 보드 요약 — BOM 은 확인 즉시 선반이지만 PCB 는 생산완료가 담기
// 조건이라, 확인 시점의 가시성은 '생산 진행 중' 보조 표기가 담당한다.
const shelf = computed(() => shipQuery.data.value?.data.shelf ?? []);
const producing = computed(() => shipQuery.data.value?.data.producing ?? []);
const boxes = computed(() => shipQuery.data.value?.data.boxes ?? []);
const activeShipments = computed(() => shipQuery.data.value?.data.active ?? []);
// 완료된 발송은 양이 누적되므로 별도 페이지 — 홈엔 건수 링크만(BOM §6.11 미러).
const doneCount = computed(() => shipQuery.data.value?.data.doneCount ?? 0);

// ── 미수금 — "받을 돈"을 홈이 먼저 알린다(P3.11 문서가 약속한 '포털 홈 요약 카드') ──
// 수금 화면은 셸 탭에만 있어서, 홈만 보는 협력사는 미수금이 있다는 사실 자체를 몰랐다.
// 총계는 무상 A/S 를 제외한 통화별 미수(서버 계산)이며 여기선 남은 통화만 보여 준다.
const unpaidCount = computed(() => remitQuery.data.value?.data.unpaidCount ?? 0);
const unpaidTotals = computed(() =>
  (remitQuery.data.value?.data.totals ?? []).filter((t) => t.balance > 0),
);

const isLoading = computed(() => pcbQuery.isLoading.value);
const fmtDate = fmtKstDate;

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
      <h1 class="text-xl font-bold">PCB 제작</h1>
      <p v-if="partnerName !== null" class="mt-0.5 text-sm text-gray-500">
        {{ partnerName }} 님, 오늘 처리할 일입니다.
      </p>
    </div>

    <div v-if="notPartner" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      승인된 파트너 계정이 아닙니다. 파트너 등록·계정 연결은 샘플피씨비 담당자에게 문의해 주세요.
    </div>
    <div v-else-if="noTrack" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      이 조직은 PCB 제작 트랙에 참여하지 않습니다.
      <RouterLink v-if="hasBomTrack" :to="{ name: 'partner-bom' }" class="font-semibold underline">
        BOM 부품으로 이동 →
      </RouterLink>
    </div>
    <p v-else-if="isLoading" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else>
      <!-- A/S 회신 대기 — 드문 이벤트라 상시 카드 대신 있을 때만 배너로 -->
      <RouterLink
        v-if="pendingAsCount > 0"
        :to="{ name: 'partner-pcb-as' }"
        class="block rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 hover:bg-amber-100"
      >
        🔧 A/S 재생산 검토 요청 {{ pendingAsCount }}건 — 재생산 가능/불가를 회신해 주세요 →
      </RouterLink>

      <!-- 미수금 — 돈은 '오늘 할 일'이 아니라 '받을 것'이라 카드 줄 위에 따로 선다 -->
      <RouterLink
        v-if="unpaidCount > 0"
        :to="{ name: 'partner-remittances' }"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100"
      >
        <span class="text-sm font-bold text-amber-800">💰 미수금 {{ unpaidCount }}건</span>
        <span
          v-for="t in unpaidTotals"
          :key="t.currency"
          class="text-sm font-extrabold tabular-nums text-amber-900"
        >
          {{ fmtPcbAmount(t.currency, t.balance) }}
        </span>
        <span class="ml-auto text-xs font-semibold text-amber-700">수금 현황 보기 →</span>
      </RouterLink>

      <!-- 오늘 할 일 — 카드 4개 -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href="#reply"
          class="rounded-xl border bg-surface p-4 hover:border-cyan-300"
          :class="pendingPcb.length > 0 ? 'border-cyan-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">회신할 견적</p>
          <p class="mt-1 text-2xl font-bold" :class="pendingPcb.length > 0 ? 'text-cyan-700' : 'text-gray-300'">
            {{ pendingPcb.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <a
          href="#po"
          class="rounded-xl border bg-surface p-4 hover:border-teal-300"
          :class="myTurnPcbPos.length > 0 ? 'border-teal-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">진행할 발주</p>
          <p class="mt-1 text-2xl font-bold" :class="myTurnPcbPos.length > 0 ? 'text-teal-700' : 'text-gray-300'">
            {{ myTurnPcbPos.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <RouterLink
          :to="{ name: 'partner-pcb-ship' }"
          class="rounded-xl border bg-surface p-4 hover:border-teal-300"
          :class="shelf.length > 0 || boxes.length > 0 ? 'border-teal-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">📦 보낼 물건</p>
          <p class="mt-1 text-2xl font-bold" :class="shelf.length > 0 ? 'text-teal-700' : 'text-gray-300'">
            {{ shelf.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="boxes.length > 0" class="mt-0.5 text-xs font-bold text-teal-600">
            준비 중인 박스 {{ boxes.length }}개 — 계속하기 →
          </p>
          <p v-else-if="shelf.length > 0" class="mt-0.5 text-xs font-semibold text-teal-600">
            받는 곳이 같으면 묶어서 보내기 →
          </p>
          <p v-else-if="producing.length > 0" class="mt-0.5 text-xs font-semibold text-gray-500">
            생산 진행 중 {{ producing.length }}건 — 생산완료되면 담을 수 있습니다
          </p>
        </RouterLink>
        <RouterLink
          :to="{ name: 'partner-pcb-ship' }"
          class="rounded-xl border bg-surface p-4 hover:border-blue-300"
          :class="activeShipments.length > 0 ? 'border-blue-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">진행 중 발송</p>
          <p class="mt-1 text-2xl font-bold" :class="activeShipments.length > 0 ? 'text-gray-800' : 'text-gray-300'">
            {{ activeShipments.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="activeShipments.length > 0" class="mt-0.5 text-xs font-semibold text-blue-600">
            보내기 화면에서 진행 →
          </p>
        </RouterLink>
      </div>

      <!-- ① 회신할 견적 -->
      <!-- ⚠ 카드에 `min-w-0` 이 필요하다(여정 36호). 프로젝트명은 **고객이 올린 파일명**이라
           우리가 길이를 정할 수 없는데, grid item 은 기본 `min-width:auto` 라 긴 이름이
           카드를 컨테이너 밖까지 밀어낸다. 안쪽 `min-w-0 flex-1` 은 flex 컨텍스트 안에서만
           들어서 truncate 는 걸려도 카드 자체가 넓어진다(295자 이름으로 1503px>1440px 실측).
           같은 이유로 이 파일·BOM 홈·발송 화면의 같은 카드 전부에 붙였다. -->
      <section v-if="pendingPcb.length > 0" id="reply">
        <h2 class="text-sm font-bold text-gray-700">회신할 견적 ({{ pendingPcb.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="rfq in pendingPcb"
            :key="rfq.rfqId"
            :to="{ name: 'partner-pcb-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-cyan-200 bg-surface px-4 py-3 hover:border-cyan-300 hover:bg-cyan-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">{{ rfq.projectName }}</p>
              <p class="mt-0.5 text-sm text-gray-500">
                {{ rfq.category }} · {{ rfq.qty }}매 · {{ rfq.requesterName }} · 요청일 {{ fmtDate(rfq.requestedAt) }}
                <template v-if="rfq.suggestedDeliveryDate !== null">
                  · 희망 납기 {{ fmtDate(rfq.suggestedDeliveryDate) }}
                </template>
              </p>
            </div>
            <span class="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-bold text-white">회신하기</span>
          </RouterLink>
        </div>
      </section>

      <!-- ② 진행할 발주·EQ — 파일 올리고 승인요청 → 생산 진행, MD 입고 차례 포함 -->
      <section v-if="myTurnPcbPos.length > 0" id="po">
        <h2 class="text-sm font-bold text-gray-700">진행할 발주 ({{ myTurnPcbPos.length }})</h2>
        <div class="mt-2 grid gap-2">
          <RouterLink
            v-for="po in myTurnPcbPos"
            :key="po.poId"
            :to="{ name: 'partner-pcb-po', params: { id: String(po.poId) } }"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-teal-200 bg-surface px-4 py-3 hover:border-teal-300 hover:bg-teal-50/40"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-semibold text-gray-900">
                {{ po.projectName }}
                <span v-if="po.reorderRound > 0" class="ml-1 rounded bg-rose-100 px-1 text-[11px] font-bold text-rose-700">
                  A/S {{ po.reorderRound }}차
                </span>
              </p>
              <p class="mt-0.5 text-sm text-gray-500">
                {{ po.qty }}매 · {{ po.counterpartyName }} ·
                {{ po.priceOriginal.toLocaleString('en-US') }} {{ po.currency }}
              </p>
            </div>
            <span class="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-bold text-white">진행하기</span>
          </RouterLink>
        </div>
      </section>

      <!-- 보조: 회신한 견적 -->
      <details v-if="donePcb.length > 0" class="rounded-xl border border-gray-200 bg-surface">
        <summary class="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
          회신한 견적 ({{ donePcb.length }})
        </summary>
        <div class="grid gap-2 px-4 pb-4">
          <RouterLink
            v-for="rfq in donePcb"
            :key="rfq.rfqId"
            :to="{ name: 'partner-pcb-rfq', params: { id: String(rfq.rfqId) } }"
            class="flex items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-gray-800">{{ rfq.projectName }}</span>
            <span class="text-xs tabular-nums text-gray-400">
              {{ pcbMoneyWithSub(rfq.currency, rfq.priceOriginal, rfq.subCurrency, rfq.subPriceOriginal) }}
            </span>
            <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="rfqStatusCls(rfq.status)">
              {{ PCB_RFQ_STATUS_LABELS[rfq.status] }}
            </span>
          </RouterLink>
        </div>
      </details>

      <!-- 보조: 완료된 발송 — 누적 목록은 별도 페이지(BOM §6.11 미러) -->
      <RouterLink
        v-if="doneCount > 0"
        :to="{ name: 'partner-pcb-shipments-done' }"
        class="block rounded-xl border border-gray-200 bg-surface px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
      >
        완료된 발송 {{ doneCount }}건 보기 →
      </RouterLink>

      <!-- 보조: A/S 이력 — 회신 대기 배너(submitted)가 없어도 케이스가 있으면 진입점 유지 -->
      <RouterLink
        v-if="asCount > 0"
        :to="{ name: 'partner-pcb-as' }"
        class="block rounded-xl border border-gray-200 bg-surface px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
      >
        🔧 A/S 내역 {{ asCount }}건 보기 →
      </RouterLink>

      <p
        v-if="pendingPcb.length === 0 && myTurnPcbPos.length === 0 && shelf.length === 0 && activeShipments.length === 0"
        class="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-400"
      >
        지금 처리할 일이 없습니다 🎉
      </p>
    </template>
  </div>
</template>
