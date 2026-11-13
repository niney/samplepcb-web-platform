<script setup lang="ts">
import { Badge } from '@/next/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { smtLineStatusBadge } from './smt-badges';
import type { SmtCost, SmtLine, SmtSubtotal } from './smt-envelope';
import { smtAmount, smtCount } from './smt-format';

// 견적 줄(quote.lines) — SmartSMT 가 SMT 작업비를 계산한 줄들. 아래에 묶음별 소계와 금액 구성(직접비 → 합계).
// 여기의 합계는 **SMT 작업비만**이다(PCB·부품·배송 제외) — 최종 금액은 화면 위 '금액'의 통합 합계.
// 견적서 글자(항목·식)는 글자로만 넣는다(v-html 없음). 긴 글자는 말줄임 + title.
defineProps<{
  lines: readonly SmtLine[];
  subtotals: readonly SmtSubtotal[];
  costs: readonly SmtCost[];
  currency: string | null;
}>();
</script>

<template>
  <SectionCard title="견적 줄" flush>
    <template #meta>{{ lines.length }}줄 · 금액은 SMT 작업비</template>
    <Table data-testid="smt-lines">
      <TableHeader>
        <TableRow>
          <TableHead>코드</TableHead>
          <TableHead>항목</TableHead>
          <TableHead>묶음</TableHead>
          <TableHead>기준</TableHead>
          <TableHead>식</TableHead>
          <TableHead class="text-right">개수</TableHead>
          <TableHead class="text-right">단가</TableHead>
          <TableHead class="text-right">금액</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="(line, index) in lines" :key="`${line.code}-${String(index)}`">
          <TableCell class="font-mono text-xs">{{ line.code }}</TableCell>
          <TableCell>
            <span class="block max-w-xs truncate font-medium" :title="line.item">{{ line.item }}</span>
          </TableCell>
          <TableCell class="text-muted-foreground font-mono text-xs">{{ line.group }}</TableCell>
          <TableCell class="text-muted-foreground">{{ line.basis }}</TableCell>
          <TableCell class="text-muted-foreground">
            <span class="block max-w-xs truncate" :title="line.formula">{{ line.formula }}</span>
          </TableCell>
          <TableCell class="text-right tabular-nums">
            {{ smtCount(line.count) }}<span v-if="line.countUnit !== ''" class="text-muted-foreground ml-1 text-xs">{{ line.countUnit }}</span>
          </TableCell>
          <TableCell class="text-right tabular-nums">{{ smtAmount(line.unitPrice, currency) }}</TableCell>
          <TableCell class="text-right font-medium tabular-nums">{{ smtAmount(line.amount, currency) }}</TableCell>
          <TableCell>
            <Badge v-if="line.status !== null" :variant="smtLineStatusBadge(line.status).variant">
              {{ smtLineStatusBadge(line.status).label }}
            </Badge>
            <span v-else class="text-muted-foreground">—</span>
          </TableCell>
        </TableRow>
        <TableEmptyRow v-if="lines.length === 0" :colspan="9" text="견적 줄이 없습니다." />
      </TableBody>
    </Table>

    <div class="grid gap-x-8 gap-y-4 border-t px-4 py-3 md:grid-cols-2">
      <div class="flex flex-col gap-1.5">
        <h3 class="text-muted-foreground text-xs font-medium">묶음별 소계</h3>
        <dl v-if="subtotals.length > 0" class="flex flex-col gap-1 text-sm">
          <div v-for="(subtotal, index) in subtotals" :key="`${subtotal.label}-${String(index)}`" class="flex justify-between gap-4">
            <dt class="text-muted-foreground min-w-0 truncate" :title="subtotal.label">{{ subtotal.label }}</dt>
            <dd class="tabular-nums">{{ smtAmount(subtotal.amount, currency) }}</dd>
          </div>
        </dl>
        <p v-else class="text-muted-foreground text-sm">소계가 없습니다.</p>
      </div>
      <div class="flex flex-col gap-1.5">
        <h3 class="text-muted-foreground text-xs font-medium">금액 구성</h3>
        <dl class="flex flex-col gap-1 text-sm" data-testid="smt-costs">
          <div
            v-for="cost in costs"
            :key="cost.key"
            class="flex justify-between gap-4"
            :class="cost.key === 'total' ? 'border-t pt-1 font-semibold' : ''"
          >
            <dt :class="cost.key === 'total' ? '' : 'text-muted-foreground'" :title="cost.key">{{ cost.label }}</dt>
            <dd class="tabular-nums">{{ smtAmount(cost.amount, currency) }}</dd>
          </div>
        </dl>
      </div>
    </div>
  </SectionCard>
</template>
