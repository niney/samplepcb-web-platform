<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { DEV_DIAGRAM_DISCLAIMER } from '@sp/api-contract';
import { figureSrcdoc, parseDiagramDoc } from '@sp/ui';
import type { DiagramSection } from '@sp/ui';
import chevron from '../../../assets/detail/accordion-chevron.svg';
import bulletDot from '../../../assets/detail/bullet-dot.svg';
import arrow from '../../../assets/detail/carousel-prev.svg';

// 시스템 구성도 카드 — 피그마 「00-3 의뢰 상세」 39:9632: 회색 카드 안 흰 아코디언.
// 도면과 글을 나눠 그린다(사용자 결정 2026-11-05): 도면(2장이면 좌우 넘김)+도면별 한 줄 설명 → "구성도 설명 보기" 토글
// (기본 접힘) 안에 요구사항 확인 요약·확정된 구성·미확정 항목… 순서. 문서는 @sp/ui parseDiagramDoc 로 읽어 가른다.
// 요약은 원문에서 도면 앞에 오지만 바로 위 핵심 요구사항 카드와 겹쳐 글 묶음의 맨 앞으로 내렸다.
// 도면은 sandbox iframe 으로만 그린다. 문서 구조를 못 읽으면(이미지 업로드 포함) 문서 전체를 한 장으로 보이고 토글은 없다.
// 도면을 누르면 그 도면만 크게 본다(모달 안에서 넘김) — 글은 토글에 있으니 모달엔 싣지 않는다. 못 가른 문서만 원문 전체.
// print = 출력물(RequestPrint) — 종이엔 토글이 없으니 글까지 펼친 채, 넘김·확대 없이 도면을 전부 차례로 `img` 로 싣는다.
const props = defineProps<{
  html: string;
  metaLine: string; // "2026-09-25 14:51 생성 · v2 공개본 · …" — 모델명은 고객에게 보이지 않는다(사용자 결정)
  print?: boolean;
  no?: string; // 소제목 번호 접두('2-2. ') — DevelopReview 가 정한다
}>();

const parsed = computed(() => parseDiagramDoc(props.html));
const accordionTitle = computed(() => {
  const p = parsed.value;
  if (p === null) return '시스템 구성도';
  if (p.title !== '') return p.title;
  return p.figures.length > 1 ? '시스템 토폴로지 및 하드웨어 기능 블록도' : '시스템 기능 블록도';
});

const open = ref(true);
const index = ref(0);
watch(parsed, () => {
  index.value = 0;
});
const figureCount = computed(() => parsed.value?.figures.length ?? 0);
const figure = computed(() => parsed.value?.figures[index.value] ?? null);
const figureDoc = computed(() => (figure.value === null || parsed.value === null ? '' : figureSrcdoc(parsed.value.styles, figure.value.svg)));
function move(step: number): void {
  const n = figureCount.value;
  if (n > 0) index.value = (index.value + step + n) % n;
}

