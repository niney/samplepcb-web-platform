<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_FILE_LABELS,
  PCB_EQ_FORWARD,
  PCB_EQ_REVERT,
  PCB_PO_STATUSES,
  PCB_PO_STATUS_LABELS,
  PCB_RFQ_STATUS_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  type PcbEqFileTypeType,
} from '@sp/api-contract';
import {
  downloadPartnerPcbEqFile,
  downloadPartnerPcbPoSpecFile,
  downloadPartnerPcbShipmentFile,
  useCreatePartnerChildPcbPo,
  useDeletePartnerPcbEqFile,
  usePartnerPcbEqRequest,
  usePartnerPcbEqRevert,
  usePartnerPcbPoDetail,
  usePartnerPcbProductionComplete,
  usePartnerPcbProductionStart,
  usePartnerPcbShipmentAdvance,
  usePartnerPcbShipmentReceive,
  useUploadPartnerPcbEqFile,
} from '../../partner/usePartnerPcbPos';
import { fmtKstDate as dateOnly } from '@sp/utils';
import { fmtPcbAmount, pcbMoneyWithSub } from '../../lib/pcb-money';
import { pcbSpecEntries } from '../../lib/pcb-spec';

// PCB 발주서 상세(협력사 포털, P2) — EQ 5단계 진행: 발주접수(EQ·Working 파일 업로드)
// → EQ 승인요청 → (관리자 승인) → 생산 시작 → 생산 완료. 되돌리기는 직전 전이 주체만.
// MD 는 하위 발주(childRfqs 기반)로 트랙을 열고, 하위 수주자 대신 fallback 진행도 가능.

const route = useRoute();
const poId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const detailQuery = usePartnerPcbPoDetail(poId);
const detail = computed(() => detailQuery.data.value?.data ?? null);

const actionError = ref('');
const surfaceError = (e: unknown, fallback: string): void => {
  actionError.value = e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

// ── 수금 상태(P3.11) — 부분 송금이 있으므로 '완료/대기' 두 값으로는 부족하다 ─────
const remitSummary = computed(() => detail.value?.remittanceSummary ?? null);
const remitStatusText = computed<string>(() => {
  const s = remitSummary.value;
  if (s === null || s.count === 0) return '입금 전';
  if (s.balance <= 0) return `완료 (${dateOnly(s.lastRemittedOn)})`;
  return `부분 입금 — 미수 ${fmtPcbAmount(s.currency, s.balance)}`;
});
const remitStatusCls = computed<string>(() => {
  const s = remitSummary.value;
  if (s === null || s.count === 0) return 'text-gray-400';
  return s.balance <= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700';
});

// ── EQ 스텝퍼·액션 파생(계약 사전이 단일 정본) ───────────────────────────────
const steps = PCB_PO_STATUSES;
const stepIndex = computed(() =>
  detail.value === null ? -1 : steps.indexOf(detail.value.status),
);
const forward = computed(() =>
  detail.value === null ? null : PCB_EQ_FORWARD[detail.value.status],
);
const revert = computed(() =>
  detail.value === null ? null : PCB_EQ_REVERT[detail.value.status],
);
const canForward = computed(
  () =>
    detail.value !== null &&
    detail.value.eq.myRole === 'RECEIVER' &&
    forward.value !== null &&
    forward.value.actor === 'RECEIVER' &&
    detail.value.eq.delegatePoId === null &&
    !detail.value.eq.blocked,
);
const canRevert = computed(
  () =>
    detail.value !== null &&
    detail.value.eq.myRole === 'RECEIVER' &&
    revert.value !== null &&
    revert.value.actor === 'RECEIVER' &&
    detail.value.eq.delegatePoId === null &&
    !detail.value.eq.blocked,
);
const hasEqFile = computed(
  () => detail.value?.eq.files.some((f) => f.fileType === 'eq') ?? false,
);
const hasWorkingFile = computed(
  () => detail.value?.eq.files.some((f) => f.fileType === 'working') ?? false,
);
const filesEditable = computed(() => detail.value?.status === 'issued');

// ── 파일 업로드 ──────────────────────────────────────────────────────────────
const upload = useUploadPartnerPcbEqFile();
const removeFile = useDeletePartnerPcbEqFile();
function pickAndUpload(fileType: PcbEqFileTypeType): void {
  if (poId.value === null) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    actionError.value = '';
    try {
      await upload.mutateAsync({ poId: poId.value ?? 0, file, fileType });
    } catch (e) {
      surfaceError(e, '파일 업로드에 실패했습니다.');
    }
  };
  input.click();
}
async function deleteFile(fileId: number): Promise<void> {
  if (poId.value === null) return;
  actionError.value = '';
  try {
    await removeFile.mutateAsync({ poId: poId.value, fileId });
  } catch (e) {
    surfaceError(e, '파일 삭제에 실패했습니다.');
  }
}

