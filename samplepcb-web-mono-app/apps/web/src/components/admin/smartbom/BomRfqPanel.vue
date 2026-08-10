<script setup lang="ts">
import { computed, ref } from 'vue';
import { BOM_RFQ_STATUS_LABELS, type AdminBomRfqViewType } from '@sp/api-contract';
import { smartbomFmtDate } from '../../../admin/smartbom';
import { confirmDialog } from '../../../lib/confirmDialog';
import { fmtKstDate } from '@sp/utils';

// Case 상세의 협력사 RFQ 현황 패널 — 발송·회신 현황 + 대리 입력 진입.
// 공급사 시세는 여기 없다(후보/구매 조건 원장 파생 — 부품행의 선정 구매 조건이 그 자리, D6).

const props = defineProps<{
  rfqs: AdminBomRfqViewType[];
  loading: boolean;
  canSend: boolean; // reviewing 에서만 발송·선정 가능
  busy?: boolean;
}>();
const emit = defineEmits<{
  send: [];
  reply: [rfq: AdminBomRfqViewType];
  compare: [];
  reissueLink: [rfq: AdminBomRfqViewType]; // 매직링크 재발급(§6.9 — 구 토큰 즉시 무효)
}>();

// 매직링크 [복사](§6.9) — 메일 유실·전화 안내 시 수동 전달용. URL 은 현재 origin 기준.
const copiedRfqId = ref<number | null>(null);
async function copyMagicLink(rfq: AdminBomRfqViewType): Promise<void> {
  if (rfq.magicToken === null) return;
  const url = `${window.location.origin}/app/rfq-reply/${rfq.magicToken}`;
  try {
    await navigator.clipboard.writeText(url);
    copiedRfqId.value = rfq.rfqId;
    setTimeout(() => {
      if (copiedRfqId.value === rfq.rfqId) copiedRfqId.value = null;
    }, 1500);
  } catch {
    window.prompt('복사에 실패했습니다 — 아래 링크를 직접 복사하세요.', url);
  }
}

async function reissue(rfq: AdminBomRfqViewType): Promise<void> {
  if (
    !(await confirmDialog({
      message: `${rfq.partnerName}의 회신 링크를 재발급할까요?\n기존에 보낸 링크는 즉시 무효가 됩니다.`,
      confirmLabel: '재발급',
      tone: 'danger',
    }))
  ) {
    return;
  }
  emit('reissueLink', rfq);
}

const activeQuotedCount = computed(() => props.rfqs.filter((r) => r.status === 'quoted').length);
const repliedCount = computed(() => props.rfqs.filter((r) => r.respondedAt !== null).length);
const pendingCount = computed(() => props.rfqs.filter((r) => r.status === 'requested').length);

const statusCls = (status: AdminBomRfqViewType['status']): string =>
  status === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';

