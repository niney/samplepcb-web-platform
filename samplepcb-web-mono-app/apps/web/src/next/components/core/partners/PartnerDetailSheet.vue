<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { PARTNER_STATUS_LABELS, PARTNER_TYPE_LABELS } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { ExternalLinkIcon } from '@lucide/vue';
import { partnerPortalActAsUrl, useAdminPartnerDetail, useUpdatePartner } from '@/admin/useAdminPartners';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/next/components/ui/sheet';
import { Spinner } from '@/next/components/ui/spinner';
import PartnerActLogSection from './PartnerActLogSection.vue';
import PartnerFormFields from './PartnerFormFields.vue';
import PartnerMembersSection from './PartnerMembersSection.vue';
import PartnerRelationsSection from './PartnerRelationsSection.vue';
import PartnerStatusSection from './PartnerStatusSection.vue';
import { emptyPartnerForm, partnerFormFromDetail, partnerStatusVariant, partnerUpdateBody } from './partner-form';

// 파트너 상세 서랍 — 옛 AdminPartners.vue 의 상세 드로어. 조직 정보 수정 → 연결 계정 → 마스터딜러 소속(사람
// 협력사만) → 상태 처리 순서. partnerId 가 null 이면 닫힌다(옛 selectedId 와 같은 규약).
const props = defineProps<{ partnerId: number | null }>();
const emit = defineEmits<{ close: [] }>();

const partnerIdRef = computed(() => props.partnerId);
const detailQ = useAdminPartnerDetail(partnerIdRef);
// 다른 조직을 열었는데 앞 조직 상세가 남아 그려지지 않게 id 를 맞춰 본다.
const detail = computed(() => {
  const d = detailQ.data.value?.data;
  return d?.partnerId === props.partnerId ? d : undefined;
});

const editForm = ref(emptyPartnerForm());
const editError = ref('');
const updateMut = useUpdatePartner();

watch(detail, (d) => {
  if (d === undefined) return;
  editForm.value = partnerFormFromDetail(d);
  editError.value = '';
});

async function submitUpdate(): Promise<void> {
  if (props.partnerId === null) return;
  editError.value = '';
  if (detail.value?.status === 'approved' && editForm.value.type === 'partner' && editForm.value.country.trim() === '') {
    editError.value = '승인 협력사는 국가(ISO 2)를 입력해 주세요.';
    return;
  }
  try {
    await updateMut.mutateAsync({ partnerId: props.partnerId, body: partnerUpdateBody(editForm.value) });
  } catch (e) {
    editError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
</script>

<template>
  <Sheet :open="partnerId !== null" @update:open="onOpenChange">
    <SheetContent side="right" class="w-full sm:max-w-xl">
      <div class="flex h-full min-h-0 flex-col">
        <header class="shrink-0 border-b px-5 py-3 pr-12">
          <SheetTitle>파트너 상세</SheetTitle>
          <SheetDescription class="mt-0.5">조직 정보·연결 계정·상태를 고칩니다.</SheetDescription>
        </header>

        <div v-if="detail === undefined" class="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
          <Spinner />
          불러오는 중…
        </div>
        <!-- 스크롤 상자와 쌓기 상자를 나눈다 — 한 상자에 겹치면 섹션이 높이를 빼앗겨 찌그러진다. -->
        <div v-else class="min-h-0 flex-1 overflow-y-auto">
          <div class="flex flex-col gap-4 p-5">
            <div class="flex flex-col gap-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-base font-semibold">{{ detail.name }}</span>
                <Badge :variant="partnerStatusVariant(detail.status)">{{ PARTNER_STATUS_LABELS[detail.status] }}</Badge>
                <span class="text-muted-foreground text-xs">{{ PARTNER_TYPE_LABELS[detail.type] }}</span>
              </div>
              <p v-if="detail.statusReason !== null" class="text-destructive text-xs">사유: {{ detail.statusReason }}</p>
              <!-- 감독 표시 — 마스터딜러가 포털에서 직접 등록한 조직은 승인 절차 없이 쓰인다(사후 감독). -->
              <p v-if="detail.ownerPartnerId !== null" class="text-info text-xs" data-testid="partner-owner-note">
                마스터딜러 등록 — {{ detail.ownerPartnerName ?? `조직 #${String(detail.ownerPartnerId)}` }}이(가) 포털에서 직접 등록했습니다<template v-if="detail.createdBy !== null"> (계정 {{ detail.createdBy }})</template>.
                <template v-if="detail.ownerSuspended"> 지금은 그 조직이 사용 중지한 상태입니다.</template>
              </p>
              <p v-if="detail.duplicates.length > 0" class="text-warning text-xs">
                같은 회사로 보이는 협력사:
                <template v-for="(dup, i) in detail.duplicates" :key="dup.partnerId">
                  <template v-if="i > 0">, </template>{{ dup.name }}({{ dup.matchedBy === 'businessNo' ? '사업자번호' : '이메일' }} 일치)
                </template>
              </p>
              <!-- 관리자 대리 접속 — 이 조직의 포털을 관리자가 연다(계정 없는 조직도 열린다, 새 탭). -->
              <div v-if="detail.type === 'partner'" class="flex flex-wrap items-center gap-2 pt-1">
                <Button as-child variant="outline" size="sm">
                  <a :href="partnerPortalActAsUrl(detail.partnerId)" target="_blank" rel="noopener" data-testid="partner-act-as">
                    <ExternalLinkIcon />
                    포털로 보기
                  </a>
                </Button>
                <span class="text-muted-foreground text-xs">이 조직의 자리에서 포털을 엽니다 — 한 일은 관리자 대행으로 기록됩니다.</span>
              </div>
            </div>

            <SectionCard title="조직 정보">
              <PartnerFormFields v-model="editForm" mode="edit" id-prefix="partner-edit" />
              <p v-if="editError !== ''" role="alert" class="text-destructive text-sm font-medium">{{ editError }}</p>
              <div class="flex justify-end">
                <Button variant="outline" :disabled="updateMut.isPending.value" @click="void submitUpdate()">정보 저장</Button>
              </div>
            </SectionCard>

            <PartnerMembersSection :detail="detail" />
            <PartnerRelationsSection v-if="detail.type === 'partner'" :detail="detail" />
            <PartnerActLogSection :detail="detail" />
            <PartnerStatusSection :detail="detail" @deleted="emit('close')" />
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
