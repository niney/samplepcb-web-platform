<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DownloadIcon, PencilIcon, Trash2Icon, TriangleAlertIcon, UploadIcon, XIcon } from '@lucide/vue';
import { fmtKstDate, kstDateInput, kstToday } from '@sp/utils';
import {
  downloadRemittanceFile,
  useAdminPcbRemittanceDetail,
  useCreatePcbRemittance,
  useDeletePcbRemittance,
  useDeleteRemittanceFile,
  usePatchPcbRemittance,
  useUploadRemittanceFile,
} from '@/admin/useAdminPcbRemittances';
import { fetchPcbExchangeRate } from '@/admin/pcbExchangeRate';
import { fmtPcbAmount } from '@/lib/pcb-money';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { Spinner } from '@/next/components/ui/spinner';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import { pcbRemittanceStatusBadge } from './remittance/remittance-badges';

// 발주서 1건의 송금 원장 — 워크큐(목록)와 Case 상세가 같은 패널을 쓴다(옛 PcbRemittancePanel 포트,
// props·emits 동일). 창구는 여럿, 원장·잔액 계산은 하나다(서버 summarizePcbRemittances 가 정본).
// 호출부가 v-if 로 띄우고 close 로 내린다(열린 채로 마운트된다).
const props = defineProps<{ poId: number }>();
const emit = defineEmits<{ close: [] }>();

const poIdRef = computed<number | null>(() => props.poId);
const detail = useAdminPcbRemittanceDetail(poIdRef);
const data = computed(() => detail.data.value?.data ?? null);
const summary = computed(() => data.value?.summary ?? null);
const rows = computed(() => data.value?.remittances ?? []);
type LedgerRow = (typeof rows.value)[number];

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// ── 무상 A/S 회차 — 지급 대상이 아니다 ──────────────────────────────────────
// 서버가 목록과 같은 판정을 내려 준다. 화면은 잔액을 프리필하지 않고 기록 버튼도 기본으로 잠근다
// (그 숫자가 곧 오지급 버튼이 된다) — 오기록 정정 같은 예외는 체크로 명시할 때만.
const isFreeAs = computed(() => data.value?.isFreeAs ?? false);
const freeAsUnlocked = ref(false);
watch(isFreeAs, () => {
  freeAsUnlocked.value = false;
});

const createMut = useCreatePcbRemittance();
const patchMut = usePatchPcbRemittance();
const deleteMut = useDeletePcbRemittance();
const uploadMut = useUploadRemittanceFile();
const deleteFileMut = useDeleteRemittanceFile();

const error = ref('');
const surface = (e: unknown, fallback: string): void => {
  error.value = e instanceof Error && e.message !== '' ? e.message : fallback;
};

// ── 새 송금 입력 — 잔액을 기본값으로 채운다(대개 남은 만큼 보낸다) ─────────────
const isForeign = computed(() => (summary.value?.currency ?? 'KRW') !== 'KRW');
const formOn = ref(kstToday());
const formAmount = ref('');
const formRate = ref('');
const formRateDate = ref<string | null>(null);
const formRateIsAuto = ref(false);
const formRateLoading = ref(false);
const formRateError = ref('');
const formMemo = ref('');
let formRateRequest = 0;

watch(
  data,
  (d) => {
    if (d === null || d.isFreeAs) return;
    if (formAmount.value === '') {
      formAmount.value = d.summary.balance > 0 ? String(d.summary.balance) : '';
    }
  },
  { immediate: true },
);

const rateCurrency = computed<'USD' | 'CNY' | null>(() => {
  const currency = summary.value?.currency;
  return currency === 'USD' || currency === 'CNY' ? currency : null;
});
const isTodayRemittance = computed(() => formOn.value === kstToday());

/**
 * 당일 TTS 를 새 송금의 제안값으로 채운다. 늦은 응답은 수동 입력·다른 발주를 덮지 않는다.
 * 과거·미래 송금일에는 최신 캐시를 실제 시점 환율인 것처럼 붙이지 않고 직접 입력을 요구한다.
 */
