<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_AS_CASE_STATUS_LABELS,
  PCB_AS_CASE_TYPES,
  PCB_AS_CASE_TYPE_LABELS,
  PCB_AS_CHARGE_LABELS,
  PCB_AS_CHARGE_TYPES,
  defaultPcbAsCharge,
  type AdminPcbAsCaseViewType,
  type PcbAsCandidateViewType,
  type PcbAsCaseTypeType,
  type PcbAsChargeTypeType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import {
  downloadAdminPcbAsCaseFile,
  useAdminPcbAsCandidates,
  useAdminPcbAsCases,
  useCreatePcbAsCase,
  useDeletePcbAsCase,
  useDeletePcbAsCaseFile,
  useProceedPcbAsCase,
  useRecallPcbAsCase,
  useReplyPcbAsCase,
  useSubmitPcbAsCase,
  useUpdatePcbAsCase,
  useUploadPcbAsCaseFile,
} from '../../../admin/useAdminPcbAsCases';
import { confirmDialog } from '../../../lib/confirmDialog';
import UiPromptModal, { type PromptField } from '../../ui/UiPromptModal.vue';

// PCB A/S 재발주 패널(P4) — Case 상세 임베드. 접수(draft)→전송(submitted)→협력사
// 회신(accepted/rejected)→[재발주 진행](proceeded, 회차 발주서 생성)의 허브.
// 첨부·수정은 draft 에서만 — 전송 후엔 협력사가 보는 내용이라 고정(회수로 되돌림).
const props = defineProps<{ specId: number }>();
const specIdRef = computed(() => props.specId);

const listQuery = useAdminPcbAsCases(specIdRef);
const cases = computed(() => listQuery.data.value?.data.cases ?? []);
// 진행 중(회신 대기·진행 대기) 수 — 접힘 바 강조용. proceeded 는 케이스 축에선 종결이라
// 여기 안 센다(회차 발주의 진행은 발주서·EQ 섹션 몫 — 자동 펼침 조건도 현행 유지).
const activeCount = computed(
  () => cases.value.filter((c) => c.status === 'submitted' || c.status === 'accepted').length,
);
// 진행 중(회신 대기·진행 대기)이 있으면 펼쳐서 신호를 준다 — 없으면 접힘 시작.
const collapsed = ref(true);
let autoOpened = false;
watch(cases, (v) => {
  if (!autoOpened && v.some((c) => c.status === 'submitted' || c.status === 'accepted')) {
    collapsed.value = false;
    autoOpened = true;
  }
});

const error = ref('');
const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
  error.value = '';
  try {
    await fn();
    return true;
  } catch (e) {
    error.value =
      e instanceof ApiRequestError ? (e.payload?.message ?? '처리에 실패했습니다') : '처리에 실패했습니다';
    return false;
  }
};

// ── 접수 모달(생성/수정 겸용) ────────────────────────────────────────────────
const modalOpen = ref(false);
const editId = ref<number | null>(null);
const candQuery = useAdminPcbAsCandidates(specIdRef, modalOpen);
const candidates = computed<PcbAsCandidateViewType[]>(
  () => candQuery.data.value?.data.candidates ?? [],
);
const form = ref<{ targetPartnerId: number | null; caseType: PcbAsCaseTypeType; chargeType: PcbAsChargeTypeType; description: string }>({
  targetPartnerId: null,
  caseType: 'product_defect',
  chargeType: 'free',
  description: '',
});

const openCreate = (): void => {
  editId.value = null;
  form.value = { targetPartnerId: null, caseType: 'product_defect', chargeType: 'free', description: '' };
  modalOpen.value = true;
};
const openEdit = (c: AdminPcbAsCaseViewType): void => {
  editId.value = c.id;
  form.value = {
    targetPartnerId: c.targetPartnerId,
    caseType: c.caseType,
    chargeType: c.chargeType,
    description: c.description ?? '',
  };
  modalOpen.value = true;
};
// 후보가 1곳이면 자동 선택(레거시 UX 승계).
watch(candidates, (v) => {
  if (form.value.targetPartnerId === null && v.length === 1) {
    form.value.targetPartnerId = v[0]?.partnerId ?? null;
  }
});
/** 유형을 바꾸면 비용을 기본 규칙으로 재설정(관리자가 다시 바꿀 수 있다). */
const pickType = (t: PcbAsCaseTypeType): void => {
  form.value.caseType = t;
  form.value.chargeType = defaultPcbAsCharge(t);
};

