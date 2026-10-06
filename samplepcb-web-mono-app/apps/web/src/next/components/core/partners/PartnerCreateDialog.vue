<script setup lang="ts">
import { ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { useCreatePartner } from '@/admin/useAdminPartners';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import PartnerFormFields from './PartnerFormFields.vue';
import { emptyPartnerForm, partnerCreateBody } from './partner-form';

// 파트너 등록 — 등록하면 즉시 승인 상태로 만들고(옛 화면과 같은 본문), 만든 조직의 상세를 연다(created).
// 입력은 등록에 성공해야 비운다 — 실패하면 고칠 수 있게 그대로 둔다.
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ created: [partnerId: number] }>();

const createForm = ref(emptyPartnerForm());
const createError = ref('');
const createMut = useCreatePartner();

watch(open, (value) => {
  if (value) createError.value = '';
});

async function submitCreate(): Promise<void> {
  createError.value = '';
  if (createForm.value.name.trim() === '') {
    createError.value = '이름(회사명)을 입력해 주세요.';
    return;
  }
  if (createForm.value.type === 'partner' && createForm.value.country.trim() === '') {
    createError.value = '승인 협력사는 국가(ISO 2)를 입력해 주세요.';
    return;
  }
  try {
    const res = await createMut.mutateAsync(partnerCreateBody(createForm.value));
    open.value = false;
    createForm.value = emptyPartnerForm();
    emit('created', res.data.partnerId);
  } catch (e) {
    createError.value = e instanceof ApiRequestError ? e.message : '등록에 실패했습니다.';
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>파트너 등록</DialogTitle>
        <DialogDescription>등록하면 바로 승인 상태가 됩니다.</DialogDescription>
      </DialogHeader>
      <DialogScrollBody>
        <PartnerFormFields v-model="createForm" mode="create" id-prefix="partner-create" />
      </DialogScrollBody>
      <p v-if="createError !== ''" role="alert" class="text-destructive text-sm font-medium">{{ createError }}</p>
      <DialogFooter>
        <Button variant="outline" @click="open = false">취소</Button>
        <Button :disabled="createMut.isPending.value" @click="void submitCreate()">등록(즉시 승인)</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
