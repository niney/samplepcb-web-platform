<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import type { AdminDeleteAuditItemType } from '@sp/api-contract';
import {
  emptyDeleteAuditFilters,
  useAdminDeleteAuditList,
  type AdminDeleteAuditFilters,
} from '../../admin/useAdminDeleteAudits';
import { formatDateTime } from '../../lib/format';
import BomQuoteRetentionPanel from '../../components/admin/BomQuoteRetentionPanel.vue';
import UiBadge from '../../components/ui/UiBadge.vue';
import UiPagination from '../../components/ui/UiPagination.vue';

// 삭제 기록 — 관리자 강제 삭제(BOM·PCB Case)와 취소 견적 자동 정리가 남긴 감사 원장 조회.
// 모듈을 가로지르는 공용 원장이라 코어(통합) 메뉴에 둔다(발송 이력과 같은 자리).
// 지워진 내용 자체는 남지 않는다 — 무엇을·누가·왜·얼마나 지웠는지만 본다.
// URL 쿼리(actor·subjectType)는 초기 필터 프리셋 — 대시보드 위젯 링크 진입용.
const i18n = useI18n();
const { t } = i18n;
const route = useRoute();

const qs = (value: unknown): string => (typeof value === 'string' ? value : '');
const asActor = (value: string): AdminDeleteAuditFilters['actor'] =>
  value === 'auto' || value === 'manual' ? value : '';
const asSubject = (value: string): AdminDeleteAuditFilters['subjectType'] =>
  value === 'bom_case' || value === 'pcb_case' ? value : '';

const filters = ref<AdminDeleteAuditFilters>(
  emptyDeleteAuditFilters({
    actor: asActor(qs(route.query.actor)),
    subjectType: asSubject(qs(route.query.subjectType)),
  }),
);
const { data, isFetching } = useAdminDeleteAuditList(filters);
const items = computed(() => data.value?.data.items ?? []);
const total = computed(() => data.value?.data.total ?? 0);

