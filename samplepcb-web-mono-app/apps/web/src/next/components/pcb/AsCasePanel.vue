<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ChevronRightIcon, PlusIcon, XIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  PCB_AS_CASE_STATUS_LABELS,
  PCB_AS_CASE_TYPES,
  PCB_AS_CASE_TYPE_LABELS,
  PCB_AS_CHARGE_LABELS,
  PCB_AS_CHARGE_TYPES,
  defaultPcbAsCharge,
  type AdminPcbAsCaseViewType,
  type PcbAsCandidateViewType,
  type PcbAsCaseStatusType,
  type PcbAsCaseTypeType,
  type PcbAsChargeTypeType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import {
  downloadAdminPcbAsCaseFile,
  useAdminPcbAsCandidates,
  useAdminPcbAsCases,
  useCreatePcbAsCase,
  useDeletePcbAsCase,
  useDeletePcbAsCaseFile,
  useProceedPcbAsCase,
  useRecallPcbAsCase,
  useReplyPcbAsCase,
  useSubmitPcbAsCase,
  useUpdatePcbAsCase,
  useUploadPcbAsCaseFile,
} from '@/admin/useAdminPcbAsCases';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import { Textarea } from '@/next/components/ui/textarea';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import type { BadgeVariant } from './pcb-badges';

// PCB A/S 재발주 패널(P4) — Case 상세 임베드. 옛 PcbAsCasePanel 과 같은 API.
// 접수(draft)→전송(submitted)→협력사 회신(accepted/rejected)→[재발주 진행](proceeded, 회차 발주서)의 허브.
// 첨부·수정은 draft 에서만 — 전송 후엔 협력사가 보는 내용이라 고정(회수로 되돌림).
const props = defineProps<{ specId: number }>();
const specIdRef = computed(() => props.specId);

const listQuery = useAdminPcbAsCases(specIdRef);
const cases = computed(() => listQuery.data.value?.data.cases ?? []);
// 진행 중(회신 대기·진행 대기) 수 — 접힘 바 강조용. proceeded 는 케이스 축에선 종결이라 안 센다.
const activeCount = computed(
  () => cases.value.filter((c) => c.status === 'submitted' || c.status === 'accepted').length,
);
// 진행 중이 있으면 펼쳐서 신호를 준다 — 없으면 접힘 시작.
const collapsed = ref(true);
let autoOpened = false;
watch(cases, (v) => {
  if (!autoOpened && v.some((c) => c.status === 'submitted' || c.status === 'accepted')) {
    collapsed.value = false;
    autoOpened = true;
  }
});

const error = ref('');
const failMessage = (e: unknown): string =>
  e instanceof ApiRequestError ? (e.payload?.message ?? '처리에 실패했습니다') : '처리에 실패했습니다';
const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
  error.value = '';
  try {
    await fn();
    return true;
  } catch (e) {
    error.value = failMessage(e);
    return false;
  }
};

// ── 접수 대화상자(생성/수정 겸용) ─────────────────────────────────────────────
const modalOpen = ref(false);
const editId = ref<number | null>(null);
const candQuery = useAdminPcbAsCandidates(specIdRef, modalOpen);
const candidates = computed<PcbAsCandidateViewType[]>(
  () => candQuery.data.value?.data.candidates ?? [],
);
const form = ref<{
  targetPartnerId: number | null;
  caseType: PcbAsCaseTypeType;
  chargeType: PcbAsChargeTypeType;
  description: string;
}>({
  targetPartnerId: null,
  caseType: 'product_defect',
  chargeType: 'free',
  description: '',
});

const openCreate = (): void => {
  editId.value = null;
  form.value = { targetPartnerId: null, caseType: 'product_defect', chargeType: 'free', description: '' };
  modalOpen.value = true;
};
const openEdit = (c: AdminPcbAsCaseViewType): void => {
  editId.value = c.id;
  form.value = {
    targetPartnerId: c.targetPartnerId,
    caseType: c.caseType,
    chargeType: c.chargeType,
    description: c.description ?? '',
  };
  modalOpen.value = true;
};
// 후보가 1곳이면 자동 선택(레거시 UX 승계).
watch(candidates, (v) => {
  if (form.value.targetPartnerId === null && v.length === 1) {
    form.value.targetPartnerId = v[0]?.partnerId ?? null;
  }
});
/** 유형을 바꾸면 비용을 기본 규칙으로 재설정(관리자가 다시 바꿀 수 있다). */
const pickType = (t: PcbAsCaseTypeType): void => {
  form.value.caseType = t;
  form.value.chargeType = defaultPcbAsCharge(t);
};
const setDescription = (value: string | number): void => {
  form.value.description = String(value);
};

