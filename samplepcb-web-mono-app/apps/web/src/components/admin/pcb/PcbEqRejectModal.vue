<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminPcbPoViewType } from '@sp/api-contract';
import {
  useDeleteAdminPcbEqFile,
  useUploadAdminPcbEqFile,
} from '../../../admin/useAdminPcbPos';
import { formatBytes } from '../../../lib/format';

// EQ 반려 — **사유와 수정지시 첨부를 한 자리에서** 받는다.
//
// 공용 UiPromptModal 을 쓰지 않는 이유: 이건 프롬프트가 아니라 폼이다. 파일을 여러 개
// 붙이고, 이미 붙인 것을 확인하고, 잘못 올린 것을 빼야 한다 — 값 하나를 받아 오는
// 프롬프트로는 표현되지 않는다(값만 받는 조작은 계속 공용 모달을 쓴다, P4.11).
//
// 첨부는 **고르는 즉시 업로드**한다(반려 API 는 사유만 받는다 — 서버 무변경). 반려를
// 취소해도 파일은 발주 행의 [↩ 회신] 구획에 남아 다음 반려에 그대로 쓸 수 있고, 여기서
// ✕ 로 지울 수도 있다. 반려는 한 번 보내면 메일이 나가 되돌릴 수 없으므로, 보내기 전에
// 무엇이 함께 가는지 이 화면에서 다 보이게 한다.
const props = defineProps<{
  /** null = 닫힘. 부모가 **목록에서 찾은 최신 행**을 넘겨야 업로드 후 첨부가 갱신된다. */
  po: AdminPcbPoViewType | null;
  specId: number | null;
  /** 고객이 반려한 건이면 그 사유 — 다시 타이핑하지 않게 채워 둔다. */
  prefillReason: string;
  busy: boolean;
}>();
const emit = defineEmits<{ close: []; confirm: [reason: string] }>();

const reason = ref('');
const localError = ref('');
const upload = useUploadAdminPcbEqFile();
const remove = useDeleteAdminPcbEqFile();

// 열릴 때마다 초기화 — 지난 반려의 사유가 남아 있으면 엉뚱한 문장이 나간다.
watch(
  () => props.po?.poId ?? null,
  (poId) => {
    if (poId === null) return;
    reason.value = props.prefillReason;
    localError.value = '';
  },
  { immediate: true },
);

const replyFiles = computed(() => props.po?.eqFiles.filter((f) => f.fileType === 'reply') ?? []);
const canSubmit = computed(() => reason.value.trim() !== '' && !props.busy);

function pickFile(): void {
  if (props.po === null || props.specId === null) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined || props.po === null || props.specId === null) return;
    localError.value = '';
    try {
      await upload.mutateAsync({
        specId: props.specId,
        poId: props.po.poId,
        file,
        fileType: 'reply',
      });
    } catch {
      localError.value = '첨부 업로드에 실패했습니다.';
    }
  };
  input.click();
}

async function removeFile(fileId: number): Promise<void> {
  if (props.po === null || props.specId === null) return;
  localError.value = '';
  try {
    await remove.mutateAsync({ specId: props.specId, poId: props.po.poId, fileId });
  } catch {
    localError.value = '첨부 삭제에 실패했습니다.';
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="po !== null"
      class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      @click.self="emit('close')"
    >
      <div class="w-full max-w-lg rounded-xl bg-surface p-5 shadow-2xl">
        <h3 class="text-sm font-bold text-gray-800">EQ 반려 — {{ po.partnerName }}</h3>
        <p class="mt-1 text-xs text-gray-500">
          협력사에게 메일로 전달되고, 발주는 '발주접수'로 되돌아갑니다.
        </p>

        <label class="mt-4 block">
          <span class="text-xs font-semibold text-gray-600">반려 사유 <span class="text-red-500">*</span></span>
          <textarea
            v-model="reason"
            rows="3"
            class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
            placeholder="예) 실크 위치를 좌측으로 옮겨 주세요."
          />
          <span class="text-[11px] text-gray-400">
            {{ prefillReason === ''
              ? '이 문장이 협력사에게 메일로 전달됩니다.'
              : '고객이 남긴 사유를 채워 두었습니다 — 그대로 보내거나 다듬어 주세요.' }}
          </span>
        </label>

        <!-- 수정지시 첨부 — 고르는 즉시 올라간다(목록이 곧 상태다). -->
        <div class="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-blue-800">수정 지시 첨부</span>
            <button
              type="button"
              class="rounded-md border border-blue-300 bg-surface px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
              :disabled="upload.isPending.value"
              @click="pickFile"
            >
              {{ upload.isPending.value ? '올리는 중…' : '+ 파일 추가' }}
            </button>
          </div>
          <ul v-if="replyFiles.length > 0" class="mt-2 space-y-1">
            <li v-for="f in replyFiles" :key="f.fileId" class="flex items-center gap-2 text-xs">
              <span class="truncate font-medium text-blue-800">{{ f.name }}</span>
              <span class="shrink-0 text-blue-300">{{ formatBytes(f.size) }}</span>
              <button
                type="button"
                class="ml-auto shrink-0 text-blue-300 hover:text-red-600 disabled:opacity-40"
                :disabled="remove.isPending.value"
                aria-label="첨부 제거"
                @click="void removeFile(f.fileId)"
              >
                ✕
              </button>
            </li>
          </ul>
          <p class="mt-1.5 text-[11px] text-blue-600">
            {{ replyFiles.length === 0
              ? '없어도 반려할 수 있습니다 — 도면·마크업이 있으면 붙여 주세요.'
              : '협력사가 포털 발주 상세에서 내려받습니다. 메일에도 첨부 사실이 안내됩니다.' }}
          </p>
        </div>

        <p v-if="localError !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ localError }}</p>

        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            @click="emit('close')"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
            :disabled="!canSubmit"
            @click="emit('confirm', reason.trim())"
          >
            {{ busy ? '보내는 중…' : `반려하고 알리기${replyFiles.length > 0 ? ` (첨부 ${replyFiles.length})` : ''}` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
