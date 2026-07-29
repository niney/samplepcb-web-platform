<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminBomRfqViewType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminPartnerList, type AdminPartnerFilters } from '../../../admin/useAdminPartners';
import { useSendBomRfqs } from '../../../admin/useAdminBomRfqs';

// 협력사 견적요청 발송 모달 — 승인 협력사(BOM 견적 트랙) 선택 → diff 발송.
// 유지분은 보존, 빠진 미회신 문서만 삭제, 신규만 메일(docs/SMARTBOM_PARTNER_RFQ.md §2.4).
// 회신(quoted) 문서는 해제해도 서버가 보존한다 — UI 에서 해제 자체를 잠근다.

const props = defineProps<{
  open: boolean;
  quoteId: string;
  itemCount: number; // 요청 부품행 수(included)
  rfqs: AdminBomRfqViewType[];
}>();
const emit = defineEmits<{ close: [] }>();

// 승인된 협력사 전체(관리 목록 재사용, capability 는 클라 필터).
const partnerFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'partner',
  q: '',
});
const { data: partnerData, isFetching } = useAdminPartnerList(partnerFilters);
const candidates = computed(() =>
  (partnerData.value?.data.items ?? []).filter((p) => p.capabilities.includes('bom_rfq')),
);

const selected = ref<Set<number>>(new Set());
const quotedPartnerIds = computed(
  () => new Set(props.rfqs.filter((r) => r.status !== 'requested').map((r) => r.partnerId)),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // 열 때 현재 발송 상태를 프리셋 — diff 의 기준 집합이 눈에 보이게.
    selected.value = new Set(props.rfqs.map((r) => r.partnerId));
    error.value = '';
  },
);

function toggle(partnerId: number): void {
  if (quotedPartnerIds.value.has(partnerId)) return; // 회신분 해제 금지
  const next = new Set(selected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  selected.value = next;
}

const send = useSendBomRfqs();
const error = ref('');

async function submit(): Promise<void> {
  error.value = '';
  if (selected.value.size === 0) {
    error.value = '협력사를 1곳 이상 선택해 주세요.';
    return;
  }
  try {
    await send.mutateAsync({
      quoteId: props.quoteId,
      body: { partnerIds: [...selected.value] },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '발송에 실패했습니다.';
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">협력사 견적요청</h2>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>
      <p class="mt-1 text-xs text-gray-500">
        요청 부품행 <b>{{ itemCount }}</b>행 · 선택한 협력사 집합으로 발송 상태를 맞춥니다
        (신규만 메일 발송, 이미 회신한 협력사는 해제할 수 없습니다).
      </p>

      <div class="mt-4 max-h-72 space-y-1 overflow-y-auto">
        <p v-if="isFetching && candidates.length === 0" class="py-6 text-center text-xs text-gray-400">불러오는 중…</p>
        <p v-else-if="candidates.length === 0" class="py-6 text-center text-xs text-gray-400">
          승인된 협력사(BOM 견적 트랙)가 없습니다 — 파트너 관리에서 등록하세요.
        </p>
        <label
          v-for="p in candidates"
          :key="p.partnerId"
          class="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm hover:bg-gray-50"
          :class="quotedPartnerIds.has(p.partnerId) ? 'opacity-70' : ''"
        >
          <input
            type="checkbox"
            class="size-4"
            :checked="selected.has(p.partnerId)"
            :disabled="quotedPartnerIds.has(p.partnerId)"
            @change="toggle(p.partnerId)"
          >
          <span class="min-w-0 flex-1 truncate font-medium">{{ p.name }}</span>
          <span v-if="p.contactEmail === null" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">메일 없음</span>
          <span v-if="quotedPartnerIds.has(p.partnerId)" class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">회신됨</span>
          <span v-else-if="rfqs.some((r) => r.partnerId === p.partnerId)" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">발송됨</span>
        </label>
      </div>

      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="send.isPending.value"
          @click="submit"
        >
          발송 ({{ selected.size }}곳)
        </button>
      </div>
    </div>
  </div>
</template>
