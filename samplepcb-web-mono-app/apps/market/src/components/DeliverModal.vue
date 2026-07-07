<script setup lang="ts">
import { computed, ref, watch } from 'vue';

// 작업 완료 보고 모달(전문가) — 노트 + 산출물 다중 첨부. delivered 에서 재보고(파일 추가·
// 노트 갱신)도 같은 폼. 서버는 multipart(note?, deliverable[])로 받는다(FormData 는 페이지가 구성).

const props = defineProps<{
  open: boolean;
  isReport: boolean; // true = 재보고(이미 delivered)
  pending: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; submit: [payload: { note: string; files: File[] }] }>();

const note = ref('');
const files = ref<File[]>([]);
const fileInput = ref<HTMLInputElement | null>(null);

// 열릴 때마다 폼 초기화(재보고여도 노트는 새로 작성 — 기존 노트 프리필 없음).
watch(
  () => props.open,
  (open) => {
    if (open) {
      note.value = '';
      files.value = [];
      if (fileInput.value !== null) fileInput.value.value = '';
    }
  },
);

function pickFiles(e: Event): void {
  const input = e.target as HTMLInputElement;
  files.value = input.files !== null ? Array.from(input.files) : [];
}

// 보고할 내용이 있어야 제출 — 노트 또는 파일 중 하나는 필요.
const valid = computed(() => note.value.trim() !== '' || files.value.length > 0);

function submit(): void {
  if (!valid.value || props.pending) return;
  emit('submit', { note: note.value.trim(), files: files.value });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <p class="font-mono text-[11px] tracking-widest text-tx-3">DELIVERY</p>
      <h2 class="mt-1 text-lg font-extrabold text-tx-1">
        {{ isReport ? '산출물 추가 보고' : '작업 완료 보고' }}
      </h2>
      <p class="mt-1.5 text-xs text-tx-3">
        {{
          isReport
            ? '파일을 추가하거나 전달 메모를 갱신할 수 있습니다.'
            : '산출물을 업로드하고 전달 메모를 남기면 의뢰인에게 검수 요청이 전달됩니다.'
        }}
      </p>

      <div class="mt-4 grid gap-3">
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          전달 메모
          <textarea
            v-model="note"
            rows="4"
            placeholder="산출물 구성, 사용 방법, 참고 사항을 적어주세요."
            class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
          />
        </label>
        <label class="grid gap-1.5 text-xs font-bold text-tx-2">
          산출물 파일 <span class="font-normal text-tx-3">(여러 개 선택 가능)</span>
          <input ref="fileInput" type="file" multiple class="text-xs font-normal" @change="pickFiles">
          <span v-if="files.length > 0" class="font-normal text-tx-3">
            {{ files.length }}개 선택됨
          </span>
        </label>
      </div>

      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
          @click="emit('close')"
        >
          닫기
        </button>
        <button
          type="button"
          class="rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
          :disabled="!valid || pending"
          @click="submit"
        >
          {{ pending ? '보고 중…' : isReport ? '추가 보고' : '완료 보고' }}
        </button>
      </div>
    </div>
  </div>
</template>
