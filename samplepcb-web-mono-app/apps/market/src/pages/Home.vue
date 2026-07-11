<script setup lang="ts">
import { ref } from 'vue';
import ExpertCard from '../components/ExpertCard.vue';
import ProjectCard from '../components/ProjectCard.vue';
import { useMarketExpertList } from '../api/useMarketExperts';
import type { ExpertListFilters } from '../api/useMarketExperts';
import { useMarketProjectList } from '../api/useMarketProjects';
import type { ProjectListFilters } from '../api/useMarketProjects';

// 홈은 실데이터만 보여준다 — 프로토타입의 장식용 하드코딩 수치(43건·312명 등)는
// 채택하지 않는다(분석 보고 "부록 3" 결정).
const projectFilters = ref<ProjectListFilters>({
  page: 1,
  pageSize: 6,
  tab: 'open',
  requestType: '',
  serviceArea: '',
  method: '',
  q: '',
  sort: 'latest',
});
const { data: projectData } = useMarketProjectList(projectFilters);

const expertFilters = ref<ExpertListFilters>({
  page: 1,
  pageSize: 4,
  expertType: '',
  serviceArea: '',
  category: '',
  cadTool: '',
  q: '',
});
const { data: expertData } = useMarketExpertList(expertFilters);

const categories = [
  { code: 'circuit', title: '회로개발', desc: '아두이노 · 펌웨어 · RF · 전원 등 18개 분야' },
  { code: 'pcb', title: 'PCB 설계', desc: 'Altium · PADS · OrCAD · KiCad ArtWork' },
  { code: 'firmware', title: '펌웨어 개발', desc: 'MCU · 임베디드 · 제어 소프트웨어' },
] as const;

const steps = [
  { no: '01', title: '프로젝트 의뢰', desc: '개발 명세와 예산·일정을 등록합니다. NDA로 자료를 보호할 수 있습니다.' },
  { no: '02', title: '블라인드 견적', desc: '조건이 맞는 전문가들이 견적을 제출합니다. 견적은 의뢰인만 볼 수 있습니다.' },
  { no: '03', title: '비교·채택', desc: '금액·기간·제안을 비교하고 전문가를 선정합니다.' },
  { no: '04', title: '작업·정산', desc: '검수 승인 후 대금이 지급되는 안전정산을 준비 중입니다.' },
] as const;
</script>

