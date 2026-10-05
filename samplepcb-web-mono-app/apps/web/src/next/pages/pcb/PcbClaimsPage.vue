<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRightIcon, DownloadIcon, PaperclipIcon, UploadIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_CLAIM_FAULT_LABELS,
  PCB_CLAIM_KIND_LABELS,
  PCB_CLAIM_REMEDY_LABELS,
  PCB_CLAIM_RESOLUTION_LABELS,
  PCB_CLAIM_STATUS_LABELS,
  type AdminPcbClaimListQueryType,
  type PcbClaimFaultTypeType,
  type PcbClaimResolutionType,
  type PcbClaimStatusType,
} from '@sp/api-contract';
import { fmtKstDate as fmtDate } from '@sp/utils';
import {
  downloadAdminPcbClaimFile,
  useAdminPcbClaimReturn,
  useAdminPcbClaims,
  useTransitionAdminPcbClaim,
  useUploadAdminPcbClaimFile,
  type AdminPcbClaimFilters,
} from '@/admin/useAdminPcbClaims';
import { useAdminPcbAsCandidates } from '@/admin/useAdminPcbAsCases';
import { pcbCaseTo, queryPage, queryString, queryTab, replacePcbListQuery } from '@/next/pcb-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import { Textarea } from '@/next/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/next/components/ui/tooltip';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import ListPagination from '@/next/components/common/ListPagination.vue';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import QueueTabs from '@/next/components/common/QueueTabs.vue';
import SearchInput from '@/next/components/common/SearchInput.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import type { QueueTab } from '@/next/components/common/queue-tabs';
import { pcbClaimStatusBadge } from '@/next/components/pcb/claims/claim-badges';

// PCB A/S·클레임 워크큐(P5) — 배송 후 고객 접수를 검토·판정하는 단일 창구.
// 다른 PCB 워크큐와 같은 골격: 탭+검색(URL 쿼리 동기화)·표·Case 딥링크(?from=claims).
// 판정의 PCB 고유 축: 귀책(faultType)·처리(resolutionKind)·재생산 핸드오프(대상 협력사 지정 시
// A/S 케이스 초안 생성·연결)·금액 기록·회수 메모. 실행(재생산 회신·환불 실집행)은 각자의 창구가 맡는다.

type ClaimTab = AdminPcbClaimListQueryType['status'];
const TAB_KEYS: readonly ClaimTab[] = ['pending', 'open', 'reviewing', 'resolved', 'rejected', 'all'];

const route = useRoute();
const router = useRouter();
const filters = ref<{ page: number; pageSize: number; tab: ClaimTab; q: string }>({
  page: queryPage(route.query.page),
  pageSize: 20,
  tab: queryTab(route.query.tab, TAB_KEYS, 'pending'),
  q: queryString(route.query.q),
});
const hookFilters = computed<AdminPcbClaimFilters>(() => ({
  page: filters.value.page,
  pageSize: filters.value.pageSize,
  status: filters.value.tab,
  search: filters.value.q,
}));
const listQuery = useAdminPcbClaims(hookFilters);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const counts = computed(() => listQuery.data.value?.data.counts ?? null);
const total = computed(() => listQuery.data.value?.data.total ?? 0);

// 처리 필요(= 새 접수 + 검토 중)가 관리자 차례인 칸이라 건수를 강조한다.
const tabs = computed<QueueTab<ClaimTab>[]>(() => [
  { key: 'pending', label: '처리 필요', count: counts.value?.pending ?? null, attention: true },
  { key: 'open', label: '새 접수', count: counts.value?.open ?? null },
  { key: 'reviewing', label: '검토 중', count: counts.value?.reviewing ?? null },
  { key: 'resolved', label: '처리 완료', count: counts.value?.resolved ?? null },
  { key: 'rejected', label: '처리 불가', count: counts.value?.rejected ?? null },
  { key: 'all', label: '전체', count: counts.value?.all ?? null },
]);
const tab = computed<ClaimTab>({
  get: () => filters.value.tab,
  set: (value) => {
    filters.value = { ...filters.value, tab: value, page: 1 };
  },
});
const searchText = ref(filters.value.q);
const applySearch = (): void => {
  filters.value = { ...filters.value, q: searchText.value, page: 1 };
};
const setPage = (page: number): void => {
  filters.value = { ...filters.value, page };
};
watch(
  filters,
  (value) => {
    replacePcbListQuery(router, route.query, value);
  },
  { deep: true, immediate: true },
);

