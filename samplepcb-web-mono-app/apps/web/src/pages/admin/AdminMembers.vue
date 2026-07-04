<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdminMemberList, type AdminMemberFilters } from '../../admin/useAdminMembers';
import MemberStatusTabs from '../../components/admin/MemberStatusTabs.vue';
import MemberFilterBar from '../../components/admin/MemberFilterBar.vue';
import MembersTable from '../../components/admin/MembersTable.vue';
import MemberDetailDrawer from '../../components/admin/MemberDetailDrawer.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 관리자 회원 관리 — 전 회원 목록·상세·차단/레벨·회사명 프로필.
// 필터 상태는 이 페이지가 단일 소유하고, 탭/필터 변경 시 1페이지로 리셋한다.
const { t } = useI18n();

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

const setTab = (tab: AdminMemberFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const applyFilters = (patch: Partial<AdminMemberFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.members.title') }}</h1>

    <MemberStatusTabs :tab="filters.tab" :counts="data?.data.counts" @update:tab="setTab" />
    <MemberFilterBar :filters="filters" @change="applyFilters" />
    <MembersTable
      :items="data?.data.items ?? []"
      :loading="isFetching"
      @select="selectedMbId = $event"
    />

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">
        {{ t('admin.members.table.total', { n: data.data.total }) }}
      </p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="setPage"
      />
    </div>

    <MemberDetailDrawer :mb-id="selectedMbId" @close="selectedMbId = null" />
  </div>
</template>
