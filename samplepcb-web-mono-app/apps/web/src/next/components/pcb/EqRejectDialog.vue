<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PaperclipIcon, PlusIcon, XIcon } from '@lucide/vue';
import { pcbEqRejectActionLabel, type AdminPcbPoViewType } from '@sp/api-contract';
import { useDeleteAdminPcbEqFile, useUploadAdminPcbEqFile } from '@/admin/useAdminPcbPos';
import { formatBytes } from '@/lib/format';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/next/components/ui/field';
import { Textarea } from '@/next/components/ui/textarea';

// EQ 반려 — **사유와 수정지시 첨부를 한 자리에서** 받는다. 옛 PcbEqRejectModal 과 같은 API
// (po=null 이면 닫힘). 값 하나를 받는 프롬프트가 아니라 폼이라 promptDialog 를 쓰지 않는다 —
// 파일을 여러 개 붙이고, 붙인 것을 확인하고, 잘못 올린 것을 빼야 한다.
//
// 첨부는 **고르는 즉시 업로드**한다(반려 API 는 사유만 받는다). 반려를 취소해도 파일은 발주 행의
// [회신] 구획에 남아 다음 반려에 쓸 수 있고, 여기서 지울 수도 있다. 반려는 한 번 보내면 메일이
// 나가 되돌릴 수 없으므로, 보내기 전에 무엇이 함께 가는지 이 화면에서 다 보이게 한다.
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
// 트랙별 어휘 — 스텐실의 되돌리기는 반려가 아니라 **보완 요청**이다(단어는 계약 사전 하나).
const stencil = computed(() => props.po?.track === 'stencil');
const actWord = computed(() => pcbEqRejectActionLabel(props.po?.track ?? 'eq'));
const submitLabel = computed(() => {
  if (props.busy) return '보내는 중…';
  const base = stencil.value ? '보완 요청 보내기' : '반려하고 알리기';
  return replyFiles.value.length > 0 ? `${base} (첨부 ${String(replyFiles.value.length)})` : base;
});

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

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
const setReason = (value: string | number): void => {
  reason.value = String(value);
};
</script>

<template>
  <Dialog :open="po !== null" @update:open="onOpenChange">
    <DialogContent v-if="po !== null" class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ stencil ? '보완 요청' : 'EQ 반려' }} — {{ po.partnerName }}</DialogTitle>
        <DialogDescription>협력사에게 메일로 전달되고, 발주는 '발주접수'로 되돌아갑니다.</DialogDescription>
      </DialogHeader>

      <Field>
        <FieldLabel for="eq-reject-reason">
          {{ actWord }} 사유 <span class="text-destructive">*</span>
        </FieldLabel>
        <Textarea
          id="eq-reject-reason"
          :model-value="reason"
          rows="3"
          :placeholder="stencil ? '예) 좌표파일이 최신 도면과 다릅니다 — 다시 확인해 주세요.' : '예) 실크 위치를 좌측으로 옮겨 주세요.'"
          @update:model-value="setReason"
        />
        <FieldDescription>
          {{ prefillReason === ''
            ? '이 문장이 협력사에게 메일로 전달됩니다.'
            : '고객이 남긴 사유를 채워 두었습니다 — 그대로 보내거나 다듬어 주세요.' }}
        </FieldDescription>
      </Field>

      <!-- 수정지시 첨부 — 고르는 즉시 올라간다(목록이 곧 상태다). -->
      <div class="border-info/30 bg-info-soft/40 rounded-lg border p-3">
        <div class="flex items-center justify-between gap-2">
          <span class="text-info flex items-center gap-1.5 text-sm font-semibold">
            <PaperclipIcon class="size-4" />
            수정 지시 첨부
          </span>
          <Button variant="outline" size="sm" :disabled="upload.isPending.value" @click="pickFile">
            <PlusIcon />
            {{ upload.isPending.value ? '올리는 중…' : '파일 추가' }}
          </Button>
        </div>
        <ul v-if="replyFiles.length > 0" class="mt-2 space-y-1">
          <li v-for="f in replyFiles" :key="f.fileId" class="flex items-center gap-2 text-xs">
            <span class="min-w-0 truncate font-medium">{{ f.name }}</span>
            <span class="text-muted-foreground shrink-0 tabular-nums">{{ formatBytes(f.size) }}</span>
            <span class="ml-auto shrink-0">
              <Button
                variant="ghost"
                size="icon-xs"
                :disabled="remove.isPending.value"
                aria-label="첨부 제거"
                @click="void removeFile(f.fileId)"
              >
                <XIcon />
              </Button>
            </span>
          </li>
        </ul>
        <p class="text-muted-foreground mt-1.5 text-xs">
          {{ replyFiles.length === 0
            ? `없어도 ${actWord}할 수 있습니다 — 도면·마크업이 있으면 붙여 주세요.`
            : '협력사가 포털 발주 상세에서 내려받습니다. 메일에도 첨부 사실이 안내됩니다.' }}
        </p>
      </div>

      <p v-if="localError !== ''" class="text-destructive text-sm font-medium">{{ localError }}</p>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">취소</Button>
        <Button variant="destructive" :disabled="!canSubmit" @click="emit('confirm', reason.trim())">
          {{ submitLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