function openCase(specId: string): void {
  void router.push(pcbCaseTo(Number(specId), 'claims', route.fullPath));
}

// ── 처리 대화상자 — 이 화면이 판정의 단일 창구다(행 클릭=처리 열기, Case 는 별도 버튼) ──
const selectedClaimId = ref<string | null>(null);
const selectedClaim = computed(
  () => items.value.find((item) => item.id === selectedClaimId.value) ?? null,
);
const transitionClaim = useTransitionAdminPcbClaim();
const returnMutation = useAdminPcbClaimReturn();
const uploadFile = useUploadAdminPcbClaimFile();

const resolutionKind = ref<PcbClaimResolutionType>('reproduce');
const faultType = ref<PcbClaimFaultTypeType>('manufacturing');
const responseText = ref('');
const targetPartnerId = ref<number | null>(null);
const chargeAmountText = ref('');
const refundAmountText = ref('');
const returnRequired = ref(false);
const returnNote = ref('');
const actionError = ref('');

// 재생산 대상 협력사 — A/S 케이스 후보 API 재사용(원주문 발주를 보유한 leaf).
const candidateSpecId = computed<number | null>(() =>
  selectedClaim.value === null ? null : Number(selectedClaim.value.specId),
);
const candidatesEnabled = computed(
  () => selectedClaim.value?.status === 'reviewing' && resolutionKind.value === 'reproduce',
);
const candidatesQuery = useAdminPcbAsCandidates(candidateSpecId, candidatesEnabled);
const candidates = computed(() => candidatesQuery.data.value?.data.candidates ?? []);
watch(candidates, (list) => {
  // 후보가 1곳이면 자동 선택(A/S 접수 대화상자와 같은 관례).
  if (targetPartnerId.value === null && list.length === 1) {
    targetPartnerId.value = list[0]?.partnerId ?? null;
  }
});

function openDetail(claimId: string): void {
  selectedClaimId.value = claimId;
  resolutionKind.value = 'reproduce';
  faultType.value = 'manufacturing';
  responseText.value = '';
  targetPartnerId.value = null;
  chargeAmountText.value = '';
  refundAmountText.value = '';
  const claim = items.value.find((item) => item.id === claimId) ?? null;
  returnRequired.value = claim?.returnRequired ?? false;
  returnNote.value = claim?.returnNote ?? '';
  actionError.value = '';
}

function closeDetail(): void {
  if (transitionClaim.isPending.value) return;
  selectedClaimId.value = null;
}

const onDialogOpenChange = (open: boolean): void => {
  if (!open) closeDetail();
};

// 종결된 클레임이 현재 탭(예: 처리 필요)에서 빠지면 상세의 근거 데이터도 사라진다 —
// 빈 대화상자를 세워 두지 않고 닫는다(목록 무효화 후 재조회가 끝난 시점에 발화).
watch(selectedClaim, (claim) => {
  if (claim === null && selectedClaimId.value !== null && !transitionClaim.isPending.value) {
    selectedClaimId.value = null;
  }
});

