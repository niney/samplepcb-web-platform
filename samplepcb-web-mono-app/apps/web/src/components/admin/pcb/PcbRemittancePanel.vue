<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PCB_REMITTANCE_STATUS_LABELS, type PcbRemittanceStatusType } from '@sp/api-contract';
import { fmtKstDate, kstDateInput, kstToday } from '@sp/utils';
import {
  downloadRemittanceFile,
  useAdminPcbRemittanceDetail,
  useCreatePcbRemittance,
  useDeletePcbRemittance,
  useDeleteRemittanceFile,
  usePatchPcbRemittance,
  useUploadRemittanceFile,
} from '../../../admin/useAdminPcbRemittances';
import { fmtPcbAmount } from '../../../lib/pcb-money';
import { confirmDialog } from '../../../lib/confirmDialog';

// 발주서 1건의 송금 원장 — 워크큐(목록)와 Case 상세가 같은 패널을 쓴다.
// 창구는 여럿, 원장·잔액 계산은 하나다(서버 summarizePcbRemittances 가 정본).
const props = defineProps<{ poId: number }>();
const emit = defineEmits<{ close: [] }>();

const poIdRef = computed(() => props.poId);
const detail = useAdminPcbRemittanceDetail(poIdRef);
const data = computed(() => detail.data.value?.data ?? null);
const summary = computed(() => data.value?.summary ?? null);
const rows = computed(() => data.value?.remittances ?? []);

// ── 무상 A/S 회차 — 지급 대상이 아니다 ──────────────────────────────────────
// 목록은 잔액 0 으로 눕히는데 상세만 전액을 주던 탓에 이 패널이 무상 회차에 금액을
// 프리필했다(재점검 08-11 확정 #1). 지금은 서버가 같은 판정을 내려 주고, 화면은
// 프리필을 하지 않고 기록 버튼도 기본으로 잠근다 — 오기록 정정 같은 예외는 명시로만.
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
const formMemo = ref('');

watch(
  data,
  (d) => {
    // 무상 회차엔 줄 돈이 없다 — 잔액 프리필 금지(그 숫자가 곧 오지급 버튼이 된다).
    if (d === null || d.isFreeAs) return;
    if (formAmount.value === '') {
      formAmount.value = d.summary.balance > 0 ? String(d.summary.balance) : '';
    }
  },
  { immediate: true },
);

const amountNum = computed(() => Number(formAmount.value.replaceAll(',', '').trim()));
/** 외화인데 환율을 안 적었다 — 막지는 않지만(실무상 나중에 확정되는 값) 말은 해 준다. */
const rateMissingWarn = computed(
  () => isForeign.value && formRate.value.trim() === '' && Number.isFinite(amountNum.value) && amountNum.value > 0,
);
/** 잔액 초과 = 과지급. 감추지 않되 손이 미끄러진 것인지 한 번 묻는다. */
const willOverpay = computed(
  () =>
    summary.value !== null &&
    Number.isFinite(amountNum.value) &&
    amountNum.value > summary.value.balance + 0.005,
);

