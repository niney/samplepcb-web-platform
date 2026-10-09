<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  PartnerInviteAcceptResponse,
  PartnerInviteInfoResponse,
  apiRoutes,
  type PartnerInviteInfoResponseType,
} from '@sp/api-contract';
import { ApiRequestError, apiGet, apiSend, useAuthStore } from '@sp/shared';
import { appPath, loginUrl } from '../lib/auth-urls';
import { providePartnerI18n, setPartnerLocale } from '../partner/i18n';

// 포털 초대 수락(docs/PARTNER_PORTAL.md "하위 협력사 직접 관리") — 계정 없이 등록된 조직의
// 담당자가 **자기 계정으로** 포털에 들어오게 하는 1회용 링크의 도착 화면이다.
// 조회는 공개(토큰이 근거), 수락은 로그인 후. 포털 셸 밖의 독립 문서지만 받는 사람이 해외
// 협력사일 수 있어 포털 언어 설정을 그대로 쓴다.

const { pt, locale } = providePartnerI18n();
const changeLocale = (event: Event): void => {
  setPartnerLocale((event.target as HTMLSelectElement).value);
};

const auth = useAuthStore();
const route = useRoute();
const token = computed(() => {
  const raw = route.params.token;
  return typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
});

const info = ref<PartnerInviteInfoResponseType['data'] | null>(null);
const loading = ref(false);
const invalid = ref(false);
const busy = ref(false);
const accepted = ref(false);
const acceptError = ref<string | null>(null);

async function load(): Promise<void> {
  if (token.value === null) {
    invalid.value = true;
    return;
  }
  loading.value = true;
  try {
    const res = await apiGet(`${apiRoutes.partnerInvite}/${token.value}`, PartnerInviteInfoResponse);
    info.value = res.data;
    invalid.value = false;
  } catch {
    invalid.value = true;
  } finally {
    loading.value = false;
  }
}
watch(token, () => void load(), { immediate: true });

const STATE_TEXT = {
  expired: '기한이 지난 초대입니다. 초대를 다시 요청해 주세요.',
  accepted: '이미 수락된 초대입니다.',
  unavailable: '지금은 이용할 수 없는 조직입니다. 초대한 곳에 문의해 주세요.',
} as const;
const ERROR_TEXT: Record<string, string> = {
  INVITE_EXPIRED: STATE_TEXT.expired,
  INVITE_ACCEPTED: STATE_TEXT.accepted,
  PARTNER_UNAVAILABLE: STATE_TEXT.unavailable,
  MEMBER_ALREADY_LINKED:
    '이 계정은 이미 다른 파트너에 연결돼 있습니다. 다른 계정으로 로그인해 주세요.',
};

async function accept(): Promise<void> {
  if (token.value === null) return;
  busy.value = true;
  acceptError.value = null;
  try {
    await apiSend(
      'POST',
      `${apiRoutes.partnerInvite}/${token.value}/accept`,
      undefined,
      PartnerInviteAcceptResponse,
    );
    accepted.value = true;
  } catch (caught) {
    const code = caught instanceof ApiRequestError ? (caught.payload?.error ?? '') : '';
    acceptError.value = pt(ERROR_TEXT[code] ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    busy.value = false;
  }
}

const toLogin = (): void => {
  window.location.href = loginUrl(appPath(route.fullPath));
};
</script>

<template>
  <div :lang="locale" class="min-h-screen bg-gray-50 px-4 py-10 text-gray-900">
    <div class="mx-auto max-w-md">
      <div class="mb-3 flex items-center justify-between">
        <p class="text-lg font-bold text-blue-600">SAMPLEPCB</p>
        <select
          :value="locale"
          :aria-label="pt('언어')"
          class="rounded-md border border-gray-200 bg-surface px-2 py-1.5 text-xs text-gray-700"
          @change="changeLocale"
        >
          <option value="ko" lang="ko">한국어</option>
          <option value="en" lang="en">English</option>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
        </select>
      </div>

      <div class="rounded-xl border border-gray-200 bg-surface p-6 shadow-sm">
        <h1 class="text-lg font-bold">{{ pt('파트너 포털 초대') }}</h1>

        <p v-if="loading" class="mt-4 text-sm text-gray-400">{{ pt('불러오는 중…') }}</p>
        <p v-else-if="invalid || info === null" role="alert" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ pt('유효하지 않은 초대 링크입니다.') }}
        </p>

        <template v-else>
          <p class="mt-3 text-sm text-gray-700">
            {{ pt('{partner} 의 파트너 포털 초대입니다.', { partner: info.partnerName }) }}
          </p>
          <p v-if="info.inviterName !== null" class="mt-0.5 text-xs text-gray-500">
            {{ pt('{inviter} 에서 보냈습니다.', { inviter: info.inviterName }) }}
          </p>

          <div v-if="accepted" class="mt-4 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            <p class="font-semibold">{{ pt('연결되었습니다. 이제 파트너 포털을 이용할 수 있습니다.') }}</p>
            <RouterLink
              :to="{ name: 'partner' }"
              class="mt-3 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
            >
              {{ pt('파트너 포털로 이동') }}
            </RouterLink>
          </div>

          <p
            v-else-if="info.state !== 'valid'"
            role="alert"
            class="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          >
            {{ pt(STATE_TEXT[info.state]) }}
          </p>

          <template v-else-if="auth.isLoggedIn">
            <p class="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {{ pt('수락하면 지금 로그인한 계정({id})이 {partner} 의 포털 계정으로 연결됩니다.', { id: auth.me?.mbId ?? '', partner: info.partnerName }) }}
            </p>
            <p v-if="acceptError !== null" role="alert" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {{ acceptError }}
            </p>
            <button
              type="button"
              class="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
              data-testid="partner-invite-accept"
              :disabled="busy"
              @click="void accept()"
            >
              {{ busy ? pt('수락 중…') : pt('초대 수락') }}
            </button>
          </template>

          <template v-else>
            <p class="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {{ pt('초대를 수락하려면 먼저 로그인해 주세요. 계정이 없으면 회원가입 후 이 링크를 다시 열어 주세요.') }}
            </p>
            <div class="mt-4 flex gap-2">
              <button
                type="button"
                class="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                @click="toLogin"
              >
                {{ pt('로그인') }}
              </button>
              <a
                href="/bbs/register.php"
                class="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                {{ pt('회원가입') }}
              </a>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>
