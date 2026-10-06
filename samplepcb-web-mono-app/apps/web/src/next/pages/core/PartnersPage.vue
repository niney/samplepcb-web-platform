<script setup lang="ts">
import { computed, ref } from 'vue';
import { PlusIcon } from '@lucide/vue';
import {
  PARTNER_CAPABILITY_LABELS,
  PARTNER_STATUS_LABELS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
} from '@sp/api-contract';
import { useAdminPartnerList, type AdminPartnerFilters } from '@/admin/useAdminPartners';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import PartnerCreateDialog from '@/next/components/core/partners/PartnerCreateDialog.vue';
import PartnerDetailSheet from '@/next/components/core/partners/PartnerDetailSheet.vue';
import { partnerStatusVariant } from '@/next/components/core/partners/partner-form';

// 통합 관리의 공용 파트너(조직) 기준정보 — 목록(상태 탭×유형 필터, counts)·상세 서랍·등록/수정·승인/정지·
// 계정 연결. BOM·PCB·부품 판매 트랙이 같은 조직 원장을 쓴다. 도메인 라벨은 @sp/api-contract
// PARTNER_*_LABELS 정본을 그대로 쓴다. 옛 화면(pages/admin/AdminPartners.vue)처럼 목록 상태는 주소에 싣지 않는다.

type TabKey = AdminPartnerFilters['tab'];
type TypeKey = AdminPartnerFilters['type'];

const filters = ref<AdminPartnerFilters>({ page: 1, pageSize: 20, tab: 'all', type: 'all', q: '' });
const qInput = ref('');
const list = useAdminPartnerList(filters);
const rows = computed(() => list.data.value?.data.items ?? []);
const counts = computed(() => list.data.value?.data.counts ?? null);

const selectedId = ref<number | null>(null);
const createOpen = ref(false);

const tab = computed<TabKey>({
  get: () => filters.value.tab,
  set: (value) => {
    filters.value = { ...filters.value, tab: value, page: 1 };
  },
});
const tabs = computed<QueueTab<TabKey>[]>(() => [
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
  { key: 'pending', label: PARTNER_STATUS_LABELS.pending, count: counts.value?.pending ?? null, attention: true },
  { key: 'approved', label: PARTNER_STATUS_LABELS.approved, count: counts.value?.approved ?? null },
  { key: 'suspended', label: PARTNER_STATUS_LABELS.suspended, count: counts.value?.suspended ?? null },
]);

const TYPE_FILTERS: readonly TypeKey[] = ['all', ...PARTNER_TYPES];
const typeFilterLabel = (t: TypeKey): string => (t === 'all' ? '전체 유형' : PARTNER_TYPE_LABELS[t]);
const setType = (type: TypeKey): void => {
  filters.value = { ...filters.value, type, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="파트너 관리" description="BOM·PCB·부품 판매 트랙이 함께 쓰는 협력사·공급사 조직 원장입니다.">
      <template #actions>
        <Button @click="createOpen = true">
          <PlusIcon />
          파트너 등록
        </Button>
      </template>
    </PageHeader>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <ButtonGroup aria-label="유형 필터">
          <Button
            v-for="t in TYPE_FILTERS"
            :key="t"
            size="sm"
            :variant="filters.type === t ? 'secondary' : 'outline'"
            :aria-pressed="filters.type === t"
            @click="setType(t)"
          >
            {{ typeFilterLabel(t) }}
          </Button>
        </ButtonGroup>
        <SearchInput v-model="qInput" placeholder="이름·코드·이메일·회원ID 검색" @search="applySearch" />
      </template>
    </QueueTabs>

    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>이름</TableHead>
            <TableHead>유형</TableHead>
            <TableHead>코드</TableHead>
            <TableHead>통화</TableHead>
            <TableHead>참여 트랙</TableHead>
            <TableHead>계정</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>등록일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="p in rows"
            :key="p.partnerId"
            class="cursor-pointer"
            :data-state="selectedId === p.partnerId ? 'selected' : undefined"
            @click="selectedId = p.partnerId"
          >
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>{{ PARTNER_TYPE_LABELS[p.type] }}</TableCell>
            <TableCell class="text-muted-foreground font-mono text-xs">{{ p.supplierCode ?? '—' }}</TableCell>
            <TableCell>{{ p.defaultCurrency }}</TableCell>
            <TableCell>
              <span v-if="p.capabilities.length > 0" class="inline-flex flex-wrap gap-1">
                <Badge v-for="c in p.capabilities" :key="c" variant="secondary">{{ PARTNER_CAPABILITY_LABELS[c] }}</Badge>
              </span>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="tabular-nums" :class="p.memberCount === 0 ? 'text-muted-foreground' : ''">
              {{ p.memberCount }}
            </TableCell>
            <TableCell>
              <Badge :variant="partnerStatusVariant(p.status)">{{ PARTNER_STATUS_LABELS[p.status] }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ p.createdAt.slice(0, 10) }}</TableCell>
          </TableRow>
          <TableEmptyRow v-if="rows.length === 0" :colspan="8" text="대상이 없습니다." :loading="list.isFetching.value" />
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination
      v-if="list.data.value !== undefined"
      :page="filters.page"
      :page-size="filters.pageSize"
      :total="list.data.value.data.total"
      @update:page="setPage"
    >
      <template #summary>
        총 <span class="text-foreground font-medium tabular-nums">{{ list.data.value.data.total.toLocaleString('ko-KR') }}</span>곳
      </template>
    </ListPagination>

    <PartnerDetailSheet :partner-id="selectedId" @close="selectedId = null" />
    <PartnerCreateDialog v-model:open="createOpen" @created="(id: number) => (selectedId = id)" />
  </div>
</template>
