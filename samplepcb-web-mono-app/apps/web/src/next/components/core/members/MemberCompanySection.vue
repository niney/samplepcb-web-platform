<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminMemberDetailType } from '@sp/api-contract';
import { useSaveMemberProfile } from '@/admin/useAdminMembers';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import SectionCard from '@/next/components/common/SectionCard.vue';

// 회사명(sp 프로필층) 편집+저장. 편집 대상은 프로필층 원값(profileCompanyName) — 해석값(mb_2 fallback)이
// 아니다. 그래야 빈 값 저장이 "프로필 삭제 → mb_2 로 복귀"로 정확히 동작한다.
const props = defineProps<{ detail: AdminMemberDetailType }>();
const { t } = useI18n();
const uid = useId();

const {
  mutate: saveProfile,
  isPending: profilePending,
  isSuccess: profileSaved,
  isError: profileFailed,
  reset: resetProfile,
} = useSaveMemberProfile();

const companyNameInput = ref(props.detail.profileCompanyName ?? '');
const companyNameChanged = computed<boolean>(
  () => companyNameInput.value.trim() !== (props.detail.profileCompanyName ?? ''),
);

const submitCompanyName = (): void => {
  if (!companyNameChanged.value) return;
  resetProfile();
  // 빈 문자열이면 프로필 삭제(서버가 mb_2 fallback 을 반영해 응답)
  saveProfile({ mbId: props.detail.mbId, companyName: companyNameInput.value.trim() });
};
</script>

<template>
  <SectionCard :title="t('admin.members.drawer.companyName')">
    <Input
      :id="`${uid}-company`"
      v-model="companyNameInput"
      type="text"
      :aria-label="t('admin.members.drawer.companyName')"
      @keydown.enter="submitCompanyName"
    />
    <div class="flex flex-wrap items-center gap-2">
      <Button :disabled="!companyNameChanged || profilePending" @click="submitCompanyName">
        {{ t('admin.members.drawer.save') }}
      </Button>
      <span v-if="profileFailed" class="text-destructive text-xs">{{ t('admin.members.drawer.companySaveFailed') }}</span>
      <span v-else-if="profileSaved" class="text-success text-xs">{{ t('admin.members.drawer.companySaveSuccess') }}</span>
    </div>
  </SectionCard>
</template>
