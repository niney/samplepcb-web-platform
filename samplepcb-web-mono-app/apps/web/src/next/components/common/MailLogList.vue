<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RouteLocationRaw } from 'vue-router';
import { PaperclipIcon, RotateCcwIcon, SendIcon } from '@lucide/vue';
import type { AdminMailLogItemType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  emptyMailLogFilters,
  useAdminMailLogDetail,
  useAdminMailLogList,
  useResendMailLog,
  type AdminMailLogFilters,
} from '@/admin/useAdminMailLogs';
import { formatBytes, formatDateTime } from '@/lib/format';
import { NEXT_PCB_ROUTES } from '@/next/pcb-navigation';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import ListPagination from './ListPagination.vue';
import Panel from './Panel.vue';
import TableCard from './TableCard.vue';
import TableEmptyRow from './TableEmptyRow.vue';

// 발송 이력 목록 — 옛 components/admin/MailLogList.vue 의 짝(같은 props).
// 전역 페이지(필터 노출)와 Case 상세 임베드(fixed 컨텍스트)가 공용. 행 클릭 = 펼침(단건 조회로
// 본문·파라미터·첨부 열람). 본문은 quick_mail 만 존재.
const props = defineProps<{
  /** 컨텍스트 고정(Case 상세 임베드) — 지정 시 필터 바를 숨기고 해당 건만 보여준다. */
  fixed?: { refType: string; refId: string };
  /** 초기 필터 프리셋(전역 페이지의 URL 쿼리 진입 — 예: 대시보드 실패 위젯 링크). */
  initial?: Partial<AdminMailLogFilters>;
  pageSize?: number;
}>();
const i18n = useI18n();
const { t } = i18n;
const uid = useId();

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
const colspan = computed(() => (props.fixed === undefined ? 8 : 7));

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
const eventValue = (event: Event): string => (event.target as HTMLInputElement | HTMLSelectElement).value;

const CHANNELS: readonly AdminMailLogFilters['channel'][] = ['email', 'alimtalk', 'sms'];
const STATUSES: readonly AdminMailLogFilters['status'][] = ['sent', 'failed', 'skipped'];
const asChannel = (value: string): AdminMailLogFilters['channel'] => CHANNELS.find((c) => c === value) ?? '';
const asStatus = (value: string): AdminMailLogFilters['status'] => STATUSES.find((s) => s === value) ?? '';

// kind·refType 라벨 — i18n 미등록 코드는 원문 노출(서버 계약 catchall).
const kindLabel = (kind: string): string =>
  i18n.te(`admin.mailLogs.kind.${kind}`) ? t(`admin.mailLogs.kind.${kind}`) : kind;
const refTypeLabel = (refType: string): string =>
  i18n.te(`admin.mailLogs.refType.${refType}`) ? t(`admin.mailLogs.refType.${refType}`) : refType;

// 실패는 문제(danger), 건너뜀은 중립(secondary) — 키트 배지 사전의 뜻 규칙(§7)을 따른다.
const STATUS_VARIANT: Record<AdminMailLogItemType['status'], BadgeVariant> = {
  sent: 'success',
  failed: 'danger',
  skipped: 'secondary',
};
const statusLabel = (s: AdminMailLogItemType['status']): string => t(`admin.mailLogs.status.${s}`);
const channelLabel = (c: AdminMailLogItemType['channel']): string => t(`admin.mailLogs.channel.${c}`);

// 컨텍스트 링크 — Case 상세 라우트가 있는 유형만(주문·마켓은 텍스트). PCB·SmartBOM 모두 리뉴얼 상세로 보낸다.
const refLink = (item: AdminMailLogItemType): RouteLocationRaw | null =>
  item.refType === 'bom_quote'
    ? smartbomCaseTo(item.refId)
    : item.refType === 'pcb_spec'
      ? { name: NEXT_PCB_ROUTES.case, params: { id: item.refId } }
      : null;

