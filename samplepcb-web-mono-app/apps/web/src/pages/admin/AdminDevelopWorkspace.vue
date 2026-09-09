<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useQuery } from '@tanstack/vue-query';
import { apiGet } from '@sp/shared';
import { UiPagination } from '@sp/ui';
import {
  AdminDevelopWorkspaceResponse,
  DEVELOP_ADMIN_TABS,
  DEVELOP_ADMIN_TAB_LABELS,
  DEVELOP_REQUEST_STATUS_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_MILESTONE_STATUS_LABELS,
  WORK_DOCUMENT_TEMPLATES,
  apiRoutes,
} from '@sp/api-contract';
import type { DevelopWorkspaceSectionType, DevelopAdminTabType } from '@sp/api-contract';
import {
  DEVELOP_ADMIN_SECTIONS,
  developDetailTo,
  developListFilters,
} from '../../admin/develop-navigation';
import { developStatusBadgeClass } from '../../components/admin/develop/develop-badge';
import { formatDate, formatKrw } from '../../lib/format';

const props = defineProps<{ section: DevelopWorkspaceSectionType }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const filters = computed(() => developListFilters(route.query));
const qInput = ref(filters.value.q);
watch(
  () => filters.value.q,
  (value) => {
    qInput.value = value;
  },
);
const titleKey = computed(
  () =>
    DEVELOP_ADMIN_SECTIONS.find((item) => item.key === props.section)?.label ??
    'admin.menu.developOverview',
);
const { data, isFetching, isError, refetch } = useQuery({
  queryKey: computed(() => ['admin', 'develop', 'workspace', props.section, filters.value]),
  queryFn: () => {
    const f = filters.value;
    const params = new URLSearchParams({
      section: props.section,
      tab: f.tab,
      page: String(f.page),
      pageSize: String(f.pageSize),
      q: f.q,
    });
    return apiGet(
      `${apiRoutes.adminDevelopWorkspace}?${params.toString()}`,
      AdminDevelopWorkspaceResponse,
    );
  },
  placeholderData: (previous, previousQuery) => previousQuery?.queryKey[3] === props.section ? previous : undefined,
});
const result = computed(() => data.value?.data);
const tabs = computed(() =>
  DEVELOP_ADMIN_TABS.filter(
    (tab) => tab === 'all' || tab === filters.value.tab || (result.value?.counts[tab] ?? 0) > 0,
  ),
);
const cards = ['all', 'received', 'in_progress', 'delivered'] as const;
function setFilters(patch: { tab?: DevelopAdminTabType; q?: string; page?: number }): void {
  const next = { ...filters.value, ...patch };
  void router.replace({
    query: { tab: next.tab, page: String(next.page), ...(next.q === '' ? {} : { q: next.q }) },
  });
}
const detailTo = (id: number, extra: Record<string, string> = {}) =>
  developDetailTo(id, props.section, route.query, extra);
</script>

