<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';

// 라우트 meta.titleKey 로 어느 섹션인지 표시하는 공용 임시 페이지.
const route = useRoute();
const { t } = useI18n();

const title = computed(() => {
  const key = route.meta.titleKey;
  return key ? t(key) : '';
});
</script>

<template>
  <div>
    <h1 class="text-xl font-bold">{{ title }}</h1>
    <p class="mt-4 text-gray-500">{{ $t('admin.placeholder') }}</p>
  </div>
</template>
