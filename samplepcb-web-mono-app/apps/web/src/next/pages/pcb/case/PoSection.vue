<script setup lang="ts">
import { ChevronDownIcon, ChevronRightIcon, FilePlusIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import PoRowGroup from './PoRowGroup.vue';
import { usePcbCaseContext } from './usePcbCase';

// 발주서 · EQ(스텐실: 고객문의사항) 패널 — 결제(paid) 후 발행, EQ 승인/반려(스텐실: 확인/보완)는 관리자 몫.
const {
  detail,
  collapsed,
  expandSection,
  isStencilCase,
  adminPos,
  inLatestRound,
  olderRoundCount,
  olderRoundsCollapsed,
  latestPoCount,
  roundsExpanded,
  rfqsQuery,
  selectedPoRfq,
  rfqGate,
  openPoModal,
} = usePcbCaseContext();
</script>

<template>
  <button
    v-if="detail !== null && collapsed.has('po')"
    type="button"
    class="bg-card text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm"
    @click="expandSection('po')"
  >
    <ChevronRightIcon class="size-4" />
    <span>발주서 · {{ isStencilCase ? '고객문의사항' : 'EQ' }} ({{ adminPos.length }}건)</span>
    <span class="ml-auto text-xs">펼치기</span>
  </button>
  <TableCard v-else>
    <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <h2 class="text-sm font-semibold">
        발주서 · {{ isStencilCase ? '고객문의사항' : 'EQ' }}
        <span class="text-muted-foreground ml-1 text-xs font-normal">
          {{ adminPos.length }}건<template v-if="olderRoundsCollapsed"> (현재 회차 {{ latestPoCount }}건 · 이전 회차 접힘)</template>
        </span>
      </h2>
      <!-- 선정이 없으면 버튼이 안내로 바뀐다(누르면 RFQ 패널의 선정 자리로 데려간다). -->
      <Button
        size="sm"
        :variant="selectedPoRfq === null ? 'outline' : 'default'"
        :disabled="rfqGate === 'closed' || rfqsQuery.isPending.value"
        :title="rfqGate === 'closed'
          ? '완료·취소된 PCB 주문에는 발주서를 발행할 수 없습니다.'
          : rfqsQuery.isPending.value
            ? '협력사 선정 상태를 확인하는 중입니다.'
            : selectedPoRfq === null
              ? '발주 전에 협력사 선정이 필요합니다.'
              : '선정된 협력사로 발주서를 발행합니다.'"
        @click="void openPoModal()"
      >
        <span v-if="selectedPoRfq === null && !rfqsQuery.isPending.value" class="bg-warning size-2 rounded-full" />
        <FilePlusIcon v-else />
        {{ rfqsQuery.isPending.value ? '협력사 확인 중' : selectedPoRfq === null ? '협력사 선정 필요' : '발주서 발행' }}
      </Button>
    </div>
    <p v-if="isStencilCase" class="text-muted-foreground border-b px-4 py-2 text-xs">
      발행은 고객 결제(입금 확인) 후에만 가능합니다. 메탈마스크는 EQ 왕복이 없습니다 — 발주접수(협력사가
      <b class="text-foreground">좌표파일(필수)</b>과 고객문의사항·사진(선택) 등록) → 확인 요청 →
      <b class="text-foreground">확인(관리자)</b> → 생산시작 → 생산완료. 확인이 끝나면
      <b class="text-foreground">좌표파일을 고객도 주문내역에서 내려받을 수 있습니다</b>(별도 통보는 없습니다).
    </p>
    <p v-else class="text-muted-foreground border-b px-4 py-2 text-xs">
      발행은 고객 결제(입금 확인) 후에만 가능합니다. 진행: 발주접수(EQ 선택·Working 업로드 권장) → EQ 승인요청 →
      (필요하면 <b class="text-foreground">고객 확인</b>) → <b class="text-foreground">EQ 승인(관리자)</b> → 생산시작 → 생산완료.
    </p>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>협력사</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>발주가</TableHead>
          <TableHead>조건/송금</TableHead>
          <TableHead>납기</TableHead>
          <TableHead>{{ isStencilCase ? '문의·첨부' : 'EQ 첨부' }}</TableHead>
          <TableHead class="text-right">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <PoRowGroup v-for="po in adminPos.filter(inLatestRound)" :key="po.poId" :po="po" />
        <TableEmptyRow
          v-if="adminPos.length === 0"
          :colspan="7"
          text="발주서가 없습니다 — 선정 후 결제가 확인되면 [발주서 발행]으로 시작하세요."
        />
        <!-- 이전 회차 토글 — RFQ 섹션과 같은 상태를 접고 편다. RFQ 표 하단에만 있으면 발주 쪽 접힘의
             출구가 안 보인다(재점검 08-10). -->
        <TableRow v-if="olderRoundCount > 0">
          <TableCell :colspan="7">
            <Button variant="ghost" size="xs" @click="roundsExpanded = !roundsExpanded">
              <ChevronDownIcon v-if="roundsExpanded" />
              <ChevronRightIcon v-else />
              {{ roundsExpanded ? '이전 회차 접기' : `이전 회차 발주·견적 ${String(olderRoundCount)}건 보기` }}
            </Button>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </TableCard>
</template>
