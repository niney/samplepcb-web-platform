<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BusinessInfoUpdateType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBusinessInfo, useSaveBusinessInfo } from '@/admin/useAdminSettings';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Input } from '@/next/components/ui/input';
import { Label } from '@/next/components/ui/label';
import { Spinner } from '@/next/components/ui/spinner';
import SaveRow from './SaveRow.vue';

// 사업자정보 — g5_shop_default de_admin_* 11필드(영카트 configform.php "사업자정보" 이식). 옛
// components/admin/BusinessInfoForm.vue 와 같은 폼·저장 본문. 로드/재조회 시 폼 리필, 저장 실패 시
// 서버 에러 코드(INVALID_CALLBACK/OWNER_REQUIRED)를 i18n 으로 버튼 옆에 보인다.
const i18n = useI18n();
const { t } = i18n;
const { data, isLoading } = useBusinessInfo();
const { mutate: save, isPending, isSuccess, error, reset } = useSaveBusinessInfo();

type FormKey = keyof BusinessInfoUpdateType;
const form = reactive<BusinessInfoUpdateType>({
  companyName: '',
  ownerName: '',
  businessNo: '',
  tel: '',
  fax: '',
  mailOrderNo: '',
  bugaNo: '',
  zip: '',
  addr: '',
  infoManagerName: '',
  infoManagerEmail: '',
});

// 렌더 순서 = 코어 configform.php 폼 순서. 라벨은 admin.settings.fields.<key>.
const FIELDS: { key: FormKey; type: 'text' | 'email' }[] = [
  { key: 'companyName', type: 'text' },
  { key: 'ownerName', type: 'text' },
  { key: 'businessNo', type: 'text' },
  { key: 'tel', type: 'text' },
  { key: 'fax', type: 'text' },
  { key: 'mailOrderNo', type: 'text' },
  { key: 'bugaNo', type: 'text' },
  { key: 'zip', type: 'text' },
  { key: 'addr', type: 'text' },
  { key: 'infoManagerName', type: 'text' },
  { key: 'infoManagerEmail', type: 'email' },
];

// 로드/재조회(저장 에코 포함) 시 폼 리필. 단일 리소스라 편집 충돌 우려가 낮다.
watch(
  () => data.value?.data,
  (info) => {
    if (info) Object.assign(form, info);
  },
  { immediate: true },
);

// 서버 에러 코드 → i18n. 키가 없으면 UNKNOWN(members mapError 관례).
const saveError = computed<string | null>(() => {
  const err = error.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.settings.error.${code}`)) {
      return t(`admin.settings.error.${code}`);
    }
  }
  return t('admin.settings.error.UNKNOWN');
});

const onSubmit = (): void => {
  reset();
  save({ ...form });
};
</script>

<template>
  <form class="max-w-2xl" @submit.prevent="onSubmit">
    <SectionCard :title="t('admin.settings.tabs.businessInfo')">
      <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Spinner />
        {{ t('admin.settings.loading') }}
      </p>
      <template v-else>
        <div class="grid gap-3">
          <div
            v-for="f in FIELDS"
            :key="f.key"
            class="grid gap-1.5 sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-3"
          >
            <Label :for="`bi-${f.key}`">{{ t(`admin.settings.fields.${f.key}`) }}</Label>
            <Input :id="`bi-${f.key}`" v-model="form[f.key]" :type="f.type" />
          </div>
        </div>
        <SaveRow class="border-t pt-3" :pending="isPending" :saved="isSuccess" :error="saveError" />
      </template>
    </SectionCard>
  </form>
</template>
