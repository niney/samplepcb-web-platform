<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_CLAIM_KIND_LABELS,
  BOM_CLAIM_RESOLUTION_LABELS,
  BOM_CLAIM_STATUS_LABELS,
  type AdminBomClaimListQueryType,
  type BomClaimResolutionKindType,
} from '@sp/api-contract';
import {
  useAdminBomClaim,
  useAdminBomClaims,
  useTransitionAdminBomClaim,
  type AdminBomClaimFilters,
} from '@/admin/useAdminBomClaims';
import { queryPage, queryString, queryTab, replaceListQuery } from '@/next/lib/list-query';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/next/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Empty, EmptyDescription } from '@/next/components/ui/empty';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Textarea } from '@/next/components/ui/textarea';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { bomClaimStatusBadge } from '@/next/components/smartbom/smartbom-badges';

// SmartBOM 완료·클레임 — 배송 후 고객 문제를 접수 순서대로 검토하고 답변한다(옛 AdminSmartbomClaims).
// 주문·환불 상태는 자동으로 바꾸지 않는다 — 실제 환불·재발송은 별도 운영 절차, 여기는 고객에게 약속한
// 처리 내용을 남기는 단일 창구다. 처리는 낙관적 잠금(expectedVersion) — 409 면 최신을 다시 읽는다.

type ClaimTab = AdminBomClaimListQueryType['status'];
const TAB_KEYS: readonly ClaimTab[] = ['pending', 'open', 'reviewing', 'resolved', 'rejected', 'all'];
const PAGE_SIZE = 20;

const route = useRoute();
const router = useRouter();
const listState = ref<{ tab: ClaimTab; page: number; q: string }>({
  tab: queryTab(route.query.tab, TAB_KEYS, 'pending'),
  page: queryPage(route.query.page),
  q: queryString(route.query.q),
});
const filters = computed<AdminBomClaimFilters>(() => ({
  page: listState.value.page,
  pageSize: PAGE_SIZE,
  status: listState.value.tab,
  search: listState.value.q,
}));
const listQuery = useAdminBomClaims(filters);
const counts = computed(() => listQuery.data.value?.data.counts ?? null);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const total = computed(() => listQuery.data.value?.data.total ?? 0);

