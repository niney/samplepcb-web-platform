<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_AS_CASE_STATUS_LABELS,
  PCB_AS_CASE_TYPE_LABELS,
  PCB_AS_CHARGE_LABELS,
  type PartnerPcbAsCaseViewType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import {
  downloadPartnerPcbAsCaseFile,
  useDeletePartnerPcbAsCaseFile,
  usePartnerPcbAsCases,
  useReplyPartnerPcbAsCase,
  useUploadPartnerPcbAsCaseFile,
} from '../../partner/usePartnerPcbAsCases';
import UiPromptModal, { type PromptField } from '../../components/ui/UiPromptModal.vue';

// PCB A/S(P4) — 관리자가 접수한 재생산 검토 요청에 회신한다(재생산 가능/불가+사유).
// 회신 전(접수 상태)에는 근거 사진·자료를 첨부할 수 있다. MD 는 자기 중계 트랙을
// 열람만 한다(실무는 회차 발주서가 생긴 뒤 하위 발주에서 시작 — 레거시 동형).

const listQuery = usePartnerPcbAsCases();
const cases = computed(() => listQuery.data.value?.data.cases ?? []);
const myPartnerId = computed(() => listQuery.data.value?.data.partnerId ?? null);
const isMine = (c: PartnerPcbAsCaseViewType): boolean => c.targetPartnerId === myPartnerId.value;
const pending = computed(() => cases.value.filter((c) => c.status === 'submitted' && isMine(c)));
const others = computed(() => cases.value.filter((c) => !(c.status === 'submitted' && isMine(c))));

const error = ref('');
const run = async (fn: () => Promise<unknown>): Promise<void> => {
  error.value = '';
  try {
    await fn();
  } catch (e) {
    error.value =
      e instanceof ApiRequestError ? (e.payload?.message ?? '처리에 실패했습니다') : '처리에 실패했습니다';
  }
};

// ── 회신 모달 ────────────────────────────────────────────────────────────────
const replyMut = useReplyPartnerPcbAsCase();
const replyTarget = ref<{ c: PartnerPcbAsCaseViewType; accept: boolean } | null>(null);
const replyTitle = computed(() =>
  replyTarget.value === null
    ? null
    : replyTarget.value.accept
      ? '재생산 가능으로 회신'
      : '재생산 불가로 회신',
);
const replyFields = computed<PromptField[]>(() => [
  {
    name: 'reason',
    label: replyTarget.value?.accept === false ? '사유 (권장)' : '의견 (선택)',
    type: 'textarea',
    placeholder:
      replyTarget.value?.accept === false
        ? '재생산이 어려운 이유(원자재·설비·일정 등)'
        : '일정·조건 등 전달할 내용',
  },
]);
const submitReply = async (values: Record<string, string>): Promise<void> => {
  const t = replyTarget.value;
  if (t === null) return;
  replyTarget.value = null;
  await run(() => replyMut.mutateAsync({ caseId: t.c.id, accept: t.accept, reason: values.reason ?? '' }));
};