async function prefillFormRate(force = false): Promise<void> {
  const request = ++formRateRequest;
  const currency = rateCurrency.value;
  const remittedOn = formOn.value;
  formRateError.value = '';

  if (currency === null || remittedOn !== kstToday()) {
    if (formRateIsAuto.value) formRate.value = '';
    formRateIsAuto.value = false;
    formRateDate.value = null;
    formRateLoading.value = false;
    return;
  }
  if (!force && formRate.value.trim() !== '' && !formRateIsAuto.value) return;

  formRateLoading.value = true;
  try {
    const result = await fetchPcbExchangeRate(currency);
    if (request !== formRateRequest || rateCurrency.value !== currency || formOn.value !== remittedOn) {
      return;
    }
    if (result === null) {
      if (formRateIsAuto.value) formRate.value = '';
      formRateIsAuto.value = false;
      formRateDate.value = null;
      formRateError.value = '자동 환율이 준비되지 않았습니다. 적용 환율을 직접 입력해 주세요.';
      return;
    }
    formRate.value = String(result.rate);
    formRateDate.value = result.rateDate;
    formRateIsAuto.value = true;
  } catch (e) {
    if (request !== formRateRequest) return;
    if (formRateIsAuto.value) formRate.value = '';
    formRateIsAuto.value = false;
    formRateDate.value = null;
    formRateError.value =
      e instanceof Error && e.message !== ''
        ? e.message
        : '자동 환율 조회에 실패했습니다. 적용 환율을 직접 입력해 주세요.';
  } finally {
    if (request === formRateRequest) formRateLoading.value = false;
  }
}

watch(
  [rateCurrency, formOn],
  () => {
    void prefillFormRate();
  },
  { immediate: true },
);

function onFormRateInput(value: string | number): void {
  formRate.value = String(value);
  // 진행 중 자동 조회를 무효화해 늦은 응답이 방금 친 숫자를 덮지 않게 한다.
  formRateRequest += 1;
  formRateLoading.value = false;
  formRateError.value = '';
  formRateDate.value = null;
  formRateIsAuto.value = false;
}

