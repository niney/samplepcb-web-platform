<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
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
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Textarea } from '@/next/components/ui/textarea';
import {
  pendingPrompt,
  settlePrompt,
  type PromptField,
  type PromptOptions,
} from '@/next/lib/dialog';

// promptDialog() 요청을 그리는 단 하나의 호스트 — 옛 components/ui/UiPromptModal.vue 의 동작을 그대로:
//   · 필수값이 채워질 때까지 확인 버튼을 잠근다
//   · select 는 선택지 + '직접입력'(allowCustom=false 면 막음). 초깃값이 목록 밖이면 직접입력으로 연다
//   · Enter 는 줄바꿈·입력이고 확인은 Ctrl/⌘+Enter, Esc 는 취소
//   · 제출값은 앞뒤 공백을 걷어낸다
//   · submit 이 있으면 연 채로 저장하고, 실패하면 입력을 그대로 둔 채 오류를 보여 준다(저장 중엔 닫히지 않음)
// select 는 브라우저 기본 select(NativeSelect)다 — 옛 화면 e2e 의 selectOption 이 그대로 통한다.

// select 의 '직접입력' 갈래 — 셀렉트 자체를 values 에 물리면 센티널이 제출값에 새므로 선택
// 상태는 따로 들고 values 에는 최종 문자열만 둔다.
const SELECT_CUSTOM = '__custom__';

const shown = ref<PromptOptions | null>(null);
const values = ref<Record<string, string>>({});
const selectChoices = ref<Record<string, string>>({});
const busy = ref(false);
const submitError = ref('');

watch(pendingPrompt, (current) => {
  if (current === null) return;
  shown.value = current;
  busy.value = false;
  submitError.value = '';
  values.value = Object.fromEntries(current.fields.map((field) => [field.name, field.value ?? '']));
  selectChoices.value = Object.fromEntries(
    current.fields
      .filter((field) => field.type === 'select')
      .map((field) => {
        const value = field.value ?? '';
        return [field.name, value !== '' && !(field.options ?? []).includes(value) ? SELECT_CUSTOM : value];
      }),
  );
});

const open = computed(() => pendingPrompt.value !== null);
const fields = computed<readonly PromptField[]>(() => shown.value?.fields ?? []);
const canConfirm = computed(() =>
  fields.value.every((field) => field.required !== true || (values.value[field.name] ?? '').trim() !== ''),
);

const fieldId = (field: PromptField): string => `next-prompt-${field.name}`;

function onOpenChange(value: boolean): void {
  if (!value && !busy.value) settlePrompt(null);
}

function setValue(field: PromptField, value: string | number): void {
  values.value[field.name] = String(value);
}

function onSelectEvent(field: PromptField, event: Event): void {
  onSelectChange(field, event.target instanceof HTMLSelectElement ? event.target.value : '');
}

function onSelectChange(field: PromptField, choice: string): void {
  selectChoices.value[field.name] = choice;
  values.value[field.name] = choice === SELECT_CUSTOM ? '' : choice;
}

async function submit(): Promise<void> {
  const pending = pendingPrompt.value;
  if (!canConfirm.value || pending === null || busy.value) return;
  const result = Object.fromEntries(fields.value.map((field) => [field.name, (values.value[field.name] ?? '').trim()]));
  if (pending.submit !== undefined) {
    busy.value = true;
    submitError.value = '';
    try {
      await pending.submit(result);
    } catch (e) {
      submitError.value =
        e instanceof ApiRequestError && e.message !== '' ? e.message : (pending.errorFallback ?? '처리에 실패했습니다.');
      return;
    } finally {
      busy.value = false;
    }
  }
  settlePrompt(result);
}

function onKeydown(event: KeyboardEvent): void {
  // 여러 줄 입력 중에는 Enter 가 줄바꿈이어야 한다 — 확인은 Ctrl/⌘+Enter.
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent v-if="shown !== null" @keydown="onKeydown">
      <DialogHeader>
        <DialogTitle>{{ shown.title }}</DialogTitle>
        <DialogDescription v-if="shown.description !== undefined && shown.description !== ''">
          {{ shown.description }}
        </DialogDescription>
      </DialogHeader>

      <div class="grid gap-4">
        <Field v-for="field in fields" :key="field.name">
          <FieldLabel :for="fieldId(field)">
            {{ field.label }}
            <span v-if="field.required === true" class="text-destructive">*</span>
          </FieldLabel>
          <Textarea
            v-if="field.type === 'textarea'"
            :id="fieldId(field)"
            :model-value="values[field.name] ?? ''"
            rows="3"
            :maxlength="field.maxlength ?? 2000"
            :placeholder="field.placeholder"
            @update:model-value="(value: string | number) => setValue(field, value)"
          />
          <template v-else-if="field.type === 'select'">
            <NativeSelect
              :id="fieldId(field)"
              :model-value="selectChoices[field.name] ?? ''"
              @change="(event: Event) => onSelectEvent(field, event)"
            >
              <NativeSelectOption value="">{{ field.required === true ? '선택' : '선택 안 함' }}</NativeSelectOption>
              <NativeSelectOption v-for="option in field.options ?? []" :key="option" :value="option">
                {{ option }}
              </NativeSelectOption>
              <NativeSelectOption v-if="field.allowCustom !== false" :value="SELECT_CUSTOM">직접입력</NativeSelectOption>
            </NativeSelect>
            <Input
              v-if="selectChoices[field.name] === SELECT_CUSTOM"
              :model-value="values[field.name] ?? ''"
              type="text"
              :maxlength="field.maxlength ?? 200"
              :placeholder="field.placeholder ?? '직접 입력'"
              :aria-label="`${field.label} 직접 입력`"
              @update:model-value="(value: string | number) => setValue(field, value)"
            />
          </template>
          <Input
            v-else
            :id="fieldId(field)"
            :model-value="values[field.name] ?? ''"
            :type="field.type === 'date' ? 'date' : 'text'"
            :maxlength="field.maxlength ?? 200"
            :placeholder="field.placeholder"
            @update:model-value="(value: string | number) => setValue(field, value)"
          />
          <FieldDescription v-if="field.hint !== undefined">{{ field.hint }}</FieldDescription>
        </Field>
      </div>

      <p v-if="submitError !== ''" role="alert" class="text-destructive text-sm">{{ submitError }}</p>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="settlePrompt(null)">취소</Button>
        <Button
          :variant="shown.tone === 'danger' ? 'destructive' : 'default'"
          :disabled="!canConfirm || busy"
          @click="submit"
        >
          {{ shown.confirmLabel ?? '확인' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
