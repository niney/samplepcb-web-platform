<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { usePartnerBomWork } from '../../partner/usePartnerWork';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { rememberPartnerModule } from '../../partner/partnerModule';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerShipmentCard from '../../components/partner/PartnerShipmentCard.vue';
import PartnerBomRfqRow from '../../components/partner/PartnerBomRfqRow.vue';
import PartnerBomPoRow from '../../components/partner/PartnerBomPoRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';

// BOM 부품 모듈 홈(포털 재설계 R1·R3) — "오늘 할 일" 중심: ① 회신할 견적 ② 확인할 발주
// ③ 보낼 물건([📦 보내기]) ④ 진행 중 발송(핑퐁). BOM 트랙 어휘만 쓴다 — PCB 는
// 별도 모듈(관리자 D9 미러: 모듈 간 화면 공유 금지). 서버가 소속을 판정(403=파트너 아님).
// R3: 회신한 견적·모든 발주서 아카이브는 사이드바의 견적요청·발주서 워크큐로 옮겼다 —
// 홈엔 지금 움직여야 하는 것만 남는다. 파생은 usePartnerWork(사이드바 배지와 같은 숫자).

const work = usePartnerBomWork();
const accessQuery = usePartnerAccess();

onMounted(() => {
  rememberPartnerModule('bom');
});

const notPartner = computed(
  () =>
    work.rfqsQuery.error.value instanceof ApiRequestError &&
    work.rfqsQuery.error.value.status === 403,
);
// 트랙 가드 — capability 없는 모듈 URL 직접 진입 시 안내(데이터는 서버가 어차피 안 준다).
const noTrack = computed(() => accessQuery.data.value?.data.tracks.bom === false);
const hasPcbTrack = computed(() => accessQuery.data.value?.data.tracks.pcb === true);
const partnerName = computed(() => work.rfqsQuery.data.value?.data.partnerName ?? null);
const isLoading = computed(() => work.rfqsQuery.isLoading.value);

const {
  pendingRfqs,
  toConfirm,
  toShip,
  countryBlockedCount,
  preparingCount,
  activeShipments,
  myTurnCount,
} = work;
const nothingTodo = computed(
  () =>
    pendingRfqs.value.length === 0 &&
    toConfirm.value.length === 0 &&
    toShip.value.length === 0 &&
    activeShipments.value.length === 0,
);
</script>

<template>
  <div class="space-y-6">
    <PartnerPageHeader
      title="BOM 부품"
      :subtitle="partnerName !== null ? `${partnerName} 님, 오늘 처리할 일입니다.` : null"
    />

    <div v-if="notPartner" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      승인된 파트너 계정이 아닙니다. 파트너 등록·계정 연결은 샘플피씨비 담당자에게 문의해 주세요.
    </div>
    <div v-else-if="noTrack" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      이 조직은 BOM 부품 트랙에 참여하지 않습니다.
      <RouterLink v-if="hasPcbTrack" :to="{ name: 'partner-pcb' }" class="font-semibold underline">
        PCB 제작으로 이동 →
      </RouterLink>
    </div>
    <p v-else-if="isLoading" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else>
      <!-- 오늘 할 일 — 카드 4개(이 화면의 섹션 또는 보내기 화면으로) -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href="#reply"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-blue-300"
          :class="pendingRfqs.length > 0 ? 'border-blue-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">회신할 견적</p>
          <p class="mt-1 text-2xl font-bold" :class="pendingRfqs.length > 0 ? 'text-blue-700' : 'text-gray-300'">
            {{ pendingRfqs.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <a
          href="#confirm"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-emerald-300"
          :class="toConfirm.length > 0 ? 'border-emerald-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">확인할 발주</p>
          <p class="mt-1 text-2xl font-bold" :class="toConfirm.length > 0 ? 'text-emerald-700' : 'text-gray-300'">
            {{ toConfirm.length }}<span class="text-sm font-semibold">건</span>
          </p>
        </a>
        <RouterLink
          :to="{ name: 'partner-bom-ship' }"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-indigo-300"
          :class="toShip.length > 0 || preparingCount > 0 ? 'border-indigo-200' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">📦 보낼 물건</p>
          <p class="mt-1 text-2xl font-bold" :class="toShip.length > 0 ? 'text-indigo-700' : 'text-gray-300'">
            {{ toShip.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="preparingCount > 0" class="mt-0.5 text-xs font-bold text-indigo-600">
            준비 중인 박스 {{ preparingCount }}건 — 계속하기 →
          </p>
          <p v-else-if="countryBlockedCount > 0" class="mt-0.5 text-xs font-semibold text-red-600">
            국가 정보 필요 {{ countryBlockedCount }}건
          </p>
          <p v-else-if="toShip.length > 0" class="mt-0.5 text-xs font-semibold text-indigo-600">보내기 →</p>
        </RouterLink>
        <a
          href="#shipments"
          class="min-w-0 rounded-xl border bg-surface p-4 hover:border-blue-300"
          :class="myTurnCount > 0 ? 'border-blue-300' : 'border-gray-200'"
        >
          <p class="text-sm text-gray-500">진행 중 발송</p>
          <p class="mt-1 text-2xl font-bold" :class="activeShipments.length > 0 ? 'text-gray-800' : 'text-gray-300'">
            {{ activeShipments.length }}<span class="text-sm font-semibold">건</span>
          </p>
          <p v-if="myTurnCount > 0" class="mt-0.5 text-xs font-bold text-blue-600">내 차례 {{ myTurnCount }}건!</p>
        </a>
      </div>

      <!-- ① 회신할 견적 -->
      <section v-if="pendingRfqs.length > 0" id="reply">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-bold text-gray-700">회신할 견적 ({{ pendingRfqs.length }})</h2>
          <RouterLink
            :to="{ name: 'partner-bom-rfqs', query: { tab: 'all' } }"
            class="text-xs font-semibold text-gray-400 hover:text-gray-700"
          >
            모든 견적요청 →
          </RouterLink>
        </div>
        <div class="mt-2 grid gap-2">
          <PartnerBomRfqRow v-for="rfq in pendingRfqs" :key="rfq.rfqId" :rfq="rfq" />
        </div>
      </section>

      <!-- ② 확인할 발주 -->
      <section v-if="toConfirm.length > 0" id="confirm">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="text-sm font-bold text-gray-700">확인할 발주 ({{ toConfirm.length }})</h2>
          <RouterLink
            :to="{ name: 'partner-bom-pos', query: { tab: 'all' } }"
            class="text-xs font-semibold text-gray-400 hover:text-gray-700"
          >
            모든 발주서 →
          </RouterLink>
        </div>
        <div class="mt-2 grid gap-2">
          <PartnerBomPoRow v-for="po in toConfirm" :key="po.poId" :po="po" />
        </div>
      </section>

      <!-- ④ 진행 중 발송 — 발송(박스) 단위 추적·핑퐁 -->
      <section v-if="activeShipments.length > 0" id="shipments">
        <h2 class="text-sm font-bold text-gray-700">진행 중 발송 ({{ activeShipments.length }})</h2>
        <div class="mt-2 space-y-3">
          <PartnerShipmentCard v-for="s in activeShipments" :key="s.shipmentId" :shipment="s" />
        </div>
      </section>

      <PartnerEmpty v-if="nothingTodo">지금 처리할 일이 없습니다 🎉</PartnerEmpty>
    </template>
  </div>
</template>
