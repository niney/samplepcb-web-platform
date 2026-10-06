<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { ApiRequestError, apiSend } from '@sp/shared';
import {
  BomEstimateContactResponse,
  BomEstimateContactUpdate,
  type BomEstimateContactUpdateType,
} from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import SaveRow from '../SaveRow.vue';
import { BOM_CONTACT_KEY, BOM_CONTACT_PATH, useBomEstimateContact } from './bom-quote-settings';

// 견적서 담당자 — Smart BOM 견적서의 담당·이메일(옛 BomQuoteSettingsForm 첫 섹션, 따로 저장).
// '사업자정보의 정보관리책임자 사용'이면 빈 값을 저장해 공통 정보를 따른다. 저장 본문·검증은 옛 화면과 같다.
const qc = useQueryClient();
const contactQuery = useBomEstimateContact();

const contactForm = ref<BomEstimateContactUpdateType | null>(null);
const useBusinessInfoContact = ref(true);
const contactSaved = ref(false);
const contactError = ref('');

const fallbackContact = computed(() => contactQuery.data.value?.fallback ?? null);
const effectiveContact = computed(() => contactQuery.data.value?.effective ?? null);
const contactValidationError = computed(() => {
  if (contactForm.value === null || useBusinessInfoContact.value) return '';
  const managerName = contactForm.value.managerName.trim();
  const managerEmail = contactForm.value.managerEmail.trim();
  if (managerName === '' || managerEmail === '') {
    return '전용 담당자를 사용하려면 담당자명과 이메일을 모두 입력해 주세요.';
  }
  const parsed = BomEstimateContactUpdate.safeParse({ managerName, managerEmail });
  return parsed.success ? '' : (parsed.error.issues[0]?.message ?? '담당자 정보를 확인해 주세요.');
});

watch(
  () => contactQuery.data.value?.data,
  (data) => {
    if (data === undefined || contactForm.value !== null) return;
    contactForm.value = { ...data };
    useBusinessInfoContact.value = data.managerName === '' && data.managerEmail === '';
  },
  { immediate: true },
);

const saveContact = useMutation({
  mutationFn: (body: BomEstimateContactUpdateType) => apiSend('PUT', BOM_CONTACT_PATH, body, BomEstimateContactResponse),
  onSuccess: (res) => {
    contactForm.value = { ...res.data };
    useBusinessInfoContact.value = res.data.managerName === '' && res.data.managerEmail === '';
    contactSaved.value = true;
    qc.setQueryData(BOM_CONTACT_KEY, res);
    setTimeout(() => (contactSaved.value = false), 2_000);
  },
  onError: (reason: unknown) => {
    contactError.value = reason instanceof ApiRequestError ? reason.message : 'BOM 담당자 저장에 실패했습니다.';
  },
});

function toggleBusinessInfoContact(value: boolean | 'indeterminate'): void {
  const checked = value === true;
  useBusinessInfoContact.value = checked;
  contactError.value = '';
  if (checked) {
    contactForm.value = { managerName: '', managerEmail: '' };
    return;
  }
  const seed = contactQuery.data.value?.effective ?? contactQuery.data.value?.fallback;
  contactForm.value = {
    managerName: seed?.managerName ?? '',
    managerEmail: seed?.managerEmail ?? '',
  };
}

function submitContact(): void {
  if (contactForm.value === null || contactValidationError.value !== '') return;
  contactError.value = '';
  const body = useBusinessInfoContact.value ? { managerName: '', managerEmail: '' } : contactForm.value;
  const parsed = BomEstimateContactUpdate.safeParse(body);
  if (!parsed.success) {
    contactError.value = parsed.error.issues[0]?.message ?? '담당자 정보를 확인해 주세요.';
    return;
  }
  saveContact.mutate(parsed.data);
}
</script>

<template>
  <SectionCard title="견적서 담당자">
    <template #meta>
      <Badge v-if="contactForm !== null" :variant="useBusinessInfoContact ? 'secondary' : 'info'">
        {{ useBusinessInfoContact ? '공통 정보 사용' : 'BOM 전용' }}
      </Badge>
    </template>

    <p class="text-muted-foreground text-sm">
      고객·관리자 Smart BOM 견적서의 담당·이메일에만 적용합니다. PCB 견적, 주문 문서, 협력사 알림에는 영향이 없습니다.
    </p>

    <p v-if="contactQuery.isLoading.value" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
      <Spinner />
      담당자 정보를 불러오는 중…
    </p>
    <Alert v-else-if="contactQuery.isError.value" variant="destructive" size="sm">
      <AlertDescription>담당자 정보를 불러오지 못했습니다.</AlertDescription>
    </Alert>
    <template v-else-if="contactForm !== null">
      <FieldLabel for="bom-contact-use-business">
        <Field orientation="horizontal">
          <Checkbox
            id="bom-contact-use-business"
            :model-value="useBusinessInfoContact"
            @update:model-value="toggleBusinessInfoContact"
          />
          <FieldContent>
            <FieldTitle>사업자정보의 정보관리책임자 사용</FieldTitle>
            <FieldDescription>선택하면 통합 관리 › 설정 › 사업자정보의 담당자명·이메일을 그대로 사용합니다.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldLabel>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel for="bom-contact-name">BOM 담당자명</FieldLabel>
          <Input
            id="bom-contact-name"
            v-model="contactForm.managerName"
            type="text"
            maxlength="255"
            autocomplete="name"
            :disabled="useBusinessInfoContact"
            :placeholder="fallbackContact?.managerName || '담당자명 입력'"
          />
        </Field>
        <Field>
          <FieldLabel for="bom-contact-email">BOM 담당자 이메일</FieldLabel>
          <Input
            id="bom-contact-email"
            v-model="contactForm.managerEmail"
            type="email"
            maxlength="255"
            autocomplete="email"
            :disabled="useBusinessInfoContact"
            :placeholder="fallbackContact?.managerEmail || 'name@example.com'"
            :aria-invalid="contactValidationError !== '' ? true : undefined"
          />
        </Field>
      </div>

      <Panel tone="muted" class="text-sm">
        <p class="text-muted-foreground text-xs font-semibold">현재 견적서 표시</p>
        <p class="mt-1 font-medium">
          {{ effectiveContact?.managerName || '담당자 미설정' }}
          <template v-if="effectiveContact?.managerEmail"> · {{ effectiveContact.managerEmail }}</template>
        </p>
        <p v-if="useBusinessInfoContact" class="text-muted-foreground mt-1 text-xs">
          사업자정보 변경 시 다음 견적서부터 함께 반영됩니다.
        </p>
      </Panel>

      <p v-if="contactValidationError !== ''" class="text-destructive text-sm">{{ contactValidationError }}</p>
      <SaveRow
        type="button"
        label="담당자 저장"
        saved-text="담당자 설정이 저장되었습니다."
        :pending="saveContact.isPending.value"
        :disabled="contactValidationError !== ''"
        :saved="contactSaved"
        :error="contactError"
        @click="submitContact"
      />
    </template>
  </SectionCard>
</template>