// ── 전이 ─────────────────────────────────────────────────────────────────────
const eqRequest = usePartnerPcbEqRequest();
const prodStart = usePartnerPcbProductionStart();
const prodComplete = usePartnerPcbProductionComplete();
const eqRevert = usePartnerPcbEqRevert();
const busy = computed(
  () =>
    eqRequest.isPending.value ||
    prodStart.isPending.value ||
    prodComplete.isPending.value ||
    eqRevert.isPending.value,
);
async function runForward(): Promise<void> {
  if (poId.value === null || detail.value === null) return;
  actionError.value = '';
  const status = detail.value.status;
  try {
    if (status === 'issued') await eqRequest.mutateAsync({ poId: poId.value });
    else if (status === 'eq_done') await prodStart.mutateAsync({ poId: poId.value });
    else if (status === 'producing') await prodComplete.mutateAsync({ poId: poId.value });
  } catch (e) {
    surfaceError(e, '진행에 실패했습니다.');
  }
}
async function runRevert(): Promise<void> {
  if (poId.value === null || revert.value === null) return;
  if (!window.confirm(`'${revert.value.label}' — 한 단계 되돌릴까요?`)) return;
  actionError.value = '';
  try {
    await eqRevert.mutateAsync({ poId: poId.value });
  } catch (e) {
    surfaceError(e, '되돌리기에 실패했습니다.');
  }
}

// ── MD 하위 발주 ─────────────────────────────────────────────────────────────
const childPo = useCreatePartnerChildPcbPo();
const childRfqPick = ref<number | null>(null);
async function issueChildPo(): Promise<void> {
  if (poId.value === null || childRfqPick.value === null) return;
  actionError.value = '';
  try {
    await childPo.mutateAsync({
      poId: poId.value,
      body: { childRfqId: childRfqPick.value },
    });
  } catch (e) {
    surfaceError(e, '하위 발주에 실패했습니다.');
  }
}
const selectableChildRfqs = computed(
  () => detail.value?.childRfqs.filter((r) => r.priceOriginal !== null) ?? [],
);

// ── P3 선적 — 발송 준비/핑퐁/입고확인/첨부/상업송장 ──────────────────────────
const ship = computed(() => detail.value?.shipment ?? null);
const shipMode = computed(() => ship.value?.mode ?? 'international');
const shipNext = computed(() =>
  ship.value === null ? null : bomShipmentNextStatus(shipMode.value, ship.value.status),
);
const shipNextActor = computed(() =>
  shipNext.value === null ? null : bomShipmentActorOf(shipMode.value, shipNext.value),
);
// 발송 조작은 [📦 PCB 보내기] 보드가 단일 창구(§9 재구성 후속) — 수주(보내는측) 발송
// 섹션은 읽기 요약+보드 링크만 남긴다. 받는측(MD 입고) 액션은 "발주한 하위 건"의
// 자리이므로 이 상세에 유지한다.
const isMdReceiverView = computed(
  () =>
    detail.value?.direction === 'issued' &&
    ship.value !== null &&
    ship.value.receiverKind === 'md',
);
// 받는측 전이(국내 '입고 완료'·국제 선적 이후 단계) — MD 조직이 ADMIN 측을 맡는다.
const receiverCanAdvance = computed(() => isMdReceiverView.value && shipNextActor.value === 'ADMIN');
const receiverCanReceive = computed(
  () =>
    isMdReceiverView.value &&
    ship.value !== null &&
    ship.value.status !== 'preparing' &&
    ship.value.receivedAt === null,
);
const shipAdvance = usePartnerPcbShipmentAdvance(); // 받는측(MD) 전이 전용
const shipReceive = usePartnerPcbShipmentReceive();
// 받는측(MD) 전이 — 국내 '입고 완료', 국제 '선적'(AWB 트래킹) 이후 단계.
async function runReceiverAdvance(): Promise<void> {
  if (poId.value === null || ship.value === null || shipNext.value === null) return;
  let body: { trackingNumber?: string } = {};
  if (shipNext.value === 'shipped') {
    const tn = window.prompt('트래킹 번호(AWB/BL)');
    if (tn === null || tn.trim() === '') return;
    body = { trackingNumber: tn.trim() };
  }
  actionError.value = '';
  try {
    await shipAdvance.mutateAsync({ poId: poId.value, body });
  } catch (e) {
    surfaceError(e, '진행에 실패했습니다.');
  }
}
async function runShipReceive(): Promise<void> {
  if (poId.value === null) return;
  const note = window.prompt('입고 확인 메모(수량 부족·불량 등 — 없으면 비워두세요)');
  if (note === null) return;
  actionError.value = '';
  try {
    await shipReceive.mutateAsync({ poId: poId.value, note: note.trim() === '' ? null : note.trim() });
  } catch (e) {
    surfaceError(e, '입고 확인에 실패했습니다.');
  }
}
const SHIP_STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