<template>
  <div>
    <!-- 히어로 -->
    <section class="relative overflow-hidden bg-ink-950">
      <!-- 실크스크린 레퍼런스 라벨 모티프 -->
      <span class="pointer-events-none absolute left-[8%] top-10 font-mono text-xs text-white/15">U1</span>
      <span class="pointer-events-none absolute right-[12%] top-16 font-mono text-xs text-white/15">J3</span>
      <span class="pointer-events-none absolute bottom-12 left-[18%] font-mono text-xs text-white/15">R7</span>
      <span class="pointer-events-none absolute bottom-20 right-[8%] font-mono text-xs text-white/15">C4</span>
      <div class="mx-auto w-full max-w-6xl px-4 py-20 text-center sm:py-24">
        <p class="font-mono text-xs font-bold tracking-[0.35em] text-copper-400">PCB TALENT MARKET</p>
        <h1 class="mx-auto mt-4 max-w-2xl text-3xl font-extrabold leading-tight tracking-tight text-dk-tx-1 sm:text-4xl">
          {{ $t('home.heroTitle') }}
        </h1>
        <p class="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-dk-tx-2 sm:text-base">
          {{ $t('home.heroSubtitle') }}
        </p>
        <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
          <RouterLink
            to="/request"
            class="rounded-lg bg-copper-500 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-copper-600"
          >
            {{ $t('nav.request') }}
          </RouterLink>
          <RouterLink
            to="/projects"
            class="rounded-lg border border-white/25 px-6 py-3 text-sm font-bold text-dk-tx-1 transition hover:bg-white/10"
          >
            {{ $t('home.browseProjects') }}
          </RouterLink>
        </div>
        <div class="mt-10 flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold text-dk-tx-2">
          <span class="rounded-full border border-white/15 px-3 py-1">🔒 블라인드 견적</span>
          <span class="rounded-full border border-white/15 px-3 py-1">🔏 전자 NDA</span>
          <span class="rounded-full border border-white/15 px-3 py-1">🏭 제조·양산 연계</span>
        </div>
      </div>
    </section>

    <!-- 분야 진입 -->
    <section class="mx-auto w-full max-w-6xl px-4 pt-14">
      <div class="grid gap-4 sm:grid-cols-3">
        <RouterLink
          v-for="c in categories"
          :key="c.code"
          :to="{ path: '/request', query: { cat: c.code } }"
          class="group rounded-2xl border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:border-copper-400 hover:shadow-lg"
        >
          <p class="font-mono text-[11px] tracking-widest text-tx-3">{{ c.code.toUpperCase() }}</p>
          <h3 class="mt-2 text-lg font-bold text-tx-1 group-hover:text-copper-600">{{ c.title }}</h3>
          <p class="mt-1.5 text-xs leading-relaxed text-tx-2">{{ c.desc }}</p>
          <p class="mt-4 text-xs font-bold text-copper-500">의뢰하기 →</p>
        </RouterLink>
      </div>
    </section>

    <!-- 최근 프로젝트 -->
    <section class="mx-auto w-full max-w-6xl px-4 pt-14">
      <div class="flex items-end justify-between">
        <div>
          <p class="font-mono text-[11px] tracking-widest text-tx-3">LIVE PROJECTS</p>
          <h2 class="mt-1 text-xl font-extrabold text-tx-1">{{ $t('home.recentProjects') }}</h2>
        </div>
        <RouterLink to="/projects" class="text-xs font-bold text-copper-600 hover:text-copper-700">
          {{ $t('common.more') }} →
        </RouterLink>
      </div>
      <div
        v-if="projectData !== undefined && projectData.data.items.length > 0"
        class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <ProjectCard v-for="p in projectData.data.items" :key="p.projectId" :item="p" />
      </div>
      <div v-else class="mt-5 rounded-2xl border border-dashed border-line-2 bg-white p-10 text-center">
        <p class="text-sm text-tx-3">{{ $t('home.noProjects') }}</p>
        <RouterLink
          to="/request"
          class="mt-4 inline-block rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
        >
          {{ $t('home.beFirst') }}
        </RouterLink>
      </div>
    </section>

    <!-- 전문가 하이라이트 -->
    <section class="mx-auto w-full max-w-6xl px-4 pt-14">
      <div class="flex items-end justify-between">
        <div>
          <p class="font-mono text-[11px] tracking-widest text-tx-3">EXPERTS</p>
          <h2 class="mt-1 text-xl font-extrabold text-tx-1">{{ $t('home.experts') }}</h2>
        </div>
        <RouterLink to="/experts" class="text-xs font-bold text-copper-600 hover:text-copper-700">
          {{ $t('common.more') }} →
        </RouterLink>
      </div>
      <div
        v-if="expertData !== undefined && expertData.data.items.length > 0"
        class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <ExpertCard v-for="e in expertData.data.items" :key="e.expertId" :item="e" />
      </div>
      <div v-else class="mt-5 rounded-2xl border border-dashed border-line-2 bg-white p-10 text-center">
        <p class="text-sm text-tx-3">{{ $t('home.noExperts') }}</p>
        <RouterLink
          to="/expert/register"
          class="mt-4 inline-block rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
        >
          {{ $t('nav.expertRegister') }}
        </RouterLink>
      </div>
    </section>

    <!-- 이용 방법 -->
    <section id="how" class="mx-auto w-full max-w-6xl scroll-mt-20 px-4 pt-16">
      <p class="font-mono text-[11px] tracking-widest text-tx-3">HOW IT WORKS</p>
      <h2 class="mt-1 text-xl font-extrabold text-tx-1">{{ $t('home.how') }}</h2>
      <div class="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="s in steps" :key="s.no" class="rounded-2xl border border-line bg-white p-5">
          <p class="font-mono text-xs font-bold text-copper-500">{{ s.no }}</p>
          <h3 class="mt-2 text-sm font-bold text-tx-1">{{ s.title }}</h3>
          <p class="mt-1.5 text-xs leading-relaxed text-tx-2">{{ s.desc }}</p>
        </div>
      </div>
    </section>

    <!-- 신뢰 밴드 -->
    <section class="mx-auto mt-16 w-full max-w-6xl px-4">
      <div class="relative overflow-hidden rounded-3xl bg-ink-900 px-6 py-12 text-center sm:px-12">
        <span class="pointer-events-none absolute left-6 top-6 font-mono text-xs text-white/10">SMT1</span>
        <span class="pointer-events-none absolute bottom-6 right-6 font-mono text-xs text-white/10">PCB2</span>
        <h2 class="text-xl font-extrabold text-dk-tx-1">{{ $t('home.trustTitle') }}</h2>
        <div class="mt-6 grid gap-6 text-left sm:grid-cols-3">
          <div>
            <p class="text-sm font-bold text-copper-400">블라인드 역견적</p>
            <p class="mt-1.5 text-xs leading-relaxed text-dk-tx-2">
              제출된 견적은 의뢰인만 볼 수 있어 가격 눈치보기 없이 공정하게 경쟁합니다.
            </p>
          </div>
          <div>
            <p class="text-sm font-bold text-copper-400">전자 NDA 게이트</p>
            <p class="mt-1.5 text-xs leading-relaxed text-dk-tx-2">
              첨부 자료는 NDA에 서명한 전문가만 열람합니다. 서명 기록이 남습니다.
            </p>
          </div>
          <div>
            <p class="text-sm font-bold text-copper-400">아이디어에서 양산까지</p>
            <p class="mt-1.5 text-xs leading-relaxed text-dk-tx-2">
              개발이 끝나면 샘플피씨비의 PCB 제작·SMT 라인으로 바로 이어집니다.
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
