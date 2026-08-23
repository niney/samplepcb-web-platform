<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { usePartnerPcbWork } from '../../partner/usePartnerWork';
import { useRouteTab } from '../../partner/useRouteTab';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerWorkqueueTabs, {
  type PartnerWorkqueueTab,
} from '../../components/partner/PartnerWorkqueueTabs.vue';
import PartnerPcbPoRow from '../../components/partner/PartnerPcbPoRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// PCB 발주서 워크큐(포털 재설계 R3) — 홈의 '진행할 발주(내 차례)' + '진행 중 발주(관전)'를
// 탭으로 연다: 내 차례 / 진행 중(내 차례 아님 — MD 의 하위 진행·수주 위임 관전 포함) / 전체.
// 발송 조작은 [📦 PCB 보내기] 보드가 단일 창구(상세는 읽기 요약) — 여기선 발주·EQ 축만.

const TABS = ['todo', 'watching', 'all'] as const;
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
    ? work.myTurnPos.value
    : tab.value === 'watching'
      ? work.watchingPos.value
      : work.poItems.value,
);
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase();
  return needle === ''
    ? byTab.value
    : byTab.value.filter(
        (po) =>
          po.projectName.toLowerCase().includes(needle) ||
          po.counterpartyName.toLowerCase().includes(needle) ||
          `po-${String(po.poId)}`.includes(needle),
      );
});
const paged = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
);
watch([tab, q], () => {
  page.value = 1;
});

const tabs = computed<PartnerWorkqueueTab<TabKey>[]>(() => [
  { key: 'todo', label: '내 차례', count: work.myTurnPos.value.length, emphasize: true },
  { key: 'watching', label: '진행 중', count: work.watchingPos.value.length },
  { key: 'all', label: '전체', count: work.poItems.value.length },
]);
const emptyText = computed(() => {
  if (q.value.trim() !== '') return '검색 결과가 없습니다.';
  if (tab.value === 'todo') return '내 차례인 발주가 없습니다 🎉';
  if (tab.value === 'watching') return '진행 중인 발주가 없습니다.';
  return '받은 발주서가 없습니다.';
});
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader
      title="발주서"
      subtitle="받은 발주서의 EQ·생산 진행입니다. 내 차례인 건부터 처리해 주세요 — 발송은 📦 PCB 보내기에서."
    />

    <div v-if="noTrack" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      이 조직은 PCB 제작 트랙에 참여하지 않습니다.
    </div>

    <template v-else>
      <PartnerWorkqueueTabs v-model="tab" :tabs="tabs" accent="teal">
        <input
          v-model="q"
          type="search"
          placeholder="프로젝트명·상대·PO 번호 검색"
          aria-label="프로젝트명·상대·PO 번호 검색"
          class="w-56 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-teal-400 focus:outline-none"
        >
      </PartnerWorkqueueTabs>

      <p v-if="work.posQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
      <PartnerEmpty v-else-if="filtered.length === 0">{{ emptyText }}</PartnerEmpty>
      <template v-else>
        <div class="grid gap-2">
          <PartnerPcbPoRow v-for="po in paged" :key="po.poId" :po="po" />
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
