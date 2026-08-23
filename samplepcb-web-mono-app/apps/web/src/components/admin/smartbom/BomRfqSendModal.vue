<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
  AdminBomQuoteItemPartnerHolderType,
  AdminBomRfqViewType,
  BomQuoteItemType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminPartnerList, type AdminPartnerFilters } from '../../../admin/useAdminPartners';
import { useSendBomRfqs } from '../../../admin/useAdminBomRfqs';
import { useAdminPartnerPartSummary } from '../../../admin/useAdminPartnerParts';

// 협력사 견적요청 발송 모달 — 승인 협력사(BOM 견적 트랙) 선택 → diff 발송.
// 유지분은 보존, 빠진 미회신 문서만 삭제, 신규만 메일(docs/SMARTBOM_PARTNER_RFQ.md §2.4).
// 회신(quoted) 문서는 해제해도 서버가 보존한다 — UI 에서 해제 자체를 잠근다.
// 부분 행 선택(§6.13 개정) — 행 체크는 판단 근거가 있는 **품목 테이블**에서 하고
// (selectedItemIds 로 전달, 빈 배열=전체), 모달은 요약·확인만(편집 창구 단일).
// 부분 선택은 이번에 새로 생성되는 RFQ 에만 적용된다(유지분 세트 불변).

const props = defineProps<{
  open: boolean;
  quoteId: string;
  scopeItems: BomQuoteItemType[]; // 요청 가능 부품행(included·활성 시트)
  selectedItemIds: string[]; // 품목 테이블 체크 — 빈 배열=전체 발송
  rfqs: AdminBomRfqViewType[];
  /** partnerId → 보유 중인 quoteItemId (docs/PARTNER_PARTS.md). 없으면 표시만 생략. */
  partnerItems?: Record<string, string[]>;
  /** quoteItemId → 보유 협력사 상세(재고·D/C·기준일). 펼친 목록이 이걸 읽는다. */
  itemHolders?: Record<string, AdminBomQuoteItemPartnerHolderType[]>;
}>();
const emit = defineEmits<{ close: []; sent: [] }>();

// 승인된 협력사 전체(관리 목록 재사용, capability 는 클라 필터).
const partnerFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'partner',
  q: '',
});
const { data: partnerData, isFetching } = useAdminPartnerList(partnerFilters);
// 협력사 보유 부품(docs/PARTNER_PARTS.md) — "이 발송 범위를 몇 행이나 갖고 있나".
// 제한이 아니라 **고르기 쉽게** 하는 표시다: 보유한 곳을 위로 올리고 건수를 배지로 단다.
const scopedItemIds = computed(
  () =>
    new Set(
      props.selectedItemIds.length > 0
        ? props.selectedItemIds
        : props.scopeItems.map((item) => item.id),
    ),
);
const holdingCount = (partnerId: number): number => {
  const owned = props.partnerItems?.[String(partnerId)];
  if (owned === undefined) return 0;
  return owned.filter((itemId) => scopedItemIds.value.has(itemId)).length;
};

