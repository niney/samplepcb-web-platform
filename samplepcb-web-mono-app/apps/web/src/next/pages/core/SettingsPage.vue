<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SettingsTabKey } from '@/admin/useAdminSettings';
import PageHeader from '@/next/components/common/PageHeader.vue';
import AiSettingsForm from '@/next/components/core/settings/ai/AiSettingsForm.vue';
import BomQuoteSettingsForm from '@/next/components/core/settings/bom/BomQuoteSettingsForm.vue';
import BusinessInfoForm from '@/next/components/core/settings/BusinessInfoForm.vue';
import GerberPricingForm from '@/next/components/core/settings/GerberPricingForm.vue';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/next/components/ui/tabs';

// 관리자 설정(리뉴얼) — 옛 pages/admin/AdminSettings.vue 와 같은 구성: 사이드바는 "설정" 하나, 세부는
// 이 화면 안의 탭 넷(사업자정보·거버 가격·AI 연동·BOM 견적). 옛 화면처럼 탭 상태는 화면 안에만 두고,
// 보이는 탭의 폼만 마운트한다(TabsContent 는 비활성 탭을 그리지 않는다 — 탭을 열 때 그 탭만 조회).
const { t } = useI18n();
const TABS: SettingsTabKey[] = ['businessInfo', 'gerberPricing', 'aiIntegration', 'bomQuote'];
const activeTab = ref<SettingsTabKey>('businessInfo');

const onTabPick = (value: string | number): void => {
  const hit = TABS.find((tab) => tab === value);
  if (hit !== undefined) activeTab.value = hit;
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageHeader :title="t('admin.settings.title')" />
    <Tabs :model-value="activeTab" @update:model-value="onTabPick">
      <!-- 밑줄 탭 — 줄 전체의 밑줄은 감싸는 줄이 그린다(QueueTabs 와 같은 모양) -->
      <div class="border-b">
        <TabsList>
          <TabsTrigger v-for="tab in TABS" :key="tab" :value="tab">
            {{ t(`admin.settings.tabs.${tab}`) }}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="businessInfo">
        <BusinessInfoForm />
      </TabsContent>
      <TabsContent value="gerberPricing">
        <GerberPricingForm />
      </TabsContent>
      <TabsContent value="aiIntegration">
        <AiSettingsForm />
      </TabsContent>
      <TabsContent value="bomQuote">
        <BomQuoteSettingsForm />
      </TabsContent>
    </Tabs>
  </div>
</template>
