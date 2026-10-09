<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BOM_MD_PO_STATUS_LABELS,
  BOM_REMITTANCE_STATUS_LABELS,
  type AdminBomPoViewType,
  type BomMdPoStatusType,
  type BomRemittanceStatusType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { partnerAmountText } from '@/admin/bom-partner-money';
import { smartbomFmtWon } from '@/admin/smartbom';
import { partnerPortalActAsUrl } from '@/admin/useAdminPartners';
import { useBomRemittanceEditor } from '@/admin/useBomRemittanceEditor';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';

// 발주서 한 줄 아래에 붙는 덧줄 — 옛 components/admin/smartbom/BomPoExtrasRow.vue 의 짝(같은 props).
// 송금 기록(D48)과 마스터딜러의 하위 발주(D47). 사람 협력사 발주에만 뜬다.

const props = defineProps<{ po: AdminBomPoViewType; colspan: number }>();

const open = ref(false);
const poIdRef = computed(() => props.po.poId);
const editor = useBomRemittanceEditor(poIdRef, open);
const summary = computed(() => props.po.remittance);

type Variant = 'success' | 'warning' | 'info' | 'danger' | 'secondary';
const REMIT_VARIANT: Record<BomRemittanceStatusType, Variant> = {
  unpaid: 'secondary',
  partial: 'warning',
  paid: 'success',
  over: 'danger',
};
const CHILD_VARIANT: Record<BomMdPoStatusType, Variant> = {
  issued: 'info',
  confirmed: 'warning',
  shipped: 'warning',
  received: 'success',
};
</script>

