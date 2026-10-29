<script setup lang="ts">
import { ref } from 'vue';
import { DEVELOP_INDIVIDUAL_AREAS, DEVELOP_SYSTEM_MENU } from '@sp/api-contract';
import heroLayers from '../assets/home/hero-layers.jpg';
import pcbXray from '../assets/home/pcb-xray.jpg';
import areaPcb from '../assets/home/area-pcb.jpg';
import areaMech from '../assets/home/area-mech.jpg';
import areaApp from '../assets/home/area-app.jpg';
import areaServer from '../assets/home/area-server.jpg';
import stepCircle from '../assets/home/step-circle.svg';
import stepArrow from '../assets/home/step-arrow.svg';
import whyPhoto from '../assets/home/why-photo.jpg';
import whyIconFlow from '../assets/home/why-icon-flow.png';
import whyIconOwnership from '../assets/home/why-icon-ownership.png';
import whyIconAs from '../assets/home/why-icon-as.png';
import chevronDown from '../assets/home/chevron-down.svg';

// 개발의뢰 랜딩 — 피그마 개발의뢰(U7VKC9FSkojpDXqZ5qnJQN) 「00-1 랜딩 페이지」 37:6768(= Design done 70:1296), 2026-10-21.
// 1920 화면 기준 좌표를 그대로 옮겼다(안쪽 1280). 1280 미만은 피그마에 없어 세로로 쌓는다.
// 구성: 히어로 → 개발 분야(#areas) → 진행 방식 7단계(#how) → 왜 직접 개발인가(아코디언) → 자주 묻는 질문 → 하단 CTA.
// 히어로는 2026-10 시안 교체(145:22298~22308): 전폭 어두운 띠 + 큐브 사진 + 문구. 옛 히어로의 분야 카드 5장·버튼 2개는 시안에서
// 빠졌다(분야 입구는 아래 '개발 분야' 카드가 맡는다). 시안의 같은 마스크 안 GIF(hero-banner (2), 252프레임 일러스트)는 불투명한
// 큐브 사진 아래에 깔려 보이지 않아 쓰지 않는다(docs/FIGMA_PAGES.md "개발의뢰 랜딩").
// 분야 카드는 위저드 1스텝 메뉴를 고른 채 연다(?menu=<code>). 꼬리표·한 줄 설명은 계약(DEVELOP_*)이 정본이고,
// 카드 제목은 피그마 표기("시스템 개발"·"PCB 설계" — 띄어 씀)를 따른다. 2026-10 시안의 카드 구성 변경(기구 → '회로 설계' 제목만
// 바뀜)은 계약 메뉴를 그대로 두기로 해 따르지 않는다(사용자 결정 2026-10-29).
// 피그마와 다르게 둔 것(사용자 결정): 진행 방식 05·06 설명(피그마는 01·02 복사본)·FAQ(피그마는 PCB 양산 주문 자리표시)는
// 기존 개발의뢰 문구.

const areaHint = (code: string): string => DEVELOP_INDIVIDUAL_AREAS.find((a) => a.code === code)?.hint ?? '';

