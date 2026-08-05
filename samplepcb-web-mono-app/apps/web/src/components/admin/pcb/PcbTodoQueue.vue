<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AdminPcbCaseTabType } from '@sp/api-contract';
import { useAdminPcbCases, type AdminPcbCaseFilters } from '../../../admin/useAdminPcbCases';
import { fmtPcbAmount } from '../../../lib/pcb-money';

// PCB 대기 큐(= 그 역할이 아직 시작하지 않은 일) — 견적요청·발주·EQ 화면의 첫 탭이
// 공유한다. 조작은 언제나 Case 상세가 전담하므로 여기서는 큐와 진입만 제공한다
// (SmartBOM 발주 워크큐의 '발주 대기' 탭과 같은 역할, 구현은 PCB 전용).

const props = defineProps<{
  /** todo_rfq(요청 대기) | todo_po(발주 대기) */
  kind: Extract<AdminPcbCaseTabType, 'todo_rfq' | 'todo_po'>;
  /** Case 상세 진입 시 붙일 ?from= (활성 메뉴·섹션 접힘 컨텍스트). */
  from: string;
  /** 행 우측 진입 버튼 문구. */
  actionLabel: string;
  emptyText: string;
}>();

const router = useRouter();
const filters = ref<AdminPcbCaseFilters>({ page: 1, pageSize: 20, tab: props.kind, q: '' });
const list = useAdminPcbCases(filters);

const rows = computed(() => list.data.value?.data.items ?? []);
const total = computed(() => list.data.value?.data.total ?? 0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / filters.value.pageSize)));

const searchText = ref('');
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};

function openCase(specId: number): void {
  void router.push({
    name: 'admin-pcb-case',
    params: { id: String(specId) },
    query: { from: props.from },
  });
}
const fmtDate = (iso: string): string => iso.slice(0, 10);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-gray-500">
        <template v-if="kind === 'todo_rfq'">
          협력사 견적요청을 아직 보내지 않은 건입니다 — 행을 열어 RFQ 패널에서 시작하세요.
        </template>
        <template v-else>
          결제가 끝났는데 발주서가 없는 건입니다 — 행을 열어 발주 패널에서 발행하세요.
        </template>
        <span class="ml-1 text-gray-400">레거시 이관 건은 이 큐에서 제외됩니다.</span>
      </p>
      <form @submit.prevent="applySearch">
        <input
          v-model="searchText"
          type="search"
          placeholder="프로젝트·회원ID·주문번호"
          class="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        >
      </form>
    </div>

    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface shadow-sm">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-4 py-2.5">견적</th>
            <th class="px-4 py-2.5">프로젝트</th>
            <th class="px-4 py-2.5">신청자</th>
            <th class="whitespace-nowrap px-4 py-2.5">수량</th>
            <th class="whitespace-nowrap px-4 py-2.5">주문</th>
            <th class="whitespace-nowrap px-4 py-2.5">확정가</th>
            <th class="whitespace-nowrap px-4 py-2.5">신청일</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr
            v-for="row in rows"
            :key="row.specId"
            class="cursor-pointer bg-amber-50/40 hover:bg-amber-50"
            @click="openCase(row.specId)"
          >
            <td class="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-gray-500">Q{{ row.specId }}</td>
            <td class="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">{{ row.projectName }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ row.mbId ?? '비회원' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">{{ row.qty }}</td>
            <td class="whitespace-nowrap px-4 py-2.5">
              <template v-if="row.odId === null">
                <span class="text-xs text-gray-400">주문 전</span>
              </template>
              <template v-else>
                <span class="font-mono text-xs text-gray-500">{{ row.odId }}</span>
                <span class="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-semibold text-sky-700">
                  {{ row.odStatus }}
                </span>
              </template>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
              {{ fmtPcbAmount('KRW', row.finalPrice) }}
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-400">{{ fmtDate(row.createdAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <button
                type="button"
                class="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700"
                @click.stop="openCase(row.specId)"
              >
                {{ actionLabel }}
              </button>
            </td>
          </tr>
          <tr v-if="rows.length === 0">
            <td colspan="8" class="px-4 py-10 text-center text-sm text-gray-400">
              {{ list.isFetching.value ? '불러오는 중…' : emptyText }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center justify-between text-sm">
      <p class="text-gray-500">총 {{ total }}건</p>
      <div v-if="totalPages > 1" class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
          :disabled="filters.page <= 1"
          @click="filters = { ...filters, page: filters.page - 1 }"
        >
          이전
        </button>
        <span class="text-gray-500">{{ filters.page }} / {{ totalPages }}</span>
        <button
          type="button"
          class="rounded-md border border-gray-300 bg-surface px-2.5 py-1 hover:bg-gray-50 disabled:opacity-40"
          :disabled="filters.page >= totalPages"
          @click="filters = { ...filters, page: filters.page + 1 }"
        >
          다음
        </button>
      </div>
    </div>
  </div>
</template>
