<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import PageHeader from '@/next/components/common/PageHeader.vue';
import DevelopSettingsForm from '@/next/components/develop/settings/DevelopSettingsForm.vue';

// 개발의뢰 설정(docs/DEVELOP_FLOW.md §7.3) — 옛 pages/admin/AdminDevelopSettings.vue 의 리뉴얼. 폼은 settings/ 조각.
const { t } = useI18n();
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader :title="t('admin.develop.settings.title')" />
    <DevelopSettingsForm />
  </div>
</template>
