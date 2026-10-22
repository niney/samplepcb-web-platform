<script setup lang="ts">
import { computed, ref } from 'vue';
import iconClip from '../../assets/detail/attach-clip.svg';

// 문의 작성기 — 피그마 「00-3 의뢰 상세」 38:9427: "문의하기" 제목 + 오른쪽 '문의 제출', 테두리 상자 안에 입력과
// 아래쪽 '파일 첨부 (선택)'. 완료된 의뢰에서는 같은 창구가 A/S 요청이 된다(서버가 completed 일 때만
// as_request 로 받는다). 종결(cancelled·declined)이면 부모가 이 컴포넌트를 아예 그리지 않는다.
// 첨부는 누적하고 name+size+lastModified 로만 중복을 거른다(위저드와 같은 규칙). 상자에 끌어다 놓아도 붙는다.
const props = withDefaults(defineProps<{ canRequestAs?: boolean; pending?: boolean; error?: string }>(), {
  canRequestAs: false,
  pending: false,
  error: '',
});
const emit = defineEmits<{ submit: [{ body: string; asRequest: boolean; files: File[] }] }>();

const body = ref('');
const asRequest = ref(false);
const files = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

const key = (f: File): string => `${f.name}|${String(f.size)}|${String(f.lastModified)}`;
function addFiles(added: File[]): void {
  const seen = new Set(files.value.map(key));
  const next = [...files.value];
  for (const f of added) {
    if (seen.has(key(f))) continue;
    seen.add(key(f));
    next.push(f);
  }
  files.value = next;
}
function removeFile(i: number): void {
  files.value = files.value.filter((_, idx) => idx !== i);
}
function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  addFiles([...(input.files ?? [])]);
  input.value = '';
}
function onDrop(e: DragEvent): void {
  addFiles([...(e.dataTransfer?.files ?? [])]);
}

const canSend = computed(() => body.value.trim().length > 0 && !props.pending);

function send(): void {
  if (!canSend.value) return;
  emit('submit', { body: body.value.trim(), asRequest: props.canRequestAs && asRequest.value, files: files.value });
}

// 부모가 성공을 알려 주면 비운다(전송 뒤 상세를 다시 읽으므로 여기서 낙관적 갱신은 하지 않는다).
function reset(): void {
  body.value = '';
  asRequest.value = false;
  files.value = [];
}
defineExpose({ reset });
</script>

<template>
  <div class="flex flex-col gap-[10.5px]">
    <div class="flex flex-wrap items-center justify-between gap-[10px]">
      <div class="flex flex-wrap items-center gap-[12px]">
        <h3 class="text-[18px] font-medium leading-[1.3] text-black">{{ canRequestAs && asRequest ? 'A/S 요청' : '문의하기' }}</h3>
        <label v-if="canRequestAs" class="flex cursor-pointer items-center gap-[6px] text-[14px] text-[#141e34]">
          <input v-model="asRequest" type="checkbox" class="size-[16px] accent-[#212121]">
          A/S 요청으로 보내기
        </label>
      </div>
      <button
        type="button"
        class="flex h-[34px] min-w-[84px] items-center justify-center rounded-[6px] bg-[#f0f4fa] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:bg-[#e2e8f2] disabled:opacity-50"
        :disabled="!canSend"
        @click="send"
      >
        {{ pending ? '보내는 중…' : canRequestAs && asRequest ? 'A/S 요청' : '문의 제출' }}
      </button>
    </div>
    <div
      class="flex min-h-[157px] flex-col justify-between gap-[10px] rounded-[10px] border border-[#d9d9d9] p-[14px]"
      @dragover.prevent
      @drop.prevent="onDrop"
    >
      <textarea
        v-model="body"
        rows="3"
        maxlength="5000"
        placeholder="궁금한 점이나 전달할 내용을 적어 주세요. 담당자에게 바로 전달됩니다."
        class="w-full flex-1 resize-y border-0 bg-transparent p-0 text-[15px] leading-[1.8] text-[#141e34] outline-none placeholder:text-[#141e34]"
      />
      <div class="flex flex-wrap items-center gap-[10px]">
        <button type="button" class="flex items-center gap-[10px]" @click="fileInput?.click()">
          <span class="flex size-[26px] items-center justify-center rounded-[6px] border border-[#d9d9d9] bg-[#f2f2f2]">
            <img :src="iconClip" alt="" class="block size-[15.167px]">
          </span>
          <span class="text-[14px] leading-[1.2] text-[#333]">파일 첨부 (선택)</span>
        </button>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onPick">
        <span
          v-for="(f, i) in files"
          :key="`${f.name}-${i}`"
          class="flex max-w-full items-center gap-[6px] rounded-[37px] bg-[#f5f6f8] px-[10px] py-[4px] text-[13px] text-[#141e34]"
        >
          <span class="truncate">{{ f.name }}</span>
          <button type="button" class="shrink-0 text-[#999] hover:text-black" :aria-label="`${f.name} 빼기`" @click="removeFile(i)">✕</button>
        </span>
      </div>
    </div>
    <p v-if="error !== ''" class="text-[14px] font-semibold text-red-700">{{ error }}</p>
  </div>
</template>