async function handleTransitionError(error: unknown): Promise<void> {
  actionError.value =
    error instanceof ApiRequestError
      ? error.message
      : '클레임 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (error instanceof ApiRequestError && error.status === 409) {
    await listQuery.refetch();
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

const parseAmount = (text: string): number | undefined => {
  const trimmed = text.trim().replaceAll(',', '');
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
};

async function finish(action: 'resolve' | 'reject'): Promise<void> {
  const claim = selectedClaim.value;
  const response = responseText.value.trim();
  if (claim === null || response.length < 5) {
    actionError.value = '고객에게 전달할 답변을 5자 이상 입력해 주세요.';
    return;
  }
  if (
    action === 'resolve' &&
    resolutionKind.value === 'reproduce' &&
    candidates.value.length > 0 &&
    targetPartnerId.value === null
  ) {
    actionError.value = '재생산을 맡길 협력사를 선택해 주세요.';
    return;
  }
  actionError.value = '';
  const chargeAmount = parseAmount(chargeAmountText.value);
  const refundAmount = parseAmount(refundAmountText.value);
  try {
    await transitionClaim.mutateAsync({
      claimId: claim.id,
      body:
        action === 'resolve'
          ? {
              action: 'resolve',
              expectedVersion: claim.version,
              resolutionKind: resolutionKind.value,
              faultType: faultType.value,
              response,
              ...(resolutionKind.value === 'reproduce' && targetPartnerId.value !== null
                ? { targetPartnerId: targetPartnerId.value }
                : {}),
              ...(chargeAmount === undefined ? {} : { chargeAmount }),
              ...(refundAmount === undefined ? {} : { refundAmount }),
            }
          : {
              action: 'reject',
              expectedVersion: claim.version,
              faultType: faultType.value,
              response,
            },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

async function saveReturn(): Promise<void> {
  const claim = selectedClaim.value;
  if (claim === null) return;
  actionError.value = '';
  try {
    await returnMutation.mutateAsync({
      claimId: claim.id,
      body: {
        returnRequired: returnRequired.value,
        ...(returnNote.value.trim() === '' ? {} : { returnNote: returnNote.value.trim() }),
      },
    });
  } catch (error) {
    await handleTransitionError(error);
  }
}

function pickAdminFile(): void {
  const claim = selectedClaim.value;
  if (claim === null) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    actionError.value = '';
    try {
      await uploadFile.mutateAsync({ claimId: claim.id, file });
    } catch (error) {
      await handleTransitionError(error);
    }
  };
  input.click();
}

function downloadFile(claimId: string, fileId: number, name: string): void {
  void downloadAdminPcbClaimFile(claimId, fileId, name);
}

const claimOpen = (status: PcbClaimStatusType): boolean =>
  status === 'open' || status === 'reviewing';
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader title="PCB A/S·클레임">
      <template #description>
        배송 후 고객 접수를 검토하고 <b class="text-foreground font-semibold">귀책·처리 방식을 판정</b>합니다 — 재생산은
        A/S 케이스로, 환불은 주문 환불 기록으로 이어지며 주문 상태를 자동으로 바꾸지 않습니다. 대리 접수는 Case 상세에서.
      </template>
    </PageHeader>

    <QueueTabs v-model="tab" :tabs="tabs">
      <template #end>
        <SearchInput v-model="searchText" placeholder="프로젝트·고객 아이디·주문번호 검색" @search="applySearch" />
      </template>
    </QueueTabs>

    <TableCard>
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>접수일</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>프로젝트</TableHead>
              <TableHead>유형</TableHead>
              <TableHead>증상</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>문제 수량</TableHead>
              <TableHead>고객 희망</TableHead>
              <TableHead>판정</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="claim in items" :key="claim.id" class="cursor-pointer" @click="openDetail(claim.id)">
              <TableCell class="text-muted-foreground">{{ fmtDate(claim.submittedAt) }}</TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1">
                  <Badge :variant="pcbClaimStatusBadge(claim.status).variant">
                    {{ pcbClaimStatusBadge(claim.status).label }}
                  </Badge>
                  <Tooltip v-if="claim.createdByRole === 'admin'">
                    <TooltipTrigger as-child>
                      <Badge variant="outline">대리</Badge>
                    </TooltipTrigger>
                    <TooltipContent>관리자가 전화·메일 접수를 대신 입력한 건</TooltipContent>
                  </Tooltip>
                </span>
              </TableCell>
              <TableCell>
                <span class="flex max-w-56 items-baseline gap-1.5" :title="claim.projectName">
                  <span class="text-muted-foreground shrink-0 font-mono text-xs">Q{{ claim.specId }}</span>
                  <span class="truncate font-medium">{{ claim.projectName }}</span>
                </span>
              </TableCell>
              <TableCell>{{ PCB_CLAIM_KIND_LABELS[claim.kind] }}</TableCell>
              <TableCell>
                <span class="text-muted-foreground flex max-w-xs items-center gap-1.5" :title="claim.description">
                  <span class="truncate">{{ claim.description }}</span>
                  <span v-if="claim.files.length > 0" class="inline-flex shrink-0 items-center gap-0.5 text-xs">
                    <PaperclipIcon class="size-3" />{{ claim.files.length }}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                {{ claim.mbId }}
                <span class="text-muted-foreground block font-mono text-xs">{{ claim.odId }}</span>
              </TableCell>
              <TableCell class="tabular-nums">{{ claim.affectedQty }} / {{ claim.orderedQty }}</TableCell>
              <TableCell class="text-muted-foreground text-xs">{{ PCB_CLAIM_REMEDY_LABELS[claim.requestedRemedy] }}</TableCell>
              <TableCell>
                <span v-if="claim.resolutionKind !== null" class="inline-flex items-center gap-1">
                  <Badge variant="success">{{ PCB_CLAIM_RESOLUTION_LABELS[claim.resolutionKind] }}</Badge>
                  <Badge v-if="claim.asCaseId !== null" variant="info">A/S #{{ claim.asCaseId }}</Badge>
                </span>
                <span v-else-if="claim.status === 'rejected'" class="text-muted-foreground text-xs">처리 불가</span>
                <span v-else class="text-muted-foreground">—</span>
              </TableCell>
              <TableCell class="text-right">
                <span class="inline-flex items-center gap-1.5">
                  <Button
                    :variant="claimOpen(claim.status) ? 'default' : 'outline'"
                    size="sm"
                    @click.stop="openDetail(claim.id)"
                  >
                    {{ claimOpen(claim.status) ? '처리' : '내용' }}
                  </Button>
                  <Button variant="outline" size="sm" @click.stop="openCase(claim.specId)">
                    Case 열기
                    <ArrowRightIcon />
                  </Button>
                </span>
              </TableCell>
            </TableRow>
            <TableEmptyRow
              v-if="items.length === 0"
              :colspan="10"
              :loading="listQuery.isFetching.value"
              text="해당 상태의 접수가 없습니다."
            />
          </TableBody>
        </Table>
      </TooltipProvider>
    </TableCard>

    <ListPagination :page="filters.page" :page-size="filters.pageSize" :total="total" @update:page="setPage" />

    <!-- 처리 대화상자 — 배경 클릭·Esc 로 닫힌다(처리 중에는 닫지 않는다) -->
    <Dialog :open="selectedClaim !== null" @update:open="onDialogOpenChange">
      <DialogContent v-if="selectedClaim !== null" class="sm:max-w-2xl">
        <DialogHeader>
          <div class="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div class="min-w-0 space-y-1">
              <DialogTitle>
                <span class="inline-flex flex-wrap items-center gap-1.5">
                  클레임 #{{ selectedClaim.id }}
                  <Badge :variant="pcbClaimStatusBadge(selectedClaim.status).variant">
                    {{ pcbClaimStatusBadge(selectedClaim.status).label }}
                  </Badge>
                  <Badge v-if="selectedClaim.createdByRole === 'admin'" variant="outline">대리 접수</Badge>
                </span>
              </DialogTitle>
              <DialogDescription>
                {{ selectedClaim.mbId }} · 주문 {{ selectedClaim.odId }} · {{ fmtDate(selectedClaim.submittedAt) }} 접수
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" @click="openCase(selectedClaim.specId)">
              Case 열기
              <ArrowRightIcon />
            </Button>
          </div>
        </DialogHeader>

        <DialogScrollBody>
          <div class="space-y-3">
            <!-- 접수 원문 -->
            <Panel>
              <p class="text-muted-foreground text-xs font-semibold">
                {{ PCB_CLAIM_KIND_LABELS[selectedClaim.kind] }} · 문제 수량
                <span class="tabular-nums">{{ selectedClaim.affectedQty }}/{{ selectedClaim.orderedQty }}</span> ·
                {{ PCB_CLAIM_REMEDY_LABELS[selectedClaim.requestedRemedy] }}
              </p>
              <p class="mt-1 flex items-baseline gap-1.5 text-sm font-semibold">
                <span class="text-muted-foreground shrink-0 font-mono text-xs font-normal">Q{{ selectedClaim.specId }}</span>
                <span class="truncate">{{ selectedClaim.projectName }}</span>
              </p>
              <p class="mt-1.5 text-sm leading-6 whitespace-pre-wrap">{{ selectedClaim.description }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  v-for="f in selectedClaim.files"
                  :key="f.fileId"
                  variant="outline"
                  size="sm"
                  :title="`${f.name} · ${f.uploadedBy === 'ADMIN' ? '관리자' : '고객'} 업로드`"
                  @click="downloadFile(selectedClaim.id, f.fileId, f.name)"
                >
                  <DownloadIcon />
                  {{ f.name }}
                </Button>
                <Button
                  v-if="claimOpen(selectedClaim.status)"
                  variant="ghost"
                  size="sm"
                  :disabled="uploadFile.isPending.value"
                  @click="pickAdminFile"
                >
                  <UploadIcon />
                  첨부 추가
                </Button>
              </div>
            </Panel>

            <!-- 회수 기록(자유 메모) — 정식 역물류 모델 보류(08-15 결정) -->
            <Panel
              v-if="claimOpen(selectedClaim.status) || selectedClaim.returnRequired"
              class="flex flex-wrap items-center gap-2"
            >
              <span class="flex items-center gap-1.5">
                <Checkbox
                  id="pcb-claim-return-required"
                  :model-value="returnRequired"
                  :disabled="!claimOpen(selectedClaim.status)"
                  @update:model-value="returnRequired = $event === true"
                />
                <Label for="pcb-claim-return-required">불량품 회수 필요</Label>
              </span>
              <span class="min-w-0 flex-1">
                <Input
                  v-model="returnNote"
                  type="text"
                  maxlength="500"
                  placeholder="회수 방법·운송장 번호 등 메모"
                  aria-label="회수 메모"
                  :disabled="!claimOpen(selectedClaim.status)"
                />
              </span>
              <Button
                v-if="claimOpen(selectedClaim.status)"
                variant="outline"
                size="sm"
                :disabled="returnMutation.isPending.value"
                @click="void saveReturn()"
              >
                저장
              </Button>
            </Panel>

            <!-- 판정 — 검토 시작(open) → 판정 폼(reviewing) → 최종 기록(종결) -->
            <Panel v-if="selectedClaim.status === 'open'">
              <p class="text-info text-sm font-semibold">① 검토 시작</p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                고객에게 "확인 중" 상태가 표시됩니다 — 판정 입력은 그 다음.
              </p>
              <Button class="mt-2" size="sm" :disabled="transitionClaim.isPending.value" @click="void startReview()">
                {{ transitionClaim.isPending.value ? '처리 중…' : '검토 시작' }}
              </Button>
            </Panel>

            <Panel v-else-if="selectedClaim.status === 'reviewing'" class="space-y-3">
              <p class="text-sm font-semibold">② 판정 — 귀책·처리 확정 후 고객 회신</p>
              <div class="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel for="pcb-claim-fault">귀책 판정</FieldLabel>
                  <NativeSelect id="pcb-claim-fault" v-model="faultType">
                    <NativeSelectOption v-for="(label, value) in PCB_CLAIM_FAULT_LABELS" :key="value" :value="value">
                      {{ label }}
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel for="pcb-claim-resolution">처리 방식</FieldLabel>
                  <NativeSelect id="pcb-claim-resolution" v-model="resolutionKind">
                    <NativeSelectOption v-for="(label, value) in PCB_CLAIM_RESOLUTION_LABELS" :key="value" :value="value">
                      {{ label }}
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>

              <template v-if="resolutionKind === 'reproduce'">
                <Field v-if="candidates.length > 0">
                  <FieldLabel for="pcb-claim-partner">
                    재생산 협력사 <span class="text-destructive">*</span>
                  </FieldLabel>
                  <NativeSelect id="pcb-claim-partner" v-model="targetPartnerId">
                    <NativeSelectOption :value="null" disabled>선택</NativeSelectOption>
                    <NativeSelectOption v-for="c in candidates" :key="c.partnerId" :value="c.partnerId">
                      {{ c.partnerName }}{{ c.parentPartnerName === null ? '' : ` (MD 경유 · ${c.parentPartnerName})` }}
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    확정 시 A/S 케이스 초안이 만들어져 연결됩니다 — 접수 전송·회신·재발주는 Case 상세 A/S 패널에서.
                  </FieldDescription>
                </Field>
                <Alert v-else variant="warning" size="sm">
                  <AlertDescription>원주문 발주 협력사가 없어 케이스 자동 생성 없이 방침만 기록됩니다.</AlertDescription>
                </Alert>
                <Field>
                  <FieldLabel for="pcb-claim-charge">
                    유상 청구액 기록
                    <span class="text-muted-foreground font-normal">(원 · 선택 — 실청구는 별도)</span>
                  </FieldLabel>
                  <span class="block w-48">
                    <Input
                      id="pcb-claim-charge"
                      v-model="chargeAmountText"
                      type="text"
                      inputmode="numeric"
                      placeholder="예) 150000"
                    />
                  </span>
                </Field>
              </template>
              <Field v-if="resolutionKind === 'refund_coordination'">
                <FieldLabel for="pcb-claim-refund">
                  환불 협의액 기록
                  <span class="text-muted-foreground font-normal">(원 · 선택 — 실집행은 주문 환불 기록 창구)</span>
                </FieldLabel>
                <span class="block w-48">
                  <Input
                    id="pcb-claim-refund"
                    v-model="refundAmountText"
                    type="text"
                    inputmode="numeric"
                    placeholder="예) 66000"
                  />
                </span>
              </Field>

              <Field>
                <FieldLabel for="pcb-claim-response">
                  고객 답변 <span class="text-destructive">*</span>
                </FieldLabel>
                <Textarea
                  id="pcb-claim-response"
                  v-model="responseText"
                  rows="3"
                  maxlength="2000"
                  placeholder="판정 결과와 후속 일정(또는 처리 불가 사유)을 적어 주세요 — 고객 메일로 그대로 나갑니다."
                />
              </Field>
              <div class="flex flex-wrap gap-2">
                <Button size="sm" :disabled="transitionClaim.isPending.value" @click="void finish('resolve')">
                  처리 확정
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="transitionClaim.isPending.value"
                  @click="void finish('reject')"
                >
                  처리 불가로 닫기
                </Button>
              </div>
            </Panel>

            <Panel v-else muted>
              <p class="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                최종 판정
                <Badge v-if="selectedClaim.faultType !== null" variant="secondary">
                  {{ PCB_CLAIM_FAULT_LABELS[selectedClaim.faultType] }}
                </Badge>
                <Badge v-if="selectedClaim.resolutionKind !== null" variant="success">
                  {{ PCB_CLAIM_RESOLUTION_LABELS[selectedClaim.resolutionKind] }}
                </Badge>
              </p>
              <p v-if="selectedClaim.adminResponse !== null" class="mt-1.5 text-sm leading-6 whitespace-pre-wrap">
                {{ selectedClaim.adminResponse }}
              </p>
              <p class="text-muted-foreground mt-1.5 text-xs">
                <template v-if="selectedClaim.asCaseId !== null">A/S 케이스 #{{ selectedClaim.asCaseId }} 연결 · </template>
                <template v-if="selectedClaim.chargeAmount !== null">
                  유상 청구 기록 ₩{{ selectedClaim.chargeAmount.toLocaleString('ko-KR') }} ·
                </template>
                <template v-if="selectedClaim.refundAmount !== null">
                  환불 협의 기록 ₩{{ selectedClaim.refundAmount.toLocaleString('ko-KR') }} ·
                </template>
                {{ selectedClaim.closedAt === null ? '' : fmtDate(selectedClaim.closedAt) }}
              </p>
            </Panel>

            <!-- 처리 이력(원장) -->
            <Panel>
              <p class="text-muted-foreground text-xs font-semibold">처리 이력</p>
              <ol class="mt-1.5 space-y-1.5">
                <li v-for="event in selectedClaim.events" :key="event.id" class="text-muted-foreground text-xs">
                  <b class="text-foreground font-semibold">{{ PCB_CLAIM_STATUS_LABELS[event.toStatus] }}</b>
                  · {{ event.actorRole === 'customer' ? '고객' : '관리자' }} {{ event.actorMbId }}
                  · {{ fmtDate(event.createdAt) }}
                  <span v-if="event.note !== null" class="block pl-2 whitespace-pre-wrap">↳ {{ event.note }}</span>
                </li>
              </ol>
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
