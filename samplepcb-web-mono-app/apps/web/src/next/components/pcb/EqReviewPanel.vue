<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  PCB_EQ_REVIEW_STATUS_LABELS,
  type AdminPcbPoViewType,
  type PcbEqReviewStatusType,
} from '@sp/api-contract';
import { fmtKstDate, kstToday } from '@sp/utils';
import {
  useAdminPcbEqReviews,
  useCancelPcbEqReview,
  useCreatePcbEqReview,
} from '@/admin/useAdminPcbPos';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Textarea } from '@/next/components/ui/textarea';
import type { BadgeVariant } from './pcb-badges';

// EQ 고객 확인 패널(P4.1) — 협력사 EQ 를 고객에게 물어본다. 옛 PcbEqReviewPanel 과 같은 API.
// ⚠ 이 패널은 EQ 전이를 바꾸지 않는다. 고객이 승인해도 상태는 eq_requested 그대로이고
//   [EQ 승인]은 관리자가 따로 누른다(고객 확인 = 관리자 승인의 근거).
// ⚠ 공개 파일은 **골라서** 보낸다 — 협력사 첨부에 협력사명·로고가 있으면 공급망이 드러난다.
const props = defineProps<{ po: AdminPcbPoViewType }>();
const emit = defineEmits<{ close: [] }>();

const poId = computed(() => props.po.poId);
const list = useAdminPcbEqReviews(poId);
const reviews = computed(() => list.data.value?.data.reviews ?? []);
const openReview = computed(() => reviews.value.find((r) => r.status === 'requested') ?? null);
const history = computed(() => reviews.value.filter((r) => r.status !== 'requested'));

const createMut = useCreatePcbEqReview();
const cancelMut = useCancelPcbEqReview();

const message = ref('');
const dueOn = ref('');
const picked = ref<number[]>([]);
const error = ref('');

const togglePick = (fileId: number): void => {
  picked.value = picked.value.includes(fileId)
    ? picked.value.filter((id) => id !== fileId)
    : [...picked.value, fileId];
};

const canSend = computed(() => message.value.trim().length >= 2 && !createMut.isPending.value);

async function send(): Promise<void> {
  if (!canSend.value) return;
  error.value = '';
  try {
    await createMut.mutateAsync({
      poId: props.po.poId,
      body: {
        message: message.value.trim(),
        ...(dueOn.value === '' ? {} : { dueOn: dueOn.value }),
        sharedFileIds: [...picked.value],
      },
    });
    message.value = '';
    dueOn.value = '';
    picked.value = [];
  } catch (e) {
    error.value = e instanceof Error && e.message !== '' ? e.message : '요청 발송에 실패했습니다.';
  }
}

async function cancel(reviewId: number): Promise<void> {
  error.value = '';
  try {
    await cancelMut.mutateAsync({ poId: props.po.poId, reviewId });
  } catch (e) {
    error.value = e instanceof Error && e.message !== '' ? e.message : '취소에 실패했습니다.';
  }
}

