<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronDownIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';

// 선택지로 **유도하되 가두지는 않는** 입력칸 — 옛 components/ui/UiComboInput 의 짝(같은 API).
//
// 거버(고객)는 select 로 값을 좁히지만, 관리자는 협력사와 협의한 값을 적어야 한다 — 실측상
// `panel` 의 19%·`edgeRail` 의 11% 가 선택지 밖 값이다. select 로 강제하면 저장 순간 사라진다.
// 그래서 목록은 **보기**이고 입력은 자유다. 목록 밖 값이면 그 사실만 표시한다.
//
// 값의 두 얼굴: 목록에서 고르면 화면엔 표시명(녹색), 저장은 거버와 같은 값(green).
// 손으로 적으면 적은 문자열이 그대로 저장값이자 표시값이다.
// modelValue 가 undefined 를 받는 이유: 호출부가 `draft[key]` 처럼 인덱스로 넘긴다.
const props = defineProps<{
  modelValue: string | undefined;
  options: readonly { value: string; name: string }[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [string] }>();

const open = ref(false);
const box = ref<HTMLElement | null>(null);
const current = computed(() => props.modelValue ?? '');

const matches = (o: { value: string; name: string }, raw: string): boolean =>
  o.value.toLowerCase() === raw.toLowerCase() || o.name.toLowerCase() === raw.toLowerCase();

/** 저장값 → 표시명. 목록 밖이면 저장값이 곧 표시값이다. */
const shown = computed(() => {
  const raw = current.value.trim();
  if (raw === '') return '';
  return props.options.find((o) => matches(o, raw))?.name ?? raw;
});

const listed = computed(() => {
  const raw = current.value.trim();
  if (raw === '' || props.options.length === 0) return true;
  return props.options.some((o) => matches(o, raw));
});

/** 타이핑은 그대로 저장값이 된다 — 관리자가 적은 문구를 우리가 해석하지 않는다. */
function onInput(value: string | number): void {
  open.value = true;
  emit('update:modelValue', String(value));
}
function pick(o: { value: string; name: string }): void {
  emit('update:modelValue', o.value);
  open.value = false;
}
function onFocusOut(e: FocusEvent): void {
  // 목록 항목·토글을 누르는 중이면 닫지 않는다(click 이 blur 뒤에 온다).
  const next = e.relatedTarget as Node | null;
  if (next !== null && box.value?.contains(next) === true) return;
  open.value = false;
}
</script>

<template>
  <div ref="box" class="relative" @focusout="onFocusOut">
    <div class="flex items-center gap-1">
      <Input
        :model-value="shown"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled === true"
        @update:model-value="onInput"
        @focus="open = true"
      />
      <Button
        v-if="options.length > 0"
        variant="outline"
        size="icon"
        :disabled="disabled === true"
        :aria-expanded="open"
        title="거버 선택지 보기"
        aria-label="거버 선택지 보기"
        @mousedown.prevent="open = !open"
      >
        <ChevronDownIcon />
      </Button>
    </div>

    <!-- 목록 밖 값이라는 사실만 알린다 — 고치라고 강요하지 않는다. -->
    <p v-if="!listed" class="text-warning mt-0.5 text-xs font-medium">직접 입력</p>

    <ul
      v-if="open && options.length > 0"
      class="bg-popover text-popover-foreground absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border py-1 shadow-md"
    >
      <li v-for="o in options" :key="o.value">
        <button
          type="button"
          class="hover:bg-accent hover:text-accent-foreground flex w-full items-baseline gap-2 px-2 py-1 text-left text-sm"
          :class="o.value.toLowerCase() === current.trim().toLowerCase() ? 'text-primary font-semibold' : ''"
          @click="pick(o)"
        >
          <span class="min-w-0 flex-1 truncate">{{ o.name }}</span>
          <span v-if="o.name !== o.value" class="text-muted-foreground shrink-0 font-mono text-xs">{{ o.value }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
