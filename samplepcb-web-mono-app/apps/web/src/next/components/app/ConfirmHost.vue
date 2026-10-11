<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/next/components/ui/alert-dialog';
import { Button } from '@/next/components/ui/button';
import { pendingConfirm, settleConfirm, type ConfirmOptions } from '@/next/lib/dialog';

// confirmDialog() 요청을 그리는 단 하나의 호스트 — AdminNextLayout 에 한 번만 둔다.
// Esc 는 취소. 첫 포커스는 일반 확인이면 확인 버튼(Enter 로 그대로 진행 — 옛 호스트와 같다),
// danger 면 취소 버튼(되돌리기 어려운 조작을 Enter 한 번에 하지 않게).
// 닫히는 애니메이션 동안 글이 비지 않도록 마지막 요청을 shown 에 붙잡아 둔다.
const shown = ref<ConfirmOptions | null>(null);
// 요청마다 포털을 새로 붙인다 — 대화상자들은 z-index 가 같아 body 안의 순서로 쌓이는데, 포털은 처음 붙은 자리에
// 머문다. 그래서 확인창을 한 번 쓴 뒤에 열린 Dialog(v-if 로 그때 붙는 것) 안에서 물으면 확인창이 그 Dialog
// **아래**에 깔려 보이지도 눌리지도 않았다(EQ 대리 회신 창에서 실측). 키를 바꿔 매번 맨 뒤에 붙인다.
const seq = ref(0);
watch(pendingConfirm, (current) => {
  if (current === null) return;
  shown.value = current;
  seq.value += 1;
});

const open = computed(() => pendingConfirm.value !== null);
const onOpenChange = (value: boolean): void => {
  if (!value) settleConfirm(false);
};

function onOpenAutoFocus(event: Event): void {
  if (shown.value?.tone === 'danger') return;
  event.preventDefault();
  document.querySelector<HTMLElement>('[data-next-confirm-action]')?.focus();
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent v-if="shown !== null" :key="seq" @open-auto-focus="onOpenAutoFocus">
      <AlertDialogHeader>
        <AlertDialogTitle :class="shown.title === undefined ? 'sr-only' : undefined">
          {{ shown.title ?? '확인' }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          <span class="whitespace-pre-line">{{ shown.message }}</span>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <Button variant="outline" @click="settleConfirm(false)">{{ shown.cancelLabel ?? '취소' }}</Button>
        <Button
          :variant="shown.tone === 'danger' ? 'destructive' : 'default'"
          data-next-confirm-action
          @click="settleConfirm(true)"
        >
          {{ shown.confirmLabel ?? '확인' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