// 원문 전체 — 구조를 못 읽은 문서용(화면·출력물 한 장). AI 원문은 도면을 원본 크기(1900px)로 두고 가로 스크롤시키므로 폭에 맞춰 줄인다.
const FIT_STYLE = '<style>svg{max-width:100%!important;height:auto!important}</style>';
const fullDoc = computed(() => (/<\/head>/i.test(props.html) ? props.html.replace(/<\/head>/i, `${FIT_STYLE}</head>`) : `${FIT_STYLE}${props.html}`));
// 크게 보기(모달) — 도면과 글을 가른 문서면 지금 도면 한 장만(글은 아래 토글에 있다, 2026-11-05), 못 가르면 원문 전체.
const zoomDoc = computed(() => (figure.value === null ? fullDoc.value : figureDoc.value));
const zoom = ref(false);
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') zoom.value = false;
}
watch(zoom, (v) => {
  if (v) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

// 글 — 도면 앞(요약)·뒤(정리)를 한 묶음으로, 도면 아래 토글 안에. 기본 접힘.
const notes = computed<DiagramSection[]>(() => (parsed.value === null ? [] : [...parsed.value.before, ...parsed.value.after]));
const notesOpen = ref(false);
</script>

<template>
  <section class="flex flex-col gap-[16px] rounded-[14px] bg-[#f0f1f4] px-[10px] pb-[10px] pt-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
    <div class="flex flex-col gap-[2px] px-[14px] leading-[1.8]">
      <h3 class="text-[18px] font-bold text-black">{{ no }}시스템 구성도</h3>
      <p class="text-[14px] text-[#666]">{{ metaLine }}</p>
    </div>

    <!-- 출력물 — 펼친 그대로, 도면은 전부 이미지로, 글은 도면 아래. 제목은 h4 — 쪽 나누기가 첫 도면과 같이 민다(제목만 쪽 끝에 남지 않게) -->
    <div v-if="print" class="flex flex-col gap-[16px] rounded-[10px] bg-white px-[24px] pb-[20px] pt-[16px]">
      <h4 class="px-[4px] text-[18px] font-medium leading-[1.3] text-black">{{ accordionTitle }}</h4>
      <template v-if="parsed !== null">
        <figure v-for="(f, fi) in parsed.figures" :key="`pf${fi}`" class="print-keep flex flex-col gap-[10px]">
          <img :src="f.img" :alt="`시스템 구성도 ${fi + 1}`" class="block h-auto w-full rounded-[10px] border border-[#d9d9d9] bg-white p-[16px]">
          <figcaption v-if="f.caption !== ''" class="px-[4px] text-[15px] leading-[1.8] text-[#141e34]">{{ f.caption }}</figcaption>
        </figure>
      </template>
      <!-- 구조를 못 읽은 문서 — 원문 한 장(이미지로 바꿀 SVG 가 없다) -->
      <iframe v-else sandbox="" :srcdoc="fullDoc" title="시스템 구성도" class="h-[640px] w-full rounded-[10px] border border-[#d9d9d9]" />
      <div v-for="(s, si) in notes" :key="`pn${si}`" class="flex flex-col gap-[8px]">
        <p v-if="s.title !== ''" class="flex items-center gap-[10px] px-[4px] text-[17px] font-bold leading-[1.3] text-[#2945e8]">
          <img :src="bulletDot" alt="" class="block size-[6px]">{{ s.title }}
        </p>
        <ul class="list-disc px-[4px] text-[16px] leading-[1.9] text-[#141e34]">
          <li v-for="(t, ti) in s.items" :key="ti" class="ms-[24px]">{{ t }}</li>
        </ul>
      </div>
      <p class="px-[4px] text-[14px] leading-[1.8] text-[#666]">{{ DEV_DIAGRAM_DISCLAIMER }}</p>
    </div>

    <div v-else class="flex flex-col gap-[30px] rounded-[10px] bg-white px-[16px] pb-[20px] pt-[16px]">
      <button type="button" class="flex w-full items-center justify-between gap-4 px-[4px] text-left" :aria-expanded="open" @click="open = !open">
        <span class="text-[18px] font-medium leading-[1.3] text-black">{{ accordionTitle }}</span>
        <span class="relative block h-[6px] w-[12px] shrink-0 transition-transform" :class="open ? 'rotate-180' : ''" aria-hidden="true">
          <img :src="chevron" alt="" class="absolute left-[-1px] top-[-1px] block h-[8.414px] w-[14px] max-w-none">
        </span>
      </button>

      <div v-if="open" class="flex flex-col gap-[16px] px-[8px]">
        <!-- 도면 -->
        <div class="flex flex-col gap-[10px]">
          <div class="flex items-center gap-[10px]">
            <button
              type="button"
              class="flex h-[28px] w-[14px] shrink-0 items-center justify-center disabled:invisible"
              :disabled="figureCount < 2"
              aria-label="이전 도면"
              @click="move(-1)"
            >
              <img :src="arrow" alt="" class="block h-[16.414px] w-[30px] max-w-none rotate-90">
            </button>
            <div
              role="button"
              tabindex="0"
              aria-label="구성도 크게 보기"
              class="relative h-[360px] min-w-0 flex-1 cursor-zoom-in overflow-hidden rounded-[10px] border border-[#d9d9d9] bg-white lg:h-[660px]"
              @click="zoom = true"
              @keydown.enter="zoom = true"
            >
              <iframe
                v-if="figure !== null"
                sandbox=""
                :srcdoc="figureDoc"
                title="시스템 구성도"
                class="pointer-events-none absolute inset-[24px] h-[calc(100%-48px)] w-[calc(100%-48px)] border-0"
              />
              <iframe
                v-else
                sandbox=""
                :srcdoc="html"
                title="시스템 구성도"
                class="pointer-events-none absolute inset-0 h-full w-full border-0"
              />
              <span
                v-if="figureCount > 1"
                class="absolute bottom-[12px] right-[12px] rounded-[37px] bg-[#1b2b39] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] text-white"
              >{{ index + 1 }} / {{ figureCount }}</span>
            </div>
            <button
              type="button"
              class="flex h-[28px] w-[14px] shrink-0 items-center justify-center disabled:invisible"
              :disabled="figureCount < 2"
              aria-label="다음 도면"
              @click="move(1)"
            >
              <img :src="arrow" alt="" class="block h-[16.414px] w-[30px] max-w-none -rotate-90">
            </button>
          </div>
          <p v-if="figure !== null && figure.caption !== ''" class="px-[24px] text-[15px] leading-[1.8] text-[#141e34]">{{ figure.caption }}</p>
        </div>

        <!-- 글 — 기본 접힘 토글 -->
        <div v-if="notes.length > 0" class="flex flex-col gap-[16px]">
          <button
            type="button"
            class="flex h-[38px] items-center gap-[8px] self-start rounded-[6px] border border-[#d9d9d9] bg-white px-[14px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:bg-[#f0f1f4]"
            :aria-expanded="notesOpen"
            @click="notesOpen = !notesOpen"
          >
            {{ notesOpen ? '구성도 설명 접기' : '구성도 설명 보기' }}
            <span class="text-[#666]">{{ notes.length }}개 항목</span>
            <span class="relative block h-[6px] w-[12px] shrink-0 transition-transform" :class="notesOpen ? 'rotate-180' : ''" aria-hidden="true">
              <img :src="chevron" alt="" class="absolute left-[-1px] top-[-1px] block h-[8.414px] w-[14px] max-w-none">
            </span>
          </button>
          <template v-if="notesOpen">
            <div v-for="(s, si) in notes" :key="`n${si}`" class="flex flex-col gap-[8px]">
              <p v-if="s.title !== ''" class="flex items-center gap-[10px] px-[4px] text-[17px] font-bold leading-[1.3] text-[#2945e8]">
                <img :src="bulletDot" alt="" class="block size-[6px]">{{ s.title }}
              </p>
              <ul class="list-disc px-[4px] text-[16px] leading-[1.9] text-[#141e34]">
                <li v-for="(t, ti) in s.items" :key="ti" class="ms-[24px]">{{ t }}</li>
              </ul>
            </div>
          </template>
        </div>

        <p class="px-[4px] text-[14px] leading-[1.8] text-[#666]">{{ DEV_DIAGRAM_DISCLAIMER }}</p>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="zoom" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6" @click.self="zoom = false">
        <div class="flex h-[94vh] w-[96vw] max-w-[1800px] flex-col overflow-hidden rounded-[14px] bg-white shadow-2xl">
          <div class="flex items-center justify-between gap-6 border-b border-[#d9d9d9] px-5 py-3">
            <p class="text-[16px] font-bold text-black">
              시스템 구성도
              <span class="font-normal text-[#666]">{{ figure === null ? '(원문 전체)' : figureCount > 1 ? `${index + 1} / ${figureCount}` : '' }}</span>
            </p>
            <div class="flex items-center gap-[8px]">
              <template v-if="figureCount > 1">
                <button
                  type="button"
                  class="h-[34px] rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] text-[#0a151e] hover:border-[#9aa3ad]"
                  @click="move(-1)"
                >
                  ‹ 이전
                </button>
                <button
                  type="button"
                  class="h-[34px] rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] text-[#0a151e] hover:border-[#9aa3ad]"
                  @click="move(1)"
                >
                  다음 ›
                </button>
              </template>
              <button
                type="button"
                class="h-[34px] rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] text-[#0a151e] hover:border-[#9aa3ad]"
                @click="zoom = false"
              >
                닫기 ✕
              </button>
            </div>
          </div>
          <iframe sandbox="" :srcdoc="zoomDoc" title="시스템 구성도 크게 보기" class="min-h-0 flex-1 border-0" />
          <p v-if="figure !== null && figure.caption !== ''" class="border-t border-[#d9d9d9] px-5 py-3 text-[15px] leading-[1.8] text-[#141e34]">{{ figure.caption }}</p>
        </div>
      </div>
    </Teleport>
  </section>
</template>
