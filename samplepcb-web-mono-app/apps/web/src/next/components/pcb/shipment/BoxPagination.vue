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

// 선적 표 바닥 — 키트 ListPagination 과 같은 모양이되 왼쪽 문구가 "박스 N건 · 발주 M건"이다.
// 행이 구성원(발주) 단위로 펼쳐져서, 페이징 축(박스)과 눈에 보이는 행 수(발주)를 함께 말해야 한다.
// (키트 ListPagination 에 요약 슬롯이 생기면 이 파일은 그것으로 바꾼다.)
const props = defineProps<{
  page: number;
  pageSize: number;
  /** 박스(선적) 수 — 페이징 축 */
  total: number;
  /** 발주(구성원) 수 — 눈에 보이는 행 수 */
  poTotal: number;
}>();
const emit = defineEmits<{ 'update:page': [page: number] }>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-muted-foreground text-sm">
      박스 <span class="text-foreground font-medium tabular-nums">{{ total.toLocaleString('ko-KR') }}</span>건 · 발주
      <span class="text-foreground font-medium tabular-nums">{{ poTotal.toLocaleString('ko-KR') }}</span>건
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