const canSubmit = computed(() => {
  const n = amountNum.value;
  if (isFreeAs.value && !freeAsUnlocked.value) return false;
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
  const rate = formRate.value.replaceAll(',', '').trim();
  try {
    await createMut.mutateAsync({
      poId: props.poId,
      body: {
        remittedOn: formOn.value,
        amount,
        ...(isForeign.value && rate !== '' ? { exchangeRate: Number(rate) } : {}),
        ...(formMemo.value.trim() === '' ? {} : { memo: formMemo.value.trim() }),
      },
    });
    formAmount.value = '';
    formRate.value = '';
    formMemo.value = '';
    formOn.value = kstToday();
  } catch (e) {
    surface(e, '송금 기록에 실패했습니다.');
  }
}

// ── 기존 행 수정 ────────────────────────────────────────────────────────────
// 환율도 고칠 수 있어야 한다 — 계약·서버(patchPcbRemittance)는 처음부터 받고 있었는데
// 입력 칸만 없어서, 환율을 잘못 적으면 지우고 다시 기록하는 수밖에 없었다(재점검 #4).
const editId = ref<number | null>(null);
const editOn = ref('');
const editAmount = ref('');
const editRate = ref('');
const editMemo = ref('');

function startEdit(r: (typeof rows.value)[number]): void {
  editId.value = r.id;
  editOn.value = kstDateInput(r.remittedOn);
  editAmount.value = String(r.amount);
  editRate.value = r.exchangeRate === null ? '' : String(r.exchangeRate);
  editMemo.value = r.memo ?? '';
}
async function submitEdit(): Promise<void> {
  if (editId.value === null) return;
  error.value = '';
  const rate = editRate.value.replaceAll(',', '').trim();
  try {
    await patchMut.mutateAsync({
      poId: props.poId,
      remittanceId: editId.value,
      body: {
        remittedOn: editOn.value,
        amount: Number(editAmount.value.replaceAll(',', '').trim()),
        // 외화만 의미가 있고, 비우면 **환산 해제**(null)로 서버가 krwAmount 를 지운다.
        ...(isForeign.value ? { exchangeRate: rate === '' ? null : Number(rate) } : {}),
        memo: editMemo.value.trim() === '' ? null : editMemo.value.trim(),
      },
    });
    editId.value = null;
  } catch (e) {
    surface(e, '수정에 실패했습니다.');
  }
}

// 삭제는 되돌릴 수 없다 — 원장 행이 사라지면 잔액이 도로 늘고, 붙어 있던 증빙은
// **파일서버에서 실제로** 지워진다. 형제 패널(A/S·배송)과 같은 규율로 한 번 묻는다(P4.11).
async function removeRow(r: (typeof rows.value)[number]): Promise<void> {
  const fileNote =
    r.files.length === 0
      ? ''
      : `\n첨부된 증빙 ${String(r.files.length)}건도 파일서버에서 함께 삭제됩니다(복구 불가).`;
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

const STATUS_CLS: Record<PcbRemittanceStatusType, string> = {
  unpaid: 'bg-gray-100 text-gray-600',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-700',
  over: 'bg-rose-100 text-rose-700',
};

// ── 원장 실지급 KRW 와 환차(외화 발주만) ─────────────────────────────────────
// 3칸 요약은 전부 외화(USD)라, 정작 통장에서 나간 원화가 이 화면 어디에도 없었다.
// 발주 회계는 **발주 시점 환율 1개**로 박제되고 송금은 건마다 실환율이라 두 값은 다르며,
// 그 차이가 곧 환차손익이다(재점검 #8). 환율을 안 적은 건은 합계에서 빠지므로 함께 밝힌다.
/** 환율이 없어 KRW 환산이 없는 외화 송금 건 — 배지·경고의 근거. */
const isRateLess = (r: (typeof rows.value)[number]): boolean =>
  r.currency !== 'KRW' && r.exchangeRate === null;
const rateLessCount = computed(() => rows.value.filter(isRateLess).length);
const ledgerKrw = computed(() => rows.value.reduce((sum, r) => sum + (r.krwAmount ?? 0), 0));
/** 발주 회계 환율 = 발주 KRW 박제 ÷ 발주가. 같은 외화를 회계 기준으로 환산할 때 쓴다. */
const poRate = computed(() => {
  const d = data.value;
  if (d?.poKrwAmount === undefined || d.poKrwAmount === null || d.summary.poAmount === 0) {
    return null;
  }
  return d.poKrwAmount / d.summary.poAmount;
});
/** 환차 = 원장 실지급 − (지급 외화 × 발주 회계 환율). 미기입 건이 섞이면 계산하지 않는다. */
const fxDiff = computed(() => {
  const s = summary.value;
  const rate = poRate.value;
  if (s === null || rate === null || rateLessCount.value > 0 || s.paidAmount === 0) return null;
  return Math.round(ledgerKrw.value - s.paidAmount * rate);
});
</script>

<template>
  <div class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-2xl overflow-hidden rounded-xl bg-surface shadow-xl">
      <header class="border-b border-gray-200 px-5 py-4">
        <p class="text-[11px] font-bold uppercase tracking-wider text-blue-600">송금 원장</p>
        <h3 class="mt-0.5 text-base font-bold text-gray-900">
          {{ data?.projectName ?? '…' }}
          <span class="ml-1 text-sm font-normal text-gray-500">{{ data?.partnerName ?? '' }}</span>
        </h3>
      </header>

      <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
        <!-- 무상 A/S 회차 — 발주가는 원가 회계 참고일 뿐 지급 대상이 아니다 -->
        <div v-if="isFreeAs" class="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <p class="text-sm font-bold text-emerald-800">무상 A/S 재생산 — 지급 대상이 아님</p>
          <p class="mt-0.5 text-xs text-emerald-700">
            발주가는 원가 회계용 복사본이고 잔액은 0 입니다. 기록이 꼭 필요하면 아래를 체크해 주세요.
          </p>
          <label class="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
            <input v-model="freeAsUnlocked" type="checkbox" class="size-3.5 accent-emerald-600">
            그래도 송금을 기록합니다(예: 오기록 정정)
          </label>
        </div>

        <!-- 지급 요약 3칸 — 잔액이 이 화면의 결론이다 -->
        <div v-if="summary !== null" class="grid grid-cols-3 gap-2">
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
            <p class="text-[11px] text-gray-500">발주가</p>
            <p class="mt-1 font-bold tabular-nums text-gray-900">
              {{ fmtPcbAmount(summary.currency, summary.poAmount) }}
            </p>
          </div>
          <div class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
            <p class="text-[11px] text-gray-500">송금 합계</p>
            <p class="mt-1 font-bold tabular-nums text-gray-900">
              {{ fmtPcbAmount(summary.currency, summary.paidAmount) }}
              <span class="text-[11px] font-normal text-gray-400">{{ summary.count }}회</span>
            </p>
          </div>
          <div
            class="rounded-lg border p-3 text-center"
            :class="summary.balance > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'"
          >
            <p class="text-[11px]" :class="summary.balance > 0 ? 'text-rose-600' : 'text-emerald-700'">
              미지급 잔액
            </p>
            <p
              class="mt-1 font-extrabold tabular-nums"
              :class="summary.balance > 0 ? 'text-rose-700' : 'text-emerald-800'"
            >
              {{ fmtPcbAmount(summary.currency, summary.balance) }}
            </p>
          </div>
        </div>
        <!-- 원장 실지급 KRW — 3칸이 전부 외화라 정작 통장에서 나간 원화가 없었다 -->
        <p
          v-if="summary !== null && isForeign && (summary.count > 0)"
          class="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-center text-xs text-gray-600"
        >
          원장 실지급 <b class="tabular-nums text-gray-800">{{ fmtPcbAmount('KRW', ledgerKrw) }}</b>
          <template v-if="fxDiff !== null">
            <span class="ml-1 text-gray-400">
              (환차 {{ fxDiff >= 0 ? '+' : '-' }}{{ fmtPcbAmount('KRW', Math.abs(fxDiff)) }} · 발주 회계 대비)
            </span>
          </template>
          <span v-if="rateLessCount > 0" class="ml-1 font-semibold text-amber-700">
            · 환율 미기입 {{ rateLessCount }}건 제외(환차 계산 불가)
          </span>
        </p>

        <p v-if="summary !== null" class="mt-2 text-center">
          <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLS[summary.status]">
            {{ PCB_REMITTANCE_STATUS_LABELS[summary.status] }}
          </span>
        </p>

        <!-- 내역 -->
        <div class="mt-4 space-y-2">
          <div
            v-for="r in rows"
            :key="r.id"
            class="rounded-lg border border-gray-200 p-3"
          >
            <template v-if="editId === r.id">
              <div class="grid gap-2 sm:grid-cols-2">
                <label class="block">
                  <span class="text-[11px] font-semibold text-gray-500">송금일</span>
                  <input v-model="editOn" type="date" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                </label>
                <label class="block">
                  <span class="text-[11px] font-semibold text-gray-500">금액 ({{ r.currency }})</span>
                  <input v-model="editAmount" type="text" inputmode="decimal" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
                </label>
                <label v-if="isForeign" class="block sm:col-span-2">
                  <span class="text-[11px] font-semibold text-gray-500">
                    적용 환율 (KRW 환산용)
                    <span class="ml-1 font-normal text-gray-400">비우면 환산이 지워집니다</span>
                  </span>
                  <input v-model="editRate" type="text" inputmode="decimal" placeholder="송금 시점 실제 환율" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
                </label>
              </div>
              <input v-model="editMemo" type="text" placeholder="메모 — 협력사 포털에 그대로 보입니다" class="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <div class="mt-2 flex justify-end gap-2 text-xs">
                <button type="button" class="rounded-md border border-gray-200 px-2 py-1" @click="editId = null">취소</button>
                <button type="button" class="rounded-md bg-blue-600 px-2.5 py-1 font-bold text-white disabled:opacity-40" :disabled="patchMut.isPending.value" @click="void submitEdit()">저장</button>
              </div>
            </template>

            <template v-else>
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-bold text-gray-900">
                    {{ fmtPcbAmount(r.currency, r.amount) }}
                    <span class="ml-1 text-xs font-normal text-gray-500">{{ fmtKstDate(r.remittedOn) }}</span>
                    <span v-if="r.krwAmount !== null && r.currency !== 'KRW'" class="ml-1 text-[11px] text-gray-400">
                      ≈ {{ fmtPcbAmount('KRW', r.krwAmount) }}
                      <template v-if="r.exchangeRate !== null">@{{ r.exchangeRate }}</template>
                    </span>
                    <!-- 환율 미기입 — 짧기만 한 행이 아니라 '왜 원화가 없는지'를 말한다 -->
                    <span
                      v-else-if="isRateLess(r)"
                      class="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800"
                      title="환율이 없어 KRW 환산이 없습니다 — 원장 실지급 합계·회계 리포트에서 이 건이 빠집니다"
                    >환율 미기입</span>
                  </p>
                  <p v-if="r.memo !== null" class="mt-0.5 truncate text-xs text-gray-500">{{ r.memo }}</p>
                  <p class="mt-0.5 text-[11px] text-gray-400">기록 {{ r.createdBy }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1 text-xs">
                  <button type="button" class="rounded-md border border-dashed border-gray-300 px-2 py-1 text-gray-500 hover:bg-gray-50" @click="pickFile(r.id)">⬆ 증빙</button>
                  <button type="button" class="rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50" @click="startEdit(r)">수정</button>
                  <button type="button" class="rounded-md border border-gray-200 px-2 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600" :disabled="deleteMut.isPending.value" @click="void removeRow(r)">삭제</button>
                </div>
              </div>
              <div v-if="r.files.length > 0" class="mt-2 flex flex-wrap gap-1">
                <span v-for="f in r.files" :key="f.fileId" class="inline-flex items-center">
                  <button
                    type="button"
                    class="rounded-l border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                    :title="f.name"
                    @click="void downloadRemittanceFile(props.poId, r.id, f.fileId, f.name)"
                  >
                    ⬇ {{ f.name }}
                  </button>
                  <button
                    type="button"
                    class="rounded-r border border-l-0 border-gray-200 px-1 py-0.5 text-[11px] text-gray-300 hover:bg-red-50 hover:text-red-600"
                    title="증빙 삭제"
                    @click="void removeFile(r.id, f)"
                  >
                    ✕
                  </button>
                </span>
              </div>
            </template>
          </div>

          <p v-if="rows.length === 0" class="py-6 text-center text-sm text-gray-400">
            {{ detail.isFetching.value ? '불러오는 중…' : '아직 송금 기록이 없습니다.' }}
          </p>
        </div>

        <!-- 새 송금 -->
        <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <p class="text-xs font-bold text-blue-800">송금 기록 추가</p>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <label class="block">
              <span class="text-[11px] font-semibold text-gray-500">송금일</span>
              <div class="mt-1 flex gap-1">
                <input v-model="formOn" type="date" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                <button type="button" class="whitespace-nowrap rounded-md border border-gray-300 bg-surface px-2 text-xs font-semibold text-gray-600" @click="formOn = kstToday()">오늘</button>
              </div>
            </label>
            <label class="block">
              <span class="text-[11px] font-semibold text-gray-500">
                금액 ({{ summary?.currency ?? '—' }})
                <span v-if="!isFreeAs && summary !== null && summary.balance > 0" class="ml-1 font-normal text-gray-400">잔액 기본값</span>
              </span>
              <input v-model="formAmount" type="text" inputmode="decimal" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
            </label>
            <label v-if="isForeign" class="block">
              <span class="text-[11px] font-semibold text-gray-500">적용 환율 (KRW 환산용)</span>
              <input v-model="formRate" type="text" inputmode="decimal" placeholder="송금 시점 실제 환율" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
            </label>
            <label class="block" :class="isForeign ? '' : 'sm:col-span-2'">
              <span class="text-[11px] font-semibold text-gray-500">
                메모
                <span class="ml-1 font-normal text-amber-700">협력사에게 보입니다</span>
              </span>
              <input v-model="formMemo" type="text" placeholder="선금 50% 등" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            </label>
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-end gap-2">
            <!-- 환율 공란 경고 — 저장은 되지만 KRW 회계에서 이 건이 조용히 빠진다 -->
            <p v-if="rateMissingWarn" class="text-[11px] font-semibold text-amber-700">
              ⚠ 환율이 비어 있어 <b>KRW 환산 없이</b> 저장됩니다(회계 합계에서 제외).
            </p>
            <p v-if="willOverpay && summary !== null" class="text-[11px] font-semibold text-rose-700">
              ⚠ 잔액 {{ fmtPcbAmount(summary.currency, summary.balance) }} 초과 — 과지급으로 기록됩니다.
            </p>
            <button
              type="button"
              class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!canSubmit"
              :title="isFreeAs && !freeAsUnlocked ? '무상 A/S 회차 — 지급 대상이 아닙니다' : ''"
              @click="void submitNew()"
            >
              기록
            </button>
          </div>
        </div>

        <p v-if="error !== ''" class="mt-3 text-sm font-semibold text-red-600">{{ error }}</p>
      </div>

      <footer class="flex justify-end border-t border-gray-200 px-5 py-3">
        <button type="button" class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-black" @click="emit('close')">닫기</button>
      </footer>
    </div>

    <input ref="fileInput" type="file" class="hidden" @change="void onFilePicked($event)">
  </div>
</template>
