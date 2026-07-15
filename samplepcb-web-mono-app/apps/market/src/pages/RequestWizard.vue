<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  DiagramSpec,
  getApplicableAiInterviewQuestions,
  MarketPostingCards,
  MARKET_AREA_SPECIALTIES,
  MARKET_AREA_TOOL_GROUPS,
  MARKET_BUDGET_RANGES,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CATEGORIES,
  MARKET_CATEGORY_LABELS,
  MARKET_DEADLINE_PRESETS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  MARKET_TOOL_GROUPS,
  MARKET_TOOL_GROUP_CODES,
  MARKET_TOOL_GROUP_LABELS,
  MARKET_TOOL_LABELS,
  MarketRequestType,
  MarketServiceArea,
} from '@sp/api-contract';
import type {
  AiInterviewAnswerType,
  AiInterviewQuestion,
  DiagramSpecType,
  MarketPostingCardsType,
  MarketBudgetRangeType,
  MarketCategoryCodeType,
  MarketProjectMethodType,
  MarketRequestTypeType,
  MarketServiceAreaType,
  MarketToolCodeType,
  MarketToolGroupType,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import DiagramViewer from '../components/DiagramViewer.vue';
import RocViewer from '../components/RocViewer.vue';
import {
  useAiJob,
  useAiUsecaseStatus,
  useRunDiagram,
  useRunDiagramSpec,
  useRunPostings,
  useRunRoc,
  useRunStructurize,
} from '../api/useAi';
import { useMarketExpertList } from '../api/useMarketExperts';
import type { ExpertListFilters } from '../api/useMarketExperts';
import { useCreateProject } from '../api/useMarketProjects';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';

// 의뢰 마법사(프로토타입 request.html 이식 + STEP2 동적화):
// 분야 → [전문 기술·도구(선택 분야에 질문 그룹이 있을 때만)] → 설명·첨부·NDA
// → 예산·일정·마감 → 방식·지정 전문가.
// STEP2 는 MARKET_AREA_TOOL_GROUPS·MARKET_AREA_SPECIALTIES 사전의 합집합으로 섹션을
// 구성하고, 질문 그룹이 하나도 없으면 스텝 자체를 목록에서 제거한다(빈 스텝 노출 금지).
// 모든 STEP2 항목은 선택 사항 — 비워두면 "조건 없음"(구 'any' 코드는 저장하지 않는다).
// ?cat= 분야 프리셋, ?expert= 지정견적 프리셋(전문가 상세의 CTA 진입).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const create = useCreateProject();

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
  categories: MarketCategoryCodeType[]; // 세부분야 — 빈 배열 = 지정 없음
  cadTools: MarketToolCodeType[]; // 요구 툴 — 빈 배열 = 특정 툴 요구 없음
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
  categories: [],
  cadTools: [],
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

// ── STEP2 질문 그룹 파생(분야 → 사전 합집합, 사전 순서 유지) ─────────────────

const toolGroups = computed<MarketToolGroupType[]>(() => {
  const set = new Set<MarketToolGroupType>();
  for (const area of form.serviceAreas) {
    for (const g of MARKET_AREA_TOOL_GROUPS[area] ?? []) set.add(g);
  }
  return MARKET_TOOL_GROUPS.filter((g) => set.has(g));
});

const specialtyCodes = computed<MarketCategoryCodeType[]>(() => {
  const set = new Set<MarketCategoryCodeType>();
  for (const area of form.serviceAreas) {
    for (const c of MARKET_AREA_SPECIALTIES[area] ?? []) set.add(c);
  }
  return MARKET_CATEGORIES.filter((c) => set.has(c));
});

const hasTechnicalStep = computed(
  () => toolGroups.value.length > 0 || specialtyCodes.value.length > 0,
);

// 분야 변경 시 가지치기 — 더는 노출되지 않는 그룹의 선택값이 payload 에 남지 않게.
function pruneTechnical(): void {
  const validTools = new Set<MarketToolCodeType>(
    toolGroups.value.flatMap((g) => [...MARKET_TOOL_GROUP_CODES[g]]),
  );
  form.cadTools = form.cadTools.filter((c) => validTools.has(c));
  const validSpecs = new Set(specialtyCodes.value);
  form.categories = form.categories.filter((c) => validSpecs.has(c));
}

// ── AI 시스템 구성도(diagram 스텝) — 관리자 활성 시에만 스텝 존재 ─────────────
// 두 경로: ① 인터뷰(structurize+diagram-spec 둘 다 활성) = 코어 질문 → 구성 명세 JSON
// → 요약·TBD 확인 → 명세 렌더, ② 폴백(legacy diagram 만 활성) = 설명 → HTML 단발.
// 생성 ~3분: run 은 jobId 만 받고 5초 폴링. 사용자는 기다리지 않고 다음 스텝을 진행해도
// 되며(폴링은 컴포넌트 상태로 지속), 완료되면 미리보기가 뜬다. 실패·미완료여도 제출은
// 막지 않는다(비차단). 외부 전송은 제목·분야·설명·인터뷰 답변 텍스트뿐 — 첨부는 보내지
// 않는다(NDA 원칙).

const diagramStatus = useAiUsecaseStatus('market.request-diagram');
const structurizeStatus = useAiUsecaseStatus('market.request-structurize');
const diagramSpecStatus = useAiUsecaseStatus('market.request-diagram-spec');
const rocStatus = useAiUsecaseStatus('market.request-roc');
const interviewEnabled = computed(
  () =>
    (structurizeStatus.data.value?.data.enabled ?? false) &&
    (diagramSpecStatus.data.value?.data.enabled ?? false),
);
// 작업검토지시서(Phase 2) — 인터뷰 경로 위에서만 의미(명세가 입력), 별도 토글.
const rocEnabled = computed(
  () => interviewEnabled.value && (rocStatus.data.value?.data.enabled ?? false),
);
// 분야별 포스팅 카드(Phase 3) — 동일하게 인터뷰 경로 위 별도 토글.
const postingsStatus = useAiUsecaseStatus('market.request-postings');
const postingsEnabled = computed(
  () => interviewEnabled.value && (postingsStatus.data.value?.data.enabled ?? false),
);
const hasElectronicsArea = computed(() =>
  form.serviceAreas.some((area) => area === 'circuit' || area === 'pcb' || area === 'firmware'),
);
const legacyDiagramEnabled = computed(
  () => (diagramStatus.data.value?.data.enabled ?? false) && hasElectronicsArea.value,
);
const diagramStepEnabled = computed(() => interviewEnabled.value || legacyDiagramEnabled.value);

const runDiagram = useRunDiagram();
const runStructurize = useRunStructurize();
const runDiagramSpec = useRunDiagramSpec();
const runRoc = useRunRoc();
const runPostings = useRunPostings();
const diagramJobId = ref<string | null>(null);
const diagramJob = useAiJob(diagramJobId);
const includeDiagram = ref(true);
const includeSpec = ref(true);

const diagramHtml = computed<string | null>(() =>
  diagramJob.data.value?.data.status === 'done' ? diagramJob.data.value.data.html : null,
);
const diagramRunning = computed(
  () =>
    runDiagram.isPending.value ||
    runDiagramSpec.isPending.value ||
    (diagramJobId.value !== null &&
      !diagramJob.isError.value &&
      (diagramJob.data.value?.data.status ?? 'running') === 'running'),
);
const diagramFailed = computed(
  () =>
    runDiagram.isError.value ||
    runDiagramSpec.isError.value ||
    diagramJob.isError.value ||
    diagramJob.data.value?.data.status === 'error',
);

function generateDiagram(): void {
  aiGeneratedSourceSignature.value = aiSourceSignature.value;
  includeDiagram.value = true;
  diagramJobId.value = null;
  runDiagram.mutate(
    {
      title: form.title.trim(),
      serviceAreas: form.serviceAreas,
      categories: form.categories,
      cadTools: form.cadTools,
      description: form.description.trim(),
    },
    { onSuccess: (res) => { diagramJobId.value = res.data.jobId; } },
  );
}

// ── 인터뷰(코어 질문 → 구성 명세) ────────────────────────────────────────────
// 전 문항 선택 사항 — 비워두면 구조화 프롬프트의 "미응답 항목"으로 넘어가 TBD·추가질문
// (questions_missing)으로 돌아온다. 조건부 노출(hideIf)은 계약 질문 뱅크 정의를 따른다.

const interviewValues = reactive<Record<string, string | string[]>>({});
// 명세의 questions_missing 에 대한 보강 답변 — 반영(재구조화) 시 extraAnswers 로 흡수.
const gapInputs = reactive<Record<string, string>>({});
const extraAnswers = ref<string[]>([]);

const interviewAnswerStr = (code: string): string => {
  const v = interviewValues[code];
  return Array.isArray(v) ? v.join(', ') : (v ?? '');
};

const questionHidden = (q: AiInterviewQuestion): boolean => {
  const hide = q.hideIf;
  return hide === undefined
    ? false
    : hide.values.some((v) => interviewAnswerStr(hide.code).includes(v));
};
const visibleQuestions = computed<AiInterviewQuestion[]>(() =>
  getApplicableAiInterviewQuestions(form.serviceAreas).filter((q) => !questionHidden(q)),
);

const questionContextLabel = (q: AiInterviewQuestion): string => {
  if (q.areas === undefined) return '공통';
  const applicable = q.areas.filter((area) => form.serviceAreas.includes(area));
  return applicable.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join('·');
};

function setSingle(code: string, option: string): void {
  interviewValues[code] = interviewValues[code] === option ? '' : option;
}
function toggleMulti(code: string, option: string): void {
  const cur = interviewValues[code];
  const arr = Array.isArray(cur) ? [...cur] : [];
  const i = arr.indexOf(option);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(option);
  interviewValues[code] = arr;
}

function interviewAnswers(): AiInterviewAnswerType[] {
  const answers: AiInterviewAnswerType[] = [];
  for (const q of visibleQuestions.value) {
    const a = interviewAnswerStr(q.code).trim();
    if (a !== '') answers.push({ code: q.code, answer: a });
  }
  for (const extra of extraAnswers.value) answers.push({ code: 'extra', answer: extra });
  return answers;
}

const specJobId = ref<string | null>(null);
const specJob = useAiJob(specJobId);
const specJson = computed<string | null>(() =>
  specJob.data.value?.data.status === 'done' ? specJob.data.value.data.json : null,
);
const spec = computed<DiagramSpecType | null>(() => {
  if (specJson.value === null) return null;
  try {
    return DiagramSpec.parse(JSON.parse(specJson.value));
  } catch {
    return null;
  }
});
const specRunning = computed(
  () =>
    runStructurize.isPending.value ||
    (specJobId.value !== null &&
      !specJob.isError.value &&
      (specJob.data.value?.data.status ?? 'running') === 'running'),
);
const specFailed = computed(
  () =>
    runStructurize.isError.value ||
    specJob.isError.value ||
    specJob.data.value?.data.status === 'error',
);
const specTbdBlocks = computed(() =>
  (spec.value?.blocks ?? []).filter((b) => b.status === 'tbd').map((b) => b.label),
);

function generateSpec(): void {
  // 보강 입력을 영속 답변으로 흡수(질문 원문 → 답 형태) 후 입력칸 비움.
  const missing = spec.value?.questions_missing ?? [];
  for (const [idx, text] of Object.entries(gapInputs)) {
    const t = text.trim();
    const q = missing[Number(idx)];
    if (t !== '' && q !== undefined) extraAnswers.value.push(`${q.question} → ${t}`);
    gapInputs[idx] = '';
  }
  aiGeneratedSourceSignature.value = aiSourceSignature.value;
  includeSpec.value = true;
  specJobId.value = null;
  diagramJobId.value = null; // 명세가 바뀌면 이전 구성도·지시서·포스팅 카드는 무효
  rocJobId.value = null;
  postingsJobId.value = null;
  runStructurize.mutate(
    {
      title: form.title.trim(),
      serviceAreas: form.serviceAreas,
      categories: form.categories,
      cadTools: form.cadTools,
      description: form.description.trim(),
      answers: interviewAnswers(),
    },
    { onSuccess: (res) => { specJobId.value = res.data.jobId; } },
  );
}

// 답변 수정 — 명세를 버리고 질문 폼으로(답변 값은 보존).
function reopenInterview(): void {
  specJobId.value = null;
  diagramJobId.value = null;
  rocJobId.value = null;
  postingsJobId.value = null;
  aiGeneratedSourceSignature.value = null;
}

function generateDiagramFromSpec(): void {
  if (specJson.value === null || aiArtifactsStale.value) return;
  includeDiagram.value = true;
  diagramJobId.value = null;
  runDiagramSpec.mutate(
    { spec: specJson.value },
    { onSuccess: (res) => { diagramJobId.value = res.data.jobId; } },
  );
}

// ── 작업검토지시서(Phase 2) — 명세 확정 후 선택 생성(~40초) ──────────────────
const rocJobId = ref<string | null>(null);
const rocJob = useAiJob(rocJobId);
const includeRoc = ref(true);
const rocMd = computed<string | null>(() =>
  rocJob.data.value?.data.status === 'done' ? rocJob.data.value.data.md : null,
);
const rocRunning = computed(
  () =>
    runRoc.isPending.value ||
    (rocJobId.value !== null &&
      !rocJob.isError.value &&
      (rocJob.data.value?.data.status ?? 'running') === 'running'),
);
const rocFailed = computed(
  () =>
    runRoc.isError.value || rocJob.isError.value || rocJob.data.value?.data.status === 'error',
);

function generateRoc(): void {
  if (specJson.value === null || aiArtifactsStale.value) return;
  includeRoc.value = true;
  rocJobId.value = null;
  runRoc.mutate(
    {
      title: form.title.trim(),
      serviceAreas: form.serviceAreas,
      categories: form.categories,
      cadTools: form.cadTools,
      description: form.description.trim(),
      spec: specJson.value,
      answers: interviewAnswers(),
    },
    { onSuccess: (res) => { rocJobId.value = res.data.jobId; } },
  );
}

// ── 분야별 포스팅 카드(Phase 3) — 명세 확정 후 선택 생성 ─────────────────────
const postingsJobId = ref<string | null>(null);
const postingsJob = useAiJob(postingsJobId);
const includePostings = ref(true);
const postingCards = computed<MarketPostingCardsType | null>(() => {
  const raw = postingsJob.data.value?.data.status === 'done' ? postingsJob.data.value.data.json : null;
  if (raw === null) return null;
  try {
    const parsed = MarketPostingCards.safeParse((JSON.parse(raw) as { postings?: unknown }).postings);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});
const postingsRunning = computed(
  () =>
    runPostings.isPending.value ||
    (postingsJobId.value !== null &&
      !postingsJob.isError.value &&
      (postingsJob.data.value?.data.status ?? 'running') === 'running'),
);
const postingsFailed = computed(
  () =>
    runPostings.isError.value ||
    postingsJob.isError.value ||
    postingsJob.data.value?.data.status === 'error',
);

function generatePostings(): void {
  if (specJson.value === null || aiArtifactsStale.value) return;
  includePostings.value = true;
  postingsJobId.value = null;
  runPostings.mutate(
    {
      title: form.title.trim(),
      serviceAreas: form.serviceAreas,
      categories: form.categories,
      cadTools: form.cadTools,
      description: form.description.trim(),
      spec: specJson.value,
      answers: interviewAnswers(),
    },
    { onSuccess: (res) => { postingsJobId.value = res.data.jobId; } },
  );
}

// AI 결과는 생성 버튼을 누른 시점의 입력에 종속된다. 앞 단계 입력이 달라지면 결과를
// 화면에는 남겨 비교할 수 있게 하되 제출에서는 자동 제외한다(provenance 도입 전 방어선).
const aiSourceSignature = computed(() =>
  JSON.stringify({
    requestType: form.requestType,
    serviceAreas: form.serviceAreas,
    categories: form.categories,
    cadTools: form.cadTools,
    title: form.title.trim(),
    description: form.description.trim(),
    answers: interviewAnswers(),
  }),
);
const aiGeneratedSourceSignature = ref<string | null>(null);
const hasAiAttempt = computed(
  () =>
    specJobId.value !== null ||
    diagramJobId.value !== null ||
    rocJobId.value !== null ||
    postingsJobId.value !== null,
);
const aiArtifactsStale = computed(
  () =>
    hasAiAttempt.value &&
    aiGeneratedSourceSignature.value !== null &&
    aiSourceSignature.value !== aiGeneratedSourceSignature.value,
);

watch(aiArtifactsStale, (stale) => {
  if (!stale) return;
  includeSpec.value = false;
  includeDiagram.value = false;
  includeRoc.value = false;
  includePostings.value = false;
});

// ROC·분야 카드는 구성 명세의 파생물이다.
watch(includeSpec, (included) => {
  if (included) return;
  includeRoc.value = false;
  includePostings.value = false;
});

// ── 동적 스텝 — 고정 번호 대신 키 배열(질문 그룹 없으면 technical 제거) ───────

type StepKey = 'area' | 'technical' | 'description' | 'diagram' | 'schedule' | 'method';

const steps = computed<{ key: StepKey; label: string }[]>(() => [
  { key: 'area', label: '분야' },
  ...(hasTechnicalStep.value ? [{ key: 'technical' as const, label: '전문 기술·도구' }] : []),
  { key: 'description', label: '설명·자료' },
  ...(diagramStepEnabled.value ? [{ key: 'diagram' as const, label: '시스템 구성도' }] : []),
  { key: 'schedule', label: '예산·일정' },
  { key: 'method', label: '견적 방식' },
]);

const stepIndex = ref(0);
const currentStep = computed<StepKey>(() => steps.value[stepIndex.value]?.key ?? 'area');
const isLastStep = computed(() => stepIndex.value === steps.value.length - 1);

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

function toggleTool(code: MarketToolCodeType): void {
  const i = form.cadTools.indexOf(code);
  if (i >= 0) form.cadTools.splice(i, 1);
  else form.cadTools.push(code);
}

function toggleSpecialty(code: MarketCategoryCodeType): void {
  const i = form.categories.indexOf(code);
  if (i >= 0) form.categories.splice(i, 1);
  else form.categories.push(code);
}

function toggleServiceArea(code: MarketServiceAreaType): void {
  const i = form.serviceAreas.indexOf(code);
  if (i >= 0) form.serviceAreas.splice(i, 1);
  else form.serviceAreas.push(code);
  if (form.requestType === 'individual' && form.serviceAreas.length > 1) {
    form.requestType = 'system';
    typeNotice.value = '개발 분야를 여러 개 선택해 의뢰 유형이 시스템 통합 개발로 자동 변경되었습니다.';
  }
  pruneTechnical();
}

function selectRequestType(type: MarketRequestTypeType): void {
  form.requestType = type;
  typeNotice.value = '';
  if (type === 'individual' && form.serviceAreas.length > 1) {
    form.serviceAreas = [form.serviceAreas[0] ?? 'circuit'];
    typeNotice.value = '개별 분야 개발은 한 분야만 선택할 수 있어 첫 번째 분야만 유지했습니다.';
    pruneTechnical();
  }
}

const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

const stepValid = computed<boolean>(() => {
  const key = currentStep.value;
  if (key === 'area') return form.requestType === 'system' || form.serviceAreas.length === 1;
  if (key === 'technical') return true; // 전 항목 선택 사항
  if (key === 'description') {
    return form.title.trim().length >= 2 && form.description.trim().length >= 10;
  }
  if (key === 'diagram') return true; // 선택 사항 — 생성 중·실패여도 진행 가능
  if (key === 'schedule') {
    return form.deadlineMode !== 'date' || form.deadlineDate >= todayKst;
  }
  return form.method === 'open' || form.targetExpertId !== null;
});

async function submit(): Promise<void> {
  submitError.value = '';
  const payload = {
    title: form.title.trim(),
    requestType: form.requestType,
    serviceAreas: form.serviceAreas,
    categories: form.categories,
    cadTools: form.cadTools,
    description: form.description.trim(),
    ...(diagramHtml.value !== null && includeDiagram.value && !aiArtifactsStale.value
      ? { diagramHtml: diagramHtml.value }
      : {}),
    // 구성 명세는 구성도의 원천 데이터 — 렌더 전 제출이어도 명세가 있으면 함께 저장
    // (후속 재생성·문서 파생의 근원). 인터뷰 답변 원본도 재생성용으로 동봉(응답 미노출).
    ...(specJson.value !== null && includeSpec.value && !aiArtifactsStale.value
      ? { diagramSpec: specJson.value, interviewAnswers: interviewAnswers() }
      : {}),
    ...(rocMd.value !== null && includeSpec.value && includeRoc.value && !aiArtifactsStale.value
      ? { rocMd: rocMd.value }
      : {}),
    ...(postingCards.value !== null && includeSpec.value && includePostings.value && !aiArtifactsStale.value
      ? { postings: postingCards.value }
      : {}),
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
        <li v-for="(s, i) in steps" :key="s.key" class="flex items-center gap-2">
          <span
            class="flex h-6 w-6 items-center justify-center rounded-full"
            :class="
              stepIndex === i
                ? 'bg-copper-500 text-white'
                : stepIndex > i
                  ? 'bg-ink-900 text-white'
                  : 'bg-line text-tx-3'
            "
          >
            {{ i + 1 }}
          </span>
          <span :class="stepIndex === i ? 'text-tx-1' : 'text-tx-3'">{{ s.label }}</span>
          <span v-if="i < steps.length - 1" class="text-line-2">─</span>
        </li>
      </ol>

      <div class="mt-6 rounded-2xl border border-line bg-white p-6 sm:p-8">
        <!-- STEP: 분야 -->
        <div v-if="currentStep === 'area'" class="grid gap-6">
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

        <!-- STEP: 전문 기술·도구 (선택 분야에 질문 그룹이 있을 때만 스텝 존재) -->
        <div v-else-if="currentStep === 'technical'" class="grid gap-6">
          <div v-if="specialtyCodes.length > 0">
            <p class="text-xs font-bold text-tx-2">
              세부분야 <span class="font-normal text-tx-3">(선택 · 복수 선택 가능)</span>
            </p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <button
                v-for="c in specialtyCodes"
                :key="c"
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                :class="
                  form.categories.includes(c)
                    ? 'border-ink-900 bg-ink-900 text-white'
                    : 'border-line text-tx-2 hover:border-line-2'
                "
                @click="toggleSpecialty(c)"
              >
                {{ MARKET_CATEGORY_LABELS[c] }}
              </button>
            </div>
          </div>
          <div v-for="g in toolGroups" :key="g">
            <p class="text-xs font-bold text-tx-2">
              {{ MARKET_TOOL_GROUP_LABELS[g] }}
              <span class="font-normal text-tx-3">(선택 · 복수 선택 가능)</span>
            </p>
            <div class="mt-3 flex flex-wrap gap-1.5">
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
                @click="toggleTool(c)"
              >
                {{ MARKET_TOOL_LABELS[c] }}
              </button>
            </div>
          </div>
          <p class="text-xs leading-relaxed text-tx-3">
            모두 선택 사항입니다 — 비워두면 조건 없음으로 등록되어 더 많은 전문가가 견적을 낼 수 있습니다.
            목록에 없는 툴·기술은 상세 설명에 적어주세요.
          </p>
        </div>

        <!-- STEP: 설명·자료·NDA -->
        <div v-else-if="currentStep === 'description'" class="grid gap-4">
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

        <!-- STEP: AI 시스템 구성도 (관리자 활성 시에만 스텝 존재) -->
        <div v-else-if="currentStep === 'diagram'" class="grid gap-4">
          <div>
            <p class="text-xs font-bold text-tx-2">
              AI 시스템 구성도 <span class="font-normal text-tx-3">(선택)</span>
            </p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-3">
              <template v-if="interviewEnabled">
                공통 질문과 선택한 개발 분야에 맞는 질문만 보여드립니다. 답할수록 구성도와 요구사항 정리가 정확해집니다 — 모두 선택 사항이며,
                건너뛴 항목은 구성도에 "(TBD)"(미확정)로 표시됩니다.
                입력하신 제목·설명·답변 텍스트가 AI 생성을 위해 외부 서버로 전송됩니다 — 첨부 파일은 전송되지 않습니다.
              </template>
              <template v-else>
                작성하신 제목·분야·상세 설명으로 시스템 구성도 초안을 자동 생성합니다.
                생성에 약 2~3분이 걸리며, 기다리는 동안 다음 단계를 먼저 진행하셔도 됩니다.
                입력하신 텍스트가 AI 생성을 위해 외부 서버로 전송됩니다 — 첨부 파일은 전송되지 않습니다.
              </template>
            </p>
          </div>

          <div
            v-if="aiArtifactsStale"
            class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"
          >
            <p class="font-bold">앞 단계의 내용이 변경되어 기존 AI 결과가 오래된 상태입니다.</p>
            <p class="mt-1">현재 결과는 의뢰 등록에서 자동 제외됩니다. 변경된 내용으로 다시 생성해 주세요.</p>
            <button
              v-if="interviewEnabled"
              type="button"
              class="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-bold hover:border-amber-500"
              @click="reopenInterview"
            >
              질문·명세 다시 확인
            </button>
          </div>

          <!-- 인터뷰 경로: 질문 폼 → 명세 요약·TBD·추가질문 → 구성도 -->
          <template v-if="interviewEnabled">
            <!-- 1) 코어 질문 폼 (명세가 없을 때) -->
            <div v-if="spec === null" class="grid gap-4">
              <div v-for="q in visibleQuestions" :key="q.code">
                <p class="text-xs font-bold text-tx-2">
                  <span class="mr-1 rounded bg-paper px-1.5 py-0.5 text-[10px] text-tx-3">{{ questionContextLabel(q) }}</span>
                  {{ q.label }} <span class="font-normal text-tx-3">(선택)</span>
                </p>
                <div v-if="q.type === 'text'" class="mt-2">
                  <input
                    :value="interviewAnswerStr(q.code)"
                    type="text"
                    :placeholder="q.placeholder ?? ''"
                    class="h-9 w-full rounded-lg border border-line px-3 text-xs font-normal"
                    @input="interviewValues[q.code] = ($event.target as HTMLInputElement).value"
                  >
                </div>
                <div v-else class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    v-for="opt in q.options ?? []"
                    :key="opt"
                    type="button"
                    class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    :class="
                      (q.type === 'single'
                        ? interviewValues[q.code] === opt
                        : Array.isArray(interviewValues[q.code]) &&
                          (interviewValues[q.code] as string[]).includes(opt))
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-line text-tx-2 hover:border-line-2'
                    "
                    @click="q.type === 'single' ? setSingle(q.code, opt) : toggleMulti(q.code, opt)"
                  >
                    {{ opt }}
                  </button>
                </div>
              </div>
              <div class="grid gap-2">
                <div>
                  <button
                    type="button"
                    class="rounded-lg bg-ink-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
                    :disabled="specRunning"
                    @click="generateSpec"
                  >
                    {{ specRunning ? '구성 명세 정리 중…' : 'AI 구성 명세 만들기' }}
                  </button>
                </div>
                <p v-if="specRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                  ⏳ 답변을 구조화하고 있습니다(약 30초~1분) — "다음"으로 넘어가 나머지를 작성하셔도 됩니다.
                </p>
                <p v-else-if="specFailed" class="text-xs font-semibold text-red-600">
                  구조화에 실패했습니다. 잠시 후 다시 시도해 주세요.
                </p>
              </div>
            </div>

            <!-- 2) 명세 요약 + TBD + 추가질문(보강) + 구성도 -->
            <template v-else>
              <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
                <p class="flex flex-wrap items-center gap-2">
                  <b class="text-tx-1">AI가 이해한 시스템</b>
                  <span class="rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{{ spec.project.name }}</span>
                  <span class="text-tx-3">블록 {{ spec.blocks.length }} · 연결 {{ spec.connections.length }} · 그룹 {{ spec.groups.length }}</span>
                </p>
                <p v-if="spec.project.summary !== ''" class="mt-1">{{ spec.project.summary }}</p>
                <p class="mt-2 flex flex-wrap gap-1.5">
                  <span v-for="g in spec.groups" :key="g.id" class="rounded-full border border-line px-2 py-0.5 text-[11px] text-tx-3">{{ g.label }}</span>
                </p>
                <p v-if="specTbdBlocks.length > 0" class="mt-2 leading-relaxed">
                  <b class="text-amber-700">미확정(TBD) {{ specTbdBlocks.length }}건:</b>
                  {{ specTbdBlocks.join(' · ') }}
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <label class="flex items-center gap-2 text-[11px] font-semibold text-tx-2">
                    <input v-model="includeSpec" type="checkbox" :disabled="aiArtifactsStale">
                    이 AI 구성 명세를 의뢰에 포함
                  </label>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2"
                    @click="reopenInterview"
                  >
                    답변 수정(명세 다시 만들기)
                  </button>
                </div>
              </div>

              <div v-if="spec.questions_missing.length > 0" class="grid gap-2 rounded-xl border border-line p-4">
                <p class="text-xs font-bold text-tx-2">
                  AI 추가 질문 <span class="font-normal text-tx-3">— 답해주시면 더 정확해집니다(선택)</span>
                </p>
                <label
                  v-for="(mq, i) in spec.questions_missing"
                  :key="i"
                  class="grid gap-1 text-xs font-normal text-tx-2"
                >
                  {{ mq.question }}
                  <input
                    :value="gapInputs[String(i)] ?? ''"
                    type="text"
                    class="h-9 rounded-lg border border-line px-3 text-xs"
                    @input="gapInputs[String(i)] = ($event.target as HTMLInputElement).value"
                  >
                </label>
                <div>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="specRunning || Object.values(gapInputs).every((v) => v.trim() === '')"
                    @click="generateSpec"
                  >
                    {{ specRunning ? '반영 중…' : '보강 답변 반영해 명세 다시 만들기' }}
                  </button>
                </div>
              </div>

              <div v-if="diagramHtml === null" class="grid gap-2">
                <div>
                  <button
                    type="button"
                    class="rounded-lg bg-ink-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
                    :disabled="diagramRunning || specRunning || aiArtifactsStale"
                    @click="generateDiagramFromSpec"
                  >
                    {{ diagramRunning ? '구성도 생성 중…' : '이 명세로 구성도 생성' }}
                  </button>
                </div>
                <p v-if="diagramRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                  ⏳ 생성 중입니다(약 2~3분) — "다음"으로 넘어가 나머지를 작성하시면, 완료 시 이 단계와 요약에 반영됩니다.
                </p>
                <p v-else-if="diagramFailed" class="text-xs font-semibold text-red-600">
                  생성에 실패했습니다. 잠시 후 다시 시도해 주세요.
                </p>
              </div>
              <template v-else>
                <DiagramViewer :html="diagramHtml" />
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                    <input v-model="includeDiagram" type="checkbox" :disabled="aiArtifactsStale">
                    이 구성도를 의뢰에 첨부
                  </label>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="diagramRunning || aiArtifactsStale"
                    @click="generateDiagramFromSpec"
                  >
                    {{ diagramRunning ? '생성 중…' : '다시 생성' }}
                  </button>
                </div>
              </template>

              <!-- 작업검토지시서(Phase 2) — 명세 기반 선택 생성 -->
              <div v-if="rocEnabled" class="grid gap-2 border-t border-line pt-4">
                <p class="text-xs font-bold text-tx-2">
                  AI 작업검토지시서 <span class="font-normal text-tx-3">(선택)</span>
                </p>
                <p class="text-xs leading-relaxed text-tx-3">
                  확정된 명세로 견적 낼 전문가·검수자가 참고할 요구사항 문서를 만듭니다(약 1분).
                  공개 범위는 상세 설명과 같습니다.
                </p>
                <div v-if="rocMd === null" class="grid gap-2">
                  <div>
                    <button
                      type="button"
                      class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                      :disabled="rocRunning || specRunning || aiArtifactsStale || !includeSpec"
                      @click="generateRoc"
                    >
                      {{ rocRunning ? '지시서 생성 중…' : '작업검토지시서 생성' }}
                    </button>
                  </div>
                  <p v-if="rocRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                    ⏳ 생성 중입니다 — 다음 단계를 먼저 진행하셔도 됩니다.
                  </p>
                  <p v-else-if="rocFailed" class="text-xs font-semibold text-red-600">
                    생성에 실패했습니다. 잠시 후 다시 시도해 주세요.
                  </p>
                </div>
                <template v-else>
                  <div class="max-h-80 overflow-y-auto">
                    <RocViewer :md="rocMd" />
                  </div>
                  <div class="flex flex-wrap items-center gap-4">
                    <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                      <input v-model="includeRoc" type="checkbox" :disabled="aiArtifactsStale || !includeSpec">
                      이 지시서를 의뢰에 첨부
                    </label>
                    <button
                      type="button"
                      class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                      :disabled="rocRunning || aiArtifactsStale || !includeSpec"
                      @click="generateRoc"
                    >
                      {{ rocRunning ? '생성 중…' : '다시 생성' }}
                    </button>
                  </div>
                </template>
              </div>

              <!-- 분야별 포스팅 카드(Phase 3) — 명세 기반 선택 생성 -->
              <div v-if="postingsEnabled && form.serviceAreas.length > 0" class="grid gap-2 border-t border-line pt-4">
                <p class="text-xs font-bold text-tx-2">
                  분야별 작업 안내 카드 <span class="font-normal text-tx-3">(선택)</span>
                </p>
                <p class="text-xs leading-relaxed text-tx-3">
                  선택하신 개발 분야별로 전문가가 견적 가능 여부를 빠르게 판단할 요약 카드를 만듭니다(약 30초~1분).
                </p>
                <div v-if="postingCards === null" class="grid gap-2">
                  <div>
                    <button
                      type="button"
                      class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                      :disabled="postingsRunning || specRunning || aiArtifactsStale || !includeSpec"
                      @click="generatePostings"
                    >
                      {{ postingsRunning ? '카드 생성 중…' : '분야별 카드 생성' }}
                    </button>
                  </div>
                  <p v-if="postingsRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                    ⏳ 생성 중입니다 — 다음 단계를 먼저 진행하셔도 됩니다.
                  </p>
                  <p v-else-if="postingsFailed" class="text-xs font-semibold text-red-600">
                    생성에 실패했습니다. 잠시 후 다시 시도해 주세요.
                  </p>
                </div>
                <template v-else>
                  <div class="grid gap-2 sm:grid-cols-2">
                    <div
                      v-for="card in postingCards"
                      :key="card.serviceArea"
                      class="rounded-xl border border-line p-3 text-xs leading-relaxed text-tx-2"
                    >
                      <p class="font-extrabold text-tx-1">{{ MARKET_SERVICE_AREA_LABELS[card.serviceArea] }}</p>
                      <ul class="mt-1.5 grid gap-1">
                        <li v-for="(s, i) in card.summary" :key="i" class="flex gap-1.5">
                          <span class="text-copper-500">•</span><span>{{ s }}</span>
                        </li>
                      </ul>
                      <p class="mt-1.5 text-tx-3">작업 {{ card.scope.length }}항목<template v-if="(card.notes ?? []).length > 0"> · 확인 필요 {{ (card.notes ?? []).length }}건</template></p>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-4">
                    <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                      <input v-model="includePostings" type="checkbox" :disabled="aiArtifactsStale || !includeSpec">
                      이 카드를 의뢰에 첨부
                    </label>
                    <button
                      type="button"
                      class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                      :disabled="postingsRunning || aiArtifactsStale || !includeSpec"
                      @click="generatePostings"
                    >
                      {{ postingsRunning ? '생성 중…' : '다시 생성' }}
                    </button>
                  </div>
                </template>
              </div>
            </template>
          </template>

          <!-- 폴백 경로: 설명 → HTML 단발(기존 동작 유지) -->
          <template v-else>
            <div v-if="diagramHtml === null" class="grid gap-2">
              <div>
                <button
                  type="button"
                  class="rounded-lg bg-ink-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
                  :disabled="diagramRunning"
                  @click="generateDiagram"
                >
                  {{ diagramRunning ? '구성도 생성 중…' : '구성도 생성' }}
                </button>
              </div>
              <p v-if="diagramRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                ⏳ 생성 중입니다 — "다음"으로 넘어가 나머지를 작성하시면, 완료 시 이 단계와 요약에 반영됩니다.
              </p>
              <p v-else-if="diagramFailed" class="text-xs font-semibold text-red-600">
                생성에 실패했습니다. 잠시 후 다시 시도해 주세요.
              </p>
            </div>

            <template v-else>
              <DiagramViewer :html="diagramHtml" />
              <div class="flex flex-wrap items-center gap-4">
                <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                  <input v-model="includeDiagram" type="checkbox" :disabled="aiArtifactsStale">
                  이 구성도를 의뢰에 첨부
                </label>
                <button
                  type="button"
                  class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                  :disabled="diagramRunning"
                  @click="generateDiagram"
                >
                  {{ diagramRunning ? '생성 중…' : '다시 생성' }}
                </button>
              </div>
            </template>
          </template>
        </div>

        <!-- STEP: 예산·일정·마감 -->
        <div v-else-if="currentStep === 'schedule'" class="grid gap-5">
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

        <!-- STEP: 방식·지정 전문가·요약 -->
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
              <template v-if="form.categories.length > 0">
                {{ form.categories.map((c) => MARKET_CATEGORY_LABELS[c]).join('/') }} ·
              </template>
              {{ form.cadTools.length > 0 ? form.cadTools.map((c) => MARKET_TOOL_LABELS[c]).join('/') : '툴 무관' }} ·
              {{ MARKET_BUDGET_RANGE_LABELS[form.budgetRange] }} ·
              마감 {{ form.deadlineMode === 'date' ? form.deadlineDate : `${form.deadlineMode}일 뒤` }} ·
              {{ form.ndaRequired ? 'NDA 보호' : 'NDA 없음' }} ·
              첨부 {{ attachments.length }}개<template v-if="aiArtifactsStale"> · AI 결과 오래됨(미포함)</template><template v-else-if="diagramHtml !== null && includeDiagram"> · AI 구성도 포함</template><template v-else-if="diagramRunning || specRunning"> · 구성도 생성 중(완료 전 제출 시 미포함)</template><template v-if="!aiArtifactsStale && specJson !== null && includeSpec"> · AI 구성 명세 포함</template><template v-if="!aiArtifactsStale && rocMd !== null && includeSpec && includeRoc"> · AI 지시서 포함</template><template v-if="!aiArtifactsStale && postingCards !== null && includeSpec && includePostings"> · 분야 카드 {{ postingCards.length }}개</template>
            </p>
          </div>
        </div>

        <p v-if="submitError !== ''" class="mt-4 text-xs font-semibold text-red-600">{{ submitError }}</p>
        <div class="mt-6 flex items-center justify-between border-t border-line pt-5">
          <button
            v-if="stepIndex > 0"
            type="button"
            class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
            @click="stepIndex -= 1"
          >
            이전
          </button>
          <span v-else />
          <button
            v-if="!isLastStep"
            type="button"
            class="rounded-lg bg-ink-900 px-5 py-2 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
            :disabled="!stepValid"
            @click="stepIndex += 1"
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