const createMut = useCreatePcbAsCase();
const updateMut = useUpdatePcbAsCase();
const canSave = computed(
  () => form.value.targetPartnerId !== null && !createMut.isPending.value && !updateMut.isPending.value,
);
const save = async (): Promise<void> => {
  const targetPartnerId = form.value.targetPartnerId;
  if (targetPartnerId === null) return;
  const body = {
    targetPartnerId,
    caseType: form.value.caseType,
    chargeType: form.value.chargeType,
    ...(form.value.description.trim() === '' ? {} : { description: form.value.description.trim() }),
  };
  const id = editId.value;
  const ok = await run(() =>
    id === null
      ? createMut.mutateAsync({ specId: props.specId, body })
      : updateMut.mutateAsync({ caseId: id, body }),
  );
  if (ok) modalOpen.value = false;
};

// ── 액션들 ──────────────────────────────────────────────────────────────────
const submitMut = useSubmitPcbAsCase();
const recallMut = useRecallPcbAsCase();
const deleteMut = useDeletePcbAsCase();
const replyMut = useReplyPcbAsCase();
const proceedMut = useProceedPcbAsCase();

const doSubmit = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message: `${c.targetPartnerName}에 A/S 접수를 전송합니다.\n전송 후에는 내용·첨부가 고정됩니다(회수로 되돌릴 수 있음).`,
      confirmLabel: '접수 요청',
    }))
  )
    return;
  await run(() => submitMut.mutateAsync(c.id));
};
const doRecall = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  await run(() => recallMut.mutateAsync(c.id));
};
const doDelete = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message: '이 A/S 초안을 삭제할까요? 첨부도 함께 삭제됩니다.',
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  )
    return;
  await run(() => deleteMut.mutateAsync(c.id));
};

// 대행 회신 — 포털 미사용 협력사 대비. 사유는 선택(거절 시 권장).
const doReply = async (c: AdminPcbAsCaseViewType, accept: boolean): Promise<void> => {
  error.value = '';
  // 저장은 대화상자가 연 채로 — 실패하면 적어 둔 사유가 남은 채 오류가 보인다.
  await promptDialog({
    title: accept ? '대행 회신 — 재생산 가능' : '대행 회신 — 재생산 불가',
    fields: [
      {
        name: 'reason',
        label: accept ? '사유 (선택)' : '사유 (권장)',
        type: 'textarea',
        placeholder: '협력사가 전한 회신 내용',
      },
    ],
    confirmLabel: accept ? '재생산 가능으로 기록' : '재생산 불가로 기록',
    errorFallback: '대행 회신 기록에 실패했습니다.',
    submit: async (values) => {
      await replyMut.mutateAsync({ caseId: c.id, accept, reason: values.reason ?? '' });
    },
  });
};

const proceededPoId = ref<number | null>(null);
const doProceed = async (c: AdminPcbAsCaseViewType): Promise<void> => {
  if (
    !(await confirmDialog({
      message:
        '회차 발주서를 생성합니다(회차 자동 부여).\n조건은 원발주에서 이어받고 납기는 비워집니다 — 발주서·EQ 섹션에서 발주접수부터 진행하세요.',
      confirmLabel: '재발주 진행',
    }))
  )
    return;
  error.value = '';
  try {
    const res = await proceedMut.mutateAsync(c.id);
    proceededPoId.value = res.data.poId;
  } catch (e) {
    error.value = failMessage(e);
  }
};

// ── 첨부(draft) ─────────────────────────────────────────────────────────────
const uploadMut = useUploadPcbAsCaseFile();
const deleteFileMut = useDeletePcbAsCaseFile();
const fileInput = ref<HTMLInputElement | null>(null);
const uploadFor = ref<number | null>(null);
const pickFile = (caseId: number): void => {
  uploadFor.value = caseId;
  fileInput.value?.click();
};
const onFile = async (e: Event): Promise<void> => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  const caseId = uploadFor.value;
  input.value = '';
  if (file === undefined || caseId === null) return;
  await run(() => uploadMut.mutateAsync({ caseId, file }));
};
const removeFile = async (caseId: number, fileId: number): Promise<void> => {
  await run(() => deleteFileMut.mutateAsync({ caseId, fileId }));
};