const createMut = useCreatePcbAsCase();
const updateMut = useUpdatePcbAsCase();
const canSave = computed(
  () => form.value.targetPartnerId !== null && !createMut.isPending.value && !updateMut.isPending.value,
);
const save = async (): Promise<void> => {
  if (form.value.targetPartnerId === null) return;
  const body = {
    targetPartnerId: form.value.targetPartnerId,
    caseType: form.value.caseType,
    chargeType: form.value.chargeType,
    ...(form.value.description.trim() === '' ? {} : { description: form.value.description.trim() }),
  };
  const ok = await run(() =>
    editId.value === null
      ? createMut.mutateAsync({ specId: props.specId, body })
      : updateMut.mutateAsync({ caseId: editId.value, body }),
  );
  if (ok) modalOpen.value = false;
};

// ── 액션들 ──────────────────────────────────────────────────────────────────
const submitMut = useSubmitPcbAsCase();
const recallMut = useRecallPcbAsCase();
const deleteMut = useDeletePcbAsCase();
const replyMut = useReplyPcbAsCase();
const proceedMut = useProceedPcbAsCase();

const doSubmit = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message: `${c.targetPartnerName}에 A/S 접수를 전송합니다.\n전송 후에는 내용·첨부가 고정됩니다(회수로 되돌릴 수 있음).`,
      confirmLabel: '접수 요청',
    }))
  )
    return;
  await run(() => submitMut.mutateAsync(c.id));
};
const doRecall = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  await run(() => recallMut.mutateAsync(c.id));
};
const doDelete = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message: '이 A/S 초안을 삭제할까요? 첨부도 함께 삭제됩니다.',
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  )
    return;
  await run(() => deleteMut.mutateAsync(c.id));
};

// 대행 회신 — 포털 미사용 협력사 대비. 사유는 선택(거절 시 권장).
const replyTarget = ref<{ c: AdminPcbAsCaseViewType; accept: boolean } | null>(null);
const replyTitle = computed(() =>
  replyTarget.value === null
    ? null
    : replyTarget.value.accept
      ? '대행 회신 — 재생산 가능'
      : '대행 회신 — 재생산 불가',
);
const replyFields = computed<PromptField[]>(() => [
  {
    name: 'reason',
    label: replyTarget.value?.accept === false ? '사유 (권장)' : '사유 (선택)',
    type: 'textarea',
    placeholder: '협력사가 전한 회신 내용',
  },
]);
const doReplySubmit = async (values: Record<string, string>): Promise<void> => {
  const t = replyTarget.value;
  if (t === null) return;
  replyTarget.value = null;
  await run(() =>
    replyMut.mutateAsync({ caseId: t.c.id, accept: t.accept, reason: values.reason ?? '' }),
  );
};

const proceededPoId = ref<number | null>(null);
const doProceed = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message:
        '회차 발주서를 생성합니다(회차 자동 부여).\n조건은 원발주에서 이어받고 납기는 비워집니다 — 발주서·EQ 섹션에서 발주접수부터 진행하세요.',
      confirmLabel: '재발주 진행',
    }))
  )
    return;
  error.value = '';
  try {
    const res = await proceedMut.mutateAsync(c.id);
    proceededPoId.value = res.data.poId;
  } catch (e) {
    error.value =
      e instanceof ApiRequestError ? (e.payload?.message ?? '처리에 실패했습니다') : '처리에 실패했습니다';
  }
};

