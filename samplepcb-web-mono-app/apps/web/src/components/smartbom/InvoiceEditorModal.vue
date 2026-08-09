<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { BomInvoiceDataType, BomInvoiceItemType } from '@sp/api-contract';
import { confirmDialog } from '../../lib/confirmDialog';

// 상업송장(Commercial Invoice) 편집·생성 모달(D23) — 레거시 InvoiceEditorModal 이식.
// 자동 초안(발주 스냅샷·사업자정보)을 편집(HS CODE·중량·주소는 직접 입력) 후
// PDF(미리보기 DOM 캡처 — jspdf/html2canvas 지연 로딩)로 만들어 Invoice 로 자동
// 첨부하거나, 엑셀(서버 렌더)로 내려받는다. 포털·관리자 공용 — API 는 콜백 주입.

const props = defineProps<{
  open: boolean;
  loadDraft: (fresh: boolean) => Promise<BomInvoiceDataType>;
  saveDraft: (data: BomInvoiceDataType) => Promise<unknown>;
  renderXlsx: (data: BomInvoiceDataType) => Promise<Blob>;
  attachPdf: (file: File) => Promise<unknown>;
}>();
const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const busy = ref<'' | 'xlsx' | 'pdf' | 'save'>('');
const error = ref('');
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

async function load(fresh: boolean): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    Object.assign(inv, blank(), await props.loadDraft(fresh));
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '인보이스 정보를 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void load(false);
  },
);

