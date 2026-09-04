<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AiJobStageType, MarketDevDiagramType, MarketDevDiagramViewType, MarketDevReviewType } from '@sp/api-contract';
import DevDiagramSection from '../../components/dev-review/DevDiagramSection.vue';
import StepReview from '../../components/request/StepReview.vue';
import type { DevReviewJob } from '../../composables/useDevReviewJob';
import { useRequestWizardForm } from '../../composables/useRequestWizardForm';

// 개발 전용 상태 미리보기(docs/AI_DEV_REVIEW.md §13.11) — /market/dev/review-states
// 라우터가 `import.meta.env.DEV` 일 때만 등록하므로 운영 번들·URL 에는 없다.
//
// 3스텝의 **진짜 StepReview** 를 가짜 잡(DevReviewJob 과 같은 모양)으로 그린다. 실 LLM 을 돌리지 않고
// 생성 중·완료·실패·오래됨을 즉시 오갈 수 있어, 로딩 화면을 손볼 때 매번 위저드를 완주하지 않아도 된다.
// 폼은 진짜 컴포저블을 쓴다(제목·마감만 보이는 자리라 가짜를 만들 이유가 없다).

type MockState = 'reading' | 'writing' | 'slow' | 'done' | 'stale' | 'failed';
type MockDiagram = 'running' | 'skipped' | 'none';

const STATES: { key: MockState; label: string }[] = [
  { key: 'reading', label: '자료 읽는 중' },
  { key: 'writing', label: '검토서 작성 중' },
  { key: 'slow', label: '작성 중 (90초 초과)' },
  { key: 'done', label: '완료' },
  { key: 'stale', label: '완료 + 오래됨' },
  { key: 'failed', label: '실패' },
];
const DIAGRAMS: { key: MockDiagram; label: string }[] = [
  { key: 'running', label: '구성도 생성 중' },
  { key: 'skipped', label: '구성도 생략' },
  { key: 'none', label: '구성도 없음' },
];

const state = ref<MockState>('writing');
const diagram = ref<MockDiagram>('running');
const secs = ref(42);

const form = useRequestWizardForm();
form.fields.title = '반려견 자동 급식기 제어 보드';
form.fields.description = '집을 비울 때 정해진 시간에 사료를 주는 자동 급식기를 만들고 싶습니다.';
form.fields.serviceAreas = ['circuit', 'pcb', 'firmware', 'app'];

const SAMPLE_REVIEW: MarketDevReviewType = {
  version: 4,
  brief: {
    serviceAreas: ['circuit', 'pcb', 'firmware', 'app'],
    answers: [
      { code: 'stage', choices: ['idea'] },
      { code: 'quantity', choices: ['proto'], note: '먼저 3대' },
      { code: 'timeline', choices: ['m2_3'] },
    ],
  },
  summary: '정해진 시간에 사료를 배출하고 휴대폰으로 급식 시간을 설정·확인하는 Wi-Fi 급식기 제어 보드입니다.',
  requirements: [
    { text: '설정한 시간에 사료를 배출한다', evidence: '정해진 시간에 사료를 주는' },
    { text: '휴대폰 앱에서 급식 시간을 설정하고 기록을 확인한다', evidence: '스마트폰으로 급식 시간을 설정하고' },
    { text: '집 Wi-Fi 에 연결해 동작한다', evidence: '집 Wi-Fi 에 연결해서' },
  ],
  areas: [
    {
      area: 'circuit',
      summary: '모터 구동부와 제어부를 한 보드에 올린다.',
      spec: [{ item: '구동 대상', text: '사료 배출용 모터 1개', evidence: '사료가 나오는 부분' }],
      observations: [{ text: '기구 업체가 배출부를 따로 만들어 모터 사양이 아직 열려 있다.', evidence: '기구 업체가 따로 만들 예정' }],
    },
    {
      area: 'pcb',
      summary: '급식기 본체에 들어가는 제어 보드.',
      spec: [{ item: '수량', text: '시제품 3대', evidence: '먼저 3대' }],
      observations: [],
    },
    {
      area: 'firmware',
      summary: '시간 예약과 배출 제어, Wi-Fi 연결을 담당한다.',
      spec: [{ item: '연결', text: '집 Wi-Fi', evidence: '집 Wi-Fi 에 연결' }],
      observations: [],
    },
    {
      area: 'app',
      summary: '급식 시간 설정과 기록 조회 화면.',
      spec: [{ item: '기능', text: '급식 시간 설정 · 급식 기록 확인', evidence: '급식 기록을 확인하고' }],
      observations: [],
    },
  ],
  openQuestions: [
    { question: '한 번에 배출할 사료 양을 어떻게 정할까요?', why: '모터 종류와 제어 방식이 달라집니다', area: 'circuit' },
    { question: '전원은 어댑터인가요, 배터리인가요?', why: '보드 크기와 소비 전력 설계가 달라집니다', area: 'general' },
  ],
  checks: [],
  meta: {
    jobId: '00000000-0000-0000-0000-000000000000',
    model: 'deepseek-v3.2:cloud',
    promptVersion: 'dev-review.v5',
    inputHash: 'mock',
    generatedAt: new Date().toISOString(),
    attachmentFiles: ['급식기 구상도.pdf'],
  },
};

