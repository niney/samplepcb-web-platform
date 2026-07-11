<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  MARKET_BUDGET_RANGES,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CAD_TOOL_LABELS,
  MARKET_DEADLINE_PRESETS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_PROJECT_CAD_CODES,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  MarketRequestType,
  MarketServiceArea,
} from '@sp/api-contract';
import type {
  MarketBudgetRangeType,
  MarketProjectCadCodeType,
  MarketProjectMethodType,
  MarketRequestTypeType,
  MarketServiceAreaType,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { useMarketExpertList } from '../api/useMarketExperts';
import type { ExpertListFilters } from '../api/useMarketExperts';
import { useCreateProject } from '../api/useMarketProjects';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';

// 의뢰 마법사 5스텝(프로토타입 request.html 이식):
// 분야 → 요구 CAD('상관없음' 배타) → 설명·첨부·NDA → 예산·일정·마감 → 방식·지정 전문가.
// ?cat= 분야 프리셋, ?expert= 지정견적 프리셋(전문가 상세의 CTA 진입).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const create = useCreateProject();

const step = ref(1);
const submitError = ref('');
const createdId = ref<number | null>(null);
const typeNotice = ref('');

const presetServiceArea = ((): MarketServiceAreaType => {
  const area = MarketServiceArea.safeParse(route.query.cat);
  return area.success ? area.data : 'circuit';
})();
const presetExpertId = ((): number | null => {
  const n = Number(route.query.expert);
  return Number.isInteger(n) && n > 0 ? n : null;
})();

interface RequestForm {
  requestType: MarketRequestTypeType;
  serviceAreas: MarketServiceAreaType[];
  cadTools: MarketProjectCadCodeType[];
  title: string;
  description: string;
  ndaRequired: boolean;
  budgetRange: MarketBudgetRangeType;
  startHopeDate: string; // '' = 미정
  dueHopeDate: string;
  deadlineMode: '3' | '7' | '14' | 'date';
  deadlineDate: string;
  method: MarketProjectMethodType;
  targetExpertId: number | null;
}

const form = reactive<RequestForm>({
  requestType: 'individual',
  serviceAreas: [presetServiceArea],
  cadTools: ['any'],
  title: '',
  description: '',
  ndaRequired: true,
  budgetRange: 'r300_700',
  startHopeDate: '',
  dueHopeDate: '',
  deadlineMode: '7',
  deadlineDate: '',
  method: presetExpertId !== null ? 'targeted' : 'open',
  targetExpertId: presetExpertId,
});
const attachments = ref<File[]>([]);

// 지정 전문가 선택 목록(승인 전문가 전체 — 소규모 전제).
const expertFilters = ref<ExpertListFilters>({
  page: 1,
  pageSize: 100,
  expertType: '',
  serviceArea: '',
  category: '',
  cadTool: '',
  q: '',
});
const expertList = useMarketExpertList(expertFilters);

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

function pickAttachments(e: Event): void {
  const input = e.target as HTMLInputElement;
  attachments.value = input.files !== null ? Array.from(input.files) : [];
}

// '상관없음(any)'은 배타 — any 클릭 시 단독, 다른 툴 클릭 시 any 해제. 빈 선택은 any 로 복귀.
function toggleCad(code: MarketProjectCadCodeType): void {
  if (code === 'any') {
    form.cadTools = ['any'];
    return;
  }
  const next = form.cadTools.filter((c) => c !== 'any');
  const i = next.indexOf(code);
  if (i >= 0) next.splice(i, 1);
  else next.push(code);
  form.cadTools = next.length === 0 ? ['any'] : next;
}

function toggleServiceArea(code: MarketServiceAreaType): void {
  const i = form.serviceAreas.indexOf(code);
  if (i >= 0) form.serviceAreas.splice(i, 1);
  else form.serviceAreas.push(code);
  if (form.requestType === 'individual' && form.serviceAreas.length > 1) {
    form.requestType = 'system';
    typeNotice.value = '개발 분야를 여러 개 선택해 의뢰 유형이 시스템 통합 개발로 자동 변경되었습니다.';
  }
  if (!form.serviceAreas.includes('pcb')) form.cadTools = ['any'];
}

function selectRequestType(type: MarketRequestTypeType): void {
  form.requestType = type;
  typeNotice.value = '';
  if (type === 'individual' && form.serviceAreas.length > 1) {
    form.serviceAreas = [form.serviceAreas[0] ?? 'circuit'];
    typeNotice.value = '개별 분야 개발은 한 분야만 선택할 수 있어 첫 번째 분야만 유지했습니다.';
  }
}

const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const stepValid = computed<boolean>(() => {
  if (step.value === 1) return form.requestType === 'system' || form.serviceAreas.length === 1;
  if (step.value === 2) return true;
  if (step.value === 3) {
    return form.title.trim().length >= 2 && form.description.trim().length >= 10;
  }
  if (step.value === 4) {
    return form.deadlineMode !== 'date' || form.deadlineDate > todayKst || form.deadlineDate === todayKst;
  }
  return form.method === 'open' || form.targetExpertId !== null;
});

async function submit(): Promise<void> {
  submitError.value = '';
  const payload = {
    title: form.title.trim(),
    requestType: form.requestType,
    serviceAreas: form.serviceAreas,
    cadTools: form.cadTools,
    description: form.description.trim(),
    ndaRequired: form.ndaRequired,
    budgetRange: form.budgetRange,
    ...(form.startHopeDate !== '' ? { startHopeDate: form.startHopeDate } : {}),
    ...(form.dueHopeDate !== '' ? { dueHopeDate: form.dueHopeDate } : {}),
    deadline:
      form.deadlineMode === 'date'
        ? { date: form.deadlineDate }
        : { days: Number(form.deadlineMode) },
    method: form.method,
    ...(form.method === 'targeted' && form.targetExpertId !== null
      ? { targetExpertId: form.targetExpertId }
      : {}),
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const f of attachments.value) fd.append('attachment', f);
  try {
    const res = await create.mutateAsync(fd);
    createdId.value = res.data.projectId;
  } catch (err) {
    submitError.value = errorMessage(err);
  }
}

const stepTitles = [
  { no: 1, label: '분야' },
  { no: 2, label: 'CAD' },
  { no: 3, label: '설명·자료' },
  { no: 4, label: '예산·일정' },
  { no: 5, label: '견적 방식' },
];

const requestTypeDescs: Record<MarketRequestTypeType, string> = {
  system: '여러 개발 분야를 연결해 제품 또는 시스템 전체를 개발합니다.',
  individual: '필요한 개발 분야를 하나 이상 선택해 의뢰합니다.',
};
</script>

<template>
  <section class="mx-auto w-full max-w-3xl px-4 py-10">
    <p class="font-mono text-[11px] tracking-widest text-tx-3">NEW REQUEST</p>
    <h1 class="mt-1 text-2xl font-extrabold text-tx-1">{{ $t('nav.request') }}</h1>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-sm text-tx-2">프로젝트 의뢰는 로그인 후 진행할 수 있습니다.</p>
      <button
        type="button"
        class="mt-4 rounded-lg bg-ink-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
        @click="goLogin"
      >
        {{ $t('auth.login') }}
      </button>
    </div>

    <!-- 완료 -->
    <div v-else-if="createdId !== null" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center">
      <p class="text-3xl">🎉</p>
      <h2 class="mt-3 text-lg font-extrabold text-tx-1">의뢰가 등록되었습니다</h2>
      <p class="mt-2 text-sm leading-relaxed text-tx-2">
        <template v-if="form.method === 'targeted'">지정한 전문가에게 견적 요청을 알렸습니다.</template>
        <template v-else>조건이 맞는 전문가들이 블라인드 견적을 제출하면 알려드립니다.</template>
        <br>견적 비교·채택은 프로젝트 상세 또는 마이페이지에서 진행하세요.
      </p>
      <div class="mt-5 flex justify-center gap-2">
        <RouterLink
          :to="`/projects/${String(createdId)}`"
          class="rounded-lg bg-copper-500 px-4 py-2 text-xs font-bold text-white hover:bg-copper-600"
        >
          프로젝트 확인
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
      <ol class="mt-6 flex flex-wrap items-center gap-2 text-xs font-bold">
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
          <span v-if="s.no < 5" class="text-line-2">─</span>
        </li>
      </ol>

      <div class="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <!-- STEP 1: 분야 -->
        <div v-if="step === 1" class="grid gap-6">
          <div>
            <p class="text-xs font-bold text-tx-2">의뢰 유형 <span class="text-red-500">*</span></p>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <button v-for="type in MarketRequestType.options" :key="type" type="button" class="rounded-2xl border-2 p-5 text-left transition" :class="form.requestType === type ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'" @click="selectRequestType(type)">
                <p class="text-sm font-extrabold text-tx-1">{{ MARKET_REQUEST_TYPE_LABELS[type] }}</p>
                <p class="mt-1.5 text-xs leading-relaxed text-tx-2">{{ requestTypeDescs[type] }}</p>
              </button>
            </div>
          </div>
          <div>
            <p class="text-xs font-bold text-tx-2">필요한 개발 분야 <span class="font-normal text-tx-3">(복수 선택)</span> <span class="text-red-500">*</span></p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button v-for="area in MarketServiceArea.options" :key="area" type="button" class="rounded-full border px-3 py-2 text-xs font-semibold transition" :class="form.serviceAreas.includes(area) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'" @click="toggleServiceArea(area)">
                {{ MARKET_SERVICE_AREA_LABELS[area] }}
              </button>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-tx-3">시스템 통합 개발은 분야를 선택하지 않아도 등록할 수 있습니다. 개별 분야 개발에서 두 개 이상 선택하면 시스템 통합 개발로 자동 변경됩니다.</p>
            <p v-if="typeNotice !== ''" class="mt-2 rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">{{ typeNotice }}</p>
          </div>
        </div>

        <!-- STEP 2: 요구 CAD -->
        <div v-else-if="step === 2">
          <p v-if="form.serviceAreas.includes('pcb')" class="text-xs font-bold text-tx-2">
            요구 CAD 툴 <span class="font-normal text-tx-3">(복수 선택 · '상관없음'은 단독)</span>
          </p>
          <div v-if="form.serviceAreas.includes('pcb')" class="mt-3 flex flex-wrap gap-1.5">
            <button
              v-for="c in MARKET_PROJECT_CAD_CODES"
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
              {{ MARKET_CAD_TOOL_LABELS[c] }}
            </button>
          </div>
          <p class="mt-3 text-xs text-tx-3">
            {{ form.serviceAreas.includes('pcb') ? '특정 CAD가 없다면 상관없음을 선택하세요.' : 'PCB 설계를 선택하지 않아 CAD 조건을 건너뜁니다.' }}
          </p>
        </div>

        <!-- STEP 3: 설명·자료·NDA -->
        <div v-else-if="step === 3" class="grid gap-4">
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            프로젝트 제목 <span class="text-red-500">*</span>
            <input
              v-model="form.title"
              type="text"
              placeholder="예: BLE 웨어러블 심박 모니터 회로 개발"
              class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
            >
          </label>
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            상세 설명 <span class="text-red-500">*</span>
            <textarea
              v-model="form.description"
              rows="7"
              placeholder="제품/문제 배경, 필요한 기능·성능 목표, 기대 산출물(회로도·펌웨어·거버 등)을 적어주세요. (10자 이상)"
              class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
            />
          </label>
          <label class="grid gap-1.5 text-xs font-bold text-tx-2">
            참고 자료 첨부 <span class="font-normal text-tx-3">(선택 · 여러 개 가능)</span>
            <input type="file" multiple class="text-xs font-normal" @change="pickAttachments">
            <span v-if="attachments.length > 0" class="font-normal text-tx-3">
              {{ attachments.length }}개 선택됨
            </span>
          </label>
          <p v-if="attachments.length === 0" class="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
            ⚠ 개발기능명세서나 아이디어 설명자료가 없으면 정확한 견적을 받기 어렵습니다.
            자료 준비가 어려우면 유선 상담(070-8667-1080)을 이용해 주세요.
          </p>
          <label class="flex items-start gap-2 rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
            <input v-model="form.ndaRequired" type="checkbox" class="mt-0.5">
            <span>
              <b class="text-tx-1">🔏 NDA 보호</b> — 첨부 자료를 NDA에 전자서명한 전문가만
              열람하도록 잠급니다. (권장)
            </span>
          </label>
        </div>

        <!-- STEP 4: 예산·일정·마감 -->
        <div v-else-if="step === 4" class="grid gap-5">
          <div>
            <p class="text-xs font-bold text-tx-2">예산 범위 <span class="text-red-500">*</span></p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <button
                v-for="b in MARKET_BUDGET_RANGES"
                :key="b"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.budgetRange === b
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="form.budgetRange = b"
              >
                {{ MARKET_BUDGET_RANGE_LABELS[b] }}
              </button>
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              시작 희망일 <span class="font-normal text-tx-3">(선택)</span>
              <input v-model="form.startHopeDate" type="date" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
            </label>
            <label class="grid gap-1.5 text-xs font-bold text-tx-2">
              완료 희망일 <span class="font-normal text-tx-3">(선택)</span>
              <input v-model="form.dueHopeDate" type="date" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
            </label>
          </div>
          <div>
            <p class="text-xs font-bold text-tx-2">견적 마감 <span class="text-red-500">*</span></p>
            <div class="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                v-for="d in MARKET_DEADLINE_PRESETS"
                :key="d"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.deadlineMode === String(d)
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="form.deadlineMode = String(d) as '3' | '7' | '14'"
              >
                {{ d }}일 뒤
              </button>
              <button
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.deadlineMode === 'date'
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="form.deadlineMode = 'date'"
              >
                날짜 지정
              </button>
              <input
                v-if="form.deadlineMode === 'date'"
                v-model="form.deadlineDate"
                type="date"
                :min="todayKst"
                class="h-9 rounded-lg border border-line px-3 text-xs"
              >
            </div>
            <p class="mt-2 text-xs text-tx-3">마감 시각은 해당 일 23:59(KST)입니다. 마감 전에는 언제든 조기 마감할 수 있습니다.</p>
          </div>
        </div>

        <!-- STEP 5: 방식·지정 전문가·요약 -->
        <div v-else class="grid gap-5">
          <div class="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              class="rounded-2xl border-2 p-5 text-left transition"
              :class="form.method === 'open' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
              @click="form.method = 'open'"
            >
              <p class="text-sm font-extrabold text-tx-1">역견적 (공개 입찰) <span class="ml-1 rounded bg-copper-500 px-1.5 py-0.5 text-[10px] font-bold text-white">추천</span></p>
              <p class="mt-1.5 text-xs leading-relaxed text-tx-2">
                조건이 맞는 전문가들이 블라인드로 견적을 제출합니다. 견적은 나만 볼 수 있습니다.
              </p>
            </button>
            <button
              type="button"
              class="rounded-2xl border-2 p-5 text-left transition"
              :class="form.method === 'targeted' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
              @click="form.method = 'targeted'"
            >
              <p class="text-sm font-extrabold text-tx-1">지정견적 (1:1)</p>
              <p class="mt-1.5 text-xs leading-relaxed text-tx-2">
                원하는 전문가 한 명에게만 견적을 요청합니다.
              </p>
            </button>
          </div>

          <!-- 지정 전문가 선택 -->
          <div v-if="form.method === 'targeted'">
            <p class="text-xs font-bold text-tx-2">작업자 선택 <span class="text-red-500">*</span></p>
            <div class="mt-2 grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-line p-2">
              <label
                v-for="e in expertList.data.value?.data.items ?? []"
                :key="e.expertId"
                class="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm"
                :class="form.targetExpertId === e.expertId ? 'bg-copper-50' : 'hover:bg-paper'"
              >
                <input
                  v-model="form.targetExpertId"
                  type="radio"
                  name="targetExpert"
                  :value="e.expertId"
                >
                <span class="font-bold text-tx-1">{{ e.displayName }}</span>
                <span class="text-xs text-tx-3">{{ MARKET_EXPERT_TYPE_LABELS[e.expertType] }}</span>
              </label>
              <p
                v-if="(expertList.data.value?.data.items ?? []).length === 0"
                class="p-3 text-center text-xs text-tx-3"
              >
                선택할 수 있는 전문가가 없습니다.
              </p>
            </div>
          </div>

          <!-- 요약 -->
          <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
            <p><b class="text-tx-1">{{ form.title || '(제목 미입력)' }}</b></p>
            <p class="mt-1">
              {{ MARKET_REQUEST_TYPE_LABELS[form.requestType] }} ·
              {{ form.serviceAreas.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join('/') }} ·
              {{ form.cadTools.map((c) => MARKET_CAD_TOOL_LABELS[c]).join('/') }} ·
              {{ MARKET_BUDGET_RANGE_LABELS[form.budgetRange] }} ·
              마감 {{ form.deadlineMode === 'date' ? form.deadlineDate : `${form.deadlineMode}일 뒤` }} ·
              {{ form.ndaRequired ? 'NDA 보호' : 'NDA 없음' }} ·
              첨부 {{ attachments.length }}개
            </p>
          </div>
        </div>

        <p v-if="submitError !== ''" class="mt-4 text-xs font-semibold text-red-600">{{ submitError }}</p>
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
            v-if="step < 5"
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
            :disabled="!stepValid || create.isPending.value"
            @click="submit"
          >
            {{ create.isPending.value ? '등록 중…' : '의뢰 등록' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
