<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { DownloadIcon, PaperclipIcon, RefreshCwIcon, SaveIcon, XIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { BomInvoiceDataType, BomInvoiceItemType } from '@sp/api-contract';
import { usePartnerI18n } from '@/partner/i18n';
import { confirmDialog } from '@/next/lib/dialog';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import Panel from './Panel.vue';
import TableEmptyRow from './TableEmptyRow.vue';
import InvoicePreviewDoc from './print/InvoicePreviewDoc.vue';

// 상업송장(Commercial Invoice) 편집·생성 — 옛 components/smartbom/InvoiceEditorModal.vue 의 짝(같은 props·emits).
// 자동 초안(발주 스냅샷·사업자정보)을 편집(HS CODE·중량·주소는 직접 입력)한 뒤, BOM 은 미리보기 DOM 을
// 캡처한 PDF(jspdf/html2canvas 지연 로딩)를, PCB 는 엑셀(서버 렌더)을 Invoice 로 첨부한다. API 는 콜백 주입.
// 문구는 partner i18n 원문 키(pt) 그대로 — 포털과 같은 사전을 쓴다.

const { pt, enabled, locale } = usePartnerI18n();

const props = defineProps<{
  open: boolean;
  loadDraft: (fresh: boolean) => Promise<BomInvoiceDataType>;
  saveDraft: (data: BomInvoiceDataType) => Promise<unknown>;
  renderXlsx: (data: BomInvoiceDataType) => Promise<Blob>;
  /** BOM 경로 — 미리보기 캡처 PDF 를 첨부한다. attachXlsx 를 주는 PCB 는 미전달. */
  attachPdf?: (file: File) => Promise<unknown>;
  /** 있으면 PDF 대신 **엑셀을 그대로 첨부**한다(PCB 08-13 — 관리자가 내려받아 고쳐 재첨부하는 왕복이라
   *  편집 가능한 파일이어야 한다). ⚠ 주입하는 쪽이 업로드 뮤테이션을 감싸 캐시를 무효화해야 화면이 바뀐다. */
  attachXlsx?: (file: File) => Promise<unknown>;
  /** 제목 — PCB 는 '인보이스 생성기'(08-13 명칭 통일), BOM 은 기본값. */
  title?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const busy = ref<'' | 'xlsx' | 'pdf' | 'save'>('');
const error = ref('');
// 일시 피드백은 고른 언어를 따른다 — 편집 중인 문서 데이터는 그대로 둔다.
watch(locale, () => {
  error.value = '';
});
const previewEl = ref<HTMLElement | null>(null);

const blank = (): BomInvoiceDataType => ({
  companyName: '',
  shipperName: '',
  shipperAddress: '',
  shipperTel: '',
  countryOfOrigin: '',
  countryOfDestination: 'KOREA',
  consigneeCompany: '',
  consigneeContact: '',
  consigneeAddress: '',
  consigneeTel: '',
  consigneeFax: '',
  consigneeEmail: '',
  countryOfManufacture: '',
  invoiceNo: '',
  netWeight: '',
  grossWeight: '',
  currency: 'KRW',
  invoiceDate: '',
  items: [],
  totalValue: 0,
});
const inv = reactive<BomInvoiceDataType>(blank());

const errorText = (e: unknown, fallback: string): string =>
  !enabled.value && e instanceof ApiRequestError ? e.message : pt(fallback);

async function load(fresh: boolean): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    Object.assign(inv, blank(), await props.loadDraft(fresh));
  } catch (e) {
    error.value = errorText(e, '인보이스 정보를 불러오지 못했습니다.');
  } finally {
    loading.value = false;
  }
}

// 열릴 때 초안을 읽는다. 처음부터 열린 채 마운트돼도 읽도록 immediate.
watch(
  () => props.open,
  (open) => {
    if (open) void load(false);
  },
  { immediate: true },
);

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// [발주 데이터로 다시 채우기] — 저장본이 자동 조립을 가리는 레거시 함정의 교정 버튼.
async function refill(): Promise<void> {
  if (
    !(await confirmDialog({
      message: pt('편집 중인 내용을 버리고 발주 데이터로 다시 채울까요?'),
      confirmLabel: pt('다시 채우기'),
      tone: 'danger',
    }))
  ) {
    return;
  }
  await load(true);
}

