<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import framesUrl from '../../assets/home/hero-explode.bin?url';
import explodeStart from '../../assets/home/hero-explode-start.jpg';
import explodeStill from '../../assets/home/hero-explode-still.jpg';

// 랜딩 히어로 — 피그마 「00-1 랜딩 페이지」 마스크 145:22298 의 동영상 레이어 183:22383 자리를 캔버스 프레임 재생으로 그린다(사용자 결정 2026-11-02).
// 원본은 사용자 제공 layers-explode-2172x724.mp4(10초·24fps, 끝 프레임이 첫 프레임으로 이어지는 반복). ops/scripts/hero-frames.mjs 가 화면에 안 보이는
// 양옆(1350 표시폭 중 바깥 35씩)을 잘라 1280×450 WebP 로 뽑고, 거의 안 변하는 구간(처음 1초·다 펼쳐진 4~7초)은 한 장을 다시 써서
// 240프레임을 고유 147장·4.9MB 한 파일(hero-explode.bin)로 묶는다.
// 받는 조건은 영상 때와 같다 — 데스크톱(lg 이상)·동작 줄이기 꺼짐·데이터 절약 꺼짐일 때만, 페이지 로드가 끝난 뒤. 그 밖(모바일 포함)은 다 펼쳐진
// 5.5초 프레임 한 장. 데스크톱은 첫 프레임 정지 화면을 먼저 깔고, 첫 구간을 풀어 그린 뒤 캔버스를 그 위로 바꾼다(같은 그림이라 끊김 없음).
// 프레임을 전부 풀어 두지 않는다(1장 2.3MB × 147 ≈ 340MB). 재생 위치부터 고유 프레임 AHEAD 장만 미리 풀고 지난 것은 닫는다.
// 풀기가 늦으면 시계는 그대로 가고 앞 프레임을 유지한다(느린 기기에서 슬로 모션 대신 몇 장 건너뜀).
// 받기·풀기 실패면 정지 화면이 남는다. 화면 밖·탭 숨김·동작 줄이기로 바뀌면 멈추고 돌아오면 그 자리부터 잇는다.
const REDUCE = '(prefers-reduced-motion: reduce)';
const AHEAD = 12; // 1280×450 한 장 2.3MB → 약 28MB

interface Pack {
  fps: number;
  w: number;
  h: number;
  frames: number[]; // 재생 프레임 i → 고유 프레임 번호
  blobs: Blob[];
}

const wantsMotion = (): boolean => {
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  return typeof createImageBitmap === 'function'
    && window.matchMedia('(min-width: 1024px)').matches
    && !window.matchMedia(REDUCE).matches
    && !saveData;
};

const motion = wantsMotion();
const still = motion ? explodeStart : explodeStill;
const shown = ref(false);
const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

const reduce = window.matchMedia(REDUCE);
const abort = new AbortController();
const bitmaps = new Map<number, ImageBitmap>();
const decoding = new Map<number, Promise<void>>();
let pack: Pack | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let running = false;
let clock0 = 0; // 재생 시계 기준(performance.now) — 멈췄다 이을 때 pos 에 맞춰 다시 잡는다
let pos = 0; // 지금 재생 프레임
let drawn = -1; // 캔버스에 그려진 고유 프레임
let inView = true;
let disposed = false;
let observer: IntersectionObserver | null = null;

// 팩 = [u32 LE 머리말 길이][머리말 JSON][WebP…] (형식은 ops/scripts/hero-frames.mjs). 프레임은 한 Blob 의 조각이라 복사가 없다.
const readPack = async (all: Blob): Promise<Pack> => {
  const len = new DataView(await all.slice(0, 4).arrayBuffer()).getUint32(0, true);
  const head = JSON.parse(await all.slice(4, 4 + len).text()) as { fps: number; w: number; h: number; frames: number[]; sizes: number[] };
  const blobs: Blob[] = [];
  let at = 4 + len;
  for (const n of head.sizes) {
    blobs.push(all.slice(at, at + n, 'image/webp'));
    at += n;
  }
  return { fps: head.fps, w: head.w, h: head.h, frames: head.frames, blobs };
};

