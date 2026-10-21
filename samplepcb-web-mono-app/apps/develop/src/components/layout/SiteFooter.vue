<script setup lang="ts">
import logo from '../../assets/footer/logo-header.png';
import icoPhone from '../../assets/footer/ico-phone.svg';
import icoMail from '../../assets/footer/ico-mail.svg';
import snsFacebook from '../../assets/footer/sns-facebook.svg';
import snsBlog from '../../assets/footer/sns-blog.svg';
import snsYoutube from '../../assets/footer/sns-youtube.svg';
import snsKakao from '../../assets/footer/sns-kakao.svg';

// 개발의뢰 푸터 — 피그마 개발의뢰 「00-1 랜딩 페이지」의 푸터 자리(37:7074)는 빈 #0a1220 321px 블록뿐이라
// 메인 사이트 공용 푸터(samplepcb-web/theme/sp-lite/inc/footer.php · css/default.css .sp-footer)의 구성을 옮기고
// 배경·높이만 피그마 값으로 맞췄다(사용자 결정 2026-10-21). 회사정보는 PHP 쪽 기본값과 같다 —
// PHP 는 쇼핑몰 설정(de_admin_*)이 있으면 그 값을 쓰지만 이 SPA 에는 공개 조회 API 가 없다.
// SNS·전화·이메일은 메인 사이트처럼 아이콘·문구만(링크 미정).
const company = {
  name: '주식회사 샘플피씨비',
  owner: '오혜영',
  addr: '경기도 광명시 하안로 60 광명SK테크노파크 A-1303,1407',
  fax: '02-6455-4490',
  saupja: '331-88-01750',
  tongsin: '2024-경기광명-0624',
  privacy: '오혜영',
  tel: '070-8667-1080~1',
  email: 'info@samplepcb.co.kr',
} as const;

const links: readonly { label: string; href: string }[] = [
  { label: '회사소개', href: '/about' },
  { label: '서비스 이용약관', href: '/bbs/content.php?co_id=provision' },
  { label: '개인정보처리방침', href: '/bbs/content.php?co_id=privacy' },
];

const sns: readonly { title: string; src: string; w: number; h: number }[] = [
  { title: 'Facebook', src: snsFacebook, w: 30, h: 30 },
  { title: 'Blog', src: snsBlog, w: 29, h: 29 },
  { title: 'YouTube', src: snsYoutube, w: 34, h: 24 },
  { title: 'KakaoTalk', src: snsKakao, w: 35, h: 32 },
];
</script>

<template>
  <footer class="print-hidden bg-[#0a1220] px-5 pb-[22px] pt-[40px] text-[15px] leading-[1.3] tracking-normal break-normal text-white max-md:pb-[28px] max-md:pt-[36px] md:min-h-[321px]">
    <h2 class="sr-only">사이트 정보</h2>
    <div class="mx-auto w-full max-w-[1280px]">
      <div class="flex flex-col gap-[14px] [text-shadow:0_4px_6px_rgba(0,0,0,0.3)]">
        <p class="flex items-center gap-[20px] text-[16px] font-medium max-md:flex-wrap">
          <span>{{ company.name }}</span>
          <i class="inline-block h-[20px] w-px shrink-0 bg-[#484c52]" aria-hidden="true" />
          <span>CEO&nbsp;&nbsp;{{ company.owner }}</span>
        </p>
        <p class="flex flex-wrap items-center gap-x-[30px] gap-y-[10px] text-white/70 max-md:flex-col max-md:items-start max-md:gap-[6px]">
          <span>{{ company.addr }}</span>
          <span>Fax. {{ company.fax }}</span>
        </p>
        <p class="-mt-[4px] flex flex-wrap items-center gap-x-[20px] gap-y-[10px] text-white/70 max-md:flex-col max-md:items-start max-md:gap-[6px]">
          <span>사업자등록번호&nbsp;&nbsp;{{ company.saupja }}</span>
          <i class="inline-block h-[20px] w-px shrink-0 bg-[#484c52] max-md:hidden" aria-hidden="true" />
          <span>통신판매업신고번호&nbsp;&nbsp;{{ company.tongsin }}</span>
          <i class="inline-block h-[20px] w-px shrink-0 bg-[#484c52] max-md:hidden" aria-hidden="true" />
          <span>개인정보관리자&nbsp;&nbsp;{{ company.privacy }}</span>
        </p>
      </div>

      <div class="mt-[54px] flex items-center justify-between gap-[16px] border-y border-[#484c52] pb-[16px] pt-[17px] max-md:mt-[28px] max-md:flex-col max-md:items-start">
        <ul class="flex flex-wrap gap-x-[33px] gap-y-[8px] text-[14px] font-medium">
          <li v-for="link in links" :key="link.href">
            <a :href="link.href" class="text-white [text-shadow:0_4px_6px_rgba(0,0,0,0.3)] hover:underline">{{ link.label }}</a>
          </li>
        </ul>
        <ul class="flex flex-wrap gap-x-[20px] gap-y-[8px]">
          <li class="flex items-center gap-[8px] whitespace-nowrap [text-shadow:0_4px_6px_rgba(0,0,0,0.3)]">
            <img :src="icoPhone" alt="전화" width="16" height="16" class="block size-[16px]"><span>{{ company.tel }}</span>
          </li>
          <li class="flex items-center gap-[8px] whitespace-nowrap [text-shadow:0_4px_6px_rgba(0,0,0,0.3)]">
            <img :src="icoMail" alt="이메일" width="16" height="16" class="block size-[16px]"><span>{{ company.email }}</span>
          </li>
        </ul>
      </div>

      <div class="mt-[34px] flex items-center gap-[16px] max-md:flex-wrap">
        <a href="/" class="block shrink-0"><img :src="logo" alt="SAMPLEPCB" width="175" height="28" class="block h-[28px] w-[175px]"></a>
        <p class="ml-[27px] text-[14px] text-white/60 [text-shadow:0_4px_6px_rgba(0,0,0,0.3)] max-md:order-3 max-md:ml-0 max-md:basis-full">
          Copyright &copy; samplepcb.co.kr all rights reserved.
        </p>
        <ul class="ml-auto flex items-center gap-[30px]" aria-label="소셜 채널">
          <li v-for="s in sns" :key="s.title">
            <span class="block opacity-95" :title="s.title"><img :src="s.src" :alt="s.title" :width="s.w" :height="s.h" class="block"></span>
          </li>
        </ul>
      </div>
    </div>
  </footer>
</template>
