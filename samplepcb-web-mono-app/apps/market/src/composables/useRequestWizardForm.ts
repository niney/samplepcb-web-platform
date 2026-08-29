import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  DEV_REVIEW_QUESTIONS,
  DEV_REVIEW_QUESTION_MAP,
  MARKET_ACTIVE_SERVICE_AREAS,
  MarketActiveServiceArea,
} from '@sp/api-contract';
import type {
  DevReviewAnswerType,
  DevReviewQuestionCodeType,
  MarketActiveServiceAreaType,
  MarketBudgetRangeType,
  MarketProjectDeadlineType,
  MarketProjectMethodType,
} from '@sp/api-contract';
import { useDevReviewStatus } from '../api/useAi';

// 의뢰 위저드 3스텝 폼 상태(docs/AI_DEV_REVIEW.md §5.1) — 설명·자료 → 질문 9문항 → 검토·등록.
// 질문 스텝은 검토서 생성이 활성(관리자 토글)이고 AI 사전 검토에 동의했을 때만 존재한다
// (둘 중 하나라도 빠지면 [describe, review] 2스텝, 검토 스텝은 조건 폼만 노출).
// 이 컴포저블은 폼 값·스텝 정의·네비게이션·폼 자체 유효성만 소유한다 — 검토서 잡
// 오케스트레이션과 신선도 판정은 useDevReviewJob 이 담당한다.
// 의뢰 유형(requestType)은 사라졌다: 서버가 분야 개수로 파생한다(§4).

export type StepKey = 'describe' | 'questions' | 'review';

// 문항 하나의 입력 상태 — 미응답은 choices 가 빈 배열이고 등록 payload 에서 빠진다.
export interface QuestionState {
  choices: string[];
  note: string;
}

export interface RequestForm {
  serviceAreas: MarketActiveServiceAreaType[];
  title: string;
  description: string;
  // AI 사전 검토 동의(기본 true) — 해제 시 질문 스텝이 빠지고 검토서 없이 등록된다.
  aiConsent: boolean;
  ndaRequired: boolean;
  budgetRange: MarketBudgetRangeType;
  deadlineMode: '3' | '7' | '14' | 'date';
  deadlineDate: string;
  method: MarketProjectMethodType;
  targetExpertId: number | null;
}