// 재생 위치 from 부터 앞으로 고유 프레임 AHEAD 장(멈춘 구간은 한 장이라 그 너머까지 본다)
const ahead = (p: Pack, from: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < p.frames.length && out.length < AHEAD; k++) {
    const u = p.frames[(from + k) % p.frames.length];
    if (u !== undefined && !out.includes(u)) out.push(u);
  }
  return out;
};

const decode = (p: Pack, u: number): Promise<void> => {
  const job = decoding.get(u);
  if (job) return job;
  const blob = p.blobs[u];
  if (bitmaps.has(u) || !blob) return Promise.resolve();
  const next = createImageBitmap(blob)
    .then((bmp) => {
      if (disposed) bmp.close();
      else bitmaps.set(u, bmp);
    })
    .finally(() => decoding.delete(u));
  decoding.set(u, next);
  return next;
};

const fill = (p: Pack, from: number): void => {
  const keep = ahead(p, from);
  for (const [u, bmp] of bitmaps) {
    if (keep.includes(u)) continue;
    bmp.close();
    bitmaps.delete(u);
  }
  for (const u of keep) decode(p, u).catch(() => { /* 풀기 실패 — 그 프레임 자리는 앞 프레임이 이어 간다 */ });
};

const tick = (now: number): void => {
  const p = pack;
  if (!p || !ctx) return;
  raf = requestAnimationFrame(tick);
  const i = Math.floor((Math.max(0, now - clock0) * p.fps) / 1000) % p.frames.length;
  if (i !== pos) {
    pos = i;
    fill(p, i);
  }
  const u = p.frames[i];
  const bmp = u === undefined || u === drawn ? undefined : bitmaps.get(u);
  if (u === undefined || !bmp) return;
  ctx.drawImage(bmp, 0, 0);
  drawn = u;
  shown.value = true;
};

const sync = (): void => {
  const p = pack;
  const go = p !== null && ctx !== null && inView && !document.hidden && !reduce.matches;
  if (go && !running) {
    running = true;
    clock0 = performance.now() - (pos * 1000) / p.fps;
    raf = requestAnimationFrame(tick);
  } else if (!go && running) {
    running = false;
    cancelAnimationFrame(raf);
  }
};

const start = async (): Promise<void> => {
  try {
    const res = await fetch(framesUrl, { signal: abort.signal });
    if (!res.ok) return;
    const p = await readPack(await res.blob());
    // 첫 구간을 풀어 두고 시작해야 처음 몇 장을 건너뛰지 않는다
    await Promise.all(ahead(p, 0).map((u) => decode(p, u)));
    const c = canvas.value;
    if (disposed || !c) return;
    c.width = p.w;
    c.height = p.h;
    ctx = c.getContext('2d', { alpha: false });
    pack = p;
    sync();
  } catch {
    /* 받기·풀기 실패(떠날 때 중단 포함) — 정지 화면 유지 */
  }
};

const attach = (): void => {
  void start();
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
  disposed = true;
  abort.abort();
  cancelAnimationFrame(raf);
  for (const bmp of bitmaps.values()) bmp.close();
  bitmaps.clear();
  window.removeEventListener('load', attach);
  observer?.disconnect();
  document.removeEventListener('visibilitychange', sync);
  reduce.removeEventListener('change', sync);
});
</script>

<template>
  <div ref="root" class="relative overflow-hidden" aria-hidden="true">
    <img :src="still" alt="" width="2060" height="724" class="absolute inset-0 size-full max-w-none object-cover">
    <canvas
      v-if="motion"
      ref="canvas"
      class="absolute inset-0 size-full max-w-none object-cover transition-opacity duration-300"
      :class="shown ? 'opacity-100' : 'opacity-0'"
    />
  </div>
</template>
