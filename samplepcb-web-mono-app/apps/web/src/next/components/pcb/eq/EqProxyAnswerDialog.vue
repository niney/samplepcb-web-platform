<script setup lang="ts">
// EQ 문항형 회차(D20) 대리 회신 — 고객이 전화·메일로 말한 답을 관리자가 대신 넣는다(D43-8 관례).
// 고객 회신과 같은 검증(전 문항·그 문항의 기호·'의견 필수' 선택지는 의견 2자 이상)에 더해 **경로(웹 제외)와
// 근거 메모**가 필수다 — 고객 화면엔 "담당자가 확인한 답변"으로 보이고, 나중에 다툼이 생기면 메모가 근거다.
// 부분 제출은 없다(공장은 한 문항이라도 비면 진행하지 못한다). 고객 메일은 나가지 않는다.
import { computed, ref, watch } from 'vue';
import {
  PCB_EQ_ANSWER_CHANNEL_LABELS,
  PCB_EQ_ITEM_CATEGORY_LABELS,
  type AdminPcbEqProxyAnswerBodyType,
  type AdminPcbEqReviewViewType,
} from '@sp/api-contract';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Textarea } from '@/next/components/ui/textarea';

type ProxyChannel = AdminPcbEqProxyAnswerBodyType['channel'];
const CHANNELS: readonly ProxyChannel[] = ['phone', 'email', 'other'];
/** 서버 EQ_REQUIRED_COMMENT_MIN·계약 note.min(2) 의 화면 미러. */
const MIN_TEXT = 2;

const props = defineProps<{
  /** null = 닫힘. */
  review: AdminPcbEqReviewViewType | null;
  busy: boolean;
  /** 서버가 돌려보낸 문구(검증·충돌) — 대화상자 안에 그대로. */
  error: string;
}>();

const emit = defineEmits<{
  close: [];
  submit: [body: Omit<AdminPcbEqProxyAnswerBodyType, 'expectedVersion'>];
}>();

const picks = ref<Record<number, string>>({});
const comments = ref<Record<number, string>>({});
const channel = ref<ProxyChannel>('phone');
const note = ref('');

// 열릴 때마다 비운다 — 지난 대리 회신의 메모가 남아 있으면 엉뚱한 근거가 박제된다.
watch(
  () => props.review?.id ?? null,
  (id) => {
    if (id === null) return;
    picks.value = {};
    comments.value = {};
    channel.value = 'phone';
    note.value = '';
  },
  { immediate: true },
);

const items = computed(() => props.review?.items ?? []);
const optionOf = (itemId: number) => {
  const item = items.value.find((i) => i.id === itemId);
  return item?.options.find((o) => o.key === picks.value[itemId]) ?? null;
};
const needsComment = (itemId: number): boolean => optionOf(itemId)?.requiresComment === true;
const commentShort = (itemId: number): boolean =>
  needsComment(itemId) && (comments.value[itemId] ?? '').trim().length < MIN_TEXT;

/** 막는 이유(보낼 수 있으면 빈 배열) — 바닥에 그대로 읽힌다. */
const problems = computed((): string[] => {
  const out: string[] = [];
  const unanswered = items.value.flatMap((item, i) => (picks.value[item.id] === undefined ? [String(i + 1)] : []));
  if (unanswered.length > 0) out.push(`답을 고르지 않은 항목 ${unanswered.join('·')}`);
  const short = items.value.flatMap((item, i) => (commentShort(item.id) ? [String(i + 1)] : []));
  if (short.length > 0) out.push(`의견 ${String(MIN_TEXT)}자 이상이 필요한 항목 ${short.join('·')}`);
  if (note.value.trim().length < MIN_TEXT) out.push(`근거 메모 ${String(MIN_TEXT)}자 이상`);
  return out;
});

function pick(itemId: number, value: unknown): void {
  if (typeof value === 'string') picks.value = { ...picks.value, [itemId]: value };
}
function setComment(itemId: number, value: string | number): void {
  comments.value = { ...comments.value, [itemId]: String(value) };
}
const onChannel = (value: unknown): void => {
  const hit = CHANNELS.find((c) => c === value);
  if (hit !== undefined) channel.value = hit;
};
const setNote = (value: string | number): void => {
  note.value = String(value);
};

