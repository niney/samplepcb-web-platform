<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  PCB_PO_STATUS_LABELS,
  type PartnerPcbShipBoxType,
} from '@sp/api-contract';
import {
  usePartnerPcbShipBoard,
  usePartnerPcbShipBox,
  usePartnerPcbShipmentDetach,
} from '../../partner/usePartnerPcbPos';
import PcbShipmentCard from '../../components/pcb/PcbShipmentCard.vue';
import { fmtPcbAmount } from '../../lib/pcb-money';

// [📦 PCB 보내기](§9 묶음 재구성) — BOM §6.11 두 칸 이동 UI 의 PCB 일반화.
// BOM 과 달리 받는 곳이 갈릴 수 있어(관리자/직송 KR·CN·VN/MD) 박스는 컨텍스트당
// 1개다. [담기]는 서버가 컨텍스트를 해석해 같은 박스에 합류시키거나 새로 만들고,
// 규칙은 하나 — "발송 전(preparing)엔 자유"(꺼내면 승계·비면 소멸, 대표 개념 은닉).
// 발송 서류(Invoice)·전이·진행 추적까지 **이 화면이 발송 조작의 단일 창구**다
// (BOM 동형 — 상세는 읽기 요약만). 박스 확정 → 같은 화면에서 카드로 전개.

const boardQuery = usePartnerPcbShipBoard();
const boxMut = usePartnerPcbShipBox();
const detachMut = usePartnerPcbShipmentDetach();

const error = ref('');
const board = computed(() => boardQuery.data.value?.data ?? null);
const shelf = computed(() => board.value?.shelf ?? []);
const producing = computed(() => board.value?.producing ?? []);
const boxes = computed(() => board.value?.boxes ?? []);
const active = computed(() => board.value?.active ?? []);

const busy = computed(() => boxMut.isPending.value || detachMut.isPending.value);

// 서류·발송 단계로 전개된 박스(BOM readyMode 미러) — 박스가 사라지면(발송 시작·소멸) 해제.
const readyBoxId = ref<number | null>(null);
const readyBox = computed(
  () => boxes.value.find((b) => b.shipmentId === readyBoxId.value) ?? null,
);

const boxTotal = (box: PartnerPcbShipBoxType): string => {
  const currency = box.groupPos[0]?.currency ?? 'KRW';
  const sum = box.groupPos.reduce((acc, po) => acc + po.priceOriginal, 0);
  return fmtPcbAmount(currency, sum);
};

