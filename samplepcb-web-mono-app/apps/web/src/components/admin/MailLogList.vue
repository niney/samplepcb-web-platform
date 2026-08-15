<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminMailLogItemType } from '@sp/api-contract';
import {
  emptyMailLogFilters,
  useAdminMailLogDetail,
  useAdminMailLogList,
  useResendMailLog,
  type AdminMailLogFilters,
} from '../../admin/useAdminMailLogs';
import { ApiRequestError } from '@sp/shared';
import { formatBytes, formatDateTime } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';
import UiPagination from '../ui/UiPagination.vue';

// 발송 이력 목록 — 전역 페이지(필터 노출)와 Case 상세 임베드(fixed 컨텍스트)가 공용.
// 행 클릭 = 확장(단건 조회로 본문·파라미터·첨부 열람). 본문은 quick_mail 만 존재.
const props = defineProps<{
  /** 컨텍스트 고정(Case 상세 임베드) — 지정 시 필터 바를 숨기고 해당 건만 보여준다. */
  fixed?: { refType: string; refId: string };
  /** 초기 필터 프리셋(전역 페이지의 URL 쿼리 진입 — 예: 대시보드 실패 위젯 링크). */
  initial?: Partial<AdminMailLogFilters>;
  pageSize?: number;
}>();
const i18n = useI18n();
const { t } = i18n;

const filters = ref<AdminMailLogFilters>(
  emptyMailLogFilters({
    ...props.initial,
    pageSize: props.pageSize ?? 20,
    refType: props.fixed?.refType ?? props.initial?.refType ?? '',
    refId: props.fixed?.refId ?? props.initial?.refId ?? '',
  }),
);
// 임베드에서 Case 전환(라우트 파라미터 변경) 시 컨텍스트 추종.
watch(
  () => props.fixed,
  (fixed) => {
    if (fixed !== undefined) {
      filters.value = { ...filters.value, refType: fixed.refType, refId: fixed.refId, page: 1 };
    }
  },
);

const { data, isFetching } = useAdminMailLogList(filters);
const items = computed(() => data.value?.data.items ?? []);
const total = computed(() => data.value?.data.total ?? 0);

const expandedId = ref<number | null>(null);
const { data: detail, isFetching: detailFetching } = useAdminMailLogDetail(expandedId);
const toggle = (logId: number): void => {
  expandedId.value = expandedId.value === logId ? null : logId;
  resendTo.value = '';
  resendNotice.value = null;
  resend.reset();
};

// 재발송 — 원문 보존 수동 메일(quick_mail·email)만. 수신자 오타 교정이 실제 CS 케이스라
// 주소를 바꿔 보낼 수 있다. 첨부 실파일은 미보관이라 재발송에 실리지 않는다(고지).
const resend = useResendMailLog();
const resendTo = ref('');
const resendNotice = ref<{ ok: boolean; text: string } | null>(null);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const canResend = (item: AdminMailLogItemType): boolean =>
  item.kind === 'quick_mail' && item.channel === 'email' && item.hasBody;
const submitResend = (item: AdminMailLogItemType): void => {
  const to = (resendTo.value.trim() !== '' ? resendTo.value : item.recipient).trim();
  if (!EMAIL_RE.test(to)) {
    resendNotice.value = { ok: false, text: t('admin.mailLogs.resend.invalidEmail') };
    return;
  }
  resendNotice.value = null;
  resend.mutate(
    { logId: item.logId, toEmail: to },
    {
      onSuccess: () => {
        resendNotice.value = { ok: true, text: t('admin.mailLogs.resend.done', { to }) };
      },
      onError: (err) => {
        resendNotice.value = {
          ok: false,
          text: err instanceof ApiRequestError ? err.message : t('admin.mailLogs.resend.failed'),
        };
      },
    },
  );
};

const applyFilters = (patch: Partial<AdminMailLogFilters>): void => {
  filters.value = { ...filters.value, ...patch, page: 1 };
};
const resetFilters = (): void => {
  filters.value = emptyMailLogFilters({ pageSize: filters.value.pageSize });
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};

// kind·refType 라벨 — i18n 미등록 코드는 원문 노출(서버 계약 catchall).
const kindLabel = (kind: string): string =>
  i18n.te(`admin.mailLogs.kind.${kind}`) ? t(`admin.mailLogs.kind.${kind}`) : kind;
const refTypeLabel = (refType: string): string =>
  i18n.te(`admin.mailLogs.refType.${refType}`) ? t(`admin.mailLogs.refType.${refType}`) : refType;

const STATUS_VARIANT: Record<AdminMailLogItemType['status'], 'success' | 'warn' | 'muted'> = {
  sent: 'success',
  failed: 'warn',
  skipped: 'muted',
};
const statusLabel = (s: AdminMailLogItemType['status']): string => t(`admin.mailLogs.status.${s}`);
const channelLabel = (c: AdminMailLogItemType['channel']): string =>
  t(`admin.mailLogs.channel.${c}`);

