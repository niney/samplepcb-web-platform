<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { bomShipmentNextStatus, type PartnerPoListItemType } from '@sp/api-contract';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { usePartnerBomWork } from '../../partner/usePartnerWork';
import { useRouteTab } from '../../partner/useRouteTab';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerWorkqueueTabs, {
  type PartnerWorkqueueTab,
} from '../../components/partner/PartnerWorkqueueTabs.vue';
import PartnerBomPoRow from '../../components/partner/PartnerBomPoRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// BOM 발주서 워크큐(포털 재설계 R3) — 홈의 '확인할 발주' + 접힌 '모든 발주서'를 탭으로
// 연다: 확인할(issued) / 진행 중(확인 뒤 발송~입고 전) / 완료(입고 확인·최종 상태) / 전체.
// 완료 판정은 partnerPoDisplayStatus 와 같은 축(입고 확인 또는 발송 최종 상태).

const TABS = ['todo', 'active', 'done', 'all'] as const;
type TabKey = (typeof TABS)[number];
const PAGE_SIZE = 20;

const tab = useRouteTab<TabKey>(TABS, 'todo');
const q = ref('');
const page = ref(1);

const work = usePartnerBomWork();
const accessQuery = usePartnerAccess();
const noTrack = computed(() => accessQuery.data.value?.data.tracks.bom === false);

const isDone = (po: PartnerPoListItemType): boolean =>
  po.shipmentReceived ||
  (po.shipmentAttached &&
    po.shipmentMode !== null &&
    po.shipmentStatus !== null &&
    bomShipmentNextStatus(po.shipmentMode, po.shipmentStatus) === null);
const groupOf = (po: PartnerPoListItemType): Exclude<TabKey, 'all'> =>
  po.status === 'issued' ? 'todo' : isDone(po) ? 'done' : 'active';

const activePos = computed(() => work.poItems.value.filter((po) => groupOf(po) === 'active'));
const donePos = computed(() => work.poItems.value.filter((po) => groupOf(po) === 'done'));
const byTab = computed(() =>
  tab.value === 'todo'
    ? work.toConfirm.value
    : tab.value === 'active'
      ? activePos.value
      : tab.value === 'done'
        ? donePos.value
        : work.poItems.value,
);
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return needle === ''
    ? byTab.value
    : byTab.value.filter((po) => po.quoteTitle.toLowerCase().includes(needle));
});
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([tab, q], () => {
  page.value = 1;
});

const tabs = computed<PartnerWorkqueueTab<TabKey>[]>(() => [
  { key: 'todo', label: '확인할 발주', count: work.toConfirm.value.length, emphasize: true },
  { key: 'active', label: '진행 중', count: activePos.value.length },
  { key: 'done', label: '완료', count: donePos.value.length },
  { key: 'all', label: '전체', count: work.poItems.value.length },
]);
const emptyText = computed(() => {
  if (q.value.trim() !== '') return '검색 결과가 없습니다.';
  if (tab.value === 'todo') return '확인할 발주가 없습니다 🎉';
  if (tab.value === 'active') return '진행 중인 발주가 없습니다.';
  if (tab.value === 'done') return '완료된 발주가 아직 없습니다.';
  return '받은 발주서가 없습니다.';
});
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader
      title="발주서"
      subtitle="받은 발주서입니다 — 발주 확인 → 📦 보내기에서 담아 발송 → 입고 확인까지의 진행을 봅니다."
    />

    <div v-if="noTrack" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      이 조직은 BOM 부품 트랙에 참여하지 않습니다.
    </div>

    <template v-else>
      <PartnerWorkqueueTabs v-model="tab" :tabs="tabs" accent="indigo">
        <input
          v-model="q"
          type="search"
          placeholder="견적 제목 검색"
          aria-label="견적 제목 검색"
          class="w-48 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        >
      </PartnerWorkqueueTabs>

      <p v-if="work.posQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
      <PartnerEmpty v-else-if="filtered.length === 0">{{ emptyText }}</PartnerEmpty>
      <template v-else>
        <div class="grid gap-2">
          <PartnerBomPoRow v-for="po in paged" :key="po.poId" :po="po" />
        </div>
        <div v-if="filtered.length > PAGE_SIZE" class="flex items-center justify-between">
          <p class="text-sm text-gray-500">총 {{ filtered.length }}건</p>
          <UiPagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="filtered.length"
            @update:page="(p) => (page = p)"
          />
        </div>
      </template>
    </template>
  </div>
</template>
