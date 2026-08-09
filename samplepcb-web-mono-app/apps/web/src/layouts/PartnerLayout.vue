<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { useTheme } from '../bom/useTheme';
import { usePartnerAccess } from '../partner/usePartnerAccess';
import AppProfileMenu from '../components/AppProfileMenu.vue';
import AppSiteHomeButton from '../components/AppSiteHomeButton.vue';

// 협력사 포털 셸(포털 재설계 R1) — 관리자 콘솔 모듈 스위처의 미러. 모듈(BOM 부품/
// PCB 제작) 노출 근거는 서버 tracks(조직 capabilities)뿐이고, 수금처럼 모듈 무관
// 화면은 공통 영역으로 스위처 옆에 둔다. 소속·권한 판정은 서버(requirePartner)가 한다.

const auth = useAuthStore();
const route = useRoute();
const { isDark, toggleTheme } = useTheme();
const { data } = usePartnerAccess();

const access = computed(() => data.value?.data ?? null);
const tracks = computed(() => access.value?.tracks ?? { bom: false, pcb: false });
const showSwitcher = computed(
  () => access.value?.isPartner === true && (tracks.value.bom || tracks.value.pcb),
);

const activeModule = computed(() => {
  if (route.path.startsWith('/partner/bom')) return 'bom';
  if (route.path.startsWith('/partner/pcb')) return 'pcb';
  return null;
});
const isRemittances = computed(() => route.name === 'partner-remittances');
</script>

<template>
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header class="border-b border-gray-200 bg-surface">
      <div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
        <div class="flex min-w-0 items-center gap-4">
          <RouterLink :to="{ name: 'partner' }" class="shrink-0 text-lg font-bold text-blue-600">
            SAMPLEPCB <span class="text-sm font-semibold text-gray-500">파트너 포털</span>
          </RouterLink>

          <!-- 모듈 스위처 — 보유 트랙만 노출(한 트랙이면 탭 1개 = 현재 위치 표시) -->
          <nav v-if="showSwitcher" class="flex items-center gap-1 text-sm font-semibold">
            <RouterLink
              v-if="tracks.bom"
              :to="{ name: 'partner-bom' }"
              class="rounded-lg px-3 py-1.5"
              :class="activeModule === 'bom' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
            >
              BOM 부품
            </RouterLink>
            <RouterLink
              v-if="tracks.pcb"
              :to="{ name: 'partner-pcb' }"
              class="rounded-lg px-3 py-1.5"
              :class="activeModule === 'pcb' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
            >
              PCB 제작
            </RouterLink>
            <!-- 공통 영역 — 모듈 소속이 아닌 화면(현재 데이터는 PCB 발주 대금) -->
            <RouterLink
              v-if="tracks.pcb"
              :to="{ name: 'partner-remittances' }"
              class="rounded-lg px-3 py-1.5"
              :class="isRemittances ? 'bg-amber-500 text-white' : 'text-gray-600 hover:bg-gray-100'"
            >
              수금 현황
            </RouterLink>
          </nav>
        </div>

        <div class="flex items-center gap-3 text-sm">
          <AppSiteHomeButton />
          <!-- 테마 전환 — 관리자·BOM 셸과 같은 상태를 공유한다(useTheme 싱글턴) -->
          <button
            type="button"
            class="grid size-[30px] place-items-center rounded-md text-ink-muted hover:bg-gray-100 hover:text-brand"
            :aria-label="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
            :title="isDark ? '라이트 모드로 전환' : '다크 모드로 전환'"
            @click="toggleTheme"
          >
            <svg v-if="isDark" viewBox="0 0 24 24" class="size-[17px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke-linecap="round" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="size-[17px]" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5Z" stroke-linejoin="round" />
            </svg>
          </button>
          <AppProfileMenu :show-admin="auth.me?.isAdmin === true" />
        </div>
      </div>
    </header>
    <main class="mx-auto max-w-7xl px-4 py-6">
      <RouterView />
    </main>
  </div>
</template>