// 컨텍스트 링크 — Case 상세 라우트가 있는 유형만(주문·마켓은 텍스트).
const refLink = (item: AdminMailLogItemType): { name: string; params: { id: string } } | null =>
  item.refType === 'bom_quote'
    ? { name: 'admin-smartbom-case', params: { id: item.refId } }
    : item.refType === 'pcb_spec'
      ? { name: 'admin-pcb-case', params: { id: item.refId } }
      : null;

// 알려진 kind 목록(필터 select) — i18n 사전에서 파생해 서버와 결합하지 않는다.
const KNOWN_KINDS = [
  'quick_mail',
  'estimate',
  'bom_rfq_request',
  'bom_quote_answered',
  'bom_po_issued',
  'bom_shipment_turn_admin',
  'bom_shipment_turn_partner',
  'bom_shipment_received',
  'pcb_rfq_request',
  'pcb_rfq_replied',
  'pcb_po_issued',
  'pcb_eq_requested',
  'pcb_eq_decision',
  'pcb_eq_customer_request',
  'pcb_eq_customer_decision',
  'pcb_produced',
  'pcb_shipment_turn',
  'pcb_shipment_received',
  'pcb_as_submitted',
  'pcb_as_replied',
  'pcb_claim_received',
  'pcb_claim_decided',
  'order_deposit',
  'order_delivery',
  'market_targeted_request',
  'market_new_bid',
  'market_award',
  'market_expert_decision',
  'market_contract_paid',
  'market_contract_delivered',
  'market_contract_confirmed',
  'market_contract_settled',
] as const;

const paramEntries = (params: Record<string, unknown> | null): [string, string][] =>
  params === null
    ? []
    : Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
</script>