// ── 첨부(회신 전) ────────────────────────────────────────────────────────────
const uploadMut = useUploadPartnerPcbAsCaseFile();
const deleteFileMut = useDeletePartnerPcbAsCaseFile();
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
  submitted: 'bg-sky-100 text-sky-700',
  accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  proceeded: 'bg-indigo-100 text-indigo-700',
};
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-bold">PCB A/S</h1>
      <p class="mt-0.5 text-sm text-gray-500">
        재생산(A/S) 검토 요청 — 비용 조건을 확인하고 <b>재생산 가능/불가</b>를 회신해 주세요.
      </p>
    </div>

    <p v-if="error !== ''" class="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700">
      {{ error }}
    </p>
    <p v-if="listQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="cases.length === 0" class="rounded-xl border border-gray-200 bg-surface p-6 text-sm text-gray-400">
      A/S 요청이 없습니다.
    </p>

    <!-- 회신 대기(내 차례) -->
    <section v-if="pending.length > 0" class="space-y-3">
      <h2 class="text-sm font-bold text-gray-700">회신 대기 <span class="text-amber-600">{{ pending.length }}건</span></h2>
      <div v-for="c in pending" :key="c.id" class="rounded-xl border border-amber-200 bg-surface p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p class="font-bold text-gray-900">{{ c.projectName }}</p>
            <p class="mt-1 space-x-1 text-xs">
              <span class="rounded px-1.5 py-0.5 font-bold" :class="c.caseType === 'product_defect' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'">
                {{ PCB_AS_CASE_TYPE_LABELS[c.caseType] }}
              </span>
              <span class="rounded px-1.5 py-0.5 font-bold" :class="c.chargeType === 'free' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'">
                {{ PCB_AS_CHARGE_LABELS[c.chargeType] }} 재생산
              </span>
              <span class="text-gray-400">{{ fmtKstDate(c.submittedAt ?? '') }} 접수</span>
            </p>
            <p v-if="c.description !== null" class="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {{ c.description }}
            </p>
            <div class="mt-2 space-y-0.5">
              <div v-for="f in c.files" :key="f.fileId" class="flex items-center gap-1 text-xs">
                <button type="button" class="text-blue-600 hover:underline" @click="downloadPartnerPcbAsCaseFile(c.id, f.fileId, f.name)">
                  {{ f.name }}
                </button>
                <span class="text-[10px] text-gray-400">{{ f.uploadedBy === 'PARTNER' ? '내 첨부' : '관리자' }}</span>
                <button
                  v-if="f.uploadedBy === 'PARTNER'"
                  type="button"
                  class="text-gray-400 hover:text-red-600"
                  @click="run(() => deleteFileMut.mutateAsync({ caseId: c.id, fileId: f.fileId }))"
                >
                  ✕
                </button>
              </div>
              <button
                type="button"
                class="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                @click="pickFile(c.id)"
              >
                + 사진·자료 첨부
              </button>
            </div>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              type="button"
              class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700"
              @click="replyTarget = { c, accept: true }"
            >
              재생산 가능
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-bold text-red-600 hover:bg-red-50"
              @click="replyTarget = { c, accept: false }"
            >
              재생산 불가
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 이력·중계 열람 -->
    <section v-if="others.length > 0" class="rounded-xl border border-gray-200 bg-surface">
      <h2 class="border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-700">이력</h2>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th class="px-4 py-2">건</th>
              <th class="px-4 py-2">유형 · 비용</th>
              <th class="whitespace-nowrap px-4 py-2">상태 / 회차</th>
              <th class="px-4 py-2">회신</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="c in others" :key="c.id" class="align-top">
              <td class="px-4 py-2.5">
                <p class="font-semibold text-gray-800">{{ c.projectName }}</p>
                <p v-if="!isMine(c)" class="text-[11px] text-gray-400">중계 트랙 · 회신 주체 {{ c.targetPartnerName }}</p>
              </td>
              <td class="whitespace-nowrap px-4 py-2.5 text-xs">
                {{ PCB_AS_CASE_TYPE_LABELS[c.caseType] }} · {{ PCB_AS_CHARGE_LABELS[c.chargeType] }}
              </td>
              <td class="whitespace-nowrap px-4 py-2.5">
                <span class="rounded px-1.5 py-0.5 text-xs font-bold" :class="STATUS_CLS[c.status] ?? 'bg-gray-100 text-gray-600'">
                  {{ PCB_AS_CASE_STATUS_LABELS[c.status] }}
                </span>
                <span v-if="c.reorderRound !== null" class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-bold text-indigo-700">
                  {{ c.reorderRound }}차
                </span>
              </td>
              <td class="max-w-[280px] px-4 py-2.5 text-xs text-gray-600">
                <p v-if="c.replyReason !== null" class="whitespace-pre-wrap">{{ c.replyReason }}</p>
                <!-- proceeded 딥링크 — 내가 열 수 있는 회차 발주서로 바로(서버 roundPoId).
                     MD 경유 대상 협력사는 하위 발주가 아직 없으면 문구로 폴백. -->
                <p v-if="c.status === 'proceeded'" class="mt-0.5 text-indigo-600">
                  <RouterLink
                    v-if="c.roundPoId !== null"
                    :to="{ name: 'partner-pcb-po', params: { id: String(c.roundPoId) } }"
                    class="font-semibold underline hover:text-indigo-800"
                  >
                    회차 발주서(PO-{{ c.roundPoId }}) 열기 →
                  </RouterLink>
                  <template v-else>회차 발주서가 발행되었습니다 — 발주 목록에서 진행하세요.</template>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <input ref="fileInput" type="file" class="hidden" @change="onFile">
    <UiPromptModal
      :title="replyTitle"
      :fields="replyFields"
      :confirm-label="replyTarget?.accept === true ? '재생산 가능 회신' : '재생산 불가 회신'"
      :tone="replyTarget?.accept === false ? 'danger' : 'default'"
      @close="replyTarget = null"
      @confirm="submitReply"
    />
  </div>
</template>