const STATUS_CLS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-700',
  eq_requested: 'bg-amber-100 text-amber-700',
  eq_done: 'bg-sky-100 text-sky-700',
  producing: 'bg-indigo-100 text-indigo-700',
  produced: 'bg-emerald-100 text-emerald-700',
};
// 명칭·순서는 레거시 정본(lib/pcb-spec.ts, estimate_form_ca10 승계).
const specEntries = computed(() => pcbSpecEntries((detail.value?.spec.specJson ?? {})));
</script>

<template>
  <div class="pcb-readable space-y-5">
    <RouterLink :to="{ name: 'partner' }" class="text-sm text-gray-400 hover:text-gray-700">
      ← 파트너 홈
    </RouterLink>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else-if="detail !== null">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-bold">{{ detail.spec.projectName }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLS[detail.status]">
          {{ PCB_PO_STATUS_LABELS[detail.status] }}
        </span>
        <span class="text-sm text-gray-500">
          {{ detail.direction === 'received' ? '발주처' : '하위 발주' }}: {{ detail.requesterName }}
        </span>
      </div>

      <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{{ actionError }}</p>

      <!-- 발주 조건 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">발주 조건</h2>
        <dl class="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          <div class="flex justify-between">
            <dt class="text-gray-500">발주가</dt>
            <dd class="font-bold tabular-nums">{{ pcbMoneyWithSub(detail.currency, detail.priceOriginal, detail.subCurrency, detail.subPriceOriginal) }}</dd>
          </div>
          <div class="flex justify-between"><dt class="text-gray-500">결제조건</dt><dd>{{ detail.paymentTerms ?? '—' }}</dd></div>
          <div class="flex justify-between">
            <dt class="text-gray-500">수금</dt>
            <dd :class="remitStatusCls">{{ remitStatusText }}</dd>
          </div>
          <div class="flex justify-between"><dt class="text-gray-500">납기</dt><dd>{{ dateOnly(detail.deliveryDate) }}</dd></div>
        </dl>
        <p v-if="detail.memo !== null && detail.memo !== ''" class="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{{ detail.memo }}</p>

        <!-- 수금 내역(P3.11) — 부분 송금이 있으므로 건별로 보여준다. 이 발주서 건만 보인다. -->
        <div v-if="remitSummary !== null && remitSummary.count > 0" class="mt-3 rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
              <tr>
                <th class="px-3 py-1.5">입금일</th>
                <th class="px-3 py-1.5 text-right">금액</th>
                <th class="px-3 py-1.5">메모</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="r in detail.remittances" :key="r.id">
                <td class="whitespace-nowrap px-3 py-1.5 text-gray-600">{{ dateOnly(r.remittedOn) }}</td>
                <td class="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-gray-800">
                  {{ fmtPcbAmount(r.currency, r.amount) }}
                </td>
                <td class="px-3 py-1.5 text-xs text-gray-500">{{ r.memo ?? '—' }}</td>
              </tr>
            </tbody>
            <tfoot v-if="remitSummary !== null && remitSummary.balance > 0" class="border-t border-gray-200 bg-amber-50">
              <tr>
                <td class="px-3 py-1.5 text-xs font-semibold text-amber-800">미수금</td>
                <td class="whitespace-nowrap px-3 py-1.5 text-right font-bold tabular-nums text-amber-800">
                  {{ fmtPcbAmount(remitSummary.currency, remitSummary.balance) }}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- EQ 진행 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">EQ · 생산 진행</h2>

        <!-- 스텝퍼 -->
        <ol class="mt-3 flex flex-wrap items-center gap-1">
          <template v-for="(step, i) in steps" :key="step">
            <li
              class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="i < stepIndex ? 'bg-emerald-50 text-emerald-700' : i === stepIndex ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'"
            >
              <span v-if="i < stepIndex">✓</span>{{ PCB_PO_STATUS_LABELS[step] }}
            </li>
            <span v-if="i < steps.length - 1" class="text-gray-300">→</span>
          </template>
        </ol>

        <!-- 경유/차단 안내 -->
        <p v-if="detail.eq.delegatePoId !== null" class="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
          MD 경유 발주 건입니다 — EQ·생산 진행은
          <RouterLink :to="{ name: 'partner-pcb-po', params: { id: String(detail.eq.delegatePoId) } }" class="font-bold underline">
            하위 발주서
          </RouterLink>에서 진행됩니다(이 문서는 자동 반영).
        </p>
        <p v-else-if="detail.eq.blocked" class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          하위 협력사에 발주하면 EQ가 시작됩니다 — 아래 [하위 발주]를 진행해 주세요.
        </p>

        <!-- 파일 (발주접수 단계에서 편집) -->
        <div v-if="detail.eq.delegatePoId === null && !detail.eq.blocked" class="mt-4 grid gap-3 sm:grid-cols-2">
          <div v-for="kind in (['eq', 'working'] as const)" :key="kind" class="rounded-lg border border-gray-100 p-3">
            <div class="flex items-center justify-between">
              <p class="text-xs font-bold text-gray-600">
                {{ kind === 'eq' ? 'EQ 파일 (질의서)' : 'Working 파일 (작업 데이터)' }}
                <span v-if="(kind === 'eq' && !hasEqFile) || (kind === 'working' && !hasWorkingFile)" class="ml-1 font-semibold text-amber-600">필수</span>
              </p>
              <button
                v-if="filesEditable && detail.eq.myRole === 'RECEIVER'"
                type="button"
                class="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                :disabled="upload.isPending.value"
                @click="pickAndUpload(kind)"
              >
                ⬆ 업로드
              </button>
            </div>
            <ul class="mt-2 space-y-1">
              <li
                v-for="f in detail.eq.files.filter((x) => x.fileType === kind)"
                :key="f.fileId"
                class="flex items-center gap-2 text-xs text-gray-600"
              >
                <button type="button" class="truncate font-medium text-blue-700 hover:underline" @click="void downloadPartnerPcbEqFile(detail.poId, f.fileId, f.name)">
                  {{ f.name }}
                </button>
                <span class="text-gray-300">{{ (f.size / 1024).toFixed(0) }}KB</span>
                <button
                  v-if="filesEditable && detail.eq.myRole === 'RECEIVER'"
                  type="button"
                  class="text-gray-300 hover:text-red-600"
                  aria-label="파일 삭제"
                  @click="void deleteFile(f.fileId)"
                >
                  ✕
                </button>
              </li>
              <li v-if="detail.eq.files.filter((x) => x.fileType === kind).length === 0" class="text-xs text-gray-300">
                아직 없음
              </li>
            </ul>
          </div>
        </div>

        <!-- 액션 -->
        <div v-if="detail.eq.delegatePoId === null && !detail.eq.blocked" class="mt-4 flex flex-wrap items-center gap-2">
          <button
            v-if="canForward && forward !== null"
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            :class="detail.eq.fallback ? 'border border-indigo-300 bg-indigo-500 hover:bg-indigo-600' : 'bg-blue-600 hover:bg-blue-700'"
            :disabled="busy || (detail.status === 'issued' && (!hasEqFile || !hasWorkingFile))"
            @click="void runForward()"
          >
            {{ detail.eq.fallback ? `(MD 대행) ${forward.label}` : forward.label }}
          </button>
          <p v-if="detail.status === 'issued' && (!hasEqFile || !hasWorkingFile)" class="text-xs text-amber-600">
            EQ·Working 파일을 모두 올려야 승인요청할 수 있습니다.
          </p>
          <p v-else-if="detail.status === 'eq_requested'" class="text-sm text-gray-500">
            샘플피씨비 관리자의 EQ 승인을 기다리고 있습니다.
          </p>
          <button
            v-if="canRevert && revert !== null"
            type="button"
            class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            :disabled="busy"
            @click="void runRevert()"
          >
            ↩ {{ revert.label }}
          </button>
        </div>

        <!-- 이력 -->
        <details v-if="detail.eq.history.length > 0" class="mt-4 rounded-lg border border-gray-100">
          <summary class="cursor-pointer px-3 py-2 text-xs font-bold text-gray-500">진행 이력 ({{ detail.eq.history.length }})</summary>
          <ul class="space-y-1 px-3 pb-3 text-xs text-gray-500">
            <li v-for="(ev, i) in [...detail.eq.history].reverse()" :key="i">
              {{ ev.at.slice(0, 16).replace('T', ' ') }} · {{ ev.byRole }} ·
              {{ PCB_PO_STATUS_LABELS[ev.fromStatus as keyof typeof PCB_PO_STATUS_LABELS] ?? ev.fromStatus }}
              → {{ PCB_PO_STATUS_LABELS[ev.toStatus as keyof typeof PCB_PO_STATUS_LABELS] ?? ev.toStatus }}
              <b v-if="ev.note !== null && ev.note !== ''" class="text-red-600">— {{ ev.note }}</b>
            </li>
          </ul>
        </details>
      </section>

      <!-- P3 선적 — 발송 준비/핑퐁/입고확인 -->
      <section
        v-if="detail.canShip || detail.outboundBlocked || detail.shipment !== null"
        class="rounded-xl border border-teal-200 bg-surface p-4"
      >
        <h2 class="text-sm font-bold text-teal-700">
          발송 · 선적
          <span v-if="ship !== null" class="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold" :class="SHIP_STATUS_CLS[ship.status]">
            {{ bomShipmentStatusLabel(ship.mode, ship.status) }}
          </span>
          <span v-if="ship !== null" class="ml-1 text-xs font-normal text-gray-400">
            {{ ship.mode === 'domestic' ? '국내(택배)' : '국제' }} · 받는 곳 {{ ship.receiverName }}
            <template v-if="ship.destinationCountry !== null"> · 직송 {{ ship.destinationCountry }}</template>
          </span>
        </h2>

        <p v-if="detail.outboundBlocked" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          하위 협력사 물품의 입고 확인이 끝나야 출고할 수 있습니다.
        </p>

        <!-- 담기·발송 조작은 보드가 단일 창구(§9 재구성 후속) — 여기서는 안내만 -->
        <RouterLink
          v-if="detail.canShip && ship === null"
          :to="{ name: 'partner-pcb-ship' }"
          class="mt-3 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
        >
          📦 PCB 보내기에서 담아 발송 →
        </RouterLink>

        <template v-if="ship !== null">
          <!-- 스텝퍼 -->
          <ol class="mt-3 flex flex-wrap items-center gap-1">
            <template v-for="(step, i) in bomShipmentStatusesOf(ship.mode)" :key="step">
              <li
                class="rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="bomShipmentStatusesOf(ship.mode).indexOf(ship.status) > i ? 'bg-emerald-50 text-emerald-700' : bomShipmentStatusesOf(ship.mode).indexOf(ship.status) === i ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400'"
              >
                {{ bomShipmentStatusLabel(ship.mode, step) }}
              </li>
              <span v-if="i < bomShipmentStatusesOf(ship.mode).length - 1" class="text-gray-300">→</span>
            </template>
          </ol>
          <p v-if="ship.receivedAt !== null" class="mt-1.5 text-xs font-semibold text-emerald-700">
            입고 확인 완료 {{ dateOnly(ship.receivedAt) }}
            <template v-if="ship.receivedNote !== null && ship.receivedNote !== ''"> — 메모: {{ ship.receivedNote }}</template>
          </p>
          <p v-if="ship.trackingNumber !== null" class="mt-1 text-xs text-gray-500">
            운송장: {{ ship.carrier ?? '' }} {{ ship.trackingNumber }}
          </p>

          <!-- 이 발송의 묶음 구성(읽기) — 담기·꺼내기·전이·서류는 [📦 PCB 보내기]에서 -->
          <div class="mt-3 rounded-lg border border-gray-100 p-3">
            <p class="text-xs font-semibold text-gray-500">
              이 발송에 담긴 발주서 ({{ ship.groupPos.length }})
            </p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="g in ship.groupPos" :key="g.poId" class="flex items-center gap-2 text-xs">
                <span
                  class="min-w-0 flex-1 truncate"
                  :class="g.poId === detail.poId ? 'font-bold text-gray-900' : 'text-gray-700'"
                >
                  {{ g.projectName }}<span v-if="g.poId === detail.poId" class="font-normal text-gray-400"> — 이 발주서</span>
                </span>
                <span class="shrink-0 text-gray-400">{{ fmtPcbAmount(g.currency, g.priceOriginal) }}</span>
              </li>
            </ul>
          </div>

          <!-- 보내는측 — 조작은 보드 단일 창구 -->
          <RouterLink
            v-if="detail.direction === 'received' && shipNext !== null"
            :to="{ name: 'partner-pcb-ship' }"
            class="mt-3 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
          >
            📦 발송 진행·서류는 PCB 보내기에서 →
          </RouterLink>

          <!-- MD 받는측 — 전이·입고확인 -->
          <div v-if="receiverCanAdvance || receiverCanReceive" class="mt-3 flex flex-wrap gap-2">
            <button
              v-if="receiverCanAdvance && shipNext !== null"
              type="button"
              class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
              :disabled="shipAdvance.isPending.value"
              @click="void runReceiverAdvance()"
            >
              {{ bomShipmentStatusLabel(ship.mode, shipNext) }} 처리
            </button>
            <button
              v-if="receiverCanReceive"
              type="button"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              :disabled="shipReceive.isPending.value"
              @click="void runShipReceive()"
            >
              입고 확인(수령)
            </button>
          </div>

          <!-- 첨부 열람(읽기) — 업로드·상업송장 생성은 보드의 발송 카드에서 -->
          <div v-if="ship.files.length > 0" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <template v-for="f in ship.files" :key="f.fileId">
              <button
                type="button"
                class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                @click="void downloadPartnerPcbShipmentFile(detail.poId, f.fileId, f.name)"
              >
                ⬇ {{ BOM_SHIPMENT_FILE_LABELS[f.fileType] }}
              </button>
            </template>
          </div>
        </template>
      </section>

      <!-- MD — 하위 발주 -->
      <section
        v-if="detail.direction === 'received' && (detail.children.length > 0 || selectableChildRfqs.length > 0)"
        class="rounded-xl border border-indigo-200 bg-surface p-4"
      >
        <h2 class="text-sm font-bold text-indigo-700">하위 협력사 발주 (마스터딜러)</h2>

        <div v-if="detail.children.length > 0" class="mt-3 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2">하위 협력사</th>
                <th class="px-3 py-2">상태</th>
                <th class="whitespace-nowrap px-3 py-2">발주가</th>
                <th class="whitespace-nowrap px-3 py-2">납기</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="child in detail.children" :key="child.poId">
                <td class="px-3 py-2 font-medium text-gray-800">{{ child.partnerName }}</td>
                <td class="px-3 py-2">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[child.status]">
                    {{ PCB_PO_STATUS_LABELS[child.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 tabular-nums">
                  {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ dateOnly(child.deliveryDate) }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <RouterLink
                    :to="{ name: 'partner-pcb-po', params: { id: String(child.poId) } }"
                    class="rounded-md border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    EQ 진행 →
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="detail.children.length === 0 && selectableChildRfqs.length > 0" class="mt-3 flex flex-wrap items-center gap-2">
          <select v-model="childRfqPick" class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
            <option :value="null" disabled>발주할 하위 회신 선택</option>
            <option v-for="rfq in selectableChildRfqs" :key="rfq.rfqId" :value="rfq.rfqId">
              {{ rfq.partnerName }} — {{ fmtPcbAmount(rfq.currency, rfq.priceOriginal) }}
              ({{ PCB_RFQ_STATUS_LABELS[rfq.status] }})
            </option>
          </select>
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            :disabled="childPo.isPending.value || childRfqPick === null"
            @click="void issueChildPo()"
          >
            하위 발주
          </button>
          <span class="text-xs text-gray-400">선정(selected) 회신이 기본 후보입니다 — 발주 시 EQ가 하위에서 시작됩니다.</span>
        </div>
      </section>

      <!-- 제작 사양 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ detail.spec.category }} · {{ detail.spec.orderCategory === 'mass' ? '양산' : '샘플' }} · {{ detail.spec.qty }}매
        </p>
        <div v-if="detail.spec.files.length > 0" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="f in detail.spec.files"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadPartnerPcbPoSpecFile(detail.poId, f.fileId, f.name)"
          >
            ⬇ {{ f.name }}
          </button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
            <dt class="text-gray-400">{{ entry.label }}</dt>
            <dd class="truncate font-medium text-gray-700">{{ entry.value }}</dd>
          </div>
        </dl>
        <p v-if="detail.spec.message !== null && detail.spec.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.spec.message }}
        </p>
      </section>
    </template>

    <div v-else class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      발주서를 찾을 수 없습니다.
    </div>
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
