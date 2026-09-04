import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  MARKET_AREAS,
  MARKET_AREA_CODES,
  MARKET_COMMON_CONDITIONS,
  MARKET_COMMON_QUESTIONS,
  MARKET_TOOLS_VERSION,
  isMarketAreaCode,
  marketArea,
  marketAttachmentField,
  marketQuestionsFor,
  marketRequiredMissing,
  sortMarketAreas,
} from '@sp/api-contract';
import type {
  MarketAnswerType,
  MarketAreaDef,
  MarketBudgetRangeType,
  MarketProjectDeadlineType,
  MarketProjectMethodType,
  MarketQuestionDef,
  MarketToolsType,
} from '@sp/api-contract';
import { useDevReviewStatus } from '../api/useAi';

// 의뢰 위저드 3스텝 폼 상태(docs/AI_DEV_REVIEW.md §13.4) —
//   ① 의뢰 내용(분야·제목·설명·참고 자료·AI 동의)
//   ② 몇 가지만 더(프로젝트 공통 조건 6 [예산·완료 시점·목표 단계·견적 방식·인도 범위·NDA] + 공통 질문 3
//      + 선택 분야마다 [맞춤 질문 · 희망 툴 · 추가자료 슬롯])
//   ③ 검토·등록(AI 사전 검토서 미리보기 + 견적 마감).
// 의뢰자는 비전문가일 수 있다는 전제라 물어보는 것을 최소화했다: 공통 조건만 필수(모르면 "협의" 탈출구),
// 질문은 전부 선택 사항이고 "잘 모르겠어요"·"전문가 추천" 탈출구가 있으며, 툴은 "전문가 추천"(빈 선택)이
// 기본이다. 분야·질문·툴·슬롯의 정본은 레지스트리(MARKET_AREAS)라 이 파일에 분야 코드를 문자열로 박지 않는다.
// 이 컴포저블은 폼 값·스텝 정의·네비게이션·폼 자체 유효성만 소유한다 — 검토서 잡
// 오케스트레이션과 신선도 판정은 useDevReviewJob 이 담당한다.

export type StepKey = 'describe' | 'details' | 'review';

// 문항 하나의 입력 상태 — 미응답은 choices 가 빈 배열이고 등록 payload 에서 빠진다.
export interface QuestionState {
  choices: string[];
  note: string;
}

export interface RequestForm {
  serviceAreas: string[];
  title: string;
  description: string;
  // AI 사전 검토 동의(기본 true) — 해제 시 검토서 없이 등록되고 정밀 구성도도 만들지 않는다.
  aiConsent: boolean;
  ndaRequired: boolean;
  budgetRange: MarketBudgetRangeType | null; // null = 아직 안 골랐다(2스텝 필수)
  deadlineMode: '3' | '7' | '14' | 'date';
  deadlineDate: string;
  method: MarketProjectMethodType;
  targetExpertId: number | null;
}

export const slotKey = (area: string, slot: string): string => `${area}:${slot}`;

