<script setup lang="ts">
import { computed } from 'vue';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/next/components/ui/pagination';

// 목록 바닥 — 왼쪽 총 건수, 오른쪽 쪽 번호. 한 쪽뿐이면 번호를 숨기고 건수만 남긴다.
// page 는 1부터. 쪽을 옮기면 update:page 만 내고, 선택 해제 등 부수 효과는 호출부가 한다.
const props = defineProps<{
  page: number;
  pageSize: number;
  total: number;
}>();
const emit = defineEmits<{ 'update:page': [page: number] }>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-muted-foreground text-sm">
      총 <span class="text-foreground font-medium tabular-nums">{{ total.toLocaleString('ko-KR') }}</span>건
    </p>
    <Pagination
      v-if="totalPages > 1"
      :page="page"
      :total="total"
      :items-per-page="pageSize"
      :sibling-count="1"
      show-edges
      class="mx-0 w-auto justify-end"
      @update:page="emit('update:page', $event)"
    >
      <PaginationContent v-slot="{ items }">
        <PaginationPrevious>
          <span>이전</span>
        </PaginationPrevious>
        <template v-for="(item, index) in items" :key="index">
          <PaginationItem v-if="item.type === 'page'" :value="item.value" :is-active="item.value === page">
            {{ item.value }}
          </PaginationItem>
          <PaginationEllipsis v-else :index="index" />
        </template>
        <PaginationNext>
          <span>다음</span>
        </PaginationNext>
      </PaginationContent>
    </Pagination>
  </div>
</template>