<template>
  <div class="space-y-3">
    <!-- 필터 바 — 전역 페이지 전용(임베드는 컨텍스트 고정) -->
    <div v-if="props.fixed === undefined" class="flex flex-wrap items-end gap-2">
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{ t('admin.mailLogs.filter.kind') }}</span>
        <select
          :value="filters.kind"
          class="rounded border border-gray-300 px-2 py-1.5 text-sm"
          @change="applyFilters({ kind: ($event.target as HTMLSelectElement).value })"
        >
          <option value="">{{ t('admin.mailLogs.filter.all') }}</option>
          <option v-for="k in KNOWN_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{ t('admin.mailLogs.filter.channel') }}</span>
        <select
          :value="filters.channel"
          class="rounded border border-gray-300 px-2 py-1.5 text-sm"
          @change="
            applyFilters({
              channel: ($event.target as HTMLSelectElement).value as AdminMailLogFilters['channel'],
            })
          "
        >
          <option value="">{{ t('admin.mailLogs.filter.all') }}</option>
          <option value="email">{{ t('admin.mailLogs.channel.email') }}</option>
          <option value="alimtalk">{{ t('admin.mailLogs.channel.alimtalk') }}</option>
          <option value="sms">{{ t('admin.mailLogs.channel.sms') }}</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{ t('admin.mailLogs.filter.status') }}</span>
        <select
          :value="filters.status"
          class="rounded border border-gray-300 px-2 py-1.5 text-sm"
          @change="
            applyFilters({
              status: ($event.target as HTMLSelectElement).value as AdminMailLogFilters['status'],
            })
          "
        >
          <option value="">{{ t('admin.mailLogs.filter.all') }}</option>
          <option value="sent">{{ t('admin.mailLogs.status.sent') }}</option>
          <option value="failed">{{ t('admin.mailLogs.status.failed') }}</option>
          <option value="skipped">{{ t('admin.mailLogs.status.skipped') }}</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{
          t('admin.mailLogs.filter.recipient')
        }}</span>
        <input
          :value="filters.recipient"
          type="search"
          :placeholder="t('admin.mailLogs.filter.recipientPlaceholder')"
          class="w-52 rounded border border-gray-300 px-2 py-1.5 text-sm"
          @change="applyFilters({ recipient: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{ t('admin.mailLogs.filter.from') }}</span>
        <input
          :value="filters.dateFrom"
          type="date"
          class="rounded border border-gray-300 px-2 py-1 text-sm"
          @change="applyFilters({ dateFrom: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <label class="block">
        <span class="mb-1 block text-xs text-gray-500">{{ t('admin.mailLogs.filter.to') }}</span>
        <input
          :value="filters.dateTo"
          type="date"
          class="rounded border border-gray-300 px-2 py-1 text-sm"
          @change="applyFilters({ dateTo: ($event.target as HTMLInputElement).value })"
        >
      </label>
      <button
        type="button"
        class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        @click="resetFilters"
      >
        {{ t('admin.mailLogs.filter.reset') }}
      </button>
    </div>

    <div class="overflow-x-auto rounded-lg border border-gray-200">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.sentAt') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.kind') }}</th>
            <th v-if="props.fixed === undefined" class="px-3 py-2 font-medium">
              {{ t('admin.mailLogs.col.ref') }}
            </th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.channel') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.recipient') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.subject') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.status') }}</th>
            <th class="px-3 py-2 font-medium">{{ t('admin.mailLogs.col.sentBy') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 bg-white">
          <tr v-if="items.length === 0">
            <td :colspan="props.fixed === undefined ? 8 : 7" class="px-3 py-8 text-center text-gray-400">
              {{ isFetching ? t('admin.mailLogs.loading') : t('admin.mailLogs.empty') }}
            </td>
          </tr>
          <template v-for="item in items" :key="item.logId">
            <tr class="cursor-pointer hover:bg-gray-50" @click="toggle(item.logId)">
              <td class="whitespace-nowrap px-3 py-2 text-gray-600">
                {{ formatDateTime(item.createdAt) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2">{{ kindLabel(item.kind) }}</td>
              <td v-if="props.fixed === undefined" class="whitespace-nowrap px-3 py-2">
                <RouterLink
                  v-if="refLink(item) !== null"
                  :to="refLink(item)!"
                  class="text-blue-600 hover:underline"
                  @click.stop
                >
                  {{ refTypeLabel(item.refType) }} #{{ item.refId }}
                </RouterLink>
                <span v-else class="text-gray-500">
                  {{ refTypeLabel(item.refType) }} #{{ item.refId }}
                </span>
              </td>
              <td class="whitespace-nowrap px-3 py-2">{{ channelLabel(item.channel) }}</td>
              <td class="max-w-[16rem] truncate px-3 py-2" :title="item.recipient">
                {{ item.recipient === '' ? t('admin.mailLogs.unknownRecipient') : item.recipient }}
              </td>
              <td class="max-w-[20rem] truncate px-3 py-2" :title="item.subject">
                {{ item.subject === '' ? '—' : item.subject }}
              </td>
              <td class="whitespace-nowrap px-3 py-2">
                <UiBadge :variant="STATUS_VARIANT[item.status]" :label="statusLabel(item.status)" />
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-gray-600">
                {{ item.sentBy ?? t('admin.mailLogs.system') }}
              </td>
            </tr>
            <tr v-if="expandedId === item.logId" class="bg-gray-50/60">
              <td :colspan="props.fixed === undefined ? 8 : 7" class="px-4 py-3">
                <div class="space-y-2 text-sm">
                  <p v-if="item.reason !== null" class="text-red-600">
                    {{ t('admin.mailLogs.detail.reason') }}: {{ item.reason }}
                  </p>
                  <div v-if="paramEntries(item.params).length > 0" class="flex flex-wrap gap-x-4 gap-y-1 text-gray-600">
                    <span v-for="[k, v] in paramEntries(item.params)" :key="k">
                      <span class="text-gray-400">{{ k }}:</span> {{ v }}
                    </span>
                  </div>
                  <ul v-if="item.attachments !== null && item.attachments.length > 0" class="text-gray-600">
                    <li v-for="file in item.attachments" :key="file.name">
                      📎 {{ file.name }} ({{ formatBytes(file.size) }})
                    </li>
                  </ul>
                  <div v-if="item.hasBody">
                    <p v-if="detailFetching" class="text-gray-400">{{ t('admin.mailLogs.loading') }}</p>
                    <pre
                      v-else-if="detail?.data.body != null"
                      class="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-gray-200 bg-white p-3 text-xs text-gray-700"
                    >{{ detail.data.body }}</pre>
                  </div>
                  <p v-else class="text-xs text-gray-400">{{ t('admin.mailLogs.detail.noBody') }}</p>

                  <!-- 재발송 — 원문 보존 수동 메일만(자동 알림은 해당 화면의 재발송 수단 사용) -->
                  <div
                    v-if="canResend(item)"
                    class="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2.5"
                  >
                    <input
                      v-model="resendTo"
                      type="email"
                      :placeholder="item.recipient"
                      class="w-64 rounded border border-gray-300 px-2 py-1.5 text-sm"
                    >
                    <button
                      type="button"
                      class="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                      :disabled="resend.isPending.value"
                      @click="submitResend(item)"
                    >
                      {{ resend.isPending.value ? t('admin.mailLogs.resend.sending') : t('admin.mailLogs.resend.button') }}
                    </button>
                    <span
                      v-if="item.attachments !== null && item.attachments.length > 0"
                      class="text-xs text-amber-600"
                    >
                      {{ t('admin.mailLogs.resend.noAttachments') }}
                    </span>
                    <p
                      v-if="resendNotice !== null"
                      class="w-full text-xs"
                      :class="resendNotice.ok ? 'text-green-700' : 'text-red-600'"
                    >
                      {{ resendNotice.text }}
                    </p>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="total > 0" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">{{ t('admin.mailLogs.total', { n: total }) }}</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="total"
        @update:page="setPage"
      />
    </div>
  </div>
</template>
