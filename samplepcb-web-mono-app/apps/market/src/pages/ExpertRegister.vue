<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import {
  MARKET_ACTIVE_CATEGORIES,
  MARKET_CAREER_RANGES,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_EXPERT_STATUS_LABELS,
  MARKET_REGIONS,
  MARKET_SERVICE_AREAS,
  MARKET_SERVICE_AREA_LABELS,
  MARKET_REGION_LABELS,
  MARKET_TOOL_GROUPS,
  MARKET_TOOL_GROUP_CODES,
  MARKET_TOOL_GROUP_LABELS,
  MARKET_TOOL_LABELS,
  MARKET_TRAVEL_RANGES,
  MARKET_TRAVEL_RANGE_LABELS,
} from '@sp/api-contract';
import type {
  MarketToolCodeType,
  MarketCareerRangeType,
  MarketCategoryCodeType,
  MarketRegionType,
  MarketServiceAreaType,
  MarketTravelRangeType,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { useExpertMe, useRegisterExpert } from '../api/useMarketExpertMe';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';

// 전문가 등록 4스텝 마법사(프로토타입 expert-register.html 이식).
// 유형 → 기본 정보 → 분야·증빙 → 정산·약관. 제출은 multipart(payload + 증빙 파일들).

const auth = useAuthStore();
const loggedIn = computed(() => auth.isLoggedIn);
const meQuery = useExpertMe(loggedIn);
const register = useRegisterExpert();

const step = ref(1);
const done = ref(false);
const submitError = ref('');

const BANKS = ['KB국민', '신한', '우리', '하나', 'IBK기업', '카카오뱅크', '토스뱅크', '기타'];

interface RegisterForm {
  expertType: 'individual' | 'company';
  displayName: string;
  phone: string;
  careerRange: MarketCareerRangeType;
  contactHours: string;
  region: MarketRegionType;
  travelRange: MarketTravelRangeType;
  intro: string;
  serviceAreas: MarketServiceAreaType[];
  categories: MarketCategoryCodeType[];
  cadTools: MarketToolCodeType[];
  bankName: string;
  bankHolder: string;
  bankAccount: string;
  termsAgree: boolean;
}

const form = reactive<RegisterForm>({
  expertType: 'individual',
  displayName: '',
  phone: '',
  careerRange: 'r5_10',
  contactHours: '09:00 ~ 18:00',
  region: 'seoul',
  travelRange: 'within30km',
  intro: '',
  serviceAreas: [],
  categories: [],
  cadTools: [],
  bankName: 'KB국민',
  bankHolder: '',
  bankAccount: '',
  termsAgree: false,
});
const licenseFiles = ref<File[]>([]);
const portfolioFiles = ref<File[]>([]);
const bizregFile = ref<File | null>(null);

function goLogin(): void {
  window.location.assign(loginUrl(marketPath('/expert/register')));
}

function pickFiles(e: Event, kind: 'license' | 'portfolio' | 'bizreg'): void {
  const input = e.target as HTMLInputElement;
  const files = input.files !== null ? Array.from(input.files) : [];
  if (kind === 'license') licenseFiles.value = files;
  else if (kind === 'portfolio') portfolioFiles.value = files;
  else bizregFile.value = files[0] ?? null;
}

function toggleCategory(code: MarketCategoryCodeType): void {
  const i = form.categories.indexOf(code);
  if (i >= 0) form.categories.splice(i, 1);
  else form.categories.push(code);
}
function toggleServiceArea(code: MarketServiceAreaType): void {
  const i = form.serviceAreas.indexOf(code);
  if (i >= 0) form.serviceAreas.splice(i, 1);
  else form.serviceAreas.push(code);
}
function toggleCad(code: MarketToolCodeType): void {
  const i = form.cadTools.indexOf(code);
  if (i >= 0) form.cadTools.splice(i, 1);
  else form.cadTools.push(code);
}

const stepValid = computed<boolean>(() => {
  if (step.value === 1) return true;
  if (step.value === 2) {
    return (
      form.displayName.trim().length >= 2 &&
      /^[0-9+\-() ]{9,50}$/.test(form.phone.trim()) &&
      form.intro.trim().length >= 10
    );
  }
  if (step.value === 3) {
    const hasSkill = form.serviceAreas.length > 0;
    const bizOk = form.expertType !== 'company' || bizregFile.value !== null;
    return hasSkill && bizOk;
  }
  return (
    form.bankHolder.trim() !== '' &&
    /^[0-9-]{6,50}$/.test(form.bankAccount.trim()) &&
    form.termsAgree
  );
});

async function submit(): Promise<void> {
  submitError.value = '';
  const contactHours = form.contactHours.trim();
  const payload = {
    expertType: form.expertType,
    displayName: form.displayName.trim(),
    phone: form.phone.trim(),
    careerRange: form.careerRange,
    ...(contactHours !== '' ? { contactHours } : {}),
    region: form.region,
    travelRange: form.travelRange,
    intro: form.intro.trim(),
    serviceAreas: form.serviceAreas,
    categories: form.categories,
    cadTools: form.cadTools,
    bankName: form.bankName,
    bankHolder: form.bankHolder.trim(),
    bankAccount: form.bankAccount.trim(),
    termsAgree: true,
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const f of licenseFiles.value) fd.append('license', f);
  for (const f of portfolioFiles.value) fd.append('portfolio', f);
  if (form.expertType === 'company' && bizregFile.value !== null) {
    fd.append('bizreg', bizregFile.value);
  }
  try {
    await register.mutateAsync(fd);
    done.value = true;
  } catch (err) {
    submitError.value = errorMessage(err);
  }
}

const stepTitles = computed(() => [
  { no: 1, label: '유형' },
  { no: 2, label: '기본 정보' },
  { no: 3, label: '분야·증빙' },
  { no: 4, label: '정산·약관' },
]);
</script>

<template>
  <section class="mx-auto w-full max-w-3xl px-4 py-10">
    <p class="font-mono text-[11px] tracking-widest text-tx-3">EXPERT ONBOARDING</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('nav.expertRegister') }}</h1>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-sm text-tx-2">전문가 등록은 로그인 후 진행할 수 있습니다.</p>
      <button
        type="button"
        class="mt-4 rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
        @click="goLogin"
      >
        {{ $t('auth.login') }}
      </button>
    </div>

    <!-- 이미 등록됨 -->
    <div
      v-else-if="meQuery.data.value !== undefined"
      class="mt-8 rounded-2xl border border-line bg-white p-10 text-center"
    >
      <p class="text-base font-bold text-tx-1">이미 전문가 등록 이력이 있습니다.</p>
      <p class="mt-2 text-sm text-tx-2">
        현재 상태:
        <span class="font-bold text-copper-600">
          {{ MARKET_EXPERT_STATUS_LABELS[meQuery.data.value.data.status] }}
        </span>
      </p>
      <RouterLink
        to="/me"
        class="mt-4 inline-block rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
      >
        {{ $t('nav.me') }}
      </RouterLink>
    </div>

    <!-- 완료 -->
    <div v-else-if="done" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-3xl">✅</p>
      <h2 class="mt-3 text-lg font-extrabold text-tx-1">전문가 등록 신청이 완료되었습니다</h2>
      <p class="mt-2 text-sm leading-relaxed text-tx-2">
        심사는 보통 1~2일 소요되며 결과는 이메일로 안내드립니다.<br>
        승인되면 공개 프로젝트 입찰과 지정견적 수신이 가능합니다.
      </p>
      <div class="mt-5 flex justify-center gap-2">
        <RouterLink
          to="/projects"
          class="rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
        >
          {{ $t('nav.projects') }}
        </RouterLink>
        <RouterLink
          to="/me"
          class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
        >
          {{ $t('nav.me') }}
        </RouterLink>
      </div>
    </div>

    <!-- 마법사 -->
    <template v-else>
      <!-- 스텝 인디케이터 -->
      <ol class="mt-6 flex items-center gap-2 text-xs font-bold">
        <li v-for="s in stepTitles" :key="s.no" class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full"
            :class="
              step === s.no
                ? 'bg-copper-500 text-white'
                : step > s.no
                  ? 'bg-ink-900 text-white'
                  : 'bg-line text-tx-3'
            "
          >
            {{ s.no }}
          </span>
          <span :class="step === s.no ? 'text-tx-1' : 'text-tx-3'">{{ s.label }}</span>
          <span v-if="s.no < 4" class="text-line-2">─</span>
        </li>
      </ol>

      <div class="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <!-- STEP 1: 유형 -->
        <div v-if="step === 1" class="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            class="rounded-2xl border-2 p-5 text-left transition"
            :class="form.expertType === 'individual' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="form.expertType = 'individual'"
          >
            <p class="text-sm font-extrabold text-tx-1">개인 (프리랜서)</p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">
              지정 3번 · 정산 시 원천징수 3.3% · 본인 명의 계좌
            </p>
          </button>
          <button
            type="button"
            class="rounded-2xl border-2 p-5 text-left transition"
            :class="form.expertType === 'company' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="form.expertType = 'company'"
          >
            <p class="text-sm font-extrabold text-tx-1">기업 (파트너사)</p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">
              지정 2번 · 세금계산서 발행 · 사업자등록증 필수
            </p>
          </button>
        </div>

        <!-- STEP 2: 기본 정보 -->
        <div v-else-if="step === 2" class="grid gap-4">
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            이름/상호 <span class="text-red-500">*</span>
            <input
              v-model="form.displayName"
              type="text"
              placeholder="홍길동 또는 ㈜회사명"
              class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
            >
          </label>
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            연락처 <span class="text-red-500">*</span>
            <input
              v-model="form.phone"
              type="tel"
              placeholder="010-0000-0000"
              class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
            >
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              경력
              <select v-model="form.careerRange" class="h-10 rounded-lg border border-line px-2 text-sm font-normal">
                <option v-for="c in MARKET_CAREER_RANGES" :key="c" :value="c">
                  {{ MARKET_CAREER_RANGE_LABELS[c] }}
                </option>
              </select>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              통화 가능시간
              <input
                v-model="form.contactHours"
                type="text"
                class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
              >
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              활동 지역
              <select v-model="form.region" class="h-10 rounded-lg border border-line px-2 text-sm font-normal">
                <option v-for="r in MARKET_REGIONS" :key="r" :value="r">
                  {{ MARKET_REGION_LABELS[r] }}
                </option>
              </select>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              미팅 이동 가능 거리
              <select v-model="form.travelRange" class="h-10 rounded-lg border border-line px-2 text-sm font-normal">
                <option v-for="t in MARKET_TRAVEL_RANGES" :key="t" :value="t">
                  {{ MARKET_TRAVEL_RANGE_LABELS[t] }}
                </option>
              </select>
            </label>
          </div>
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            내 소개 <span class="text-red-500">*</span>
            <textarea
              v-model="form.intro"
              rows="5"
              placeholder="전문 분야, 대표 프로젝트, 작업 방식을 소개해 주세요. (10자 이상 — 승인 시 프로필에 공개됩니다)"
              class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
            />
          </label>
        </div>

        <!-- STEP 3: 분야·증빙 -->
        <div v-else-if="step === 3" class="grid gap-6">
          <div>
            <p class="text-xs font-bold text-tx-2">제공 가능한 개발 분야 <span class="font-normal text-tx-3">(복수 선택)</span> <span class="text-red-500">*</span></p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button v-for="area in MARKET_SERVICE_AREAS" :key="area" type="button" class="rounded-full border px-3 py-1.5 text-xs font-semibold transition" :class="form.serviceAreas.includes(area) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'" @click="toggleServiceArea(area)">{{ MARKET_SERVICE_AREA_LABELS[area] }}</button>
            </div>
            <p v-if="form.serviceAreas.length === 0" class="mt-2 text-xs text-red-500">개발 분야를 1개 이상 선택해 주세요.</p>
          </div>
          <div>
            <p class="text-xs font-bold text-tx-2">
              세부분야 (회로·펌웨어) <span class="font-normal text-tx-3">(복수 선택)</span>
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="c in MARKET_ACTIVE_CATEGORIES"
                :key="c"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.categories.includes(c)
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="toggleCategory(c)"
              >
                {{ MARKET_CATEGORY_LABELS[c] }}
              </button>
            </div>
          </div>
          <div v-for="g in MARKET_TOOL_GROUPS" :key="g">
            <p class="text-xs font-bold text-tx-2">
              {{ MARKET_TOOL_GROUP_LABELS[g] }} <span class="font-normal text-tx-3">(복수 선택)</span>
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="c in MARKET_TOOL_GROUP_CODES[g]"
                :key="c"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.cadTools.includes(c)
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="toggleCad(c)"
              >
                {{ MARKET_TOOL_LABELS[c] }}
              </button>
            </div>
          </div>
          <div class="grid gap-3">
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              자격증·경력 증빙 <span class="font-normal text-tx-3">(선택 · 심사 우대)</span>
              <input type="file" multiple class="text-xs font-normal" @change="pickFiles($event, 'license')">
              <span v-if="licenseFiles.length > 0" class="font-normal text-tx-3">
                {{ licenseFiles.length }}개 선택됨
              </span>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              대표 포트폴리오 <span class="font-normal text-tx-3">(선택)</span>
              <input type="file" multiple class="text-xs font-normal" @change="pickFiles($event, 'portfolio')">
              <span v-if="portfolioFiles.length > 0" class="font-normal text-tx-3">
                {{ portfolioFiles.length }}개 선택됨
              </span>
            </label>
            <label v-if="form.expertType === 'company'" class="grid gap-1.5 text-xs font-bold text-tx-2">
              사업자등록증 <span class="text-red-500">*</span>
              <input type="file" class="text-xs font-normal" @change="pickFiles($event, 'bizreg')">
              <span v-if="bizregFile !== null" class="font-normal text-tx-3">{{ bizregFile.name }}</span>
            </label>
          </div>
        </div>

        <!-- STEP 4: 정산·약관 -->
        <div v-else class="grid gap-4">
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              은행 <span class="text-red-500">*</span>
              <select v-model="form.bankName" class="h-10 rounded-lg border border-line px-2 text-sm font-normal">
                <option v-for="b in BANKS" :key="b" :value="b">{{ b }}</option>
              </select>
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              예금주 <span class="text-red-500">*</span>
              <input v-model="form.bankHolder" type="text" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              계좌번호 <span class="text-red-500">*</span>
              <input
                v-model="form.bankAccount"
                type="text"
                placeholder="숫자·'-'만"
                class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
              >
            </label>
          </div>
          <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
            플랫폼 중개 수수료는 <b class="text-tx-1">거래액의 10%</b>이며, 검수 승인 후 정산됩니다.
            정산 계좌는 심사·정산 목적으로만 사용되고 공개되지 않습니다.
          </div>
          <label class="flex items-start gap-2 text-xs leading-relaxed text-tx-2">
            <input v-model="form.termsAgree" type="checkbox" class="mt-0.5">
            <span>
              <b class="text-tx-1">약관 및 프로필 공개 동의</b> — 재능마켓 이용약관과 개인정보 처리에
              동의하며, 승인 시 프로필(이름/상호·경력·지역·분야·소개)이 공개되는 것에 동의합니다.
            </span>
          </label>
        </div>

        <!-- 에러 + 내비게이션 -->
        <p v-if="submitError !== ''" class="mt-4 text-xs font-semibold text-red-600">
          {{ submitError }}
        </p>
        <div class="mt-6 flex items-center justify-between border-t border-line pt-5">
          <button
            v-if="step > 1"
            type="button"
            class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
            @click="step -= 1"
          >
            이전
          </button>
          <span v-else />
          <button
            v-if="step < 4"
            type="button"
            class="rounded-lg bg-ink-900 px-5 py-2 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
            :disabled="!stepValid"
            @click="step += 1"
          >
            다음
          </button>
          <button
            v-else
            type="button"
            class="rounded-lg bg-copper-500 px-5 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
            :disabled="!stepValid || register.isPending.value"
            @click="submit"
          >
            {{ register.isPending.value ? '신청 중…' : '등록 신청' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
