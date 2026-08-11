<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  PCB_EQ_REVIEW_STATUS_LABELS,
  type AdminPcbPoViewType,
  type PcbEqReviewStatusType,
} from '@sp/api-contract';
import { fmtKstDate, kstToday } from '@sp/utils';
import {
  useAdminPcbEqReviews,
  useCancelPcbEqReview,
  useCreatePcbEqReview,
} from '../../../admin/useAdminPcbPos';

// EQ 고객 확인 패널(P4.1) — 협력사 EQ 를 고객에게 물어본다.
// ⚠ 이 패널은 EQ 전이를 바꾸지 않는다. 고객이 승인해도 상태는 eq_requested 그대로이고
//   [EQ 승인]은 관리자가 따로 누른다(고객 확인 = 관리자 승인의 근거).
// ⚠ 공개 파일은 **골라서** 보낸다 — 협력사가 올린 첨부에 협력사명·로고가 있으면
//   고객에게 공급망이 드러난다.
const props = defineProps<{ po: AdminPcbPoViewType }>();
const emit = defineEmits<{ close: [] }>();

const poId = computed(() => props.po.poId);
const list = useAdminPcbEqReviews(poId);
const reviews = computed(() => list.data.value?.data.reviews ?? []);
const openReview = computed(() => reviews.value.find((r) => r.status === 'requested') ?? null);
const history = computed(() => reviews.value.filter((r) => r.status !== 'requested'));

const createMut = useCreatePcbEqReview();
const cancelMut = useCancelPcbEqReview();

const message = ref('');
const dueOn = ref('');
const picked = ref<number[]>([]);
const error = ref('');

const togglePick = (fileId: number): void => {
  picked.value = picked.value.includes(fileId)
    ? picked.value.filter((id) => id !== fileId)
    : [...picked.value, fileId];
};

const canSend = computed(() => message.value.trim().length >= 2 && !createMut.isPending.value);

async function send(): Promise<void> {
  if (!canSend.value) return;
  error.value = '';
  try {
    await createMut.mutateAsync({
      poId: props.po.poId,
      body: {
        message: message.value.trim(),
        ...(dueOn.value === '' ? {} : { dueOn: dueOn.value }),
        sharedFileIds: [...picked.value],
      },
    });
    message.value = '';
    dueOn.value = '';
    picked.value = [];
  } catch (e) {
    error.value = e instanceof Error && e.message !== '' ? e.message : '요청 발송에 실패했습니다.';
  }
}

async function cancel(reviewId: number): Promise<void> {
  error.value = '';
  try {
    await cancelMut.mutateAsync({ poId: props.po.poId, reviewId });
  } catch (e) {
    error.value = e instanceof Error && e.message !== '' ? e.message : '취소에 실패했습니다.';
  }
}

const STATUS_CLS: Record<PcbEqReviewStatusType, string> = {
  requested: 'bg-sky-100 text-sky-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  canceled: 'bg-gray-100 text-gray-500',
};
</script>

