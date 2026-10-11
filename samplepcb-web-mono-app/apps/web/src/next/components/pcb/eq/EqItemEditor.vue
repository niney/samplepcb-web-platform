<script setup lang="ts">
// EQ 작업공간 2열 — 문항 하나의 편집(초안) 또는 읽기(발송 뒤). 한국어 질문 ↔ 공장 원문을 나란히 두고
// 선택지(기호·한국어·원문·제조사 권장·의견 필수)·그림(드롭 업로드·고객 공개)·직전 회차 연결을 다룬다.
// 편집 모형은 부모(작업공간)가 들고 있어 여기선 바꿀 값을 patch 로 올린다(같은 Case 화면 안에서 닫았다
// 열어도 초안이 남는 이유 — 상태는 한 곳).
// ⚠ 원문(questionOrig·labelOrig)은 고객에게 절대 안 간다(D20-5) — 화면이 그 사실을 칸 이름으로 말한다.
import { computed, ref } from 'vue';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ImagePlusIcon,
  Link2Icon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import {
  PCB_EQ_AI_FLAG_LABELS,
  PCB_EQ_ITEM_CATEGORIES,
  PCB_EQ_ITEM_CATEGORY_LABELS,
  PCB_EQ_ITEM_CHANGE_LABELS,
  type AdminPcbEqCommentTranslationBodyType,
  type AdminPcbEqReviewViewType,
  type PcbEqItemChangeType,
} from '@sp/api-contract';
import { formatBytes } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import EqCommentTranslation from './EqCommentTranslation.vue';
import EqFigureThumb from './EqFigureThumb.vue';
import EqLooseFigures from './EqLooseFigures.vue';
import {
  EQ_CHANGE_VARIANT,
  EQ_FIGURE_MAX,
  EQ_OPTION_MAX,
  eqItemNoOf,
  newOption,
  type EqFigureDraft,
  type EqItemDraft,
  type EqOptionDraft,
} from './eq-round';
import type { EqFigureUrls } from './useAdminPcbEqRounds';

type ItemPatch = Partial<Omit<EqItemDraft, 'uid' | 'id' | 'answer'>>;

const props = defineProps<{
  item: EqItemDraft;
  index: number;
  editable: boolean;
  poId: number;
  reviewId: number;
  urls: EqFigureUrls;
  /** 직전 회차(개정 연결 대상) — 없으면 첫 회차라 변화·연결 칸이 없다. */
  prevRound: AdminPcbEqReviewViewType | null;
  uploading: boolean;
  /** 이 회차에 올렸지만 어느 문항에도 안 붙은 그림(부모가 서버 목록 − 편집 버퍼로 계산). */
  looseFigures: EqFigureDraft[];
  /** 'PCB EQ 분석'이 켜져 있는가 — 고객 의견 AI 번역 버튼의 유무(D20 P4). */
  aiEnabled: boolean;
  /** 번역 저장·AI 번역이 도는 중. */
  translationBusy: boolean;
}>();

const emit = defineEmits<{
  patch: [patch: ItemPatch];
  upload: [files: File[]];
  removeFigure: [fileId: number];
  /** 붙지 않은 그림을 이 문항에 붙인다(부모가 버퍼에 넣는다 — 그림 정보는 부모가 안다). */
  attachFigure: [fileId: number];
  zoom: [url: string, name: string];
  /** 고객 의견 번역문 수정(D20 P4). */
  saveTranslation: [body: AdminPcbEqCommentTranslationBodyType];
  /** 이 회차의 고객 의견을 AI 로 번역 — force 면 이미 있는 번역도 다시. */
  translate: [force: boolean];
}>();

const patch = (value: ItemPatch): void => {
  emit('patch', value);
};
const text = (value: string | number): string => String(value);
// shadcn Checkbox 는 boolean | 'indeterminate' 를 낸다 — 이 편집기는 켜짐/꺼짐만 쓴다.
const isChecked = (value: boolean | 'indeterminate'): boolean => value === true;

const no = computed(() => eqItemNoOf(props.item, props.index));