export function useRequestWizardForm() {
  const route = useRoute();

  // ?cat= 분야 프리셋(활성 3종만 — 그 외는 circuit), ?expert= 지정견적 프리셋.
  const presetServiceArea = ((): MarketActiveServiceAreaType => {
    const area = MarketActiveServiceArea.safeParse(route.query.cat);
    return area.success ? area.data : 'circuit';
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
    budgetRange: 'undecided',
    deadlineMode: '7',
    deadlineDate: '',
    method: presetExpertId !== null ? 'targeted' : 'open',
    targetExpertId: presetExpertId,
  });
  const attachments = ref<File[]>([]);

  // 9문항 입력 상태 — 코드가 계약에 고정이라 키를 하나씩 적는다(사전에 문항이 늘면
  // 여기서 컴파일 에러가 나는 것이 의도다. Object.fromEntries 는 키 타입을 잃는다).
  const questionState = reactive<Record<DevReviewQuestionCodeType, QuestionState>>({
    stage: { choices: [], note: '' },
    deliverables: { choices: [], note: '' },
    quantity: { choices: [], note: '' },
    power: { choices: [], note: '' },
    connectivity: { choices: [], note: '' },
    external: { choices: [], note: '' },
    constraints: { choices: [], note: '' },
    certification: { choices: [], note: '' },
    timeline: { choices: [], note: '' },
  });

  function toggleChoice(code: DevReviewQuestionCodeType, choice: string): void {
    const state = questionState[code];
    const multi = DEV_REVIEW_QUESTION_MAP[code].multi;
    if (!multi) {
      state.choices = state.choices[0] === choice ? [] : [choice];
      return;
    }
    const i = state.choices.indexOf(choice);
    if (i >= 0) state.choices.splice(i, 1);
    else state.choices.push(choice);
  }

  // 메모 필수(noteRequiredFor 선택지를 고른 문항) 미충족 목록 — 등록 전 게이트.
  const noteMissingCodes = computed<DevReviewQuestionCodeType[]>(() =>
    DEV_REVIEW_QUESTIONS.flatMap((q) => {
      const state = questionState[q.code];
      if (state.choices.length === 0) return [];
      const required = q.noteRequiredFor?.some((c) => state.choices.includes(c)) ?? false;
      return required && state.note.trim() === '' ? [q.code] : [];
    }),
  );

  // 등록·검토서 실행에 실을 답변 — 응답한 문항만(§5.1 "미응답 문항은 보내지 않는다").
  function buildAnswers(): DevReviewAnswerType[] {
    return DEV_REVIEW_QUESTIONS.flatMap((q) => {
      const state = questionState[q.code];
      if (state.choices.length === 0) return [];
      const note = state.note.trim();
      return [{ code: q.code, choices: [...state.choices], ...(note !== '' ? { note } : {}) }];
    });
  }

  // 검토서 생성 활성 여부(관리자 토글은 드물어 오래 캐시).
  const devReviewStatus = useDevReviewStatus();
  const devReviewEnabled = computed(() => devReviewStatus.data.value?.data.enabled ?? false);
  const questionsStepShown = computed(() => devReviewEnabled.value && fields.aiConsent);

  const steps = computed<{ key: StepKey; label: string }[]>(() => [
    { key: 'describe', label: '설명·자료' },
    ...(questionsStepShown.value ? [{ key: 'questions' as const, label: '질문' }] : []),
    { key: 'review', label: '검토·등록' },
  ]);

  const stepIndex = ref(0);
  const currentStep = computed<StepKey>(() => steps.value[stepIndex.value]?.key ?? 'describe');
  const isLastStep = computed(() => stepIndex.value === steps.value.length - 1);

  // 동의 해제로 질문 스텝이 사라져 인덱스가 배열을 벗어나면 마지막 스텝으로 보정.
  watch(steps, (list) => {
    if (stepIndex.value > list.length - 1) stepIndex.value = Math.max(0, list.length - 1);
  });

  function next(): void {
    if (stepIndex.value < steps.value.length - 1) stepIndex.value += 1;
  }
  function prev(): void {
    if (stepIndex.value > 0) stepIndex.value -= 1;
  }
  function goToStep(key: StepKey): void {
    const i = steps.value.findIndex((s) => s.key === key);
    if (i >= 0) stepIndex.value = i;
  }

  function toggleServiceArea(code: MarketActiveServiceAreaType): void {
    const i = fields.serviceAreas.indexOf(code);
    if (i >= 0) fields.serviceAreas.splice(i, 1);
    else fields.serviceAreas.push(code);
  }

  function pickAttachments(e: Event): void {
    const input = e.target as HTMLInputElement;
    attachments.value = input.files !== null ? Array.from(input.files) : [];
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
    // 전 문항 선택 사항 — 다만 '있음(메모 필수)' 선택지는 메모가 있어야 서버가 받는다.
    if (key === 'questions') return noteMissingCodes.value.length === 0;
    const deadlineOk = fields.deadlineMode !== 'date' || fields.deadlineDate >= todayKst;
    const methodOk = fields.method === 'open' || fields.targetExpertId !== null;
    return deadlineOk && methodOk && noteMissingCodes.value.length === 0;
  });

  return {
    fields,
    attachments,
    presetExpertId,
    activeServiceAreas: MARKET_ACTIVE_SERVICE_AREAS,
    questionState,
    toggleChoice,
    noteMissingCodes,
    buildAnswers,
    devReviewEnabled,
    questionsStepShown,
    steps,
    stepIndex,
    currentStep,
    isLastStep,
    next,
    prev,
    goToStep,
    toggleServiceArea,
    pickAttachments,
    todayKst,
    projectDeadline,
    stepValid,
  };
}

export type RequestWizardForm = ReturnType<typeof useRequestWizardForm>;
