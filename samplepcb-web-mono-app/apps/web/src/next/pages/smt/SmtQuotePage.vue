<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleCheckIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  RefreshCwIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from '@lucide/vue';
import { SMARTSMT_FILE_PART_LABELS, smartsmtLabel, type AdminSmtQuoteFileType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { NEXT_SMT_ROUTES, safeSmtReturnTo, smtQuoteTo } from '@/next/smt-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import SmtBlocksSection from '@/next/components/smt/SmtBlocksSection.vue';
import SmtFieldGrid from '@/next/components/smt/SmtFieldGrid.vue';
import SmtQuoteLinesSection from '@/next/components/smt/SmtQuoteLinesSection.vue';
import {
  smtBlockedBadge,
  smtFileCheckBadge,
  smtQuoteStatusBadge,
  smtSourceBadge,
} from '@/next/components/smt/smt-badges';
import { readSmtQuoteView, type SmtField } from '@/next/components/smt/smt-envelope';
import { smtAmount, smtBytes, smtDateTime } from '@/next/components/smt/smt-format';
import {
  downloadAdminSmtFile,
  findSmtQuoteRowId,
  useAdminSmtQuote,
  usePullSmtQuote,
} from '@/next/components/smt/useAdminSmt';

// SMT 견적 상세 — docs/SMARTSMT_INTEGRATION.md §4.6. 받은 견적서 한 건을 위에서 아래로:
// 머리 → 금액(최종 금액 = 통합 합계) → 주문 정보 → 견적 줄(SMT 작업비) → 통합 합계 블록 → 경고 → 고객 요청 →
// 동봉 파일 → 견적 이력 → 요율·제어값(접힘) → 원문(접힘).
// 견적서(envelope)는 바깥 JSON 이라 칸이 없거나 모양이 달라도 죽지 않게 smt-envelope.ts 가 타입 가드로 읽는다.
// 견적서의 글자는 글자로만 넣는다(v-html 없음). 이 화면은 관리자 전용 값(labor_charge·user_edits)을 담은
// 원문까지 보인다 — 고객 화면에 재사용하지 않는다.

const route = useRoute();
const router = useRouter();

const quoteRowId = computed<number | null>(() => {
  const raw = route.params.id;
  const id = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
});
const detailQuery = useAdminSmtQuote(quoteRowId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const view = computed(() => (detail.value === null ? null : readSmtQuoteView(detail.value.envelope)));

const notFound = computed(() => {
  const reason = detailQuery.error.value;
  return quoteRowId.value === null || (reason instanceof ApiRequestError && reason.status === 404);
});
const errorMessage = computed(() => {
  const reason = detailQuery.error.value;
  return reason instanceof ApiRequestError && reason.message !== ''
    ? reason.message
    : '견적을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
});

// 목록 복귀 — 떠나온 목록(검색·탭·쪽)으로. 우리 목록 경로가 아니면 받지 않는다.
const returnTo = computed(() => safeSmtReturnTo(route.query.returnTo));
const backTo = computed<RouteLocationRaw>(() => returnTo.value ?? { name: NEXT_SMT_ROUTES.quotes });

const quote = computed(() => detail.value?.quote ?? null);
const currency = computed(() => quote.value?.currency ?? view.value?.currency ?? null);
const blockedBadge = computed(() => (quote.value === null ? null : smtBlockedBadge(quote.value.blockedBy)));

// ── 주문 정보 — 견적서 머리(header)에서 읽은 칸 + 서버가 대조한 주인(회원 여부) ──────────────────────
const memberText = (isMember: boolean | null): string =>
  isMember === null ? '확인 못 함' : isMember ? '회원' : '회원 아님';
const customerFields = computed<SmtField[]>(() => {
  const d = detail.value;
  if (d === null) return [];
  return [
    { key: 'user_edits.owner_name', label: '고객 이름', value: d.order.ownerName ?? '—' },
    { key: 'user_edits.owner_mb_id', label: '고객 아이디', value: d.order.ownerMbId ?? '—' },
    { key: 'owner_is_member', label: '회원 여부', value: memberText(d.order.ownerIsMember) },
    { key: 'header.made_at', label: '만든 시각', value: smtDateTime(d.quote.madeAt ?? view.value?.madeAt) },
    { key: 'received_at', label: '받은 시각', value: smtDateTime(d.quote.receivedAt) },
    { key: 'envelope_version', label: '견적서 판', value: d.quote.envelopeVersion },
  ];
});

// ── 다시 가져오기 — 이 주문 번호로 SmartSMT 에서 다시 당겨 온다. 새 견적이면 그 견적으로 옮겨 간다. ─────────
interface PullNotice {
  duplicate: boolean;
  quoteId: string;
}
const pull = usePullSmtQuote();
const pullNotice = ref<PullNotice | null>(null);
const pullError = ref('');
const fileError = ref('');

// 다른 견적으로 옮겨 가면 앞 견적에서 띄운 알림은 지운다.
watch(quoteRowId, () => {
  pullNotice.value = null;
  pullError.value = '';
  fileError.value = '';
});

async function repull(): Promise<void> {
  const orderId = detail.value?.order.orderId;
  if (orderId === undefined || pull.isPending.value) return;
  pullNotice.value = null;
  pullError.value = '';
  try {
    const { data } = await pull.mutateAsync(orderId);
    const rowId = data.duplicate ? null : await findSmtQuoteRowId(data.orderId, data.quoteId).catch(() => null);
    if (rowId !== null && rowId !== quoteRowId.value) await router.push(smtQuoteTo(rowId, returnTo.value));
    pullNotice.value = { duplicate: data.duplicate, quoteId: data.quoteId };
  } catch (e) {
    pullError.value = e instanceof ApiRequestError && e.message !== '' ? e.message : '견적서를 가져오지 못했습니다.';
  }
}

// ── 동봉 파일 · 이력 ──────────────────────────────────────────────────────────────────────
async function download(file: AdminSmtQuoteFileType): Promise<void> {
  if (file.fileId === null) return;
  fileError.value = '';
  try {
    await downloadAdminSmtFile(file.fileId, file.name ?? `${file.part}.bin`);
  } catch (e) {
    fileError.value = e instanceof ApiRequestError && e.message !== '' ? e.message : '파일을 내려받지 못했습니다.';
  }
}

function openQuote(id: number): void {
  if (id === quoteRowId.value) return;
  void router.push(smtQuoteTo(id, returnTo.value));
}

// ── 요율 · 제어값 / 원문 — 접힌 채로 둔다(확인할 때만 편다) ─────────────────────────────────────
const ratesOpen = ref(false);
const rawOpen = ref(false);
const settingTables = computed(() => [
  { key: 'controls', title: '제어값 (controls)', entries: view.value?.controls ?? [] },
  { key: 'rates', title: '요율 (rates)', entries: view.value?.rates ?? [] },
]);
const rawJson = computed(() => (detail.value === null ? '' : JSON.stringify(detail.value.envelope, null, 2)));
const copied = ref(false);
async function copyRaw(): Promise<void> {
  try {
    await navigator.clipboard.writeText(rawJson.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    // 클립보드 권한이 없는 환경 — 원문은 화면에서 직접 고를 수 있다.
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 머리 — 복귀 링크 · 주문 번호 + 견적 번호 · 상태 · 출처 · 최신 여부 · 다시 가져오기 -->
    <header class="flex flex-col gap-2">
      <RouterLink :to="backTo" class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm">
        <ArrowLeftIcon class="size-4" />
        받은 견적으로
      </RouterLink>
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xl font-semibold tracking-tight">
          <span class="font-mono">{{ detail?.order.orderId ?? '견적' }}</span>
          <span v-if="quote !== null" class="text-muted-foreground font-mono text-sm font-medium">{{ quote.quoteId }}</span>
        </h1>
        <template v-if="quote !== null">
          <Badge :variant="smtQuoteStatusBadge(quote.quoteStatus).variant">{{ smtQuoteStatusBadge(quote.quoteStatus).label }}</Badge>
          <Badge v-if="blockedBadge !== null" :variant="blockedBadge.variant">{{ blockedBadge.label }}</Badge>
          <Badge :variant="smtSourceBadge(quote.source).variant">{{ smtSourceBadge(quote.source).label }}</Badge>
          <Badge v-if="!quote.isLatest" variant="warning" title="같은 주문에 더 나중에 받은 견적이 있습니다">최신 견적 아님</Badge>
        </template>
        <div v-if="detail !== null" class="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="pull.isPending.value"
            title="이 주문 번호로 SmartSMT 에서 견적서를 다시 가져옵니다(파일은 오지 않습니다)"
            @click="void repull()"
          >
            <Spinner v-if="pull.isPending.value" />
            <RefreshCwIcon v-else />
            다시 가져오기
          </Button>
        </div>
      </div>
    </header>

    <Alert v-if="pullError !== ''" variant="destructive" size="sm" role="alert">
      <TriangleAlertIcon />
      <AlertDescription>{{ pullError }}</AlertDescription>
    </Alert>
    <Alert v-if="pullNotice !== null" :variant="pullNotice.duplicate ? 'info' : 'success'" size="sm" role="status">
      <InfoIcon v-if="pullNotice.duplicate" />
      <CircleCheckIcon v-else />
      <AlertDescription>
        {{ pullNotice.duplicate ? '이미 받아 둔 견적입니다' : '견적서를 가져왔습니다' }} — 견적
        <span class="font-mono">{{ pullNotice.quoteId }}</span>
      </AlertDescription>
    </Alert>

    <p v-if="detailQuery.isLoading.value" class="text-muted-foreground flex items-center gap-2 text-sm">
      <Spinner />
      불러오는 중…
    </p>
    <div v-else-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground text-sm">견적을 찾을 수 없습니다.</p>
      <Button variant="outline" size="sm" as-child>
        <RouterLink :to="backTo">
          <ArrowLeftIcon />
          받은 견적 목록으로
        </RouterLink>
      </Button>
    </div>
    <Alert v-else-if="detailQuery.isError.value" variant="destructive">
      <TriangleAlertIcon />
      <AlertDescription>
        <div class="flex flex-wrap items-center gap-3">
          <span>{{ errorMessage }}</span>
          <Button variant="outline" size="sm" :disabled="detailQuery.isFetching.value" @click="void detailQuery.refetch()">
            <RotateCwIcon />
            다시 시도
          </Button>
        </div>
      </AlertDescription>
    </Alert>

    <template v-else-if="detail !== null && quote !== null && view !== null">
      <!-- 금액 — 최종 금액은 통합 합계(null = 미정, 0원이 아니다). SMT 작업비는 그 일부다. -->
      <SectionCard title="금액">
        <template #notice>
          <NoticeBand v-if="quote.blockedBy.length > 0" tone="destructive">
            합계가 막혔습니다: {{ quote.blockedBy.join(', ') }} — 최종 금액이 정해지지 않았습니다. 아래 통합 합계 블록의 사유를 보세요.
          </NoticeBand>
          <NoticeBand v-if="view.policyIsDefault" tone="warning">
            예시 요율로 계산된 견적입니다 — SmartSMT 의 실제 요율이 아니라 기본값으로 계산됐습니다.
          </NoticeBand>
        </template>
        <dl class="flex flex-wrap items-stretch gap-y-3 divide-x" data-testid="smt-amounts">
          <div class="pr-6">
            <dt class="text-muted-foreground text-xs whitespace-nowrap">최종 금액 <span class="font-normal">(통합 합계)</span></dt>
            <dd
              class="text-xl font-semibold whitespace-nowrap tabular-nums"
              :class="quote.finalTotal === null ? 'text-warning' : 'text-success'"
            >
              {{ smtAmount(quote.finalTotal, currency) }}
            </dd>
          </div>
          <div class="px-6">
            <dt class="text-muted-foreground text-xs whitespace-nowrap">공급가</dt>
            <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ smtAmount(quote.finalSupplyPrice, currency) }}</dd>
          </div>
          <div class="px-6">
            <dt class="text-muted-foreground text-xs whitespace-nowrap">부가세</dt>
            <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ smtAmount(quote.finalVat, currency) }}</dd>
          </div>
          <div class="px-6">
            <dt class="text-muted-foreground text-xs whitespace-nowrap">SMT 작업비</dt>
            <dd class="text-base font-semibold whitespace-nowrap tabular-nums">{{ smtAmount(quote.smtTotal, currency) }}</dd>
          </div>
          <div class="pl-6">
            <dt class="text-muted-foreground text-xs whitespace-nowrap">통화</dt>
            <dd class="font-mono text-base font-semibold whitespace-nowrap">{{ currency ?? '—' }}</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="주문 정보">
        <SmtFieldGrid title="고객 · 시각" :fields="customerFields" />
        <SmtFieldGrid title="요율 판" :fields="view.versions" />
        <SmtFieldGrid title="조건" :fields="view.conditions" />
        <SmtFieldGrid title="수량" :fields="view.quantities" />
      </SectionCard>

      <SmtQuoteLinesSection :lines="view.lines" :subtotals="view.subtotals" :costs="view.costs" :currency="currency" />

      <SmtBlocksSection :blocks="view.blocks" :known="view.known" :currency="currency" />

      <!-- 경고 — SmartSMT 가 계산하며 남긴 것. 있을 때만. -->
      <SectionCard v-if="view.warnings.length > 0" title="경고">
        <template #notice>
          <NoticeBand tone="warning">SmartSMT 가 계산하며 남긴 경고입니다 — 금액을 쓰기 전에 확인하세요.</NoticeBand>
        </template>
        <div v-for="group in view.warnings" :key="group.key" class="flex flex-col gap-1">
          <h3 class="text-muted-foreground text-xs font-medium" :title="group.key">
            {{ group.label }} <span class="tabular-nums">({{ group.items.length }})</span>
          </h3>
          <ul class="list-disc pl-5 text-sm">
            <li v-for="(item, index) in group.items" :key="index" class="break-words">{{ item }}</li>
          </ul>
        </div>
      </SectionCard>

      <!-- 고객 요청 — 고객이 SmartSMT 에 쓴 것. 있을 때만. -->
      <SectionCard v-if="view.request.length > 0" title="고객 요청">
        <dl class="flex flex-col gap-3 text-sm">
          <div v-for="field in view.request" :key="field.key" class="flex flex-col gap-0.5">
            <dt class="text-muted-foreground text-xs" :title="field.key">{{ field.label }}</dt>
            <dd class="break-words whitespace-pre-wrap">{{ field.value }}</dd>
          </div>
        </dl>
      </SectionCard>

      <!-- 동봉 파일 — 견적서의 파일 목록과 받은 파일을 맞춘 결과. 가져오기(pull) 견적은 파일이 오지 않는다. -->
      <SectionCard title="동봉 파일" flush>
        <template #meta>{{ detail.files.length }}개</template>
        <template v-if="fileError !== ''" #notice>
          <NoticeBand tone="destructive">{{ fileError }}</NoticeBand>
        </template>
        <Table data-testid="smt-files">
          <TableHeader>
            <TableRow>
              <TableHead>종류</TableHead>
              <TableHead>파일 이름</TableHead>
              <TableHead class="text-right">크기</TableHead>
              <TableHead>대조 결과</TableHead>
              <TableHead class="text-right">내려받기</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="(file, index) in detail.files" :key="`${file.part}-${String(index)}`">
              <TableCell>{{ smartsmtLabel(SMARTSMT_FILE_PART_LABELS, file.part) }}</TableCell>
              <TableCell>
                <span class="block max-w-xs truncate font-mono text-xs" :title="file.name ?? ''">{{ file.name ?? '—' }}</span>
              </TableCell>
              <TableCell class="text-right tabular-nums">{{ smtBytes(file.bytes) }}</TableCell>
              <TableCell>
                <Badge :variant="smtFileCheckBadge(file.check).variant">{{ smtFileCheckBadge(file.check).label }}</Badge>
              </TableCell>
              <TableCell class="text-right">
                <Button
                  v-if="file.fileId !== null"
                  variant="outline"
                  size="xs"
                  :aria-label="`${file.name ?? file.part} 내려받기`"
                  @click="void download(file)"
                >
                  <DownloadIcon />
                  내려받기
                </Button>
                <span v-else class="text-muted-foreground text-xs">파일 없음</span>
              </TableCell>
            </TableRow>
            <TableEmptyRow v-if="detail.files.length === 0" :colspan="5" text="동봉 파일이 없습니다." />
          </TableBody>
        </Table>
      </SectionCard>

      <!-- 견적 이력 — 같은 주문의 견적들(최근 것부터). 다른 줄을 누르면 그 견적으로. -->
      <SectionCard title="견적 이력" flush>
        <template #meta>{{ detail.history.length }}건</template>
        <Table data-testid="smt-history">
          <TableHeader>
            <TableRow>
              <TableHead>견적 번호</TableHead>
              <TableHead>출처</TableHead>
              <TableHead>만든 시각</TableHead>
              <TableHead>받은 시각</TableHead>
              <TableHead>상태</TableHead>
              <TableHead class="text-right">최종 금액</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              v-for="entry in detail.history"
              :key="entry.id"
              :class="entry.id === quote.id ? '' : 'cursor-pointer'"
              :data-state="entry.id === quote.id ? 'selected' : undefined"
              :aria-current="entry.id === quote.id ? 'true' : undefined"
              @click="openQuote(entry.id)"
            >
              <TableCell class="font-mono text-xs font-medium">{{ entry.quoteId }}</TableCell>
              <TableCell>
                <Badge :variant="smtSourceBadge(entry.source).variant">{{ smtSourceBadge(entry.source).label }}</Badge>
              </TableCell>
              <TableCell class="text-muted-foreground tabular-nums">{{ smtDateTime(entry.madeAt) }}</TableCell>
              <TableCell class="text-muted-foreground tabular-nums">{{ smtDateTime(entry.receivedAt) }}</TableCell>
              <TableCell>
                <span class="inline-flex flex-wrap items-center gap-1">
                  <Badge :variant="smtQuoteStatusBadge(entry.quoteStatus).variant">{{ smtQuoteStatusBadge(entry.quoteStatus).label }}</Badge>
                  <Badge v-if="entry.blockedBy.length > 0" variant="danger">합계 막힘</Badge>
                </span>
              </TableCell>
              <TableCell class="text-right font-medium tabular-nums" :class="entry.finalTotal === null ? 'text-warning' : ''">
                {{ smtAmount(entry.finalTotal, entry.currency) }}
              </TableCell>
              <TableCell class="text-right">
                <span class="inline-flex items-center gap-1">
                  <Badge v-if="entry.isLatest" variant="info">최신</Badge>
                  <Badge v-if="entry.id === quote.id" variant="outline">보는 중</Badge>
                </span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </SectionCard>

      <!-- 요율 · 제어값 — 계산에 쓴 값 그대로(% 는 숫자 그대로 10 = 10%, 피치는 nm). 확인할 때만 편다. -->
      <SectionCard v-model:open="ratesOpen" title="요율 · 제어값" collapsible>
        <template #collapsed>요율 · 제어값 — 제어값 {{ view.controls.length }}개 · 요율 {{ view.rates.length }}개</template>
        <div class="grid gap-4 lg:grid-cols-2">
          <div v-for="table in settingTables" :key="table.key" class="flex flex-col gap-1.5">
            <h3 class="text-muted-foreground text-xs font-medium">{{ table.title }}</h3>
            <TableCard>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>키</TableHead>
                    <TableHead class="text-right">값</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="entry in table.entries" :key="entry.key">
                    <TableCell class="font-mono text-xs">{{ entry.key }}</TableCell>
                    <TableCell class="text-right font-mono text-xs">
                      <span class="block max-w-xs truncate" :title="entry.value">{{ entry.value }}</span>
                    </TableCell>
                  </TableRow>
                  <TableEmptyRow v-if="table.entries.length === 0" :colspan="2" text="값이 없습니다." />
                </TableBody>
              </Table>
            </TableCard>
          </div>
        </div>
      </SectionCard>

      <!-- 원문 — 받은 견적서 JSON 그대로(관리자 전용 값 포함). 화면이 아직 모르는 칸도 여기서 본다. -->
      <SectionCard v-model:open="rawOpen" title="원문 (견적서 JSON)" collapsible>
        <template #actions>
          <Button variant="outline" size="xs" @click="void copyRaw()">
            <CheckIcon v-if="copied" />
            <CopyIcon v-else />
            {{ copied ? '복사했습니다' : '복사' }}
          </Button>
        </template>
        <Panel tone="muted" class="max-h-160 overflow-auto">
          <pre class="font-mono text-xs leading-5" data-testid="smt-raw">{{ rawJson }}</pre>
        </Panel>
      </SectionCard>
    </template>
  </div>
</template>
