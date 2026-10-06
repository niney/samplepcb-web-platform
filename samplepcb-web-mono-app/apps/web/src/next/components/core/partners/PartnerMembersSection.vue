<script setup lang="ts">
import { ref, watch } from 'vue';
import { UnlinkIcon } from '@lucide/vue';
import type { AdminPartnerDetailType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAddPartnerMember, useRemovePartnerMember } from '@/admin/useAdminPartners';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { Item } from '@/next/components/ui/item';

// 연결 계정 — 로그인·포털 회신 가능 주체. 회원 ID(mb_id)를 owner 로 연결하고 해제한다(옛 화면과 같은 요청).
// 상세가 다시 오면(저장·연결 뒤 재조회 포함) 입력·오류를 비운다 — 옛 화면의 상세 watch 와 같은 동작.
const props = defineProps<{ detail: AdminPartnerDetailType }>();

const memberMbId = ref('');
const memberError = ref('');
const addMemberMut = useAddPartnerMember();
const removeMemberMut = useRemovePartnerMember();

watch(
  () => props.detail,
  () => {
    memberMbId.value = '';
    memberError.value = '';
  },
);

async function addMember(): Promise<void> {
  memberError.value = '';
  const mbId = memberMbId.value.trim();
  if (mbId === '') {
    memberError.value = '연결할 회원 ID(mb_id)를 입력해 주세요.';
    return;
  }
  try {
    await addMemberMut.mutateAsync({ partnerId: props.detail.partnerId, body: { mbId, role: 'owner' } });
    memberMbId.value = '';
  } catch (e) {
    memberError.value = e instanceof ApiRequestError ? e.message : '연결에 실패했습니다.';
  }
}

async function removeMember(mbId: string): Promise<void> {
  memberError.value = '';
  try {
    await removeMemberMut.mutateAsync({ partnerId: props.detail.partnerId, mbId });
  } catch (e) {
    memberError.value = e instanceof ApiRequestError ? e.message : '해제에 실패했습니다.';
  }
}
</script>

<template>
  <SectionCard :title="`연결 계정 (${String(detail.members.length)})`">
    <template #meta>로그인·포털 회신 가능 주체</template>

    <div v-if="detail.members.length > 0" class="flex flex-col gap-1.5">
      <Item v-for="m in detail.members" :key="m.mbId" variant="outline" size="xs">
        <Badge variant="secondary"><span class="font-mono">{{ m.role }}</span></Badge>
        <span class="min-w-0 flex-1 truncate text-sm">{{ m.mbId }}</span>
        <Button
          variant="ghost"
          size="xs"
          :disabled="removeMemberMut.isPending.value"
          @click="void removeMember(m.mbId)"
        >
          <UnlinkIcon class="text-destructive" />
          <span class="text-destructive">해제</span>
        </Button>
      </Item>
    </div>
    <p v-else class="text-muted-foreground text-sm">
      연결 계정 없음{{ detail.type === 'supplier' ? ' (API 공급사)' : '' }}
    </p>

    <div class="flex items-center gap-2">
      <Input
        v-model="memberMbId"
        type="text"
        placeholder="회원 ID(mb_id) 입력"
        aria-label="연결할 회원 ID"
        class="flex-1"
        @keyup.enter="void addMember()"
      />
      <Button variant="secondary" :disabled="addMemberMut.isPending.value" @click="void addMember()">연결</Button>
    </div>
    <p v-if="memberError !== ''" role="alert" class="text-destructive text-sm font-medium">{{ memberError }}</p>
  </SectionCard>
</template>
