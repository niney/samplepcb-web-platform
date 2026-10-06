<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import { BanIcon, ShieldCheckIcon } from '@lucide/vue';
import type { AdminMemberDetailType } from '@sp/api-contract';
import { useSetIntercept, useSetLevel } from '@/admin/useAdminMembers';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { FieldLabel } from '@/next/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Separator } from '@/next/components/ui/separator';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { useMemberErrorText } from './member-errors';

// 관리(차단·레벨) — 탈퇴 회원이면 서랍이 이 구역을 띄우지 않는다. 진짜 경계는 서버 가드(409:
// LEFT_MEMBER·SELF_FORBIDDEN·ADMIN_PROTECTED). 차단/해제는 확인 한 번을 거친다(옛 화면의 인라인 2단계 확인 →
// 리뉴얼 공용 확인 대화상자, 같은 문구·같은 '확인'/'취소').
const props = defineProps<{ detail: AdminMemberDetailType }>();
const { t } = useI18n();
const errorText = useMemberErrorText();
const uid = useId();

const { mutate: setIntercept, isPending: interceptPending, error: interceptErr, reset: resetIntercept } =
  useSetIntercept();
const {
  mutate: setLevel,
  isPending: levelPending,
  isSuccess: levelSaved,
  error: levelErr,
  reset: resetLevel,
} = useSetLevel();

const interceptError = computed<string | null>(() => errorText(interceptErr.value));
const levelError = computed<string | null>(() => errorText(levelErr.value));

const isIntercepted = computed<boolean>(() => props.detail.status === 'intercepted');

// YYYYMMDD → YYYY-MM-DD (interceptDate 표기용)
const ymdDash = (s: string): string => (s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);

const toggleIntercept = async (): Promise<void> => {
  const blocking = !isIntercepted.value;
  const ok = await confirmDialog({
    message: blocking ? t('admin.members.manage.confirmBlock') : t('admin.members.manage.confirmUnblock'),
    confirmLabel: t('admin.members.manage.confirm'),
    cancelLabel: t('admin.members.manage.cancel'),
    tone: blocking ? 'danger' : 'default',
  });
  if (!ok) return;
  resetIntercept();
  setIntercept({ mbId: props.detail.mbId, intercept: blocking });
};

const LEVELS = Array.from({ length: 10 }, (_, i) => i + 1);
const levelInput = ref(props.detail.level);
const levelChanged = computed<boolean>(() => levelInput.value !== props.detail.level);
const onLevelChange = (e: Event): void => {
  const level = Number((e.target as HTMLSelectElement).value);
  if (Number.isInteger(level)) levelInput.value = level;
};
const submitLevel = (): void => {
  if (!levelChanged.value) return;
  resetLevel();
  setLevel({ mbId: props.detail.mbId, level: levelInput.value });
};
</script>

<template>
  <SectionCard :title="t('admin.members.manage.title')">
    <!-- 차단/해제 -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="flex flex-wrap items-baseline gap-1 text-sm">
        <span class="text-muted-foreground">{{ t('admin.members.manage.blockStatus') }}:</span>
        <span :class="isIntercepted ? 'text-warning font-semibold' : ''">
          {{ isIntercepted ? t('admin.members.manage.blocked') : t('admin.members.manage.notBlocked') }}
        </span>
        <span v-if="isIntercepted && props.detail.interceptDate !== null" class="text-muted-foreground tabular-nums">
          ({{ ymdDash(props.detail.interceptDate) }})
        </span>
      </p>
      <Button
        :variant="isIntercepted ? 'outline' : 'warning'"
        :disabled="interceptPending"
        @click="toggleIntercept"
      >
        <ShieldCheckIcon v-if="isIntercepted" />
        <BanIcon v-else />
        {{ isIntercepted ? t('admin.members.manage.unblock') : t('admin.members.manage.block') }}
      </Button>
    </div>
    <Alert v-if="interceptError !== null" variant="destructive" size="sm">
      <AlertDescription>{{ interceptError }}</AlertDescription>
    </Alert>

    <Separator />

    <!-- 레벨 변경 -->
    <div class="flex flex-col gap-2">
      <FieldLabel :for="`${uid}-level`">{{ t('admin.members.manage.level') }}</FieldLabel>
      <div class="flex items-center gap-2">
        <NativeSelect :id="`${uid}-level`" :model-value="levelInput" @change="onLevelChange">
          <NativeSelectOption v-for="lv in LEVELS" :key="lv" :value="lv">Lv.{{ lv }}</NativeSelectOption>
        </NativeSelect>
        <Button :disabled="!levelChanged || levelPending" @click="submitLevel">
          {{ t('admin.members.manage.levelSave') }}
        </Button>
      </div>
      <Alert v-if="levelError !== null" variant="destructive" size="sm">
        <AlertDescription>{{ levelError }}</AlertDescription>
      </Alert>
      <p v-else-if="levelSaved" class="text-success text-xs">{{ t('admin.members.manage.levelSaveSuccess') }}</p>
    </div>
  </SectionCard>
</template>
