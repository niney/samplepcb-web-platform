import { computed, reactive, ref, watch } from 'vue';
import {
  AiQuestionPreanalysisResult,
  DiagramSpec,
  MARKET_SERVICE_AREA_LABELS,
  MarketPostingCards,
  selectAiInterviewQuestions,
} from '@sp/api-contract';
import type {
  AiInterviewAnswerType,
  AiInterviewQuestion,
  AiRocRunBodyType,
  AiStructurizeRunBodyType,
  DiagramSpecType,
  MarketPostingCardsType,
} from '@sp/api-contract';
import { renderDiagramSpecHtml } from '@sp/utils';
import {
  useAiJob,
  useAiUsecaseStatus,
  useRunPostings,
  useRunQuestionPreanalysis,
  useRunRoc,
  useRunStructurize,
  useRunStructurizeWithAttachments,
} from '../api/useAi';
import type { RequestWizardForm } from './useRequestWizardForm';

// 의뢰 마법사 v2 AI 오케스트레이션 — 선분석(질문 축소·"이해한 내용") → 인터뷰 답변 →
// 구성 명세(structurize) → 결정적 구성도 → 선택 문서(ROC·분야 카드). 모든 산출물은 선택.
//
// 신선도 서명은 둘로 나눈다:
//  · aiSpecSignature  — 명세·구성도의 원천(요청유형·분야·제목·설명·답변·질문·첨부).
//  · aiDocSignature   — 위 + 예산·마감·방식(ROC·분야 카드는 이 값을 원천으로 받는다).
// 검토 스텝에서 예산·마감·방식을 명세 옆에서 입력하므로, 이들을 바꿔도 명세·구성도는
// 신선하게 유지하고 ROC·분야 카드만 오래된 것으로 표시·제출 제외한다.

const QUESTION_BATCH_SIZE = 5;

interface AiPayloadParts {
  diagramHtml?: string;
  diagramSpec?: string;
  interviewAnswers?: AiInterviewAnswerType[];
  aiQuestionCodes?: string[];
  shareInterviewAnswers?: true;
  rocMd?: string;
  postings?: MarketPostingCardsType;
  aiJobIds?: { structurize?: string; roc?: string; postings?: string };
}

const attachmentMeta = (files: readonly File[]) =>
  files.map((f) => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified }));

