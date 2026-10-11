<script setup lang="ts">
// EQ 문항형 회차(D20)의 **고객에게 보일 모습** — 고객 주문 상세(sp-php `#eq-{id}` 제조 확인 섹션)의
// 문항 카드를 같은 어휘로 흉내 낸다. 원문(질문·선택지)·비공개 그림·공장 번호는 **그리지 않는다** —
// 고객 응답에 없는 것이라 여기 보이면 관리자가 "고객도 보겠지"로 오해한다(D20-5 공급망 미노출).
// 고객 화면 어휘는 '제조 확인'이다(EQ 라는 말을 안 쓴다, P4.1-b). 값은 작성 중 초안 그대로다.
// ⚠ 질문을 heading 으로 두지 않는다 — 편집 칸의 "문항 N" 제목을 찾는 e2e 선택자와 겹치지 않게.
import { computed } from 'vue';
import { PCB_EQ_ITEM_CATEGORY_LABELS, PCB_EQ_ITEM_CHANGE_LABELS, type PcbEqReviewStatusType } from '@sp/api-contract';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import { fmtKstDate } from '@sp/utils';
import Panel from '@/next/components/common/Panel.vue';
import { Alert } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Checkbox } from '@/next/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Textarea } from '@/next/components/ui/textarea';
import EqFigureThumb from './EqFigureThumb.vue';
import { EQ_CHANGE_VARIANT, EQ_DEFAULT_MESSAGE_PREVIEW, type EqItemDraft } from './eq-round';
import type { EqFigureUrls } from './useAdminPcbEqRounds';

const props = defineProps<{
  items: EqItemDraft[];
  message: string;
  /** 'YYYY-MM-DD' 또는 '' */
  dueOn: string;
  roundNo: number | null;
  poId: number;
  reviewId: number;
  urls: EqFigureUrls;
  /** 회차 상태 — 보낸 뒤 회차는 고객이 지금 보는 모습(회신 완료·요청 취소)으로. */
  status: PcbEqReviewStatusType;
  /** 관리자가 대신 답했다 — 고객 화면은 "담당자가 확인한 답변"으로 안내한다. */
  answeredByAdmin: boolean;
}>();

const emit = defineEmits<{ zoom: [url: string, name: string] }>();

const headline = computed(() => (props.message.trim() === '' ? EQ_DEFAULT_MESSAGE_PREVIEW : props.message.trim()));
const stateBadge = computed((): { label: string; variant: BadgeVariant } =>
  props.status === 'answered'
    ? { label: '회신 완료', variant: 'success' }
    : props.status === 'canceled'
      ? { label: '요청 취소', variant: 'secondary' }
      : { label: '확인 대기', variant: 'danger' },
);
const sharedFigures = (item: EqItemDraft) => item.figures.filter((f) => f.shared);
/** 개정 회차의 '동일' 문항은 고객 화면이 이전 답을 미리 채우고 접는다. */
const prefilled = (item: EqItemDraft): string | null =>
  item.change === 'same' && item.prev !== null && item.prev.answer !== null ? item.prev.answer.key : null;
const answered = computed(() => props.items.filter((item) => item.answer !== null || prefilled(item) !== null).length);
</script>

