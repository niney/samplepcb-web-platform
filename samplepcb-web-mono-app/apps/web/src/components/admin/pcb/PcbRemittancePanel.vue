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

// 발주서 1건의 송금 원장 — 워크큐(목록)와 Case 상세가 같은 패널을 쓴다.
// 창구는 여럿, 원장·잔액 계산은 하나다(서버 summarizePcbRemittances 가 정본).
const props = defineProps<{ poId: number }>();
const emit = defineEmits<{ close: [] }>();

const poIdRef = computed(() => props.poId);
const detail = useAdminPcbRemittanceDetail(poIdRef);
const data = computed(() => detail.data.value?.data ?? null);
const summary = computed(() => data.value?.summary ?? null);
const rows = computed(() => data.value?.remittances ?? []);

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
  summary,
  (s) => {
    if (s !== null && formAmount.value === '') {
      formAmount.value = s.balance > 0 ? String(s.balance) : '';
    }
  },
  { immediate: true },
);

const canSubmit = computed(() => {
  const n = Number(formAmount.value.replaceAll(',', '').trim());
  return Number.isFinite(n) && n > 0 && formOn.value !== '' && !createMut.isPending.value;
});

async function submitNew(): Promise<void> {
  if (!canSubmit.value) return;
  error.value = '';
  const amount = Number(formAmount.value.replaceAll(',', '').trim());
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
const editId = ref<number | null>(null);
const editOn = ref('');
const editAmount = ref('');
const editMemo = ref('');

function startEdit(r: (typeof rows.value)[number]): void {
  editId.value = r.id;
  editOn.value = kstDateInput(r.remittedOn);
  editAmount.value = String(r.amount);
  editMemo.value = r.memo ?? '';
}
async function submitEdit(): Promise<void> {
  if (editId.value === null) return;
  error.value = '';
  try {
    await patchMut.mutateAsync({
      poId: props.poId,
      remittanceId: editId.value,
      body: {
        remittedOn: editOn.value,
        amount: Number(editAmount.value.replaceAll(',', '').trim()),
        memo: editMemo.value.trim() === '' ? null : editMemo.value.trim(),
      },
    });
    editId.value = null;
  } catch (e) {
    surface(e, '수정에 실패했습니다.');
  }
}

async function removeRow(remittanceId: number): Promise<void> {
  error.value = '';
  try {
    await deleteMut.mutateAsync({ poId: props.poId, remittanceId });
  } catch (e) {
    surface(e, '삭제에 실패했습니다.');
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
              </div>
              <input v-model="editMemo" type="text" placeholder="메모" class="mt-2 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
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
                  </p>
                  <p v-if="r.memo !== null" class="mt-0.5 truncate text-xs text-gray-500">{{ r.memo }}</p>
                  <p class="mt-0.5 text-[11px] text-gray-400">기록 {{ r.createdBy }}</p>
                </div>
                <div class="flex shrink-0 items-center gap-1 text-xs">
                  <button type="button" class="rounded-md border border-dashed border-gray-300 px-2 py-1 text-gray-500 hover:bg-gray-50" @click="pickFile(r.id)">⬆ 증빙</button>
                  <button type="button" class="rounded-md border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50" @click="startEdit(r)">수정</button>
                  <button type="button" class="rounded-md border border-gray-200 px-2 py-1 text-gray-400 hover:bg-red-50 hover:text-red-600" :disabled="deleteMut.isPending.value" @click="void removeRow(r.id)">삭제</button>
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
                    @click="void deleteFileMut.mutateAsync({ poId: props.poId, remittanceId: r.id, fileId: f.fileId })"
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
                <span v-if="summary !== null && summary.balance > 0" class="ml-1 font-normal text-gray-400">잔액 기본값</span>
              </span>
              <input v-model="formAmount" type="text" inputmode="decimal" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
            </label>
            <label v-if="isForeign" class="block">
              <span class="text-[11px] font-semibold text-gray-500">적용 환율 (KRW 환산용)</span>
              <input v-model="formRate" type="text" inputmode="decimal" placeholder="송금 시점 실제 환율" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums">
            </label>
            <label class="block" :class="isForeign ? '' : 'sm:col-span-2'">
              <span class="text-[11px] font-semibold text-gray-500">메모</span>
              <input v-model="formMemo" type="text" placeholder="선금 50% 등" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            </label>
          </div>
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!canSubmit"
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
