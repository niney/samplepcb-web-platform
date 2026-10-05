<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { ChevronDown, LogOut } from '@lucide/vue';
import { useAuthStore } from '@sp/shared';
import { Avatar, AvatarFallback } from '@/next/components/ui/avatar';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/next/components/ui/dropdown-menu';
import { appPath, loginUrl, logoutUrl, memberInfoUrl, systemAdminUrl } from '@/lib/auth-urls';
import { usePartnerAccess } from '@/partner/usePartnerAccess';

// 프로필 메뉴 — 옛 components/AppProfileMenu.vue(관리자 셸 기본형)와 같은 항목:
// 스마트 BOM · 파트너 포털(협력사 회원만) · 시스템 관리자(관리자만) · 회원정보 수정 · 로그아웃.
const auth = useAuthStore();
const route = useRoute();
const { isPartner } = usePartnerAccess();

const displayNick = computed(() => {
  const nick = auth.me?.mbNick.trim();
  if (nick !== undefined && nick !== '') return nick;
  return auth.me?.mbId ?? '회원';
});
const initial = computed(() => displayNick.value.slice(0, 1).toUpperCase());

function goLogin(): void {
  window.location.assign(loginUrl(appPath(route.fullPath)));
}

function goLogout(): void {
  window.location.assign(logoutUrl(appPath('/')));
}
</script>

<template>
  <DropdownMenu v-if="auth.isLoggedIn">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" :aria-label="'프로필 메뉴 열기'">
        <Avatar class="size-6">
          <AvatarFallback>{{ initial }}</AvatarFallback>
        </Avatar>
        <span class="hidden max-w-32 truncate sm:inline">{{ displayNick }}</span>
        <ChevronDown />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-60">
      <DropdownMenuLabel>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate">{{ displayNick }}님</span>
          <span class="text-muted-foreground truncate text-xs">{{ auth.me?.mbId }}</span>
        </div>
        <Badge v-if="auth.me?.isAdmin" variant="info" class="mt-2">{{ $t('auth.admin') }}</Badge>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem as-child>
          <RouterLink :to="{ name: 'bom' }">{{ $t('nav.smartBom') }}</RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem v-if="isPartner" as-child>
          <RouterLink :to="{ name: 'partner' }">{{ $t('nav.partnerPortal') }}</RouterLink>
        </DropdownMenuItem>
        <DropdownMenuItem v-if="auth.me?.isAdmin" as-child>
          <a :href="systemAdminUrl()">{{ $t('auth.systemAdmin') }}</a>
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem as-child>
        <a :href="memberInfoUrl()">{{ $t('auth.account') }}</a>
      </DropdownMenuItem>
      <DropdownMenuItem variant="destructive" @select="goLogout">
        <LogOut />
        {{ $t('auth.logout') }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  <Button v-else variant="ghost" size="sm" @click="goLogin">{{ $t('auth.login') }}</Button>
</template>