<template>
  <div class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-xl">
      <header class="border-b border-gray-200 px-5 py-4">
        <p class="text-[11px] font-bold uppercase tracking-wider text-sky-600">EQ 고객 확인</p>
        <h3 class="mt-0.5 text-base font-bold text-gray-900">{{ po.partnerName }} 발주 건</h3>
        <p class="mt-1 text-xs text-gray-500">
          고객이 승인해도 EQ 상태는 그대로입니다 — 확인 결과를 보고 <b class="text-gray-700">[EQ 승인]</b>은
          직접 누르세요.
        </p>
      </header>

      <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
        <!-- 열린 요청 -->
        <div v-if="openReview !== null" class="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS.requested">
              {{ PCB_EQ_REVIEW_STATUS_LABELS.requested }}
            </span>
            <span v-if="openReview.overdue" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-700">
              기한 초과 — 재촉 필요
            </span>
          </div>
          <p class="mt-2 whitespace-pre-wrap text-sm text-gray-800">{{ openReview.message }}</p>
          <p class="mt-1 text-[11px] text-gray-500">
            {{ fmtKstDate(openReview.requestedAt) }} 발송 · {{ openReview.requestedBy }}
            <template v-if="openReview.dueOn !== null"> · 기한 {{ fmtKstDate(openReview.dueOn) }}</template>
            <template v-if="openReview.files.length > 0"> · 공개 {{ openReview.files.length }}개</template>
          </p>
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              :disabled="cancelMut.isPending.value"
              @click="void cancel(openReview.id)"
            >
              요청 취소
            </button>
          </div>
        </div>

        <!-- 새 요청 — EQ 승인요청 단계에서만(서버 가드 NOT_EQ_REQUESTED 의 화면 미러).
             그 외 단계에서 열리는 건 행의 상태 배지를 눌러 이력을 보는 경우다(P4.4). -->
        <p
          v-else-if="po.status !== 'eq_requested'"
          class="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500"
        >
          새 확인 요청은 발주서가 <b>EQ 승인요청</b> 단계일 때만 보낼 수 있습니다.
        </p>
        <div v-else class="rounded-lg border border-sky-200 bg-sky-50/40 p-3">
          <p class="text-xs font-bold text-sky-800">고객에게 확인 요청</p>
          <label class="mt-2 block">
            <span class="text-[11px] font-semibold text-gray-500">
              확인 문구 <span class="font-normal text-gray-400">— 협력사 원문을 그대로 옮기지 마세요</span>
            </span>
            <textarea
              v-model="message"
              rows="4"
              maxlength="2000"
              placeholder="예) 홀 지름 0.3mm 가 드릴 규격상 제작이 어렵습니다. 0.35mm 로 변경해도 될까요?"
              class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
          </label>

          <label class="mt-2 block">
            <span class="text-[11px] font-semibold text-gray-500">회신 기한 (선택)</span>
            <div class="mt-1 flex gap-1">
              <input v-model="dueOn" type="date" class="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <button type="button" class="whitespace-nowrap rounded-md border border-gray-300 bg-surface px-2 text-xs font-semibold text-gray-600" @click="dueOn = kstToday()">오늘</button>
              <button v-if="dueOn !== ''" type="button" class="whitespace-nowrap rounded-md border border-gray-300 bg-surface px-2 text-xs text-gray-500" @click="dueOn = ''">지움</button>
            </div>
          </label>

          <!-- 공개 파일 선택 — 기본은 아무것도 안 보낸다 -->
          <div v-if="po.eqFiles.length > 0" class="mt-3">
            <p class="text-[11px] font-semibold text-gray-500">
              고객에게 공개할 첨부
              <span class="font-normal text-amber-700">— 협력사명이 든 파일은 빼세요</span>
            </p>
            <!-- 목록은 최신이 먼저 온다(서버 정렬). 이전 회차를 고객에게 보내면 고객이 옛
                 도면을 보고 승인하므로 눈에 띄게 표시한다(여정 22호). -->
            <div class="mt-1 space-y-1">
              <label
                v-for="f in po.eqFiles"
                :key="f.fileId"
                class="flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs"
                :class="picked.includes(f.fileId) ? 'border-sky-300 bg-sky-50' : f.isLatest ? 'border-gray-200' : 'border-dashed border-amber-300'"
              >
                <input
                  type="checkbox"
                  class="size-4 accent-sky-600"
                  :checked="picked.includes(f.fileId)"
                  @change="togglePick(f.fileId)"
                >
                <span class="font-semibold uppercase text-gray-400">{{ f.fileType }}</span>
                <span class="min-w-0 flex-1 truncate text-gray-700">{{ f.name }}</span>
                <span
                  v-if="!f.isLatest"
                  class="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700"
                  title="같은 종류로 더 최근 파일이 올라와 있습니다."
                >
                  이전
                </span>
              </label>
            </div>
          </div>
          <p v-else class="mt-3 text-[11px] text-gray-400">협력사가 올린 EQ 첨부가 없습니다.</p>

          <div class="mt-3 flex justify-end">
            <button
              type="button"
              class="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!canSend"
              @click="void send()"
            >
              확인 요청 보내기
            </button>
          </div>
        </div>

        <!-- 지난 이력 -->
        <div v-if="history.length > 0" class="mt-4">
          <p class="text-xs font-bold text-gray-500">지난 요청 ({{ history.length }})</p>
          <div class="mt-2 space-y-2">
            <div v-for="r in history" :key="r.id" class="rounded-lg border border-gray-200 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[r.status]">
                  {{ PCB_EQ_REVIEW_STATUS_LABELS[r.status] }}
                </span>
                <span class="text-[11px] text-gray-400">
                  {{ r.decidedAt === null ? fmtKstDate(r.requestedAt) : fmtKstDate(r.decidedAt) }}
                  <template v-if="r.decidedBy !== null"> · {{ r.decidedBy }}</template>
                </span>
              </div>
              <p class="mt-1.5 whitespace-pre-wrap text-xs text-gray-600">{{ r.message }}</p>
              <p v-if="r.decisionNote !== null && r.decisionNote !== ''" class="mt-1.5 rounded bg-gray-50 px-2 py-1.5 text-xs" :class="r.status === 'rejected' ? 'text-red-700' : 'text-gray-600'">
                고객 의견: {{ r.decisionNote }}
              </p>
            </div>
          </div>
        </div>

        <p v-if="error !== ''" class="mt-3 text-sm font-semibold text-red-600">{{ error }}</p>
      </div>

      <footer class="flex justify-end border-t border-gray-200 px-5 py-3">
        <button type="button" class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-black" @click="emit('close')">닫기</button>
      </footer>
    </div>
  </div>
</template>