const SAMPLE_DIAGRAM_META: MarketDevDiagramType = {
  version: 1,
  status: 'running',
  jobId: '11111111-1111-1111-1111-111111111111',
  model: 'kimi-k2-thinking:cloud',
  promptVersion: 'dev-diagram.v2',
  think: 'high',
  requestedAt: new Date().toISOString(),
  generatedAt: null,
  elapsedSecs: null,
  attempt: 1,
  audit: null,
  error: null,
  skipReason: null,
  corpusChars: 1840,
};

const running = computed(() => state.value === 'reading' || state.value === 'writing' || state.value === 'slow');
const done = computed(() => state.value === 'done' || state.value === 'stale');
const include = ref(true);

// DevReviewJob 과 같은 모양 — StepReview 는 진짜인지 가짜인지 모른다.
const job: DevReviewJob = {
  active: computed(() => true),
  running,
  failed: computed(() => state.value === 'failed'),
  errorText: computed(() => (state.value === 'failed' ? '검토서 생성에 실패했습니다 — 모델 응답을 읽지 못했습니다.' : '')),
  stage: computed<AiJobStageType | null>(() =>
    state.value === 'reading' ? 'attachments' : running.value ? 'review' : null,
  ),
  elapsedSecs: computed(() => (state.value === 'slow' ? Math.max(secs.value, 95) : secs.value)),
  review: computed(() => (done.value ? SAMPLE_REVIEW : null)),
  stale: computed(() => state.value === 'stale'),
  include,
  includable: computed(() => done.value && state.value !== 'stale' && include.value),
  blocking: computed(() => running.value && include.value),
  jobId: computed(() => (state.value === 'failed' ? null : SAMPLE_REVIEW.meta.jobId)),
  diagramJobId: computed(() => (diagram.value === 'running' ? SAMPLE_DIAGRAM_META.jobId : null)),
  diagramMeta: computed(() => (diagram.value === 'running' ? SAMPLE_DIAGRAM_META : null)),
  diagramSkipReason: computed(() =>
    diagram.value === 'skipped' ? '설명이 500자보다 짧고 참고 자료가 없어 구성도는 만들지 않았습니다.' : null,
  ),
  diagramCached: computed(() => false),
  diagramFailed: computed(() => false),
  start: () => Promise.resolve(),
  ensure: () => undefined,
  regenerate: () => {
    state.value = 'reading';
  },
  skip: () => {
    include.value = false;
  },
};

// ── 시스템 구성도 섹션(§13.12) — 상세·검토서가 쓰는 DevDiagramSection 을 따로 세워 상태별로 본다.
//    위저드 경로에서는 html 이 언제나 null 이라(등록 뒤 상세에서만 본문) 완성 모양은 여기서만 볼 수 있다.
type MockSection = 'queued' | 'running' | 'overdue' | 'done' | 'error' | 'skipped' | 'none';
const SECTIONS: { key: MockSection; label: string }[] = [
  { key: 'queued', label: '대기 중' },
  { key: 'running', label: '그리는 중(3분)' },
  { key: 'overdue', label: '그리는 중(13분)' },
  { key: 'done', label: '완성' },
  { key: 'error', label: '실패' },
  { key: 'skipped', label: '생략' },
  { key: 'none', label: '없음' },
];
const section = ref<MockSection>('running');

const SAMPLE_DIAGRAM_HTML = `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px system-ui;background:#fff;padding:16px">
<svg viewBox="0 0 1900 1200" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="80" y="480" width="420" height="240" rx="18" fill="#eef3fb" stroke="#2b5fb3" stroke-width="4"/>
  <text x="290" y="610" text-anchor="middle" font-size="44" fill="#14243e">제어 보드</text>
  <rect x="760" y="220" width="420" height="240" rx="18" fill="#eefaf3" stroke="#1d8a5b" stroke-width="4"/>
  <text x="970" y="350" text-anchor="middle" font-size="44" fill="#14243e">사료 배출 모터</text>
  <rect x="760" y="740" width="420" height="240" rx="18" fill="#fdeef6" stroke="#d9488a" stroke-width="4"/>
  <text x="970" y="870" text-anchor="middle" font-size="44" fill="#14243e">스마트폰 앱</text>
  <path d="M500 560 H760 V460" stroke="#52627d" stroke-width="4" fill="none"/>
  <path d="M500 640 H760 V740" stroke="#52627d" stroke-width="4" fill="none"/>
</svg>
<h2 style="font-size:18px">검토 항목</h2><p>모터 사양과 전원 방식은 전문가 검토 후 확정합니다.</p></body>`;