export function useRequestWizardForm() {
  const route = useRoute();

  // ?cat= 분야 프리셋(레지스트리 코드만 — 그 외는 첫 분야), ?expert= 지정견적 프리셋.
  const presetServiceArea = ((): string => {
    const cat = typeof route.query.cat === 'string' ? route.query.cat : '';
    return isMarketAreaCode(cat) ? cat : (MARKET_AREA_CODES[0] ?? 'circuit');
  })();
  const presetExpertId = ((): number | null => {
    const n = Number(route.query.expert);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();

  const fields = reactive<RequestForm>({
    serviceAreas: [presetServiceArea],
    title: '',
    description: '',
    aiConsent: true,
    ndaRequired: true,
    budgetRange: null,
    deadlineMode: '7',
    deadlineDate: '',
    method: presetExpertId !== null ? 'targeted' : 'open',
    targetExpertId: presetExpertId,
  });
  // 참고 자료(일반 첨부, 1단계) + 분야별 추가자료(2단계, 키 = "area:slot").
  const attachments = ref<File[]>([]);
  const slotFiles = reactive<Record<string, File[]>>({});

  // 질문 상태 — 코드로 lazy 생성(레지스트리에 문항이 늘어도 여기는 안 바뀐다).
  const questionState = reactive<Record<string, QuestionState>>({});
  function stateOf(code: string): QuestionState {
    const s = questionState[code];
    if (s !== undefined) return s;
    const created: QuestionState = { choices: [], note: '' };
    questionState[code] = created;
    return created;
  }
  function toggleChoice(question: MarketQuestionDef, choice: string): void {
    const state = stateOf(question.code);
    if (!question.multi) {
      state.choices = state.choices[0] === choice ? [] : [choice];
      return;
    }
    const i = state.choices.indexOf(choice);
    if (i >= 0) state.choices.splice(i, 1);
    else state.choices.push(choice);
  }

  // 희망 툴 — 분야별 코드 배열. 키가 없거나 빈 배열 = 전문가 추천(기본).
  const tools = reactive<Record<string, string[]>>({});
  function toggleTool(area: string, code: string): void {
    const list = tools[area] ?? (tools[area] = []);
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
    else list.push(code);
  }
  function clearTools(area: string): void {
    tools[area] = [];
  }
  const isRecommended = (area: string): boolean => (tools[area]?.length ?? 0) === 0;

  // 선택 분야(레지스트리 순서)·분야 정의·물을 질문(공통 → 분야).
  const selectedAreas = computed(() => sortMarketAreas(fields.serviceAreas));
  const areaDefs = computed<MarketAreaDef[]>(() =>
    selectedAreas.value.map((c) => marketArea(c)).filter((d): d is MarketAreaDef => d !== undefined),
  );
  const activeQuestions = computed<MarketQuestionDef[]>(() => marketQuestionsFor(fields.serviceAreas));
  const conditionQuestions = MARKET_COMMON_CONDITIONS;
  const commonQuestions = MARKET_COMMON_QUESTIONS;
  // 풀 개발이면 분야당 앞 2개만 묻는다(레지스트리 상한) — 카드는 이 목록으로 그린다.
  const areaQuestionsOf = (area: string): MarketQuestionDef[] =>
    activeQuestions.value.filter((q) => q.code.startsWith(`${area}.`));

  // 메모 필수(noteRequiredFor 선택지를 고른 문항) 미충족 목록 — 등록 전 게이트.
  const noteMissingCodes = computed<string[]>(() =>
    activeQuestions.value.flatMap((q) => {
      const state = questionState[q.code];
      if (state === undefined || state.choices.length === 0) return [];
      const required = q.noteRequiredFor?.some((c) => state.choices.includes(c)) ?? false;
      return required && state.note.trim() === '' ? [q.code] : [];
    }),
  );

  // 필수 문항(공통 조건) 미응답 — 등록 라우트(ANSWERS_REQUIRED)와 같은 함수.
  const requiredMissingCodes = computed<string[]>(() => marketRequiredMissing(buildAnswers(), fields.serviceAreas));
  // 2스텝 "프로젝트 공통 조건" 진행(n/6): 답변형 조건 3 + 예산 + 견적 방식(지정이면 전문가까지) + NDA(체크박스라 항상 답).
  const methodOk = computed(() => fields.method === 'open' || fields.targetExpertId !== null);
  const conditionProgress = computed(() => ({
    done: conditionQuestions.length - requiredMissingCodes.value.length + (fields.budgetRange === null ? 0 : 1) + (methodOk.value ? 1 : 0) + 1,
    total: conditionQuestions.length + 3,
  }));

  // 등록·검토서 실행에 실을 답변 — 응답한 문항만, 선택 분야 밖 문항은 버린다.
  function buildAnswers(): MarketAnswerType[] {
    return activeQuestions.value.flatMap((q) => {
      const state = questionState[q.code];
      if (state === undefined || state.choices.length === 0) return [];
      const note = state.note.trim();
      return [{ code: q.code, choices: [...state.choices], ...(note !== '' ? { note } : {}) }];
    });
  }
  function buildTools(): MarketToolsType {
    const byArea: Record<string, string[]> = {};
    for (const area of selectedAreas.value) {
      const codes = tools[area] ?? [];
      if (codes.length > 0) byArea[area] = [...codes];
    }
    return { version: MARKET_TOOLS_VERSION, byArea };
  }
  // 첨부 전체(일반 + 슬롯) — 검토서 실행·등록 multipart 가 같은 순서로 붙인다.
  function appendAttachments(fd: FormData): void {
    for (const f of attachments.value) fd.append('attachment', f);
    for (const area of selectedAreas.value) {
      const def = marketArea(area);
      for (const slot of def?.attachmentSlots ?? []) {
        for (const f of slotFiles[slotKey(area, slot.code)] ?? []) fd.append(marketAttachmentField(area, slot.code), f);
      }
    }
  }
  // 선택 분야의 슬롯 첨부만(분야를 해제하면 그 슬롯 파일은 보내지 않는다).
  const activeSlotFiles = computed<{ field: string; file: File }[]>(() =>
    selectedAreas.value.flatMap((area) =>
      (marketArea(area)?.attachmentSlots ?? []).flatMap((slot) =>
        (slotFiles[slotKey(area, slot.code)] ?? []).map((file) => ({ field: marketAttachmentField(area, slot.code), file })),
      ),
    ),
  );
  const totalAttachmentCount = computed(() => attachments.value.length + activeSlotFiles.value.length);

  // 검토서 생성 활성 여부(관리자 토글은 드물어 오래 캐시).
  const devReviewStatus = useDevReviewStatus();
  const devReviewEnabled = computed(() => devReviewStatus.data.value?.data.enabled ?? false);

  const steps: readonly { key: StepKey; label: string }[] = [
    { key: 'describe', label: '의뢰 내용' },
    { key: 'details', label: '몇 가지만 더' },
    { key: 'review', label: '검토·등록' },
  ];

  const stepIndex = ref(0);
  const currentStep = computed<StepKey>(() => steps[stepIndex.value]?.key ?? 'describe');
  const isLastStep = computed(() => stepIndex.value === steps.length - 1);

  function next(): void {
    if (stepIndex.value < steps.length - 1) stepIndex.value += 1;
  }
  function prev(): void {
    if (stepIndex.value > 0) stepIndex.value -= 1;
  }
  function goToStep(key: StepKey): void {
    const i = steps.findIndex((s) => s.key === key);
    if (i >= 0) stepIndex.value = i;
  }

  function toggleServiceArea(code: string): void {
    const i = fields.serviceAreas.indexOf(code);
    if (i >= 0) fields.serviceAreas.splice(i, 1);
    else fields.serviceAreas.push(code);
  }
  // "잘 모르겠어요 — 전부 맡길게요": 분야를 모르는 의뢰자는 전 분야(풀 개발)로 등록한다.
  const allServiceAreasSelected = computed(
    () => MARKET_AREA_CODES.every((a) => fields.serviceAreas.includes(a)),
  );
  function selectAllServiceAreas(): void {
    fields.serviceAreas = [...MARKET_AREA_CODES];
  }

  function pickAttachments(e: Event): void {
    const input = e.target as HTMLInputElement;
    attachments.value = input.files !== null ? Array.from(input.files) : [];
  }
  function pickSlotFiles(area: string, slot: string, e: Event): void {
    const input = e.target as HTMLInputElement;
    slotFiles[slotKey(area, slot)] = input.files !== null ? Array.from(input.files) : [];
  }

  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  function projectDeadline(): MarketProjectDeadlineType {
    return fields.deadlineMode === 'date'
      ? { date: fields.deadlineDate }
      : { days: Number(fields.deadlineMode) as 3 | 7 | 14 };
  }

  // 스텝별 폼 자체 유효성 — 검토서 생성 대기처럼 잡 상태와 얽힌 조건은 셸에서 결합한다.
  const stepValid = computed<boolean>(() => {
    const key = currentStep.value;
    if (key === 'describe') {
      return (
        fields.serviceAreas.length > 0 &&
        fields.title.trim().length >= 2 &&
        fields.description.trim().length >= 10
      );
    }
    const detailsOk =
      noteMissingCodes.value.length === 0 &&
      requiredMissingCodes.value.length === 0 &&
      fields.budgetRange !== null &&
      methodOk.value;
    if (key === 'details') return detailsOk;
    const deadlineOk = fields.deadlineMode !== 'date' || fields.deadlineDate >= todayKst;
    return deadlineOk && detailsOk;
  });

  return {
    fields,
    attachments,
    slotFiles,
    activeSlotFiles,
    totalAttachmentCount,
    presetExpertId,
    areas: MARKET_AREAS,
    selectedAreas,
    areaDefs,
    conditionQuestions,
    commonQuestions,
    areaQuestionsOf,
    activeQuestions,
    requiredMissingCodes,
    conditionProgress,
    questionState,
    stateOf,
    toggleChoice,
    noteMissingCodes,
    buildAnswers,
    tools,
    toggleTool,
    clearTools,
    isRecommended,
    buildTools,
    appendAttachments,
    devReviewEnabled,
    steps,
    stepIndex,
    currentStep,
    isLastStep,
    next,
    prev,
    goToStep,
    toggleServiceArea,
    allServiceAreasSelected,
    selectAllServiceAreas,
    pickAttachments,
    pickSlotFiles,
    todayKst,
    projectDeadline,
    stepValid,
  };
}

export type RequestWizardForm = ReturnType<typeof useRequestWizardForm>;
