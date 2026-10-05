<script setup lang="ts">
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import { useSmartbomCaseContext } from '../useSmartbomCase';

// 회신 이메일 재발송 — 상태를 바꾸지 않는 별도 명령(회신 상태·완료 시각 불변).
const { detail, sendAnswerEmail, resendEmailOpen, resendEmail, resendEmailError, resendEmailValid, resendAnswerEmail } =
  useSmartbomCaseContext();

const onOpenChange = (open: boolean): void => {
  if (!open && !sendAnswerEmail.isPending.value) resendEmailOpen.value = false;
};
</script>

<template>
  <Dialog :open="resendEmailOpen && detail !== null" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>회신 이메일 다시 보내기</DialogTitle>
        <DialogDescription>
          현재 확정 금액과 회신 메모로 공식 회신 이메일을 다시 보냅니다. 회신 상태와 완료 시각은 변경되지 않습니다.
        </DialogDescription>
      </DialogHeader>

      <Field :data-invalid="!resendEmailValid || undefined">
        <FieldLabel for="bom-resend-email">받는 이메일</FieldLabel>
        <Input
          id="bom-resend-email"
          v-model="resendEmail"
          type="email"
          inputmode="email"
          autocomplete="off"
          placeholder="customer@example.com"
          :aria-invalid="!resendEmailValid || undefined"
          :disabled="sendAnswerEmail.isPending.value"
        />
        <FieldDescription>고객 회원정보의 이메일이 기본값입니다. 수정해도 이번 재발송에만 적용됩니다.</FieldDescription>
        <FieldError v-if="!resendEmailValid">올바른 받는 이메일 주소를 입력해 주세요.</FieldError>
      </Field>
      <Alert v-if="resendEmailError !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ resendEmailError }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="sendAnswerEmail.isPending.value" @click="resendEmailOpen = false">취소</Button>
        <Button :disabled="sendAnswerEmail.isPending.value || !resendEmailValid" @click="void resendAnswerEmail()">
          <Spinner v-if="sendAnswerEmail.isPending.value" />
          {{ sendAnswerEmail.isPending.value ? '발송 중…' : '이메일 다시 보내기' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
