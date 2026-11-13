<script setup lang="ts">
import { computed, ref } from 'vue';
import { RotateCwIcon } from '@lucide/vue';
import {
  SMARTSMT_RECEIVE_RESULT_LABELS,
  SMARTSMT_RECEIVE_RESULTS,
  type SmartsmtReceiveResult,
} from '@sp/api-contract';
import { smtQuotesSearchTo } from '@/next/smt-navigation';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import ListPagination from '@/next/components/common/ListPagination.vue';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { smtReceiveResultBadge } from '@/next/components/smt/smt-badges';
import { smtBytes, smtCount, smtDateTime } from '@/next/components/smt/smt-format';
import {
  useAdminSmtLinkStatus,
  useAdminSmtReceiveLogs,
  type AdminSmtReceiveLogFilters,
} from '@/next/components/smt/useAdminSmt';

// SMT 연동 상태 — docs/SMARTSMT_INTEGRATION.md §4.6. 위: 설정 상태(공유 비밀은 설정 여부만 — 값은 API 에도 없다),
// 아래: 수신 기록(SmartSMT 가 보낸 시도, 성공·실패 모두). SmartSMT 화면에는 HTTP 코드만 뜨므로 원인은 여기서 찾는다.
// 가져오기(pull)는 이 원장에 남지 않는다 — 결과는 가져오기 화면 응답과 서버 로그에 남는다.

const statusQuery = useAdminSmtLinkStatus();
const status = computed(() => statusQuery.data.value?.data ?? null);
// 주소는 이 화면을 연 도메인 기준 — SmartSMT 에 알려 줄 주소다(운영에서는 운영 도메인이 된다).
const origin = window.location.origin;

const filters = ref<AdminSmtReceiveLogFilters>({ page: 1, pageSize: 30, result: '' });
const logsQuery = useAdminSmtReceiveLogs(filters);
const logs = computed(() => logsQuery.data.value?.data.items ?? []);
const total = computed(() => logsQuery.data.value?.data.total ?? 0);

const asResult = (value: string): SmartsmtReceiveResult | '' =>
  SMARTSMT_RECEIVE_RESULTS.find((result) => result === value) ?? '';
