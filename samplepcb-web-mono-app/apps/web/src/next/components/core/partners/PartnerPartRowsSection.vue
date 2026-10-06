<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PencilIcon, Trash2Icon, XIcon } from '@lucide/vue';
import { PARTNER_PART_FLAG_LABELS, partnerPartVisibleFlags, type PartnerPartRowType } from '@sp/api-contract';
import {
  useAdminPartnerPartList,
  useBulkToggleAdminPartnerParts,
  useDeleteAdminPartnerPart,
} from '@/admin/useAdminPartnerParts';
import ListPagination from '@/next/components/common/ListPagination.vue';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import RowCheckbox from '@/next/components/common/RowCheckbox.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { confirmDialog } from '@/next/lib/dialog';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Label } from '@/next/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';

// 협력사 보유 부품 — 원장 행(옛 AdminPartnerParts.vue 의 '부품 행' 상자). 협력사 요약에서 고르면 그 협력사로
// 좁히고(partnerId), 고른 행은 한꺼번에 끄고 켠다. 꺼진 행은 흐린 글자 + '꺼짐' 배지, 방금 저장한 행은 '저장됨'
// 배지(옛 화면의 행 바탕 강조 — 리뉴얼은 행 바탕색을 바꾸지 않고 배지로 옮긴다, ADMIN_NEXT_UI §8).
const props = defineProps<{
  partnerId: number | null;
  partnerName: string | null;
  justSaved: number | null;
}>();
const emit = defineEmits<{ 'clear-partner': []; edit: [part: PartnerPartRowType] }>();

const PAGE_SIZE = 50;

const q = ref('');
const qInput = ref('');
const page = ref(1);
const includeInactive = ref(true);
watch([q, () => props.partnerId, includeInactive], () => {
  page.value = 1;
});

const listParams = computed(() => ({
  q: q.value,
  page: page.value,
  pageSize: PAGE_SIZE,
  partnerId: props.partnerId,
  includeInactive: includeInactive.value,
}));
const listQuery = useAdminPartnerPartList(listParams);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const total = computed(() => listQuery.data.value?.data.total ?? 0);

const bulkToggle = useBulkToggleAdminPartnerParts();
const deleteRow = useDeleteAdminPartnerPart();

const selection = ref<Set<number>>(new Set());
watch([items], () => {
  selection.value = new Set();
});
const toggleRow = (partId: number): void => {
  const next = new Set(selection.value);
  if (next.has(partId)) next.delete(partId);
  else next.add(partId);
  selection.value = next;
};

const runBulk = async (isActive: boolean): Promise<void> => {
  if (selection.value.size === 0) return;
  await bulkToggle.mutateAsync({ partIds: [...selection.value], isActive });
  selection.value = new Set();
};

const runDeleteRow = async (partId: number, mpn: string): Promise<void> => {
  const ok = await confirmDialog({ title: '이 행을 지울까요?', message: mpn, confirmLabel: '삭제', tone: 'danger' });
  if (!ok) return;
  await deleteRow.mutateAsync(partId);
};

const applySearch = (): void => {
  q.value = qInput.value;
};
const onIncludeInactive = (checked: boolean | 'indeterminate'): void => {
  includeInactive.value = checked === true;
};

const fmtQty = (value: number | null): string => (value === null ? '—' : value.toLocaleString('ko-KR'));
const fmtDate = (iso: string | null): string => (iso === null ? '—' : new Date(iso).toLocaleDateString('ko-KR'));
const flagLabel = (flag: string): string => PARTNER_PART_FLAG_LABELS[flag] ?? flag;
</script>