const sectionMeta = (status: MarketDevDiagramType['status'], agoSecs: number): MarketDevDiagramType => ({
  ...SAMPLE_DIAGRAM_META,
  status,
  requestedAt: new Date(Date.now() - agoSecs * 1000).toISOString(),
  generatedAt: status === 'done' ? new Date().toISOString() : null,
  elapsedSecs: status === 'done' ? 412 : null,
  error: status === 'error' ? '모델 응답이 도면을 만들지 못했습니다' : null,
  skipReason: status === 'skipped' ? '설명이 500자보다 짧고 참고 자료가 없습니다.' : null,
});

const diagramView = computed<MarketDevDiagramViewType>(() => {
  switch (section.value) {
    case 'queued': return { meta: sectionMeta('queued', 4), html: null };
    case 'running': return { meta: sectionMeta('running', 192), html: null };
    case 'overdue': return { meta: sectionMeta('running', 780), html: null };
    case 'done': return { meta: sectionMeta('done', 412), html: SAMPLE_DIAGRAM_HTML };
    case 'error': return { meta: sectionMeta('error', 300), html: null };
    case 'skipped': return { meta: sectionMeta('skipped', 2), html: null };
    default: return { meta: null, html: null };
  }
});
</script>

<template>
  <section class="mx-auto w-full max-w-[900px] px-6 py-8">
    <!-- 컨트롤 — 개발 전용 -->
    <div class="sticky top-0 z-10 grid gap-3 rounded-2xl border-2 border-ink-900 bg-ink-950 p-5 text-dk-tx-1">
      <div class="flex flex-wrap items-center gap-2.5">
        <p class="font-mono text-micro tracking-[.14em] text-dk-tx-2">DEV ONLY</p>
        <p class="text-body font-extrabold">AI 사전 검토서 상태 미리보기</p>
        <p class="ml-auto text-label text-dk-tx-2">진짜 StepReview · API 호출 없음</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in STATES"
          :key="s.key"
          type="button"
          class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
          :class="state === s.key ? 'border-copper-400 bg-copper-500 text-white' : 'border-ink-700 text-dk-tx-2 hover:border-dk-tx-2'"
          @click="state = s.key"
        >
          {{ s.label }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="d in DIAGRAMS"
          :key="d.key"
          type="button"
          class="h-8 rounded-full border px-3 text-label font-semibold transition"
          :class="diagram === d.key ? 'border-dk-tx-1 bg-white text-ink-950' : 'border-ink-700 text-dk-tx-2 hover:border-dk-tx-2'"
          @click="diagram = d.key"
        >
          {{ d.label }}
        </button>
        <label class="ml-auto flex items-center gap-2 text-label text-dk-tx-2">
          경과 <input v-model.number="secs" type="range" min="0" max="180" class="w-40">
          <span class="w-12 text-right font-mono tabular-nums text-dk-tx-1">{{ secs }}초</span>
        </label>
      </div>
    </div>

    <div class="mt-6 rounded-2xl border border-line bg-white p-7">
      <StepReview :form="form" :job="job" />
    </div>

    <!-- 시스템 구성도 섹션 단독(상세 화면과 같은 컴포넌트) -->
    <div class="mt-8 grid gap-3">
      <div class="flex flex-wrap items-center gap-2 rounded-2xl bg-ink-950 px-5 py-3.5 text-dk-tx-1">
        <p class="text-body font-extrabold">시스템 구성도 섹션</p>
        <span class="text-label text-dk-tx-2">DevDiagramSection · 의뢰 상세와 같은 컴포넌트</span>
        <div class="ml-auto flex flex-wrap gap-2">
          <button
            v-for="s in SECTIONS"
            :key="s.key"
            type="button"
            class="h-8 rounded-full border px-3 text-label font-semibold transition"
            :class="section === s.key ? 'border-dk-tx-1 bg-white text-ink-950' : 'border-ink-700 text-dk-tx-2 hover:border-dk-tx-2'"
            @click="section = s.key"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
      <div class="rounded-2xl border border-line bg-white p-7">
        <DevDiagramSection :diagram="diagramView" can-regenerate />
      </div>
    </div>
  </section>
</template>
