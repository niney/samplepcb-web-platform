<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import {
  useAdminMemberDetail,
  useSaveMemberProfile,
  useSetIntercept,
  useSetLevel,
} from '../../admin/useAdminMembers';
import { formatDate, formatKrw } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';

// 회원 상세 드로어 — 우측 슬라이드 오버. 기본정보·연락/주소·수신동의·레거시 사업자
// 정보(read-only)·회사명 프로필 저장·최근 견적, 그리고 관리 섹션(차단 2단계·레벨 변경).
// 탈퇴 회원(status='left')은 관리 섹션을 통째로 숨긴다. 진짜 경계는 서버 가드(409).
const props = defineProps<{ mbId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();
// te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
const i18n = useI18n();
const { t } = i18n;

const mbIdRef = computed(() => props.mbId);
const { data, isLoading } = useAdminMemberDetail(mbIdRef);
const detail = computed(() => data.value?.data ?? null);

const {
  mutate: setIntercept,
  isPending: interceptPending,
  error: interceptErr,
  reset: resetIntercept,
} = useSetIntercept();
const {
  mutate: setLevel,
  isPending: levelPending,
  isSuccess: levelSaved,
  error: levelErr,
  reset: resetLevel,
} = useSetLevel();
const {
  mutate: saveProfile,
  isPending: profilePending,
  isSuccess: profileSaved,
  isError: profileFailed,
  reset: resetProfile,
} = useSaveMemberProfile();

// 프로젝트(회원) 전환 시에만 입력 리필 — 편집 중 값을 덮어쓰지 않는다.
const companyNameInput = ref('');
const levelInput = ref(1);
const interceptConfirm = ref(false);
const filledFor = ref<string | null>(null);

watch(detail, (d) => {
  if (d !== null && filledFor.value !== d.mbId) {
    filledFor.value = d.mbId;
    // 편집 대상은 프로필층 원값(profileCompanyName) — 해석값(mb_2 fallback)이 아니다.
    // 그래야 빈 값 저장이 "프로필 삭제 → mb_2 로 복귀"로 정확히 동작한다.
    companyNameInput.value = d.profileCompanyName ?? '';
    levelInput.value = d.level;
    interceptConfirm.value = false;
    resetIntercept();
    resetLevel();
    resetProfile();
  }
});

const isIntercepted = computed<boolean>(() => detail.value?.status === 'intercepted');

const companyNameChanged = computed<boolean>(() => {
  const d = detail.value;
  if (d === null) return false;
  return companyNameInput.value.trim() !== (d.profileCompanyName ?? '');
});
const submitCompanyName = (): void => {
  const d = detail.value;
  if (d === null || !companyNameChanged.value) return;
  resetProfile();
  // 빈 문자열이면 프로필 삭제(서버가 mb_2 fallback 을 반영해 응답)
  saveProfile({ mbId: d.mbId, companyName: companyNameInput.value.trim() });
};

const levelChanged = computed<boolean>(() => {
  const d = detail.value;
  return d !== null && levelInput.value !== d.level;
});
const submitLevel = (): void => {
  const d = detail.value;
  if (d === null || !levelChanged.value) return;
  resetLevel();
  setLevel({ mbId: d.mbId, level: levelInput.value });
};

// 차단/해제 — 인라인 2단계 확인(window.confirm 금지). 버튼 → 확인 프롬프트 → 실행.
const confirmIntercept = (): void => {
  const d = detail.value;
  if (d === null) return;
  resetIntercept();
  setIntercept({ mbId: d.mbId, intercept: !isIntercepted.value });
  interceptConfirm.value = false;
};

const mapError = (err: unknown): string | null => {
  if (err === null || err === undefined) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.members.error.${code}`)) {
      return t(`admin.members.error.${code}`);
    }
    return err.payload?.message ?? t('admin.members.error.UNKNOWN');
  }
  return t('admin.members.error.UNKNOWN');
};
const interceptError = computed<string | null>(() => mapError(interceptErr.value));
const levelError = computed<string | null>(() => mapError(levelErr.value));

// 레거시 사업자 정보 — 값 있는 필드만 표시(라벨 복원)
const businessRows = computed<{ label: string; value: string }[]>(() => {
  const b = detail.value?.legacyBusiness;
  if (b === undefined || b === null) return [];
  const fields: [string, string][] = [
    [b.memberType, 'admin.members.drawer.bizMemberType'],
    [b.companyName, 'admin.members.drawer.bizCompanyName'],
    [b.bizNo, 'admin.members.drawer.bizNo'],
    [b.ceoName, 'admin.members.drawer.bizCeo'],
    [b.bizType, 'admin.members.drawer.bizType'],
    [b.bizItem, 'admin.members.drawer.bizItem'],
    [b.managerName, 'admin.members.drawer.bizManager'],
    [b.taxEmail, 'admin.members.drawer.bizTaxEmail'],
    [b.managerPhone, 'admin.members.drawer.bizManagerPhone'],
  ];
  return fields.filter(([v]) => v !== '').map(([v, key]) => ({ label: t(key), value: v }));
});

// YYYYMMDD → YYYY-MM-DD (interceptDate/leaveDate 표기용)
const ymdDash = (s: string): string =>
  s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;

// [그누보드 관리자에서 열기] — SPA base(/app) 밖 절대경로, 새 탭
const gnuboardUrl = computed<string>(() =>
  detail.value === null
    ? '#'
    : `/adm/member_form.php?w=u&mb_id=${encodeURIComponent(detail.value.mbId)}`,
);

const searchInQuotes = (): void => {
  const d = detail.value;
  if (d === null) return;
  void router.push({ name: 'admin-quotes', query: { q: d.mbId } });
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props.mbId !== null" class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/30" @click="emit('close')" />
      <aside
        class="absolute right-0 top-0 flex h-full w-[32rem] max-w-full flex-col bg-white shadow-xl"
      >
        <!-- 헤더 -->
        <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-gray-900">
              {{ detail !== null && detail.name !== '' ? detail.name : props.mbId }}
            </h2>
            <p class="text-xs text-gray-400">{{ props.mbId }}</p>
          </div>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            @click="emit('close')"
          >
            {{ t('admin.members.drawer.close') }}
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <p v-if="isLoading" class="py-8 text-center text-sm text-gray-400">…</p>

          <template v-else-if="detail !== null">
            <!-- 상태·구분 뱃지 -->
            <div class="flex flex-wrap items-center gap-1">
              <UiBadge
                :variant="detail.status === 'normal' ? 'success' : detail.status === 'intercepted' ? 'warn' : 'muted'"
                :label="t(`admin.members.badge.${detail.status}`)"
              />
              <UiBadge
                v-if="detail.memberType === '기업'"
                variant="info"
                :label="t('admin.members.badge.corp')"
              />
              <UiBadge
                v-else-if="detail.memberType === '파트너'"
                variant="info"
                :label="t('admin.members.badge.partner')"
              />
              <span v-if="detail.nick !== ''" class="text-xs text-gray-400">{{ detail.nick }}</span>
            </div>

            <!-- 기본정보 -->
            <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt class="text-xs text-gray-400">{{ t('admin.members.drawer.level') }}</dt>
                <dd class="text-gray-800">Lv.{{ detail.level }}</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">{{ t('admin.members.drawer.point') }}</dt>
                <dd class="text-gray-800 tabular-nums">{{ detail.point.toLocaleString() }}</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">{{ t('admin.members.drawer.joinedAt') }}</dt>
                <dd class="text-gray-800">{{ detail.joinedAt }}</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-400">{{ t('admin.members.drawer.lastLogin') }}</dt>
                <dd class="text-gray-800">{{ detail.lastLoginAt ?? '-' }}</dd>
              </div>
            </dl>

            <!-- 연락/주소 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.drawer.contact') }}
              </h3>
              <dl class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">{{ t('admin.members.drawer.email') }}</dt>
                  <dd class="min-w-0 break-all text-gray-800">{{ detail.email ?? '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">{{ t('admin.members.drawer.phone') }}</dt>
                  <dd class="text-gray-800">{{ detail.phone ?? '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">
                    {{ t('admin.members.drawer.address') }}
                  </dt>
                  <dd class="min-w-0 text-gray-800">
                    <template v-if="detail.addr !== null">
                      <span v-if="detail.addr.zip !== ''" class="text-gray-500">
                        [{{ detail.addr.zip }}]
                      </span>
                      {{ detail.addr.addr1 }} {{ detail.addr.addr2 }} {{ detail.addr.addr3 }}
                    </template>
                    <template v-else>-</template>
                  </dd>
                </div>
              </dl>
            </section>

            <!-- 수신동의 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.drawer.consent') }}
              </h3>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <UiBadge
                  :variant="detail.mailAgree ? 'success' : 'muted'"
                  :label="`${t('admin.members.drawer.mailAgree')} ${detail.mailAgree ? t('admin.members.drawer.agreed') : t('admin.members.drawer.notAgreed')}`"
                />
                <UiBadge
                  :variant="detail.smsAgree ? 'success' : 'muted'"
                  :label="`${t('admin.members.drawer.smsAgree')} ${detail.smsAgree ? t('admin.members.drawer.agreed') : t('admin.members.drawer.notAgreed')}`"
                />
                <UiBadge
                  :variant="detail.marketingAgree ? 'success' : 'muted'"
                  :label="`${t('admin.members.drawer.marketingAgree')} ${detail.marketingAgree ? t('admin.members.drawer.agreed') : t('admin.members.drawer.notAgreed')}`"
                />
              </div>
              <p v-if="detail.emailCertifiedAt !== null" class="mt-2 text-xs text-gray-400">
                {{ t('admin.members.drawer.emailCertifiedAt') }}: {{ detail.emailCertifiedAt }}
              </p>
            </section>

            <!-- 회사명(sp 프로필층) 편집+저장 -->
            <section class="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.drawer.companyName') }}
              </h3>
              <div class="mt-2 flex items-center gap-2">
                <input
                  v-model="companyNameInput"
                  type="text"
                  class="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                  :placeholder="detail.companyName ?? ''"
                  @keydown.enter="submitCompanyName"
                >
                <button
                  type="button"
                  class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  :disabled="!companyNameChanged || profilePending"
                  @click="submitCompanyName"
                >
                  {{ t('admin.members.drawer.save') }}
                </button>
              </div>
              <p class="mt-1 text-xs text-gray-400">{{ t('admin.members.drawer.companyNameHint') }}</p>
              <p v-if="profileFailed" class="mt-1 text-xs text-red-600">
                {{ t('admin.members.drawer.companySaveFailed') }}
              </p>
              <p v-else-if="profileSaved" class="mt-1 text-xs text-green-700">
                {{ t('admin.members.drawer.companySaveSuccess') }}
              </p>
            </section>

            <!-- 레거시 사업자 정보 (값 있을 때만) -->
            <section v-if="businessRows.length > 0" class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.drawer.business') }}
              </h3>
              <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div
                  v-for="row in businessRows"
                  :key="row.label"
                  class="flex justify-between gap-2 border-b border-gray-100 py-1"
                >
                  <dt class="text-gray-400">{{ row.label }}</dt>
                  <dd class="min-w-0 break-all text-right text-gray-800">{{ row.value }}</dd>
                </div>
              </dl>
            </section>

            <!-- 관리자 메모 (있을 때만, read-only) -->
            <section v-if="detail.memo !== null" class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.drawer.memo') }}
              </h3>
              <p class="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                {{ detail.memo }}
              </p>
            </section>

            <!-- 최근 견적 -->
            <section class="mt-5">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">
                  {{ t('admin.members.drawer.recentProjects') }}
                  <span class="text-gray-400">({{ detail.projectCount }})</span>
                </h3>
                <button
                  type="button"
                  class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  @click="searchInQuotes"
                >
                  {{ t('admin.members.drawer.searchQuotes') }}
                </button>
              </div>
              <ul v-if="detail.recentProjects.length > 0" class="mt-2 space-y-1.5">
                <li
                  v-for="rp in detail.recentProjects"
                  :key="rp.projectId"
                  class="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <div class="min-w-0">
                    <p class="truncate text-gray-800">{{ rp.projectName }}</p>
                    <p class="text-xs text-gray-400">{{ formatDate(rp.createdAt) }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <UiBadge
                      :variant="rp.quoteStatus"
                      :label="t(`admin.quotes.badge.${rp.quoteStatus}`)"
                    />
                    <span class="tabular-nums text-gray-700">
                      {{ rp.price !== null ? formatKrw(rp.price) : '-' }}
                    </span>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-2 text-sm text-gray-400">
                {{ t('admin.members.drawer.noProjects') }}
              </p>
            </section>

            <!-- 관리 섹션 (탈퇴 회원이면 숨김) -->
            <section
              v-if="detail.status !== 'left'"
              class="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.members.manage.title') }}
              </h3>

              <!-- 차단/해제 (인라인 2단계 확인) -->
              <div class="mt-3">
                <p class="text-xs text-gray-500">
                  {{ t('admin.members.manage.blockStatus') }}:
                  <span :class="isIntercepted ? 'font-semibold text-amber-700' : 'text-gray-700'">
                    {{
                      isIntercepted
                        ? t('admin.members.manage.blocked')
                        : t('admin.members.manage.notBlocked')
                    }}
                  </span>
                  <span
                    v-if="isIntercepted && detail.interceptDate !== null"
                    class="text-gray-400"
                  >
                    ({{ ymdDash(detail.interceptDate) }})
                  </span>
                </p>
                <div class="mt-2">
                  <button
                    v-if="!interceptConfirm"
                    type="button"
                    class="rounded-md border px-3 py-1.5 text-sm font-medium"
                    :class="
                      isIntercepted
                        ? 'border-gray-300 text-gray-700 hover:bg-gray-100'
                        : 'border-amber-500 text-amber-700 hover:bg-amber-50'
                    "
                    @click="interceptConfirm = true"
                  >
                    {{
                      isIntercepted
                        ? t('admin.members.manage.unblock')
                        : t('admin.members.manage.block')
                    }}
                  </button>
                  <div v-else class="flex items-center gap-2">
                    <span class="text-sm text-gray-700">
                      {{
                        isIntercepted
                          ? t('admin.members.manage.confirmUnblock')
                          : t('admin.members.manage.confirmBlock')
                      }}
                    </span>
                    <button
                      type="button"
                      class="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      :disabled="interceptPending"
                      @click="confirmIntercept"
                    >
                      {{ t('admin.members.manage.confirm') }}
                    </button>
                    <button
                      type="button"
                      class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100"
                      @click="interceptConfirm = false"
                    >
                      {{ t('admin.members.manage.cancel') }}
                    </button>
                  </div>
                </div>
                <p v-if="interceptError !== null" class="mt-1 text-xs text-red-600">
                  {{ interceptError }}
                </p>
              </div>

              <!-- 레벨 변경 -->
              <div class="mt-4 border-t border-gray-200 pt-3">
                <label class="text-xs text-gray-500">{{ t('admin.members.manage.level') }}</label>
                <div class="mt-1 flex items-center gap-2">
                  <select
                    v-model.number="levelInput"
                    class="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option v-for="lv in 10" :key="lv" :value="lv">Lv.{{ lv }}</option>
                  </select>
                  <button
                    type="button"
                    class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    :disabled="!levelChanged || levelPending"
                    @click="submitLevel"
                  >
                    {{ t('admin.members.manage.levelSave') }}
                  </button>
                </div>
                <p v-if="levelError !== null" class="mt-1 text-xs text-red-600">{{ levelError }}</p>
                <p v-else-if="levelSaved" class="mt-1 text-xs text-green-700">
                  {{ t('admin.members.manage.levelSaveSuccess') }}
                </p>
              </div>
            </section>

            <!-- 그누보드 관리자에서 열기 -->
            <div class="mt-5">
              <a
                :href="gnuboardUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                {{ t('admin.members.drawer.openGnuboard') }} ↗
              </a>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