function submit(): void {
  if (problems.value.length > 0 || props.busy) return;
  emit('submit', {
    answers: items.value.map((item) => {
      const comment = (comments.value[item.id] ?? '').trim();
      return { itemId: item.id, key: picks.value[item.id] ?? '', ...(comment === '' ? {} : { comment }) };
    }),
    channel: channel.value,
    note: note.value.trim(),
  });
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="review !== null" @update:open="onOpenChange">
    <DialogContent v-if="review !== null" class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>대리 회신 — {{ review.roundNo === null ? '' : `${String(review.roundNo)}차 ` }}제조 확인</DialogTitle>
        <DialogDescription>
          고객이 전화·메일로 알려 준 답을 대신 넣습니다. 고객 화면에는 '담당자가 확인한 답변'으로 보이고 고객 메일은 나가지 않습니다.
        </DialogDescription>
      </DialogHeader>

      <DialogScrollBody class="grid gap-3">
        <Panel v-for="(item, index) in items" :key="item.id" size="sm" class="grid gap-2" :data-eq-proxy-item="index + 1">
          <p class="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge>항목 {{ index + 1 }}</Badge>
            <b>{{ PCB_EQ_ITEM_CATEGORY_LABELS[item.category] }}</b>
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ item.question }}</p>
          <RadioGroup :model-value="picks[item.id] ?? ''" :aria-label="`항목 ${String(index + 1)} 답`" @update:model-value="pick(item.id, $event)">
            <FieldLabel v-for="option in item.options" :key="option.key" :for="`eq-proxy-${String(item.id)}-${option.key}`">
              <Field orientation="horizontal">
                <RadioGroupItem :id="`eq-proxy-${String(item.id)}-${option.key}`" :value="option.key" />
                <span class="flex flex-wrap items-center gap-1 text-xs font-normal">
                  <Badge variant="outline">{{ option.key }}</Badge>
                  <span class="text-foreground font-medium">{{ option.label }}</span>
                  <Badge v-if="option.recommended" variant="info">제조사 권장</Badge>
                  <Badge v-if="option.requiresComment" variant="warning">의견 필수</Badge>
                </span>
              </Field>
            </FieldLabel>
          </RadioGroup>
          <Field :data-invalid="commentShort(item.id) ? 'true' : undefined">
            <FieldLabel :for="`eq-proxy-cmt-${String(item.id)}`">
              의견{{ needsComment(item.id) ? '(필수)' : '(선택)' }}
            </FieldLabel>
            <Textarea
              :id="`eq-proxy-cmt-${String(item.id)}`"
              :model-value="comments[item.id] ?? ''"
              rows="2"
              maxlength="2000"
              :aria-invalid="commentShort(item.id) ? 'true' : undefined"
              :placeholder="needsComment(item.id) ? '고객이 지시한 내용을 그대로 적으세요(공장에 전달됩니다).' : '고객이 덧붙인 말이 있으면'"
              @update:model-value="setComment(item.id, $event)"
            />
            <p v-if="commentShort(item.id)" class="text-destructive text-xs">이 선택지는 의견을 {{ MIN_TEXT }}자 이상 적어야 합니다.</p>
          </Field>
        </Panel>

        <Panel tone="muted" size="sm" class="grid gap-3">
          <Field>
            <FieldLabel>들은 경로</FieldLabel>
            <RadioGroup :model-value="channel" class="flex flex-wrap" aria-label="들은 경로" @update:model-value="onChannel">
              <span v-for="c in CHANNELS" :key="c" class="inline-flex items-center gap-1.5 text-sm">
                <RadioGroupItem :id="`eq-proxy-ch-${c}`" :value="c" />
                <label :for="`eq-proxy-ch-${c}`">{{ PCB_EQ_ANSWER_CHANNEL_LABELS[c] }}</label>
              </span>
            </RadioGroup>
          </Field>
          <Field :data-invalid="note.trim().length < MIN_TEXT && note !== '' ? 'true' : undefined">
            <FieldLabel for="eq-proxy-note">근거 메모 <span class="text-destructive">*</span></FieldLabel>
            <Textarea
              id="eq-proxy-note"
              :model-value="note"
              rows="2"
              maxlength="2000"
              placeholder="예) 10/11 14:20 고객 김OO 님 전화 — 1번 A, 2번 C(의견대로)로 진행 요청"
              @update:model-value="setNote"
            />
          </Field>
        </Panel>
      </DialogScrollBody>

      <p v-if="error !== ''" class="text-destructive text-sm font-medium" role="alert">{{ error }}</p>
      <p v-else-if="problems.length > 0" class="text-muted-foreground text-xs" data-eq-proxy-problems>남은 것: {{ problems.join(' · ') }}</p>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">닫기</Button>
        <Button :disabled="problems.length > 0 || busy" @click="submit">{{ busy ? '저장 중…' : '대리 회신 저장' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
