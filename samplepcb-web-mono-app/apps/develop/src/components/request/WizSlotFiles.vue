<script setup lang="ts">
import { ref } from 'vue';
import { fileSize } from '../../lib/format';
import fileX from '../../assets/wizard/file-x.svg';
import filePlus from '../../assets/wizard/file-plus.svg';

// 설계 자료 질문 옆 첨부 칸(PCB 설계만, 2026-11-02) — 질문마다 그 자료만 받는 한 줄 칸. 동작은 참고 자료 드롭존(WizDropZone)과
// 같다: 누적은 부모가 소유, 파일 입력은 sr-only(Playwright setInputFiles 가 aria-label 로 잡는다), 끌어 놓기는 칸 전체,
// 지우기 버튼은 label 밖(안이면 누를 때 파일 선택 창이 열린다).
defineProps<{ files: File[]; label: string; hint: string }>();
const emit = defineEmits<{ add: [File[]]; remove: [number] }>();

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
  input.value = '';
}
</script>

<template>
  <div
    class="flex flex-col gap-[12px] rounded-[14px] border border-dashed px-[16px] py-[14px] transition-colors sm:px-[20px]"
    :class="dragging ? 'border-[#2945e8] bg-[#f1f6ff]' : 'border-[#9fb4f5] bg-white'"
    @dragenter.prevent="onEnter"
    @dragover.prevent
    @dragleave="onLeave"
    @drop.prevent="onDrop"
  >
    <div class="flex flex-wrap items-center gap-x-[14px] gap-y-[8px]">
      <label class="flex h-[44px] shrink-0 cursor-pointer items-center gap-[6px] rounded-[8px] border border-[#2945e8] bg-white px-[16px] text-[15px] font-bold text-[#2945e8] transition-colors hover:bg-[#f1f6ff]">
        <input type="file" multiple class="sr-only" :aria-label="`${label} 파일 첨부`" @change="onPick">
        <img :src="filePlus" alt="" width="18" height="18" class="block size-[18px]">
        {{ label }} 첨부
      </label>
      <span class="min-w-0 text-[14px] font-medium leading-[1.5] text-[#666] sm:text-[15px]">{{ dragging ? '여기에 놓으세요' : hint }}</span>
    </div>
    <ul v-if="files.length > 0" class="flex flex-wrap gap-x-[16px] gap-y-[6px]">
      <li
        v-for="(f, i) in files"
        :key="`${f.name}:${f.size}:${f.lastModified}`"
        class="flex min-w-0 max-w-full items-center gap-[8px]"
        :title="`${f.name} · ${fileSize(f.size)}`"
      >
        <span class="truncate text-[16px] font-medium leading-[1.4] text-black sm:text-[17px]">{{ f.name }}</span>
        <button
          type="button"
          class="flex size-[26px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#f0f4fa]"
          :aria-label="`${f.name} 빼기`"
          @click="emit('remove', i)"
        >
          <img :src="fileX" alt="" width="18" height="18" class="block size-[18px]">
        </button>
      </li>
    </ul>
  </div>
</template>