// ── AI 검토 표시(D20 P2) ───────────────────────────────────────────────────────────
// [확인함] = 이 표시를 버퍼에서 뺀다. 저장은 **남은 표시를 실어** 보내므로(eq-round bodyOf) 뺀 것만 지워진다.
function confirmFlag(index: number): void {
  patch({ aiFlags: props.item.aiFlags.filter((_, i) => i !== index) });
}

// ── 선택지 ─────────────────────────────────────────────────────────────────────
function setOption(index: number, value: Partial<EqOptionDraft>): void {
  patch({ options: props.item.options.map((o, i) => (i === index ? { ...o, ...value } : o)) });
}
function addOption(): void {
  patch({ options: [...props.item.options, newOption(props.item.options)] });
}
function removeOption(index: number): void {
  patch({ options: props.item.options.filter((_, i) => i !== index) });
}
function moveOption(index: number, delta: -1 | 1): void {
  const next = [...props.item.options];
  const target = index + delta;
  const a = next[index];
  const b = next[target];
  if (a === undefined || b === undefined) return;
  next[index] = b;
  next[target] = a;
  patch({ options: next });
}

// ── 그림 ───────────────────────────────────────────────────────────────────────
// 형식·크기는 서버가 정본(BAD_FIGURE_TYPE·FIGURE_TOO_LARGE)이지만, 고르는 순간 걸러 주면 왕복이 없다.
const FIGURE_EXT = /\.(png|jpe?g|gif|webp)$/i;
const FIGURE_MAX_BYTES = 10 * 1024 * 1024;
const figureError = ref('');
const dragging = ref(false);
const dragDepth = ref(0);

function takeFiles(list: FileList | null | undefined): void {
  figureError.value = '';
  const files = Array.from(list ?? []);
  if (files.length === 0) return;
  const bad = files.find((f) => !FIGURE_EXT.test(f.name));
  if (bad !== undefined) {
    figureError.value = `${bad.name}: 그림은 png·jpg·gif·webp 만 올릴 수 있습니다.`;
    return;
  }
  const big = files.find((f) => f.size > FIGURE_MAX_BYTES);
  if (big !== undefined) {
    figureError.value = `${big.name}: 10MB 이하만 올릴 수 있습니다.`;
    return;
  }
  if (props.item.figures.length + files.length > EQ_FIGURE_MAX) {
    figureError.value = `그림은 문항당 ${String(EQ_FIGURE_MAX)}장까지입니다.`;
    return;
  }
  emit('upload', files);
}
function onPick(event: Event): void {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  takeFiles(input?.files);
  if (input !== null) input.value = ''; // 같은 파일을 지웠다가 다시 골라도 change 가 나도록
}
function onDragEnter(): void {
  dragDepth.value += 1;
  dragging.value = true;
}
function onDragLeave(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) dragging.value = false;
}
function onDrop(event: DragEvent): void {
  dragDepth.value = 0;
  dragging.value = false;
  takeFiles(event.dataTransfer?.files);
}
function setShared(fileId: number, shared: boolean): void {
  patch({ figures: props.item.figures.map((f) => (f.fileId === fileId ? { ...f, shared } : f)) });
}

// ── 직전 회차 연결 ───────────────────────────────────────────────────────────────
const prevOptions = computed(() =>
  (props.prevRound?.items ?? []).map((p, i) => ({
    itemId: p.id,
    label: `${p.factoryNo !== null && p.factoryNo !== '' ? p.factoryNo : String(i + 1)}. ${p.question}`,
  })),
);

function linkPrev(raw: unknown): void {
  const itemId = Number(raw);
  const source = props.prevRound?.items.find((p) => p.id === itemId);
  if (source === undefined) {
    patch({ prevItemId: null, prev: null, change: props.prevRound === null ? null : 'new' });
    return;
  }
  const answerLabel = source.answer === null ? null : (source.options.find((o) => o.key === source.answer?.key)?.label ?? null);
  patch({
    prevItemId: source.id,
    prev: { itemId: source.id, question: source.question, answer: source.answer, answerLabel },
    // 손으로 이을 때는 질문이 같으면 '동일', 다르면 '변경'으로 시작한다(관리자가 고친다).
    change: source.question.trim() === props.item.question.trim() ? 'same' : 'changed',
  });
}