const fmtWon = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('ko-KR')}원`);

const tableScroll = ref<HTMLElement | null>(null);
function moveTable(direction: -1 | 1): void {
  tableScroll.value?.scrollBy({ left: direction * 280, behavior: 'smooth' });
}
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
      <p class="text-sm font-bold text-gray-800">협력사 견적요청 (RFQ)</p>
      <p v-if="rfqs.length > 0" class="text-xs text-gray-500">
        협력사 <b>{{ rfqs.length }}</b> · 회신 <b class="text-emerald-600">{{ repliedCount }}</b> ·
        회신 대기 <b class="text-blue-600">{{ pendingCount }}</b>
      </p>
      <div class="ml-auto flex gap-2">
        <button
          v-if="activeQuotedCount > 0"
          type="button"
          class="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          :disabled="!canSend"
          :title="canSend ? '' : '검토 중 상태에서만 선정을 변경할 수 있습니다'"
          @click="emit('compare')"
        >
          회신 비교·선정
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="!canSend"
          :title="canSend ? '' : '검토 중 상태에서만 발송할 수 있습니다'"
          @click="emit('send')"
        >
          협력사 견적요청 보내기
        </button>
      </div>
    </div>

    <p v-if="loading && rfqs.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">불러오는 중…</p>
    <p v-else-if="rfqs.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
      아직 발송한 견적요청이 없습니다.
    </p>
    <div v-else ref="tableScroll" class="overflow-x-auto [scrollbar-color:theme(colors.blue.300)_theme(colors.gray.100)] [scrollbar-width:thin]">
      <div class="sticky left-0 z-[1] flex items-center gap-2 border-b border-blue-100 bg-blue-50/95 px-3 py-1.5 text-[10px] font-medium text-blue-700 min-[1280px]:hidden">
        <span class="min-w-0 flex-1">좌우로 이동해 납기·요청일·작업 버튼을 확인할 수 있습니다.</span>
        <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="RFQ 표 왼쪽으로 이동" @click="moveTable(-1)">←</button>
        <button type="button" class="grid size-6 shrink-0 place-items-center rounded border border-blue-200 bg-white text-sm hover:bg-blue-100" aria-label="RFQ 표 오른쪽으로 이동" @click="moveTable(1)">→</button>
      </div>
      <table class="min-w-[980px] divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="whitespace-nowrap px-3 py-2">협력사</th>
            <th class="whitespace-nowrap px-3 py-2">상태</th>
            <th class="whitespace-nowrap px-3 py-2 text-right">회신 행</th>
            <th class="whitespace-nowrap px-3 py-2 text-right">회신 합계</th>
            <th class="whitespace-nowrap px-3 py-2">납기</th>
            <th class="whitespace-nowrap px-3 py-2">회신 메모</th>
            <th class="whitespace-nowrap px-3 py-2">요청/회신일</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="rfq in rfqs" :key="rfq.rfqId">
            <td class="px-3 py-2 font-medium text-gray-900">{{ rfq.partnerName }}</td>
            <td class="px-3 py-2">
              <span class="rounded px-1.5 py-0.5 font-semibold" :class="statusCls(rfq.status)">
                {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
              </span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">
              {{ rfq.repliedItemCount }}<template v-if="rfq.requestedItemIds !== null">/{{ rfq.requestedItemIds.length }}</template>
              <!-- 부분 행 선택(§6.13) — 전체가 아닌 요청은 배지로 구분 -->
              <span v-if="rfq.requestedItemIds !== null" class="ml-1 rounded bg-indigo-100 px-1 py-0.5 text-[10px] font-semibold text-indigo-700">부분</span>
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{{ fmtWon(rfq.totalAmount) }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-500">
              {{ fmtKstDate(rfq.deliveryDate) }}
            </td>
            <td class="max-w-48 truncate px-3 py-2 text-gray-500">{{ rfq.memo ?? '—' }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-400">
              {{ smartbomFmtDate(rfq.requestedAt) }}
              <template v-if="rfq.respondedAt !== null"> → {{ smartbomFmtDate(rfq.respondedAt) }}</template>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <!-- 매직링크(§6.9) — 무로그인 회신 URL 수동 전달·회수 -->
              <button
                v-if="rfq.magicToken !== null"
                type="button"
                class="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                title="가입 없이 회신할 수 있는 전용 링크를 복사합니다"
                @click="copyMagicLink(rfq)"
              >
                {{ copiedRfqId === rfq.rfqId ? '복사됨 ✓' : '링크 복사' }}
              </button>
              <button
                type="button"
                class="ml-1 rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                :disabled="busy === true"
                :title="rfq.magicToken === null ? '이 RFQ 는 링크 발급 전입니다 — 재발급으로 만들 수 있습니다' : '기존 링크를 무효화하고 새 링크를 만듭니다'"
                @click="void reissue(rfq)"
              >
                재발급
              </button>
              <button
                type="button"
                class="ml-1 rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                @click="emit('reply', rfq)"
              >
                {{ rfq.status === 'closed' ? '회신 보기' : rfq.status === 'quoted' ? '회신 보기·수정' : '대리 입력' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