async function putIn(poId: number): Promise<void> {
  error.value = '';
  try {
    await boxMut.mutateAsync({ poId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '담기에 실패했습니다.';
  }
}

async function takeOut(poId: number): Promise<void> {
  error.value = '';
  try {
    await detachMut.mutateAsync({ poId });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '꺼내기에 실패했습니다.';
  }
}
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 홈
      </RouterLink>
      <h1 class="text-xl font-bold">📦 PCB 보내기</h1>
      <p class="text-sm text-gray-400">
        생산완료된 발주서를 박스로 옮기고, 다 담았으면 발송을 진행하세요. 받는 곳이 같은 것끼리 묶입니다.
      </p>
    </div>

    <p v-if="error !== ''" class="text-sm font-semibold text-red-600">{{ error }}</p>

    <div v-if="board === null" class="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
    <template v-else>
      <!-- 서류·발송 단계 — 박스 확정 후 같은 화면에서 카드 전개(BOM readyMode 미러) -->
      <template v-if="readyBox !== null">
        <button type="button" class="text-sm text-teal-700 underline" @click="readyBoxId = null">
          ← 박스에 더 담기 / 꺼내기
        </button>
        <PcbShipmentCard :shipment="readyBox" />
      </template>

      <!-- 두 칸: 선반 ↔ 박스 -->
      <div v-else class="grid gap-4 lg:grid-cols-2">
        <!-- 선반 -->
        <section class="rounded-xl border border-gray-200 bg-surface p-4">
          <h2 class="text-sm font-bold text-gray-700">
            보낼 물건 <span class="font-normal text-gray-400">({{ shelf.length }}건)</span>
          </h2>
          <div class="mt-2 space-y-2">
            <div
              v-for="po in shelf"
              :key="po.poId"
              class="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-3"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-gray-900">{{ po.projectName }}</p>
                <p class="text-sm text-gray-500">
                  {{ po.qty.toLocaleString('ko-KR') }}pcs · {{ fmtPcbAmount(po.currency, po.priceOriginal) }}
                  <span class="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">
                    → {{ po.receiverLabel }}
                  </span>
                  <span v-if="po.reorderRound > 0" class="ml-1 text-[11px] text-gray-400">A/S {{ po.reorderRound }}회차</span>
                </p>
                <p v-if="!po.countryReady" class="mt-0.5 text-xs font-semibold text-red-600">
                  국가 정보 필요 — 샘플피씨비 담당자에게 문의해 주세요.
                </p>
                <p v-else-if="po.outboundBlocked" class="mt-0.5 text-xs font-semibold text-amber-600">
                  하위 협력사 입고 확인이 끝나야 담을 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                class="shrink-0 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
                :disabled="busy || !po.countryReady || po.outboundBlocked"
                @click="putIn(po.poId)"
              >
                담기 →
              </button>
            </div>
            <p
              v-if="shelf.length === 0"
              class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400"
            >
              {{ boxes.length === 0 ? '보낼 수 있는 발주서가 없습니다 — 생산완료 후 여기에 나타납니다.' : '전부 박스에 담겼습니다.' }}
            </p>
          </div>

          <!-- 곧 보낼 물건(읽기) — BOM 은 확인 즉시 선반이지만 PCB 는 생산완료가 담기 조건.
               확인~생산완료 구간의 발송 가시성을 여기서 준다(일관성 보완). -->
          <div v-if="producing.length > 0" class="mt-4 border-t border-gray-100 pt-3">
            <p class="text-xs font-semibold text-gray-500">
              곧 보낼 물건 <span class="font-normal text-gray-400">({{ producing.length }}건 생산 진행 중 — 생산완료되면 위로 올라옵니다)</span>
            </p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="po in producing" :key="po.poId" class="flex items-center gap-2 text-xs">
                <RouterLink
                  :to="{ name: 'partner-pcb-po', params: { id: String(po.poId) } }"
                  class="min-w-0 flex-1 truncate text-gray-500 hover:text-teal-700 hover:underline"
                >
                  {{ po.projectName }}
                </RouterLink>
                <span class="shrink-0 text-gray-400">{{ po.qty.toLocaleString('ko-KR') }}pcs</span>
                <span class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500">
                  {{ PCB_PO_STATUS_LABELS[po.status] }}
                </span>
              </li>
            </ul>
          </div>
        </section>

        <!-- 박스(컨텍스트당 1개) -->
        <section
          class="rounded-xl border-2 border-dashed p-4"
          :class="boxes.length === 0 ? 'border-gray-200 bg-gray-50/50' : 'border-teal-300 bg-teal-50/40'"
        >
          <h2 class="text-sm font-bold" :class="boxes.length === 0 ? 'text-gray-500' : 'text-teal-800'">
            📦 박스 (이번 발송)
            <span v-if="boxes.length > 1" class="font-normal text-teal-600">— 받는 곳별 {{ boxes.length }}개</span>
          </h2>

          <p
            v-if="boxes.length === 0"
            class="mt-2 rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-400"
          >
            비어 있습니다 — 왼쪽에서 [담기 →]를 눌러 옮겨 주세요.
          </p>

          <div v-for="box in boxes" :key="box.shipmentId" class="mt-2 rounded-xl border border-teal-200 bg-surface p-3">
            <p class="text-xs font-bold text-teal-800">
              → {{ box.receiverName }}
              <template v-if="box.destinationCountry !== null"> · 직송 {{ box.destinationCountry }}</template>
              <span class="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">
                {{ BOM_SHIPMENT_MODE_LABELS[box.mode] }}
              </span>
              <span class="ml-1 font-normal text-gray-400">{{ box.groupPos.length }}건 담김</span>
            </p>
            <div class="mt-2 space-y-1.5">
              <div
                v-for="po in box.groupPos"
                :key="po.poId"
                class="flex items-center gap-3 rounded-lg border border-teal-100 px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-semibold text-gray-900">{{ po.projectName }}</p>
                  <p class="text-xs text-gray-500">
                    {{ po.qty.toLocaleString('ko-KR') }}pcs · {{ fmtPcbAmount(po.currency, po.priceOriginal) }}
                  </p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                  :disabled="busy"
                  @click="takeOut(po.poId)"
                >
                  ← 꺼내기
                </button>
              </div>
            </div>
            <div class="mt-2 flex items-center justify-between border-t border-teal-100 pt-2">
              <p class="text-sm text-gray-600">
                합계 <b>{{ boxTotal(box) }}</b>
              </p>
              <button
                type="button"
                class="rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-teal-700"
                @click="readyBoxId = box.shipmentId"
              >
                이 박스로 발송 준비 →
                {{ box.mode === 'domestic' ? '(택배 정보)' : '(Invoice·출고예정일)' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- 진행 중 발송 — 카드에서 바로 전이·서류·되돌리기 -->
      <section v-if="active.length > 0">
        <h2 class="text-sm font-bold text-gray-700">진행 중 발송 ({{ active.length }})</h2>
        <div class="mt-2 space-y-3">
          <PcbShipmentCard v-for="s in active" :key="s.shipmentId" :shipment="s" />
        </div>
      </section>

      <p v-if="board.doneCount > 0" class="text-xs text-gray-400">
        완료된 발송 {{ board.doneCount }}건 — 발주서 상세에서 확인할 수 있습니다.
      </p>
    </template>
  </div>
</template>