/** 연결이 있으면 '동일·변경', 없으면 '신규'만 뜻이 있다(고객 화면의 '이전 답' 미리 채우기 근거). */
const changeChoices = computed((): PcbEqItemChangeType[] => (props.item.prevItemId === null ? ['new'] : ['same', 'changed']));

const prevRoundLabel = computed(() => {
  const roundNo = props.prevRound?.roundNo ?? null;
  return roundNo === null ? '' : `(${String(roundNo)}차)`;
});

const answeredOption = computed(() =>
  props.item.answer === null ? null : (props.item.options.find((o) => o.key === props.item.answer?.key) ?? null),
);
</script>

<template>
  <div class="grid gap-4">
    <!-- 머리 — 번호·유형·공장 번호 -->
    <div class="flex flex-wrap items-end gap-3">
      <h3 class="text-sm font-semibold" :class="editable ? 'w-full' : ''">문항 {{ no }}</h3>
      <template v-if="editable">
        <Field class="w-auto">
          <FieldLabel :for="`eq-item-cat-${item.uid}`">유형</FieldLabel>
          <NativeSelect
            :id="`eq-item-cat-${item.uid}`"
            :model-value="item.category"
            @update:model-value="patch({ category: PCB_EQ_ITEM_CATEGORIES.find((c) => c === $event) ?? 'other' })"
          >
            <NativeSelectOption v-for="c in PCB_EQ_ITEM_CATEGORIES" :key="c" :value="c">{{ PCB_EQ_ITEM_CATEGORY_LABELS[c] }}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field class="w-28">
          <FieldLabel :for="`eq-item-no-${item.uid}`">공장 번호</FieldLabel>
          <Input
            :id="`eq-item-no-${item.uid}`"
            :model-value="item.factoryNo"
            maxlength="32"
            placeholder="예: 1"
            class="font-mono"
            @update:model-value="patch({ factoryNo: text($event) })"
          />
        </Field>
      </template>
      <template v-else>
        <Badge variant="secondary">{{ PCB_EQ_ITEM_CATEGORY_LABELS[item.category] }}</Badge>
        <span v-if="item.factoryNo !== ''" class="text-muted-foreground text-xs">공장 번호 {{ item.factoryNo }}</span>
      </template>
      <Badge v-if="!editable && item.change !== null" :variant="EQ_CHANGE_VARIANT[item.change]">{{ PCB_EQ_ITEM_CHANGE_LABELS[item.change] }}</Badge>
    </div>

    <!-- AI 검토 표시 — 자동 검사(구조·번역·그림)가 걸어 둔 것. 고친 뒤 [확인함]으로 지운다. 고객에게는 안 보인다. -->
    <Alert v-if="item.aiFlags.length > 0" variant="warning" size="sm" data-eq-ai-flags>
      <SparklesIcon />
      <AlertTitle>AI 검토 표시 {{ item.aiFlags.length }}건</AlertTitle>
      <AlertDescription>
        <p class="text-xs">
          AI 초안의 자동 검사가 걸어 둔 표시입니다 — 공장 원문과 대조해 고친 뒤 [확인함]으로 지우세요(고객에게는 보이지 않습니다).
        </p>
        <ul class="mt-1.5 grid gap-1">
          <li v-for="(flag, fi) in item.aiFlags" :key="`${flag.code}-${String(fi)}`" class="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="warning">{{ PCB_EQ_AI_FLAG_LABELS[flag.code] }}</Badge>
            <span class="text-foreground min-w-0 flex-1">{{ flag.detail }}</span>
            <Button v-if="editable" variant="outline" size="xs" :aria-label="`${PCB_EQ_AI_FLAG_LABELS[flag.code]} 확인함`" @click="confirmFlag(fi)">
              <CheckIcon />
              확인함
            </Button>
          </li>
        </ul>
      </AlertDescription>
    </Alert>

    <!-- 직전 회차 연결 — 개정 회차에서만. 고객 화면의 '동일' 접기·이전 답 미리 채우기가 이 연결로 정해진다. -->
    <Panel v-if="prevRound !== null || item.prev !== null" tone="muted" class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="inline-flex items-center gap-1 font-semibold">
          <Link2Icon class="size-3.5" />
          직전 회차{{ prevRoundLabel }} 연결
        </span>
        <template v-if="editable && prevRound !== null">
          <NativeSelect
            :model-value="item.prevItemId === null ? '' : String(item.prevItemId)"
            aria-label="잇는 직전 회차 문항"
            class="max-w-80"
            @update:model-value="linkPrev"
          >
            <NativeSelectOption value="">잇지 않음(새 문항)</NativeSelectOption>
            <NativeSelectOption v-for="p in prevOptions" :key="p.itemId" :value="String(p.itemId)">{{ p.label }}</NativeSelectOption>
          </NativeSelect>
          <span class="text-muted-foreground">변화</span>
          <span class="inline-flex gap-1" role="radiogroup" aria-label="직전 회차 대비 변화">
            <Button
              v-for="c in changeChoices"
              :key="c"
              :variant="item.change === c ? 'secondary' : 'outline'"
              size="xs"
              role="radio"
              :aria-checked="item.change === c"
              @click="patch({ change: c })"
            >
              {{ PCB_EQ_ITEM_CHANGE_LABELS[c] }}
            </Button>
          </span>
        </template>
      </div>
      <dl v-if="item.prev !== null" class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
        <dt class="text-muted-foreground font-semibold">이전 질문</dt>
        <dd class="whitespace-pre-wrap">{{ item.prev.question }}</dd>
        <dt class="text-muted-foreground font-semibold">이전 답</dt>
        <dd>
          <template v-if="item.prev.answer !== null">
            <Badge variant="success">{{ item.prev.answer.key }}</Badge>
            {{ item.prev.answerLabel ?? '(지금은 없는 선택지)' }}
            <span v-if="item.prev.answer.comment !== null" class="text-muted-foreground"> · “{{ item.prev.answer.comment }}”</span>
          </template>
          <span v-else class="text-muted-foreground">답 없음(회신 전에 닫힌 회차)</span>
        </dd>
      </dl>
      <p v-else-if="editable" class="text-muted-foreground text-xs">새 문항입니다 — 고객 화면에 '신규'로 보입니다. 직전 회차의 같은 문항이면 위에서 이어 주세요.</p>
    </Panel>

    <!-- 질문 — 한국어(고객에게 보임) ↔ 공장 원문(관리자·협력사만) 나란히 -->
    <div class="grid gap-3 lg:grid-cols-2">
      <Field>
        <FieldLabel :for="`eq-item-q-${item.uid}`">한국어 질문 <span class="text-muted-foreground font-normal">— 고객에게 보임</span></FieldLabel>
        <Textarea
          v-if="editable"
          :id="`eq-item-q-${item.uid}`"
          :model-value="item.question"
          rows="4"
          maxlength="4000"
          placeholder="예) 보드에 UL 마킹을 넣을까요? 공장은 넣지 않는 것을 권합니다."
          @update:model-value="patch({ question: text($event) })"
        />
        <p v-else :id="`eq-item-q-${item.uid}`" class="text-sm whitespace-pre-wrap">{{ item.question }}</p>
      </Field>
      <Field>
        <FieldLabel :for="`eq-item-qo-${item.uid}`">공장 원문 <span class="text-muted-foreground font-normal">— 관리자·협력사만</span></FieldLabel>
        <Textarea
          v-if="editable"
          :id="`eq-item-qo-${item.uid}`"
          :model-value="item.questionOrig"
          rows="4"
          maxlength="8000"
          placeholder="공장 EQ 표의 원문(중국어·영어)을 그대로 붙여 넣으세요."
          @update:model-value="patch({ questionOrig: text($event) })"
        />
        <p v-else :id="`eq-item-qo-${item.uid}`" class="text-muted-foreground text-sm whitespace-pre-wrap">{{ item.questionOrig === '' ? '—' : item.questionOrig }}</p>
      </Field>
    </div>

    <!-- 답(발송 뒤) — 고른 선택지와 의견을 먼저 보인다(협력사 전달·승인의 근거). -->
    <Alert v-if="!editable && item.answer !== null" variant="success" size="sm">
      <AlertDescription>
        <p class="text-xs">
          <span class="font-semibold">회신</span>
          <Badge variant="success" class="ml-1">{{ item.answer.key }}</Badge>
          {{ answeredOption?.label ?? '(지금은 없는 선택지)' }}
          <span v-if="answeredOption?.labelOrig" class="text-muted-foreground"> · {{ answeredOption.labelOrig }}</span>
        </p>
        <p v-if="item.answer.comment !== null" class="text-foreground mt-1 text-sm font-medium whitespace-pre-wrap">“{{ item.answer.comment }}”</p>
        <!-- 고객 의견의 번역(D20 P4) — 협력사 화면·회신서에 원문과 함께 나가는 문장. 여기서 확인하고 고친다. -->
        <EqCommentTranslation
          v-if="item.id !== null && item.answer.comment !== null && item.answer.comment.trim() !== ''"
          :item-id="item.id"
          :translation="item.commentI18n"
          :ai-enabled="aiEnabled"
          :busy="translationBusy"
          @save="emit('saveTranslation', $event)"
          @translate="emit('translate', $event)"
        />
      </AlertDescription>
    </Alert>

    <!-- 선택지 — 기호는 공장 원문 그대로(A/B/C): 번역이 어긋나도 "B 를 골랐다"는 사실은 어긋나지 않는다. -->
    <div class="grid gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs font-semibold">
          선택지
          <span class="text-muted-foreground font-normal">— 기호는 공장 원문 그대로 · 원문은 고객에게 안 보임</span>
        </p>
        <Button v-if="editable" variant="outline" size="xs" :disabled="item.options.length >= EQ_OPTION_MAX" @click="addOption">
          <PlusIcon />
          선택지 추가
        </Button>
      </div>
      <template v-if="editable">
        <Panel v-for="(option, oi) in item.options" :key="option.uid" size="xs" class="grid gap-2 sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
          <Input
            :model-value="option.key"
            maxlength="4"
            aria-label="선택지 기호"
            class="font-mono"
            @update:model-value="setOption(oi, { key: text($event).toUpperCase() })"
          />
          <Input
            :model-value="option.label"
            maxlength="500"
            :aria-label="`선택지 ${option.key} 한국어 문구`"
            placeholder="고객에게 보일 한국어 문구"
            @update:model-value="setOption(oi, { label: text($event) })"
          />
          <Input
            :model-value="option.labelOrig"
            maxlength="1000"
            :aria-label="`선택지 ${option.key} 공장 원문`"
            placeholder="공장 원문(선택)"
            @update:model-value="setOption(oi, { labelOrig: text($event) })"
          />
          <div class="flex flex-wrap items-center gap-3 text-xs sm:col-span-3">
            <span class="inline-flex items-center gap-1.5">
              <Checkbox
                :id="`eq-opt-rec-${option.uid}`"
                :model-value="option.recommended"
                @update:model-value="setOption(oi, { recommended: isChecked($event) })"
              />
              <label :for="`eq-opt-rec-${option.uid}`" class="font-medium">제조사 권장</label>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <Checkbox
                :id="`eq-opt-cmt-${option.uid}`"
                :model-value="option.requiresComment"
                @update:model-value="setOption(oi, { requiresComment: isChecked($event) })"
              />
              <label :for="`eq-opt-cmt-${option.uid}`" class="font-medium">의견 필수</label>
              <span class="text-muted-foreground">('지시해 주세요' 류)</span>
            </span>
            <span class="ml-auto inline-flex">
              <Button variant="ghost" size="icon-xs" :disabled="oi === 0" aria-label="선택지 위로" @click="moveOption(oi, -1)">
                <ArrowUpIcon />
              </Button>
              <Button variant="ghost" size="icon-xs" :disabled="oi === item.options.length - 1" aria-label="선택지 아래로" @click="moveOption(oi, 1)">
                <ArrowDownIcon />
              </Button>
              <Button variant="ghost" size="icon-xs" :disabled="item.options.length <= 1" aria-label="선택지 삭제" @click="removeOption(oi)">
                <XIcon class="text-destructive" />
              </Button>
            </span>
          </div>
        </Panel>
      </template>
      <ul v-else class="grid gap-1">
        <li v-for="option in item.options" :key="option.uid">
          <Panel size="xs" :tone="item.answer?.key === option.key ? 'success' : 'default'" class="text-xs">
            <p class="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline">{{ option.key }}</Badge>
              <span class="text-foreground font-medium">{{ option.label }}</span>
              <Badge v-if="option.recommended" variant="info">제조사 권장</Badge>
              <Badge v-if="option.requiresComment" variant="warning">의견 필수</Badge>
              <Badge v-if="item.answer?.key === option.key" variant="success">고객 선택</Badge>
            </p>
            <p v-if="option.labelOrig !== ''" class="text-muted-foreground mt-0.5 pl-7">{{ option.labelOrig }}</p>
          </Panel>
        </li>
      </ul>
    </div>

    <!-- 그림 — 이 회차에 올린 것만. 고객에게는 '고객 공개'를 켠 것만 간다(공장 로고·원본 표 캡처는 끄기). -->
    <div class="grid gap-2">
      <p class="text-xs font-semibold">
        그림
        <span class="text-muted-foreground font-normal">— 고객에게는 공개를 켠 것만 · 공장 로고가 든 그림은 끄세요</span>
      </p>
      <label
        v-if="editable"
        class="text-muted-foreground flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed p-3 text-xs"
        :class="dragging ? 'border-primary bg-accent' : 'hover:bg-muted/40'"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
      >
        <input type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,image/*" class="sr-only" data-eq-figure-input @change="onPick">
        <ImagePlusIcon class="size-5 shrink-0" />
        <span>
          <span class="text-foreground block font-semibold">{{ uploading ? '올리는 중…' : dragging ? '여기에 놓으세요' : '그림을 끌어 놓거나 눌러서 고르기' }}</span>
          png·jpg·gif·webp · 10MB 이하 · 문항당 {{ EQ_FIGURE_MAX }}장 — 올린 뒤 [임시저장]해야 문항에 붙습니다
        </span>
      </label>
      <p v-if="figureError !== ''" class="text-destructive text-xs font-medium" role="alert">{{ figureError }}</p>
      <ul v-if="item.figures.length > 0" class="grid gap-2 sm:grid-cols-2">
        <li v-for="f in item.figures" :key="f.fileId">
          <Panel size="xs" class="flex items-start gap-2">
            <EqFigureThumb :urls="urls" :po-id="poId" :review-id="reviewId" :file-id="f.fileId" :name="f.name" @zoom="(u, n) => emit('zoom', u, n)" />
            <div class="grid min-w-0 flex-1 gap-1.5 text-xs">
              <span class="truncate font-medium" :title="f.name">{{ f.name }}</span>
              <span class="text-muted-foreground tabular-nums">{{ formatBytes(f.size) }}</span>
              <span v-if="editable" class="inline-flex items-center gap-1.5">
                <Checkbox :id="`eq-fig-share-${String(f.fileId)}`" :model-value="f.shared" @update:model-value="setShared(f.fileId, isChecked($event))" />
                <label :for="`eq-fig-share-${String(f.fileId)}`" class="font-medium">고객 공개</label>
              </span>
              <Badge v-else :variant="f.shared ? 'info' : 'outline'">{{ f.shared ? '고객 공개' : '비공개' }}</Badge>
            </div>
            <Button v-if="editable" variant="ghost" size="icon-xs" aria-label="그림 삭제" title="그림 삭제" @click="emit('removeFigure', f.fileId)">
              <Trash2Icon class="text-destructive" />
            </Button>
          </Panel>
        </li>
      </ul>
      <p v-else-if="!editable" class="text-muted-foreground text-xs">그림 없음</p>
      <!-- 올렸지만 어느 문항에도 안 붙은 그림 — 저장 없이 떠났다 돌아와도 여기서 다시 붙인다(초안일 때만). -->
      <EqLooseFigures
        v-if="editable"
        :figures="looseFigures"
        :urls="urls"
        :po-id="poId"
        :review-id="reviewId"
        :attach-blocked-reason="item.figures.length >= EQ_FIGURE_MAX ? `이 문항은 그림이 ${String(EQ_FIGURE_MAX)}장이라 더 붙일 수 없습니다.` : null"
        @attach="(id) => emit('attachFigure', id)"
        @remove="(id) => emit('removeFigure', id)"
        @zoom="(u, n) => emit('zoom', u, n)"
      />
    </div>
  </div>
</template>
