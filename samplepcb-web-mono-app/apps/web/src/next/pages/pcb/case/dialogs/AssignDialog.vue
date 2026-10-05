<script setup lang="ts">
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import Panel from '@/next/components/common/Panel.vue';
import { usePcbCaseContext } from '../usePcbCase';

// 협력사 견적요청(배정) — 체크 해제된 미회신 요청은 회수(회신 완료 건은 보존), 신규 협력사에게만 메일.
const { assignOpen, assignCandidates, assignSelected, toggleAssign, assignDate, send, submitAssign } = usePcbCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open) assignOpen.value = false;
};
</script>

<template>
  <Dialog :open="assignOpen" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>협력사 견적요청</DialogTitle>
        <DialogDescription>
          체크 해제된 미회신 요청은 회수됩니다(회신 완료 건은 보존). 신규 협력사에게만 메일이 발송됩니다.
        </DialogDescription>
      </DialogHeader>

      <Panel class="max-h-64 overflow-y-auto">
        <label
          v-for="p in assignCandidates"
          :key="p.partnerId"
          class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm"
        >
          <Checkbox :model-value="assignSelected.has(p.partnerId)" @update:model-value="toggleAssign(p.partnerId)" />
          <span class="flex-1 font-medium">{{ p.name }}</span>
          <span class="text-muted-foreground text-xs">{{ p.defaultCurrency }}<template v-if="p.country !== null"> · {{ p.country }}</template></span>
        </label>
        <p v-if="assignCandidates.length === 0" class="text-muted-foreground px-2 py-4 text-center text-xs">
          PCB 견적(pcb_rfq) 능력이 있는 승인 협력사가 없습니다 —
          <RouterLink :to="{ name: 'admin-partners' }" class="text-primary font-medium hover:underline">파트너 관리</RouterLink>에서
          등록하세요.
        </p>
      </Panel>
      <Field>
        <FieldLabel for="pcb-assign-date">희망 납기(제시일 — 선택)</FieldLabel>
        <Input id="pcb-assign-date" v-model="assignDate" type="date" />
      </Field>

      <DialogFooter>
        <Button variant="outline" @click="assignOpen = false">취소</Button>
        <Button :disabled="send.isPending.value" @click="void submitAssign()">{{ assignSelected.size }}곳으로 발송</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
