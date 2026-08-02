<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@sp/shared';
import { appPath, loginUrl, logoutUrl, memberInfoUrl } from '../lib/auth-urls';
import icProfile from '../assets/bom/ic-profile.svg';

const props = withDefaults(defineProps<{
  showBom?: boolean;
  showAdmin?: boolean;
}>(), {
  showBom: true,
  showAdmin: false,
});

const auth = useAuthStore();
const route = useRoute();
const root = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const displayNick = computed(() => {
  const nick = auth.me?.mbNick.trim();
  if (nick !== undefined && nick !== '') return nick;
  return auth.me?.mbId ?? '회원';
});

function closeMenu(): void {
  menuOpen.value = false;
}

function toggleMenu(): void {
  if (!auth.isLoggedIn) {
    window.location.assign(loginUrl(appPath(route.fullPath)));
    return;
  }
  menuOpen.value = !menuOpen.value;
}

function goLogout(): void {
  closeMenu();
  window.location.assign(logoutUrl(appPath('/')));
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target;
  if (root.value !== null && target instanceof Node && !root.value.contains(target)) closeMenu();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeMenu();
}

watch(() => route.fullPath, closeMenu);

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      class="flex h-9 items-center gap-1.5 rounded-lg px-1.5 text-xs font-semibold text-ink-muted transition hover:bg-gray-100 hover:text-brand"
      :aria-expanded="menuOpen"
      aria-haspopup="menu"
      :aria-label="auth.isLoggedIn ? '프로필 메뉴 열기' : '로그인'"
      @click="toggleMenu"
    >
      <span class="grid size-8 place-items-center overflow-hidden rounded-full bg-ink-faint">
        <img :src="icProfile" alt="" class="size-8">
      </span>
      <span class="hidden max-w-[120px] truncate sm:inline">{{ auth.isLoggedIn ? displayNick : $t('auth.login') }}</span>
      <svg v-if="auth.isLoggedIn" viewBox="0 0 16 16" class="size-3.5" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="m4 6 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div
      v-if="menuOpen && auth.isLoggedIn"
      class="absolute right-0 top-[calc(100%+8px)] z-[70] w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
      role="menu"
      aria-label="프로필 메뉴"
    >
      <div class="border-b border-line-soft bg-surface-sunken px-4 py-3">
        <p class="truncate text-sm font-bold text-ink-strong">{{ displayNick }}님</p>
        <p class="mt-0.5 truncate text-[11px] text-ink-muted">{{ auth.me?.mbId }}</p>
        <span v-if="auth.me?.isAdmin" class="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">{{ $t('auth.admin') }}</span>
      </div>
      <nav class="p-1.5 text-sm font-medium text-ink">
        <RouterLink
          v-if="props.showBom"
          :to="{ name: 'bom' }"
          class="block rounded-lg px-3 py-2 hover:bg-surface-sunken"
          role="menuitem"
          @click="closeMenu"
        >
          {{ $t('nav.smartBom') }}
        </RouterLink>
        <RouterLink
          v-if="props.showAdmin && auth.me?.isAdmin"
          :to="{ name: 'admin' }"
          class="block rounded-lg px-3 py-2 hover:bg-surface-sunken"
          role="menuitem"
          @click="closeMenu"
        >
          {{ $t('admin.title') }}
        </RouterLink>
        <a
          :href="memberInfoUrl()"
          class="mt-1 block border-t border-line-soft px-3 py-2 pt-3 text-ink-muted hover:text-brand"
          role="menuitem"
          @click="closeMenu"
        >{{ $t('auth.account') }}</a>
        <button
          type="button"
          class="mt-1 block w-full rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"
          role="menuitem"
          @click="goLogout"
        >
          {{ $t('auth.logout') }}
        </button>
      </nav>
    </div>
  </div>
</template>
