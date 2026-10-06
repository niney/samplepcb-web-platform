<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminMemberList, type AdminMemberFilters } from '@/admin/useAdminMembers';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import MemberDetailDrawer from '@/next/components/core/members/MemberDetailDrawer.vue';
import MemberFilterBar from '@/next/components/core/members/MemberFilterBar.vue';
import MembersTable from '@/next/components/core/members/MembersTable.vue';

// 관리자 회원 관리 — 전 회원 목록·상세·차단/레벨·회사명 프로필(옛 pages/admin/AdminMembers.vue 의 리뉴얼).
// 필터 상태는 이 화면이 단일 소유하고, 탭/필터 변경 시 1쪽으로 돌아간다. 주소에는 싣지 않는다(옛 화면과 같음).
const { t } = useI18n();

type MemberTab = AdminMemberFilters['tab'];

const filters = ref<AdminMemberFilters>({
  page: 1,
  pageSize: 20,
  tab: 'all',
  q: '',
  from: '',
  to: '',
  sort: 'joined',
});

const { data, isFetching } = useAdminMemberList(filters);
const selectedMbId = ref<string | null>(null);

const counts = computed(() => data.value?.data.counts ?? null);
const total = computed(() => data.value?.data.total ?? 0);

// normal/intercepted/left 는 상태 1:1(배타 집계), all = 전체. 건수는 탭 미반영 분포라 탭을 오가도 유지된다.
// 차단은 들여다볼 상태라 건수를 경고 배지로 띄운다(옛 화면의 호박색 건수).
const TAB_KEYS: readonly MemberTab[] = ['all', 'normal', 'intercepted', 'left'];
const tabs = computed<QueueTab<MemberTab>[]>(() =>
  TAB_KEYS.map((key) => ({
    key,
    label: t(`admin.members.tabs.${key}`),
    count: counts.value?.[key] ?? null,
    attention: key === 'intercepted',
  })),
);

const tab = ref<MemberTab>(filters.value.tab);
watch(tab, (key) => {
  filters.value = { ...filters.value, tab: key, page: 1 };
});

const applyFilters = (patch: Partial<AdminMemberFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.members.title')" />

    <div class="flex flex-col gap-3">
      <QueueTabs v-model="tab" :tabs="tabs" />
      <MemberFilterBar :filters="filters" @change="applyFilters" />
    </div>

    <MembersTable :items="data?.data.items ?? []" :loading="isFetching" @select="selectedMbId = $event" />

    <ListPagination
      v-if="data !== undefined"
      :page="filters.page"
      :page-size="filters.pageSize"
      :total="total"
      @update:page="setPage"
    >
      <template #summary>{{ t('admin.members.table.total', { n: total.toLocaleString('ko-KR') }) }}</template>
    </ListPagination>

    <MemberDetailDrawer :mb-id="selectedMbId" @close="selectedMbId = null" />
  </div>
</template>