// ── 개발 분야 카드 — 사진 상자(크롭 원본 크기·위치)와 그 위 그라데이션은 피그마 마스크 그룹 값 그대로 ──
interface AreaCard {
  code: string;
  title: string;
  hint: string;
  desc: string;
  img: string;
  box: { left: number; top: number; w: number; h: number };
  overlay: string;
  dark: boolean; // 어두운 사진 — 흰 글자
  wide: boolean; // 시스템 개발 — 두 칸
}
const areaCards: readonly AreaCard[] = [
  {
    code: 'system',
    title: '시스템 개발',
    hint: DEVELOP_SYSTEM_MENU.hint,
    desc: '제품 개발에 필요한 전체 업무를 한 번에 분석해 필요한 분야와 순서, 견적 전제를 정리해 제품 개발 프로세스를 제시하고 제품 양산까지 원스톱 서비스를 제공합니다.',
    img: pcbXray,
    box: { left: 0, top: -150, w: 845, h: 669 },
    overlay: 'linear-gradient(to top, #5a5a5a 37.145%, rgba(102,102,102,0) 67.19%)',
    dark: true,
    wide: true,
  },
  {
    code: 'pcb',
    title: 'PCB 설계',
    hint: areaHint('pcb'),
    desc: '회로도를 실제 기판 도면(아트웍)과 제작 파일(거버)로 만들어 드립니다.',
    img: areaPcb,
    box: { left: -83, top: -106, w: 576, h: 432 },
    overlay: 'linear-gradient(to top, #a5f1ea 26.968%, rgba(74,155,148,0) 62.153%)',
    dark: false,
    wide: false,
  },
  {
    code: 'mech',
    title: '기구 설계',
    hint: areaHint('mech'),
    desc: '케이스·내부 구조·방열·고정 구조를 설계해 3D·2D 도면과 제작 자료를 만들어 전달 드립니다.',
    img: areaMech,
    box: { left: -8.068, top: -52.484, w: 500.107, h: 333.446 },
    overlay: 'linear-gradient(to top, #ececec 4.167%, rgba(175,175,175,0) 63.988%)',
    dark: false,
    wide: false,
  },
  {
    code: 'app',
    title: '앱 개발',
    hint: areaHint('app'),
    desc: '장치와 연결해 보고 조작하는 스마트폰·태블릿·웹 화면을 제작해 드립니다.',
    img: areaApp,
    box: { left: -5.463, top: -2.986, w: 392.401, h: 261.633 },
    overlay: 'linear-gradient(to top, #a9ebff, rgba(102,102,102,0) 73.54%)',
    dark: false,
    wide: false,
  },
  {
    code: 'server',
    title: '서버 개발',
    hint: areaHint('server'),
    desc: '장치·앱이 주고받는 데이터를 저장하고 관리하는 서버(API·데이터베이스·관리 화면)를 셋팅해 드립니다.',
    img: areaServer,
    box: { left: -102, top: -12, w: 513, h: 384 },
    overlay: 'linear-gradient(to top, #404040 40.625%, rgba(102,102,102,0) 59.375%)',
    dark: true,
    wide: false,
  },
];

interface Step {
  no: string;
  title: string;
  body: string;
}
const steps: readonly Step[] = [
  { no: '01', title: '접수', body: '만들고 싶은 것을 적어 보내 주시면 담당자에게 바로 전달됩니다. 회로도·사양서가 없어도 됩니다.' },
  { no: '02', title: '상담·검토', body: '전화나 메일로 요구사항을 함께 정리합니다. AI 사전 검토서와 시스템 구성도를 만들어 담당자 검토 뒤 보여드립니다.' },
  { no: '03', title: '견적서', body: '항목별 금액·개발 기간·산출물·별도 실비·표준 조건을 한 장으로 보내드립니다. 회사 결재에 그대로 쓰실 수 있습니다.' },
  { no: '04', title: '수락·착수금', body: '견적 조건에 동의하시면 계약이 성립합니다. 결제는 마일스톤으로 나눌 수 있고 세금계산서를 발행합니다.' },
  { no: '05', title: '개발', body: '회로도·아트웍처럼 되돌리기 어려운 단계에서는 확인을 요청드립니다. 진행 상황은 의뢰 상세에 계속 쌓입니다.' },
  { no: '06', title: '납품·검수', body: '산출물을 올려 드리면 정해진 검수 기간 안에 확인하십니다. 수정이 필요하면 요청해 주세요.' },
  { no: '07', title: '잔금·인도·A/S', body: '잔금 결제와 함께 소스·원본 설계 파일을 인도합니다. 하자보수 기간 안에는 무상으로 고쳐 드립니다.' },
];

interface Why {
  icon: string;
  title: string;
  body: string;
}
const whys: readonly Why[] = [
  {
    icon: whyIconFlow,
    title: '양산까지 한 흐름',
    body: '설계가 끝난 그 데이터로 PCB 제작과 부품 구매를 이어서 합니다. 개발사와 제조사가 갈릴 때 생기는 재설계·재견적이 없습니다.',
  },
  {
    icon: whyIconOwnership,
    title: '소유권은 의뢰인에게',
    body: '인도 범위를 의뢰 단계에서 정하고 견적서 산출물 목록에 명시합니다. 잔금과 함께 소스·원본 설계 파일의 소유권이 이관됩니다.',
  },
  {
    icon: whyIconAs,
    title: '하자보수와 A/S',
    body: '납품 뒤 하자보수 기간 동안 설계 결함은 무상으로 고칩니다. 그 뒤 개선·추가 개발도 같은 담당자가 이어서 맡습니다.',
  },
];
const openWhy = ref<number | null>(0);
const toggleWhy = (i: number): void => {
  openWhy.value = openWhy.value === i ? null : i;
};

