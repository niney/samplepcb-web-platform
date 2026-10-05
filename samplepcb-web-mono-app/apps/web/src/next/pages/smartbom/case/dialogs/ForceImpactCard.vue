<script setup lang="ts">
import { TriangleAlertIcon } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/next/components/ui/field';

// 관리자 강제 적용 칸 — 부품 추가·제거·변경 확인 대화상자 셋이 같은 모양으로 쓴다. 강제 사유 + 영향 목록(슬롯)
// + 영향 확인 체크(선택 카드). 체크 전에는 부모의 적용 버튼이 잠긴다.
const props = defineProps<{ title: string; reason: string | null; checkId: string; checkLabel: string }>();
const confirmed = defineModel<boolean>('confirmed', { required: true });

const onCheck = (value: boolean | 'indeterminate'): void => {
  confirmed.value = value === true;
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <Alert variant="destructive" size="sm">
      <TriangleAlertIcon />
      <AlertTitle>{{ props.title }}</AlertTitle>
      <AlertDescription>
        <p v-if="props.reason !== null">{{ props.reason }}</p>
        <ul class="mt-1 list-disc space-y-1 pl-4">
          <slot />
        </ul>
      </AlertDescription>
    </Alert>
    <FieldLabel :for="props.checkId">
      <Field orientation="horizontal">
        <Checkbox :id="props.checkId" :model-value="confirmed" @update:model-value="onCheck" />
        <FieldContent>
          <FieldTitle><span class="text-destructive">{{ props.checkLabel }}</span></FieldTitle>
        </FieldContent>
      </Field>
    </FieldLabel>
  </div>
</template>