// 알려진 kind 목록(필터 select) — i18n 사전에서 파생해 서버와 결합하지 않는다.
const KNOWN_KINDS = [
  'quick_mail',
  'estimate',
  'bom_rfq_request',
  'bom_quote_answered',
  'bom_confirm_request',
  'bom_confirm_answered',
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
    <!-- 필터 바 — 전역 페이지 전용(임베드는 컨텍스트 고정). select 는 네이티브(e2e selectOption 호환). -->
    <div v-if="props.fixed === undefined" class="flex flex-wrap items-end gap-3">
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-kind`">{{ t('admin.mailLogs.filter.kind') }}</FieldLabel>
        <NativeSelect :id="`${uid}-kind`" :model-value="filters.kind" @change="(e: Event) => applyFilters({ kind: eventValue(e) })">
          <NativeSelectOption value="">{{ t('admin.mailLogs.filter.all') }}</NativeSelectOption>
          <NativeSelectOption v-for="k in KNOWN_KINDS" :key="k" :value="k">{{ kindLabel(k) }}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-channel`">{{ t('admin.mailLogs.filter.channel') }}</FieldLabel>
        <NativeSelect
          :id="`${uid}-channel`"
          :model-value="filters.channel"
          @change="(e: Event) => applyFilters({ channel: asChannel(eventValue(e)) })"
        >
          <NativeSelectOption value="">{{ t('admin.mailLogs.filter.all') }}</NativeSelectOption>
          <NativeSelectOption value="email">{{ t('admin.mailLogs.channel.email') }}</NativeSelectOption>
          <NativeSelectOption value="alimtalk">{{ t('admin.mailLogs.channel.alimtalk') }}</NativeSelectOption>
          <NativeSelectOption value="sms">{{ t('admin.mailLogs.channel.sms') }}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-status`">{{ t('admin.mailLogs.filter.status') }}</FieldLabel>
        <NativeSelect
          :id="`${uid}-status`"
          :model-value="filters.status"
          @change="(e: Event) => applyFilters({ status: asStatus(eventValue(e)) })"
        >
          <NativeSelectOption value="">{{ t('admin.mailLogs.filter.all') }}</NativeSelectOption>
          <NativeSelectOption value="sent">{{ t('admin.mailLogs.status.sent') }}</NativeSelectOption>
          <NativeSelectOption value="failed">{{ t('admin.mailLogs.status.failed') }}</NativeSelectOption>
          <NativeSelectOption value="skipped">{{ t('admin.mailLogs.status.skipped') }}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-recipient`">{{ t('admin.mailLogs.filter.recipient') }}</FieldLabel>
        <Input
          :id="`${uid}-recipient`"
          :model-value="filters.recipient"
          type="search"
          class="w-52"
          :placeholder="t('admin.mailLogs.filter.recipientPlaceholder')"
          @change="(e: Event) => applyFilters({ recipient: eventValue(e) })"
        />
      </Field>
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-from`">{{ t('admin.mailLogs.filter.from') }}</FieldLabel>
        <Input
          :id="`${uid}-from`"
          :model-value="filters.dateFrom"
          type="date"
          @change="(e: Event) => applyFilters({ dateFrom: eventValue(e) })"
        />
      </Field>
      <Field class="w-auto">
        <FieldLabel :for="`${uid}-to`">{{ t('admin.mailLogs.filter.to') }}</FieldLabel>
        <Input
          :id="`${uid}-to`"
          :model-value="filters.dateTo"
          type="date"
          @change="(e: Event) => applyFilters({ dateTo: eventValue(e) })"
        />
      </Field>
      <Button variant="outline" @click="resetFilters">
        <RotateCcwIcon />
        {{ t('admin.mailLogs.filter.reset') }}
      </Button>
    </div>

    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('admin.mailLogs.col.sentAt') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.kind') }}</TableHead>
            <TableHead v-if="props.fixed === undefined">{{ t('admin.mailLogs.col.ref') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.channel') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.recipient') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.subject') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.status') }}</TableHead>
            <TableHead>{{ t('admin.mailLogs.col.sentBy') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmptyRow
            v-if="items.length === 0"
            :colspan="colspan"
            :text="t('admin.mailLogs.empty')"
            :loading="isFetching"
          />
          <template v-for="item in items" :key="item.logId">
            <TableRow
              class="cursor-pointer"
              :data-state="expandedId === item.logId ? 'selected' : undefined"
              :aria-expanded="expandedId === item.logId"
              @click="toggle(item.logId)"
            >
              <TableCell class="text-muted-foreground tabular-nums">{{ formatDateTime(item.createdAt) }}</TableCell>
              <TableCell>{{ kindLabel(item.kind) }}</TableCell>
              <TableCell v-if="props.fixed === undefined">
                <RouterLink
                  v-if="refLink(item) !== null"
                  :to="refLink(item) ?? ''"
                  class="text-primary underline-offset-4 hover:underline"
                  @click.stop
                >
                  {{ refTypeLabel(item.refType) }} #{{ item.refId }}
                </RouterLink>
                <span v-else class="text-muted-foreground">{{ refTypeLabel(item.refType) }} #{{ item.refId }}</span>
              </TableCell>
              <TableCell>{{ channelLabel(item.channel) }}</TableCell>
              <TableCell>
                <span class="block max-w-64 truncate" :title="item.recipient">
                  {{ item.recipient === '' ? t('admin.mailLogs.unknownRecipient') : item.recipient }}
                </span>
              </TableCell>
              <TableCell>
                <span class="block max-w-80 truncate" :title="item.subject">{{ item.subject === '' ? '—' : item.subject }}</span>
              </TableCell>
              <TableCell>
                <Badge :variant="STATUS_VARIANT[item.status]">{{ statusLabel(item.status) }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground">{{ item.sentBy ?? t('admin.mailLogs.system') }}</TableCell>
            </TableRow>

            <TableRow v-if="expandedId === item.logId">
              <TableCell :colspan="colspan" class="bg-muted/30 whitespace-normal">
                <div class="space-y-2 px-2 py-1 text-sm">
                  <p v-if="item.reason !== null" class="text-destructive">
                    {{ t('admin.mailLogs.detail.reason') }}: {{ item.reason }}
                  </p>
                  <div v-if="paramEntries(item.params).length > 0" class="flex flex-wrap gap-x-4 gap-y-1">
                    <span v-for="[k, v] in paramEntries(item.params)" :key="k">
                      <span class="text-muted-foreground">{{ k }}:</span> {{ v }}
                    </span>
                  </div>
                  <ul v-if="item.attachments !== null && item.attachments.length > 0" class="space-y-0.5">
                    <li v-for="file in item.attachments" :key="file.name" class="flex items-center gap-1.5">
                      <PaperclipIcon class="text-muted-foreground size-3.5" />
                      {{ file.name }}
                      <span class="text-muted-foreground tabular-nums">({{ formatBytes(file.size) }})</span>
                    </li>
                  </ul>
                  <div v-if="item.hasBody">
                    <p v-if="detailFetching" class="text-muted-foreground">{{ t('admin.mailLogs.loading') }}</p>
                    <Panel v-else-if="detail?.data.body != null" class="bg-background max-h-64 overflow-y-auto">
                      <pre class="text-xs whitespace-pre-wrap">{{ detail.data.body }}</pre>
                    </Panel>
                  </div>
                  <p v-else class="text-muted-foreground text-xs">{{ t('admin.mailLogs.detail.noBody') }}</p>

                  <!-- 재발송 — 원문 보존 수동 메일만(자동 알림은 해당 화면의 재발송 수단 사용) -->
                  <div v-if="canResend(item)" class="flex flex-wrap items-center gap-2 border-t pt-2.5">
                    <Input
                      :model-value="resendTo"
                      type="email"
                      class="w-64"
                      :placeholder="item.recipient"
                      :aria-label="t('admin.mailLogs.col.recipient')"
                      @update:model-value="(value: string | number) => (resendTo = String(value))"
                    />
                    <Button size="sm" :disabled="resend.isPending.value" @click="submitResend(item)">
                      <SendIcon />
                      {{ resend.isPending.value ? t('admin.mailLogs.resend.sending') : t('admin.mailLogs.resend.button') }}
                    </Button>
                    <span v-if="item.attachments !== null && item.attachments.length > 0" class="text-warning text-xs">
                      {{ t('admin.mailLogs.resend.noAttachments') }}
                    </span>
                    <p
                      v-if="resendNotice !== null"
                      class="w-full text-xs"
                      :class="resendNotice.ok ? 'text-success' : 'text-destructive'"
                      role="status"
                    >
                      {{ resendNotice.text }}
                    </p>
                  </div>
                </div>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </TableCard>

    <ListPagination v-if="total > 0" :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
  </div>
</template>
