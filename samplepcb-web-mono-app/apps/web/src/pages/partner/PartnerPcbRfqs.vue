<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { usePartnerPcbWork } from '../../partner/usePartnerWork';
import { useRouteTab } from '../../partner/useRouteTab';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerWorkqueueTabs, {
  type PartnerWorkqueueTab,
} from '../../components/partner/PartnerWorkqueueTabs.vue';
import PartnerPcbRfqRow from '../../components/partner/PartnerPcbRfqRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// PCB 견적요청 워크큐(포털 재설계 R3 — BOM 견적요청 미러) — 회신할/회신함(회신 완료·선정·
// 미선정)/전체 탭. MD 의 하위 재요청·선정은 상세에서(docs/PCB_PARTNER_TRACK.md P1).

const TABS = ['todo', 'done', 'all'] as const;
type TabKey = (typeof TABS)[number];
const PAGE_SIZE = 20;

const tab = useRouteTab<TabKey>(TABS, 'todo');
const q = ref('');
const page = ref(1);

const work = usePartnerPcbWork();
const accessQuery = usePartnerAccess();
const noTrack = computed(() => accessQuery.data.value?.data.tracks.pcb === false);

const byTab = computed(() =>
  tab.value === 'todo'
    ? work.pendingRfqs.value
    : tab.value === 'done'
      ? work.doneRfqs.value
      : work.rfqItems.value,
);
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return needle === ''
    ? byTab.value
    : byTab.value.filter(
        (r) =>
          r.projectName.toLowerCase().includes(needle) ||
          r.requesterName.toLowerCase().includes(needle),
      );
});
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([tab, q], () => {
  page.value = 1;
});

const tabs = computed<PartnerWorkqueueTab<TabKey>[]>(() => [
  { key: 'todo', label: '회신할 견적', count: work.pendingRfqs.value.length, emphasize: true },
  { key: 'done', label: '회신함', count: work.doneRfqs.value.length },
  { key: 'all', label: '전체', count: work.rfqItems.value.length },
]);
const emptyText = computed(() => {
  if (q.value.trim() !== '') return '검색 결과가 없습니다.';
  if (tab.value === 'todo') return '회신할 견적이 없습니다 🎉';
  if (tab.value === 'done') return '회신한 견적이 아직 없습니다.';
  return '받은 견적요청이 없습니다.';
});
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader
      title="견적요청"
      subtitle="받은 PCB 견적요청에 회신합니다. 선정·미선정 결과도 여기서 봅니다."
    />

    <div v-if="noTrack" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      이 조직은 PCB 제작 트랙에 참여하지 않습니다.
    </div>

    <template v-else>
      <PartnerWorkqueueTabs v-model="tab" :tabs="tabs" accent="teal">
        <input
          v-model="q"
          type="search"
          placeholder="프로젝트명·발주처 검색"
          aria-label="프로젝트명·발주처 검색"
          class="w-52 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
        >
      </PartnerWorkqueueTabs>

      <p v-if="work.rfqsQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
      <PartnerEmpty v-else-if="filtered.length === 0">{{ emptyText }}</PartnerEmpty>
      <template v-else>
        <div class="grid gap-2">
          <PartnerPcbRfqRow v-for="rfq in paged" :key="rfq.rfqId" :rfq="rfq" />
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
