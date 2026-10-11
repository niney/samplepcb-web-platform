<script setup lang="ts">
// EQ 작업공간 1열 — 문항 목록. 번호·유형·변화·답 상태를 한 줄에, 편집 중이면 추가·삭제·순서 이동.
// 순서가 곧 저장 순서(seq)다 — 공장 원문 번호(factoryNo)는 따로 있어 순서를 바꿔도 협력사 번호는 안 바뀐다.
import { ArrowDownIcon, ArrowUpIcon, ImageIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import {
  PCB_EQ_AI_FLAG_CODES,
  PCB_EQ_AI_FLAG_LABELS,
  PCB_EQ_ITEM_CATEGORY_LABELS,
  PCB_EQ_ITEM_CHANGE_LABELS,
  type PcbEqAiFlagCodeType,
} from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/next/components/ui/item';
import { EQ_CHANGE_VARIANT, EQ_ITEM_MAX, eqItemNoOf, type EqItemDraft } from './eq-round';

defineProps<{
  items: EqItemDraft[];
  selectedIndex: number;
  editable: boolean;
  /** 답 상태 칸을 보일까(발송 뒤 회차). */
  showAnswers: boolean;
  /** 저장·발송을 막고 있는 문항(검증) — 붉은 점. */
  problemIndex: number | null;
}>();

/** 문항에 남은 AI 검토 표시(D20 P2)의 종류 — 같은 종류가 여럿이어도 배지는 하나(사전 순서). */
const flagCodes = (item: EqItemDraft): PcbEqAiFlagCodeType[] =>
  PCB_EQ_AI_FLAG_CODES.filter((code) => item.aiFlags.some((f) => f.code === code));
const flagTitle = (item: EqItemDraft, code: PcbEqAiFlagCodeType): string =>
  item.aiFlags
    .filter((f) => f.code === code)
    .map((f) => f.detail)
    .join('\n');

const emit = defineEmits<{
  select: [index: number];
  add: [];
  remove: [index: number];
  move: [index: number, delta: -1 | 1];
}>();
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="flex shrink-0 items-center justify-between gap-2 border-b p-3">
      <p class="text-xs font-semibold">
        문항
        <span class="text-muted-foreground ml-1 font-normal">{{ items.length }}개</span>
        <span v-if="showAnswers" class="text-muted-foreground font-normal">
          · 답 {{ items.filter((item) => item.answer !== null).length }}/{{ items.length }}
        </span>
      </p>
      <Button v-if="editable" variant="outline" size="xs" :disabled="items.length >= EQ_ITEM_MAX" @click="emit('add')">
        <PlusIcon />
        문항 추가
      </Button>
    </div>
    <ul class="min-h-0 flex-1 overflow-y-auto p-2">
      <li v-for="(item, index) in items" :key="item.uid" :data-eq-item="index + 1" class="flex items-start gap-1 pb-1">
        <Item
          as="button"
          type="button"
          :variant="index === selectedIndex ? 'outline-info' : 'default'"
          size="xs"
          class="min-w-0 flex-1 text-left"
          :aria-current="index === selectedIndex ? 'true' : 'false'"
          @click="emit('select', index)"
        >
          <ItemContent class="min-w-0">
            <ItemTitle class="flex-wrap">
              <Badge variant="outline" class="tabular-nums">{{ eqItemNoOf(item, index) }}</Badge>
              <span>{{ PCB_EQ_ITEM_CATEGORY_LABELS[item.category] }}</span>
              <Badge v-if="item.change !== null" :variant="EQ_CHANGE_VARIANT[item.change]">
                {{ PCB_EQ_ITEM_CHANGE_LABELS[item.change] }}
              </Badge>
              <span
                v-if="item.figures.length > 0"
                class="text-muted-foreground inline-flex items-center gap-0.5 font-normal"
                :title="`그림 ${String(item.figures.length)}장 · 고객 공개 ${String(item.figures.filter((f) => f.shared).length)}장`"
              >
                <ImageIcon class="size-3" />{{ item.figures.length }}
              </span>
              <span v-if="problemIndex === index" class="bg-destructive size-2 rounded-full" title="저장·발송 전에 고칠 곳이 있습니다" />
            </ItemTitle>
            <ItemDescription>{{ item.question.trim() === '' ? '(질문 미입력)' : item.question }}</ItemDescription>
            <!-- AI 초안의 검토 표시 — 관리자가 [확인함]으로 지우기 전까지 남는다(고객에게는 안 보인다). -->
            <span v-if="item.aiFlags.length > 0" class="flex flex-wrap items-center gap-1 text-xs" data-eq-item-flags>
              <Badge v-for="code in flagCodes(item)" :key="code" variant="warning" :title="flagTitle(item, code)">
                {{ PCB_EQ_AI_FLAG_LABELS[code] }}
              </Badge>
            </span>
            <span v-if="showAnswers" class="flex flex-wrap items-center gap-1 text-xs">
              <Badge v-if="item.answer !== null" variant="success">답 {{ item.answer.key }}</Badge>
              <Badge v-else variant="outline">답 없음</Badge>
              <span v-if="item.answer !== null && item.answer.comment !== null" class="text-muted-foreground">의견 있음</span>
            </span>
          </ItemContent>
        </Item>
        <span v-if="editable" class="flex shrink-0 flex-col">
          <Button variant="ghost" size="icon-xs" :disabled="index === 0" aria-label="위로" title="위로" @click="emit('move', index, -1)">
            <ArrowUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            :disabled="index === items.length - 1"
            aria-label="아래로"
            title="아래로"
            @click="emit('move', index, 1)"
          >
            <ArrowDownIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="문항 삭제" title="문항 삭제" @click="emit('remove', index)">
            <Trash2Icon class="text-destructive" />
          </Button>
        </span>
      </li>
      <li v-if="items.length === 0" class="text-muted-foreground px-3 py-6 text-center text-xs">
        {{ editable ? '[문항 추가]로 공장 EQ 표의 문항을 하나씩 옮기세요.' : '문항이 없습니다.' }}
      </li>
    </ul>
  </div>
</template>