<template>
  <div class="grid gap-3">
    <div>
      <p class="text-xs font-semibold">고객에게 보일 모습</p>
      <p class="text-muted-foreground mt-0.5 text-xs">주문 상세 › 제조 확인 — 원문·비공개 그림·공장 번호는 고객에게 가지 않습니다.</p>
    </div>
    <Panel v-if="items.length === 0" size="md" class="text-muted-foreground border-dashed text-center text-xs">
      문항을 만들면 여기서 고객 화면을 미리 봅니다.
    </Panel>
    <template v-else>
      <Alert variant="info" size="sm">
        <div class="col-span-2 text-xs">
          <p class="flex flex-wrap items-center gap-1.5">
            <Badge :variant="stateBadge.variant">{{ stateBadge.label }}</Badge>
            <span class="font-semibold">제조 확인{{ roundNo !== null && roundNo >= 2 ? ` ${String(roundNo)}차` : '' }}</span>
            <span v-if="dueOn !== ''" class="text-muted-foreground">회신 기한 {{ fmtKstDate(`${dueOn}T00:00:00+09:00`) }}</span>
          </p>
          <Panel size="xs" class="bg-background text-foreground mt-1.5 whitespace-pre-line">{{ headline }}</Panel>
          <p class="text-muted-foreground mt-1.5">답한 항목 {{ answered }}/{{ items.length }}</p>
        </div>
      </Alert>

      <Card v-for="(item, index) in items" :key="item.uid" class="gap-0 overflow-hidden py-0">
        <p class="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 text-xs">
          <Badge>항목 {{ index + 1 }}</Badge>
          <b>{{ PCB_EQ_ITEM_CATEGORY_LABELS[item.category] }}</b>
          <Badge v-if="item.change !== null" :variant="EQ_CHANGE_VARIANT[item.change]">{{ PCB_EQ_ITEM_CHANGE_LABELS[item.change] }}</Badge>
        </p>
        <div class="grid gap-2 px-3 py-2 text-xs">
          <p v-if="item.answer === null && prefilled(item) !== null" class="text-muted-foreground">
            지난번과 같은 질문입니다 — 이전 답(<b class="text-foreground">{{ item.prev?.answerLabel ?? item.prev?.answer?.key }}</b>)으로 채워 두었습니다.
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ item.question.trim() === '' ? '(질문 미입력)' : item.question }}</p>
          <div v-if="sharedFigures(item).length > 0" class="flex flex-wrap gap-1.5">
            <EqFigureThumb
              v-for="f in sharedFigures(item)"
              :key="f.fileId"
              :urls="urls"
              :po-id="poId"
              :review-id="reviewId"
              :file-id="f.fileId"
              :name="f.name"
              size="sm"
              @zoom="(u, n) => emit('zoom', u, n)"
            />
          </div>
          <RadioGroup :model-value="item.answer?.key ?? prefilled(item) ?? ''" disabled :aria-label="`항목 ${String(index + 1)} 선택지(미리보기)`">
            <Panel v-for="option in item.options" :key="option.uid" size="xs" class="flex items-start gap-2">
              <RadioGroupItem :id="`eq-pv-${item.uid}-${option.uid}`" :value="option.key" class="mt-0.5" />
              <label :for="`eq-pv-${item.uid}-${option.uid}`" class="grid gap-0.5">
                <span class="flex flex-wrap items-center gap-1">
                  <span class="font-medium">{{ option.label.trim() === '' ? '(문구 미입력)' : option.label }}</span>
                  <Badge v-if="option.recommended" variant="info">제조사 권장</Badge>
                </span>
                <span v-if="option.requiresComment" class="text-muted-foreground">고르면 의견을 적어야 합니다</span>
              </label>
            </Panel>
          </RadioGroup>
          <Textarea :model-value="item.answer?.comment ?? ''" rows="2" disabled placeholder="의견(선택)" aria-label="의견(미리보기)" />
        </div>
      </Card>

      <Panel v-if="status === 'answered'" size="sm" class="text-muted-foreground text-xs">
        회신을 제출했습니다.{{ answeredByAdmin ? ' 담당자가 확인한 답변입니다.' : '' }}
      </Panel>
      <Panel v-else-if="status !== 'canceled'" size="sm" class="grid gap-2 text-xs">
        <span class="inline-flex items-center gap-1.5">
          <Checkbox id="eq-pv-agree" disabled />
          <label for="eq-pv-agree">위 답변대로 제작을 진행하는 데 동의합니다.</label>
        </span>
        <Button size="sm" disabled class="w-fit">회신 제출</Button>
      </Panel>
    </template>
  </div>
</template>
