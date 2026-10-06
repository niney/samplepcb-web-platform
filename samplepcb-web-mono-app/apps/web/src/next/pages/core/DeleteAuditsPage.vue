<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { RotateCcwIcon } from '@lucide/vue';
import type { AdminDeleteAuditItemType } from '@sp/api-contract';
import {
  emptyDeleteAuditFilters,
  useAdminDeleteAuditList,
  type AdminDeleteAuditFilters,
} from '@/admin/useAdminDeleteAudits';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import BomQuoteRetentionPanel from '@/next/components/core/audit/BomQuoteRetentionPanel.vue';

// 삭제 기록 — 옛 pages/admin/AdminDeleteAudits.vue 의 짝. 관리자 강제 삭제(BOM·PCB Case)와 취소 견적 자동
// 정리가 남긴 감사 원장 조회. 모듈을 가로지르는 공용 원장이라 통합 메뉴에 둔다(발송 이력과 같은 자리).
// 지워진 내용 자체는 남지 않는다 — 무엇을·누가·왜·얼마나 지웠는지만 본다.
// URL 쿼리(actor·subjectType)는 초기 필터 프리셋 — 대시보드 위젯 링크 진입용.
const i18n = useI18n();
const { t } = i18n;
const route = useRoute();
const uid = useId();

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
const eventValue = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value;

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
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const asCount = (value: unknown): number => (typeof value === 'number' ? value : 0);
const asText = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** Case 번호(BOM 은 스냅샷에 있다) — 없으면 대상 번호. */
const subjectNo = (item: AdminDeleteAuditItemType): string => asText(item.snapshot.caseNo) ?? `#${item.subjectId}`;

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

