<script setup lang="ts">
import { ref } from 'vue';

// 파일 드롭존(docs/AI_DEV_REVIEW.md §13.9) — 1단계 참고 자료(panel)와 2단계 분야별 추가자료 슬롯(slot)이 같이 쓴다.
// 기본 <input type="file"> 은 sr-only 로 숨기고 영역 전체가 클릭·드롭 대상이다(sr-only 는 1px 박스라
// Playwright setInputFiles 도 그대로 잡는다 — display:none 으로 바꾸지 말 것).
// 파일은 누적한다(같은 name+size+lastModified 만 중복으로 걸러 낸다) — 부모가 목록을 소유하고
// 여기서는 add/remove 만 올린다. 지우기 버튼은 <label> 밖에 둔다(안에 두면 클릭이 파일 선택창을 연다).
// 슬롯은 최대 10칸이라 panel 처럼 키우지 않는다 — 카드 크기는 그대로 두고 드롭만 받는다.

withDefaults(defineProps<{
  files: File[];
  label: string;
  hint?: string;
  variant?: 'panel' | 'slot';
}>(), { hint: '', variant: 'panel' });
const emit = defineEmits<{ add: [File[]]; remove: [number] }>();

// dragenter/dragleave 는 자식 위로 옮겨갈 때마다 나므로 깊이를 센다(테두리 깜빡임 방지).
const depth = ref(0);
const dragging = ref(false);

function onEnter(): void {
  depth.value += 1;
  dragging.value = true;
}
function onLeave(): void {
  depth.value = Math.max(0, depth.value - 1);
  if (depth.value === 0) dragging.value = false;
}
function onDrop(e: DragEvent): void {
  depth.value = 0;
  dragging.value = false;
  const list = e.dataTransfer?.files;
  if (list !== undefined && list.length > 0) emit('add', Array.from(list));
}
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files !== null && input.files.length > 0) emit('add', Array.from(input.files));
  input.value = ''; // 같은 파일을 지웠다가 다시 골라도 change 가 나도록 비운다
}

const sizeLabel = (n: number): string =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB` : `${(n / 1048576).toFixed(1)} MB`;
</script>

<template>
  <div class="grid gap-2">
    <label
      class="block cursor-pointer transition"
      :class="[
        variant === 'panel'
          ? 'rounded-xl border-2 border-dashed px-4 py-3'
          : 'rounded-xl border px-4 py-3 text-label',
        dragging
          ? 'border-brand-500 bg-brand-50'
          : files.length > 0
            ? (variant === 'panel' ? 'border-ink-900 bg-white' : 'border-ink-900 border-solid bg-white')
            : (variant === 'panel' ? 'border-line-2 bg-paper hover:border-tx-3' : 'border-dashed border-line-2 bg-paper hover:border-tx-3'),
      ]"
      @dragenter.prevent="onEnter"
      @dragover.prevent
      @dragleave="onLeave"
      @drop.prevent="onDrop"
    >
      <input type="file" multiple class="sr-only" @change="onPick">
      <template v-if="variant === 'panel'">
        <span class="flex items-center gap-3">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition"
            :class="dragging ? 'bg-brand-500 text-white' : 'bg-white text-tx-3 ring-1 ring-line-2'"
          >
            <svg class="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
              <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
            </svg>
          </span>
          <span class="grid min-w-0 gap-0.5">
            <span class="text-body font-bold text-tx-1">{{ dragging ? '여기에 놓으세요' : label }}</span>
            <span v-if="hint !== ''" class="text-label leading-relaxed text-tx-3">{{ hint }}</span>
          </span>
          <span class="ml-auto inline-flex h-8 shrink-0 items-center rounded-full border border-line-2 bg-white px-3.5 text-label font-semibold text-tx-2">
            파일 선택
          </span>
        </span>
      </template>
      <template v-else>
        <span class="grid gap-1">
          <span class="font-semibold text-tx-1">
            {{ label }}
            <span v-if="files.length > 0" class="ml-1 rounded-full bg-ink-900 px-2 py-0.5 text-micro text-white">{{ files.length }}개</span>
          </span>
          <span class="font-normal text-tx-3">{{ hint }}</span>
          <span class="font-normal text-tx-3">{{ dragging ? '여기에 놓으세요' : '끌어다 놓거나 눌러서 선택' }}</span>
        </span>
      </template>
    </label>

    <!-- 고른 파일 — label 밖(안에 두면 ✕ 클릭이 파일 선택창을 연다) -->
    <ul v-if="files.length > 0" class="grid gap-1.5">
      <li
        v-for="(f, i) in files"
        :key="`${f.name}:${f.size}:${f.lastModified}`"
        class="flex min-w-0 items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-label"
      >
        <span class="min-w-0 flex-1 truncate font-semibold text-tx-1">{{ f.name }}</span>
        <span class="shrink-0 tabular-nums text-tx-3">{{ sizeLabel(f.size) }}</span>
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-tx-3 transition hover:bg-paper hover:text-tx-1"
          :aria-label="`${f.name} 빼기`"
          @click="emit('remove', i)"
        >
          ✕
        </button>
      </li>
    </ul>
  </div>
</template>