<template>
  <div class="flex flex-col gap-3">
    <SectionCard title="부품 행" flush>
      <template #meta>
        {{ partnerName === null ? '(전체 협력사)' : `· ${partnerName}` }} · <span class="tabular-nums">{{ fmtQty(total) }}</span>
      </template>
      <template #actions>
        <Button v-if="partnerId !== null" variant="outline" size="sm" @click="emit('clear-partner')">
          <XIcon />
          필터 해제
        </Button>
        <div class="flex items-center gap-2">
          <Checkbox id="partner-parts-include-inactive" :model-value="includeInactive" @update:model-value="onIncludeInactive" />
          <Label for="partner-parts-include-inactive">꺼진 행도 보기</Label>
        </div>
        <SearchInput v-model="qInput" placeholder="품번·제조사 검색" @search="applySearch" />
      </template>
      <template v-if="selection.size > 0" #notice>
        <NoticeBand tone="info" class="flex items-center gap-2">
          <span class="font-medium">{{ selection.size }}행 선택</span>
          <Button variant="outline" size="xs" @click="void runBulk(false)">끄기</Button>
          <Button variant="outline" size="xs" @click="void runBulk(true)">켜기</Button>
        </NoticeBand>
      </template>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10" />
            <TableHead>품번</TableHead>
            <TableHead>협력사</TableHead>
            <TableHead>제조사</TableHead>
            <TableHead class="text-right">재고</TableHead>
            <TableHead>D/C</TableHead>
            <TableHead>기준일</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="part in items"
            :key="part.partId"
            :data-state="selection.has(part.partId) ? 'selected' : undefined"
          >
            <TableCell>
              <RowCheckbox
                :checked="selection.has(part.partId)"
                :label="`${part.mpn} 선택`"
                @change="toggleRow(part.partId)"
              />
            </TableCell>
            <TableCell :class="part.isActive ? '' : 'text-muted-foreground'">
              <span class="block font-medium" :class="part.isActive ? 'text-foreground' : ''">{{ part.mpn }}</span>
              <span v-if="part.mpnRaw !== part.mpn" class="text-muted-foreground block text-xs">원문 {{ part.mpnRaw }}</span>
              <span
                v-if="!part.isActive || part.editedAt !== null || justSaved === part.partId || partnerPartVisibleFlags(part.flags).length > 0"
                class="mt-1 flex flex-wrap gap-1"
              >
                <Badge v-if="justSaved === part.partId" variant="success">저장됨</Badge>
                <Badge v-if="!part.isActive" variant="secondary">꺼짐</Badge>
                <Badge v-if="part.editedAt !== null" variant="info" :title="`수정됨 · ${fmtDate(part.editedAt)}`">수정됨</Badge>
                <Badge v-for="flag in partnerPartVisibleFlags(part.flags)" :key="flag" variant="warning">
                  {{ flagLabel(flag) }}
                </Badge>
              </span>
            </TableCell>
            <TableCell :class="part.isActive ? '' : 'text-muted-foreground'">{{ part.partnerName ?? '—' }}</TableCell>
            <TableCell :class="part.isActive ? '' : 'text-muted-foreground'">{{ part.manufacturer ?? '—' }}</TableCell>
            <TableCell class="text-right tabular-nums" :class="part.isActive ? '' : 'text-muted-foreground'">{{ fmtQty(part.stockQty) }}</TableCell>
            <TableCell :class="part.isActive ? '' : 'text-muted-foreground'">{{ part.dateCode ?? '—' }}</TableCell>
            <TableCell class="text-xs tabular-nums" :class="part.isActive ? '' : 'text-muted-foreground'">{{ fmtDate(part.uploadedAt) }}</TableCell>
            <TableCell class="text-right whitespace-nowrap">
              <Button variant="ghost" size="xs" @click="emit('edit', part)">
                <PencilIcon />
                수정
              </Button>
              <Button variant="ghost" size="xs" @click="void runDeleteRow(part.partId, part.mpn)">
                <Trash2Icon class="text-destructive" />
                삭제
              </Button>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="items.length === 0" :colspan="8" text="결과가 없습니다." :loading="listQuery.isLoading.value" />
        </TableBody>
      </Table>
    </SectionCard>

    <ListPagination v-if="total > PAGE_SIZE" :page="page" :page-size="PAGE_SIZE" :total="total" @update:page="(p) => (page = p)" />
  </div>
</template>
