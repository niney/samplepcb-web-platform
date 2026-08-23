<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { usePartnerBomWork } from '../../partner/usePartnerWork';
import { useRouteTab } from '../../partner/useRouteTab';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerWorkqueueTabs, {
  type PartnerWorkqueueTab,
} from '../../components/partner/PartnerWorkqueueTabs.vue';
import PartnerBomRfqRow from '../../components/partner/PartnerBomRfqRow.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// BOM 견적요청 워크큐(포털 재설계 R3) — 홈이 '회신할 견적'만 보여 주고 회신한 견적은
// 접힌 아카이브로 쌓이던 것을, 탭(회신할/회신함/전체)으로 연다(관리자 워크큐 미러).
// 목록은 서버가 전량 내려주므로 검색·페이지는 클라이언트에서(건수가 커지면 서버 전환).

const TABS = ['todo', 'done', 'all'] as const;
type TabKey = (typeof TABS)[number];
const PAGE_SIZE = 20;

const tab = useRouteTab<TabKey>(TABS, 'todo');
const q = ref('');
const page = ref(1);

const work = usePartnerBomWork();
const accessQuery = usePartnerAccess();
// 트랙 가드 — capability 없는 모듈 URL 직접 진입 시 안내(데이터는 서버가 어차피 안 준다).
const noTrack = computed(() => accessQuery.data.value?.data.tracks.bom === false);

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
    : byTab.value.filter((r) => r.quoteTitle.toLowerCase().includes(needle));
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
      subtitle="받은 견적요청에 회신합니다. 회신한 내용은 마감 전까지 다시 고칠 수 있습니다."
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

      <p v-if="work.rfqsQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
      <PartnerEmpty v-else-if="filtered.length === 0">{{ emptyText }}</PartnerEmpty>
      <template v-else>
        <div class="grid gap-2">
          <PartnerBomRfqRow v-for="rfq in paged" :key="rfq.rfqId" :rfq="rfq" />
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