<template>
  <TableRow v-if="summary !== null || po.childPos.length > 0" data-testid="bom-po-extras" :data-po-id="po.poId">
    <TableCell :colspan="colspan" class="whitespace-normal">
      <!-- 송금 — 얼마를 발주했고 실제로 얼마가 나갔는가 -->
      <div v-if="summary !== null" class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <b class="text-foreground">└ 송금</b>
        <Badge :variant="REMIT_VARIANT[summary.status]">{{ BOM_REMITTANCE_STATUS_LABELS[summary.status] }}</Badge>
        <span class="tabular-nums">
          지급 {{ partnerAmountText(summary.paidAmount, summary.currency) }} /
          {{ partnerAmountText(summary.poAmount, summary.currency) }}
          · 잔액 {{ partnerAmountText(summary.balance, summary.currency) }}
        </span>
        <span
          v-if="summary.fxDiffKrw !== null && summary.fxDiffKrw !== 0"
          class="tabular-nums"
          :class="summary.fxDiffKrw > 0 ? 'text-destructive' : 'text-success'"
          title="실제 송금 환율과 발주서 장부 환율의 차이(원). 양수 = 장부보다 더 나갔습니다."
        >
          환차 {{ summary.fxDiffKrw > 0 ? '+' : '' }}{{ smartbomFmtWon(summary.fxDiffKrw) }}
        </span>
        <Button variant="outline" size="xs" @click="open = !open">
          {{ open ? '송금 기록 접기' : '송금 기록' }}
        </Button>
      </div>

      <div v-if="open && summary !== null" class="bg-card mt-2 rounded-lg border p-3" data-testid="bom-remittance-editor">
        <p v-if="editor.loading.value" class="text-muted-foreground text-xs">불러오는 중…</p>
        <template v-else-if="editor.data.value !== null">
          <Table v-if="editor.data.value.items.length > 0">
            <TableHeader>
              <TableRow>
                <TableHead>송금일</TableHead>
                <TableHead class="text-right">금액</TableHead>
                <TableHead class="text-right">실제 환율</TableHead>
                <TableHead class="text-right">원화</TableHead>
                <TableHead class="text-right">환차</TableHead>
                <TableHead>메모</TableHead>
                <TableHead>기록자</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="row in editor.data.value.items" :key="row.id">
                <TableCell>{{ fmtKstDate(row.remittedOn) }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ partnerAmountText(row.amount, row.currency) }}</TableCell>
                <TableCell class="text-right tabular-nums">
                  {{ row.exchangeRate === null ? '—' : row.exchangeRate.toLocaleString('ko-KR') }}
                </TableCell>
                <TableCell class="text-right tabular-nums">{{ row.krwAmount === null ? '—' : smartbomFmtWon(row.krwAmount) }}</TableCell>
                <TableCell class="text-right tabular-nums">{{ row.fxDiffKrw === null ? '—' : smartbomFmtWon(row.fxDiffKrw) }}</TableCell>
                <TableCell class="max-w-40 truncate" :title="row.memo ?? ''">{{ row.memo ?? '' }}</TableCell>
                <TableCell class="text-muted-foreground">{{ row.createdBy }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    variant="ghost"
                    size="xs"
                    :disabled="editor.busy.value"
                    title="잘못 적은 기록은 지우고 다시 적습니다"
                    @click="void editor.remove(row.id)"
                  >
                    삭제
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p v-else class="text-muted-foreground text-xs">아직 송금 기록이 없습니다.</p>

          <div class="mt-2 flex flex-wrap items-end gap-2 text-xs">
            <label class="text-muted-foreground">
              송금일
              <Input v-model="editor.draft.value.remittedOn" type="date" class="mt-0.5 h-8 w-36" />
            </label>
            <label class="text-muted-foreground">
              금액({{ editor.data.value.summary.currency }})
              <Input
                v-model="editor.draft.value.amount"
                type="number"
                min="0"
                step="any"
                class="mt-0.5 h-8 w-28 text-right tabular-nums"
                aria-label="송금 금액"
              />
            </label>
            <label v-if="editor.foreign.value" class="text-muted-foreground">
              실제 환율
              <Input
                v-model="editor.draft.value.exchangeRate"
                type="number"
                min="0"
                step="any"
                class="mt-0.5 h-8 w-28 text-right tabular-nums"
                :placeholder="editor.data.value.bookedRate === null ? '고시 환율' : `장부 ${editor.data.value.bookedRate.toLocaleString('ko-KR')}`"
                aria-label="실제 적용 환율"
                title="비워 두면 오늘 고시 환율로 적습니다"
              />
            </label>
            <label class="text-muted-foreground min-w-40 flex-1">
              메모
              <Input v-model="editor.draft.value.memo" type="text" maxlength="500" class="mt-0.5 h-8" />
            </label>
            <Button variant="outline" size="sm" @click="editor.fillBalance()">잔액 채우기</Button>
            <Button size="sm" :disabled="editor.busy.value" @click="void editor.submit()">송금 기록 추가</Button>
          </div>
          <Alert v-if="editor.error.value !== ''" variant="destructive" size="sm" class="mt-2">
            <AlertDescription>{{ editor.error.value }}</AlertDescription>
          </Alert>
        </template>
      </div>

      <!-- 마스터딜러의 하위 발주 — 관리자는 전부 본다. 대신 처리하려면 그 조직으로 대리 접속한다 -->
      <div
        v-if="po.childPos.length > 0"
        class="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        data-testid="bom-po-children"
      >
        <b class="text-foreground">└ 하위 발주 {{ po.childPos.length }}건</b>
        <span v-for="child in po.childPos" :key="child.mdPoId" class="inline-flex items-center gap-1 whitespace-nowrap">
          {{ child.partnerName }}
          <Badge :variant="CHILD_VARIANT[child.status]">{{ BOM_MD_PO_STATUS_LABELS[child.status] }}</Badge>
          {{ partnerAmountText(child.totalAmount, child.currency) }} · {{ child.items.length }}품목
          <template v-if="child.trackingNo !== null"> · {{ child.carrier ?? '' }} {{ child.trackingNo }}</template>
        </span>
        <a
          :href="partnerPortalActAsUrl(po.partnerId)"
          target="_blank"
          rel="noopener"
          class="text-primary ml-auto font-semibold underline"
          title="이 마스터딜러의 포털을 새 탭으로 엽니다 — 하위 발주·확인·수령을 대신 처리할 수 있습니다"
        >
          마스터딜러 포털로 대리 접속
        </a>
      </div>
    </TableCell>
  </TableRow>
</template>