// [발주 품목으로 다시 채우기] — 저장본이 자동 조립을 가리는 레거시 함정의 교정 버튼.
async function refill(): Promise<void> {
  if (
    !(await confirmDialog({
      message: '편집 중인 내용을 버리고 발주 데이터로 다시 채울까요?',
      confirmLabel: '다시 채우기',
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
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    error.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}

// 엑셀 — 서버 렌더(저장 겸) → 로컬 다운로드(첨부는 PDF 몫).
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
    error.value = e instanceof ApiRequestError ? e.message : '엑셀 생성에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}

// PDF — 편집본 저장 후 미리보기 DOM 캡처(A4 세로, 초과분 페이지 분할) → Invoice 첨부.
async function genPdf(): Promise<void> {
  if (busy.value !== '' || previewEl.value === null) return;
  busy.value = 'pdf';
  error.value = '';
  try {
    await props.saveDraft(buildPayload());
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
      import('jspdf'),
      import('html2canvas-pro'),
    ]);
    const canvas = await html2canvas(previewEl.value, { scale: 2, backgroundColor: '#ffffff' });
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
    await props.attachPdf(new File([blob], `${fileBase()}.pdf`, { type: 'application/pdf' }));
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : 'PDF 생성에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 py-6 px-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-4xl rounded-2xl bg-surface shadow-2xl">
      <div class="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
        <h2 class="text-sm font-bold">상업송장(Commercial Invoice) 생성</h2>
        <button
          type="button"
          class="ml-auto rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="busy !== '' || loading"
          title="편집 내용을 버리고 발주 품목·기준정보로 다시 채웁니다"
          @click="refill"
        >
          발주 데이터로 다시 채우기
        </button>
        <button
          type="button"
          class="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          :disabled="busy !== '' || loading"
          title="편집 내용만 보관합니다(파일 생성·첨부 없음) — 다음에 열면 이어서 작성"
          @click="save"
        >
          {{ busy === 'save' ? '저장 중…' : '임시 저장' }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="busy !== '' || loading"
          @click="genXlsx"
        >
          {{ busy === 'xlsx' ? '생성 중…' : '엑셀 다운로드' }}
        </button>
        <button
          type="button"
          class="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-40"
          :disabled="busy !== '' || loading"
          @click="genPdf"
        >
          {{ busy === 'pdf' ? '생성 중…' : 'PDF 생성·첨부' }}
        </button>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>

      <p v-if="error !== ''" class="px-5 pt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <p v-if="loading" class="px-5 py-16 text-center text-sm text-gray-400">불러오는 중…</p>

      <div v-else class="max-h-[78vh] overflow-y-auto">
        <div class="space-y-3 p-4">
          <fieldset class="rounded-xl border border-gray-200 p-3">
            <legend class="px-1 text-xs font-bold text-emerald-700">발송인 SHIPPER</legend>
            <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
              <label class="col-span-2">회사명(문서 헤더)
                <input v-model="inv.companyName" class="inv-in"></label>
              <label>담당자
                <input v-model="inv.shipperName" class="inv-in"></label>
              <label>전화
                <input v-model="inv.shipperTel" class="inv-in"></label>
              <label class="col-span-2">주소 <span class="text-amber-600">(직접 입력)</span>
                <input v-model="inv.shipperAddress" class="inv-in"></label>
              <label>원산지국
                <input v-model="inv.countryOfOrigin" class="inv-in"></label>
              <label>목적지국
                <input v-model="inv.countryOfDestination" class="inv-in"></label>
            </div>
          </fieldset>

          <fieldset class="rounded-xl border border-gray-200 p-3">
            <legend class="px-1 text-xs font-bold text-amber-700">수하인 CONSIGNEE</legend>
            <div class="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
              <label>회사명
                <input v-model="inv.consigneeCompany" class="inv-in"></label>
              <label>담당자
                <input v-model="inv.consigneeContact" class="inv-in"></label>
              <label>전화
                <input v-model="inv.consigneeTel" class="inv-in"></label>
              <label>FAX
                <input v-model="inv.consigneeFax" class="inv-in"></label>
              <label>이메일
                <input v-model="inv.consigneeEmail" class="inv-in"></label>
              <label>제조국
                <input v-model="inv.countryOfManufacture" class="inv-in"></label>
              <label class="col-span-2">주소
                <input v-model="inv.consigneeAddress" class="inv-in"></label>
            </div>
          </fieldset>

          <fieldset class="rounded-xl border border-gray-200 p-3">
            <legend class="px-1 text-xs font-bold text-indigo-700">송장 정보</legend>
            <div class="grid grid-cols-3 gap-2 text-[11px] text-gray-600">
              <label>Invoice No.
                <input v-model="inv.invoiceNo" class="inv-in"></label>
              <label>통화
                <input v-model="inv.currency" class="inv-in" placeholder="KRW / USD / CNY"></label>
              <label>날짜
                <input v-model="inv.invoiceDate" type="date" class="inv-in"></label>
              <label>순중량(NET) <span class="text-amber-600">*</span>
                <input v-model="inv.netWeight" placeholder="예: 17.05KG" class="inv-in"></label>
              <label>총중량(Gross) <span class="text-amber-600">*</span>
                <input v-model="inv.grossWeight" placeholder="예: 17.5KG" class="inv-in"></label>
            </div>
          </fieldset>

          <fieldset class="rounded-xl border border-gray-200 p-3">
            <legend class="px-1 text-xs font-bold text-violet-700">품목</legend>
            <table class="w-full text-[11px]">
              <thead>
                <tr class="text-gray-500">
                  <th class="pb-1 text-left font-medium">DESCRIPTION</th>
                  <th class="w-24 pb-1 font-medium">HS CODE <span class="text-amber-600">*</span></th>
                  <th class="w-16 pb-1 font-medium">수량</th>
                  <th class="w-24 pb-1 font-medium">단가</th>
                  <th class="w-24 pb-1 text-right font-medium">금액</th>
                  <th class="w-6" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(it, i) in inv.items" :key="i">
                  <td class="py-0.5 pr-1"><input v-model="it.description" class="inv-in"></td>
                  <td class="px-1 py-0.5"><input v-model="it.hsCode" class="inv-in text-center"></td>
                  <td class="px-1 py-0.5"><input v-model="it.qty" class="inv-in text-center"></td>
                  <td class="px-1 py-0.5"><input v-model.number="it.unitValue" type="number" step="0.01" class="inv-in text-right"></td>
                  <td class="px-1 py-0.5 text-right tabular-nums">{{ fmtMoney(rowTotal(it)) }}</td>
                  <td class="text-center">
                    <button type="button" class="text-gray-400 hover:text-red-600" @click="removeItem(i)">✕</button>
                  </td>
                </tr>
                <tr v-if="inv.items.length === 0">
                  <td colspan="6" class="py-2 text-center text-gray-400">품목이 없습니다.</td>
                </tr>
              </tbody>
            </table>
            <div class="mt-2 flex items-center justify-between">
              <button type="button" class="text-[11px] text-indigo-600 hover:underline" @click="addItem">+ 품목 추가</button>
              <span class="text-xs font-bold">합계: {{ inv.currency }} {{ fmtMoney(grandTotal()) }}</span>
            </div>
          </fieldset>

          <p class="text-[11px] text-amber-600">
            * HS CODE·순중량·총중량은 직접 입력하세요. PDF는 아래 미리보기를 그대로 캡처합니다.
          </p>
          <p class="text-[11px] text-gray-400">
            [임시 저장]은 편집 내용만 보관합니다 — 선적 서류로 첨부하려면
            <b class="text-rose-600">[PDF 생성·첨부]</b>를 눌러 주세요(엑셀은 다운로드 전용).
          </p>
        </div>

        <!-- 미리보기(PDF 캡처 대상) — 흰 문서 고정, 인라인 스타일(테마 무관) -->
        <div class="px-4 pb-5">
          <div class="mb-1 text-[11px] text-gray-400">미리보기</div>
          <div class="overflow-x-auto rounded border border-gray-200">
            <div
              ref="previewEl"
              style="width: 760px; margin: 0 auto; background: #fff; color: #111; padding: 24px; font-family: Arial, 'Malgun Gothic', sans-serif; font-size: 12px"
            >
              <div style="text-align: center; font-weight: 700; font-size: 14px; color: #333; padding-bottom: 6px; border-bottom: 1px solid #ccc">
                {{ inv.companyName || ' ' }}
              </div>
              <div style="text-align: center; font-weight: 800; font-size: 20px; letter-spacing: 1px; padding: 10px 0">
                COMMERCIAL INVOICE <span style="font-size: 14px">商业发票</span>
              </div>

              <table style="width: 100%; border-collapse: collapse; margin-top: 6px">
                <tr>
                  <td style="width: 62%; vertical-align: top; border: 1px solid #ccc; padding: 6px">
                    <div style="font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px">SHIPPER 寄货人</div>
                    <div><b>{{ inv.companyName }}</b></div>
                    <div>{{ inv.shipperName }}</div>
                    <div style="color: #333">{{ inv.shipperAddress }}</div>
                    <div>TEL: {{ inv.shipperTel }}</div>
                  </td>
                  <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
                    <div>COUNTRY OF ORIGINAL 发件地国家</div>
                    <div style="font-weight: 700; margin-bottom: 6px">{{ inv.countryOfOrigin }}</div>
                    <div>COUNTRY OF DESTINATION 目的地国家</div>
                    <div style="font-weight: 700">{{ inv.countryOfDestination }}</div>
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
                    <div style="font-weight: 700; font-size: 11px; color: #555; margin-bottom: 3px">CONSIGNEE 收货人</div>
                    <div><b>{{ inv.consigneeCompany }}</b></div>
                    <div>{{ inv.consigneeContact }}</div>
                    <div style="color: #333">{{ inv.consigneeAddress }}</div>
                    <div>TEL: {{ inv.consigneeTel }} &nbsp; FAX: {{ inv.consigneeFax }}</div>
                    <div>EMAIL: {{ inv.consigneeEmail }}</div>
                  </td>
                  <td style="vertical-align: top; border: 1px solid #ccc; padding: 6px">
                    <div>Invoice No.: <b>{{ inv.invoiceNo }}</b></div>
                    <div>Manufacture 原产国: {{ inv.countryOfManufacture }}</div>
                    <div>Date 日期: {{ inv.invoiceDate }}</div>
                    <div>NET 净重: {{ inv.netWeight }}</div>
                    <div>Gross 毛重: {{ inv.grossWeight }}</div>
                  </td>
                </tr>
              </table>

              <table style="width: 100%; border-collapse: collapse; margin-top: 8px">
                <thead>
                  <tr style="background: #eee">
                    <th style="border: 1px solid #ccc; padding: 4px; text-align: left">DESCRIPTION 品名</th>
                    <th style="border: 1px solid #ccc; padding: 4px">HS CODE</th>
                    <th style="border: 1px solid #ccc; padding: 4px">NO.OF UNIT</th>
                    <th style="border: 1px solid #ccc; padding: 4px">CUR</th>
                    <th style="border: 1px solid #ccc; padding: 4px">UNIT VALUE</th>
                    <th style="border: 1px solid #ccc; padding: 4px">TOTAL VALUE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in inv.items" :key="i">
                    <td style="border: 1px solid #ccc; padding: 4px">{{ it.description }}</td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.hsCode }}</td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.qty }}</td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: center">{{ it.currency }}</td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: right">{{ it.unitValue != null ? fmtMoney(it.unitValue) : '' }}</td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: right">{{ fmtMoney(rowTotal(it)) }}</td>
                  </tr>
                  <tr>
                    <td colspan="5" style="border: 1px solid #ccc; padding: 4px; text-align: right; font-weight: 700">
                      Total Value 总申报价值 ({{ inv.currency }})
                    </td>
                    <td style="border: 1px solid #ccc; padding: 4px; text-align: right; font-weight: 700">{{ fmtMoney(grandTotal()) }}</td>
                  </tr>
                </tbody>
              </table>

              <div style="margin-top: 16px; display: flex; justify-content: space-between; color: #333">
                <div>Signature / Title 寄货人签署 / 职位 : ____________</div>
                <div>Date 日期 : {{ inv.invoiceDate }}</div>
              </div>
              <div style="margin-top: 10px; color: #333">Company Stamp 公司印章 :</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inv-in {
  margin-top: 2px;
  height: 30px;
  width: 100%;
  border-radius: 6px;
  border: 1px solid rgb(229 231 235);
  padding: 0 8px;
  font-size: 11px;
}
</style>
