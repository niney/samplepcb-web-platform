<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PART_EVENT_LABELS,
  BOM_PART_PACKAGE_STATUS_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type AdminBomPartPackageActionBodyType,
} from '@sp/api-contract';
import { useAdminBomPackage, useAdminBomPackageAction } from '../../admin/useAdminBomPos';
import { confirmDialog } from '../../lib/confirmDialog';

// QR 스캔 도착 화면(D24) — URL token 또는 라벨의 human code를 서버에서 조회한다.
// token은 권한이 아니며 이 라우트와 API 모두 관리자 인증 뒤에만 접근 가능하다.

const route = useRoute();
const code = computed(() => {
  const raw = route.params.code;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
});
const query = useAdminBomPackage(code);
const detail = computed(() => query.data.value?.data ?? null);
const mutation = useAdminBomPackageAction();

const location = ref('');
const note = ref('');
const actionError = ref('');

watch(
  () => detail.value?.storageLocation,
  (value) => {
    location.value = value ?? '';
  },
  { immediate: true },
);

const loadError = computed(() => {
  const cause = query.error.value;
  if (cause === null) return '';
  return cause instanceof ApiRequestError ? cause.message : 'QR 포장을 조회하지 못했습니다.';
});

const canReceive = computed(() => detail.value?.status === 'prepared');
const canInspect = computed(() => detail.value?.status === 'received');
const canStore = computed(() =>
  detail.value === null ? false : ['received', 'inspected', 'stored'].includes(detail.value.status),
);
const canIssue = computed(() =>
  detail.value === null ? false : ['received', 'inspected', 'stored'].includes(detail.value.status),
);

async function submit(action: AdminBomPartPackageActionBodyType['action']): Promise<void> {
  if (code.value === null || detail.value === null || mutation.isPending.value) return;
  actionError.value = '';
  if (action === 'store' && location.value.trim() === '') {
    actionError.value = '보관 위치를 입력해 주세요.';
    return;
  }
  if (
    action === 'issue' &&
    !(await confirmDialog(`${detail.value.labelCode} 포장을 자재 출고 처리할까요?`))
  ) {
    return;
  }
  try {
    await mutation.mutateAsync({
      code: code.value,
      body: {
        action,
        location: action === 'store' ? location.value.trim() : null,
        note: note.value.trim() === '' ? null : note.value.trim(),
      },
    });
    note.value = '';
  } catch (cause) {
    actionError.value =
      cause instanceof ApiRequestError ? cause.message : '추적 상태를 변경하지 못했습니다.';
  }
}

const fmtDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('ko-KR', { hour12: false });
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-5">
    <div class="flex flex-wrap items-center gap-2">
      <div>
        <p class="text-xs font-semibold text-emerald-700">부품 QR 추적</p>
        <h1 class="text-xl font-extrabold">실물 포장 조회</h1>
      </div>
      <RouterLink
        :to="{ name: 'admin-smartbom-logistics' }"
        class="ml-auto rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
      >
        ← 선적·배송
      </RouterLink>
    </div>

    <p
      v-if="query.isFetching.value"
      class="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-400"
    >
      QR 포장을 조회하는 중…
    </p>
    <p
      v-else-if="loadError !== ''"
      class="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center text-sm font-semibold text-red-700"
    >
      {{ loadError }}
    </p>

    <template v-else-if="detail !== null">
      <section class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div class="flex flex-wrap items-start gap-3 border-b border-gray-100 bg-gray-50 px-5 py-4">
          <div>
            <p class="font-mono text-xs font-bold text-gray-500">{{ detail.labelCode }}</p>
            <h2 class="mt-1 font-mono text-2xl font-black text-gray-950">{{ detail.item.mpn }}</h2>
            <p class="text-sm text-gray-500">{{ detail.item.manufacturerName ?? '제조사 미상' }}</p>
            <p v-if="detail.item.description !== null" class="mt-1 max-w-2xl text-xs text-gray-500">
              {{ detail.item.description }}
            </p>
            <p v-if="detail.item.partId !== null" class="mt-1 text-[10px] text-gray-400">
              내부 부품 ID {{ detail.item.partId }}
            </p>
          </div>
          <span
            class="ml-auto rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800"
          >
            {{ BOM_PART_PACKAGE_STATUS_LABELS[detail.status] }}
          </span>
        </div>

        <div class="grid gap-px bg-gray-200 sm:grid-cols-2 lg:grid-cols-3">
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">포장 수량</p>
            <p class="mt-1 text-lg font-extrabold tabular-nums">
              {{ detail.quantity.toLocaleString('ko-KR') }}
            </p>
            <p class="text-xs text-gray-400">
              발주 품목 {{ detail.item.expectedQty.toLocaleString('ko-KR') }}
            </p>
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">LOT / DATE CODE</p>
            <p class="mt-1 font-mono text-sm font-bold">{{ detail.lotNo ?? '—' }}</p>
            <p class="font-mono text-xs text-gray-500">{{ detail.dateCode ?? '—' }}</p>
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">보관 위치</p>
            <p class="mt-1 text-sm font-bold">{{ detail.storageLocation ?? '미지정' }}</p>
          </div>
          <div class="bg-white p-4">
            <p class="text-[10px] font-bold uppercase text-gray-400">협력사·선적</p>
            <p class="mt-1 text-sm font-bold">{{ detail.shipment.partnerName }}</p>
            <p class="text-xs text-gray-500">
              {{ detail.shipment.packingNo }} · {{ BOM_SHIPMENT_MODE_LABELS[detail.shipment.mode] }}
              {{ bomShipmentStatusLabel(detail.shipment.mode, detail.shipment.status) }}
            </p>
          </div>
          <div class="bg-white p-4 sm:col-span-2">
            <p class="text-[10px] font-bold uppercase text-gray-400">발주·Case</p>
            <p class="mt-1 text-sm font-bold">
              PO #{{ detail.po.poId }} · {{ detail.po.quoteTitle }}
            </p>
            <RouterLink
              :to="{
                name: 'admin-smartbom-case',
                params: { id: detail.po.quoteId },
                query: { from: 'logistics' },
              }"
              class="mt-1 inline-block text-xs font-semibold text-blue-700 hover:underline"
            >
              Case 열기 →
            </RouterLink>
          </div>
        </div>
      </section>

      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-extrabold">입고·검수·보관 처리</h2>
        <p class="mt-1 text-xs leading-5 text-gray-500">
          QR은 포장을 식별합니다. 제조사 라벨·수량·LOT/DATE CODE를 실물과 대조한 뒤 처리하세요.
        </p>
        <label class="mt-4 block text-xs font-semibold text-gray-600">처리 메모
          <textarea
            v-model="note"
            rows="2"
            maxlength="2000"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder="파손·수량 편차·검수 결과 등"
          />
        </label>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-if="canReceive"
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="mutation.isPending.value"
            @click="submit('receive')"
          >
            입고 처리
          </button>
          <button
            v-if="canInspect"
            type="button"
            class="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-40"
            :disabled="mutation.isPending.value"
            @click="submit('inspect')"
          >
            검수 완료
          </button>
          <div v-if="canStore" class="flex min-w-72 flex-1 gap-2">
            <input
              v-model="location"
              type="text"
              maxlength="191"
              class="h-10 min-w-0 flex-1 rounded-lg border border-gray-300 px-3 text-sm"
              placeholder="보관 위치 예: A-03-02"
            >
            <button
              type="button"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              :disabled="mutation.isPending.value"
              @click="submit('store')"
            >
              위치 저장
            </button>
          </div>
          <button
            v-if="canIssue"
            type="button"
            class="rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-900 disabled:opacity-40"
            :disabled="mutation.isPending.value"
            @click="submit('issue')"
          >
            자재 출고
          </button>
        </div>
        <p v-if="actionError !== ''" class="mt-2 text-xs font-semibold text-red-600">
          {{ actionError }}
        </p>
        <p
          v-if="!canReceive && !canInspect && !canStore && !canIssue"
          class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500"
        >
          현재 상태에서는 추가 처리할 작업이 없습니다.
        </p>
      </section>

      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 class="text-sm font-extrabold">추적 이력</h2>
        <ol class="mt-4 space-y-3 border-l-2 border-emerald-100 pl-4">
          <li v-for="event in [...detail.events].reverse()" :key="event.eventId" class="relative">
            <span
              class="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-4 ring-white"
            />
            <div class="flex flex-wrap items-baseline gap-2">
              <p class="text-sm font-bold">{{ BOM_PART_EVENT_LABELS[event.eventType] }}</p>
              <p class="text-[10px] text-gray-400">{{ fmtDateTime(event.occurredAt) }}</p>
            </div>
            <p class="text-xs text-gray-500">
              {{ event.actorType
              }}<template v-if="event.actorMbId !== null"> · {{ event.actorMbId }}</template>
              <template v-if="event.location !== null"> · 위치 {{ event.location }}</template>
              <template v-if="event.quantity !== null">
                · 수량 {{ event.quantity.toLocaleString('ko-KR') }}
              </template>
            </p>
            <p v-if="event.note !== null && event.note !== ''" class="mt-0.5 text-xs text-gray-600">
              {{ event.note }}
            </p>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
