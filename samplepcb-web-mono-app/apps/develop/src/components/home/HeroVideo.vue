<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import introVideo from '../../assets/home/hero-intro.mp4';
import introStart from '../../assets/home/hero-intro-start.jpg';
import introStill from '../../assets/home/hero-intro-still.jpg';

// 랜딩 히어로 영상 — 피그마 「00-1 랜딩 페이지」 마스크 145:22298 의 동영상 레이어 183:22383.
// 원본은 사용자 제공 개발의뢰인트로.mp4(10초·2160×720·24fps·무음 H.264·faststart, 끝 프레임이 첫 프레임으로 이어지는 반복 영상)를
// 그대로 쓴다 — 1350 표시폭의 2배 화면에도 선명하고 2.29MB 라 홈 배너 5 영상(2.6MB)과 같은 급이다.
// 영상은 데스크톱(lg 이상)·동작 줄이기 꺼짐·데이터 절약 꺼짐일 때만 받는다. 그 밖(모바일 포함)은 다 펼쳐진 5.5초 프레임 한 장.
// 데스크톱은 첫 프레임 정지 화면을 먼저 깔고 페이지 로드가 끝난 뒤 영상을 붙여, 재생이 시작되면 그 위로 바꾼다(첫 프레임이 같아 끊김 없음).
// 자동재생 거부·네트워크 오류면 정지 화면이 그대로 남는다. 화면 밖·탭 숨김·동작 줄이기로 바뀌면 멈추고 돌아오면 이어 재생한다.
const REDUCE = '(prefers-reduced-motion: reduce)';

const wantsVideo = (): boolean => {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return window.matchMedia('(min-width: 1024px)').matches && !window.matchMedia(REDUCE).matches && !saveData;
};

const motion = wantsVideo();
const still = motion ? introStart : introStill;
const src = ref<string | null>(null);
const playing = ref(false);
const root = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);

const reduce = window.matchMedia(REDUCE);
let inView = true;
let observer: IntersectionObserver | null = null;

const sync = (): void => {
  const v = videoEl.value;
  if (!v) return;
  if (inView && !document.hidden && !reduce.matches) v.play().catch(() => { /* 자동재생 거부 — 정지 화면 유지 */ });
  else v.pause();
};

const attach = (): void => {
  src.value = introVideo;
};

onMounted(() => {
  if (!motion) return;
  if (document.readyState === 'complete') attach();
  else window.addEventListener('load', attach, { once: true });
  observer = new IntersectionObserver(([entry]) => {
    inView = entry?.isIntersecting ?? true;
    sync();
  });
  if (root.value) observer.observe(root.value);
  document.addEventListener('visibilitychange', sync);
  reduce.addEventListener('change', sync);
});

onBeforeUnmount(() => {
  window.removeEventListener('load', attach);
  observer?.disconnect();
  document.removeEventListener('visibilitychange', sync);
  reduce.removeEventListener('change', sync);
});
</script>

<template>
  <div ref="root" class="relative overflow-hidden" aria-hidden="true">
    <img :src="still" alt="" width="2160" height="720" class="absolute inset-0 size-full max-w-none object-cover">
    <video
      v-if="src"
      ref="videoEl"
      :src="src"
      muted
      loop
      playsinline
      preload="auto"
      disablepictureinpicture
      class="absolute inset-0 size-full max-w-none object-cover transition-opacity duration-300"
      :class="playing ? 'opacity-100' : 'opacity-0'"
      @canplay="sync"
      @playing="playing = true"
    />
  </div>
</template>