// ── 금액 계산(레거시 로직) — 단가×수량 우선, 없으면 totalValue 그대로 ─────────
const qtyNum = (q: string): number => {
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
};
const rowTotal = (it: BomInvoiceItemType): number => {
  if (it.unitValue !== null && qtyNum(it.qty) > 0) {
    return Math.round(it.unitValue * qtyNum(it.qty) * 100) / 100;
  }
  return it.totalValue ?? 0;
};
const grandTotal = (): number => inv.items.reduce((s, it) => s + rowTotal(it), 0);
const fmtMoney = (n: number): string =>
  n.toLocaleString(enabled.value ? (locale.value === 'ko' ? 'ko-KR' : locale.value) : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const addItem = (): void => {
  inv.items.push({
    description: '',
    hsCode: '',
    qty: '',
    currency: inv.currency,
    unitValue: null,
    totalValue: null,
  });
};
const removeItem = (i: number): void => {
  inv.items.splice(i, 1);
};
const setUnitValue = (it: BomInvoiceItemType, value: string | number): void => {
  const text = String(value).trim();
  const n = Number(text);
  it.unitValue = text === '' || !Number.isFinite(n) ? null : n;
};

const buildPayload = (): BomInvoiceDataType => ({
  ...inv,
  items: inv.items.map((it) => ({ ...it, totalValue: rowTotal(it) })),
  totalValue: grandTotal(),
});
const fileBase = (): string => (inv.invoiceNo || 'invoice').replace(/[^\w.-]+/g, '_');

async function save(): Promise<void> {
  if (busy.value !== '') return;
  busy.value = 'save';
  error.value = '';
  try {
    await props.saveDraft(buildPayload());
  } catch (e) {
    error.value = errorText(e, '저장에 실패했습니다.');
  } finally {
    busy.value = '';
  }
}

// 엑셀 — 서버 렌더(저장 겸) → 로컬 다운로드.
async function genXlsx(): Promise<void> {
  if (busy.value !== '') return;
  busy.value = 'xlsx';
  error.value = '';
  try {
    const blob = await props.renderXlsx(buildPayload());
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase()}.xlsx`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    error.value = errorText(e, '엑셀 생성에 실패했습니다.');
  } finally {
    busy.value = '';
  }
}

// 엑셀 첨부 — 서버 렌더(저장 겸) 결과를 그대로 Invoice 로 첨부(attachXlsx 주입 시).
async function genAttachXlsx(): Promise<void> {
  if (busy.value !== '' || props.attachXlsx === undefined) return;
  busy.value = 'xlsx';
  error.value = '';
  try {
    const blob = await props.renderXlsx(buildPayload());
    await props.attachXlsx(
      new File([blob], `${fileBase()}.xlsx`, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    emit('close');
  } catch (e) {
    error.value = errorText(e, '엑셀 첨부에 실패했습니다.');
  } finally {
    busy.value = '';
  }
}

// PDF — 편집본 저장 후 미리보기 DOM 캡처(A4 세로, 초과분 페이지 분할) → Invoice 첨부.
async function genPdf(): Promise<void> {
  if (busy.value !== '' || previewEl.value === null || props.attachPdf === undefined) return;
  const attachPdf = props.attachPdf;
  const target = previewEl.value;
  busy.value = 'pdf';
  error.value = '';
  try {
    await props.saveDraft(buildPayload());
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;
    const img = canvas.toDataURL('image/jpeg', 0.95);
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, 'JPEG', 0, position, pageW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(img, 'JPEG', 0, position, pageW, imgH);
      heightLeft -= pageH;
    }
    const blob = pdf.output('blob');
    await attachPdf(new File([blob], `${fileBase()}.pdf`, { type: 'application/pdf' }));
    emit('close');
  } catch (e) {
    error.value = errorText(e, 'PDF 생성에 실패했습니다.');
  } finally {
    busy.value = '';
  }
}

// 입력칸 정의 — 옛 모달의 칸 순서·라벨 그대로(pt 원문 키). wide=두 칸 차지, required=직접 입력 필수 표시.
type InvoiceTextKey = Exclude<keyof BomInvoiceDataType, 'items' | 'totalValue'>;
interface InvoiceInput {
  key: InvoiceTextKey;
  label: string;
  wide?: boolean;
  note?: string;
  required?: boolean;
  placeholder?: string;
  type?: 'date';
}
const SHIPPER_FIELDS: readonly InvoiceInput[] = [
  { key: 'companyName', label: '회사명(문서 헤더)', wide: true },
  { key: 'shipperName', label: '담당자' },
  { key: 'shipperTel', label: '전화' },
  { key: 'shipperAddress', label: '주소', wide: true, note: '(직접 입력)' },
  { key: 'countryOfOrigin', label: '원산지국' },
  { key: 'countryOfDestination', label: '목적지국' },
];
const CONSIGNEE_FIELDS: readonly InvoiceInput[] = [
  { key: 'consigneeCompany', label: '회사명' },
  { key: 'consigneeContact', label: '담당자' },
  { key: 'consigneeTel', label: '전화' },
  { key: 'consigneeFax', label: 'FAX' },
  { key: 'consigneeEmail', label: '이메일' },
  { key: 'countryOfManufacture', label: '제조국' },
  { key: 'consigneeAddress', label: '주소', wide: true },
];
const INVOICE_FIELDS: readonly InvoiceInput[] = [
  { key: 'invoiceNo', label: 'Invoice No.' },
  { key: 'currency', label: '통화', placeholder: 'KRW / USD / CNY' },
  { key: 'invoiceDate', label: '날짜', type: 'date' },
  { key: 'netWeight', label: '순중량(NET)', required: true, placeholder: '예: 17.05KG' },
  { key: 'grossWeight', label: '총중량(Gross)', required: true, placeholder: '예: 17.5KG' },
];
const FIELD_GROUPS = [
  { key: 'shipper', legend: '발송인 SHIPPER', fields: SHIPPER_FIELDS, cols: 'sm:grid-cols-2' },
  { key: 'consignee', legend: '수하인 CONSIGNEE', fields: CONSIGNEE_FIELDS, cols: 'sm:grid-cols-2' },
  { key: 'invoice', legend: '송장 정보', fields: INVOICE_FIELDS, cols: 'sm:grid-cols-3' },
] as const;
const setText = (key: InvoiceTextKey, value: string | number): void => {
  inv[key] = String(value);
};
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogScrollContent class="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{{ pt(title ?? '상업송장(Commercial Invoice) 생성') }}</DialogTitle>
        <DialogDescription>발주 스냅샷·사업자정보로 채운 초안을 고친 뒤 파일로 만들어 Invoice 로 첨부합니다.</DialogDescription>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            :disabled="busy !== '' || loading"
            :title="pt('편집 내용을 버리고 발주 품목·기준정보로 다시 채웁니다')"
            @click="refill"
          >
            <RefreshCwIcon />
            {{ pt('발주 데이터로 다시 채우기') }}
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="busy !== '' || loading"
            :title="pt('편집 내용만 보관합니다(파일 생성·첨부 없음) — 다음에 열면 이어서 작성')"
            @click="save"
          >
            <SaveIcon />
            {{ busy === 'save' ? pt('저장 중…') : pt('임시 저장') }}
          </Button>
          <Button variant="secondary" size="sm" :disabled="busy !== '' || loading" @click="genXlsx">
            <DownloadIcon />
            {{ busy === 'xlsx' ? pt('생성 중…') : pt('엑셀 다운로드') }}
          </Button>
          <Button
            v-if="attachXlsx !== undefined"
            size="sm"
            :disabled="busy !== '' || loading"
            :title="pt('엑셀 파일을 Invoice 로 첨부합니다 — 샘플피씨비가 내려받아 수정 후 재첨부할 수 있습니다.')"
            @click="genAttachXlsx"
          >
            <PaperclipIcon />
            {{ busy === 'xlsx' ? pt('생성 중…') : pt('엑셀 생성·첨부') }}
          </Button>
          <Button v-else-if="attachPdf !== undefined" size="sm" :disabled="busy !== '' || loading" @click="genPdf">
            <PaperclipIcon />
            {{ busy === 'pdf' ? pt('생성 중…') : pt('PDF 생성·첨부') }}
          </Button>
        </div>
      </DialogHeader>

      <p v-if="error !== ''" class="text-destructive text-sm font-medium" role="alert">{{ error }}</p>
      <p v-if="loading" class="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
        <Spinner />
        {{ pt('불러오는 중…') }}
      </p>

      <div v-else class="space-y-4">
        <Panel v-for="group in FIELD_GROUPS" :key="group.key" size="md">
          <FieldSet>
            <FieldLegend variant="label">{{ pt(group.legend) }}</FieldLegend>
            <div class="grid grid-cols-1 gap-3" :class="group.cols">
              <Field v-for="f in group.fields" :key="f.key" :class="f.wide === true ? 'sm:col-span-2' : ''">
                <FieldLabel :for="`inv-${f.key}`">
                  {{ pt(f.label) }}
                  <span v-if="f.note !== undefined" class="text-warning font-normal">{{ pt(f.note) }}</span>
                  <span v-if="f.required === true" class="text-warning">*</span>
                </FieldLabel>
                <Input
                  :id="`inv-${f.key}`"
                  :model-value="inv[f.key]"
                  :type="f.type ?? 'text'"
                  :placeholder="f.placeholder === undefined ? undefined : pt(f.placeholder)"
                  @update:model-value="(value: string | number) => setText(f.key, value)"
                />
              </Field>
            </div>
          </FieldSet>
        </Panel>

        <Panel size="md">
          <FieldSet>
            <FieldLegend variant="label">{{ pt('품목') }}</FieldLegend>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ pt('DESCRIPTION') }}</TableHead>
                  <TableHead class="w-28">{{ pt('HS CODE') }} <span class="text-warning">*</span></TableHead>
                  <TableHead class="w-20">{{ pt('수량') }}</TableHead>
                  <TableHead class="w-28">{{ pt('단가') }}</TableHead>
                  <TableHead class="w-28 text-right">{{ pt('금액') }}</TableHead>
                  <TableHead class="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="(it, i) in inv.items" :key="i">
                  <TableCell>
                    <Input
                      :model-value="it.description"
                      :aria-label="pt('DESCRIPTION')"
                      @update:model-value="(value: string | number) => (it.description = String(value))"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      :model-value="it.hsCode"
                      class="text-center"
                      :aria-label="pt('HS CODE')"
                      @update:model-value="(value: string | number) => (it.hsCode = String(value))"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      :model-value="it.qty"
                      class="text-center"
                      :aria-label="pt('수량')"
                      @update:model-value="(value: string | number) => (it.qty = String(value))"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      :model-value="it.unitValue ?? ''"
                      type="number"
                      step="0.01"
                      class="text-right"
                      :aria-label="pt('단가')"
                      @update:model-value="(value: string | number) => setUnitValue(it, value)"
                    />
                  </TableCell>
                  <TableCell class="text-right tabular-nums">{{ fmtMoney(rowTotal(it)) }}</TableCell>
                  <TableCell class="text-center">
                    <Button variant="ghost" size="icon-sm" :aria-label="pt('품목 삭제')" @click="removeItem(i)">
                      <XIcon />
                    </Button>
                  </TableCell>
                </TableRow>
                <TableEmptyRow v-if="inv.items.length === 0" :colspan="6" :text="pt('품목이 없습니다.')" />
              </TableBody>
            </Table>
            <div class="flex items-center justify-between">
              <Button variant="ghost" size="sm" @click="addItem">{{ pt('+ 품목 추가') }}</Button>
              <span class="text-sm font-semibold tabular-nums">
                {{ pt('합계: {p0} {p1}', { p0: inv.currency, p1: fmtMoney(grandTotal()) }) }}
              </span>
            </div>
          </FieldSet>
        </Panel>

        <p class="text-warning text-xs">
          {{ pt('* HS CODE·순중량·총중량은 직접 입력하세요.') }}
          <span v-if="attachXlsx === undefined">{{ pt('PDF는 아래 미리보기를 그대로 캡처합니다.') }}</span>
        </p>
        <!-- 첨부 경로는 갈래마다 다르다 — 안내가 없는 버튼을 가리키면 사용자는 "첨부했는데 안 붙었다"로
             읽는다(PCB 는 엑셀-온리, BOM 은 PDF). -->
        <p v-if="attachXlsx !== undefined" class="text-muted-foreground text-xs">
          {{ pt('[임시 저장]은 편집 내용만 보관합니다 — 선적 서류로 첨부하려면') }}
          <b class="text-foreground">{{ pt('[엑셀 생성·첨부]') }}</b>{{ pt('를 눌러 주세요([엑셀 다운로드]는 내려받기만 합니다).') }}
        </p>
        <p v-else class="text-muted-foreground text-xs">
          {{ pt('[임시 저장]은 편집 내용만 보관합니다 — 선적 서류로 첨부하려면') }}
          <b class="text-foreground">{{ pt('[PDF 생성·첨부]') }}</b>{{ pt('를 눌러 주세요(엑셀은 다운로드 전용).') }}
        </p>

        <!-- 미리보기(PDF 캡처 대상) — 흰 문서 고정. 캡처 대상은 문서 폭(760px)에 딱 맞는 감싸개다. -->
        <div>
          <p class="text-muted-foreground mb-1 text-xs">{{ pt('미리보기') }}</p>
          <div class="overflow-x-auto rounded-md border">
            <div ref="previewEl" class="mx-auto w-fit">
              <InvoicePreviewDoc :inv="inv" :row-total="rowTotal" :grand-total="grandTotal()" :fmt-money="fmtMoney" />
            </div>
          </div>
        </div>
      </div>
    </DialogScrollContent>
  </Dialog>
</template>