// 회신 대기 = 기다림, 재생산 가능 = 우리가 진행할 차례(끝난 합의), 불가 = 문제, 진행됨 = 회차 발주로 넘어감.
const STATUS_VARIANT: Record<PcbAsCaseStatusType, BadgeVariant> = {
  draft: 'secondary',
  submitted: 'warning',
  accepted: 'success',
  rejected: 'danger',
  proceeded: 'info',
};
const trackLabel = (parentPartnerId: number, parentPartnerName: string | null): string =>
  parentPartnerId === 0 ? '직거래' : `MD 경유 · ${parentPartnerName ?? ''}`;
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm"
    @click="collapsed = false"
  >
    <ChevronRightIcon class="size-4" />
    <span>
      A/S 재발주 ({{ cases.length }}건<template v-if="activeCount > 0"> · <b class="text-warning">진행 중 {{ activeCount }}건</b></template>)
    </span>
    <span class="ml-auto text-xs">펼치기</span>
  </button>
  <Card v-else class="gap-0 py-0">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
      <h2 class="text-sm font-semibold">
        A/S 재발주
        <span class="text-muted-foreground ml-1 text-xs font-normal">{{ cases.length }}건</span>
      </h2>
      <Button size="sm" @click="openCreate">
        <PlusIcon />
        A/S 접수
      </Button>
    </div>
    <p class="text-muted-foreground border-b px-4 py-2 text-xs">
      완료·출고된 발주의 재생산 흐름: 접수 작성 → [접수 요청](협력사 통지) →
      협력사 회신(가능/불가) → <b class="text-foreground">[재발주 진행]</b> = 회차 발주서 생성(발주접수부터 재진행).
    </p>

    <p v-if="error !== ''" class="bg-destructive-soft text-destructive border-b px-4 py-2 text-sm font-medium">
      {{ error }}
    </p>
    <p v-if="proceededPoId !== null" class="bg-info-soft text-info border-b px-4 py-2 text-sm font-medium">
      회차 발주서 #{{ proceededPoId }}가 생성되었습니다 — 위 <b>발주서 · EQ</b> 섹션에서 진행하세요.
    </p>

    <p v-if="cases.length === 0" class="text-muted-foreground px-4 py-6 text-center text-sm">
      A/S 접수가 없습니다.
    </p>
    <div v-else class="[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>유형 · 비용</TableHead>
            <TableHead>대상 / 트랙</TableHead>
            <TableHead>상태 / 회차</TableHead>
            <TableHead>내용 · 회신</TableHead>
            <TableHead>첨부</TableHead>
            <TableHead class="text-right">액션</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="c in cases" :key="c.id" class="align-top">
            <TableCell>
              <span class="flex flex-wrap gap-1">
                <Badge :variant="c.caseType === 'product_defect' ? 'danger' : 'warning'">
                  {{ PCB_AS_CASE_TYPE_LABELS[c.caseType] }}
                </Badge>
                <Badge :variant="c.chargeType === 'free' ? 'success' : 'info'">
                  {{ PCB_AS_CHARGE_LABELS[c.chargeType] }}
                </Badge>
              </span>
              <span class="text-muted-foreground mt-1 block text-xs">{{ fmtKstDate(c.createdAt) }}</span>
            </TableCell>
            <TableCell>
              <span class="block font-medium">{{ c.targetPartnerName }}</span>
              <span class="text-muted-foreground block text-xs">{{ trackLabel(c.parentPartnerId, c.parentPartnerName) }}</span>
            </TableCell>
            <TableCell>
              <span class="flex flex-wrap gap-1">
                <Badge :variant="STATUS_VARIANT[c.status]">{{ PCB_AS_CASE_STATUS_LABELS[c.status] }}</Badge>
                <Badge v-if="c.reorderRound !== null" variant="outline">{{ c.reorderRound }}차</Badge>
              </span>
              <span v-if="c.roundPoId !== null" class="text-info mt-1 block text-xs">발주 #{{ c.roundPoId }}</span>
            </TableCell>
            <TableCell class="max-w-64 whitespace-normal">
              <span v-if="c.description !== null" class="text-muted-foreground block text-xs whitespace-pre-wrap">{{ c.description }}</span>
              <span
                v-if="c.replyReason !== null"
                class="mt-1 block text-xs whitespace-pre-wrap"
                :class="c.status === 'rejected' ? 'text-destructive' : 'text-success'"
              >
                ↳ 회신: {{ c.replyReason }}
              </span>
            </TableCell>
            <TableCell>
              <span v-for="f in c.files" :key="f.fileId" class="flex items-center gap-1 text-xs">
                <Button variant="link" size="xs" @click="void downloadAdminPcbAsCaseFile(c.id, f.fileId, f.name)">
                  {{ f.name }}
                </Button>
                <span class="text-muted-foreground">{{ f.uploadedBy === 'PARTNER' ? '협력사' : '관리자' }}</span>
                <Button
                  v-if="c.status === 'draft'"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="첨부 제거"
                  @click="void removeFile(c.id, f.fileId)"
                >
                  <XIcon />
                </Button>
              </span>
              <span v-if="c.status === 'draft'" class="mt-1 block">
                <Button variant="outline" size="xs" @click="pickFile(c.id)">
                  <PlusIcon />
                  첨부
                </Button>
              </span>
            </TableCell>
            <TableCell class="text-right">
              <span v-if="c.status === 'draft'" class="inline-flex gap-1">
                <Button variant="outline" size="sm" @click="openEdit(c)">수정</Button>
                <Button size="sm" @click="void doSubmit(c)">접수 요청</Button>
                <Button variant="destructive" size="sm" @click="void doDelete(c)">삭제</Button>
              </span>
              <span v-else-if="c.status === 'submitted'" class="inline-flex gap-1">
                <Button variant="outline" size="sm" @click="void doRecall(c)">회수</Button>
                <Button variant="outline" size="sm" @click="void doReply(c, true)">대행 수락</Button>
                <Button variant="outline" size="sm" @click="void doReply(c, false)">대행 거절</Button>
              </span>
              <Button v-else-if="c.status === 'accepted'" size="sm" @click="void doProceed(c)">재발주 진행</Button>
              <span v-else class="text-muted-foreground">—</span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <input ref="fileInput" type="file" class="hidden" @change="onFile">

    <!-- 접수 대화상자(생성/수정) -->
    <Dialog v-model:open="modalOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ editId === null ? 'A/S 접수' : 'A/S 접수 수정' }}</DialogTitle>
          <DialogDescription>
            저장하면 '작성'(초안)으로 보관됩니다 — 협력사에는 [접수 요청] 후에 보입니다.
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div role="radiogroup" aria-label="재생산 협력사">
            <p class="text-muted-foreground text-xs font-medium">재생산 협력사</p>
            <p v-if="candidates.length === 0" class="text-warning mt-1 text-sm">
              발주된 협력사가 없습니다 — 원주문 발주서가 있어야 A/S 대상이 됩니다.
            </p>
            <label
              v-for="cand in candidates"
              :key="cand.partnerId"
              class="mt-1 flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="as-case-partner"
                class="accent-primary size-4"
                :checked="form.targetPartnerId === cand.partnerId"
                @change="form.targetPartnerId = cand.partnerId"
              >
              <span class="font-medium">{{ cand.partnerName }}</span>
              <span class="text-muted-foreground text-xs">{{ trackLabel(cand.parentPartnerId, cand.parentPartnerName) }}</span>
            </label>
          </div>
          <div role="radiogroup" aria-label="유형">
            <p class="text-muted-foreground text-xs font-medium">유형</p>
            <span class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <label v-for="t in PCB_AS_CASE_TYPES" :key="t" class="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="as-case-type"
                  class="accent-primary size-4"
                  :checked="form.caseType === t"
                  @change="pickType(t)"
                >
                {{ PCB_AS_CASE_TYPE_LABELS[t] }}
              </label>
            </span>
          </div>
          <div role="radiogroup" aria-label="비용 조건">
            <p class="text-muted-foreground text-xs font-medium">
              비용 조건 <span class="font-normal">(유형 선택 시 기본값 자동 — 변경 가능)</span>
            </p>
            <span class="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <label v-for="ch in PCB_AS_CHARGE_TYPES" :key="ch" class="inline-flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="as-case-charge"
                  class="accent-primary size-4"
                  :checked="form.chargeType === ch"
                  @change="form.chargeType = ch"
                >
                {{ PCB_AS_CHARGE_LABELS[ch] }}
              </label>
            </span>
          </div>
          <Field>
            <FieldLabel for="as-case-desc">설명</FieldLabel>
            <Textarea
              id="as-case-desc"
              :model-value="form.description"
              rows="3"
              placeholder="불량 내용 / 잘못 전달한 정보 등"
              @update:model-value="setDescription"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="modalOpen = false">취소</Button>
          <Button :disabled="!canSave" @click="void save()">저장</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>
</template>