// 배지를 눌러 펼친다 — '몇 행'만으로는 헛발질을 못 막는다. 5개 필요한데 2개 보유인 곳에
// 견적요청을 거는 일을 막으려면 **어느 행을, 얼마나** 갖고 있는지가 보여야 한다.
// 기본 접힘: 승인 협력사는 수십 곳이고 대부분 보유 0행이다.
const expanded = ref<Set<number>>(new Set());
function toggleExpanded(partnerId: number): void {
  const next = new Set(expanded.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  expanded.value = next;
}

// 낡음 기준일은 서버 설정(sp_config)이 정본이라 화면에 상수로 박지 않는다.
// 요약 조회는 캐시를 타므로 모달을 열 때 추가 왕복이 사실상 없다.
const partnerPartSummary = useAdminPartnerPartSummary();
const staleAfterDays = computed(
  () => partnerPartSummary.data.value?.data.staleAfterDays ?? null,
);

interface HeldRow {
  itemId: string;
  mpn: string;
  stockQty: number | null;
  dateCode: string | null;
  ageDays: number | null;
  stale: boolean;
}

const ageDaysFrom = (iso: string): number | null => {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
};

/** 이 협력사가 **이번 발송 범위 안에서** 가진 행 — 순서는 품목 표와 같게 둔다. */
const heldRows = (partnerId: number): HeldRow[] => {
  const owned = new Set(props.partnerItems?.[String(partnerId)] ?? []);
  if (owned.size === 0) return [];
  return props.scopeItems
    .filter((item) => owned.has(item.id) && scopedItemIds.value.has(item.id))
    .map((item) => {
      const holder = (props.itemHolders?.[item.id] ?? []).find(
        (row) => row.partnerId === partnerId,
      );
      const ageDays = holder === undefined ? null : ageDaysFrom(holder.uploadedAt);
      return {
        itemId: item.id,
        mpn: item.mpn === '' ? '(품번 없음)' : item.mpn,
        stockQty: holder?.stockQty ?? null,
        dateCode: holder?.dateCode ?? null,
        ageDays,
        stale:
          ageDays !== null && staleAfterDays.value !== null && ageDays > staleAfterDays.value,
      };
    });
};

/** 나이는 '오늘 올린 것'과 '한참 된 것'을 가르는 정보다 — 0 을 '0일 전'으로 쓰면 잡음이 된다. */
const fmtAge = (days: number): string => (days === 0 ? '오늘' : `${String(days)}일 전`);

const fmtQty = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('ko-KR');

const candidates = computed(() => {
  const list = (partnerData.value?.data.items ?? []).filter((p) =>
    p.capabilities.includes('bom_rfq'),
  );
  // 보유 건수 많은 곳 → 이름순. 보유 정보가 없으면 기존 순서를 그대로 둔다.
  return props.partnerItems === undefined
    ? list
    : [...list].sort(
        (a, b) =>
          holdingCount(b.partnerId) - holdingCount(a.partnerId)
          || a.name.localeCompare(b.name, 'ko'),
      );
});

const selected = ref<Set<number>>(new Set());
const quotedPartnerIds = computed(
  () => new Set(props.rfqs.filter((r) => r.status !== 'requested').map((r) => r.partnerId)),
);
const pendingRfqCount = computed(() => props.rfqs.filter((rfq) => rfq.status === 'requested').length);
const emptySelectionBlocked = computed(() => selected.value.size === 0 && pendingRfqCount.value === 0);
const selectedWithoutEmailCount = computed(() => {
  const selectedIds = selected.value;
  return candidates.value.filter(
    (partner) => selectedIds.has(partner.partnerId) && partner.contactEmail === null,
  ).length;
});
const submitLabel = computed(() => {
  if (selected.value.size > 0) return `발송 (${String(selected.value.size)}곳)`;
  return pendingRfqCount.value > 0 ? '미회신 요청 회수' : '협력사를 선택해 주세요';
});

// 부분 행 선택(§6.13) — 품목 테이블 체크가 진실. 빈 배열=전체(itemIds 생략).
const partialSelection = computed(
  () => props.selectedItemIds.length > 0 && props.selectedItemIds.length < props.scopeItems.length,
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
  if (emptySelectionBlocked.value) {
    error.value = '견적요청을 보낼 협력사를 한 곳 이상 선택해 주세요.';
    return;
  }
  // 0곳 발송 = 미회신 요청 전부 회수(diff 수렴) — 버튼 라벨("미회신 요청 회수")이
  // 의미를 이미 말하므로 별도 confirm 없이 진행한다(사용자 결정).
  try {
    await send.mutateAsync({
      quoteId: props.quoteId,
      body: {
        partnerIds: [...selected.value],
        // 부분 선택일 때만 itemIds — 전체는 생략(=전체 파생, 이후 행 추가 자동 포함)
        ...(partialSelection.value ? { itemIds: [...props.selectedItemIds] } : {}),
      },
    });
    emit('sent');
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '발송에 실패했습니다.';
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div
      class="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bom-rfq-send-title"
    >
      <div class="flex items-center justify-between">
        <h2 id="bom-rfq-send-title" class="text-lg font-bold">협력사 견적요청</h2>
        <button
          type="button"
          class="text-gray-400 hover:text-gray-700"
          aria-label="협력사 견적요청 닫기"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>
      <p class="mt-1 text-xs text-gray-500">
        요청 부품행
        <b v-if="partialSelection" class="text-blue-700">선택 {{ selectedItemIds.length }}/{{ scopeItems.length }}행</b>
        <b v-else>전체 {{ scopeItems.length }}행</b>
        · 선택한 협력사 집합으로 발송 상태를 맞춥니다
        (신규만 메일 발송, 이미 회신한 협력사는 해제할 수 없습니다).
      </p>
      <!-- 행 선택은 품목 테이블에서(§6.13 개정 — 편집 창구 단일). 여기선 확인만 -->
      <p v-if="partialSelection" class="mt-1 rounded bg-blue-50 px-2 py-1 text-[11px] text-blue-800">
        부분 선택은 이번에 <b>새로 발송되는</b> 협력사에게만 적용됩니다 — 행 변경은 품목 표에서.
      </p>

      <div class="mt-4 max-h-72 space-y-1 overflow-y-auto">
        <p v-if="isFetching && candidates.length === 0" class="py-6 text-center text-xs text-gray-400">불러오는 중…</p>
        <p v-else-if="candidates.length === 0" class="py-6 text-center text-xs text-gray-400">
          승인된 협력사(BOM 견적 트랙)가 없습니다 —
          <RouterLink :to="{ name: 'admin-partners' }" class="font-semibold text-blue-600 hover:underline">
            파트너 관리
          </RouterLink>에서 등록하세요.
        </p>
        <div
          v-for="p in candidates"
          :key="p.partnerId"
          class="rounded-lg border border-gray-100"
          :class="quotedPartnerIds.has(p.partnerId) ? 'opacity-70' : ''"
        >
          <label class="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50">
            <input
              type="checkbox"
              class="size-4"
              :checked="selected.has(p.partnerId)"
              :disabled="quotedPartnerIds.has(p.partnerId)"
              @change="toggle(p.partnerId)"
            >
            <span class="min-w-0 flex-1 truncate font-medium">{{ p.name }}</span>
            <!-- 배지는 체크 토글이 아니라 펼치기다 — label 안이라 기본 동작을 막아야 한다 -->
            <button
              v-if="holdingCount(p.partnerId) > 0"
              type="button"
              class="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100"
              :aria-expanded="expanded.has(p.partnerId)"
              title="눌러서 어느 행을 얼마나 보유하고 있는지 펼쳐 봅니다"
              @click.prevent.stop="toggleExpanded(p.partnerId)"
            >보유 {{ holdingCount(p.partnerId) }}행 {{ expanded.has(p.partnerId) ? '▴' : '▾' }}</button>
            <span v-if="p.contactEmail === null" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">메일 없음</span>
            <span v-if="quotedPartnerIds.has(p.partnerId)" class="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">회신됨</span>
            <span v-else-if="rfqs.some((r) => r.partnerId === p.partnerId)" class="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">발송됨</span>
          </label>

          <div
            v-if="expanded.has(p.partnerId)"
            class="border-t border-gray-100 bg-gray-50/60 px-3 py-2"
          >
            <ul class="space-y-1">
              <li
                v-for="row in heldRows(p.partnerId)"
                :key="row.itemId"
                class="flex items-center gap-2 text-[11px]"
              >
                <span class="min-w-0 flex-1 truncate font-mono text-gray-800">{{ row.mpn }}</span>
                <span class="tabular-nums text-gray-600">재고 {{ fmtQty(row.stockQty) }}</span>
                <span v-if="row.dateCode !== null" class="text-gray-500">D/C {{ row.dateCode }}</span>
                <!-- 재고는 협력사의 주장이고 만료를 두지 않는다 — 나이를 늘 함께 보인다 -->
                <span
                  v-if="row.ageDays !== null"
                  :class="row.stale ? 'font-semibold text-amber-700' : 'text-gray-400'"
                  :title="row.stale ? '오래된 재고표입니다 — 수량을 그대로 믿지 마세요' : '재고표 업로드 이후 지난 날수'"
                >{{ fmtAge(row.ageDays) }}</span>
              </li>
            </ul>
            <p class="mt-1.5 text-[10px] leading-4 text-gray-400">
              협력사가 스스로 올린 재고표입니다 — 수량·납기는 견적 회신이 정본입니다.
            </p>
          </div>
        </div>
      </div>

      <p v-if="selectedWithoutEmailCount > 0" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-800">
        메일이 없는 협력사 {{ selectedWithoutEmailCount }}곳은 포털 요청과 회신 링크만 생성되며 이메일은 발송되지 않습니다.
      </p>

      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="send.isPending.value || emptySelectionBlocked"
          @click="submit"
        >
          {{ submitLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