export function useRequestWizardAi(form: RequestWizardForm) {
  const { fields, attachments, interviewStepShown, projectDeadline } = form;

  // AI 콘텐츠 노출 = 인터뷰 스텝 노출 조건과 동일(structurize 활성 && 동의).
  const aiActive = interviewStepShown;

  // 선택 문서(ROC·분야 카드)는 AI 활성 위에서 각각 관리자 토글로 다시 게이트한다.
  const rocStatus = useAiUsecaseStatus('market.request-roc');
  const postingsStatus = useAiUsecaseStatus('market.request-postings');
  const rocEnabled = computed(
    () => aiActive.value && (rocStatus.data.value?.data.enabled ?? false),
  );
  const postingsEnabled = computed(
    () => aiActive.value && (postingsStatus.data.value?.data.enabled ?? false),
  );

  // ── 인터뷰 답변 상태 ────────────────────────────────────────────────────────
  const interviewValues = reactive<Record<string, string | string[]>>({});
  const gapInputs = reactive<Record<string, string>>({}); // 명세 questions_missing 보강 입력
  const extraAnswers = ref<string[]>([]);
  const shareInterviewAnswersAgreed = ref(false);

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

  // 첨부가 있으면 "보유 자료"(COMMON-06)는 자료로 확인된 것으로 보고 최초 후보에서 제외.
  const formKnownQuestionCodes = computed<string[]>(() =>
    attachments.value.length > 0 ? ['COMMON-06'] : [],
  );
  const questionCandidates = computed<AiInterviewQuestion[]>(() =>
    selectAiInterviewQuestions({
      requestType: fields.requestType,
      serviceAreas: fields.serviceAreas,
      knownQuestionCodes: formKnownQuestionCodes.value,
    }),
  );

  // ── 선분석(설명·첨부에서 이미 답이 확인된 질문 제외 + "이해한 내용") ─────────
  const runQuestionPreanalysis = useRunQuestionPreanalysis();
  const questionPreanalysisJobId = ref<string | null>(null);
  const questionPreanalysisJob = useAiJob(questionPreanalysisJobId);
  const questionPreanalysisResult = computed(() => {
    const raw =
      questionPreanalysisJob.data.value?.data.status === 'done'
        ? questionPreanalysisJob.data.value.data.json
        : null;
    if (raw === null) return null;
    try {
      return AiQuestionPreanalysisResult.parse(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  });
  // "제가 이해한 내용" 카드(v2 optional) — 구형 응답·캐시 잡이면 null(카드 생략).
  const understood = computed(() => questionPreanalysisResult.value?.understood ?? null);
  const preanalysisFindings = computed(() => questionPreanalysisResult.value?.findings ?? []);
  const preanalysisKnownQuestionCodes = computed(
    () => questionPreanalysisResult.value?.knownQuestionCodes ?? [],
  );

  const selectedQuestions = computed<AiInterviewQuestion[]>(() =>
    selectAiInterviewQuestions({
      requestType: fields.requestType,
      serviceAreas: fields.serviceAreas,
      knownQuestionCodes: [...formKnownQuestionCodes.value, ...preanalysisKnownQuestionCodes.value],
    }),
  );
  const visibleQuestions = computed<AiInterviewQuestion[]>(() =>
    selectedQuestions.value.filter((q) => !questionHidden(q)),
  );

  const questionPreanalysisRunning = computed(
    () =>
      runQuestionPreanalysis.isPending.value ||
      (questionPreanalysisJobId.value !== null &&
        !questionPreanalysisJob.isError.value &&
        (questionPreanalysisJob.data.value?.data.status ?? 'running') === 'running'),
  );
  const questionPreanalysisFailed = computed(
    () =>
      runQuestionPreanalysis.isError.value ||
      questionPreanalysisJob.isError.value ||
      questionPreanalysisJob.data.value?.data.status === 'error' ||
      (questionPreanalysisJob.data.value?.data.status === 'done' &&
        questionPreanalysisResult.value === null),
  );
  const questionPreanalysisDone = computed(
    () =>
      questionPreanalysisJob.data.value?.data.status === 'done' &&
      questionPreanalysisResult.value !== null,
  );

  const questionPreanalysisSourceSignature = computed(() =>
    JSON.stringify({
      requestType: fields.requestType,
      serviceAreas: fields.serviceAreas,
      title: fields.title.trim(),
      description: fields.description.trim(),
      candidateQuestionCodes: questionCandidates.value.map((q) => q.code),
      attachments: attachmentMeta(attachments.value),
    }),
  );

  function preanalyzeQuestions(): void {
    if (questionPreanalysisRunning.value || questionCandidates.value.length === 0) return;
    const sourceAtStart = questionPreanalysisSourceSignature.value;
    questionPreanalysisJobId.value = null;
    runQuestionPreanalysis.reset();
    runQuestionPreanalysis.mutate(
      {
        body: {
          title: fields.title.trim(),
          requestType: fields.requestType,
          serviceAreas: fields.serviceAreas,
          categories: [],
          cadTools: [],
          description: fields.description.trim(),
          candidateQuestionCodes: questionCandidates.value.map((q) => q.code),
        },
        files: attachments.value,
      },
      {
        onSuccess: (res) => {
          // 응답이 늦게 도착하는 사이 입력이 바뀌었으면 이 잡은 폐기.
          if (questionPreanalysisSourceSignature.value === sourceAtStart) {
            questionPreanalysisJobId.value = res.data.jobId;
          }
        },
      },
    );
  }
  // 인터뷰 스텝 진입 시 자동 선분석 — 이미 시작/완료됐거나 실행 중이면 재호출하지 않는다
  // (입력 변경 시 아래 watch 가 jobId 를 비우므로 그때 다시 자동 실행된다).
  function ensurePreanalysis(): void {
    if (questionPreanalysisJobId.value === null && !questionPreanalysisRunning.value) {
      preanalyzeQuestions();
    }
  }

  // ── 질문 배치(한 번에 5개, 전체 ≤15) ────────────────────────────────────────
  const questionRound = ref(0);
  const questionRoundCount = computed(() =>
    Math.max(1, Math.ceil(visibleQuestions.value.length / QUESTION_BATCH_SIZE)),
  );
  const currentQuestions = computed(() => {
    const safeRound = Math.min(questionRound.value, questionRoundCount.value - 1);
    const start = safeRound * QUESTION_BATCH_SIZE;
    return visibleQuestions.value.slice(start, start + QUESTION_BATCH_SIZE);
  });
  function nextRound(): void {
    if (questionRound.value < questionRoundCount.value - 1) questionRound.value += 1;
  }
  function prevRound(): void {
    if (questionRound.value > 0) questionRound.value -= 1;
  }

  const questionContextLabel = (q: AiInterviewQuestion): string => {
    if (q.group === 'common') return '공통';
    if (q.group === 'integration') return '시스템 통합';
    if (q.areas === undefined) return '공통';
    const applicable = q.areas.filter((area) => fields.serviceAreas.includes(area));
    return applicable.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join('·');
  };

  function setSingle(code: string, option: string): void {
    interviewValues[code] = interviewValues[code] === option ? '' : option;
  }
  function toggleMulti(code: string, option: string): void {
    const unknownOptions = new Set(['잘 모르겠습니다', '전문가 추천']);
    const cur = interviewValues[code];
    const arr = Array.isArray(cur) ? [...cur] : [];
    if (unknownOptions.has(option)) {
      interviewValues[code] = arr.includes(option) ? [] : [option];
      return;
    }
    for (const unknown of unknownOptions) {
      const unknownIndex = arr.indexOf(unknown);
      if (unknownIndex >= 0) arr.splice(unknownIndex, 1);
    }
    const i = arr.indexOf(option);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(option);
    interviewValues[code] = arr;
  }

  function interviewAnswers(): AiInterviewAnswerType[] {
    const answers: AiInterviewAnswerType[] = [];
    // 선분석으로 질문이 숨겨져도 사용자가 직접 적은 답은 구조화 입력에 보존한다.
    for (const q of questionCandidates.value) {
      const a = interviewAnswerStr(q.code).trim();
      if (a !== '') answers.push({ code: q.code, answer: a });
    }
    for (const extra of extraAnswers.value) answers.push({ code: 'extra', answer: extra });
    return answers;
  }
  const hasInterviewAnswers = computed(() => interviewAnswers().length > 0);

  // ── 구성 명세(structurize) ──────────────────────────────────────────────────
  const runStructurize = useRunStructurize();
  const runStructurizeWithAttachments = useRunStructurizeWithAttachments();
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
      runStructurizeWithAttachments.isPending.value ||
      (specJobId.value !== null &&
        !specJob.isError.value &&
        (specJob.data.value?.data.status ?? 'running') === 'running'),
  );
  const specFailed = computed(
    () =>
      runStructurize.isError.value ||
      runStructurizeWithAttachments.isError.value ||
      specJob.isError.value ||
      specJob.data.value?.data.status === 'error',
  );
  const specTbdBlocks = computed(() =>
    (spec.value?.blocks ?? []).filter((b) => b.status === 'tbd').map((b) => b.label),
  );

  // ── 결정적 구성도(외부 재호출 없이 명세에서 즉시 렌더) ───────────────────────
  const diagramHtml = ref<string | null>(null);

  // ── 작업검토지시서(ROC) ─────────────────────────────────────────────────────
  const runRoc = useRunRoc();
  const rocJobId = ref<string | null>(null);
  const rocJob = useAiJob(rocJobId);
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
    () => runRoc.isError.value || rocJob.isError.value || rocJob.data.value?.data.status === 'error',
  );

  // ── 분야별 포스팅 카드 ──────────────────────────────────────────────────────
  const runPostings = useRunPostings();
  const postingsJobId = ref<string | null>(null);
  const postingsJob = useAiJob(postingsJobId);
  const postingCards = computed<MarketPostingCardsType | null>(() => {
    const raw =
      postingsJob.data.value?.data.status === 'done' ? postingsJob.data.value.data.json : null;
    if (raw === null) return null;
    try {
      const parsed = MarketPostingCards.safeParse(
        (JSON.parse(raw) as { postings?: unknown }).postings,
      );
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

  // 검토 진입 후 선분석 완료를 기다리는 자동 구조화 대기 플래그.
  const specArmed = ref(false);

  // ── 포함 토글 ───────────────────────────────────────────────────────────────
  const includeSpec = ref(true);
  const includeDiagram = ref(true);
  const includeRoc = ref(true);
  const includePostings = ref(true);

  // ── 신선도 서명(명세용·문서용 분리) ────────────────────────────────────────
  const aiSpecSignature = computed(() =>
    JSON.stringify({
      requestType: fields.requestType,
      serviceAreas: fields.serviceAreas,
      title: fields.title.trim(),
      description: fields.description.trim(),
      answers: interviewAnswers(),
      questionCodes: visibleQuestions.value.map((q) => q.code),
      attachments: attachmentMeta(attachments.value),
    }),
  );
  const aiDocSignature = computed(() =>
    JSON.stringify({
      spec: aiSpecSignature.value,
      budgetRange: fields.budgetRange,
      deadlineMode: fields.deadlineMode,
      deadlineDate: fields.deadlineDate,
      method: fields.method,
    }),
  );
  // 생성 시점 서명(각 산출물이 만들어질 때 고정) — 현재 서명과 다르면 오래된 것.
  const specGenSig = ref<string | null>(null);
  const rocGenSig = ref<string | null>(null);
  const postingsGenSig = ref<string | null>(null);

  const specStale = computed(
    () =>
      specJobId.value !== null && specGenSig.value !== null && specGenSig.value !== aiSpecSignature.value,
  );
  const rocStale = computed(
    () =>
      rocJobId.value !== null && rocGenSig.value !== null && rocGenSig.value !== aiDocSignature.value,
  );
  const postingsStale = computed(
    () =>
      postingsJobId.value !== null &&
      postingsGenSig.value !== null &&
      postingsGenSig.value !== aiDocSignature.value,
  );

  // 제출 포함 가능 여부 — 존재 && 포함 체크 && 신선(+ 파생물은 명세 포함이 전제).
  const specIncludable = computed(
    () => specJson.value !== null && includeSpec.value && !specStale.value,
  );
  const diagramIncludable = computed(
    () => diagramHtml.value !== null && includeDiagram.value && specIncludable.value,
  );
  const rocIncludable = computed(
    () => rocMd.value !== null && includeRoc.value && specIncludable.value && !rocStale.value,
  );
  const postingsIncludable = computed(
    () =>
      postingCards.value !== null && includePostings.value && specIncludable.value && !postingsStale.value,
  );

  // 답변을 제출하려면(명세와 함께) 원문 공개 동의가 필요하다(계약 refine 과 동형).
  const consentRequired = computed(() => specIncludable.value && hasInterviewAnswers.value);
  const reviewBlockedByConsent = computed(
    () => consentRequired.value && !shareInterviewAnswersAgreed.value,
  );

  const includedAiArtifactLabels = computed<string[]>(() => {
    const labels: string[] = [];
    if (specIncludable.value) labels.push('구성 명세');
    if (diagramIncludable.value) labels.push('구성도');
    if (rocIncludable.value) labels.push('작업검토지시서');
    if (postingsIncludable.value && postingCards.value !== null) {
      labels.push(`분야 카드 ${String(postingCards.value.length)}개`);
    }
    return labels;
  });

  // ── 생성 함수 ───────────────────────────────────────────────────────────────
  function generateSpec(): void {
    if (questionPreanalysisRunning.value) return;
    specArmed.value = false;
    // 보강 입력을 영속 답변으로 흡수(질문 원문 → 답 형태) 후 입력칸 비움.
    const missing = spec.value?.questions_missing ?? [];
    for (const [idx, text] of Object.entries(gapInputs)) {
      const t = text.trim();
      const q = missing[Number(idx)];
      if (t !== '' && q !== undefined) extraAnswers.value.push(`${q.question} → ${t}`);
      gapInputs[idx] = '';
    }
    specGenSig.value = aiSpecSignature.value;
    includeSpec.value = true;
    specJobId.value = null;
    diagramHtml.value = null; // 명세가 바뀌면 이전 구성도·지시서·포스팅 카드는 무효
    rocJobId.value = null;
    postingsJobId.value = null;
    rocGenSig.value = null;
    postingsGenSig.value = null;
    const body: AiStructurizeRunBodyType = {
      title: fields.title.trim(),
      requestType: fields.requestType,
      serviceAreas: fields.serviceAreas,
      categories: [],
      cadTools: [],
      description: fields.description.trim(),
      questionCodes: visibleQuestions.value.map((q) => q.code),
      answers: interviewAnswers(),
    };
    const onSuccess = (res: { data: { jobId: string } }): void => {
      specJobId.value = res.data.jobId;
    };
    if (attachments.value.length > 0) {
      runStructurizeWithAttachments.mutate({ body, files: attachments.value }, { onSuccess });
    } else {
      runStructurize.mutate(body, { onSuccess });
    }
  }
  // 검토 스텝 진입 시 자동 구조화 — 이미 생성됐거나 실행 중이면 재실행하지 않는다.
  // 선분석이 아직 진행 중이면 대기(arm)했다가 선분석이 끝나면 축소된 질문 집합으로 실행한다
  // (선분석 완료 전에 구조화하면 곧바로 질문 집합이 바뀌어 명세가 오래된 것으로 표시되는 경합 방지).
  function ensureSpec(): void {
    if (!aiActive.value) return;
    if (specJobId.value !== null || specRunning.value) return;
    if (questionPreanalysisRunning.value) {
      specArmed.value = true;
      return;
    }
    specArmed.value = false;
    generateSpec();
  }
  // 검토 진입 후 선분석 완료를 기다리는 중(전용 스피너용).
  const specAwaitingPreanalysis = computed(
    () => specArmed.value && questionPreanalysisRunning.value && specJobId.value === null,
  );
  watch(questionPreanalysisRunning, (running) => {
    if (running) return;
    if (specArmed.value && aiActive.value && specJobId.value === null && !specRunning.value) {
      specArmed.value = false;
      generateSpec();
    }
  });

  // 답변 수정 — 명세를 버리고 인터뷰 폼으로(답변 값은 보존).
  function reopenInterview(): void {
    specJobId.value = null;
    diagramHtml.value = null;
    rocJobId.value = null;
    postingsJobId.value = null;
    specGenSig.value = null;
    rocGenSig.value = null;
    postingsGenSig.value = null;
  }

  function generateDiagramFromSpec(): void {
    if (spec.value === null || specStale.value) return;
    includeDiagram.value = true;
    diagramHtml.value = renderDiagramSpecHtml(spec.value);
  }

  function generateRoc(): void {
    if (specJson.value === null || specStale.value) return;
    includeRoc.value = true;
    rocJobId.value = null;
    rocGenSig.value = aiDocSignature.value;
    const body: AiRocRunBodyType = {
      title: fields.title.trim(),
      serviceAreas: fields.serviceAreas,
      categories: [],
      cadTools: [],
      description: fields.description.trim(),
      budgetRange: fields.budgetRange,
      startHopeDate: null,
      dueHopeDate: null,
      deadline: projectDeadline(),
      method: fields.method,
      spec: specJson.value,
      answers: interviewAnswers(),
    };
    runRoc.mutate(body, {
      onSuccess: (res) => {
        rocJobId.value = res.data.jobId;
      },
    });
  }

  function generatePostings(): void {
    if (specJson.value === null || specStale.value) return;
    includePostings.value = true;
    postingsJobId.value = null;
    postingsGenSig.value = aiDocSignature.value;
    const body: AiRocRunBodyType = {
      title: fields.title.trim(),
      serviceAreas: fields.serviceAreas,
      categories: [],
      cadTools: [],
      description: fields.description.trim(),
      budgetRange: fields.budgetRange,
      startHopeDate: null,
      dueHopeDate: null,
      deadline: projectDeadline(),
      method: fields.method,
      spec: specJson.value,
      answers: interviewAnswers(),
    };
    runPostings.mutate(body, {
      onSuccess: (res) => {
        postingsJobId.value = res.data.jobId;
      },
    });
  }

  // 등록 payload 의 AI 관련 조각 — 셸의 submit 을 얇게 유지한다.
  function aiPayloadParts(): AiPayloadParts {
    const parts: AiPayloadParts = {};
    if (diagramIncludable.value && diagramHtml.value !== null) parts.diagramHtml = diagramHtml.value;
    if (specIncludable.value && specJson.value !== null) {
      const answers = interviewAnswers();
      parts.diagramSpec = specJson.value;
      // 인터뷰 답변 원본·질문 코드는 재생성·서버 해시 재검증용(응답 미노출).
      parts.interviewAnswers = answers;
      parts.aiQuestionCodes = visibleQuestions.value.map((q) => q.code);
      if (answers.length > 0 && shareInterviewAnswersAgreed.value) parts.shareInterviewAnswers = true;
    }
    if (rocIncludable.value && rocMd.value !== null) parts.rocMd = rocMd.value;
    if (postingsIncludable.value && postingCards.value !== null) parts.postings = postingCards.value;
    const aiJobIds: NonNullable<AiPayloadParts['aiJobIds']> = {};
    if (specIncludable.value && specJobId.value !== null) aiJobIds.structurize = specJobId.value;
    if (rocIncludable.value && rocJobId.value !== null) aiJobIds.roc = rocJobId.value;
    if (postingsIncludable.value && postingsJobId.value !== null) aiJobIds.postings = postingsJobId.value;
    if (Object.keys(aiJobIds).length > 0) parts.aiJobIds = aiJobIds;
    return parts;
  }

  // ── 파생 상태 정리 watch ────────────────────────────────────────────────────
  // 명세 포함을 끄면 파생물도 함께 해제(가시 상태 일치 — 제출 제외는 includable 이 보장).
  watch(includeSpec, (included) => {
    if (included) return;
    includeDiagram.value = false;
    includeRoc.value = false;
    includePostings.value = false;
  });
  // 질문 후보가 바뀌면 배치 라운드를 처음으로.
  watch(
    () =>
      JSON.stringify({
        requestType: fields.requestType,
        serviceAreas: fields.serviceAreas,
        hasAttachments: attachments.value.length > 0,
      }),
    () => {
      questionRound.value = 0;
    },
  );
  // 선분석 입력이 바뀌면 이전 잡을 폐기 → 인터뷰 재진입 시 자동 재실행.
  watch(questionPreanalysisSourceSignature, () => {
    questionPreanalysisJobId.value = null;
    runQuestionPreanalysis.reset();
    questionRound.value = 0;
  });
  watch(preanalysisKnownQuestionCodes, () => {
    questionRound.value = 0;
  });

  return {
    aiActive,
    rocEnabled,
    postingsEnabled,
    // 인터뷰 값
    interviewValues,
    interviewAnswerStr,
    setSingle,
    toggleMulti,
    hasInterviewAnswers,
    shareInterviewAnswersAgreed,
    // 선분석
    understood,
    preanalysisFindings,
    preanalysisKnownQuestionCodes,
    questionCandidates,
    questionPreanalysisRunning,
    questionPreanalysisFailed,
    questionPreanalysisDone,
    preanalyzeQuestions,
    ensurePreanalysis,
    // 질문 배치
    visibleQuestions,
    currentQuestions,
    questionRound,
    questionRoundCount,
    nextRound,
    prevRound,
    questionContextLabel,
    // 구성 명세
    spec,
    specJson,
    specRunning,
    specAwaitingPreanalysis,
    specFailed,
    specStale,
    specTbdBlocks,
    gapInputs,
    generateSpec,
    ensureSpec,
    reopenInterview,
    // 구성도
    diagramHtml,
    generateDiagramFromSpec,
    // ROC
    rocMd,
    rocRunning,
    rocFailed,
    rocStale,
    generateRoc,
    // 포스팅 카드
    postingCards,
    postingsRunning,
    postingsFailed,
    postingsStale,
    generatePostings,
    // 포함 토글·제출
    includeSpec,
    includeDiagram,
    includeRoc,
    includePostings,
    specIncludable,
    diagramIncludable,
    rocIncludable,
    postingsIncludable,
    consentRequired,
    reviewBlockedByConsent,
    includedAiArtifactLabels,
    aiPayloadParts,
  };
}

export type RequestWizardAi = ReturnType<typeof useRequestWizardAi>;