interface Faq {
  q: string;
  a: string;
}
const faqs: readonly Faq[] = [
  {
    q: '아이디어만 있는데 의뢰할 수 있나요?',
    a: '가능합니다. 실제로 가장 많은 형태입니다. "무엇을 하고 싶은지"만 적어 주시면 담당자가 통화로 필요한 조건을 함께 정리합니다. 분야를 모르시면 "시스템 개발"을 고르시면 됩니다.',
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
  <div class="bg-white tracking-normal break-normal text-black">
    <!-- 히어로 — 전폭 띠 450(#040e1c→#000109) · 안쪽 1280 상자에 큐브 사진 1350×450 을 가운데로(양옆 35 잘림 = 시안 마스크) ·
         글 묶음은 상자 왼쪽 위 92. 제목은 시안 Lexend(한글 글리프 없음 → 대체 글꼴)라 Pretendard Medium, 영문 줄만 Lexend Light.
         lg 미만은 시안이 없어 글 → 사진 순으로 쌓는다. -->
    <section class="bg-[linear-gradient(to_bottom,#040e1c,#000109)]">
      <div class="relative mx-auto flex max-w-[1280px] flex-col overflow-hidden lg:block lg:h-[450px]">
        <div class="relative z-10 px-5 pt-[40px] lg:absolute lg:left-0 lg:top-[92px] lg:w-[560px] lg:p-0">
          <h1 class="text-[32px] font-medium leading-[1.24] tracking-[-0.02em] text-white sm:text-[45px]">
            여러분의 아이디어를 <br>실현시켜 드립니다.
          </h1>
          <p class="mt-[14px] font-[Lexend] text-[24px] font-light leading-[1.25] tracking-[-0.02em] text-white/90 sm:text-[34px]">
            Your Idea, Our Expertise
          </p>
          <p class="mt-[28px] text-[17px] font-medium leading-[1.7] tracking-[-0.02em] text-white/60 sm:text-[20px]">
            아이디어 구상부터 제작까지, <br>전문 담당자가 함께 실현해 드립니다.
          </p>
        </div>
        <img
          :src="heroLayers"
          alt=""
          width="1350"
          height="450"
          class="pointer-events-none block h-[240px] w-full max-w-none object-cover sm:h-[340px] lg:absolute lg:left-1/2 lg:top-0 lg:h-[450px] lg:w-[1350px] lg:-translate-x-1/2"
        >
      </div>
    </section>

    <!-- 개발 분야 — 카드 408(시스템 844)×352 r18, 사진 상자 12px 안쪽 r14 h258 -->
    <section class="px-4 pt-[100px] xl:pt-[140px]">
      <div class="mx-auto max-w-[1280px]">
        <h2 id="areas" class="text-[32px] font-bold leading-[1.2] sm:text-[40px]">개발 분야</h2>
        <p class="mt-[12px] text-[18px] font-medium leading-[1.3] text-[#666] sm:text-[22px]">
          제품 전체를 맡기시려면 시스템 개발, 필요한 분야만 맡기시려면 개별 견적입니다. 여러 분야가 얽힌 제품일수록 한 회사가 맡는 편이 빠릅니다.
        </p>
        <ul class="mt-[34px] grid gap-[28px] md:grid-cols-2 lg:grid-cols-3">
          <li v-for="card in areaCards" :key="card.code" :class="card.wide ? 'md:col-span-2' : ''">
            <RouterLink
              :to="{ name: 'request', query: { menu: card.code } }"
              class="flex h-full min-h-[352px] flex-col rounded-[18px] bg-white p-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.1)] transition-shadow hover:shadow-[0_12px_36px_rgba(0,0,0,0.16)]"
            >
              <span class="relative block h-[258px] shrink-0 overflow-hidden rounded-[14px]">
                <span
                  class="absolute max-lg:inset-0 max-lg:size-full lg:left-(--l) lg:top-(--t) lg:h-(--h) lg:w-(--w)"
                  :style="{ '--l': `${card.box.left}px`, '--t': `${card.box.top}px`, '--w': `${card.box.w}px`, '--h': `${card.box.h}px` }"
                  aria-hidden="true"
                >
                  <img :src="card.img" alt="" class="absolute inset-0 size-full max-w-none object-cover">
                  <span class="absolute inset-0" :style="{ backgroundImage: card.overlay }" />
                </span>
                <span class="absolute inset-x-[18px] bottom-[20px] block">
                  <span
                    class="block text-[26px] font-semibold leading-[1.3] tracking-[-0.6px] sm:text-[30px]"
                    :class="card.dark ? 'text-white' : 'text-[#1b2b39]'"
                  >{{ card.title }}</span>
                  <span
                    class="mt-[6px] block whitespace-pre-wrap text-[17px] font-medium leading-[1.3] tracking-[-0.4px] sm:text-[20px]"
                    :class="card.dark ? 'text-white/70' : 'text-[#333] opacity-90'"
                  >{{ `-  ${card.hint}` }}</span>
                </span>
              </span>
              <span
                class="mb-[5px] ml-[8px] mt-[17px] block text-[16px] font-medium leading-[1.5] text-[#666]"
                :class="card.wide ? 'mr-0' : 'mr-[8px]'"
              >{{ card.desc }}</span>
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>

    <!-- 진행 방식 — 번호 원 44 + 회색 띠 h88 r10(제목 x+30 · 본문 x+220), 단계 사이 24 에 이중 화살표 -->
    <section class="px-4 pt-[100px] xl:pt-[140px]">
      <div class="mx-auto max-w-[1280px]">
        <h2 id="how" class="text-[32px] font-bold leading-[1.2] sm:text-[40px]">진행 방식</h2>
        <p class="mt-[12px] text-[18px] font-medium leading-[1.3] text-[#666] sm:text-[22px]">
          접수부터 인도까지 일곱 단계입니다. 각 단계에서 무엇이 정해지고 무엇을 확인하시는지 미리 밝혀 둡니다.
        </p>
        <ol class="mt-[34px]">
          <li v-for="(step, i) in steps" :key="step.no">
            <div class="flex items-center gap-[20px] max-sm:gap-3">
              <span class="relative flex size-[44px] shrink-0 items-center justify-center">
                <img :src="stepCircle" alt="" class="absolute inset-0 block size-full max-w-none">
                <span class="relative text-[20px] font-extrabold leading-[1.3] tracking-[-0.4px] text-white">{{ step.no }}</span>
              </span>
              <div class="flex min-h-[88px] flex-1 items-center rounded-[10px] bg-[#f5f6f8] px-[30px] py-4 max-md:flex-col max-md:items-start max-md:gap-1 max-sm:px-5">
                <h3 class="shrink-0 text-[22px] font-extrabold leading-[1.3] tracking-[-0.52px] text-[#0a1220] opacity-90 sm:text-[26px] md:w-[190px]">{{ step.title }}</h3>
                <p class="text-[16px] font-medium leading-[1.3] tracking-[-0.36px] text-[#555] opacity-90 sm:text-[18px]">{{ step.body }}</p>
              </div>
            </div>
            <div v-if="i < steps.length - 1" class="relative h-[24px]" aria-hidden="true">
              <img :src="stepArrow" alt="" class="absolute left-[12px] top-[0px] block h-[24.924px] w-[19px] max-w-none">
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- 왜 직접 개발인가 — 전폭 띠(아래 55% 부터 #f5f6f8), 사진 610×405 r20 + 아코디언 620 -->
    <section class="bg-[linear-gradient(to_top,#f5f6f8_55%,rgba(245,246,248,0))] px-4 pb-[100px] pt-[120px] xl:pb-[140px] xl:pt-[160px]">
      <div class="mx-auto max-w-[1280px]">
        <h2 class="text-[32px] font-bold leading-[1.2] sm:text-[40px]">왜 직접 개발인가</h2>
        <div class="mt-[40px] grid gap-[24px] lg:grid-cols-[minmax(0,610fr)_minmax(0,620fr)] lg:gap-[50px]">
          <div class="relative h-[240px] overflow-hidden rounded-[20px] sm:h-[405px]">
            <img :src="whyPhoto" alt="" class="absolute left-[-6.2px] top-[-20.587px] block h-[430.792px] w-[765.72px] max-w-none object-cover">
          </div>
          <ul class="flex flex-col gap-[24px]">
            <li
              v-for="(why, i) in whys"
              :key="why.title"
              class="rounded-[14px] py-[30px] transition-colors"
              :class="openWhy === i ? 'border border-[#eaeef7] bg-white px-[27px] max-sm:px-[19px]' : 'border-2 border-[#eaeef7] bg-[#edeff3] px-[26px] max-sm:px-[18px]'"
            >
              <button
                type="button"
                class="flex w-full items-center gap-[17px] text-left"
                :aria-expanded="openWhy === i"
                @click="toggleWhy(i)"
              >
                <img :src="why.icon" alt="" class="block size-[30px] shrink-0 max-w-none object-cover">
                <span class="min-w-0 flex-1 text-[20px] font-semibold leading-[1.3] text-[#1b2b39] sm:text-[24px]">{{ why.title }}</span>
                <span class="relative block h-[8px] w-[15px] shrink-0 transition-transform" :class="openWhy === i ? 'rotate-180' : ''" aria-hidden="true">
                  <img :src="chevronDown" alt="" class="absolute left-[-1px] top-[-1px] block h-[10.462px] w-[17px] max-w-none">
                </span>
              </button>
              <p v-if="openWhy === i" class="mt-[20px] text-[16px] font-medium leading-[1.5] text-[#666] sm:text-[18px]">{{ why.body }}</p>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 자주 묻는 질문 — 1280 상자 r20(테두리 #eaeef7, 흰 80%) 안 30/28 패딩, 항목 사이 16 + 구분선 -->
    <section class="px-4 pt-[100px] xl:pt-[140px]">
      <div class="mx-auto max-w-[1280px]">
        <h2 class="text-[32px] font-bold leading-[1.2] sm:text-[40px]">자주 묻는 질문</h2>
        <ul class="mt-[40px] flex flex-col gap-[16px] rounded-[20px] border border-[#eaeef7] bg-[rgba(255,255,255,0.8)] px-[30px] py-[28px] max-sm:px-5">
          <li v-for="(faq, i) in faqs" :key="faq.q" class="flex flex-col gap-[24px]">
            <div class="flex flex-col gap-[10px]">
              <button
                type="button"
                class="flex min-h-[40px] w-full items-center justify-between gap-4 pr-[14px] text-left max-sm:pr-0"
                :aria-expanded="openFaq === i"
                @click="toggleFaq(i)"
              >
                <span class="text-[19px] font-semibold leading-[1.4] text-[#1b2b39] sm:text-[24px]">{{ faq.q }}</span>
                <span class="relative block size-[16px] shrink-0" aria-hidden="true">
                  <span class="absolute left-0 top-[7px] block h-[2px] w-[16px] rounded-[9px] bg-[#8793ab]" />
                  <span v-if="openFaq !== i" class="absolute left-[7px] top-0 block h-[16px] w-[2px] rounded-[9px] bg-[#8793ab]" />
                </span>
              </button>
              <p v-if="openFaq === i" class="text-[16px] leading-[1.5] text-[#666] sm:text-[18px]">{{ faq.a }}</p>
            </div>
            <div v-if="i < faqs.length - 1" class="h-px w-full bg-[#d4d7de]" />
          </li>
        </ul>
      </div>
    </section>

    <!-- 하단 CTA — 전폭 415px 보라 그라데이션, 푸터에 바로 붙는다 -->
    <section class="mt-[100px] bg-[linear-gradient(to_right,#604acc,#433bf6)] px-4 pb-[90px] pt-[100px] text-center text-white xl:mt-[141px]">
      <h2 class="text-[30px] font-bold leading-[1.2] sm:text-[40px]">무엇을 만들고 싶으신가요?</h2>
      <p class="mx-auto mt-[30px] max-w-[872px] text-[18px] font-medium leading-[1.3] opacity-60 sm:text-[24px]">
        자료가 없어도, 분야를 몰라도 괜찮습니다. 적어 주신 내용으로 담당자가 함께 정리해 드립니다.
      </p>
      <div class="mt-[64px] flex flex-wrap justify-center gap-[12px]">
        <RouterLink
          :to="{ name: 'request' }"
          class="flex h-[52px] items-center justify-center rounded-[50px] border border-white bg-white px-[23px] text-[20px] font-medium leading-[30px] text-[#5d49d1] backdrop-blur-[2.5px] transition-opacity hover:opacity-90 sm:text-[22px]"
        >
          개발 의뢰하기
        </RouterLink>
        <RouterLink
          :to="{ name: 'me' }"
          class="flex h-[52px] items-center justify-center rounded-[50px] border border-white bg-[rgba(255,255,255,0.05)] px-[23px] text-[20px] font-medium leading-[30px] text-white backdrop-blur-[2.5px] transition-colors hover:bg-white/15 sm:text-[22px]"
        >
          내 의뢰 보기
        </RouterLink>
      </div>
    </section>
  </div>
</template>