const onResultChange = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  filters.value = { ...filters.value, result: asResult(value), page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
const refresh = (): void => {
  void statusQuery.refetch();
  void logsQuery.refetch();
};

const last24h = computed(() =>
  status.value === null
    ? []
    : SMARTSMT_RECEIVE_RESULTS.map((result) => {
        const count = status.value?.last24h[result] ?? 0;
        const badge = smtReceiveResultBadge(result);
        // 0건은 색을 빼 둔다 — '실패 0' 이 붉으면 문제가 있는 것처럼 읽힌다.
        return { result, label: badge.label, count, variant: count === 0 ? ('secondary' as const) : badge.variant };
      }),
);
const timeoutText = (ms: number): string => `${smtCount(ms / 1000)}초`;
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="연동 상태" description="SmartSMT 와 주고받는 설정과, SmartSMT 가 견적서를 보낸 기록입니다.">
      <template #actions>
        <Button variant="outline" :disabled="statusQuery.isFetching.value || logsQuery.isFetching.value" @click="refresh">
          <RotateCwIcon />
          새로 고침
        </Button>
      </template>
    </PageHeader>

    <SectionCard title="설정">
      <p v-if="status === null" class="text-muted-foreground text-sm">
        {{ statusQuery.isError.value ? '연동 상태를 불러오지 못했습니다.' : '불러오는 중…' }}
      </p>
      <dl v-else class="grid grid-cols-1 gap-x-8 gap-y-4 text-sm md:grid-cols-2 xl:grid-cols-3" data-testid="smt-link-settings">
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">공유 비밀</dt>
          <dd class="mt-1 flex flex-wrap items-center gap-2">
            <Badge :variant="status.secretConfigured ? 'success' : 'danger'">
              {{ status.secretConfigured ? '설정됨' : '미설정' }}
            </Badge>
            <span class="text-muted-foreground text-xs">값은 화면·API 어디에도 싣지 않습니다</span>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">SmartSMT 주소 <span class="font-normal">(가져오기가 부른다)</span></dt>
          <dd class="mt-1 flex flex-wrap items-center gap-2">
            <span v-if="status.baseUrl !== null" class="font-mono text-xs break-all">{{ status.baseUrl }}</span>
            <Badge v-else variant="warning">미설정</Badge>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">대기 시간</dt>
          <dd class="mt-1 tabular-nums">{{ timeoutText(status.timeoutMs) }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">우리 수신 주소 <span class="font-normal">(SmartSMT 가 견적서를 보내는 곳)</span></dt>
          <dd class="mt-1 font-mono text-xs break-all">{{ origin }}{{ status.inboundPath }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">로그인 인계 주소 <span class="font-normal">(SmartSMT 가 회원을 보내는 곳)</span></dt>
          <dd class="mt-1 font-mono text-xs break-all">{{ origin }}{{ status.ssoPath }}</dd>
          <dd class="text-muted-foreground mt-1 text-xs">
            로그인 인계의 설정(공유 비밀 · SmartSMT 로그인 수신 주소)은 sp-php
            <span class="font-mono">spcb/lib/secret.php</span> 에 있습니다.
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">파일 버킷</dt>
          <dd class="mt-1 font-mono text-xs">{{ status.fileServiceType }}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-muted-foreground text-xs">마지막으로 받은 시각</dt>
          <dd class="mt-1 tabular-nums">{{ status.lastAcceptedAt === null ? '아직 없음' : smtDateTime(status.lastAcceptedAt) }}</dd>
        </div>
        <div class="min-w-0 md:col-span-2">
          <dt class="text-muted-foreground text-xs">최근 24시간 수신</dt>
          <dd class="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge v-for="entry in last24h" :key="entry.result" :variant="entry.variant" class="tabular-nums">
              {{ entry.label }} {{ entry.count }}
            </Badge>
          </dd>
        </div>
      </dl>
    </SectionCard>

    <SectionCard title="수신 기록" flush>
      <template #meta>SmartSMT 가 보낸 시도 — 성공·실패 모두</template>
      <template #actions>
        <!-- 네이티브 select — e2e selectOption 이 그대로 통한다(삭제 기록 화면과 같은 방식). -->
        <NativeSelect
          :model-value="filters.result"
          aria-label="결과로 거르기"
          data-testid="smt-log-filter"
          @change="onResultChange"
        >
          <NativeSelectOption value="">결과 전체</NativeSelectOption>
          <NativeSelectOption v-for="result in SMARTSMT_RECEIVE_RESULTS" :key="result" :value="result">
            {{ SMARTSMT_RECEIVE_RESULT_LABELS[result] ?? result }}
          </NativeSelectOption>
        </NativeSelect>
      </template>
      <template #notice>
        <NoticeBand>견적서 가져오기는 이 기록에 남지 않습니다 — 여기는 SmartSMT 가 보낸 시도만 담습니다.</NoticeBand>
      </template>
      <Table data-testid="smt-receive-logs">
        <TableHeader>
          <TableRow>
            <TableHead>시각</TableHead>
            <TableHead>결과</TableHead>
            <TableHead>사유</TableHead>
            <TableHead class="text-right">HTTP</TableHead>
            <TableHead>주문 번호</TableHead>
            <TableHead>견적 번호</TableHead>
            <TableHead class="text-right">크기</TableHead>
            <TableHead class="text-right">걸린 시간</TableHead>
            <TableHead>보낸 주소</TableHead>
            <TableHead>메시지</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in logs" :key="log.id">
            <TableCell class="text-muted-foreground tabular-nums">{{ smtDateTime(log.createdAt) }}</TableCell>
            <TableCell>
              <Badge :variant="smtReceiveResultBadge(log.result).variant">{{ smtReceiveResultBadge(log.result).label }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ log.reason ?? '—' }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ log.httpStatus }}</TableCell>
            <TableCell class="font-mono text-xs">
              <RouterLink
                v-if="log.orderId !== null"
                :to="smtQuotesSearchTo(log.orderId)"
                class="text-primary hover:underline"
                title="받은 견적에서 이 주문 찾기"
              >
                {{ log.orderId }}
              </RouterLink>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ log.quoteId ?? '—' }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ smtBytes(log.bytes) }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ smtCount(Math.round(log.durationMs)) }}ms</TableCell>
            <TableCell class="text-muted-foreground font-mono text-xs">{{ log.remoteAddr ?? '—' }}</TableCell>
            <TableCell class="text-muted-foreground">
              <span class="block max-w-xs truncate" :title="log.message ?? ''">{{ log.message ?? '—' }}</span>
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="logs.length === 0"
            :colspan="10"
            :loading="logsQuery.isFetching.value"
            text="수신 기록이 없습니다."
          />
        </TableBody>
      </Table>
    </SectionCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />
  </div>
</template>
