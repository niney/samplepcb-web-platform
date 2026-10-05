<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, LinkIcon, SendIcon } from '@lucide/vue';
import { pcbMoneyWithSub, pcbKrwSuffix } from '@/lib/pcb-money';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { rfqStatusBadge } from './case-badges';
import { dateOnly, rateNote } from './case-core';
import { usePcbCaseContext } from './usePcbCase';

// 협력사 견적요청(RFQ) 패널 — 배정 diff·대리 회신·선정/해제·매직링크. 무관 파트 진입이면 한 줄 접힘.
const {
  detail,
  collapsed,
  expandSection,
  rfqSectionEl,
  poSelectionGuide,
  adminRows,
  childrenOf,
  inLatestRound,
  olderRoundCount,
  roundsExpanded,
  rfqGate,
  rfqGateNote,
  openAssign,
  editableRow,
  deliverySignal,
  openSelect,
  submitUnselect,
  copyMagicLink,
  reissueMagicLink,
  copiedRfqId,
  replyTarget,
} = usePcbCaseContext();

// guidePoSelection 이 이 섹션으로 스크롤·포커스한다 — 실제 DOM 요소를 컨텍스트에 꽂아 둔다
// (SectionCard 인스턴스면 그 루트 요소).
const bindSection = (el: Element | ComponentPublicInstance | null): void => {
  const node: unknown = el !== null && !(el instanceof Element) ? el.$el : el;
  rfqSectionEl.value = node instanceof HTMLElement ? node : null;
};
</script>

<template>
  <!-- 접힘은 진입 맥락(?from=)이 정한다 — 접힌 때만 펼치기 줄을 보이고, 펼친 뒤 다시 접는 동작은 없다(옛 화면 동일). -->
  <SectionCard
    :ref="bindSection"
    title="협력사 견적요청"
    flush
    :collapsible="detail !== null && collapsed.has('rfq')"
    :open="!(detail !== null && collapsed.has('rfq'))"
    tabindex="-1"
    class="scroll-mt-4 focus:outline-none"
    @update:open="expandSection('rfq')"
  >
    <template #collapsed>협력사 견적요청 ({{ adminRows.length }}곳)</template>
    <template #meta>{{ adminRows.length }}곳</template>
    <template #actions>
      <Button
        data-pcb-rfq-assign
        size="sm"
        :disabled="rfqGate !== 'ok'"
        :title="rfqGateNote"
        @click="openAssign"
      >
        <SendIcon />
        협력사 견적요청 {{ adminRows.length > 0 ? '변경' : '보내기' }}
      </Button>
    </template>
    <template #notice>
      <NoticeBand v-if="poSelectionGuide !== ''" role="alert" tone="warning" class="font-medium">
        {{ poSelectionGuide }}
      </NoticeBand>
      <NoticeBand v-if="rfqGate !== 'ok'" tone="warning" class="text-xs font-medium">{{ rfqGateNote }}</NoticeBand>
    </template>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>협력사</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>회신 견적가</TableHead>
          <TableHead>납기(제시 → 회신)</TableHead>
          <TableHead>메모</TableHead>
          <TableHead>회신일</TableHead>
          <TableHead class="text-right">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="row in adminRows.filter(inLatestRound)" :key="row.rfqId">
          <TableRow :data-state="row.status === 'selected' ? 'selected' : undefined">
            <TableCell>
              <p class="flex items-center gap-1.5 font-medium">
                {{ row.partnerName }}
                <Badge v-if="row.reorderRound > 0" variant="danger">{{ row.reorderRound }}차</Badge>
              </p>
              <p v-if="row.childCount > 0" class="text-info text-xs">
                MD 경유 · 하위 {{ row.childQuotedCount }}/{{ row.childCount }} 회신
                <span v-if="row.marginRate !== null"> · 마진 {{ row.marginRate }}%</span>
              </p>
            </TableCell>
            <TableCell>
              <Badge :variant="rfqStatusBadge(row.status).variant">{{ rfqStatusBadge(row.status).label }}</Badge>
            </TableCell>
            <TableCell class="tabular-nums">
              {{ pcbMoneyWithSub(row.currency, row.priceOriginal, row.subCurrency, row.subPriceOriginal) }}
              <span class="text-muted-foreground text-xs">
                {{ pcbKrwSuffix(row.currency, row.krwAmount) }}{{ rateNote(row.currency, row.krwAmount, row.exchangeRate, '선정 시점') }}
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground">
              <span class="inline-flex items-center gap-1.5">
                {{ dateOnly(row.suggestedDeliveryDate) }} → {{ dateOnly(row.quotedDeliveryDate) }}
                <Badge v-if="deliverySignal(row) !== null" :variant="deliverySignal(row)?.variant ?? 'secondary'">
                  {{ deliverySignal(row)?.label }}
                </Badge>
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground max-w-64 truncate text-xs" :title="row.memo ?? ''">
              {{ row.memo ?? '—' }}
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ dateOnly(row.respondedAt) }}</TableCell>
            <TableCell class="text-right">
              <span class="inline-flex flex-wrap justify-end gap-1">
                <Button v-if="editableRow(row)" data-pcb-rfq-reply variant="outline" size="sm" @click="replyTarget = row">
                  대리 회신
                </Button>
                <Button v-if="row.status === 'quoted'" data-pcb-rfq-select size="sm" @click="openSelect(row)">선정</Button>
                <Button v-if="row.status === 'selected'" variant="outline" size="sm" @click="void submitUnselect(row)">
                  선정 해제
                </Button>
                <Button
                  v-if="row.magicToken !== null"
                  variant="ghost"
                  size="sm"
                  title="무로그인 회신 링크 복사"
                  @click="void copyMagicLink(row)"
                >
                  <CopyIcon />
                  {{ copiedRfqId === row.rfqId ? '복사됨!' : '링크 복사' }}
                </Button>
                <Button variant="ghost" size="sm" title="매직링크 재발급(기존 링크 무효화)" @click="void reissueMagicLink(row)">
                  <LinkIcon />
                  재발급
                </Button>
              </span>
            </TableCell>
          </TableRow>
          <!-- MD 하위 트랙(읽기전용 — 조작은 MD 포털 몫) -->
          <TableRow v-if="childrenOf(row.partnerId).length > 0">
            <TableCell :colspan="7" class="bg-muted/40">
              <div class="pl-6">
                <p class="text-info text-xs font-medium">하위 협력사 회신(MD {{ row.partnerName }} 경유)</p>
                <div class="mt-1 grid gap-1">
                  <div
                    v-for="child in childrenOf(row.partnerId)"
                    :key="child.rfqId"
                    class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs"
                  >
                    <Badge :variant="rfqStatusBadge(child.status).variant">{{ rfqStatusBadge(child.status).label }}</Badge>
                    <span class="text-foreground font-medium">{{ child.partnerName }}</span>
                    <span class="tabular-nums">
                      {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                    </span>
                    <span>납기 {{ dateOnly(child.quotedDeliveryDate) }}</span>
                  </div>
                </div>
              </div>
            </TableCell>
          </TableRow>
        </template>
        <TableEmptyRow
          v-if="adminRows.length === 0"
          :colspan="7"
          text="아직 배정된 협력사가 없습니다 — [협력사 견적요청 보내기]로 시작하세요."
        />
        <!-- 이전 회차(A/S 재발주) — 지나간 흔적은 지우지 않고 접어 둔다. 카운트는 발주·견적 합산이라
               라벨에 축을 명시한다(발주서 섹션에도 같은 토글). -->
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
  </SectionCard>
</template>
