<script setup lang="ts">
import { ref, watch } from 'vue';
import { Trash2Icon } from '@lucide/vue';
import type { AdminPartnerDetailType, PartnerStatusType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useDeletePartner, usePartnerStatus } from '@/admin/useAdminPartners';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { confirmDialog } from '@/next/lib/dialog';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';

// 상태 처리 — 승인·정지(사유 필수)·정지 해제와 오기 정리용 삭제. 요청 본문·가드는 옛 화면과 같다:
// 사람 협력사는 국가가 저장돼 있어야 승인, 정지는 사유가 있어야 보낸다. 삭제 성공은 deleted 로 알린다.
const props = defineProps<{ detail: AdminPartnerDetailType }>();
const emit = defineEmits<{ deleted: [] }>();

const statusMut = usePartnerStatus();
const deleteMut = useDeletePartner();
const statusReason = ref('');
const statusError = ref('');

watch(
  () => props.detail,
  () => {
    statusReason.value = '';
  },
);

async function changeStatus(status: PartnerStatusType): Promise<void> {
  statusError.value = '';
  if (status === 'suspended' && statusReason.value.trim() === '') {
    statusError.value = '정지 사유를 입력해 주세요.';
    return;
  }
  if (status === 'approved' && props.detail.type === 'partner' && (props.detail.country ?? '').trim() === '') {
    statusError.value = '조직 정보에서 국가를 저장한 뒤 승인해 주세요.';
    return;
  }
  try {
    await statusMut.mutateAsync({
      partnerId: props.detail.partnerId,
      body: { status, ...(status === 'suspended' ? { reason: statusReason.value.trim() } : {}) },
    });
    statusReason.value = '';
  } catch (e) {
    statusError.value = e instanceof ApiRequestError ? e.message : '처리에 실패했습니다.';
  }
}

async function removePartner(): Promise<void> {
  if (
    !(await confirmDialog({
      message: `${props.detail.name}을(를) 삭제할까요?\n오기 정리용입니다 — 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  ) {
    return;
  }
  statusError.value = '';
  try {
    await deleteMut.mutateAsync(props.detail.partnerId);
    emit('deleted');
  } catch (e) {
    // 서버 안내문(payload.message)만 보인다 — Prisma 원문 등 내부 오류 문자열을 그대로 그리지 않는다.
    statusError.value =
      e instanceof ApiRequestError ? (e.payload?.message ?? '삭제에 실패했습니다.') : '삭제에 실패했습니다.';
  }
}
</script>

<template>
  <SectionCard title="상태 처리">
    <Input
      v-if="detail.status !== 'suspended'"
      v-model="statusReason"
      type="text"
      placeholder="정지 사유 (정지 시 필수)"
      aria-label="정지 사유"
    />
    <p v-if="statusError !== ''" role="alert" class="text-destructive text-sm font-medium">{{ statusError }}</p>
    <div class="flex flex-wrap gap-2">
      <Button
        v-if="detail.status === 'pending'"
        variant="success"
        :disabled="statusMut.isPending.value"
        @click="void changeStatus('approved')"
      >
        승인
      </Button>
      <Button
        v-if="detail.status !== 'suspended'"
        variant="destructive"
        :disabled="statusMut.isPending.value"
        @click="void changeStatus('suspended')"
      >
        정지
      </Button>
      <Button
        v-if="detail.status === 'suspended'"
        variant="success"
        :disabled="statusMut.isPending.value"
        @click="void changeStatus('approved')"
      >
        정지 해제
      </Button>
      <Button variant="outline" class="ml-auto" :disabled="deleteMut.isPending.value" @click="void removePartner()">
        <Trash2Icon class="text-destructive" />
        삭제
      </Button>
    </div>
    <p class="text-muted-foreground text-xs">삭제는 RFQ 이력이 없는 오기 정리용입니다 — 운영 배제는 정지를 사용하세요.</p>
  </SectionCard>
</template>
