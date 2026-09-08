<script setup lang="ts">
import { ref } from 'vue';
import { DEVELOP_INDIVIDUAL_AREAS, DEVELOP_INDIVIDUAL_TAG, DEVELOP_SYSTEM_MENU } from '@sp/api-contract';
import { AreaIcon } from '@sp/ui';

// 개발의뢰 랜딩 — 로그인 여부와 무관한 공개 페이지.
// 구성: 히어로 → 개발 메뉴 5(#areas) → 진행 방식 7단계(#how, 레거시 estimate.php 계승)
//      → 왜 직접 개발인가 → 자주 묻는 질문 → 하단 CTA.
// 메뉴는 위저드 1스텝과 **같은 계약**에서 온다(시스템개발 + 개별 견적 4분야) — 분야가 늘어도 이 파일은 안 바뀐다.

interface MenuCard {
  key: string;
  label: string;
  hint: string;
  tag: string;
  what: string;
  featured: boolean;
}
const menus: readonly MenuCard[] = [
  {
    key: 'system',
    label: DEVELOP_SYSTEM_MENU.label,
    hint: DEVELOP_SYSTEM_MENU.hint,
    tag: DEVELOP_SYSTEM_MENU.tag,
    what: '제품 개발에 필요한 전체 업무를 한 번에 분석해 필요한 분야와 순서, 견적 전제를 정리해 드리는 일',
    featured: true,
  },
  ...DEVELOP_INDIVIDUAL_AREAS.map((a) => ({
    key: a.code,
    label: a.label,
    hint: a.hint,
    tag: DEVELOP_INDIVIDUAL_TAG,
    what: a.prompt.what,
    featured: false,
  })),
];

interface Step {
  no: string;
  title: string;
  body: string;
}
const steps: readonly Step[] = [
  { no: '01', title: '접수', body: '만들고 싶은 것을 적어 보내 주시면 담당자에게 바로 전달됩니다. 회로도·사양서가 없어도 됩니다.' },
  { no: '02', title: '상담 · 검토', body: '전화나 메일로 요구사항을 함께 정리합니다. AI 사전 검토서와 시스템 구성도를 만들어 담당자 검토 뒤 보여드립니다.' },
  { no: '03', title: '견적서', body: '항목별 금액·개발 기간·산출물·별도 실비·표준 조건을 한 장으로 보내드립니다. 회사 결재에 그대로 쓰실 수 있습니다.' },
  { no: '04', title: '수락 · 착수금', body: '견적 조건에 동의하시면 계약이 성립합니다. 결제는 마일스톤으로 나눌 수 있고 세금계산서를 발행합니다.' },
  { no: '05', title: '개발', body: '회로도·아트웍처럼 되돌리기 어려운 단계에서는 확인을 요청드립니다. 진행 상황은 의뢰 상세에 계속 쌓입니다.' },
  { no: '06', title: '납품 · 검수', body: '산출물을 올려 드리면 정해진 검수 기간 안에 확인하십니다. 수정이 필요하면 요청해 주세요.' },
  { no: '07', title: '잔금 · 인도 · A/S', body: '잔금 결제와 함께 소스·원본 설계 파일을 인도합니다. 하자보수 기간 안에는 무상으로 고쳐 드립니다.' },
];

interface Faq {
  q: string;
  a: string;
}
const faqs: readonly Faq[] = [
  {
    q: '아이디어만 있는데 의뢰할 수 있나요?',
    a: '가능합니다. 실제로 가장 많은 형태입니다. "무엇을 하고 싶은지"만 적어 주시면 담당자가 통화로 필요한 조건을 함께 정리합니다. 분야를 모르시면 "시스템개발"을 고르시면 됩니다.',
  },
  {
    q: '견적은 얼마나 걸리나요?',
    a: '접수 후 영업일 2~3일 안에 담당자가 연락드립니다. 상담에서 범위가 정해지면 항목별 견적서를 보내드립니다. 자료가 충분하면 더 빨라집니다.',
  },
  {
    q: '소스 코드와 설계 원본을 받을 수 있나요?',
    a: '인도 범위를 의뢰 단계에서 고르십니다. 전체 원본과 소스까지 받으실 수 있고, 그 범위가 견적서의 산출물 목록과 금액에 그대로 반영됩니다. 잔금 결제와 함께 인도됩니다.',
  },
  {
    q: '개발한 다음 양산도 맡길 수 있나요?',
    a: '샘플피씨비가 PCB 제작과 부품 구매를 직접 하기 때문에 개발이 끝난 그 데이터로 시제품과 양산을 이어서 진행합니다. 개발사와 제조사가 갈릴 때 생기는 재설계 비용이 없습니다.',
  },
  {
    q: '비밀유지 계약을 맺을 수 있나요?',
    a: '의뢰서에서 "비밀유지 계약 희망"을 체크하시면 담당자가 계약서를 준비해 연락드립니다. 체크하지 않으셔도 의뢰 내용과 첨부는 담당자 외에 공개되지 않습니다.',
  },
  {
    q: '중간에 범위가 바뀌면 어떻게 하나요?',
    a: '착수 뒤 범위가 늘어나면 추가 견적서를 따로 드립니다. 원래 견적은 그대로 두고 바뀐 부분만 별도 항목으로 확인하신 뒤 진행합니다.',
  },
];