const applyFilters = (patch: Partial<AdminDeleteAuditFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const resetFilters = (): void => {
  filters.value = emptyDeleteAuditFilters({ pageSize: filters.value.pageSize });
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};

const expandedId = ref<number | null>(null);
const toggle = (auditId: number): void => {
  expandedId.value = expandedId.value === auditId ? null : auditId;
};

const subjectTypeLabel = (subjectType: string): string => {
  const key = `admin.deleteAudits.subjectType.${subjectType}`;
  return i18n.te(key) ? t(key) : subjectType;
};

// ── 스냅샷 요약 — 대상 종류마다 모양이 달라 아는 칸만 뽑고, 원문은 행을 펼쳐서 본다 ──
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asCount = (value: unknown): number => (typeof value === 'number' ? value : 0);
const asText = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Case 번호(BOM 은 스냅샷에 있다) — 없으면 대상 번호. */
const subjectNo = (item: AdminDeleteAuditItemType): string =>
  asText(item.snapshot.caseNo) ?? `#${item.subjectId}`;

const IMPACT_KEYS = ['quoteItems', 'candidates', 'rfqs', 'rfqItems', 'pos', 'quoteFiles'] as const;

const summary = (item: AdminDeleteAuditItemType): string => {
  const parts: string[] = [];
  const impact = asRecord(item.snapshot.impact);
  if (impact !== null) {
    for (const key of IMPACT_KEYS) {
      const n = asCount(impact[key]);
      if (n > 0) parts.push(t(`admin.deleteAudits.impact.${key}`, { n }));
    }
  }
  // 주문이 함께 지워진 강제 삭제 — BOM 은 order.odId, PCB 는 최상위 odId.
  const odId = asText(asRecord(item.snapshot.order)?.odId) ?? asText(item.snapshot.odId);
  if (odId !== null) parts.push(t('admin.deleteAudits.impact.order', { odId }));
  return parts.length === 0 ? t('admin.deleteAudits.impact.none') : parts.join(' · ');
};

const snapshotText = (item: AdminDeleteAuditItemType): string =>
  JSON.stringify(item.snapshot, null, 2);
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl font-bold">{{ t('admin.deleteAudits.title') }}</h1>
      <p class="mt-1 text-sm text-gray-500">{{ t('admin.deleteAudits.subtitle') }}</p>
    </div>

    <BomQuoteRetentionPanel />

    <div class="space-y-3">
      <div class="flex flex-wrap items-end gap-2">
        <label class="block">
          <span class="mb-1 block text-xs text-gray-500">{{ t('admin.deleteAudits.filter.actor') }}</span>
          <select
            :value="filters.actor"
            class="rounded border border-gray-300 px-2 py-1.5 text-sm"
            data-testid="audit-filter-actor"
            @change="applyFilters({ actor: asActor(($event.target as HTMLSelectElement).value) })"
          >
            <option value="">{{ t('admin.deleteAudits.filter.all') }}</option>
            <option value="auto">{{ t('admin.deleteAudits.filter.auto') }}</option>
            <option value="manual">{{ t('admin.deleteAudits.filter.manual') }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-gray-500">{{ t('admin.deleteAudits.filter.subject') }}</span>
          <select
            :value="filters.subjectType"
            class="rounded border border-gray-300 px-2 py-1.5 text-sm"
            @change="applyFilters({ subjectType: asSubject(($event.target as HTMLSelectElement).value) })"
          >
            <option value="">{{ t('admin.deleteAudits.filter.all') }}</option>
            <option value="bom_case">{{ t('admin.deleteAudits.subjectType.bom_case') }}</option>
            <option value="pcb_case">{{ t('admin.deleteAudits.subjectType.pcb_case') }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-gray-500">{{ t('admin.deleteAudits.filter.search') }}</span>
          <input
            :value="filters.search"
            type="search"
            :placeholder="t('admin.deleteAudits.filter.searchPlaceholder')"
            class="w-56 rounded border border-gray-300 px-2 py-1.5 text-sm"
            data-testid="audit-filter-search"
            @change="applyFilters({ search: ($event.target as HTMLInputElement).value })"
          >
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-gray-500">{{ t('admin.deleteAudits.filter.from') }}</span>
          <input
            :value="filters.dateFrom"
            type="date"
            class="rounded border border-gray-300 px-2 py-1 text-sm"
            @change="applyFilters({ dateFrom: ($event.target as HTMLInputElement).value })"
          >
        </label>
        <label class="block">
          <span class="mb-1 block text-xs text-gray-500">{{ t('admin.deleteAudits.filter.to') }}</span>
          <input
            :value="filters.dateTo"
            type="date"
            class="rounded border border-gray-300 px-2 py-1 text-sm"
            @change="applyFilters({ dateTo: ($event.target as HTMLInputElement).value })"
          >
        </label>
        <button
          type="button"
          class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          @click="resetFilters"
        >
          {{ t('admin.deleteAudits.filter.reset') }}
        </button>
      </div>

      <div class="overflow-x-auto rounded-lg border border-gray-200">
        <table class="min-w-full divide-y divide-gray-200 text-sm" data-testid="audit-table">
          <thead class="bg-gray-50 text-left text-xs text-gray-500">
            <tr>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.deletedAt') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.subject') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.customer') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.statusAtDelete') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.actor') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.summary') }}</th>
              <th class="px-3 py-2 font-medium">{{ t('admin.deleteAudits.col.reason') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 bg-white">
            <tr v-if="items.length === 0">
              <td colspan="7" class="px-3 py-8 text-center text-gray-400">
                {{ isFetching ? t('admin.deleteAudits.loading') : t('admin.deleteAudits.empty') }}
              </td>
            </tr>
            <template v-for="item in items" :key="item.auditId">
              <tr class="cursor-pointer hover:bg-gray-50" @click="toggle(item.auditId)">
                <td class="whitespace-nowrap px-3 py-2 text-gray-600">
                  {{ formatDateTime(item.createdAt) }}
                </td>
                <td class="px-3 py-2">
                  <span class="block max-w-[18rem] truncate font-medium text-gray-800" :title="item.title">
                    {{ item.title }}
                  </span>
                  <span class="text-xs text-gray-500">
                    {{ subjectTypeLabel(item.subjectType) }} · {{ subjectNo(item) }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-gray-600">{{ item.mbId === '' ? '—' : item.mbId }}</td>
                <td class="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-600">
                  {{ item.subjectStatus }}
                </td>
                <td class="whitespace-nowrap px-3 py-2">
                  <UiBadge v-if="item.automatic" variant="info" :label="t('admin.deleteAudits.automatic')" />
                  <span v-else class="text-gray-700">{{ item.actorMbId }}</span>
                </td>
                <td class="min-w-[9rem] px-3 py-2 text-xs leading-5 text-gray-600">{{ summary(item) }}</td>
                <td class="max-w-[14rem] truncate px-3 py-2 text-gray-600" :title="item.reason">
                  {{ item.reason }}
                </td>
              </tr>
              <tr v-if="expandedId === item.auditId" class="bg-gray-50/60">
                <td colspan="7" class="px-4 py-3">
                  <div class="space-y-2 text-sm">
                    <p class="text-gray-700">
                      <span class="text-gray-400">{{ t('admin.deleteAudits.col.reason') }}:</span>
                      {{ item.reason }}
                    </p>
                    <div>
                      <p class="text-xs text-gray-400">{{ t('admin.deleteAudits.detail.snapshot') }}</p>
                      <pre
                        class="mt-1 max-h-72 max-w-[60rem] overflow-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 text-xs text-gray-700"
                      >{{ snapshotText(item) }}</pre>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="total > 0" class="flex items-center justify-between">
        <p class="text-sm text-gray-500">{{ t('admin.deleteAudits.total', { n: total }) }}</p>
        <UiPagination
          :page="filters.page"
          :page-size="filters.pageSize"
          :total="total"
          @update:page="setPage"
        />
      </div>
    </div>
  </div>
</template>