// 고객 확인은 '기다림'이 아니라 '진행'(우리가 보낸 물음) — 승인=끝남, 반려=문제, 취소=이력.
const STATUS_VARIANT: Record<PcbEqReviewStatusType, BadgeVariant> = {
  requested: 'info',
  approved: 'success',
  rejected: 'danger',
  canceled: 'secondary',
};
// 트랙별 어휘 — 스텐실 발주에서도 이 축(고객 확인)은 그대로 쓰이지만 EQ 라는 말이 없다.
const stencil = computed(() => props.po.track === 'stencil');

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
const setMessage = (value: string | number): void => {
  message.value = String(value);
};
const setDueOn = (value: string | number): void => {
  dueOn.value = String(value);
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <p class="text-info text-xs font-semibold">{{ stencil ? '고객 확인' : 'EQ 고객 확인' }}</p>
        <DialogTitle>{{ po.partnerName }} 발주 건</DialogTitle>
        <DialogDescription>
          고객이 승인해도 발주 상태는 그대로입니다 — 확인 결과를 보고
          <b class="text-foreground">[{{ stencil ? '확인 완료' : 'EQ 승인' }}]</b>은 직접 누르세요.
        </DialogDescription>
      </DialogHeader>

      <div class="-mx-6 max-h-[65vh] space-y-4 overflow-y-auto px-6">
        <!-- 열린 요청 -->
        <div v-if="openReview !== null" class="border-info/30 bg-info-soft/40 rounded-lg border p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <Badge :variant="STATUS_VARIANT.requested">{{ PCB_EQ_REVIEW_STATUS_LABELS.requested }}</Badge>
            <Badge v-if="openReview.overdue" variant="danger">기한 초과 — 재촉 필요</Badge>
          </div>
          <p class="mt-2 text-sm whitespace-pre-wrap">{{ openReview.message }}</p>
          <p class="text-muted-foreground mt-1 text-xs">
            {{ fmtKstDate(openReview.requestedAt) }} 발송 · {{ openReview.requestedBy }}
            <template v-if="openReview.dueOn !== null"> · 기한 {{ fmtKstDate(openReview.dueOn) }}</template>
            <template v-if="openReview.files.length > 0"> · 공개 {{ openReview.files.length }}개</template>
          </p>
          <div class="mt-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              :disabled="cancelMut.isPending.value"
              @click="void cancel(openReview.id)"
            >
              요청 취소
            </Button>
          </div>
        </div>

        <!-- 새 요청 — EQ 승인요청 단계에서만(서버 가드 NOT_EQ_REQUESTED 의 화면 미러).
             그 외 단계에서 열리는 건 행의 상태 배지를 눌러 이력을 보는 경우다(P4.4). -->
        <p
          v-else-if="po.status !== 'eq_requested'"
          class="bg-muted/40 text-muted-foreground rounded-lg border p-3 text-xs"
        >
          새 확인 요청은 발주서가 <b class="text-foreground">{{ stencil ? '확인 요청' : 'EQ 승인요청' }}</b> 단계일 때만 보낼 수 있습니다.
        </p>
        <div v-else class="border-info/30 space-y-3 rounded-lg border p-3">
          <p class="text-info text-sm font-semibold">고객에게 확인 요청</p>
          <Field>
            <FieldLabel for="eq-review-message">
              확인 문구
              <span class="text-muted-foreground font-normal">— 협력사 원문을 그대로 옮기지 마세요</span>
            </FieldLabel>
            <Textarea
              id="eq-review-message"
              :model-value="message"
              rows="4"
              maxlength="2000"
              placeholder="예) 홀 지름 0.3mm 가 드릴 규격상 제작이 어렵습니다. 0.35mm 로 변경해도 될까요?"
              @update:model-value="setMessage"
            />
          </Field>

          <Field>
            <FieldLabel for="eq-review-due">회신 기한 (선택)</FieldLabel>
            <div class="flex gap-1">
              <Input id="eq-review-due" :model-value="dueOn" type="date" @update:model-value="setDueOn" />
              <Button variant="outline" @click="dueOn = kstToday()">오늘</Button>
              <Button v-if="dueOn !== ''" variant="ghost" @click="dueOn = ''">지움</Button>
            </div>
          </Field>

          <!-- 공개 파일 선택 — 기본은 아무것도 안 보낸다 -->
          <div v-if="po.eqFiles.length > 0">
            <p class="text-muted-foreground text-xs font-medium">
              고객에게 공개할 첨부
              <span class="text-warning font-normal">— 협력사명이 든 파일은 빼세요</span>
            </p>
            <!-- 목록은 최신이 먼저 온다(서버 정렬). 이전 회차를 고객에게 보내면 고객이 옛
                 도면을 보고 승인하므로 눈에 띄게 표시한다(여정 22호). -->
            <div class="mt-1 space-y-1">
              <label
                v-for="f in po.eqFiles"
                :key="f.fileId"
                class="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                :class="picked.includes(f.fileId)
                  ? 'border-primary/40 bg-info-soft/50'
                  : f.isLatest ? '' : 'border-warning/50 border-dashed'"
              >
                <Checkbox
                  :model-value="picked.includes(f.fileId)"
                  @update:model-value="togglePick(f.fileId)"
                />
                <span class="text-muted-foreground font-semibold uppercase">{{ f.fileType }}</span>
                <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                <Badge v-if="!f.isLatest" variant="warning" title="같은 종류로 더 최근 파일이 올라와 있습니다.">
                  이전
                </Badge>
              </label>
            </div>
          </div>
          <p v-else class="text-muted-foreground text-xs">협력사가 올린 첨부가 없습니다.</p>

          <div class="flex justify-end">
            <Button :disabled="!canSend" @click="void send()">확인 요청 보내기</Button>
          </div>
        </div>

        <!-- 지난 이력 -->
        <div v-if="history.length > 0">
          <p class="text-muted-foreground text-xs font-semibold">지난 요청 ({{ history.length }})</p>
          <div class="mt-2 space-y-2">
            <div v-for="r in history" :key="r.id" class="rounded-lg border p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <Badge :variant="STATUS_VARIANT[r.status]">{{ PCB_EQ_REVIEW_STATUS_LABELS[r.status] }}</Badge>
                <span class="text-muted-foreground text-xs">
                  {{ r.decidedAt === null ? fmtKstDate(r.requestedAt) : fmtKstDate(r.decidedAt) }}
                  <template v-if="r.decidedBy !== null"> · {{ r.decidedBy }}</template>
                </span>
              </div>
              <p class="text-muted-foreground mt-1.5 text-xs whitespace-pre-wrap">{{ r.message }}</p>
              <p
                v-if="r.decisionNote !== null && r.decisionNote !== ''"
                class="bg-muted/40 mt-1.5 rounded px-2 py-1.5 text-xs"
                :class="r.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground'"
              >
                고객 의견: {{ r.decisionNote }}
              </p>
            </div>
          </div>
        </div>

        <p v-if="error !== ''" class="text-destructive text-sm font-medium">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">닫기</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
