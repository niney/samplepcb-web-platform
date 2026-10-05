<script setup lang="ts">
import { CheckIcon, DownloadIcon, TruckIcon, Undo2Icon, XIcon } from '@lucide/vue';
import {
  PCB_PO_STATUS_LABELS,
  pcbEqForwardLabel,
  pcbEqRejectActionLabel,
  pcbEqRevertLabel,
  type AdminPcbPoViewType,
} from '@sp/api-contract';
import { downloadAdminPcbEqFile } from '@/admin/useAdminPcbPos';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '@/lib/pcb-shipment-label';
import { pcbMoneyWithSub } from '@/lib/pcb-money';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { TableCell, TableRow } from '@/next/components/ui/table';
import { pcbPoStatusVariant as poStatusVariant, pcbShipmentStatusVariant as shipStatusVariant } from '@/next/components/pcb/pcb-badges';
import { usePcbCaseContext } from './usePcbCase';

// MD 하위 발주(EQ 실작업 문서) 요약 줄 — 한 줄 요약이라 첨부는 **최신만**. 여기서도 승인/반려를 누를 수 있다
// (여정 22호). 라벨은 본행과 같은 계약 사전 — 같은 표의 부모·자식 행이 다른 말을 하면 안 된다.
defineProps<{ po: AdminPcbPoViewType }>();

const { specId, childPosOf, shipRowsOf, approvePo, rejectPoId, revertPo } = usePcbCaseContext();

const download = (poId: number, fileId: number, name: string): void => {
  if (specId.value === null) return;
  void downloadAdminPcbEqFile(specId.value, poId, fileId, name);
};
</script>

<template>
  <TableRow>
    <TableCell :colspan="7" class="bg-muted/40">
      <div class="pl-6">
        <p class="text-info text-xs font-medium">하위 발주(MD {{ po.partnerName }} 경유 — 승인/반려는 여기서)</p>
        <div class="mt-1 grid gap-1">
          <div v-for="child in childPosOf(po)" :key="child.poId" class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            <Badge :variant="poStatusVariant(child.status)">{{ PCB_PO_STATUS_LABELS[child.track][child.status] }}</Badge>
            <span class="text-foreground font-medium">{{ child.partnerName }}</span>
            <span class="tabular-nums">{{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}</span>
            <template v-for="cs in shipRowsOf(child.poId)" :key="`cship-${String(cs.shipmentId)}`">
              <Badge :variant="shipStatusVariant(cs.status)">
                <TruckIcon />
                {{ pcbShipmentStatusLabel(cs.mode, cs.status, { directShip: isPcbDirectShipIntl(cs.destinationCountry) }) }}
              </Badge>
              <span v-if="cs.receivedAt !== null" class="text-success font-medium">MD 입고완료</span>
            </template>
            <Button
              v-for="f in child.eqFiles.filter((x) => x.isLatest)"
              :key="f.fileId"
              variant="outline"
              size="xs"
              :title="`${f.fileType.toUpperCase()} · ${f.name} (최신)`"
              @click="download(child.poId, f.fileId, f.name)"
            >
              <DownloadIcon />
              {{ f.fileType }}
            </Button>
            <template v-if="child.status === 'eq_requested'">
              <Button size="xs" @click="void approvePo(child)">
                <CheckIcon />
                {{ pcbEqForwardLabel('eq_requested', child.track) }}
              </Button>
              <Button variant="outline" size="xs" @click="rejectPoId = child.poId">
                <XIcon class="text-destructive" />
                {{ pcbEqRejectActionLabel(child.track) }}
              </Button>
            </template>
            <Button v-else-if="child.status === 'eq_done'" variant="ghost" size="xs" @click="void revertPo(child)">
              <Undo2Icon />
              {{ pcbEqRevertLabel('eq_done', child.track) }}
            </Button>
          </div>
        </div>
      </div>
    </TableCell>
  </TableRow>
</template>