const openFaq = ref<number | null>(0);
const toggleFaq = (i: number): void => {
  openFaq.value = openFaq.value === i ? null : i;
};
</script>

<template>
  <div>
    <!-- 히어로 -->
    <section class="relative overflow-hidden bg-ink-950 text-white">
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.12]"
        style="background-image: linear-gradient(var(--color-brand-400) 1px, transparent 1px), linear-gradient(90deg, var(--color-brand-400) 1px, transparent 1px); background-size: 48px 48px;"
        aria-hidden="true"
      />
      <div class="relative mx-auto grid w-full max-w-[1280px] gap-9 px-6 py-16 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div class="grid gap-5">
          <p class="font-mono text-micro tracking-[.18em] text-brand-300">SAMPLEPCB DEVELOPMENT</p>
          <h1 class="text-h1 font-extrabold leading-tight sm:text-display">
            아이디어를 회로 · PCB · 펌웨어 · 기구 · 앱 · 서버까지,<br class="hidden sm:block">
            <span class="text-brand-400">샘플피씨비가 직접</span> 개발합니다
          </h1>
          <p class="max-w-xl text-lead leading-relaxed text-dk-tx-2">
            중개가 아닙니다. 상담·설계·시제품·양산을 한 회사가 이어서 맡습니다.
            자료가 없어도 됩니다 — 무엇을 만들고 싶은지만 적어 주세요.
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-3">
            <RouterLink
              to="/request"
              class="h-12 rounded-lg bg-brand-500 px-7 text-body font-bold leading-[3rem] text-white transition hover:bg-brand-400"
            >
              개발 의뢰하기
            </RouterLink>
            <a href="#how" class="h-12 rounded-lg border border-white/25 px-6 text-body font-bold leading-[3rem] text-white transition hover:border-white/60">
              진행 방식 보기
            </a>
          </div>
          <p class="text-label text-dk-tx-2">접수 후 영업일 2~3일 안에 담당자가 연락드립니다 · 상담과 견적은 무료입니다</p>
        </div>

        <ul class="grid gap-2.5">
          <li
            v-for="menu in menus"
            :key="menu.key"
            class="flex items-center gap-3 rounded-xl px-4 py-3 ring-1"
            :class="menu.featured ? 'bg-white/[0.12] ring-white/25' : 'bg-white/[0.06] ring-white/10'"
          >
            <span v-if="menu.featured" class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white" aria-hidden="true">
              <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
                <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><path d="M17.25 13.5v7.5M13.5 17.25h7.5" />
              </svg>
            </span>
            <AreaIcon v-else :code="menu.key" size="sm" />
            <span class="text-body font-bold">{{ menu.label }}</span>
            <span class="ml-auto text-label text-dk-tx-2">{{ menu.tag }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 개발 분야 -->
    <section id="areas" class="mx-auto w-full max-w-[1280px] scroll-mt-20 px-6 py-16">
      <p class="font-mono text-micro tracking-[.14em] text-tx-3">AREAS</p>
      <h2 class="mt-1.5 text-h1 font-extrabold text-tx-1">개발 분야</h2>
      <p class="mt-2 max-w-2xl text-lead leading-relaxed text-tx-2">
        제품 전체를 맡기시려면 시스템개발, 필요한 분야만 맡기시려면 개별 견적입니다. 여러 분야가 얽힌 제품일수록 한 회사가 맡는 편이 빠릅니다.
      </p>
      <div class="mt-7 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <article
          v-for="menu in menus"
          :key="menu.key"
          class="grid content-start gap-3 rounded-2xl bg-white p-5 transition"
          :class="menu.featured ? 'border-2 border-ink-950 sm:col-span-2 lg:col-span-4' : 'border border-line hover:border-line-2'"
        >
          <span v-if="menu.featured" class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-white" aria-hidden="true">
            <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><path d="M17.25 13.5v7.5M13.5 17.25h7.5" />
            </svg>
          </span>
          <AreaIcon v-else :code="menu.key" />
          <h3 class="flex flex-wrap items-center gap-2 text-title font-extrabold text-tx-1">
            {{ menu.label }}
            <span class="rounded-full bg-paper px-2.5 py-0.5 text-micro font-bold text-tx-2">{{ menu.tag }}</span>
          </h3>
          <p class="text-body leading-relaxed text-tx-2">{{ menu.hint }}</p>
          <p class="text-label leading-relaxed text-tx-3">{{ menu.what }}</p>
        </article>
      </div>
    </section>

    <!-- 진행 방식 -->
    <section id="how" class="scroll-mt-20 bg-white py-16">
      <div class="mx-auto w-full max-w-[1280px] px-6">
        <p class="font-mono text-micro tracking-[.14em] text-tx-3">HOW IT WORKS</p>
        <h2 class="mt-1.5 text-h1 font-extrabold text-tx-1">진행 방식</h2>
        <p class="mt-2 max-w-2xl text-lead leading-relaxed text-tx-2">
          접수부터 인도까지 일곱 단계입니다. 각 단계에서 무엇이 정해지고 무엇을 확인하시는지 미리 밝혀 둡니다.
        </p>
        <ol class="mt-8 grid gap-px overflow-hidden rounded-2xl bg-line">
          <li
            v-for="step in steps"
            :key="step.no"
            class="grid gap-2 bg-white px-5 py-5 sm:grid-cols-[64px_180px_1fr] sm:items-baseline sm:gap-5"
          >
            <span class="font-mono text-label font-bold tabular-nums text-brand-500">{{ step.no }}</span>
            <h3 class="text-title font-extrabold text-tx-1">{{ step.title }}</h3>
            <p class="text-body leading-relaxed text-tx-2">{{ step.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 왜 직접 개발인가 -->
    <section class="mx-auto w-full max-w-[1280px] px-6 py-16">
      <p class="font-mono text-micro tracking-[.14em] text-tx-3">WHY DIRECT</p>
      <h2 class="mt-1.5 text-h1 font-extrabold text-tx-1">왜 직접 개발인가</h2>
      <div class="mt-7 grid gap-3.5 md:grid-cols-3">
        <article class="grid content-start gap-2.5 rounded-2xl border-2 border-ink-950 bg-white p-6">
          <h3 class="text-title font-extrabold text-tx-1">양산까지 한 흐름</h3>
          <p class="text-body leading-relaxed text-tx-2">
            설계가 끝난 그 데이터로 PCB 제작과 부품 구매를 이어서 합니다. 개발사와 제조사가 갈릴 때 생기는
            재설계·재견적이 없습니다.
          </p>
        </article>
        <article class="grid content-start gap-2.5 rounded-2xl border border-line bg-white p-6">
          <h3 class="text-title font-extrabold text-tx-1">소유권은 의뢰인에게</h3>
          <p class="text-body leading-relaxed text-tx-2">
            인도 범위를 의뢰 단계에서 정하고 견적서 산출물 목록에 명시합니다. 잔금과 함께 소스·원본 설계
            파일의 소유권이 이관됩니다.
          </p>
        </article>
        <article class="grid content-start gap-2.5 rounded-2xl border border-line bg-white p-6">
          <h3 class="text-title font-extrabold text-tx-1">하자보수와 A/S</h3>
          <p class="text-body leading-relaxed text-tx-2">
            납품 뒤 하자보수 기간 동안 설계 결함은 무상으로 고칩니다. 그 뒤 개선·추가 개발도 같은 담당자가
            이어서 맡습니다.
          </p>
        </article>
      </div>
    </section>

    <!-- FAQ -->
    <section class="bg-white py-16">
      <div class="mx-auto w-full max-w-[900px] px-6">
        <p class="font-mono text-micro tracking-[.14em] text-tx-3">FAQ</p>
        <h2 class="mt-1.5 text-h1 font-extrabold text-tx-1">자주 묻는 질문</h2>
        <ul class="mt-7 grid gap-2.5">
          <li v-for="(faq, i) in faqs" :key="faq.q" class="overflow-hidden rounded-xl border border-line">
            <button
              type="button"
              class="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-paper"
              :aria-expanded="openFaq === i"
              @click="toggleFaq(i)"
            >
              <span class="text-body font-bold text-tx-1">{{ faq.q }}</span>
              <span class="ml-auto shrink-0 text-title text-tx-3">{{ openFaq === i ? '−' : '+' }}</span>
            </button>
            <p v-if="openFaq === i" class="border-t border-line bg-paper px-5 py-4 text-body leading-relaxed text-tx-2">
              {{ faq.a }}
            </p>
          </li>
        </ul>
      </div>
    </section>

    <!-- 하단 CTA -->
    <section class="mx-auto w-full max-w-[1280px] px-6 pb-4">
      <div class="grid gap-5 rounded-2xl bg-ink-950 px-7 py-12 text-center text-white sm:px-12">
        <h2 class="text-h1 font-extrabold">무엇을 만들고 싶으신가요?</h2>
        <p class="mx-auto max-w-xl text-lead leading-relaxed text-dk-tx-2">
          자료가 없어도, 분야를 몰라도 괜찮습니다. 적어 주신 내용으로 담당자가 함께 정리해 드립니다.
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <RouterLink
            to="/request"
            class="h-12 rounded-lg bg-brand-500 px-8 text-body font-bold leading-[3rem] text-white transition hover:bg-brand-400"
          >
            개발 의뢰하기
          </RouterLink>
          <RouterLink
            to="/me"
            class="h-12 rounded-lg border border-white/25 px-6 text-body font-bold leading-[3rem] text-white transition hover:border-white/60"
          >
            내 의뢰 보기
          </RouterLink>
        </div>
      </div>
    </section>
  </div>
</template>
