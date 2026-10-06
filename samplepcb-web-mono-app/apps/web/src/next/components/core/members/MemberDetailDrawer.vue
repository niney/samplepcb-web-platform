<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ExternalLinkIcon } from '@lucide/vue';
import { useAdminMemberDetail } from '@/admin/useAdminMembers';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/next/components/ui/sheet';
import { Spinner } from '@/next/components/ui/spinner';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { memberStatusVariant, memberTypeLabelKey } from './member-badges';
import MemberCompanySection from './MemberCompanySection.vue';
import MemberContactSection from './MemberContactSection.vue';
import MemberManageSection from './MemberManageSection.vue';
import MemberMemoSection from './MemberMemoSection.vue';
import MemberRecentProjects from './MemberRecentProjects.vue';

// 회원 상세 서랍(옛 MemberDetailDrawer 와 같은 props·emits) — 우측 시트. 기본정보·연락/주소·수신동의·
// 회사명 프로필·레거시 사업자 정보(read-only)·관리자 메모·최근 견적, 그리고 관리 구역(차단·레벨).
// 탈퇴 회원(status='left')은 관리 구역을 통째로 숨긴다. 진짜 경계는 서버 가드(409).
//
// 구역은 회원마다 새로 띄운다(key=mbId) — 편집 중 입력·저장 결과 문구가 다른 회원으로 새지 않는다
// (옛 드로어의 filledFor 리필과 같은 효과). 저장 뒤 같은 회원의 상세가 다시 와도 입력은 유지된다.
const props = defineProps<{ mbId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

// 닫히는 동안(시트 퇴장 애니메이션)에도 내용이 비지 않게 마지막 회원을 붙든다.
const shownMbId = ref<string | null>(props.mbId);
watch(
  () => props.mbId,
  (mbId) => {
    if (mbId !== null) shownMbId.value = mbId;
  },
);
const { data, isLoading } = useAdminMemberDetail(shownMbId);
const detail = computed(() => data.value?.data ?? null);

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// 레거시 사업자 정보 — 값 있는 필드만 표시(라벨 복원)
const businessRows = computed<{ label: string; value: string }[]>(() => {
  const b = detail.value?.legacyBusiness;
  if (b === undefined || b === null) return [];
  const fields: [string, string][] = [
    [b.memberType, 'admin.members.drawer.bizMemberType'],
    [b.companyName, 'admin.members.drawer.bizCompanyName'],
    [b.bizNo, 'admin.members.drawer.bizNo'],
    [b.ceoName, 'admin.members.drawer.bizCeo'],
    [b.bizType, 'admin.members.drawer.bizType'],
    [b.bizItem, 'admin.members.drawer.bizItem'],
    [b.managerName, 'admin.members.drawer.bizManager'],
    [b.taxEmail, 'admin.members.drawer.bizTaxEmail'],
    [b.managerPhone, 'admin.members.drawer.bizManagerPhone'],
  ];
  return fields.filter(([v]) => v !== '').map(([v, key]) => ({ label: t(key), value: v }));
});

const consents = computed<{ key: string; label: string; agreed: boolean }[]>(() => {
  const d = detail.value;
  if (d === null) return [];
  return [
    { key: 'mail', label: t('admin.members.drawer.mailAgree'), agreed: d.mailAgree },
    { key: 'sms', label: t('admin.members.drawer.smsAgree'), agreed: d.smsAgree },
    { key: 'marketing', label: t('admin.members.drawer.marketingAgree'), agreed: d.marketingAgree },
  ];
});

// [그누보드 관리자에서 열기] — SPA base(/app) 밖 절대경로, 새 탭
const gnuboardUrl = computed<string>(() =>
  detail.value === null ? '#' : `/adm/member_form.php?w=u&mb_id=${encodeURIComponent(detail.value.mbId)}`,
);
</script>

<template>
  <Sheet :open="props.mbId !== null" @update:open="onOpenChange">
    <SheetContent side="right" class="w-full sm:max-w-lg">
      <div class="flex h-full min-h-0 flex-col">
        <header class="flex shrink-0 flex-col gap-1.5 border-b px-5 py-3 pr-12">
          <SheetTitle>
            <span class="block truncate">{{ detail !== null && detail.name !== '' ? detail.name : shownMbId }}</span>
          </SheetTitle>
          <SheetDescription>{{ shownMbId }}</SheetDescription>
          <!-- 상태·구분 배지 + 닉네임 -->
          <div v-if="detail !== null" class="flex flex-wrap items-center gap-1.5">
            <Badge :variant="memberStatusVariant(detail.status)">{{ t(`admin.members.badge.${detail.status}`) }}</Badge>
            <Badge v-if="memberTypeLabelKey(detail.memberType) !== null" variant="info">
              {{ t(memberTypeLabelKey(detail.memberType) ?? '') }}
            </Badge>
            <span v-if="detail.nick !== ''" class="text-muted-foreground text-xs">{{ detail.nick }}</span>
          </div>
        </header>

        <div class="bg-muted/30 min-h-0 flex-1 overflow-y-auto">
          <div v-if="isLoading" class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
            <Spinner />
            불러오는 중…
          </div>

          <div v-else-if="detail !== null" :key="detail.mbId" class="flex flex-col gap-3 p-4">
            <!-- 기본정보 -->
            <Panel tone="card">
              <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt class="text-muted-foreground text-xs">{{ t('admin.members.drawer.level') }}</dt>
                  <dd class="tabular-nums">Lv.{{ detail.level }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ t('admin.members.drawer.point') }}</dt>
                  <dd class="tabular-nums">{{ detail.point.toLocaleString() }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ t('admin.members.drawer.joinedAt') }}</dt>
                  <dd class="tabular-nums">{{ detail.joinedAt }}</dd>
                </div>
                <div>
                  <dt class="text-muted-foreground text-xs">{{ t('admin.members.drawer.lastLogin') }}</dt>
                  <dd class="tabular-nums">{{ detail.lastLoginAt ?? '-' }}</dd>
                </div>
              </dl>
            </Panel>

            <MemberContactSection :detail="detail" />

            <!-- 수신동의 -->
            <SectionCard :title="t('admin.members.drawer.consent')">
              <div class="flex flex-wrap gap-1.5">
                <Badge v-for="c in consents" :key="c.key" :variant="c.agreed ? 'success' : 'secondary'">
                  {{ c.label }} {{ c.agreed ? t('admin.members.drawer.agreed') : t('admin.members.drawer.notAgreed') }}
                </Badge>
              </div>
              <p v-if="detail.emailCertifiedAt !== null" class="text-muted-foreground text-xs">
                {{ t('admin.members.drawer.emailCertifiedAt') }}: {{ detail.emailCertifiedAt }}
              </p>
            </SectionCard>

            <MemberCompanySection :detail="detail" />

            <!-- 레거시 사업자 정보 (값 있을 때만) -->
            <SectionCard v-if="businessRows.length > 0" :title="t('admin.members.drawer.business')">
              <dl class="grid grid-cols-2 gap-x-4 text-sm">
                <div
                  v-for="row in businessRows"
                  :key="row.label"
                  class="flex justify-between gap-2 border-b py-1.5"
                >
                  <dt class="text-muted-foreground shrink-0">{{ row.label }}</dt>
                  <dd class="min-w-0 text-right break-all">{{ row.value }}</dd>
                </div>
              </dl>
            </SectionCard>

            <MemberMemoSection :detail="detail" />

            <MemberRecentProjects :detail="detail" />

            <MemberManageSection v-if="detail.status !== 'left'" :detail="detail" />

            <!-- 그누보드 관리자에서 열기 -->
            <div>
              <Button variant="link" as-child>
                <a :href="gnuboardUrl" target="_blank" rel="noopener noreferrer">
                  {{ t('admin.members.drawer.openGnuboard') }}
                  <ExternalLinkIcon />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