const amountNum = computed(() => Number(formAmount.value.replaceAll(',', '').trim()));
const formRateNum = computed(() => {
  const raw = formRate.value.replaceAll(',', '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
});
/** 외화 환율 누락은 회계 합계에서 행을 사라지게 하므로 신규 기록을 막는다. */
const rateMissingWarn = computed(
  () => isForeign.value && formRateNum.value === null && Number.isFinite(amountNum.value) && amountNum.value > 0,
);
const formKrwPreview = computed(() => {
  const amount = amountNum.value;
  const rate = formRateNum.value;
  return isForeign.value && Number.isFinite(amount) && amount > 0 && rate !== null
    ? Math.round(amount * rate)
    : null;
});
/** 잔액 초과 = 과지급. 감추지 않되 손이 미끄러진 것인지 한 번 묻는다. */
const willOverpay = computed(
  () => summary.value !== null && Number.isFinite(amountNum.value) && amountNum.value > summary.value.balance + 0.005,
);

const canSubmit = computed(() => {
  const n = amountNum.value;
  if (isFreeAs.value && !freeAsUnlocked.value) return false;
  if (isForeign.value && formRateNum.value === null) return false;
  return Number.isFinite(n) && n > 0 && formOn.value !== '' && !createMut.isPending.value;
});

async function submitNew(): Promise<void> {
  if (!canSubmit.value) return;
  const amount = amountNum.value;
  const s = summary.value;
  if (
    willOverpay.value &&
    s !== null &&
    !(await confirmDialog({
      title: '잔액 초과(과지급)',
      message:
        `잔액 ${fmtPcbAmount(s.currency, s.balance)} 보다 큰 ${fmtPcbAmount(s.currency, amount)} 를 기록합니다.\n` +
        '초과분은 과지급으로 남습니다 — 그대로 기록할까요?',
      confirmLabel: '과지급으로 기록',
    }))
  ) {
    return;
  }
  error.value = '';
  const rate = formRateNum.value;
  if (isForeign.value && rate === null) return;
  try {
    await createMut.mutateAsync({
      poId: props.poId,
      body: {
        remittedOn: formOn.value,
        amount,
        ...(isForeign.value && rate !== null ? { exchangeRate: rate } : {}),
        ...(formMemo.value.trim() === '' ? {} : { memo: formMemo.value.trim() }),
      },
    });
    formAmount.value = '';
    formRate.value = '';
    formRateDate.value = null;
    formRateIsAuto.value = false;
    formMemo.value = '';
    formOn.value = kstToday();
    void prefillFormRate(true);
  } catch (e) {
    surface(e, '송금 기록에 실패했습니다.');
  }
}

// ── 기존 행 수정 — 환율까지 고칠 수 있다(지우고 다시 기록하지 않게) ──────────────
const editId = ref<number | null>(null);
const editOn = ref('');
const editAmount = ref('');
const editRate = ref('');
const editMemo = ref('');
const editAmountNum = computed(() => Number(editAmount.value.replaceAll(',', '').trim()));
const editRateNum = computed(() => {
  const raw = editRate.value.replaceAll(',', '').trim();
  if (raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
});
const editCanSubmit = computed(() => {
  if (!Number.isFinite(editAmountNum.value) || editAmountNum.value <= 0 || editOn.value === '') {
    return false;
  }
  if (isForeign.value && editRateNum.value === null) return false;
  return !patchMut.isPending.value;
});

function startEdit(r: LedgerRow): void {
  editId.value = r.id;
  editOn.value = kstDateInput(r.remittedOn);
  editAmount.value = String(r.amount);
  editRate.value = r.exchangeRate === null ? '' : String(r.exchangeRate);
  editMemo.value = r.memo ?? '';
}
async function submitEdit(): Promise<void> {
  if (editId.value === null || !editCanSubmit.value) return;
  error.value = '';
  const rate = editRateNum.value;
  try {
    await patchMut.mutateAsync({
      poId: props.poId,
      remittanceId: editId.value,
      body: {
        remittedOn: editOn.value,
        amount: editAmountNum.value,
        ...(isForeign.value && rate !== null ? { exchangeRate: rate } : {}),
        memo: editMemo.value.trim() === '' ? null : editMemo.value.trim(),
      },
    });
    editId.value = null;
  } catch (e) {
    surface(e, '수정에 실패했습니다.');
  }
}

// 삭제는 되돌릴 수 없다 — 원장 행이 사라지면 잔액이 도로 늘고, 붙어 있던 증빙은 파일서버에서
// 실제로 지워진다. 형제 패널(A/S·배송)과 같은 규율로 한 번 묻는다.
async function removeRow(r: LedgerRow): Promise<void> {
  const fileNote =
    r.files.length === 0 ? '' : `\n첨부된 증빙 ${String(r.files.length)}건도 파일서버에서 함께 삭제됩니다(복구 불가).`;
  const ok = await confirmDialog({
    title: '송금 기록 삭제',
    message:
      `${fmtKstDate(r.remittedOn)} · ${fmtPcbAmount(r.currency, r.amount)} 기록을 삭제할까요?\n` +
      `삭제하면 미지급 잔액이 그만큼 다시 늘어납니다.${fileNote}`,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  error.value = '';
  try {
    await deleteMut.mutateAsync({ poId: props.poId, remittanceId: r.id });
  } catch (e) {
    surface(e, '삭제에 실패했습니다.');
  }
}

async function removeFile(remittanceId: number, file: { fileId: number; name: string }): Promise<void> {
  const ok = await confirmDialog({
    title: '증빙 삭제',
    message: `'${file.name}' 을(를) 삭제할까요?\n파일서버에서 실제로 지워지며 되돌릴 수 없습니다.`,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  error.value = '';
  try {
    await deleteFileMut.mutateAsync({ poId: props.poId, remittanceId, fileId: file.fileId });
  } catch (e) {
    surface(e, '증빙 삭제에 실패했습니다.');
  }
}

// ── 증빙(이체 확인증) ───────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null);
const uploadTargetId = ref<number | null>(null);

function pickFile(remittanceId: number): void {
  uploadTargetId.value = remittanceId;
  fileInput.value?.click();
}
async function onFilePicked(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const remittanceId = uploadTargetId.value;
  input.value = '';
  if (file === undefined || remittanceId === null) return;
  error.value = '';
  try {
    await uploadMut.mutateAsync({ poId: props.poId, remittanceId, file });
  } catch (err) {
    surface(err, '증빙 업로드에 실패했습니다.');
  }
}

// ── 원장 실지급 KRW 와 환차(외화 발주만) ─────────────────────────────────────
// 요약 3칸은 전부 외화라 통장에서 나간 원화가 따로 필요하다. 발주 회계는 발주 시점 환율 1개로
// 박제되고 송금은 건마다 실환율이라 두 값은 다르며, 그 차이가 환차손익이다. 환율을 안 적은 건은
// 합계에서 빠지므로 함께 밝힌다.
const isRateLess = (r: LedgerRow): boolean => r.currency !== 'KRW' && r.exchangeRate === null;
const rateLessCount = computed(() => rows.value.filter(isRateLess).length);
const ledgerKrw = computed(() => rows.value.reduce((sum, r) => sum + (r.krwAmount ?? 0), 0));
/** 발주 회계 환율 = 발주 KRW 박제 ÷ 발주가. */
const poRate = computed(() => {
  const d = data.value;
  if (d?.poKrwAmount === undefined || d.poKrwAmount === null || d.summary.poAmount === 0) return null;
  return d.poKrwAmount / d.summary.poAmount;
});
/** 환차 = 원장 실지급 − (지급 외화 × 발주 회계 환율). 미기입 건이 섞이면 계산하지 않는다. */
const fxDiff = computed(() => {
  const s = summary.value;
  const rate = poRate.value;
  if (s === null || rate === null || rateLessCount.value > 0 || s.paidAmount === 0) return null;
  return Math.round(ledgerKrw.value - s.paidAmount * rate);
});

const text = (value: string | number): string => String(value);
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogDescription>
          <span class="text-primary text-xs font-semibold tracking-wider">송금 원장</span>
        </DialogDescription>
        <DialogTitle>
          <span class="inline-flex flex-wrap items-baseline gap-x-2">
            {{ data?.projectName ?? '…' }}
            <span class="text-muted-foreground text-sm font-normal">{{ data?.partnerName ?? '' }}</span>
          </span>
        </DialogTitle>
      </DialogHeader>

      <DialogScrollBody>
        <div class="space-y-4">
          <!-- 무상 A/S 회차 — 발주가는 원가 회계 참고일 뿐 지급 대상이 아니다 -->
          <Alert v-if="isFreeAs" variant="success" size="sm">
            <AlertTitle>무상 A/S 재생산 — 지급 대상이 아님</AlertTitle>
            <AlertDescription>
              <p>발주가는 원가 회계용 복사본이고 잔액은 0 입니다. 기록이 꼭 필요하면 아래를 체크해 주세요.</p>
              <div class="mt-1.5 flex items-center gap-2">
                <Checkbox
                  id="remit-free-as-unlock"
                  :model-value="freeAsUnlocked"
                  @update:model-value="freeAsUnlocked = $event === true"
                />
                <Label for="remit-free-as-unlock">그래도 송금을 기록합니다(예: 오기록 정정)</Label>
              </div>
            </AlertDescription>
          </Alert>

          <!-- 지급 요약 3칸 — 잔액이 이 화면의 결론이다 -->
          <div v-if="summary !== null" class="grid grid-cols-3 gap-2">
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">발주가</p>
              <p class="mt-1 font-semibold tabular-nums">{{ fmtPcbAmount(summary.currency, summary.poAmount) }}</p>
            </Panel>
            <Panel muted class="text-center">
              <p class="text-muted-foreground text-xs">송금 합계</p>
              <p class="mt-1 font-semibold tabular-nums">
                {{ fmtPcbAmount(summary.currency, summary.paidAmount) }}
                <span class="text-muted-foreground text-xs font-normal">{{ summary.count }}회</span>
              </p>
            </Panel>
            <!-- 잔액 칸만 상태색(결론 칸) — 남았으면 오류, 다 냈으면 완료 -->
            <Panel class="text-center" :tone="summary.balance > 0 ? 'destructive' : 'success'">
              <p class="text-xs">미지급 잔액</p>
              <p class="mt-1 font-bold tabular-nums">{{ fmtPcbAmount(summary.currency, summary.balance) }}</p>
            </Panel>
          </div>

          <!-- 원장 실지급 KRW — 요약 3칸이 전부 외화라 통장에서 나간 원화를 따로 보인다 -->
          <p
            v-if="summary !== null && isForeign && summary.count > 0"
            class="bg-muted/40 text-muted-foreground rounded-lg px-3 py-1.5 text-center text-xs"
          >
            원장 실지급
            <span class="text-foreground font-semibold tabular-nums">{{ fmtPcbAmount('KRW', ledgerKrw) }}</span>
            <template v-if="fxDiff !== null">
              (환차 {{ fxDiff >= 0 ? '+' : '-' }}{{ fmtPcbAmount('KRW', Math.abs(fxDiff)) }} · 발주 회계 대비)
            </template>
            <span v-if="rateLessCount > 0" class="text-warning font-semibold">
              · 환율 미기입 {{ rateLessCount }}건 제외(환차 계산 불가)
            </span>
          </p>

          <p v-if="summary !== null" class="text-center">
            <Badge :variant="pcbRemittanceStatusBadge(summary.status).variant">
              {{ pcbRemittanceStatusBadge(summary.status).label }}
            </Badge>
          </p>

          <!-- 내역 -->
          <ul class="space-y-2">
            <li v-for="r in rows" :key="r.id">
              <Panel>
                <template v-if="editId === r.id">
                  <div class="grid gap-3 sm:grid-cols-2">
                    <div class="grid gap-1.5">
                      <Label :for="`remit-edit-on-${r.id}`">송금일</Label>
                      <Input
                        :id="`remit-edit-on-${r.id}`"
                        :model-value="editOn"
                        type="date"
                        @update:model-value="editOn = text($event)"
                      />
                    </div>
                    <div class="grid gap-1.5">
                      <Label :for="`remit-edit-amount-${r.id}`">금액 ({{ r.currency }})</Label>
                      <Input
                        :id="`remit-edit-amount-${r.id}`"
                        :model-value="editAmount"
                        type="text"
                        inputmode="decimal"
                        @update:model-value="editAmount = text($event)"
                      />
                    </div>
                    <div v-if="isForeign" class="grid gap-1.5 sm:col-span-2">
                      <Label :for="`remit-edit-rate-${r.id}`">적용 환율 (KRW 환산용) *</Label>
                      <Input
                        :id="`remit-edit-rate-${r.id}`"
                        :model-value="editRate"
                        type="text"
                        inputmode="decimal"
                        placeholder="송금 시점 실제 환율"
                        @update:model-value="editRate = text($event)"
                      />
                      <p v-if="editRateNum === null" class="text-warning text-xs font-medium">
                        외화 송금은 환율 없이 저장할 수 없습니다.
                      </p>
                    </div>
                    <div class="grid gap-1.5 sm:col-span-2">
                      <Label :for="`remit-edit-memo-${r.id}`">메모</Label>
                      <Input
                        :id="`remit-edit-memo-${r.id}`"
                        :model-value="editMemo"
                        type="text"
                        placeholder="메모 — 협력사 포털에 그대로 보입니다"
                        @update:model-value="editMemo = text($event)"
                      />
                    </div>
                  </div>
                  <div class="mt-3 flex justify-end gap-2">
                    <Button variant="outline" size="sm" @click="editId = null">취소</Button>
                    <Button size="sm" :disabled="!editCanSubmit" @click="void submitEdit()">
                      <Spinner v-if="patchMut.isPending.value" />
                      저장
                    </Button>
                  </div>
                </template>

                <template v-else>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="min-w-0 space-y-0.5">
                      <p class="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                        <span class="font-semibold tabular-nums">{{ fmtPcbAmount(r.currency, r.amount) }}</span>
                        <span class="text-muted-foreground text-xs">{{ fmtKstDate(r.remittedOn) }}</span>
                        <span v-if="r.krwAmount !== null && r.currency !== 'KRW'" class="text-muted-foreground text-xs tabular-nums">
                          ≈ {{ fmtPcbAmount('KRW', r.krwAmount) }}
                          <template v-if="r.exchangeRate !== null">@{{ r.exchangeRate }}</template>
                        </span>
                        <!-- 환율 미기입 — 왜 원화가 없는지를 말한다(원장 실지급·회계 리포트에서 빠진다) -->
                        <Badge
                          v-else-if="isRateLess(r)"
                          variant="warning"
                          title="환율이 없어 KRW 환산이 없습니다 — 원장 실지급 합계·회계 리포트에서 이 건이 빠집니다"
                        >
                          환율 미기입
                        </Badge>
                      </p>
                      <p v-if="r.memo !== null" class="text-muted-foreground truncate text-xs">{{ r.memo }}</p>
                      <p class="text-muted-foreground text-xs">기록 {{ r.createdBy }}</p>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Button variant="outline" size="sm" :disabled="uploadMut.isPending.value" @click="pickFile(r.id)">
                        <UploadIcon />
                        증빙
                      </Button>
                      <Button variant="ghost" size="sm" @click="startEdit(r)">
                        <PencilIcon />
                        수정
                      </Button>
                      <Button variant="ghost" size="sm" :disabled="deleteMut.isPending.value" @click="void removeRow(r)">
                        <Trash2Icon />
                        삭제
                      </Button>
                    </div>
                  </div>
                  <div v-if="r.files.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                    <ButtonGroup v-for="f in r.files" :key="f.fileId">
                      <Button
                        variant="outline"
                        size="xs"
                        :title="f.name"
                        @click="void downloadRemittanceFile(props.poId, r.id, f.fileId, f.name)"
                      >
                        <DownloadIcon />
                        <span class="max-w-48 truncate">{{ f.name }}</span>
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-xs"
                        title="증빙 삭제"
                        aria-label="증빙 삭제"
                        @click="void removeFile(r.id, f)"
                      >
                        <XIcon />
                      </Button>
                    </ButtonGroup>
                  </div>
                </template>
              </Panel>
            </li>
          </ul>
          <p v-if="rows.length === 0" class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
            <Spinner v-if="detail.isFetching.value" />
            {{ detail.isFetching.value ? '불러오는 중…' : '아직 송금 기록이 없습니다.' }}
          </p>

          <!-- 새 송금 -->
          <Panel class="space-y-3">
            <p class="text-info text-sm font-semibold">송금 기록 추가</p>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="grid gap-1.5">
                <Label for="remit-new-on">송금일</Label>
                <div class="flex gap-1">
                  <Input id="remit-new-on" :model-value="formOn" type="date" @update:model-value="formOn = text($event)" />
                  <Button variant="outline" @click="formOn = kstToday()">오늘</Button>
                </div>
              </div>
              <div class="grid gap-1.5">
                <Label for="remit-new-amount">
                  금액 ({{ summary?.currency ?? '—' }})
                  <span v-if="!isFreeAs && summary !== null && summary.balance > 0" class="text-muted-foreground font-normal">
                    잔액 기본값
                  </span>
                </Label>
                <Input
                  id="remit-new-amount"
                  :model-value="formAmount"
                  type="text"
                  inputmode="decimal"
                  @update:model-value="formAmount = text($event)"
                />
              </div>
              <div v-if="isForeign" class="grid gap-1.5">
                <div class="flex items-center justify-between gap-2">
                  <Label for="remit-new-rate">적용 환율 (KRW 환산용) *</Label>
                  <Button
                    v-if="isTodayRemittance"
                    variant="link"
                    size="xs"
                    :disabled="formRateLoading"
                    @click="void prefillFormRate(true)"
                  >
                    자동 환율
                  </Button>
                </div>
                <Input
                  id="remit-new-rate"
                  :model-value="formRate"
                  type="text"
                  inputmode="decimal"
                  placeholder="송금 시점 실제 환율"
                  @update:model-value="onFormRateInput"
                />
                <p v-if="formRateLoading" class="text-info flex items-center gap-1.5 text-xs">
                  <Spinner />
                  수출입은행 TTS 환율을 불러오는 중…
                </p>
                <p v-else-if="formRateIsAuto" class="text-success text-xs">
                  수출입은행 <template v-if="formRateDate !== null">{{ formRateDate }} </template>고시(송금 기준) 자동 반영 ·
                  실제 적용값으로 수정 가능
                </p>
                <p v-else-if="!isTodayRemittance" class="text-warning text-xs">
                  과거·미래 송금일에는 해당 시점의 실제 적용 환율을 직접 입력해 주세요.
                </p>
                <p v-else-if="formRateError !== ''" class="text-warning text-xs">{{ formRateError }}</p>
                <p v-else-if="formRateNum !== null" class="text-muted-foreground text-xs">관리자가 입력한 환율로 박제됩니다.</p>
              </div>
              <div class="grid gap-1.5" :class="isForeign ? '' : 'sm:col-span-2'">
                <Label for="remit-new-memo">
                  메모
                  <span class="text-warning font-normal">협력사에게 보입니다</span>
                </Label>
                <Input
                  id="remit-new-memo"
                  :model-value="formMemo"
                  type="text"
                  placeholder="선금 50% 등"
                  @update:model-value="formMemo = text($event)"
                />
              </div>
            </div>
            <p v-if="formKrwPreview !== null" class="text-muted-foreground text-right text-xs">
              예상 원화 환산
              <span class="text-foreground font-semibold tabular-nums">{{ fmtPcbAmount('KRW', formKrwPreview) }}</span>
            </p>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <!-- 환율 공란은 회계 합계에서 해당 행을 사라지게 하므로 신규 저장을 막는다. -->
              <p v-if="rateMissingWarn" class="text-warning flex items-center gap-1 text-xs font-medium">
                <TriangleAlertIcon class="size-3.5" />
                외화 송금은 적용 환율이 필요합니다.
              </p>
              <p v-if="willOverpay && summary !== null" class="text-destructive flex items-center gap-1 text-xs font-medium">
                <TriangleAlertIcon class="size-3.5" />
                잔액 {{ fmtPcbAmount(summary.currency, summary.balance) }} 초과 — 과지급으로 기록됩니다.
              </p>
              <Button
                :disabled="!canSubmit"
                :title="isFreeAs && !freeAsUnlocked ? '무상 A/S 회차 — 지급 대상이 아닙니다' : undefined"
                @click="void submitNew()"
              >
                <Spinner v-if="createMut.isPending.value" />
                기록
              </Button>
            </div>
          </Panel>

          <p v-if="error !== ''" role="alert" class="text-destructive text-sm font-medium">{{ error }}</p>
        </div>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">닫기</Button>
      </DialogFooter>

      <input ref="fileInput" type="file" class="hidden" @change="void onFilePicked($event)">
    </DialogContent>
  </Dialog>
</template>
