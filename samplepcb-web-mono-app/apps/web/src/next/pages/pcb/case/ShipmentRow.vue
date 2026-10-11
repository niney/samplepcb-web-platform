<script setup lang="ts">
import {
  CheckIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LockIcon,
  PackageCheckIcon,
  ReceiptTextIcon,
  Trash2Icon,
  TruckIcon,
  Undo2Icon,
  UploadIcon,
  UserCogIcon,
} from '@lucide/vue';
import {
  PCB_SHIPMENT_FILE_LABELS,
  SHIPMENT_TRANSPORTS,
  SHIPMENT_TRANSPORT_LABELS,
  type AdminPcbPoViewType,
  type AdminPcbShipmentViewType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { downloadAdminPcbShipmentFile } from '@/admin/useAdminPcbPos';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '@/lib/pcb-shipment-label';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { TableCell, TableRow } from '@/next/components/ui/table';
import { pcbShipmentStatusVariant as shipStatusVariant } from '@/next/components/pcb/pcb-badges';
import Panel from '@/next/components/common/Panel.vue';
import { dateOnly } from './case-core';
import { usePcbCaseContext } from './usePcbCase';

// 선적 줄 — 대표 발주 행 아래 1줄(묶음 포함). 관리자는 받는측 + 양측 만능 대행.
//
// Case ID 요청 건(협력사가 자사 주선 발송을 골랐다)은 **아래 처리 스트립이 유일한 작업 자리**다
// (2026-10-11 정리): 1 인보이스 확인(선택) → 2 운송서류 첨부 → 3 Case ID·운송장 입력해 선적 진행.
// 윗줄에는 상태와 [되돌리기]만 남는다 — 예전에는 윗줄의 [선적 진행]·[Case ID 입력]이 같은 값을
// 따로 물었고, [Case ID 입력]만 누르면 협력사에게 "이 번호로 발송하고 운송장을 입력하라"는(이 갈래에서는
// 할 수 없는) 메일이 나갔다.
const props = defineProps<{ po: AdminPcbPoViewType; shipment: AdminPcbShipmentViewType }>();

const {
  specId,
  shipMatesOf,
  openMateCase,
  caseRefStrip,
  caseRefShipStep,
  caseRefShipLock,
  stripTransportOf,
  setStripTransport,
  adminShipCaseRef,
  adminPickShipFile,
  shipDocTypeOf,
  shipDocLabelOf,
  adminShipAdvanceLabel,
  isShipAdvanceProxy,
  showProxy,
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
const hasCaseRef = (s: AdminPcbShipmentViewType): boolean => s.caseRef !== null && s.caseRef !== '';
</script>

<template>
  <TableRow data-ship-row>
    <TableCell :colspan="6" class="bg-muted/40">
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
        <!-- 다음 단계가 협력사 몫(선적 요청·배송 중)이면 대행이다 — [협력사 대행 동작 보기]를 따른다. -->
        <Button
          v-if="adminShipAdvanceLabel(shipment) !== null && !caseRefShipStep(shipment) && (!isShipAdvanceProxy(shipment) || showProxy(po))"
          size="sm"
          :variant="isShipAdvanceProxy(shipment) ? 'outline' : 'default'"
          :title="isShipAdvanceProxy(shipment) ? '협력사가 포털에서 하는 단계입니다 — 관리자 대행으로 진행합니다.' : undefined"
          :data-ship-proxy="isShipAdvanceProxy(shipment) ? '' : undefined"
          @click="void adminShipAdvance(po.poId, shipment)"
        >
          <UserCogIcon v-if="isShipAdvanceProxy(shipment)" />
          {{ adminShipAdvanceLabel(shipment) }} 진행
        </Button>
        <!-- Case ID 단독 입력 — 기록·정정 경로. 요청 건은 스트립 ③ 이 운송장과 함께 받으므로 스트립이 서 있는
             동안엔 없다(같은 값을 두 버튼이 묻지 않게). 발송 뒤에는 오타를 고치는 [Case ID 정정]으로 남는다. -->
        <Button
          v-if="shipment.receivedAt === null && shipment.receiverKind === 'admin' && !caseRefStrip(shipment)"
          variant="outline"
          size="sm"
          data-ship-caseref-edit
          @click="void openCaseRef(po.poId, shipment)"
        >
          {{ hasCaseRef(shipment) ? 'Case ID 정정' : 'Case ID 입력' }}
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
        <Button v-if="shipment.mode === 'international' && !caseRefStrip(shipment)" variant="outline" size="sm" @click="invoicePoId = po.poId">
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
      <!-- Case ID 처리 — 관리자가 할 일을 순서대로. 단계마다 상태가 보인다: 끝난 것은 ✓, 지금 할 것은 강조,
           아직 못 하는 것은 잠그고 이유를 적는다(눌러 보고 409 로 배우게 하지 않는다). 실발송 전까지만 선다. -->
      <Panel v-if="caseRefStrip(shipment)" size="sm" tone="warning" class="mt-2 ml-6 text-xs whitespace-normal" data-caseref-strip>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-semibold">Case ID 처리</span>
          <span>협력사가 기다리고 있습니다 — 순서대로 처리하면 선적으로 넘어갑니다.</span>
          <span v-if="shipment.caseRefNote !== null && shipment.caseRefNote !== ''" data-caseref-note>요청 메모: {{ shipment.caseRefNote }}</span>
        </div>
        <div class="mt-2 grid gap-2 lg:grid-cols-3">
          <!-- ① 인보이스 — 선택. 고칠 것이 없으면 건너뛴다(서버도 강제하지 않는다). -->
          <Panel tone="card" class="text-foreground" data-caseref-step="invoice" :data-step-done="adminInvoiceOf(shipment) !== null ? '' : undefined">
            <p class="flex flex-wrap items-center gap-1.5 font-semibold">
              <span class="bg-foreground text-background inline-flex size-4 shrink-0 items-center justify-center rounded-full font-semibold" aria-hidden="true">1</span>
              인보이스 확인
              <span class="text-muted-foreground font-normal">(선택)</span>
              <span v-if="adminInvoiceOf(shipment) !== null" class="text-success inline-flex items-center gap-0.5 font-medium">
                <CheckIcon class="size-3.5" />
                수정본
              </span>
            </p>
            <p class="text-muted-foreground mt-1">협력사 인보이스를 확인합니다. 고칠 것이 없으면 건너뜁니다.</p>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
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
              <Button variant="outline" size="xs" title="인보이스 생성기 — 만들어 바로 첨부합니다" @click="invoicePoId = po.poId">
                <FileTextIcon />
                생성기
              </Button>
              <Button
                variant="outline"
                size="xs"
                title="수정한 인보이스(xlsx)를 올립니다 — 기존 Invoice 를 교체합니다"
                @click="adminPickShipFile(po.poId, 'invoice')"
              >
                <UploadIcon />
                수정본 올리기
              </Button>
            </div>
          </Panel>
          <!-- ② 운송서류 — 필수. 어느 서류를 붙이는지가 곧 운송수단이다(③ 의 전이에 함께 실린다). -->
          <Panel tone="card" class="text-foreground" data-caseref-step="doc" :data-step-done="awbOf(shipment) !== null ? '' : undefined">
            <p class="flex flex-wrap items-center gap-1.5 font-semibold">
              <span class="bg-foreground text-background inline-flex size-4 shrink-0 items-center justify-center rounded-full font-semibold" aria-hidden="true">2</span>
              운송서류 첨부
              <span v-if="awbOf(shipment) !== null" class="text-success inline-flex items-center gap-0.5 font-medium">
                <CheckIcon class="size-3.5" />
                {{ shipDocLabelOf(shipment) }}
              </span>
              <span v-else class="text-warning font-medium">{{ shipDocLabelOf(shipment) }} 필요</span>
            </p>
            <p class="text-muted-foreground mt-1">부킹한 운송서류를 붙입니다. 항공이면 AWB, 해상이면 B/L 입니다.</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
              <ButtonGroup>
                <Button
                  v-for="t in SHIPMENT_TRANSPORTS"
                  :key="t"
                  size="xs"
                  :variant="stripTransportOf(shipment) === t ? 'secondary' : 'outline'"
                  :aria-pressed="stripTransportOf(shipment) === t"
                  :data-caseref-transport="t"
                  @click="setStripTransport(shipment, t)"
                >
                  {{ SHIPMENT_TRANSPORT_LABELS[t] }} {{ t === 'air' ? 'AWB' : 'B/L' }}
                </Button>
              </ButtonGroup>
              <Button
                v-if="awbOf(shipment) === null"
                size="xs"
                data-caseref-doc-upload
                @click="adminPickShipFile(po.poId, shipDocTypeOf(shipment))"
              >
                <UploadIcon />
                {{ shipDocLabelOf(shipment) }} 첨부
              </Button>
              <template v-else>
                <Button
                  variant="outline"
                  size="xs"
                  :title="awbOf(shipment)?.name"
                  @click="download(awbOf(shipment)?.fileId ?? 0, awbOf(shipment)?.name ?? '')"
                >
                  <DownloadIcon />
                  내려받기
                </Button>
                <Button variant="ghost" size="xs" data-caseref-doc-upload @click="adminPickShipFile(po.poId, shipDocTypeOf(shipment))">
                  <UploadIcon />
                  교체
                </Button>
              </template>
            </div>
          </Panel>
          <!-- ③ 입력 → 선적. 협력사 통지는 이때 한 번(Case ID·운송장 동봉). -->
          <Panel tone="card" class="text-foreground" data-caseref-step="ship">
            <p class="flex flex-wrap items-center gap-1.5 font-semibold">
              <span class="bg-foreground text-background inline-flex size-4 shrink-0 items-center justify-center rounded-full font-semibold" aria-hidden="true">3</span>
              Case ID·운송장 입력
            </p>
            <p class="text-muted-foreground mt-1">입력하면 선적으로 넘어가고, 협력사에게 Case ID·운송장이 메일로 한 번에 안내됩니다.</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Button
                size="xs"
                :variant="caseRefShipLock(shipment) === null ? 'default' : 'outline'"
                :disabled="caseRefShipLock(shipment) !== null"
                data-caseref-ship
                @click="void adminShipCaseRef(po.poId, shipment)"
              >
                <LockIcon v-if="caseRefShipLock(shipment) !== null" />
                <TruckIcon v-else />
                입력하고 선적 진행
              </Button>
              <span v-if="caseRefShipLock(shipment) !== null" class="text-warning font-medium" data-caseref-ship-lock>{{ caseRefShipLock(shipment) }}</span>
              <span v-if="hasCaseRef(shipment)" class="text-muted-foreground">적어 둔 값 {{ shipment.caseRef }}</span>
            </div>
          </Panel>
        </div>
        <!-- 그 외 제출 서류(원산지증명원 등) — 윗줄 칩을 숨긴 동안의 다운로드 자리 -->
        <div v-if="otherShipFilesOf(shipment).length > 0" class="text-foreground mt-2 flex flex-wrap items-center gap-1.5">
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
        </div>
      </Panel>
    </TableCell>
  </TableRow>
</template>
