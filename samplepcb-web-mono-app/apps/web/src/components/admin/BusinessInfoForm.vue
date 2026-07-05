<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { BusinessInfoUpdateType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBusinessInfo, useSaveBusinessInfo } from '../../admin/useAdminSettings';

// 사업자정보 폼 — g5_shop_default de_admin_* 11필드(영카트 configform.php "사업자정보" 이식).
// 로드/재조회 시 폼 리필, 저장 실패 시 서버 에러 코드(INVALID_CALLBACK/OWNER_REQUIRED)를
// i18n 으로 인라인 표시(members 드로어의 mapError 관례).
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
  <form class="max-w-2xl space-y-4" @submit.prevent="onSubmit">
    <p v-if="isLoading" class="text-sm text-gray-500">{{ t('admin.settings.loading') }}</p>
    <template v-else>
      <div v-for="f in FIELDS" :key="f.key" class="grid grid-cols-[10rem_1fr] items-center gap-3">
        <label :for="`bi-${f.key}`" class="text-sm font-medium text-gray-700">
          {{ t(`admin.settings.fields.${f.key}`) }}
        </label>
        <input
          :id="`bi-${f.key}`"
          v-model="form[f.key]"
          :type="f.type"
          class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        >
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="isPending"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {{ isPending ? t('admin.settings.saving') : t('admin.settings.save') }}
        </button>
        <span v-if="isSuccess" class="text-sm text-green-600">{{ t('admin.settings.saved') }}</span>
        <span v-if="saveError !== null" class="text-sm text-red-600">{{ saveError }}</span>
      </div>
    </template>
  </form>
</template>
