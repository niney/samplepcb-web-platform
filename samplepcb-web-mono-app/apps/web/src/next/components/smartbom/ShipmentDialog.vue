<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  ArrowRightIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  LockIcon,
  PackageIcon,
  QrCodeIcon,
  TriangleAlertIcon,
  UploadIcon,
} from '@lucide/vue';
import {
  BOM_SHIPMENT_DOMESTIC_STATUSES,
  BOM_SHIPMENT_FILE_LABELS,
  BOM_SHIPMENT_INTL_STATUSES,
  BOM_SHIPMENT_MODE_LABELS,
  SHIPMENT_TRANSPORTS,
  SHIPMENT_TRANSPORT_LABELS,
  shipmentTransportDocType,
  shipmentTransportOf,
  bomShipmentActorOf,
  bomShipmentDocumentsLocked,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  type AdminBomPoViewType,
  type BomShipmentFileTypeType,
  type BomShipmentModeType,
  type BomShipmentStatusType,
  type ShipmentTransportType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { fmtKstDate, kstDateInput } from '@sp/utils';
import {
  adminInvoiceApi,
  adminPackingApi,
  downloadBomShipmentFile,
  loadAdminPartnerQuotation,
  loadAdminShipmentStatement,
  useDeleteBomShipmentFile,
  useDetachBomShipmentPo,
  useReceiveBomShipment,
  useUploadBomShipmentFile,
  useUpsertBomShipment,
} from '@/admin/useAdminBomPos';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import InvoiceEditorDialog from '@/next/components/common/InvoiceEditorDialog.vue';
import Panel from '@/next/components/common/Panel.vue';
import { confirmDialog } from '@/next/lib/dialog';
import ShipmentPackingDialog from './ShipmentPackingDialog.vue';
import TradeDocumentDialog from './TradeDocumentDialog.vue';

// 선적 관리(D21·D22) — 옛 components/admin/smartbom/BomShipmentModal.vue 의 짝(같은 props·emits).
// 발주서당 1건. 모드는 협력사 국가에서 서버가 결정해 생성 시 박제하고 화면은 읽기만 한다. 상태는 모드별
// 사전(국제 6단계/국내 3단계). 관리자는 전 단계 임의 조작(핑퐁 인가는 협력사 쪽만). 첨부 = Invoice와
// 운송수단별 AWB/B/L 종류별 1건(교체), 입고 확인 = 검수(⑩) + 편차 메모.
//
// 선적 리스트·거래 문서는 인쇄 격리 때문에 shadcn Dialog 가 아닌 전체 화면 막이다. 모달 Dialog 가 떠
// 있으면 바깥(막)의 포인터·포커스를 막으므로, 그 문서가 열린 동안은 이 대화상자를 잠시 내린다(입력값은
// 이 컴포넌트 상태라 그대로 남고, 문서를 닫으면 다시 뜬다). 인보이스 생성기는 Dialog 라 그대로 겹친다.

const props = defineProps<{
  open: boolean;
  quoteId: string;
  po: AdminBomPoViewType | null;
}>();
const emit = defineEmits<{ close: [] }>();

const upsert = useUpsertBomShipment();
const receive = useReceiveBomShipment();
const uploadFile = useUploadBomShipmentFile();
const deleteFile = useDeleteBomShipmentFile();
const detach = useDetachBomShipmentPo();

// 묶음 제외(§6.10) — 대표 불가·발송 준비 단계만(서버 재검증).
async function detachGroupPo(poId: number, title: string): Promise<void> {
  if (
    !(await confirmDialog({
      message: `'${title}' 발주서를 묶음에서 제외할까요? 별도 선적으로 다시 진행하게 됩니다.`,
      confirmLabel: '묶음 제외',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    await detach.mutateAsync({ quoteId: props.quoteId, poId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '묶음 제외에 실패했습니다.';
  }
}

const mode = computed<BomShipmentModeType | null>(() => props.po?.shipmentMode ?? null);
const status = ref<BomShipmentStatusType>('preparing');
// 운송수단(08-16, 협력사 카드와 같은 공용 축) — 관리자는 임의 조작이 원칙이라 언제든 고칠 수 있다
// (협력사는 되돌리기를 거쳐야 한다). 서류 줄·AWB 경고가 이 값을 따른다.
const transport = ref<ShipmentTransportType>('air');
const carrier = ref('');
const trackingNumber = ref('');
const trackingUrl = ref('');
const shipDate = ref('');
const caseRef = ref('');
const receiveNote = ref('');
const error = ref('');

const existing = computed(() => props.po?.shipment ?? null);
const caseRefBranch = computed(
  () => existing.value?.mode === 'international' && existing.value.caseRefRequestedAt !== null,
);
const caseRefPending = computed(
  () => caseRefBranch.value && (existing.value?.caseRef === null || existing.value?.caseRef === ''),
);
const caseRefChanged = computed(
  () => caseRefBranch.value && caseRef.value.trim() !== (existing.value?.caseRef ?? ''),
);
const documentsLocked = computed(() => {
  const shipment = existing.value;
  return shipment === null ? false : bomShipmentDocumentsLocked(shipment.mode, shipment.status, shipment.receivedAt);
});
const packingOpen = ref(false);
const quotationPoId = ref<number | null>(null);
const statementOpen = ref(false);
const invoiceOpen = ref(false);
const packingApi = computed(() => (existing.value === null ? null : adminPackingApi(existing.value.shipmentId)));
const tradeDocumentPos = computed<{ poId: number; quoteTitle: string }[]>(() => {
  if ((existing.value?.groupPos.length ?? 0) > 0) {
    return (existing.value?.groupPos ?? []).map((entry) => ({ poId: entry.poId, quoteTitle: entry.quoteTitle }));
  }
  return props.po === null ? [] : [{ poId: props.po.poId, quoteTitle: '' }];
});
const loadQuotation = () => {
  if (quotationPoId.value === null) return Promise.reject(new Error('quotation not selected'));
  return loadAdminPartnerQuotation(quotationPoId.value);
};
const loadStatement = () => {
  if (existing.value === null) return Promise.reject(new Error('shipment not selected'));
  return loadAdminShipmentStatement(existing.value.shipmentId);
};
// 전체 화면 문서(선적 리스트·거래 문서)가 열린 동안 이 대화상자를 내린다(머리말).
const documentOpen = computed(() => packingOpen.value || quotationPoId.value !== null || statementOpen.value);
const shown = computed(() => props.open && props.po !== null && !documentOpen.value);

// ── 핑퐁 안내(D22) — 저장된 상태 기준 "다음 단계·주체"를 대화상자가 말해준다 ─────
const savedNext = computed(() =>
  existing.value === null ? null : bomShipmentNextStatus(existing.value.mode, existing.value.status),
);
const savedNextActor = computed(() =>
  existing.value === null || savedNext.value === null ? null : bomShipmentActorOf(existing.value.mode, savedNext.value),
);
const savedLabel = (s: BomShipmentStatusType): string =>
  existing.value === null ? s : bomShipmentStatusLabel(existing.value.mode, s);

// 입고 확인 위계 — 도착 단계(국제 arrived·국내 shipping) 전엔 "조기 입고"로 접고 경고.
const arrivedOrLater = computed(() => {
  if (existing.value === null) return false;
  const chain = bomShipmentStatusesOf(existing.value.mode);
  const arrivedIdx = chain.indexOf(existing.value.mode === 'domestic' ? 'shipping' : 'arrived');
  return chain.indexOf(existing.value.status) >= arrivedIdx;
});
const earlyReceive = computed(() => !(arrivedOrLater.value || existing.value?.receivedAt != null));

watch(
  () => [props.open, props.po?.poId] as const,
  ([open]) => {
    if (!open) return;
    const shipment = props.po?.shipment ?? null;
    status.value = shipment?.status ?? 'preparing';
    transport.value = shipmentTransportOf(shipment?.transport);
    carrier.value = shipment?.carrier ?? '';
    trackingNumber.value = shipment?.trackingNumber ?? '';
    trackingUrl.value = shipment?.trackingUrl ?? '';
    // ISO 원문을 그대로 넣으면 date input 이 파싱하지 못해 값이 비어 보인다 — KST 날짜로.
    shipDate.value = kstDateInput(shipment?.shipDate);
    caseRef.value = shipment?.caseRef ?? '';
    receiveNote.value = shipment?.receivedNote ?? '';
    packingOpen.value = false;
    quotationPoId.value = null;
    statementOpen.value = false;
    invoiceOpen.value = false;
    error.value = '';
  },
  { immediate: true },
);

const statusOptions = computed(() => {
  const selectedMode = mode.value;
  if (selectedMode === null) return [];
  const statuses = selectedMode === 'domestic' ? BOM_SHIPMENT_DOMESTIC_STATUSES : BOM_SHIPMENT_INTL_STATUSES;
  return statuses
    .filter((value) => selectedMode !== 'domestic' || value !== 'delivered' || existing.value?.receivedAt != null)
    .map((value) => ({ value, label: bomShipmentStatusLabel(selectedMode, value) }));
});

const onStatusChange = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const match = statusOptions.value.find((option) => option.value === value);
  if (match !== undefined) status.value = match.value;
};
const onTransportChange = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const match = SHIPMENT_TRANSPORTS.find((entry) => entry === value);
  if (match !== undefined) transport.value = match;
};

const toNullable = (v: string): string | null => (v.trim() === '' ? null : v.trim());

// 첨부(D22) — Invoice와 운송수단별 AWB/B/L 종류별 1건, 국외 발송 전용.
const fileLabel = (kind: BomShipmentFileTypeType): string => BOM_SHIPMENT_FILE_LABELS[kind];
const fileOf = (kind: BomShipmentFileTypeType) => existing.value?.files.find((f) => f.fileType === kind) ?? null;
const fileBusy = computed(() => uploadFile.isPending.value || deleteFile.isPending.value);
/** 이 발송의 운송서류 — 항공 AWB / 해상 B/L(08-16). 서류 줄·경고·확인 문구가 함께 쓴다. */
const docKind = computed(() => shipmentTransportDocType(transport.value));
const docLabel = computed(() => BOM_SHIPMENT_FILE_LABELS[docKind.value]);
/** 첨부 줄 — 사전 전체를 늘어놓으면 해상 발송에도 AWB 줄이 서서 "둘 다 내야 하나"로 읽힌다.
 *  인보이스(공통) + 수단이 정한 운송서류 1종만. */
const docKinds = computed<BomShipmentFileTypeType[]>(() => ['invoice', docKind.value]);
// 직접 발송은 선택 서류라 경고만 한다. Case ID 운송은 처리 스트립과 서버 게이트가 Case ID·운송장·
// 운송서류를 모두 필수로 강제한다.
const awbWarning = computed(
  () =>
    mode.value === 'international' && !caseRefBranch.value && status.value === 'shipped' && fileOf(docKind.value) === null,
);

async function onFilePicked(kind: BomShipmentFileTypeType, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file === undefined || props.po === null || documentsLocked.value) return;
  error.value = '';
  try {
    await uploadFile.mutateAsync({ quoteId: props.quoteId, poId: props.po.poId, fileType: kind, file });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 업로드에 실패했습니다.';
  }
}

async function removeFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || props.po === null || documentsLocked.value) return;
  if (!(await confirmDialog({ message: `${fileLabel(kind)} 파일을 삭제할까요?`, confirmLabel: '삭제', tone: 'danger' }))) {
    return;
  }
  error.value = '';
  try {
    await deleteFile.mutateAsync({ quoteId: props.quoteId, poId: props.po.poId, fileId: file.fileId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '파일 삭제에 실패했습니다.';
  }
}

async function downloadFile(kind: BomShipmentFileTypeType): Promise<void> {
  const file = fileOf(kind);
  if (file === null || props.po === null) return;
  try {
    await downloadBomShipmentFile(props.quoteId, props.po.poId, file.fileId, file.name);
  } catch {
    error.value = '파일 다운로드에 실패했습니다.';
  }
}

// ── 상업송장 생성기(D23) — 관리자 대리 작성(협력사와 같은 편집본 공유) ────────
const invoiceApi = computed(() => (props.po === null ? null : adminInvoiceApi(props.quoteId, props.po.poId)));
async function attachInvoicePdf(file: File): Promise<void> {
  if (props.po === null || documentsLocked.value) return;
  await uploadFile.mutateAsync({ quoteId: props.quoteId, poId: props.po.poId, fileType: 'invoice', file });
}

async function save(): Promise<void> {
  if (props.po === null) return;
  error.value = '';
  if (mode.value === null) {
    error.value = '협력사 관리에서 국가를 먼저 등록해 주세요.';
    return;
  }
  try {
    await upsert.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      body: {
        ...(mode.value === 'domestic' && status.value === 'delivered' ? {} : { status: status.value }),
        // 국내에서 보내도 서버가 버리지만(mode 게이트), 화면도 국제에서만 싣는다.
        ...(mode.value === 'international' ? { transport: transport.value } : {}),
        carrier: toNullable(carrier.value),
        trackingNumber: toNullable(trackingNumber.value),
        trackingUrl: toNullable(trackingUrl.value),
        shipDate: toNullable(shipDate.value),
        ...(caseRefChanged.value ? { caseRef: toNullable(caseRef.value) } : {}),
      },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

// 관리자 차례 다음 단계로 진행 — 상태를 다음 단계로 맞추고 저장(임의 조작과 동일 경로).
async function advanceAsAdmin(): Promise<void> {
  if (savedNext.value === null) return;
  if (existing.value?.mode === 'domestic' && savedNext.value === 'delivered') {
    await confirmReceive();
    return;
  }
  if (savedNext.value === 'shipped' && caseRefBranch.value) {
    if (caseRef.value.trim() === '') {
      error.value = '발송 참조번호(Case ID)를 입력해 주세요.';
      return;
    }
    if (trackingNumber.value.trim() === '') {
      error.value = `${docLabel.value} No.를 입력해 주세요.`;
      return;
    }
    if (fileOf(docKind.value) === null) {
      error.value = `${docLabel.value} 파일을 첨부해 주세요.`;
      return;
    }
  }
  if (
    savedNext.value === 'shipped' &&
    fileOf(docKind.value) === null &&
    !(await confirmDialog(`${docLabel.value} 파일이 아직 없습니다. 첨부 없이 선적 단계로 진행할까요?`))
  ) {
    return;
  }
  status.value = savedNext.value;
  await save();
}

async function confirmReceive(): Promise<void> {
  if (props.po === null) return;
  if (mode.value === null) {
    error.value = '협력사 관리에서 국가를 먼저 등록해 주세요.';
    return;
  }
  const warn = earlyReceive.value
    ? `선적이 아직 '${existing.value === null ? '준비' : savedLabel(existing.value.status)}' 단계입니다. 시스템 밖으로 이미 수령한 경우에만 진행하세요.\n\n`
    : '';
  if (!(await confirmDialog(`${warn}입고 확인 처리할까요? 선적이 최종 단계로 마감되고 검수 시점이 기록됩니다.`))) {
    return;
  }
  error.value = '';
  try {
    await receive.mutateAsync({
      quoteId: props.quoteId,
      poId: props.po.poId,
      body: { note: toNullable(receiveNote.value) },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '입고 확인에 실패했습니다.';
  }
}

const onOpenChange = (value: boolean): void => {
  if (!value) emit('close');
};
</script>

<template>
  <Dialog :open="shown" @update:open="onOpenChange">
    <DialogScrollContent v-if="po !== null" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>선적 관리 — {{ po.partnerName }}</DialogTitle>
        <DialogDescription>
          PO #{{ po.poId }}<template v-if="mode !== null"> · {{ BOM_SHIPMENT_MODE_LABELS[mode] }}</template>
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <!-- 핑퐁 안내(D22) — 지금 누구 차례인지, 관리자 차례면 주 버튼으로 바로 진행 -->
        <template v-if="existing !== null && savedNext !== null">
          <Alert v-if="savedNextActor === 'ADMIN'" variant="info" size="sm">
            <ArrowRightIcon />
            <AlertTitle>다음 단계: {{ savedLabel(savedNext) }} — 샘플피씨비 차례입니다.</AlertTitle>
            <AlertDescription>
              <p v-if="savedNext === 'shipped'">
                <template v-if="caseRefBranch">Case ID·{{ docLabel }}·운송장을 확인해 주세요.</template>
                <template v-else>{{ docLabel }} 첨부와 송장번호를 확인해 주세요.</template>
              </p>
              <Button size="sm" class="mt-1" :disabled="upsert.isPending.value" @click="void advanceAsAdmin()">
                {{ existing.mode === 'domestic' && savedNext === 'delivered' ? '입고 확인' : `'${savedLabel(savedNext)}'(으)로 진행` }}
                <ArrowRightIcon />
              </Button>
            </AlertDescription>
          </Alert>
          <Alert v-else variant="muted" size="sm">
            <ClockIcon />
            <AlertDescription>
              협력사의 '{{ savedLabel(savedNext) }}' 처리를 기다리는 중입니다 — 필요하면 아래에서 관리자가 대신 진행할 수
              있습니다.
            </AlertDescription>
          </Alert>
        </template>
        <Alert v-if="error !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <!-- PCB와 같은 Case ID 처리 스트립 — 협력사 제출본 확인 → 운송서류 → Case ID·번호. -->
        <Panel v-if="caseRefBranch" tone="warning">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <p class="text-sm font-semibold">샘플피씨비 운송 · Case ID 처리</p>
            <Badge :variant="caseRefPending ? 'warning' : 'success'">{{ caseRefPending ? 'Case ID 요청' : 'Case ID 입력됨' }}</Badge>
            <span v-if="existing?.caseRefNote">요청 메모: {{ existing.caseRefNote }}</span>
          </div>
          <div class="mt-2 grid gap-2 sm:grid-cols-3">
            <Panel tone="card" class="text-foreground text-xs">
              <p class="font-semibold">① 협력사 Invoice 확인·수정</p>
              <p class="text-muted-foreground mt-1 truncate" :title="fileOf('invoice')?.name">
                {{ fileOf('invoice') === null ? '첨부 없음' : `✓ ${fileOf('invoice')?.name ?? ''}` }}
              </p>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                <Button v-if="fileOf('invoice') !== null" variant="outline" size="xs" @click="void downloadFile('invoice')">
                  <DownloadIcon />
                  내려받기
                </Button>
                <Button v-if="!documentsLocked" variant="outline" size="xs" @click="invoiceOpen = true">
                  <FileTextIcon />
                  인보이스 생성기
                </Button>
                <Button v-if="!documentsLocked" variant="outline" size="xs" as-child>
                  <label class="cursor-pointer">
                    <UploadIcon />
                    교체
                    <input type="file" class="hidden" :disabled="fileBusy" @change="(e: Event) => void onFilePicked('invoice', e)">
                  </label>
                </Button>
              </div>
            </Panel>
            <Panel tone="card" class="text-foreground text-xs">
              <p class="font-semibold">② {{ docLabel }} 준비</p>
              <p class="text-muted-foreground mt-1 truncate" :title="fileOf(docKind)?.name">
                {{ fileOf(docKind) === null ? '첨부 필요' : `✓ ${fileOf(docKind)?.name ?? ''}` }}
              </p>
              <div class="mt-1.5 flex gap-1.5">
                <Button v-if="fileOf(docKind) !== null" variant="outline" size="xs" @click="void downloadFile(docKind)">
                  <DownloadIcon />
                  내려받기
                </Button>
                <Button v-if="!documentsLocked" variant="outline" size="xs" as-child>
                  <label class="cursor-pointer">
                    <UploadIcon />
                    {{ fileOf(docKind) === null ? '첨부' : '교체' }}
                    <input type="file" class="hidden" :disabled="fileBusy" @change="(e: Event) => void onFilePicked(docKind, e)">
                  </label>
                </Button>
              </div>
            </Panel>
            <Panel tone="card" class="text-foreground text-xs">
              <p class="font-semibold">③ Case ID·운송장 입력</p>
              <p class="text-muted-foreground mt-1">{{ caseRef.trim() === '' ? 'Case ID 입력 필요' : `✓ ${caseRef}` }}</p>
              <p class="text-muted-foreground mt-0.5">
                {{ trackingNumber.trim() === '' ? `${docLabel} No. 입력 필요` : `✓ ${trackingNumber}` }}
              </p>
            </Panel>
          </div>
        </Panel>

        <div class="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>발송 구분 (국가 기준)</FieldLabel>
            <Panel size="xs" :tone="mode === null ? 'destructive' : 'muted'" class="flex h-8 items-center text-sm font-medium">
              {{ mode === null ? '국가 미등록' : BOM_SHIPMENT_MODE_LABELS[mode] }}
              <span class="text-muted-foreground ml-auto font-mono text-xs">{{ po.partnerCountry ?? '—' }}</span>
            </Panel>
          </Field>
          <Field>
            <FieldLabel for="bom-ship-status">상태</FieldLabel>
            <NativeSelect id="bom-ship-status" :model-value="status" :disabled="mode === null" @change="onStatusChange">
              <NativeSelectOption v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <!-- 운송수단(08-16) — 국제 전용. 서류(AWB/BL)·경고 문구가 이 값에서 갈리고, 바꾸면 서버가 앞서
               박힌 운송사·송장을 함께 비운다(남의 수단 값 방지). -->
          <Field v-if="mode === 'international'">
            <FieldLabel for="bom-ship-transport">운송수단</FieldLabel>
            <NativeSelect id="bom-ship-transport" :model-value="transport" @change="onTransportChange">
              <NativeSelectOption v-for="t in SHIPMENT_TRANSPORTS" :key="t" :value="t">
                {{ SHIPMENT_TRANSPORT_LABELS[t] }}{{ t === 'air' ? ' (AWB)' : ' (B/L)' }}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel for="bom-ship-carrier">운송사</FieldLabel>
            <Input id="bom-ship-carrier" v-model="carrier" type="text" maxlength="50" />
          </Field>
          <Field>
            <FieldLabel for="bom-ship-tracking">{{ mode === 'international' ? `${docLabel} No.` : '송장번호' }}</FieldLabel>
            <Input id="bom-ship-tracking" v-model="trackingNumber" type="text" maxlength="100" />
          </Field>
          <Field v-if="caseRefBranch">
            <FieldLabel for="bom-ship-caseref">발송 참조번호(Case ID)</FieldLabel>
            <Input id="bom-ship-caseref" v-model="caseRef" type="text" maxlength="100" />
          </Field>
          <Field v-if="mode === 'international'">
            <FieldLabel for="bom-ship-date">출고예정일</FieldLabel>
            <Input id="bom-ship-date" v-model="shipDate" type="date" />
          </Field>
          <Field>
            <FieldLabel for="bom-ship-url">추적 URL</FieldLabel>
            <Input id="bom-ship-url" v-model="trackingUrl" type="url" maxlength="500" />
          </Field>
        </div>
        <Alert v-if="mode === null" variant="destructive" size="sm">
          <AlertDescription>협력사 관리에서 실제 발송 국가를 등록해야 발송을 시작할 수 있습니다.</AlertDescription>
        </Alert>
        <Alert v-else-if="po.partnerCountry === null" variant="warning" size="sm">
          <AlertDescription>
            협력사 국가가 미등록입니다. 이 발송은 기존 구분을 유지하지만 새 발주·발송 전에는 국가를 등록해 주세요.
          </AlertDescription>
        </Alert>
        <Alert v-if="po.shipmentModeMismatch" variant="warning" size="sm">
          <AlertDescription>기존 발송 구분과 현재 협력사 국가가 다릅니다. 진행 중 기록은 자동 변경하지 않았습니다.</AlertDescription>
        </Alert>
        <Alert v-if="awbWarning" variant="warning" size="sm">
          <TriangleAlertIcon />
          <AlertDescription>
            '선적' 단계인데 {{ docLabel }} 파일이 없습니다 — 첨부를 권장합니다(레거시 절차상 필수 서류).
          </AlertDescription>
        </Alert>
        <p v-if="existing?.shippedAt != null" class="text-muted-foreground text-xs">
          발송 {{ fmtKstDate(existing.shippedAt) }}
          <template v-if="existing.completedAt !== null"> · 최종 {{ fmtKstDate(existing.completedAt) }}</template>
        </p>

        <!-- 선적 그룹(§6.10) — 묶음 소속 발주서 목록 + 제외(발송 준비 단계·비대표만) -->
        <Panel v-if="(existing?.groupPos.length ?? 0) > 1" tone="info">
          <p class="flex items-center gap-1.5 text-sm font-semibold">
            <PackageIcon class="size-4" />
            묶음 발송 — 발주서 {{ existing?.groupPos.length }}건
          </p>
          <ul class="text-foreground mt-1 flex flex-col gap-1 text-xs">
            <li v-for="entry in existing?.groupPos ?? []" :key="entry.poId" class="flex items-center gap-2">
              <span :class="entry.poId === po.poId ? 'font-bold' : ''">{{ entry.quoteTitle }}</span>
              <span class="text-muted-foreground tabular-nums">{{ entry.totalAmount.toLocaleString('ko-KR') }}원</span>
              <Button
                v-if="existing?.status === 'preparing'"
                variant="outline"
                size="xs"
                class="ml-auto"
                :disabled="detach.isPending.value"
                @click="void detachGroupPo(entry.poId, entry.quoteTitle)"
              >
                제외
              </Button>
            </li>
          </ul>
          <p class="mt-1 text-xs">입고 확인은 묶음 전체가 함께 처리됩니다(선적 단위 검수).</p>
        </Panel>

        <!-- 발송 문서 — Packing List는 공통, 거래 문서는 국내 선택, Invoice/AWB/B/L은 국외 전용 -->
        <Panel class="flex flex-col gap-2">
          <p class="text-sm font-semibold">발송 문서</p>
          <Panel v-if="existing !== null" size="xs" tone="success" class="flex flex-wrap items-center gap-2 text-xs">
            <span class="w-20 shrink-0 font-semibold">선적 리스트</span>
            <span>부품별 실물 포장 QR·라벨</span>
            <Button size="xs" class="ml-auto" @click="packingOpen = true">
              <QrCodeIcon />
              {{ existing.status === 'preparing' ? '대리 작성·인쇄' : '보기·재인쇄' }}
            </Button>
          </Panel>
          <Panel v-if="mode === 'domestic'" size="xs" tone="muted" class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="text-foreground w-20 shrink-0 font-semibold">거래 문서</span>
            <Badge variant="outline">선택</Badge>
            <Button
              v-for="entry in tradeDocumentPos"
              :key="`quotation-${entry.poId}`"
              variant="outline"
              size="xs"
              class="max-w-36"
              :title="entry.quoteTitle === '' ? '협력사 견적서' : `${entry.quoteTitle} 협력사 견적서`"
              @click="quotationPoId = entry.poId"
            >
              <span class="truncate">견적서{{ tradeDocumentPos.length > 1 ? ` #${entry.poId}` : '' }}</span>
            </Button>
            <Button v-if="existing !== null" size="xs" @click="statementOpen = true">거래명세서</Button>
          </Panel>
          <template v-if="mode === 'international' && !caseRefBranch">
            <Alert v-if="documentsLocked" variant="muted" size="sm">
              <LockIcon />
              <AlertDescription>완료된 발송 · 문서 잠금 — Invoice와 {{ docLabel }}는 내려받기만 할 수 있습니다.</AlertDescription>
            </Alert>
            <div v-for="kind in docKinds" :key="kind" class="flex flex-wrap items-center gap-2 text-xs">
              <span class="text-muted-foreground w-20 shrink-0 font-semibold">{{ fileLabel(kind) }}</span>
              <template v-if="fileOf(kind) !== null">
                <Button variant="link" size="xs" @click="void downloadFile(kind)">{{ fileOf(kind)?.name }}</Button>
                <span class="text-muted-foreground">{{ fileOf(kind)?.uploadedBy === 'PARTNER' ? '협력사 첨부' : '관리자 첨부' }}</span>
                <Button v-if="!documentsLocked" variant="link" size="xs" :disabled="fileBusy" @click="void removeFile(kind)">
                  <span class="text-destructive">삭제</span>
                </Button>
              </template>
              <span v-else class="text-muted-foreground">없음</span>
              <Button
                v-if="kind === 'invoice' && !documentsLocked"
                variant="outline"
                size="xs"
                class="ml-auto"
                :disabled="fileBusy"
                title="발주 데이터로 자동 초안을 만들어 편집 후 PDF로 첨부합니다(협력사 대리 작성)"
                @click="invoiceOpen = true"
              >
                <FileTextIcon />
                생성
              </Button>
              <Button v-if="!documentsLocked" variant="outline" size="xs" :class="kind === 'invoice' ? '' : 'ml-auto'" as-child>
                <label class="cursor-pointer">
                  <UploadIcon />
                  {{ fileOf(kind) === null ? '첨부' : '교체' }}
                  <input type="file" class="hidden" :disabled="fileBusy" @change="(e: Event) => void onFilePicked(kind, e)">
                </label>
              </Button>
            </div>
          </template>
        </Panel>

        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="emit('close')">취소</Button>
          <Button :disabled="upsert.isPending.value || mode === null" @click="void save()">저장</Button>
        </div>

        <!-- 입고 확인(검수 ⑩) — 도착 단계부터가 정상 흐름. 그 전엔 시스템 밖 수령 예외용으로만
             (D22 위계 조정: 이른 단계에선 흐릿한 버튼 + 경고, 기능 자체는 보존) -->
        <Panel :tone="earlyReceive ? 'muted' : 'default'" class="flex flex-col gap-2">
          <p class="text-sm font-semibold">
            입고 확인(검수)
            <span v-if="existing?.receivedAt != null" class="text-success ml-1 font-normal">
              — {{ fmtKstDate(existing.receivedAt) }} 완료
            </span>
          </p>
          <Alert v-if="earlyReceive" variant="warning" size="sm">
            <AlertDescription>아직 도착 전 단계입니다 — 선적 추적 없이 물품을 이미 수령한 경우에만 사용하세요.</AlertDescription>
          </Alert>
          <Field>
            <FieldLabel for="bom-ship-receive-note">편차 메모(수량 부족·불량 등 — 선택)</FieldLabel>
            <Textarea id="bom-ship-receive-note" v-model="receiveNote" rows="2" maxlength="2000" />
          </Field>
          <div>
            <Button
              :variant="earlyReceive ? 'secondary' : 'default'"
              :disabled="receive.isPending.value || mode === null"
              @click="void confirmReceive()"
            >
              {{ existing?.receivedAt != null ? '입고 확인 갱신' : '입고 확인' }}
            </Button>
          </div>
        </Panel>
      </div>
    </DialogScrollContent>
  </Dialog>

  <InvoiceEditorDialog
    v-if="invoiceApi !== null && mode === 'international' && !documentsLocked"
    :open="open && invoiceOpen"
    :load-draft="invoiceApi.loadDraft"
    :save-draft="invoiceApi.saveDraft"
    :render-xlsx="invoiceApi.renderXlsx"
    :attach-pdf="attachInvoicePdf"
    @close="invoiceOpen = false"
  />
  <ShipmentPackingDialog
    v-if="packingApi !== null"
    :open="open && packingOpen"
    :load="packingApi.load"
    :save="packingApi.save"
    :mark-printed="packingApi.markPrinted"
    @close="packingOpen = false"
  />
  <TradeDocumentDialog
    v-if="mode === 'domestic'"
    :open="open && quotationPoId !== null"
    label="협력사 견적서"
    :load="loadQuotation"
    @close="quotationPoId = null"
  />
  <TradeDocumentDialog
    v-if="mode === 'domestic'"
    :open="open && statementOpen"
    label="거래명세서"
    :load="loadStatement"
    @close="statementOpen = false"
  />
</template>
