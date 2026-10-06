<script setup lang="ts">
import { ref } from 'vue';
import type { BomSupplierSearchOperationsType } from '@sp/api-contract';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { Badge } from '@/next/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { catalogStatusLabel, formatDuration, formatRunDate, runStatusBadge } from './bom-quote-settings';

type Run = BomSupplierSearchOperationsType['recentRuns'][number];

// 최근 검색 실행 — 옛 화면의 접힌 <details> 표. 기본 접힘(조회용) 섹션으로 둔다. 칸 구성·문구는 옛 표와 같다:
// 시각/견적 · 대상 행 · 예상→실제 호출 · 한도/캐시 · 소요(엔진·반영·화면·카탈로그·DB·ES) · 결과(+카탈로그 동기화).
const props = defineProps<{ runs: BomSupplierSearchOperationsType['recentRuns'] }>();
const open = ref(false);

/** 카탈로그 동기화 글자색 — 실패 빨강·ES 재시도 주황·동기화 중 파랑·그 밖 흐림(옛 화면과 같은 뜻). */
const catalogTone = (run: Run): string =>
  run.catalogStatus === 'failed'
    ? 'text-destructive'
    : (run.catalogQueued ?? 0) > 0
      ? 'text-warning'
      : run.catalogStatus === 'running'
        ? 'text-info'
        : 'text-muted-foreground';

/** 카탈로그 동기화 한 줄 — 상태 · 재사용 · ES 재시도 N(옛 표와 같은 문구). */
const catalogNote = (run: Run): string =>
  [
    catalogStatusLabel(run.catalogStatus),
    run.catalogReused === true ? '재사용' : null,
    (run.catalogQueued ?? 0) > 0 ? `ES 재시도 ${String(run.catalogQueued)}` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
</script>

<template>
  <SectionCard v-model:open="open" :title="`최근 검색 실행 ${props.runs.length}건`" collapsible flush>
    <TableCard bare>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>시각/견적</TableHead>
            <TableHead class="text-right">대상</TableHead>
            <TableHead>예상→실제</TableHead>
            <TableHead>한도/캐시</TableHead>
            <TableHead>소요</TableHead>
            <TableHead>결과</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="run in props.runs" :key="run.id">
            <TableCell>
              <p class="font-medium">#{{ run.quoteId }} {{ run.quoteTitle }}</p>
              <p class="text-muted-foreground text-xs tabular-nums">{{ formatRunDate(run.createdAt) }} · {{ run.memberId }}</p>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ run.componentCount ?? '—' }}행</TableCell>
            <TableCell class="tabular-nums">
              {{ run.estimatedApiCalls ?? '—' }} → <strong>{{ run.actualApiCalls ?? '—' }}</strong>
            </TableCell>
            <TableCell class="tabular-nums">{{ run.maxCalls ?? '—' }}회 / 캐시 {{ run.cacheHits ?? '—' }}</TableCell>
            <TableCell class="tabular-nums">
              <p>엔진 {{ formatDuration(run.engineElapsedMs ?? run.elapsedMs) }} · 반영 {{ formatDuration(run.quoteApplyMs) }}</p>
              <p class="text-muted-foreground text-xs">
                화면 완료 {{ formatDuration(run.wallElapsedMs) }} · 카탈로그 {{ formatDuration(run.catalogElapsedMs) }}
              </p>
              <p v-if="run.catalogDbElapsedMs !== null || run.catalogIndexElapsedMs !== null" class="text-muted-foreground text-xs">
                DB {{ formatDuration(run.catalogDbElapsedMs) }} · ES {{ formatDuration(run.catalogIndexElapsedMs) }}
              </p>
            </TableCell>
            <TableCell>
              <Badge :variant="runStatusBadge(run.status).variant">{{ runStatusBadge(run.status).label }}</Badge>
              <p class="mt-0.5 text-xs" :class="catalogTone(run)">{{ catalogNote(run) }}</p>
              <p v-if="run.budgetExhaustedCount" class="text-warning text-xs">한도 소진 {{ run.budgetExhaustedCount }}행</p>
              <p v-if="run.error" class="text-destructive max-w-48 truncate text-xs" :title="run.error">{{ run.error }}</p>
            </TableCell>
          </TableRow>
          <TableEmptyRow v-if="props.runs.length === 0" :colspan="6" text="검색 실행 이력이 없습니다." />
        </TableBody>
      </Table>
    </TableCard>
  </SectionCard>
</template>
