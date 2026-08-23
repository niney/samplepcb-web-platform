<script setup lang="ts">
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';
import AppThemeToggle from '../components/AppThemeToggle.vue';
import { usePartnerAccess } from '../partner/usePartnerAccess';

const auth = useAuthStore();
const route = useRoute();
const { isPartner } = usePartnerAccess();
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header
      class="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 shadow-sm"
    >
      <div class="flex items-center gap-3">
        <RouterLink to="/" class="text-lg font-bold text-blue-600">{{ $t('app.name') }}</RouterLink>
        <RouterLink
          :to="{ name: 'bom' }"
          class="rounded-md px-2.5 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
          active-class="bg-blue-50 text-blue-700"
        >
          {{ $t('nav.smartBom') }}
        </RouterLink>
        <RouterLink
          v-if="auth.me?.isAdmin"
          :to="{ name: 'admin' }"
          class="rounded-md border border-blue-200 px-2.5 py-1 text-sm font-medium text-blue-700 hover:bg-blue-50"
        >
          {{ $t('admin.title') }}
        </RouterLink>
        <RouterLink
          v-if="isPartner"
          :to="{ name: 'partner' }"
          class="rounded-md border border-indigo-200 px-2.5 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
        >
          {{ $t('nav.partnerPortal') }}
        </RouterLink>
      </div>
      <div class="flex items-center gap-2">
        <AppThemeToggle />
        <AppSiteHomeButton />
        <AppProfileMenu :show-bom="true" :show-admin="auth.me?.isAdmin === true" />
      </div>
    </header>

    <main :class="route.meta.wide === true ? 'mx-auto max-w-7xl px-6 py-8' : 'mx-auto max-w-3xl px-6 py-8'">
      <RouterView />
    </main>
  </div>
</template>