<template>
  <div class="space-y-5" :aria-busy="isFetching">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="mb-1 text-xs font-semibold text-blue-600">{{ t('admin.modules.develop') }}</p>
        <h1 class="text-2xl font-bold">{{ t(titleKey) }}</h1>
        <p class="mt-2 text-sm text-gray-500">
          {{ t(`admin.develop.workspace.description.${section}`) }}
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
        :disabled="isFetching"
        @click="refetch()"
      >
        {{ t('admin.develop.workspace.refresh') }}
      </button>
    </header>

    <div v-if="section === 'overview' && result" class="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <button
        v-for="key in cards"
        :key="key"
        type="button"
        class="rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-blue-400"
        @click="setFilters({ tab: key, page: 1 })"
      >
        <span class="text-sm text-gray-500">{{ DEVELOP_ADMIN_TAB_LABELS[key] }}</span>
        <strong class="mt-2 block text-3xl">{{ result.counts[key] }}</strong>
      </button>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <nav
        class="flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1"
        :aria-label="t('admin.develop.workspace.statusFilter')"
      >
        <button
          v-for="key in tabs"
          :key="key"
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-semibold"
          :class="
            filters.tab === key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          "
          @click="setFilters({ tab: key, page: 1 })"
        >
          {{ DEVELOP_ADMIN_TAB_LABELS[key] }}
          <span v-if="result" class="ml-1 opacity-70">{{ result.counts[key] }}</span>
        </button>
      </nav>
      <form
        class="ml-auto flex w-full gap-2 sm:w-auto"
        @submit.prevent="setFilters({ q: qInput.trim(), page: 1 })"
      >
        <input
          v-model="qInput"
          type="search"
          maxlength="100"
          class="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm sm:w-64"
          :aria-label="t('admin.develop.workspace.search')"
          :placeholder="t('admin.develop.workspace.search')"
        >
        <button
          type="submit"
          class="shrink-0 rounded-lg bg-gray-800 px-3 text-sm font-semibold text-white"
        >
          {{ t('admin.develop.search') }}
        </button>
      </form>
    </div>

    <p v-if="isError" role="alert" class="rounded-lg bg-red-50 p-4 text-sm text-red-700">
      {{ t('admin.develop.workspace.loadError') }}
    </p>
    <div v-else class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table class="w-full min-w-[760px] text-left text-sm">
        <thead class="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
          <tr>
            <th class="w-64 px-4 py-3">{{ t('admin.develop.workspace.project') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.status') }}</th>
            <th class="min-w-80 px-4 py-3">{{ t(`admin.develop.workspace.column.${section}`) }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.col.assignee') }}</th>
            <th class="px-4 py-3">{{ t('admin.develop.workspace.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in result?.items ?? []"
            :key="item.requestId"
            class="border-b border-gray-100 align-top hover:bg-blue-50/20"
          >
            <td class="px-4 py-4">
              <RouterLink
                :to="detailTo(item.requestId)"
                class="font-semibold text-blue-700 hover:underline"
              >
                {{ item.title }}
              </RouterLink>
              <p class="mt-1 text-xs text-gray-500">
                #{{ item.requestId }} · {{ item.contactCompany ?? item.contactName }}
              </p>
              <p class="mt-1 text-xs text-gray-400">{{ formatDate(item.updatedAt) }}</p>
            </td>
            <td class="px-4 py-4">
              <span
                class="whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold"
                :class="developStatusBadgeClass(item.status)"
              >{{ DEVELOP_REQUEST_STATUS_LABELS[item.status] }}</span>
            </td>
            <td class="px-4 py-4">
              <template v-if="section === 'overview' || section === 'schedule'">
                <div v-if="item.progress !== null" class="max-w-64">
                  <div class="flex justify-between gap-4">
                    <span>{{ t('admin.develop.workspace.progress') }}</span><strong>{{ item.progress }}%</strong>
                  </div>
                  <progress
                    :value="item.progress"
                    max="100"
                    class="mt-1 h-2 w-full accent-blue-600"
                    :aria-label="t('admin.develop.workspace.progress')"
                  />
                  <p class="mt-1 text-xs text-gray-500">
                    {{
                      t('admin.develop.workspace.tasks', {
                        done: item.completedTasks,
                        total: item.taskCount,
                      })
                    }}
                  </p>
                </div>
                <p v-else class="text-gray-500">{{ t('admin.develop.workspace.noPlan') }}</p>
                <p v-if="!item.workflowEnabled" class="mt-2 text-xs text-gray-500">
                  {{ t('admin.develop.workspace.notEnabled') }}
                </p>
                <p v-if="item.forecastEnd" class="mt-2">
                  {{ t('admin.develop.workspace.forecast') }} {{ item.forecastEnd }}
                </p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <RouterLink
                    v-if="item.overdueTasks"
                    :to="detailTo(item.requestId, { tab: 'plan' })"
                    class="text-xs font-semibold text-red-600 hover:underline"
                  >
                    {{
                      t('admin.develop.workspace.overdue', { count: item.overdueTasks })
                    }}
                  </RouterLink>
                  <RouterLink
                    v-if="item.pendingApprovals"
                    :to="detailTo(item.requestId, { tab: 'documents' })"
                    class="text-xs font-semibold text-amber-700 hover:underline"
                  >
                    {{
                      t('admin.develop.workspace.pending', { count: item.pendingApprovals })
                    }}
                  </RouterLink>
                  <RouterLink
                    v-if="section === 'schedule'"
                    :to="detailTo(item.requestId, { tab: 'workflow' })"
                    class="text-xs text-blue-600 hover:underline"
                  >
                    {{ t('admin.develop.workspace.readiness') }}
                  </RouterLink>
                </div>
              </template>
              <template v-else-if="section === 'quotes'">
                <div v-for="quote in item.quotes" :key="quote.id" class="mb-2">
                  <RouterLink :to="detailTo(item.requestId)" class="font-medium hover:text-blue-600">
                    v{{ quote.version }} · {{ quote.title }}
                  </RouterLink>
                  <p class="text-xs text-gray-500">
                    {{ DEVELOP_QUOTE_STATUS_LABELS[quote.status] }} · {{ formatKrw(quote.amount) }}
                  </p>
                </div>
                <p v-if="!item.quotes.length" class="text-gray-500">
                  {{ t('admin.develop.workspace.noQuote') }}
                </p>
                <RouterLink
                  :to="detailTo(item.requestId, { tab: 'documents', kind: 'contract' })"
                  class="mt-2 inline-block text-xs text-blue-600 hover:underline"
                >
                  {{ t('admin.develop.workspace.contract') }}
                </RouterLink>
              </template>
              <template v-else-if="section === 'documents' || section === 'delivery'">
                <p v-if="section === 'delivery'" class="mb-2 text-xs text-gray-500">
                  {{
                    item.deliveredAt
                      ? `${t('admin.develop.workspace.delivered')} ${formatDate(item.deliveredAt)} · ${t('admin.develop.workspace.reviewDays', { count: item.reviewDays })}`
                      : t('admin.develop.workspace.prepareDelivery')
                  }}
                </p>
                <div
                  v-for="doc in item.documents.filter(
                    (d) => section !== 'delivery' || d.kind === 'delivery',
                  )"
                  :key="doc.id"
                  class="mb-3 last:mb-0"
                >
                  <RouterLink
                    :to="
                      detailTo(item.requestId, {
                        tab: section === 'delivery' ? 'delivery' : 'documents',
                        doc: doc.id,
                      })
                    "
                    class="font-medium text-blue-700 hover:underline"
                  >
                    {{ doc.title }}
                  </RouterLink>
                  <p class="mt-1 text-xs text-gray-500">
                    {{ WORK_DOCUMENT_TEMPLATES[doc.kind].label }} ·
                    {{ t(`admin.develop.workspace.documentStatus.${doc.status}`)
                    }}<span v-if="doc.publishedVersion"> · v{{ doc.publishedVersion }}</span><span v-if="doc.dueDate"> · {{ doc.dueDate }}</span>
                  </p>
                </div>
                <p
                  v-if="
                    !item.documents.some((d) => section !== 'delivery' || d.kind === 'delivery')
                  "
                  class="text-gray-500"
                >
                  {{ t('admin.develop.workspace.noDocument') }}
                </p>
              </template>
              <template v-else-if="section === 'payments'">
                <div class="mb-3 flex flex-wrap gap-4 text-xs">
                  <span>{{ t('admin.develop.workspace.paid') }}
                    <strong>{{ formatKrw(item.paidAmount) }}</strong></span><span>{{ t('admin.develop.workspace.unpaid') }}
                    <strong class="text-amber-700">{{
                      formatKrw(item.pendingAmount)
                    }}</strong></span>
                </div>
                <p
                  v-for="milestone in item.milestones"
                  :key="milestone.id"
                  class="mb-1 text-xs text-gray-600"
                >
                  v{{ milestone.quoteVersion }} · {{ milestone.title }} ·
                  {{ formatKrw(milestone.amount) }} ·
                  {{ DEVELOP_MILESTONE_STATUS_LABELS[milestone.status] }}
                </p>
                <RouterLink
                  v-if="item.workflowEnabled"
                  :to="detailTo(item.requestId, { tab: 'workflow' })"
                  class="mt-2 inline-block text-xs text-blue-600 hover:underline"
                >
                  {{ t('admin.develop.workspace.openPayment') }}
                </RouterLink>
              </template>
            </td>
            <td class="px-4 py-4 text-gray-500">{{ item.assignee ?? '—' }}</td>
            <td class="px-4 py-4">
              <RouterLink
                :to="detailTo(item.requestId)"
                class="whitespace-nowrap rounded-md border border-gray-200 px-3 py-1.5 font-semibold text-blue-600 hover:bg-blue-50"
              >
                {{ t(`admin.develop.workspace.open.${section}`) }}
              </RouterLink>
            </td>
          </tr>
          <tr v-if="!result?.items.length">
            <td colspan="5" class="px-4 py-14 text-center text-gray-500">
              {{ isFetching ? t('admin.develop.loading') : t('admin.develop.workspace.empty')
              }}<RouterLink
                v-if="!isFetching && section !== 'overview'"
                :to="{ name: 'admin-develop' }"
                class="mt-3 block text-blue-600 hover:underline"
              >
                {{ t('admin.develop.workspace.allProjects') }}
              </RouterLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="result" class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-gray-500">
        {{ t('admin.develop.workspace.total', { total: result.total }) }}
      </p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="result.total"
        @update:page="(page: number) => setFilters({ page })"
      />
    </div>
  </div>
</template>