// ── 첨부(draft) ─────────────────────────────────────────────────────────────
const uploadMut = useUploadPcbAsCaseFile();
const deleteFileMut = useDeletePcbAsCaseFile();
const fileInput = ref<HTMLInputElement | null>(null);
const uploadFor = ref<number | null>(null);
const pickFile = (caseId: number): void => {
  uploadFor.value = caseId;
  fileInput.value?.click();
};
const onFile = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const caseId = uploadFor.value;
  input.value = '';
  if (file === undefined || caseId === null) return;
  await run(() => uploadMut.mutateAsync({ caseId, file }));
};

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-sky-100 text-sky-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  proceeded: 'bg-indigo-100 text-indigo-700',
};
const trackLabel = (c: AdminPcbAsCaseViewType): string =>
  c.parentPartnerId === 0 ? '직거래' : `MD 경유 · ${c.parentPartnerName ?? ''}`;
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="flex w-full items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700"
    @click="collapsed = false"
  >
    <span>
      ▸ A/S 재발주 ({{ cases.length }}건<template v-if="activeCount > 0"> · <b class="text-amber-600">진행 중 {{ activeCount }}건</b></template>)
    </span>
    <span class="text-xs text-gray-400">펼치기</span>
  </button>
  <section v-else class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
      <h2 class="text-sm font-bold text-gray-700">
        A/S 재발주
        <span class="ml-1 text-xs font-normal text-gray-400">{{ cases.length }}건</span>
      </h2>
      <button
        type="button"
        class="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700"
        @click="openCreate"
      >
        A/S 접수
      </button>
    </div>
    <p class="border-b border-gray-50 px-4 py-2 text-xs text-gray-400">
      완료·출고된 발주의 재생산 흐름: 접수 작성 → [접수 요청](협력사 통지) →
      협력사 회신(가능/불가) → <b>[재발주 진행]</b> = 회차 발주서 생성(발주접수부터 재진행).
    </p>

    <p v-if="error !== ''" class="border-b border-red-100 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
      {{ error }}
    </p>
    <p v-if="proceededPoId !== null" class="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
      회차 발주서 #{{ proceededPoId }}가 생성되었습니다 — 위 <b>발주서 · EQ</b> 섹션에서 진행하세요.
    </p>

    <p v-if="cases.length === 0" class="px-4 py-6 text-center text-sm text-gray-400">
      A/S 접수가 없습니다.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-100 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="px-4 py-2">유형 · 비용</th>
            <th class="px-4 py-2">대상 / 트랙</th>
            <th class="whitespace-nowrap px-4 py-2">상태 / 회차</th>
            <th class="px-4 py-2">내용 · 회신</th>
            <th class="px-4 py-2">첨부</th>
            <th class="px-4 py-2 text-right">액션</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="c in cases" :key="c.id" class="align-top">
            <td class="whitespace-nowrap px-4 py-2.5">
              <span
                class="rounded px-1.5 py-0.5 text-xs font-bold"
                :class="c.caseType === 'product_defect' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'"
              >{{ PCB_AS_CASE_TYPE_LABELS[c.caseType] }}</span>
              <span
                class="ml-1 rounded px-1.5 py-0.5 text-xs font-bold"
                :class="c.chargeType === 'free' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'"
              >{{ PCB_AS_CHARGE_LABELS[c.chargeType] }}</span>
              <p class="mt-1 text-[11px] text-gray-400">{{ fmtKstDate(c.createdAt) }}</p>
            </td>
            <td class="px-4 py-2.5">
              <p class="font-semibold text-gray-800">{{ c.targetPartnerName }}</p>
              <p class="text-xs text-gray-400">{{ trackLabel(c) }}</p>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <span class="rounded px-1.5 py-0.5 text-xs font-bold" :class="STATUS_CLS[c.status]">
                {{ PCB_AS_CASE_STATUS_LABELS[c.status] }}
              </span>
              <span v-if="c.reorderRound !== null" class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">
                {{ c.reorderRound }}차
              </span>
              <p v-if="c.roundPoId !== null" class="mt-1 text-[11px] text-indigo-600">발주 #{{ c.roundPoId }}</p>
            </td>
            <td class="max-w-[260px] px-4 py-2.5">
              <p v-if="c.description !== null" class="whitespace-pre-wrap text-xs text-gray-600">{{ c.description }}</p>
              <p v-if="c.replyReason !== null" class="mt-1 whitespace-pre-wrap text-xs" :class="c.status === 'rejected' ? 'text-red-600' : 'text-emerald-700'">
                ↳ 회신: {{ c.replyReason }}
              </p>
            </td>
            <td class="px-4 py-2.5">
              <div v-for="f in c.files" :key="f.fileId" class="flex items-center gap-1 text-xs">
                <button type="button" class="text-blue-600 hover:underline" @click="downloadAdminPcbAsCaseFile(c.id, f.fileId, f.name)">
                  {{ f.name }}
                </button>
                <span class="text-[10px] text-gray-400">{{ f.uploadedBy === 'PARTNER' ? '협력사' : '관리자' }}</span>
                <button
                  v-if="c.status === 'draft'"
                  type="button"
                  class="text-gray-400 hover:text-red-600"
                  @click="run(() => deleteFileMut.mutateAsync({ caseId: c.id, fileId: f.fileId }))"
                >
                  ✕
                </button>
              </div>
              <button
                v-if="c.status === 'draft'"
                type="button"
                class="mt-1 rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                @click="pickFile(c.id)"
              >
                + 첨부
              </button>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right text-xs">
              <template v-if="c.status === 'draft'">
                <button type="button" class="rounded border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50" @click="openEdit(c)">수정</button>
                <button type="button" class="ml-1 rounded bg-sky-600 px-2 py-1 font-semibold text-white hover:bg-sky-700" @click="doSubmit(c)">접수 요청</button>
                <button type="button" class="ml-1 rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50" @click="doDelete(c)">삭제</button>
              </template>
              <template v-else-if="c.status === 'submitted'">
                <button type="button" class="rounded border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50" @click="doRecall(c)">회수</button>
                <button type="button" class="ml-1 rounded border border-emerald-200 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50" @click="replyTarget = { c, accept: true }">대행 수락</button>
                <button type="button" class="ml-1 rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50" @click="replyTarget = { c, accept: false }">대행 거절</button>
              </template>
              <template v-else-if="c.status === 'accepted'">
                <button type="button" class="rounded bg-indigo-600 px-2 py-1 font-semibold text-white hover:bg-indigo-700" @click="doProceed(c)">재발주 진행</button>
              </template>
              <span v-else class="text-gray-300">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <input ref="fileInput" type="file" class="hidden" @change="onFile">

    <!-- 접수 모달(생성/수정) -->
    <div v-if="modalOpen" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="modalOpen = false">
      <div class="w-full max-w-lg rounded-xl bg-surface p-5 shadow-xl">
        <h3 class="text-base font-bold text-gray-900">{{ editId === null ? 'A/S 접수' : 'A/S 접수 수정' }}</h3>
        <p class="mt-1 text-xs text-gray-500">
          저장하면 '작성'(초안)으로 보관됩니다 — 협력사에는 [접수 요청] 후에 보입니다.
        </p>

        <div class="mt-4 space-y-4">
          <div>
            <p class="text-[11px] font-semibold text-gray-500">재생산 협력사</p>
            <p v-if="candidates.length === 0" class="mt-1 text-sm text-amber-700">
              발주된 협력사가 없습니다 — 원주문 발주서가 있어야 A/S 대상이 됩니다.
            </p>
            <label v-for="cand in candidates" :key="cand.partnerId" class="mt-1 flex items-center gap-2 text-sm">
              <input v-model="form.targetPartnerId" type="radio" :value="cand.partnerId">
              <span class="font-semibold">{{ cand.partnerName }}</span>
              <span class="text-xs text-gray-400">
                {{ cand.parentPartnerId === 0 ? '직거래' : `MD 경유 · ${cand.parentPartnerName ?? ''}` }}
              </span>
            </label>
          </div>
          <div>
            <p class="text-[11px] font-semibold text-gray-500">유형</p>
            <label v-for="t in PCB_AS_CASE_TYPES" :key="t" class="mr-4 inline-flex items-center gap-1.5 text-sm">
              <input type="radio" :checked="form.caseType === t" @change="pickType(t)">
              {{ PCB_AS_CASE_TYPE_LABELS[t] }}
            </label>
          </div>
          <div>
            <p class="text-[11px] font-semibold text-gray-500">비용 조건 <span class="font-normal text-gray-400">(유형 선택 시 기본값 자동 — 변경 가능)</span></p>
            <label v-for="ch in PCB_AS_CHARGE_TYPES" :key="ch" class="mr-4 inline-flex items-center gap-1.5 text-sm">
              <input v-model="form.chargeType" type="radio" :value="ch">
              {{ PCB_AS_CHARGE_LABELS[ch] }}
            </label>
          </div>
          <label class="block">
            <span class="text-[11px] font-semibold text-gray-500">설명</span>
            <textarea
              v-model="form.description"
              rows="3"
              class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              placeholder="불량 내용 / 잘못 전달한 정보 등"
            />
          </label>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="modalOpen = false">취소</button>
          <button
            type="button"
            class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40"
            :disabled="!canSave"
            @click="save"
          >
            저장
          </button>
        </div>
      </div>
    </div>

    <UiPromptModal
      :title="replyTitle"
      :fields="replyFields"
      :confirm-label="replyTarget?.accept === true ? '재생산 가능으로 기록' : '재생산 불가로 기록'"
      @close="replyTarget = null"
      @confirm="doReplySubmit"
    />
  </section>
</template>