// 처리 필요(= 새 접수 + 검토 중)가 관리자 차례인 칸이라 건수를 강조한다.
const tabs = computed<QueueTab<ClaimTab>[]>(() => [
  { key: 'pending', label: '처리 필요', count: counts.value?.pending ?? null, attention: true },
  { key: 'open', label: '새 접수', count: counts.value?.open ?? null },
  { key: 'reviewing', label: '검토 중', count: counts.value?.reviewing ?? null },
  { key: 'resolved', label: '해결 완료', count: counts.value?.resolved ?? null },
  { key: 'rejected', label: '처리 불가', count: counts.value?.rejected ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);
const tab = computed<ClaimTab>({
  get: () => listState.value.tab,
  set: (value) => {
    listState.value = { ...listState.value, tab: value, page: 1 };
  },
});
const searchText = ref(listState.value.q);
const applySearch = (): void => {
  listState.value = { ...listState.value, q: searchText.value.trim(), page: 1 };
};
const setPage = (page: number): void => {
  listState.value = { ...listState.value, page };
};
watch(
  listState,
  (value) => {
    replaceListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

const affectedTotal = (claim: { items: readonly { affectedQty: number }[] }): number =>
  claim.items.reduce((sum, item) => sum + item.affectedQty, 0);

// ── 처리 대화상자 — 상세는 최신 상태를 따로 읽는다(목록 행은 열기 전 자리표시) ──────────────────
const selectedClaimId = ref<string | null>(null);
const detailEnabled = computed(() => selectedClaimId.value !== null);
const detailQuery = useAdminBomClaim(selectedClaimId, detailEnabled);
const selectedClaim = computed(() => {
  const detail = detailQuery.data.value?.data;
  if (detail !== undefined) return detail;
  return items.value.find((item) => item.id === selectedClaimId.value) ?? null;
});
const transitionClaim = useTransitionAdminBomClaim();
const resolutionKind = ref<BomClaimResolutionKindType>('replacement');
const responseText = ref('');
const actionError = ref('');

watch(selectedClaimId, (claimId) => {
  if (claimId === null) return;
  resolutionKind.value = 'replacement';
  responseText.value = '';
  actionError.value = '';
});

// 처리 중에는 닫지 않는다(응답 전에 닫으면 결과·오류를 놓친다).
function onDialogOpenChange(open: boolean): void {
  if (!open && !transitionClaim.isPending.value) selectedClaimId.value = null;
}

async function handleTransitionError(error: unknown): Promise<void> {
  actionError.value =
    error instanceof ApiRequestError ? error.message : '클레임 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (error instanceof ApiRequestError && error.status === 409) {
    await detailQuery.refetch();
  }
}

async function startReview(): Promise<void> {
  const claim = selectedClaim.value;
  if (claim === null) return;
  actionError.value = '';
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body: { action: 'start_review', expectedVersion: claim.version },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

async function finish(action: 'resolve' | 'reject'): Promise<void> {
  const claim = selectedClaim.value;
  const response = responseText.value.trim();
  if (claim === null || response.length < 10) {
    actionError.value = '고객에게 전달할 답변을 10자 이상 입력해 주세요.';
    return;
  }
  actionError.value = '';
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body:
        action === 'resolve'
          ? { action: 'resolve', expectedVersion: claim.version, resolutionKind: resolutionKind.value, response }
          : { action: 'reject', expectedVersion: claim.version, response },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

const fmtDate = (value: string): string =>
  new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader
      title="완료·클레임"
      description="배송 후 고객 문제를 접수 순서대로 검토하고 답변합니다. 주문·환불 상태는 자동으로 바꾸지 않습니다."
    >
      <template #actions>
        <Badge variant="warning">
          처리 필요 <span class="tabular-nums">{{ counts?.pending ?? '—' }}</span>건
        </Badge>
      </template>
    </PageHeader>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput v-model="searchText" placeholder="Case명·고객 ID·주문번호·제목" @search="applySearch" />
      </template>
    </QueueTabs>

    <Alert v-if="listQuery.isError.value" variant="destructive" size="sm">
      <AlertDescription>클레임 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</AlertDescription>
    </Alert>
    <p v-else-if="listQuery.isFetching.value && items.length === 0" class="text-muted-foreground flex items-center gap-2 text-sm">
      <Spinner />
      클레임 목록을 확인하는 중…
    </p>
    <Card v-else-if="items.length === 0" class="py-0">
      <Empty>
        <EmptyDescription>이 조건에 맞는 클레임이 없습니다.</EmptyDescription>
      </Empty>
    </Card>

    <!-- 접수 카드 — 한 장에 무엇이 어느 주문에서 몇 개 문제인지까지 보이게 한다(옛 화면과 같은 2단 카드) -->
    <section v-else class="grid gap-3 lg:grid-cols-2" aria-label="클레임 목록">
      <Card v-for="claim in items" :key="claim.id" class="gap-3 py-4">
        <CardHeader class="px-4">
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="bomClaimStatusBadge(claim.status).variant">{{ bomClaimStatusBadge(claim.status).label }}</Badge>
            <span class="text-muted-foreground text-xs font-medium">{{ BOM_CLAIM_KIND_LABELS[claim.kind] }}</span>
            <span class="text-muted-foreground ml-auto text-xs tabular-nums">#{{ claim.id }} · {{ fmtDate(claim.submittedAt) }}</span>
          </div>
          <h3 class="truncate text-base font-semibold">{{ claim.subject }}</h3>
        </CardHeader>
        <CardContent class="flex flex-col gap-3 px-4">
          <p class="text-muted-foreground line-clamp-2 min-h-10 text-sm leading-5">{{ claim.description }}</p>
          <Panel muted>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt class="text-muted-foreground">Case</dt>
              <dd class="truncate font-medium">{{ claim.quoteTitle }}</dd>
              <dt class="text-muted-foreground">고객</dt>
              <dd class="truncate font-medium">{{ claim.mbId }}</dd>
              <dt class="text-muted-foreground">주문</dt>
              <dd class="truncate font-medium">{{ claim.odId }} · {{ claim.orderSnapshot.odStatus }}</dd>
              <dt class="text-muted-foreground">품목</dt>
              <dd class="font-medium tabular-nums">{{ claim.items.length }}종 · 문제 {{ affectedTotal(claim) }}개</dd>
            </dl>
          </Panel>
        </CardContent>
        <CardFooter class="px-4">
          <Button
            variant="outline"
            class="w-full"
            :aria-label="`${claim.subject} 클레임 상세 열기`"
            @click="selectedClaimId = claim.id"
          >
            처리 내용 확인
          </Button>
        </CardFooter>
      </Card>
    </section>

    <ListPagination :page="listState.page" :page-size="PAGE_SIZE" :total="total" @update:page="setPage" />

    <!-- 처리 대화상자 — 배경 클릭·Esc 로 닫힌다(처리 중에는 닫지 않는다). 포커스 가두기·스크롤 잠금은 Dialog 가 한다. -->
    <Dialog :open="selectedClaimId !== null" @update:open="onDialogOpenChange">
      <DialogContent class="sm:max-w-3xl">
        <DialogHeader>
          <div class="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div class="min-w-0 space-y-1">
              <DialogTitle>
                <span class="inline-flex flex-wrap items-center gap-1.5">
                  {{ selectedClaim === null ? '클레임 확인 중…' : `클레임 #${selectedClaim.id}` }}
                  <Badge v-if="selectedClaim !== null" :variant="bomClaimStatusBadge(selectedClaim.status).variant">
                    {{ bomClaimStatusBadge(selectedClaim.status).label }}
                  </Badge>
                </span>
              </DialogTitle>
              <DialogDescription>
                <template v-if="selectedClaim !== null">
                  {{ BOM_CLAIM_KIND_LABELS[selectedClaim.kind] }} · {{ selectedClaim.mbId }} · 주문 {{ selectedClaim.odId }} ·
                  {{ fmtDate(selectedClaim.submittedAt) }} 접수
                </template>
                <template v-else>고객 접수 원장</template>
              </DialogDescription>
            </div>
            <Button v-if="selectedClaim !== null" variant="outline" size="sm" as-child>
              <RouterLink :to="smartbomCaseTo(selectedClaim.quoteId, 'claims')">
                Case 열기
                <ArrowRightIcon />
              </RouterLink>
            </Button>
          </div>
        </DialogHeader>

        <p v-if="detailQuery.isLoading.value && selectedClaim === null" class="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
          <Spinner />
          최신 처리 상태를 불러오는 중…
        </p>
        <DialogScrollBody v-else-if="selectedClaim !== null">
          <div class="space-y-4">
            <section>
              <h3 class="text-base font-semibold">{{ selectedClaim.subject }}</h3>
              <p class="mt-2 text-sm leading-6 whitespace-pre-wrap">{{ selectedClaim.description }}</p>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">문제 부품</h3>
              <TableCard>
                <Table class="min-w-[560px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>MPN</TableHead>
                      <TableHead>제조사</TableHead>
                      <TableHead class="text-right">문제/주문</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow v-for="item in selectedClaim.items" :key="item.id">
                      <TableCell class="font-medium">{{ item.mpn }}</TableCell>
                      <TableCell class="text-muted-foreground">{{ item.manufacturerName ?? '—' }}</TableCell>
                      <TableCell class="text-right font-semibold tabular-nums">{{ item.affectedQty }} / {{ item.orderedQty }}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableCard>
              <p class="text-muted-foreground text-xs">작은 화면에서는 부품 표를 좌우로 이동할 수 있습니다.</p>
            </section>

            <Panel>
              <h3 class="text-sm font-semibold">처리 이력</h3>
              <ol class="mt-3 space-y-3 border-l-2 pl-4">
                <li v-for="event in selectedClaim.events" :key="event.id" class="relative text-sm">
                  <span class="bg-primary absolute top-1.5 -left-5 size-2 rounded-full" />
                  <p class="font-semibold">{{ BOM_CLAIM_STATUS_LABELS[event.toStatus] }}</p>
                  <p class="text-muted-foreground text-xs">{{ event.actorMbId }} · {{ fmtDate(event.createdAt) }}</p>
                  <p v-if="event.note !== null" class="text-muted-foreground mt-1 whitespace-pre-wrap">{{ event.note }}</p>
                </li>
              </ol>
            </Panel>

            <!-- 판정 — ① 검토 시작(open) → ② 고객 답변 후 닫기(reviewing) → 최종 기록(종결) -->
            <Panel v-if="selectedClaim.status === 'open'">
              <p class="text-info text-sm font-semibold">① 검토 시작</p>
              <p class="text-muted-foreground mt-0.5 text-xs">담당자가 접수를 확인했다는 상태를 고객에게 먼저 표시합니다.</p>
              <Button class="mt-2" size="sm" :disabled="transitionClaim.isPending.value" @click="void startReview()">
                {{ transitionClaim.isPending.value ? '처리 중…' : '검토 시작' }}
              </Button>
            </Panel>

            <Panel v-else-if="selectedClaim.status === 'reviewing'" class="space-y-3">
              <div>
                <p class="text-success text-sm font-semibold">② 고객 답변 후 닫기</p>
                <p class="text-muted-foreground mt-0.5 text-xs">
                  실제 환불·재발송은 별도 운영 절차로 진행하고, 여기에는 고객에게 약속한 처리 내용을 남깁니다.
                </p>
              </div>
              <Field>
                <FieldLabel for="bom-claim-resolution">해결 방식</FieldLabel>
                <NativeSelect id="bom-claim-resolution" v-model="resolutionKind">
                  <NativeSelectOption v-for="(label, value) in BOM_CLAIM_RESOLUTION_LABELS" :key="value" :value="value">
                    {{ label }}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel for="bom-claim-response">고객 답변</FieldLabel>
                <Textarea
                  id="bom-claim-response"
                  v-model="responseText"
                  rows="5"
                  maxlength="2000"
                  placeholder="확인 결과와 후속 일정 또는 처리 불가 사유를 구체적으로 적어 주세요."
                />
              </Field>
              <div class="flex flex-wrap gap-2">
                <Button :disabled="transitionClaim.isPending.value" @click="void finish('resolve')">해결 완료</Button>
                <Button variant="outline" :disabled="transitionClaim.isPending.value" @click="void finish('reject')">
                  처리 불가로 닫기
                </Button>
              </div>
            </Panel>

            <Panel v-else-if="selectedClaim.adminResponse !== null" muted>
              <h3 class="text-sm font-semibold">
                최종 답변<span v-if="selectedClaim.resolutionKind !== null"> · {{ BOM_CLAIM_RESOLUTION_LABELS[selectedClaim.resolutionKind] }}</span>
              </h3>
              <p class="mt-2 text-sm leading-6 whitespace-pre-wrap">{{ selectedClaim.adminResponse }}</p>
            </Panel>

            <Alert v-if="actionError !== ''" variant="destructive" size="sm">
              <AlertDescription>{{ actionError }}</AlertDescription>
            </Alert>
          </div>
        </DialogScrollBody>
      </DialogContent>
    </Dialog>
  </div>
</template>
