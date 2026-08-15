<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_CLAIM_KIND_LABELS,
  PCB_CLAIM_REMEDY_LABELS,
  PCB_CLAIM_STATUS_LABELS,
  type PcbClaimKindType,
  type PcbClaimRemedyType,
} from '@sp/api-contract';
import {
  useAdminPcbSpecClaims,
  useCreateAdminPcbClaim,
} from '../../../admin/useAdminPcbClaims';

// PCB 클레임(A/S 접수) Case 요약 스트립(P5) — 판정 콕핏은 워크큐(A/S·클레임) 한 곳
// 뿐이고(단일 창구 관례), Case 상세는 존재 신호 + 대리 접수(전화·메일 건 — spec
// 컨텍스트가 여기 있다)만 맡는다.

const props = defineProps<{ specId: number }>();

const specIdRef = computed<bigint | null>(() => BigInt(props.specId));
const claimsQuery = useAdminPcbSpecClaims(specIdRef);
const claims = computed(() => claimsQuery.data.value?.data.items ?? []);
const pending = computed(() => claimsQuery.data.value?.data.counts.pending ?? 0);

const createOpen = ref(false);
const create = useCreateAdminPcbClaim();
const kind = ref<PcbClaimKindType>('quality');
const affectedQty = ref(1);
const remedy = ref<PcbClaimRemedyType>('reproduce');
const description = ref('');
const error = ref('');

function openCreate(): void {
  kind.value = 'quality';
  affectedQty.value = 1;
  remedy.value = 'reproduce';
  description.value = '';
  error.value = '';
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  if (description.value.trim().length < 5) {
    error.value = '증상 설명을 5자 이상 입력해 주세요.';
    return;
  }
  error.value = '';
  try {
    await create.mutateAsync({
      specId: BigInt(props.specId),
      body: {
        kind: kind.value,
        affectedQty: affectedQty.value,
        requestedRemedy: remedy.value,
        description: description.value.trim(),
      },
    });
    createOpen.value = false;
  } catch (e) {
    error.value =
      e instanceof ApiRequestError ? e.message : '대리 접수에 실패했습니다.';
  }
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-surface p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-bold text-gray-700">🛠 고객 클레임(A/S 접수)</h2>
      <span v-if="pending > 0" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
        처리 필요 {{ pending }}건
      </span>
      <span v-else-if="claims.length > 0" class="text-xs text-gray-400">총 {{ claims.length }}건 · 전부 종결</span>
      <span v-else class="text-xs text-gray-400">접수 없음</span>
      <span class="ml-auto" />
      <RouterLink
        v-if="claims.length > 0"
        :to="{ name: 'admin-pcb-claims' }"
        class="rounded-md border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700 hover:bg-teal-100"
      >
        워크큐에서 처리 →
      </RouterLink>
      <button
        type="button"
        class="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        title="전화·메일로 받은 A/S 를 고객 대신 접수합니다 — 고객에게 접수 확인 메일이 나갑니다"
        @click="openCreate"
      >
        대리 접수
      </button>
    </div>
    <!-- 최근 접수 한 줄 요약 — 자세한 검토·판정은 워크큐가 단일 창구다. -->
    <ul v-if="claims.length > 0" class="mt-2 space-y-1">
      <li v-for="c in claims.slice(0, 3)" :key="c.id" class="flex flex-wrap items-center gap-2 text-xs">
        <span
          class="rounded-full px-2 py-0.5 font-bold"
          :class="c.status === 'open' ? 'bg-amber-100 text-amber-800' : c.status === 'reviewing' ? 'bg-blue-100 text-blue-800' : c.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'"
        >{{ PCB_CLAIM_STATUS_LABELS[c.status] }}</span>
        <span class="font-semibold text-gray-600">{{ PCB_CLAIM_KIND_LABELS[c.kind] }}</span>
        <span class="text-gray-500 tabular-nums">{{ c.affectedQty }}/{{ c.orderedQty }}</span>
        <span class="min-w-0 flex-1 truncate text-gray-500" :title="c.description">{{ c.description }}</span>
        <span v-if="c.asCaseId !== null" class="rounded bg-teal-50 px-1.5 py-0.5 font-semibold text-teal-700">A/S #{{ c.asCaseId }}</span>
      </li>
    </ul>

    <!-- 대리 접수 모달 — 고객 접수와 같은 게이트(배송 후·활성 1건)를 서버가 판정한다. -->
    <div v-if="createOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4" @click.self="createOpen = false">
      <div class="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl" role="dialog" aria-modal="true">
        <h3 class="text-base font-bold text-gray-800">A/S 대리 접수</h3>
        <p class="mt-1 text-xs text-gray-500">전화·메일로 받은 접수를 고객 대신 입력합니다 — 고객에게 접수 확인 메일이 나갑니다.</p>
        <div class="mt-3 grid gap-3">
          <label class="block text-xs font-semibold text-gray-500">
            문제 유형
            <select v-model="kind" class="mt-1 h-9 w-full rounded-md border border-gray-300 bg-surface px-2 text-sm">
              <option v-for="(label, value) in PCB_CLAIM_KIND_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="block text-xs font-semibold text-gray-500">
            문제 수량
            <input v-model.number="affectedQty" type="number" min="1" class="mt-1 h-9 w-full rounded-md border border-gray-300 px-3 text-sm tabular-nums">
          </label>
          <label class="block text-xs font-semibold text-gray-500">
            고객 희망 처리
            <select v-model="remedy" class="mt-1 h-9 w-full rounded-md border border-gray-300 bg-surface px-2 text-sm">
              <option v-for="(label, value) in PCB_CLAIM_REMEDY_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </label>
          <label class="block text-xs font-semibold text-gray-500">
            증상 설명 <span class="text-red-500">*</span>
            <textarea v-model="description" rows="3" maxlength="2000" placeholder="고객이 말한 증상을 그대로 적어 주세요." class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </div>
        <p v-if="error !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ error }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50" @click="createOpen = false">취소</button>
          <button
            type="button"
            class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
            :disabled="create.isPending.value"
            @click="void submitCreate()"
          >
            접수
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
