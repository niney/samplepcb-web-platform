<script setup lang="ts">
import { computed, ref } from 'vue';
import { FileDropZone } from '@sp/ui';

// 문의 작성기 — 타임라인 위. 완료된 의뢰에서는 같은 창구가 A/S 요청이 된다(서버가 completed 일 때만
// as_request 로 받는다). 종결(cancelled·declined)이면 부모가 이 컴포넌트를 아예 그리지 않는다.
// 첨부는 누적하고 name+size+lastModified 로만 중복을 거른다(위저드와 같은 규칙).
const props = withDefaults(defineProps<{ canRequestAs?: boolean; pending?: boolean; error?: string }>(), {
  canRequestAs: false,
  pending: false,
  error: '',
});
const emit = defineEmits<{ submit: [{ body: string; asRequest: boolean; files: File[] }] }>();

const body = ref('');
const asRequest = ref(false);
const files = ref<File[]>([]);

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
  <div class="grid gap-3 rounded-2xl border border-line bg-paper p-4 sm:p-5">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="text-body font-extrabold text-tx-1">{{ canRequestAs && asRequest ? 'A/S 요청' : '문의하기' }}</h3>
      <label v-if="canRequestAs" class="ml-auto flex cursor-pointer items-center gap-2 text-label font-semibold text-tx-2">
        <input v-model="asRequest" type="checkbox" class="h-4 w-4 accent-current">
        A/S 요청으로 보내기
      </label>
    </div>
    <textarea
      v-model="body"
      rows="3"
      maxlength="5000"
      placeholder="궁금한 점이나 전달할 내용을 적어 주세요. 담당자에게 바로 전달됩니다."
      class="w-full resize-y rounded-lg border border-line-2 bg-white px-3.5 py-2.5 text-body leading-relaxed text-tx-1"
    />
    <FileDropZone
      :files="files"
      label="파일 첨부 (선택)"
      hint="화면 캡처·문서 등 무엇이든 올리실 수 있습니다"
      variant="slot"
      @add="addFiles"
      @remove="removeFile"
    />
    <p v-if="error !== ''" class="text-body font-semibold text-red-700">{{ error }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
        :disabled="!canSend"
        @click="send"
      >
        {{ pending ? '보내는 중…' : '보내기' }}
      </button>
      <span v-if="files.length > 0" class="text-label text-tx-3">첨부 {{ files.length }}개</span>
    </div>
  </div>
</template>
