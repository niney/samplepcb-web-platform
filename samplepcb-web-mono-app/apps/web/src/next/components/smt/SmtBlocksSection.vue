<script setup lang="ts">
import { Badge } from '@/next/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { smtBlockCountedBadge, smtBlockReasonLabel } from './smt-badges';
import type { SmtBlock, SmtKnown } from './smt-envelope';
import { smtAmount } from './smt-format';

// 통합 합계 블록(quote.integrated.blocks) — SMT 작업비 밖에서 최종 금액에 더해지는 덩어리(PCB · 부품 · 배송).
// 블록마다 "합계에 드는가"는 사유(reason)가 정한다(계약 SMARTSMT_BLOCK_REASONS): 사유가 없으면 든다.
// 요청 상태 · 금액 성격 · 완전성은 아직 사전이 없어 코드 그대로 보인다(docs §6-2 — SmartSMT 에 값 목록을 물었다).
defineProps<{
  blocks: readonly SmtBlock[];
  known: SmtKnown | null;
  currency: string | null;
}>();

const includedText = (included: boolean | null): string =>
  included === null ? '—' : included ? '산다' : '사지 않음';
</script>

<template>
  <SectionCard title="통합 합계 블록" flush>
    <template #meta>
      <span v-if="known !== null && known.sum !== null">
        참고: 금액이 확인된 블록의 합 {{ smtAmount(known.sum, currency) }}<template v-if="known.blocks.length > 0">
          ({{ known.blocks.join(', ') }})</template>
        — 합계가 아닙니다
      </span>
    </template>
    <Table data-testid="smt-blocks">
      <TableHeader>
        <TableRow>
          <TableHead>블록</TableHead>
          <TableHead>출처</TableHead>
          <TableHead>출처 견적 번호</TableHead>
          <TableHead>이 주문에서</TableHead>
          <TableHead class="text-right">금액</TableHead>
          <TableHead>요청 상태</TableHead>
          <TableHead>금액 성격</TableHead>
          <TableHead>완전성</TableHead>
          <TableHead>사유</TableHead>
          <TableHead>합계에 드는가</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="(block, index) in blocks" :key="`${block.block}-${String(index)}`">
          <TableCell class="font-mono text-xs font-medium">{{ block.block }}</TableCell>
          <TableCell class="font-mono text-xs">{{ block.source ?? '—' }}</TableCell>
          <TableCell class="font-mono text-xs">{{ block.quoteRef ?? '—' }}</TableCell>
          <TableCell>{{ includedText(block.included) }}</TableCell>
          <TableCell class="text-right font-medium tabular-nums" :class="block.amount === null ? 'text-warning' : ''">
            {{ smtAmount(block.amount, block.amountCurrency ?? currency) }}
          </TableCell>
          <TableCell class="text-muted-foreground font-mono text-xs">{{ block.requestStatus ?? '—' }}</TableCell>
          <TableCell class="text-muted-foreground font-mono text-xs">{{ block.valuation ?? '—' }}</TableCell>
          <TableCell class="text-muted-foreground font-mono text-xs">{{ block.completeness ?? '—' }}</TableCell>
          <TableCell>
            <span class="block max-w-56 truncate" :title="block.reason ?? ''">{{ smtBlockReasonLabel(block.reason) }}</span>
            <!-- 사전에 있는 사유는 코드도 작게 남긴다(원문과 맞춰 볼 때). 모르는 사유는 위 줄이 이미 코드다. -->
            <span
              v-if="block.reason !== null && smtBlockReasonLabel(block.reason) !== block.reason"
              class="text-muted-foreground font-mono text-xs"
            >{{ block.reason }}</span>
          </TableCell>
          <TableCell>
            <Badge :variant="smtBlockCountedBadge(block.reason).variant">{{ smtBlockCountedBadge(block.reason).label }}</Badge>
          </TableCell>
        </TableRow>
        <TableEmptyRow v-if="blocks.length === 0" :colspan="10" text="통합 합계 블록이 없습니다." />
      </TableBody>
    </Table>
  </SectionCard>
</template>