const snapshotText = (item: AdminDeleteAuditItemType): string => JSON.stringify(item.snapshot, null, 2);
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="t('admin.deleteAudits.title')" :description="t('admin.deleteAudits.subtitle')" />

    <BomQuoteRetentionPanel />

    <div class="flex flex-col gap-3">
      <!-- 필터 바 — select 는 네이티브(e2e selectOption 호환), 검색은 Enter·포커스 이탈로 확정(change). -->
      <div class="flex flex-wrap items-end gap-3">
        <Field class="w-auto">
          <FieldLabel :for="`${uid}-actor`">{{ t('admin.deleteAudits.filter.actor') }}</FieldLabel>
          <NativeSelect
            :id="`${uid}-actor`"
            :model-value="filters.actor"
            data-testid="audit-filter-actor"
            @change="(e: Event) => applyFilters({ actor: asActor(eventValue(e)) })"
          >
            <NativeSelectOption value="">{{ t('admin.deleteAudits.filter.all') }}</NativeSelectOption>
            <NativeSelectOption value="auto">{{ t('admin.deleteAudits.filter.auto') }}</NativeSelectOption>
            <NativeSelectOption value="manual">{{ t('admin.deleteAudits.filter.manual') }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field class="w-auto">
          <FieldLabel :for="`${uid}-subject`">{{ t('admin.deleteAudits.filter.subject') }}</FieldLabel>
          <NativeSelect
            :id="`${uid}-subject`"
            :model-value="filters.subjectType"
            @change="(e: Event) => applyFilters({ subjectType: asSubject(eventValue(e)) })"
          >
            <NativeSelectOption value="">{{ t('admin.deleteAudits.filter.all') }}</NativeSelectOption>
            <NativeSelectOption value="bom_case">{{ t('admin.deleteAudits.subjectType.bom_case') }}</NativeSelectOption>
            <NativeSelectOption value="pcb_case">{{ t('admin.deleteAudits.subjectType.pcb_case') }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field class="w-auto">
          <FieldLabel :for="`${uid}-search`">{{ t('admin.deleteAudits.filter.search') }}</FieldLabel>
          <Input
            :id="`${uid}-search`"
            :model-value="filters.search"
            type="search"
            class="w-56"
            :placeholder="t('admin.deleteAudits.filter.searchPlaceholder')"
            data-testid="audit-filter-search"
            @change="(e: Event) => applyFilters({ search: eventValue(e) })"
          />
        </Field>
        <Field class="w-auto">
          <FieldLabel :for="`${uid}-from`">{{ t('admin.deleteAudits.filter.from') }}</FieldLabel>
          <Input
            :id="`${uid}-from`"
            :model-value="filters.dateFrom"
            type="date"
            @change="(e: Event) => applyFilters({ dateFrom: eventValue(e) })"
          />
        </Field>
        <Field class="w-auto">
          <FieldLabel :for="`${uid}-to`">{{ t('admin.deleteAudits.filter.to') }}</FieldLabel>
          <Input
            :id="`${uid}-to`"
            :model-value="filters.dateTo"
            type="date"
            @change="(e: Event) => applyFilters({ dateTo: eventValue(e) })"
          />
        </Field>
        <Button variant="outline" @click="resetFilters">
          <RotateCcwIcon />
          {{ t('admin.deleteAudits.filter.reset') }}
        </Button>
      </div>

      <TableCard>
        <Table data-testid="audit-table">
          <TableHeader>
            <TableRow>
              <TableHead>{{ t('admin.deleteAudits.col.deletedAt') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.subject') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.customer') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.statusAtDelete') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.actor') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.summary') }}</TableHead>
              <TableHead>{{ t('admin.deleteAudits.col.reason') }}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableEmptyRow v-if="items.length === 0" :colspan="7" :text="t('admin.deleteAudits.empty')" :loading="isFetching" />
            <template v-for="item in items" :key="item.auditId">
              <TableRow
                class="cursor-pointer"
                :data-state="expandedId === item.auditId ? 'selected' : undefined"
                :aria-expanded="expandedId === item.auditId"
                @click="toggle(item.auditId)"
              >
                <TableCell class="text-muted-foreground tabular-nums">{{ formatDateTime(item.createdAt) }}</TableCell>
                <TableCell>
                  <span class="block max-w-72 truncate font-medium" :title="item.title">{{ item.title }}</span>
                  <span class="text-muted-foreground text-xs">{{ subjectTypeLabel(item.subjectType) }} · {{ subjectNo(item) }}</span>
                </TableCell>
                <TableCell class="text-muted-foreground">{{ item.mbId === '' ? '—' : item.mbId }}</TableCell>
                <TableCell class="text-muted-foreground font-mono text-xs">{{ item.subjectStatus }}</TableCell>
                <TableCell>
                  <Badge v-if="item.automatic" variant="info">{{ t('admin.deleteAudits.automatic') }}</Badge>
                  <span v-else>{{ item.actorMbId }}</span>
                </TableCell>
                <TableCell class="text-muted-foreground min-w-36 text-xs leading-5 whitespace-normal">{{ summary(item) }}</TableCell>
                <TableCell class="text-muted-foreground">
                  <span class="block max-w-56 truncate" :title="item.reason">{{ item.reason }}</span>
                </TableCell>
              </TableRow>
              <TableRow v-if="expandedId === item.auditId">
                <TableCell :colspan="7" class="bg-muted/30 whitespace-normal">
                  <div class="space-y-2 px-2 py-1 text-sm">
                    <p>
                      <span class="text-muted-foreground">{{ t('admin.deleteAudits.col.reason') }}:</span>
                      {{ item.reason }}
                    </p>
                    <div>
                      <p class="text-muted-foreground text-xs">{{ t('admin.deleteAudits.detail.snapshot') }}</p>
                      <Panel class="bg-background mt-1 max-h-72 max-w-240 overflow-auto">
                        <pre class="text-xs whitespace-pre-wrap">{{ snapshotText(item) }}</pre>
                      </Panel>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </TableCard>

      <ListPagination v-if="total > 0" :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
    </div>
  </div>
</template>
