<script setup lang="ts">
import {
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  Trash2Icon,
  TruckIcon,
  Undo2Icon,
  UploadIcon,
} from '@lucide/vue';
import {
  PCB_SHIPMENT_FILE_LABELS,
  SHIPMENT_TRANSPORT_LABELS,
  type AdminPcbPoViewType,
  type AdminPcbShipmentViewType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { downloadAdminPcbShipmentFile } from '@/admin/useAdminPcbPos';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '@/lib/pcb-shipment-label';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { TableCell, TableRow } from '@/next/components/ui/table';
import { pcbShipmentStatusVariant as shipStatusVariant } from '@/next/components/pcb/pcb-badges';
import Panel from '@/next/components/common/Panel.vue';
import { dateOnly } from './case-core';
import { usePcbCaseContext } from './usePcbCase';

// 선적 줄 — 대표 발주 행 아래 1줄(묶음 포함). 관리자는 받는측 + 양측 만능 대행.
const props = defineProps<{ po: AdminPcbPoViewType; shipment: AdminPcbShipmentViewType }>();

const {
  specId,
  shipMatesOf,
  openMateCase,
  caseRefStrip,
  adminPickShipFile,
  shipDocTypeOf,
  shipDocLabelOf,
  adminShipAdvanceLabel,
  adminShipAdvance,
  openCaseRef,
  canAdminReceive,
  openReceive,
  invoicePoId,
  adminShipRevert,
  adminShipCancel,
  invoiceOf,
  adminInvoiceOf,
  awbOf,
  otherShipFilesOf,
} = usePcbCaseContext();

const download = (fileId: number, name: string): void => {
  if (specId.value === null) return;
  void downloadAdminPcbShipmentFile(specId.value, props.po.poId, fileId, name);
};
const caseRefWaiting = (s: AdminPcbShipmentViewType): boolean =>
  s.caseRefRequestedAt !== null && (s.caseRef === null || s.caseRef === '');
</script>

<template>
  <TableRow>
    <TableCell :colspan="7" class="bg-muted/40">
      <div class="flex flex-wrap items-center gap-2 pl-6 text-xs">
        <span class="text-info inline-flex items-center gap-1 font-semibold">
          <TruckIcon class="size-3.5" />
          선적
        </span>
        <Badge :variant="shipStatusVariant(shipment.status)">
          {{ pcbShipmentStatusLabel(shipment.mode, shipment.status, { directShip: isPcbDirectShipIntl(shipment.destinationCountry) }) }}
        </Badge>
        <span class="text-muted-foreground">
          {{ shipment.mode === 'domestic' ? '국내(택배)' : '국제' }} · {{ shipment.senderName }} → {{ shipment.receiverName }}
          <template v-if="shipment.destinationCountry !== null"> · 직송 {{ shipment.destinationCountry }}</template>
        </span>
        <!-- 운송수단 — 박제된 값이 있을 때만(null 은 이 축 도입 전 발송). 해상은 리드타임·서류가 달라
             상태만으로는 진행을 못 읽는다. -->
        <Badge v-if="shipment.transport !== null" variant="outline">{{ SHIPMENT_TRANSPORT_LABELS[shipment.transport] }}</Badge>
        <!-- 묶음은 Case(고객) 경계를 넘는다 — 구성원을 열거하고, 남의 Case 것은 고객까지 밝혀 그 Case 로 연다. -->
        <Badge v-if="shipment.poIds.length > 1" variant="info">묶음 {{ shipment.poIds.length }}건</Badge>
        <template v-for="m in (shipment.poIds.length > 1 ? shipMatesOf(shipment) : [])" :key="`mate-${String(m.poId)}`">
          <Badge v-if="m.mine" variant="secondary" title="이 Case 의 발주서">PO-{{ m.poId }} {{ m.projectName }} · 이 Case</Badge>
          <Button
            v-else
            variant="ghost"
            size="xs"
            :title="`다른 Case(고객 ${m.customerLabel})의 발주서 — 함께 움직입니다. 눌러서 그 Case 를 엽니다.`"
            @click="openMateCase(m.specId)"
          >
            PO-{{ m.poId }} {{ m.projectName }} · {{ m.customerLabel }}
            <ExternalLinkIcon />
          </Button>
        </template>
        <span v-if="shipment.shipDate !== null" class="text-muted-foreground">출고예정 {{ fmtKstDate(shipment.shipDate) }}</span>
        <span v-if="shipment.trackingNumber !== null" class="text-muted-foreground tabular-nums">
          {{ shipment.carrier ?? '' }} {{ shipment.trackingNumber }}
        </span>
        <!-- 발송 참조번호(Case ID) — 요청 대기면 협력사가 이 값에 막혀 있다(내 차례) -->
        <Badge
          v-if="caseRefWaiting(shipment)"
          variant="warning"
          :title="shipment.caseRefNote !== null && shipment.caseRefNote !== '' ? `요청 메모: ${shipment.caseRefNote}` : '협력사가 발송 참조번호를 기다리고 있습니다.'"
        >
          Case ID 요청
        </Badge>
        <span v-else-if="shipment.caseRef !== null && shipment.caseRef !== ''" class="text-info">
          Case ID <b class="tabular-nums">{{ shipment.caseRef }}</b>
        </span>
        <span v-if="shipment.receivedAt !== null" class="text-success font-medium">
          입고완료 {{ dateOnly(shipment.receivedAt) }}<template v-if="shipment.receivedNote !== null && shipment.receivedNote !== ''"> · {{ shipment.receivedNote }}</template>
        </span>
        <!-- 파일 칩 — Case ID 처리 스트립이 서 있는 동안엔 서류 조작이 전부 스트립으로 모이므로 숨긴다. -->
        <template v-if="!caseRefStrip(shipment)">
          <Button
            v-for="f in shipment.files"
            :key="f.fileId"
            variant="outline"
            size="xs"
            :title="`${f.name} · ${f.uploadedBy === 'ADMIN' ? '자사' : '협력사'} 업로드`"
            @click="download(f.fileId, f.name)"
          >
            <DownloadIcon />
            {{ PCB_SHIPMENT_FILE_LABELS[f.fileType] }}
          </Button>
        </template>
        <!-- 관리자 첨부 — Case ID 갈래는 아래 처리 스트립이 맡으므로 자기 계정 갈래(입고 전 국제)에서만. -->
        <template v-if="shipment.mode === 'international' && shipment.receivedAt === null && !caseRefStrip(shipment)">
          <Button
            variant="ghost"
            size="xs"
            title="수정한 인보이스(xlsx) 재첨부 — 기존 Invoice 를 교체합니다"
            @click="adminPickShipFile(po.poId, 'invoice')"
          >
            <UploadIcon />
            Invoice
          </Button>
          <Button variant="ghost" size="xs" :title="`${shipDocLabelOf(shipment)} 첨부`" @click="adminPickShipFile(po.poId, shipDocTypeOf(shipment))">
            <UploadIcon />
            {{ shipDocLabelOf(shipment) }}
          </Button>
        </template>
        <span class="grow" />
        <!-- 국내 종점('입고 완료')은 [입고 확인]이 함께 처리한다 — 전이 버튼을 따로 두면 눌러도 다음 일이
             안 열리는 상태가 만들어진다(서버도 RECEIVE_REQUIRED). -->
        <Button v-if="adminShipAdvanceLabel(shipment) !== null" size="sm" @click="void adminShipAdvance(po.poId, shipment)">
          {{ adminShipAdvanceLabel(shipment) }} 진행
        </Button>
        <!-- Case ID 입력 — 요청 대기면 강조(협력사가 이 값에 막혀 있다), 그 외엔 기록·정정 -->
        <Button
          v-if="shipment.receivedAt === null && shipment.receiverKind === 'admin'"
          :variant="caseRefWaiting(shipment) ? 'default' : 'outline'"
          size="sm"
          @click="void openCaseRef(po.poId, shipment.caseRef, shipment.caseRefNote)"
        >
          Case ID 입력
        </Button>
        <Button
          v-if="canAdminReceive(shipment)"
          size="sm"
          :title="shipment.mode === 'domestic' ? '실물 검수 후 누르면 입고 완료까지 함께 처리됩니다.' : undefined"
          @click="void openReceive(po.poId, shipment.mode === 'domestic', shipment.poIds.length)"
        >
          <PackageCheckIcon />
          입고 확인
        </Button>
        <Button v-if="shipment.mode === 'international'" variant="outline" size="sm" @click="invoicePoId = po.poId">
          <ReceiptTextIcon />
          송장
        </Button>
        <Button v-if="shipment.status !== 'preparing'" variant="ghost" size="sm" @click="void adminShipRevert(po.poId)">
          <Undo2Icon />
          되돌리기
        </Button>
        <!-- 선적 취소 — 발송 전·입고 전만. 견적 삭제의 SHIPMENT_EXISTS 를 푸는 출구. -->
        <Button
          v-if="shipment.status === 'preparing' && shipment.receivedAt === null"
          variant="ghost"
          size="sm"
          :title="shipment.poIds.length > 1 ? `묶음 ${shipment.poIds.length}건이 함께 취소됩니다` : '선적 문서를 삭제합니다'"
          @click="void adminShipCancel(po.poId, shipment)"
        >
          <Trash2Icon class="text-destructive" />
          선적 취소
        </Button>
      </div>
      <!-- Case ID 처리 순서 — 협력사 제출물(내려받아 수정)과 내 처리(재첨부→AWB→입력)를 한 줄 순서로.
           완료 판정은 파일 주인(uploadedBy)이 말한다. 실발송 전까지만 선다. -->
      <Panel
        v-if="caseRefStrip(shipment)"
        size="sm"
        tone="warning"
        class="mt-2 ml-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
      >
        <span class="text-warning font-semibold">Case ID 처리</span>
        <span class="flex items-center gap-1.5">
          ① 협력사 인보이스 수정
          <Button
            v-if="invoiceOf(shipment) !== null"
            variant="outline"
            size="xs"
            :title="invoiceOf(shipment)?.name"
            @click="download(invoiceOf(shipment)?.fileId ?? 0, invoiceOf(shipment)?.name ?? '')"
          >
            <DownloadIcon />
            내려받기
          </Button>
          <Button
            variant="outline"
            size="xs"
            title="수정한 인보이스(xlsx) 재첨부 — 기존 Invoice 를 교체합니다"
            @click="adminPickShipFile(po.poId, 'invoice')"
          >
            <UploadIcon />
            재첨부
          </Button>
          <span v-if="adminInvoiceOf(shipment) !== null" class="text-success inline-flex items-center gap-0.5 font-medium">
            <CheckIcon class="size-3.5" />
            수정본
          </span>
        </span>
        <span class="flex items-center gap-1.5">
          ② {{ shipDocLabelOf(shipment) }}
          <Button
            v-if="awbOf(shipment) === null"
            size="xs"
            :title="`${shipDocLabelOf(shipment)} 첨부 — Case ID 발송은 ${shipDocLabelOf(shipment)} 가 있어야 선적 진행이 열립니다`"
            @click="adminPickShipFile(po.poId, shipDocTypeOf(shipment))"
          >
            <UploadIcon />
            첨부
          </Button>
          <template v-else>
            <CheckIcon class="text-success size-3.5" />
            <Button
              variant="outline"
              size="icon-xs"
              :title="awbOf(shipment)?.name"
              :aria-label="`${shipDocLabelOf(shipment)} 내려받기`"
              @click="download(awbOf(shipment)?.fileId ?? 0, awbOf(shipment)?.name ?? '')"
            >
              <DownloadIcon />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :title="`${shipDocLabelOf(shipment)} 교체`"
              @click="adminPickShipFile(po.poId, shipDocTypeOf(shipment))"
            >
              <UploadIcon />
              교체
            </Button>
          </template>
        </span>
        <span>
          ③ [선적 진행]에서 Case ID·운송장 입력
          <span v-if="shipment.caseRef !== null && shipment.caseRef !== ''" class="text-success font-medium">✓ {{ shipment.caseRef }}</span>
        </span>
        <!-- 그 외 제출 서류(원산지증명원 등) — 메인 줄 칩을 숨긴 동안의 다운로드 자리 -->
        <span v-if="otherShipFilesOf(shipment).length > 0" class="text-muted-foreground ml-auto flex items-center gap-1.5">
          그 외 서류:
          <Button
            v-for="f in otherShipFilesOf(shipment)"
            :key="f.fileId"
            variant="outline"
            size="xs"
            :title="`${f.name} · ${f.uploadedBy === 'ADMIN' ? '자사' : '협력사'} 업로드`"
            @click="download(f.fileId, f.name)"
          >
            <DownloadIcon />
            {{ PCB_SHIPMENT_FILE_LABELS[f.fileType] }}
          </Button>
        </span>
      </Panel>
    </TableCell>
  </TableRow>
</template>
