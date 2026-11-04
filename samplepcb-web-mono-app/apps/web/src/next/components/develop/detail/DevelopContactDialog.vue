<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { DevelopContact, developContactChanges, normalizeDevelopContact } from '@sp/api-contract';
import type { DevelopContactFieldType, DevelopContactType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import { usePatchAdminDevelop } from '@/admin/useAdminDevelop';
import { Button } from '@/next/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogScrollContent, DialogTitle } from '@/next/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';

// 의뢰 연락처 고치기(관리자, docs/DEVELOP_FLOW.md §7.3) — 고객은 접수·검토 중에만 고치지만 관리자는 상태와 상관없이 고친다
// (담당자 교체·오타). 검사는 등록과 같은 계약 스키마(DevelopContact)라 서버 400 과 어긋나지 않는다. 바뀐 칸이 없으면 저장을
// 막는다(타임라인에 빈 기록이 남지 않게). 알림 메일은 보내지 않고, 다음 알림부터 새 이메일로 간다. 부모가 v-if 로 마운트한다.
const props = defineProps<{ requestId: number; contact: DevelopContactType }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const { t } = useI18n();
const patch = usePatchAdminDevelop();

const form = ref({
  name: props.contact.name,
  company: props.contact.company ?? '',
  phone: props.contact.phone,
  email: props.contact.email,
  hours: props.contact.hours ?? '',
});
const draft = computed(
  (): DevelopContactType =>
    normalizeDevelopContact({
      name: form.value.name,
      company: form.value.company,
      phone: form.value.phone,
      email: form.value.email,
      hours: form.value.hours,
    }),
);
const changes = computed(() => developContactChanges(props.contact, draft.value));
const parsed = computed(() => DevelopContact.safeParse(draft.value));
// 칸 오류는 저장을 한 번 누른 뒤부터 보인다(적는 중에 빨간 글씨가 먼저 뜨지 않게).
const tried = ref(false);
const error = ref('');

const ERROR_KEYS: Record<DevelopContactFieldType, string> = {
  name: 'admin.develop.content.contactErrName',
  company: 'admin.develop.content.contactErrLength',
  phone: 'admin.develop.content.contactErrPhone',
  email: 'admin.develop.content.contactErrEmail',
  hours: 'admin.develop.content.contactErrLength',
};
const fieldError = (field: DevelopContactFieldType): string => {
  if (!tried.value || parsed.value.success) return '';
  return parsed.value.error.issues.some((issue) => issue.path[0] === field) ? t(ERROR_KEYS[field]) : '';
};

async function onSave(): Promise<void> {
  tried.value = true;
  error.value = '';
  if (!parsed.value.success || changes.value.length === 0) return;
  try {
    await patch.mutateAsync({ requestId: props.requestId, body: { contact: parsed.value.data } });
    emit('saved');
    emit('close');
  } catch (e) {
    error.value = apiErrorMessage(e, t('admin.develop.content.contactSaveFail'));
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogScrollContent class="sm:max-w-[520px]" data-testid="develop-contact-dialog">
      <DialogHeader>
        <DialogTitle>{{ t('admin.develop.content.contactEdit') }}</DialogTitle>
        <DialogDescription>{{ t('admin.develop.content.contactEditHint') }}</DialogDescription>
      </DialogHeader>
      <form class="grid gap-3" @submit.prevent="onSave">
        <Field>
          <FieldLabel for="develop-contact-name">{{ t('admin.develop.content.contactFieldName') }}</FieldLabel>
          <Input id="develop-contact-name" v-model="form.name" autocomplete="off" :maxlength="100" />
          <FieldError v-if="fieldError('name') !== ''">{{ fieldError('name') }}</FieldError>
        </Field>
        <Field>
          <FieldLabel for="develop-contact-company">{{ t('admin.develop.content.contactFieldCompany') }}</FieldLabel>
          <Input id="develop-contact-company" v-model="form.company" autocomplete="off" :maxlength="200" />
          <FieldError v-if="fieldError('company') !== ''">{{ fieldError('company') }}</FieldError>
        </Field>
        <Field>
          <FieldLabel for="develop-contact-phone">{{ t('admin.develop.content.contactFieldPhone') }}</FieldLabel>
          <Input id="develop-contact-phone" v-model="form.phone" type="tel" autocomplete="off" :maxlength="50" class="tabular-nums" />
          <FieldError v-if="fieldError('phone') !== ''">{{ fieldError('phone') }}</FieldError>
        </Field>
        <Field>
          <FieldLabel for="develop-contact-email">{{ t('admin.develop.content.contactFieldEmail') }}</FieldLabel>
          <Input id="develop-contact-email" v-model="form.email" type="email" autocomplete="off" :maxlength="191" />
          <FieldError v-if="fieldError('email') !== ''">{{ fieldError('email') }}</FieldError>
        </Field>
        <Field>
          <FieldLabel for="develop-contact-hours">{{ t('admin.develop.content.contactFieldHours') }}</FieldLabel>
          <Input id="develop-contact-hours" v-model="form.hours" autocomplete="off" :maxlength="100" />
          <FieldError v-if="fieldError('hours') !== ''">{{ fieldError('hours') }}</FieldError>
        </Field>
        <p v-if="error !== ''" role="alert" class="text-destructive text-sm">{{ error }}</p>
        <DialogFooter>
          <span v-if="changes.length === 0" class="text-muted-foreground mr-auto self-center text-xs">
            {{ t('admin.develop.content.contactUnchanged') }}
          </span>
          <Button type="button" variant="outline" @click="emit('close')">{{ t('admin.develop.content.contactCancel') }}</Button>
          <Button type="submit" :disabled="patch.isPending.value || changes.length === 0">
            {{ patch.isPending.value ? t('admin.develop.saving') : t('admin.develop.content.contactSave') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogScrollContent>
  </Dialog>
</template>
