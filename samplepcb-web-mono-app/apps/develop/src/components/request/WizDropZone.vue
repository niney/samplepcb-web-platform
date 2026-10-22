<script setup lang="ts">
import { ref } from 'vue';
import { fileSize } from '../../lib/format';

// 참고 자료 드롭존 — 피그마 01-2 70:1201: 파란 2px 점선 상자 · 'Data' 폴더 아이콘(114) · 안내 2줄 · 'Select file' 테두리 버튼.
// 동작은 공용 FileDropZone(@sp/ui) 과 같다 — 파일 입력은 sr-only(Playwright setInputFiles 가 잡는다), 누적은 부모가 소유,
// 지우기 버튼은 label 밖. 아이콘은 시안의 벡터 조각(배경 그라데이션·폴더·화살표·'Data')을 인라인 SVG 로 다시 얹었다
// (export PNG 는 114px 한 장이라 고해상도에서 흐리고, 인라인이라 'Data' 가 앱 글꼴로 그려진다).
withDefaults(defineProps<{ files: File[]; label?: string; hint?: string }>(), {
  label: 'Drag & drop  회로도, PCB 원본, Gerber, DXF·STEP, BOM, 데이터시트, 사진·영상 등',
  hint: 'PDF, 이미지, 엑셀, ZIP 파일',
});
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
  <div class="flex flex-col gap-[12px]">
    <label
      class="flex cursor-pointer flex-col items-center rounded-[14px] border-2 border-dashed border-[#2945e8] p-[20px] transition-colors sm:p-[30px]"
      :class="dragging ? 'bg-[#f1f6ff]' : 'bg-white'"
      @dragenter.prevent="onEnter"
      @dragover.prevent
      @dragleave="onLeave"
      @drop.prevent="onDrop"
    >
      <input type="file" multiple class="sr-only" @change="onPick">
      <span class="flex w-full flex-wrap items-center gap-[20px] sm:flex-nowrap sm:gap-[26px]">
        <svg class="hidden size-[114px] shrink-0 sm:block" width="114" height="114" viewBox="0 0 114 114" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="wiz-data-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.13077" stop-color="#B5D1FF" stop-opacity="0.14" />
              <stop offset="1" stop-color="#B5D1FF" stop-opacity="0.58" />
            </linearGradient>
            <clipPath id="wiz-data-clip"><rect width="114" height="114" rx="20" /></clipPath>
          </defs>
          <rect width="114" height="114" rx="20" fill="url(#wiz-data-bg)" />
          <g clip-path="url(#wiz-data-clip)">
            <g transform="translate(15.334 4.997)">
              <rect y="29.02" width="78.66" height="44.3" rx="6" fill="#fff" />
              <path
                transform="translate(0 25.2)"
                d="M24.5586 0C27.5345 0 30.2647 1.65194 31.6455 4.28809L35.8662 12.3477C36.2372 13.056 36.4895 13.7834 36.6357 14.5117H76C80.4182 14.5117 83.9999 18.0935 84 22.5117V63.7959C83.9998 68.214 80.4181 71.7959 76 71.7959H8C3.58186 71.7959 0.000230042 68.214 0 63.7959V8C0 3.58172 3.58172 0 8 0H24.5586Z"
                fill="#69A1FF"
              />
              <path
                transform="translate(42.12 30.4) rotate(-45.01) translate(-18.509 -18.722)"
                d="M36.254 18.3363C36.094 21.3171 32.4804 22.7015 30.3698 20.5906C29.0225 19.2432 26.838 19.2432 25.4908 20.5906L9.81044 36.2732C8.24838 37.8354 5.71556 37.8355 4.15339 36.2734L1.17157 33.2915C-0.390446 31.7295 -0.390537 29.197 1.17137 27.6349L16.7218 12.0823C18.1411 10.6628 18.1411 8.36149 16.7217 6.94198C14.4979 4.71792 15.9567 0.910727 19.0973 0.742044L32.8031 0.00589309C35.1783 -0.121681 37.1394 1.83928 37.0119 4.2145L36.254 18.3363Z"
                fill="#2979FF"
              />
              <text x="41.94" y="71.6" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="700" fill="#EAF6FF">Data</text>
            </g>
          </g>
        </svg>
        <span class="flex min-w-0 flex-1 flex-col gap-[8px]">
          <span class="whitespace-pre-wrap text-[17px] font-medium leading-[1.4] text-black sm:text-[20px]">{{ dragging ? '여기에 놓으세요' : label }}</span>
          <span class="text-[15px] font-medium leading-[1.3] text-[#666] sm:text-[16px]">{{ hint }}</span>
        </span>
        <span class="flex h-[51px] w-full shrink-0 items-center justify-center rounded-[8px] border border-[#2945e8] text-[16px] font-bold text-[#2945e8] sm:w-[144px]">
          Select file
        </span>
      </span>
    </label>

    <ul v-if="files.length > 0" class="flex flex-col gap-[8px]">
      <li
        v-for="(f, i) in files"
        :key="`${f.name}:${f.size}:${f.lastModified}`"
        class="flex min-w-0 items-center gap-[10px] rounded-[10px] border border-[#d9d9d9] bg-white px-[16px] py-[10px] text-[16px]"
      >
        <span class="min-w-0 flex-1 truncate font-medium text-black">{{ f.name }}</span>
        <span class="shrink-0 tabular-nums text-[#999]">{{ fileSize(f.size) }}</span>
        <button
          type="button"
          class="flex size-[28px] shrink-0 items-center justify-center rounded-full text-[#666] transition-colors hover:bg-[#f0f4fa] hover:text-black"
          :aria-label="`${f.name} 빼기`"
          @click="emit('remove', i)"
        >
          ✕
        </button>
      </li>
    </ul>
  </div>
</template>
