<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import SettingsTabs from '../../components/admin/SettingsTabs.vue';
import BusinessInfoForm from '../../components/admin/BusinessInfoForm.vue';
import GerberPricingForm from '../../components/admin/GerberPricingForm.vue';
import AiSettingsForm from '../../components/admin/AiSettingsForm.vue';
import type { SettingsTabKey } from '../../admin/useAdminSettings';

// 관리자 설정 — 영카트 쇼핑몰설정을 탭 단위로 이식. 사이드바는 1-depth "설정" 하나이고
// 세부는 이 페이지 내부 탭으로 나눈다(원본 앵커 섹션 UX 근접). 사업자정보·거버 가격 탭 —
// 결제/배송/알림 탭은 SettingsTabs.TABS 에 key 추가 + 아래 v-if 패널 한 줄로 확장한다.
const { t } = useI18n();
const activeTab = ref<SettingsTabKey>('businessInfo');
</script>

<template>
  <div class="space-y-4">
    <h1 class="text-xl font-bold">{{ t('admin.settings.title') }}</h1>
    <SettingsTabs :tab="activeTab" @update:tab="activeTab = $event" />
    <BusinessInfoForm v-if="activeTab === 'businessInfo'" />
    <GerberPricingForm v-else-if="activeTab === 'gerberPricing'" />
    <AiSettingsForm v-else-if="activeTab === 'aiIntegration'" />
  </div>
</template>
