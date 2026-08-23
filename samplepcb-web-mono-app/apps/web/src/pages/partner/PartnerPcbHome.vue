<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { usePartnerPcbWork } from '../../partner/usePartnerWork';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { rememberPartnerModule } from '../../partner/partnerModule';
import { fmtPcbAmount } from '../../lib/pcb-money';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerPcbRfqRow from '../../components/partner/PartnerPcbRfqRow.vue';
import PartnerPcbPoRow from '../../components/partner/PartnerPcbPoRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';

// PCB 제작 모듈 홈(포털 재설계 R1·R3) — "오늘 할 일" 중심: ① 회신할 견적 ② 진행할
// 발주(EQ 5단계) ③ 보낼 물건([📦 PCB 보내기] 보드) ④ 진행 중 발송. PCB 트랙 어휘만
// 쓴다 — BOM 은 별도 모듈(관리자 D9 미러). 수금 현황은 공통 영역(셸 네비)이다.
// R3: 회신한 견적 아카이브·완료된 발송·A/S 내역 링크는 사이드바 메뉴로 옮겼다. 관전용
// '진행 중 발주'는 남긴다 — MD 가 하위 반려·수주 위임 진행을 홈에서 좇아야 한다(실주행 확정).
// 파생은 usePartnerWork(사이드바 배지와 같은 숫자).

const work = usePartnerPcbWork();
const accessQuery = usePartnerAccess();

onMounted(() => {
  rememberPartnerModule('pcb');
});

const notPartner = computed(
  () =>
    work.rfqsQuery.error.value instanceof ApiRequestError &&
    work.rfqsQuery.error.value.status === 403,
);
// 트랙 가드 — capability 없는 모듈 URL 직접 진입 시 안내(데이터는 서버가 어차피 안 준다).
const noTrack = computed(() => accessQuery.data.value?.data.tracks.pcb === false);
const hasBomTrack = computed(() => accessQuery.data.value?.data.tracks.bom === true);
const partnerName = computed(() => accessQuery.data.value?.data.partnerName ?? null);
const isLoading = computed(() => work.rfqsQuery.isLoading.value);

const {
  pendingRfqs,
  myTurnPos,
  watchingPos,
  shelf,
  producing,
  boxes,
  activeShipments,
  pendingAsCount,
  unpaidCount,
  unpaidTotals,
} = work;
const nothingTodo = computed(
  () =>
    pendingRfqs.value.length === 0 &&
    myTurnPos.value.length === 0 &&
    shelf.value.length === 0 &&
    activeShipments.value.length === 0,
);
</script>

<template>
  <div class="space-y-6">
    <PartnerPageHeader
      title="PCB 제작"
      :subtitle="partnerName !== null ? `${partnerName} 님, 오늘 처리할 일입니다.` : null"
    />

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
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-cyan-300"
          :class="pendingRfqs.length > 0 ? 'border-cyan-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">회신할 견적</p>
          <p class="mt-1 text-2xl font-bold" :class="pendingRfqs.length > 0 ? 'text-cyan-700' : 'text-gray-300'">
            {{ pendingRfqs.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <a
          href="#po"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-teal-300"
          :class="myTurnPos.length > 0 ? 'border-teal-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">진행할 발주</p>
          <p class="mt-1 text-2xl font-bold" :class="myTurnPos.length > 0 ? 'text-teal-700' : 'text-gray-300'">
            {{ myTurnPos.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <RouterLink
          :to="{ name: 'partner-pcb-ship' }"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-teal-300"
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
          <!-- producing 은 이름과 달리 "생산완료 전 수주 전부"다(발주접수·EQ 포함) —
               '생산 진행 중'이라 말하면 발주 직후에도 생산 중이라 읽힌다(MD 실주행 확정). -->
          <p v-else-if="producing.length > 0" class="mt-0.5 text-xs font-semibold text-gray-500">
            진행 중 {{ producing.length }}건 — 생산완료되면 담을 수 있습니다
          </p>
        </RouterLink>
        <RouterLink
          :to="{ name: 'partner-pcb-ship' }"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-blue-300"
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
      <section v-if="pendingRfqs.length > 0" id="reply">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-bold text-gray-700">회신할 견적 ({{ pendingRfqs.length }})</h2>
          <RouterLink
            :to="{ name: 'partner-pcb-rfqs', query: { tab: 'all' } }"
            class="text-xs font-semibold text-gray-400 hover:text-gray-700"
          >
            모든 견적요청 →
          </RouterLink>
        </div>
        <div class="mt-2 grid gap-2">
          <PartnerPcbRfqRow v-for="rfq in pendingRfqs" :key="rfq.rfqId" :rfq="rfq" />
        </div>
      </section>

      <!-- ② 진행할 발주·EQ — 파일 올리고 승인요청 → 생산 진행, MD 입고 차례 포함 -->
      <section v-if="myTurnPos.length > 0" id="po">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-bold text-gray-700">진행할 발주 ({{ myTurnPos.length }})</h2>
          <RouterLink
            :to="{ name: 'partner-pcb-pos', query: { tab: 'all' } }"
            class="text-xs font-semibold text-gray-400 hover:text-gray-700"
          >
            모든 발주서 →
          </RouterLink>
        </div>
        <div class="mt-2 grid gap-2">
          <PartnerPcbPoRow v-for="po in myTurnPos" :key="po.poId" :po="po" />
        </div>
      </section>

      <!-- 보조: 진행 중 발주(내 차례 아님) — 관전 진입점. MD 는 수주(위임)·하위 발주의
           진행/반려를 여기서 좇는다. 내 차례가 되면 위 '진행할 발주'로 올라간다. -->
      <details v-if="watchingPos.length > 0" open class="rounded-xl border border-gray-200 bg-surface">
        <summary class="cursor-pointer px-4 py-3 text-sm font-bold text-gray-700">
          진행 중 발주 ({{ watchingPos.length }})
        </summary>
        <div class="grid gap-2 px-4 pb-4">
          <PartnerPcbPoRow v-for="po in watchingPos" :key="po.poId" :po="po" />
        </div>
      </details>

      <PartnerEmpty v-if="nothingTodo">지금 처리할 일이 없습니다 🎉</PartnerEmpty>
    </template>
  </div>
</template>
