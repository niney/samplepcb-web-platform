import { computed, reactive, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import {
  DEVELOP_BUDGET_RANGES,
  DEVELOP_CURRENT_STAGES,
  DEVELOP_DELIVERY_FORMS,
  DEVELOP_INDIVIDUAL_AREAS,
  DEVELOP_INDIVIDUAL_AREA_CODES,
  DEVELOP_PRIORITIES,
  DEVELOP_PRODUCTION_SCOPES,
  DEVELOP_PROTOTYPE_MODES,
  DEVELOP_REGISTRY,
  DEVELOP_REQUEST_MODES,
  DEVELOP_SOURCING_MODES,
  DEVELOP_SYSTEM_MENU,
  DEVELOP_TARGET_STAGES,
  DevelopContact,
  EMPTY_DEVELOP_PRODUCTION,
  EMPTY_MARKET_TOOLS,
  developArea,
  developAreaBadge,
  developAreaQuestionsFor,
  developFollowupAnswerText,
  developQuestionsFor,
  isDevelopFollowupAnswered,
  isDevelopFollowupUnknown,
  isMarketAnswered,
  isTextQuestion,
  normalizeDevelopProduction,
  resolveDevelopServiceAreas,
  sortDevelopAreas,
} from '@sp/api-contract';
import type {
  DevelopAiAnswerType,
  DevelopAiQuestionType,
  DevelopBudgetRangeType,
  DevelopContactType,
  DevelopCurrentStageType,
  DevelopDeliveryFormType,
  DevelopFollowupAnswerType,
  DevelopFollowupAnswersInputType,
  DevelopFollowupQuestionType,
  DevelopPriorityType,
  DevelopProductionPlanType,
  DevelopProductionScopeType,
  DevelopPrototypeModeType,
  DevelopRequestCreatePayloadType,
  DevelopRequestDetailType,
  DevelopRequestModeType,
  DevelopSourcingModeType,
  DevelopTargetStageType,
  MarketAnswerType,
  MarketAreaDef,
  MarketQuestionDef,
  MeContactType,
} from '@sp/api-contract';
import type { QuestionState } from '@sp/ui';

// 개발의뢰 폼 상태 — 위저드 v2 5스텝(2026-09-08)과 수정 화면이 **같은 상태**를 쓴다.
//   ① 개발 메뉴   시스템개발(배타) 또는 개별 견적(PCB·기구·앱·서버 복수)
//   ② 의뢰 내용   제목·목적·현재/목표 단계·희망 시기·예산·참고 자료 + 자료 사용 동의(aiConsent, 필수)
//                 (+시스템개발 후속 질문 방식) — 자료가 AI 로 나가는 시점이 2→3 전환이라 동의를 여기서 받는다
//   ③ 세부 질문   시스템개발 = AI 후속 질문(§7.2.2, 폴백은 고정 서술 3문항) + 디자인·기구 범위 2, 개별 견적 = 고른 분야의 전문 질문
//   ④ 제작 계획   시제품 수량·제작 범위·연간 수량(+범위가 있으면 조달·납품 형태)
//   ⑤ 검토·접수  연락처 + 요약 + 비밀유지(NDA)
// 분야·질문·라벨의 정본은 개발의뢰 레지스트리(DEVELOP_REGISTRY)라 이 파일에 분야 코드나
// 한글 라벨을 박지 않는다. 마켓 사전(MARKET_*)은 다른 상품이라 여기서 쓰지 않는다.
// 상태는 전부 이 컴포저블이 소유한다 — 스텝 컴포넌트는 그리기만 하므로 스텝을 오가도 답변이 남는다.

export type StepKey = 'menu' | 'describe' | 'questions' | 'production' | 'review';

// 시제품 수량은 "아직 안 골랐다"(null)가 있어야 4스텝 필수 검증이 산다 — 저장 직전 계약 모양으로 정규화한다.
export interface DevelopProductionFields {
  prototype: DevelopPrototypeModeType | null;
  prototypeQty: number | null;
  scopes: DevelopProductionScopeType[];
  annualQty: number | null;
  priority: DevelopPriorityType | null;
  sourcing: DevelopSourcingModeType | null;
  delivery: DevelopDeliveryFormType | null;
}

export interface DevelopFormFields {
  requestMode: DevelopRequestModeType | null; // null = 1스텝 미선택
  serviceAreas: string[]; // 개별 견적에서 고른 분야(시스템개발이면 비어 있다)
  title: string;
  description: string;
  currentStage: DevelopCurrentStageType | null;
  targetStage: DevelopTargetStageType | null;
  wishDate: string; // '' | YYYY-MM-DD
  wishNote: string;
  budgetRange: DevelopBudgetRangeType | null;
  expertDelegate: boolean; // 시스템개발 "전문가에게 맡김"
  production: DevelopProductionFields;
  ndaWanted: boolean;
  aiConsent: boolean; // 2스텝 동의 체크 — 입력 내용·자료를 견적 검토와 AI 사전 검토에 쓰는 데 동의(외부 LLM 전송 동의)
}

export interface DevelopContactFields {
  name: string;
  company: string;
  phone: string;
  email: string;
  hours: string;
}

export const DEVELOP_DRAFT_KEY = 'sp-develop-request-draft';

// 초안 복원 패널이 보여 줄 요약 — 실제 복원 전에 "무엇이 저장돼 있나"만 읽는다.
export interface DevelopDraftPeek {
  savedAt: string; // ISO
  title: string;
  menu: string;
  stepIndex: number;
}

const emptyProduction = (): DevelopProductionFields => ({
  prototype: null,
  prototypeQty: EMPTY_DEVELOP_PRODUCTION.prototypeQty,
  scopes: [...EMPTY_DEVELOP_PRODUCTION.scopes],
  annualQty: EMPTY_DEVELOP_PRODUCTION.annualQty,
  priority: EMPTY_DEVELOP_PRODUCTION.priority,
  sourcing: EMPTY_DEVELOP_PRODUCTION.sourcing,
  delivery: EMPTY_DEVELOP_PRODUCTION.delivery,
});

// ── localStorage 파싱 — 남의 손을 탄 문자열이라 타입을 믿지 않고 좁힌다 ──────────────
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? Array.from<unknown>(v) : [];
}
const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const asNumberOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asIntOrNull = (v: unknown): number | null => {
  const n = asNumberOrNull(v);
  return n === null || !Number.isInteger(n) ? null : n;
};
const asMember = <T extends string>(v: unknown, list: readonly T[]): T | null => {
  if (typeof v !== 'string') return null;
  const found = list.find((x) => x === v);
  return found ?? null;
};
const asStringList = (v: unknown): string[] => asArray(v).flatMap((x) => (typeof x === 'string' ? [x] : []));

export function useRequestForm(memberId: MaybeRefOrGetter<string | null> = null) {
  const fields = reactive<DevelopFormFields>({
    requestMode: null,
    serviceAreas: [],
    title: '',
    description: '',
    currentStage: null,
    targetStage: null,
    wishDate: '',
    wishNote: '',
    budgetRange: null,
    expertDelegate: false,
    production: emptyProduction(),
    ndaWanted: false,
    aiConsent: false,
  });
  const contact = reactive<DevelopContactFields>({ name: '', company: '', phone: '', email: '', hours: '' });

  const contactKeys = ['name', 'company', 'phone', 'email'] as const;
  const editedContact = new Set<(typeof contactKeys)[number]>();
  const contactPrefilled = ref(false);
  let contactPrefillApplied = false;
  // 동기 감시로 입력 후 다시 지운 항목도 기억한다. 늦게 온 회원정보가 빈칸을 되살리지 않는다.
  for (const key of contactKeys) {
    watch(() => contact[key], () => editedContact.add(key), { flush: 'sync' });
  }
  function prefillContact(profile: MeContactType): void {
    if (profile.mbId !== toValue(memberId) || contactPrefillApplied) return;
    contactPrefillApplied = true;
    for (const key of contactKeys) {
      const value = profile[key]?.trim() ?? '';
      if (!editedContact.has(key) && contact[key].trim() === '' && value !== '') {
        contact[key] = value;
        contactPrefilled.value = true;
      }
    }
  }

  // 참고 자료(2스텝, 한 번만 등록).
  const attachments = ref<File[]>([]);

  // 질문 상태 — 코드로 lazy 생성(레지스트리에 문항이 늘어도 여기는 안 바뀐다).
  const questionState = reactive<Record<string, QuestionState>>({});
  function stateOf(code: string): QuestionState {
    const found = questionState[code];
    if (found !== undefined) return found;
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

  // ── AI 후속 질문(§7.2.2) — 질문은 서버가 만들고, 이 폼은 **답만** 든다 ──────────────
  // 질문의 출처는 둘이다: 위저드는 잡 결과(useFollowupJob), 수정 화면은 저장분(detail.aiQuestions).
  // 답 상태를 레지스트리 문항(questionState)과 섞지 않는다 — 코드 공간이 다르고(레지스트리 'system.use'
  // vs 잡이 준 'q1'), 잡이 바뀌면 통째로 버려야 하는 값이라 수명도 다르다.
  const aiJobId = ref<string | null>(null);
  const aiUnderstood = ref('');
  const aiQuestions = ref<DevelopFollowupQuestionType[]>([]);
  const aiQuestionState = reactive<Record<string, QuestionState>>({});
  // AI 질문을 쓰는 중 — 질문이 0개여도(자료가 충분해 물을 것이 없음) 참이다. 폴백이면 거짓.
  const aiFollowupUsed = computed(() => aiJobId.value !== null);

  function aiStateOf(id: string): QuestionState {
    const found = aiQuestionState[id];
    if (found !== undefined) return found;
    const created: QuestionState = { choices: [], note: '' };
    aiQuestionState[id] = created;
    // 갓 만든 **원본**이 아니라 reactive 프록시로 되읽어 돌려준다 — 원본을 그대로 주면 그 화면이 원본을 붙들어
    // 첫 선택이 화면에 안 나타난다(칩은 눌렸는데 색이 안 바뀐다). 레지스트리 문항은 noteMissingCodes 가
    // 같은 상태를 프록시로 읽어 주는 덕에 가려져 있던 함정이다 — AI 질문에는 그 우회로가 없다.
    return aiQuestionState[id] ?? created;
  }
  // AI 질문은 전부 단일 선택이다(계약이 choice 하나만 싣는다) — 같은 칩을 다시 누르면 해제.
  function toggleAiChoice(id: string, choice: string): void {
    const state = aiStateOf(id);
    state.choices = state.choices[0] === choice ? [] : [choice];
  }
  function resetAiAnswers(): void {
    for (const key of Object.keys(aiQuestionState)) Reflect.deleteProperty(aiQuestionState, key);
  }
  // 잡 결과·저장분을 받는다. 같은 잡이면 답을 지킨다(폴링이 done 응답을 여러 번 준다).
  function setAiFollowup(jobId: string, understood: string, questions: readonly DevelopFollowupQuestionType[]): void {
    const changedJob = aiJobId.value !== jobId;
    aiJobId.value = jobId;
    aiUnderstood.value = understood;
    aiQuestions.value = questions.map((q) => ({ id: q.id, question: q.question, why: q.why, options: [...q.options] }));
    if (changedJob) resetAiAnswers();
  }
  function clearAiFollowup(): void {
    aiJobId.value = null;
    aiUnderstood.value = '';
    aiQuestions.value = [];
    resetAiAnswers();
  }

  const answerOfAi = (q: DevelopFollowupQuestionType): DevelopAiAnswerType | null => {
    const state = aiQuestionState[q.id];
    if (state === undefined) return null;
    const choice = q.options.length > 0 ? (state.choices[0] ?? null) : null;
    const text = state.note.trim();
    return choice === null && text === '' ? null : { choice, text };
  };
  // 검토 카드·상세와 **같은 규칙**으로 답 문자열을 만들기 위해 계약 저장분 모양으로 합친다.
  const aiAnsweredQuestions = computed<DevelopAiQuestionType[]>(() =>
    aiQuestions.value.map((q) => ({ ...q, answer: answerOfAi(q) })),
  );
  const aiAnswerRows = computed(() =>
    aiAnsweredQuestions.value.filter(isDevelopFollowupAnswered).map((q) => ({
      id: q.id,
      label: q.question,
      value: developFollowupAnswerText(q),
      unknown: isDevelopFollowupUnknown(q),
    })),
  );
  function buildAiAnswers(): DevelopFollowupAnswerType[] {
    return aiAnsweredQuestions.value.flatMap((q) => (q.answer === null ? [] : [{ id: q.id, choice: q.answer.choice, text: q.answer.text }]));
  }
  // 수정 화면용 — **모든** 문항을 싣는다. 서버는 보내지 않은 문항의 답을 그대로 두므로(applyDevelopFollowupAnswers),
  // 답한 것만 보내면 "지운 답"이 지워지지 않는다. 빈 답은 서버가 미응답(null)으로 정규화한다.
  function buildAiAnswersAll(): DevelopFollowupAnswerType[] {
    return aiAnsweredQuestions.value.map((q) => ({ id: q.id, choice: q.answer?.choice ?? null, text: q.answer?.text ?? '' }));
  }

  // AI 질문을 공용 QuestionField 로 그리기 위한 변환 — 선택지가 비면 서술형(kind:'text').
  const AI_TEXT_PLACEHOLDER = '아는 만큼만 적어 주세요';
  const toAiQuestionDef = (q: DevelopFollowupQuestionType): MarketQuestionDef => {
    const isText = q.options.length === 0;
    return {
      code: `ai:${q.id}`,
      label: q.question,
      short: q.question.slice(0, 20),
      multi: false,
      options: q.options.map((o) => ({ code: o.code, label: o.label })),
      ...(isText ? { kind: 'text' as const, notePlaceholder: AI_TEXT_PLACEHOLDER } : {}),
      ...(q.why === '' ? {} : { why: q.why }),
    };
  };
  const aiQuestionDefs = computed(() => aiQuestions.value.map((q) => ({ id: q.id, def: toAiQuestionDef(q) })));

  // ── 1스텝 메뉴 ─────────────────────────────────────────────────────────────
  const isSystem = computed(() => fields.requestMode === 'system');
  const individualAreas = DEVELOP_INDIVIDUAL_AREAS;
  const isAreaPicked = (code: string): boolean => fields.serviceAreas.includes(code);
  // 시스템개발은 배타다 — 고르면 개별 선택을 지우고, 개별을 고르면 시스템개발을 놓는다.
  function selectSystemMenu(): void {
    fields.requestMode = 'system';
    fields.serviceAreas = [];
  }
  function toggleIndividualArea(code: string): void {
    if (fields.requestMode !== 'individual') {
      fields.requestMode = 'individual';
      fields.serviceAreas = [code];
      fields.expertDelegate = false;
      return;
    }
    const i = fields.serviceAreas.indexOf(code);
    if (i >= 0) fields.serviceAreas.splice(i, 1);
    else fields.serviceAreas.push(code);
    if (fields.serviceAreas.length === 0) fields.requestMode = null;
  }

  // 저장·검증에 쓰는 분야 — 시스템개발이면 6분야 전부, 개별이면 고른 것(메뉴 미선택이면 빈 배열).
  const effectiveAreas = computed<string[]>(() =>
    fields.requestMode === null ? [] : resolveDevelopServiceAreas(fields.requestMode, fields.serviceAreas),
  );
  const pickedAreas = computed(() => sortDevelopAreas(fields.serviceAreas));
  const pickedAreaDefs = computed<MarketAreaDef[]>(() =>
    pickedAreas.value.map((c) => developArea(c)).filter((d): d is MarketAreaDef => d !== undefined),
  );
  // 1스텝 요약·검토 카드 배지 — 전 분야면 '시스템개발', 개별이면 분야명(들).
  const menuBadge = computed(() => (fields.requestMode === null ? '' : developAreaBadge(effectiveAreas.value)));

  // ── 3스텝 질문 ─────────────────────────────────────────────────────────────
  const activeQuestions = computed<MarketQuestionDef[]>(() => developQuestionsFor(effectiveAreas.value));
  const areaQuestionsOf = (area: string): MarketQuestionDef[] => developAreaQuestionsFor([area]);
  // 전문가에게 맡김이면 기술 문항은 건너뛰고 역할·협업 문항(askOnDelegate)만 남긴다(서버도 같은 규칙으로 버린다).
  const skipQuestions = computed(() => isSystem.value && fields.expertDelegate);
  // 고정 서술 3문항을 감추는 조건 — 맡김(담당자가 정한다) 또는 AI 질문을 쓰는 중(그 질문이 대신한다).
  // 감춘 문항은 답변에서도 빠진다(임시저장 복원으로 옛 답이 남아 있어도 등록 payload 에 실리지 않는다).
  const hideSystemQuestions = computed(() => skipQuestions.value || (isSystem.value && aiFollowupUsed.value));
  const askedQuestions = computed<MarketQuestionDef[]>(() =>
    hideSystemQuestions.value ? activeQuestions.value.filter((q) => q.askOnDelegate === true) : activeQuestions.value,
  );

  // 메모 필수(noteRequiredFor 선택지를 고른 문항) 미충족 목록.
  const noteMissingCodes = computed<string[]>(() => {
    return askedQuestions.value.flatMap((q) => {
      const state = questionState[q.code];
      if (state === undefined || state.choices.length === 0) return [];
      const required = q.noteRequiredFor?.some((c) => state.choices.includes(c)) ?? false;
      return required && state.note.trim() === '' ? [q.code] : [];
    });
  });

  // 등록에 실을 답변 — 응답한 문항만(서술형은 note, 선택형은 choices). 선택 분야 밖 문항은 버린다.
  function buildAnswers(): MarketAnswerType[] {
    return askedQuestions.value.flatMap((q) => {
      const state = questionState[q.code];
      if (state === undefined || !isMarketAnswered(q, state)) return [];
      // 선택을 바꿔 숨겨진 외부 업체 메모는 접수에 싣지 않는다. 다시 선택하면 입력은 복원된다.
      const noteVisible = q.noteVisibleFor === undefined || q.noteVisibleFor.some((code) => state.choices.includes(code));
      const note = noteVisible ? state.note.trim() : '';
      if (isTextQuestion(q)) return [{ code: q.code, choices: [], note }];
      return [{ code: q.code, choices: [...state.choices], ...(note !== '' ? { note } : {}) }];
    });
  }
  function buildProduction(): DevelopProductionPlanType {
    const p = fields.production;
    return normalizeDevelopProduction({
      prototype: p.prototype ?? 'undecided', // 4스텝 게이트가 null 을 막는다 — 타입 방어
      prototypeQty: p.prototypeQty,
      scopes: [...p.scopes],
      annualQty: p.annualQty,
      priority: p.priority,
      sourcing: p.sourcing,
      delivery: p.delivery,
    });
  }
  function buildContact(): DevelopContactType {
    return {
      name: contact.name.trim(),
      company: contact.company.trim() === '' ? null : contact.company.trim(),
      phone: contact.phone.trim(),
      email: contact.email.trim(),
      hours: contact.hours.trim() === '' ? null : contact.hours.trim(),
    };
  }
  // 등록 payload 의 AI 질문 조각 — 시스템개발 + 맡김 아님 + AI 질문을 쓴 경우만. 폴백이면 null 이고
  // 고정 3문항 답은 지금처럼 answers 로 간다. 질문 본문은 싣지 않는다(서버가 jobId 로 되읽는다).
  function buildAiQuestionsInput(): DevelopFollowupAnswersInputType | null {
    const jobId = aiJobId.value;
    if (jobId === null || !isSystem.value || skipQuestions.value) return null;
    return { jobId, answers: buildAiAnswers() };
  }
  function buildPayload(): DevelopRequestCreatePayloadType {
    const wishNote = fields.wishNote.trim();
    return {
      requestMode: fields.requestMode ?? 'individual', // 1스텝 게이트가 null 을 막는다 — 타입 방어
      title: fields.title.trim(),
      serviceAreas: isSystem.value ? [] : [...pickedAreas.value],
      tools: EMPTY_MARKET_TOOLS, // 희망 툴 UI 는 뺐다(PCB 설계 툴은 문항 pcb.tool)
      description: fields.description.trim(),
      answers: buildAnswers(),
      aiQuestions: buildAiQuestionsInput(),
      currentStage: fields.currentStage ?? 'idea',
      targetStage: fields.targetStage ?? 'spec_fixed',
      wishDate: fields.wishDate === '' ? null : fields.wishDate,
      wishNote: wishNote === '' ? null : wishNote,
      budgetRange: fields.budgetRange ?? 'after_quote',
      expertDelegate: skipQuestions.value,
      production: buildProduction(),
      ndaWanted: fields.ndaWanted,
      aiConsent: fields.aiConsent,
      contact: buildContact(),
    };
  }

  // ── 첨부 ──────────────────────────────────────────────────────────────────
  // 누적(드래그앤드롭·파일 선택을 여러 번 나눠 하는 것이 정상 동작). 같은 파일만 중복으로 거른다.
  const sameFile = (a: File, b: File): boolean => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
  function mergeFiles(current: File[], incoming: File[]): File[] {
    const next = [...current];
    for (const f of incoming) if (!next.some((x) => sameFile(x, f))) next.push(f);
    return next;
  }
  function addAttachments(files: File[]): void {
    attachments.value = mergeFiles(attachments.value, files);
  }
  function removeAttachment(index: number): void {
    attachments.value = attachments.value.filter((_, i) => i !== index);
  }
  const totalAttachmentCount = computed(() => attachments.value.length);

  function appendAttachments(fd: FormData): void {
    for (const f of attachments.value) fd.append('attachment', f);
  }
  function clearFiles(): void {
    attachments.value = [];
  }

  // ── 검증 ──────────────────────────────────────────────────────────────────
  const contactValid = computed(() => DevelopContact.safeParse(buildContact()).success);
  const menuValid = computed(
    () => fields.requestMode === 'system' || (fields.requestMode === 'individual' && fields.serviceAreas.length > 0),
  );
  const describeValid = computed(
    () =>
      fields.title.trim().length >= 2 &&
      fields.description.trim().length >= 10 &&
      fields.currentStage !== null &&
      fields.targetStage !== null &&
      (fields.wishDate !== '' || fields.wishNote.trim() !== '') &&
      fields.budgetRange !== null,
  );
  // 2스텝 게이트는 동의 체크까지 본다 — 자료가 외부 AI 로 나가는 시점이 2→3 전환이기 때문이다.
  // (describeValid 자체는 수정 화면도 쓴다 — 이미 접수한 의뢰에 동의를 다시 묻지 않는다.)
  const describeStepValid = computed(() => describeValid.value && fields.aiConsent);
  const questionsValid = computed(() => noteMissingCodes.value.length === 0);
  const productionValid = computed(
    () =>
      fields.production.prototype !== null &&
      (fields.production.prototype !== 'count' || fields.production.prototypeQty !== null),
  );
  const reviewValid = computed(() => contactValid.value);
  const formValid = computed(
    () =>
      menuValid.value && describeStepValid.value && questionsValid.value && productionValid.value && reviewValid.value,
  );

  // 스텝 오류 문구 — 하단 바가 그대로 읽는다(어느 항목이 남았는지 순서대로).
  function errorMessageOfStep(key: StepKey): string {
    if (key === 'menu') return menuValid.value ? '' : '견적을 요청할 개발 메뉴를 선택해 주세요.';
    if (key === 'describe') {
      if (fields.title.trim().length < 2 || fields.description.trim().length < 10) return '의뢰 제목과 개발 목적을 입력해 주세요.';
      if (fields.currentStage === null || fields.targetStage === null) return '현재 단계와 목표 단계를 선택해 주세요.';
      if (fields.wishDate === '' && fields.wishNote.trim() === '') return '희망 완료일 또는 기간을 입력해 주세요.';
      if (fields.budgetRange === null) return '예상 개발 예산을 선택해 주세요.';
      if (!fields.aiConsent) return '입력 내용과 자료를 견적 검토와 AI 사전 검토에 사용하는 데 동의해 주세요.';
      return '';
    }
    if (key === 'questions') return questionsValid.value ? '' : '선택하신 항목에 내용을 적어 주세요.';
    if (key === 'production') {
      if (fields.production.prototype === null) return '시제품 제작 수량을 선택해 주세요.';
      if (fields.production.prototype === 'count' && fields.production.prototypeQty === null) return '시제품 수량을 입력해 주세요.';
      return '';
    }
    if (!contactValid.value) return '연락처를 입력해 주세요.';
    // 동의는 2스텝에서 받는다 — 초안 복원으로 마지막 스텝에 바로 선 경우에만 여기서 걸린다.
    if (!fields.aiConsent) return '2단계에서 자료 사용 동의에 체크해 주세요.';
    return '';
  }

  // ── 스텝(수정 화면은 안 쓴다) ────────────────────────────────────────────────
  const steps = [
    { key: 'menu', label: '개발 메뉴', sub: '필요한 업무 선택' },
    { key: 'describe', label: '의뢰 내용', sub: '목적·단계·자료' },
    { key: 'questions', label: '세부 질문', sub: '선택 분야 확인' },
    { key: 'production', label: '제작 계획', sub: '시제품·생산' },
    { key: 'review', label: '검토·접수', sub: '입력 내용 확인' },
  ] as const;

  const stepIndex = ref(0);
  const currentStep = computed<StepKey>(() => steps[stepIndex.value]?.key ?? 'menu');
  const isLastStep = computed(() => stepIndex.value === steps.length - 1);
  const stepValid = computed<boolean>(() => {
    const key = currentStep.value;
    if (key === 'menu') return menuValid.value;
    if (key === 'describe') return describeStepValid.value;
    if (key === 'questions') return questionsValid.value;
    if (key === 'production') return productionValid.value;
    return formValid.value;
  });
  const currentError = computed(() => errorMessageOfStep(currentStep.value));
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

  // ── 수정 화면 프리필 ────────────────────────────────────────────────────────
  // production 은 객체를 **갈아 끼우지 않는다** — 스텝 컴포넌트가 fields.production 을 별칭으로 잡아 두기 때문에
  // 새 객체를 넣으면 그 화면의 v-model 이 옛 객체를 계속 붙든다. 그래서 제자리에서 필드만 채운다.
  function applyProduction(next: DevelopProductionFields): void {
    const p = fields.production;
    p.prototype = next.prototype;
    p.prototypeQty = next.prototypeQty;
    p.scopes = [...next.scopes];
    p.annualQty = next.annualQty;
    p.priority = next.priority;
    p.sourcing = next.sourcing;
    p.delivery = next.delivery;
  }

  function resetQuestions(): void {
    // Reflect.deleteProperty 는 reactive 프록시의 deleteProperty 트랩을 그대로 타면서 동적 delete 문법을 피한다.
    for (const key of Object.keys(questionState)) Reflect.deleteProperty(questionState, key);
  }
  // 상세 응답을 그대로 폼 상태로 되돌린다(첨부는 서버에 있으므로 여기서 안 채운다).
  function hydrate(detail: DevelopRequestDetailType): void {
    fields.requestMode = detail.requestMode;
    // 시스템개발은 저장분이 6분야 전부라 "개별 선택"에 담지 않는다 — 개별로 바꾸면 다시 고른다.
    fields.serviceAreas =
      detail.requestMode === 'individual'
        ? sortDevelopAreas(detail.serviceAreas).filter((c) => DEVELOP_INDIVIDUAL_AREA_CODES.includes(c))
        : [];
    fields.title = detail.title;
    fields.description = detail.description;
    fields.currentStage = detail.currentStage;
    fields.targetStage = detail.targetStage;
    fields.wishDate = detail.wishDate ?? '';
    fields.wishNote = detail.wishNote ?? '';
    fields.budgetRange = detail.budgetRange;
    fields.expertDelegate = detail.expertDelegate;
    fields.aiConsent = detail.aiConsent; // 이미 접수한 의뢰다(동의는 접수 시점에 받았고 수정에서 바꾸지 않는다)
    fields.ndaWanted = detail.ndaWanted;
    const plan = detail.production;
    applyProduction(
      plan === null
        ? emptyProduction()
        : {
          prototype: plan.prototype,
          prototypeQty: plan.prototypeQty,
          scopes: [...plan.scopes],
          annualQty: plan.annualQty,
          priority: plan.priority,
          sourcing: plan.sourcing,
          delivery: plan.delivery,
        },
    );
    contactPrefillApplied = true;
    contactPrefilled.value = false;
    contact.name = detail.contact.name;
    contact.company = detail.contact.company ?? '';
    contact.phone = detail.contact.phone;
    contact.email = detail.contact.email;
    contact.hours = detail.contact.hours ?? '';
    resetQuestions();
    for (const a of detail.answers) questionState[a.code] = { choices: [...a.choices], note: a.note ?? '' };
    // AI 후속 질문 저장분 — 질문은 못 바꾸고 답만 고친다(재생성 없음).
    const stored = detail.aiQuestions;
    clearAiFollowup();
    if (stored !== null) {
      setAiFollowup(stored.jobId, stored.understood, stored.questions);
      for (const q of stored.questions) {
        if (q.answer !== null) {
          aiQuestionState[q.id] = { choices: q.answer.choice === null ? [] : [q.answer.choice], note: q.answer.text };
        }
      }
    }
  }

  // 처음부터 — 폼을 비운다(초안 삭제는 호출자가 clearDraft 로).
  function resetAll(): void {
    fields.requestMode = null;
    fields.serviceAreas = [];
    fields.title = '';
    fields.description = '';
    fields.currentStage = null;
    fields.targetStage = null;
    fields.wishDate = '';
    fields.wishNote = '';
    fields.budgetRange = null;
    fields.expertDelegate = false;
    applyProduction(emptyProduction());
    fields.ndaWanted = false;
    fields.aiConsent = false;
    contact.name = '';
    contact.company = '';
    contact.phone = '';
    contact.email = '';
    contact.hours = '';
    editedContact.clear();
    contactPrefillApplied = false;
    contactPrefilled.value = false;
    resetQuestions();
    clearAiFollowup();
    clearFiles();
    stepIndex.value = 0;
  }

  // ── 임시저장(localStorage) — 파일은 담지 않는다 ─────────────────────────────
  const draftSavedAt = ref<string | null>(null);
  const draftFound = ref<DevelopDraftPeek | null>(null);
  const draftKey = computed(() => {
    const id = toValue(memberId);
    return id === null ? null : `${DEVELOP_DRAFT_KEY}:${encodeURIComponent(id)}`;
  });

  function readRaw(): Record<string, unknown> | null {
    const key = draftKey.value;
    if (key === null) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null || raw === '') return null;
      const parsed: unknown = JSON.parse(raw);
      const obj = asRecord(parsed);
      // 소유자를 알 수 없는 구버전 공용 초안은 자동 이관/복원하지 않는다.
      return obj.v === 3 && obj.mbId === toValue(memberId) ? obj : null;
    } catch {
      return null;
    }
  }

  function saveDraft(): void {
    const key = draftKey.value;
    if (key === null) return;
    const questions: Record<string, { choices: string[]; note: string }> = {};
    for (const [code, state] of Object.entries(questionState)) {
      if (state.choices.length > 0 || state.note.trim() !== '') questions[code] = { choices: [...state.choices], note: state.note };
    }
    const savedAt = new Date().toISOString();
    const draft = {
      v: 3,
      mbId: toValue(memberId),
      savedAt,
      stepIndex: stepIndex.value,
      fields: {
        requestMode: fields.requestMode,
        serviceAreas: [...fields.serviceAreas],
        title: fields.title,
        description: fields.description,
        currentStage: fields.currentStage,
        targetStage: fields.targetStage,
        wishDate: fields.wishDate,
        wishNote: fields.wishNote,
        budgetRange: fields.budgetRange,
        expertDelegate: fields.expertDelegate,
        production: { ...fields.production, scopes: [...fields.production.scopes] },
        ndaWanted: fields.ndaWanted,
        aiConsent: fields.aiConsent,
      },
      contact: { ...contact },
      questions,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(draft));
      draftSavedAt.value = savedAt;
    } catch {
      draftSavedAt.value = null;
    }
  }

  function clearDraft(): void {
    try {
      const key = draftKey.value;
      if (key !== null) window.localStorage.removeItem(key);
    } catch {
      // 저장소가 막혀 있으면 지울 것도 없다
    }
    draftSavedAt.value = null;
    draftFound.value = null;
  }

  // 위저드 진입 — 초안이 있으면 복원 패널에 띄울 요약만 만든다(적용은 restoreDraft).
  function checkDraft(): void {
    const obj = readRaw();
    if (obj === null) {
      draftFound.value = null;
      return;
    }
    const f = asRecord(obj.fields);
    const mode = asMember(f.requestMode, DEVELOP_REQUEST_MODES);
    const areas = asStringList(f.serviceAreas);
    const menu =
      mode === 'system'
        ? DEVELOP_SYSTEM_MENU.label
        : mode === 'individual' && areas.length > 0
          ? developAreaBadge(areas)
          : '메뉴 미선택';
    draftFound.value = {
      savedAt: asString(obj.savedAt),
      title: asString(f.title),
      menu,
      stepIndex: asIntOrNull(obj.stepIndex) ?? 0,
    };
  }

  function restoreDraft(): boolean {
    const obj = readRaw();
    if (obj === null) {
      draftFound.value = null;
      return false;
    }
    const f = asRecord(obj.fields);
    fields.requestMode = asMember(f.requestMode, DEVELOP_REQUEST_MODES);
    fields.serviceAreas = asStringList(f.serviceAreas).filter((c) => DEVELOP_INDIVIDUAL_AREA_CODES.includes(c));
    fields.title = asString(f.title);
    fields.description = asString(f.description);
    fields.currentStage = asMember(f.currentStage, DEVELOP_CURRENT_STAGES);
    fields.targetStage = asMember(f.targetStage, DEVELOP_TARGET_STAGES);
    fields.wishDate = asString(f.wishDate);
    fields.wishNote = asString(f.wishNote);
    fields.budgetRange = asMember(f.budgetRange, DEVELOP_BUDGET_RANGES);
    fields.expertDelegate = asBool(f.expertDelegate, false);
    fields.ndaWanted = asBool(f.ndaWanted, false);
    fields.aiConsent = false; // 동의는 다시 받는다
    const p = asRecord(f.production);
    applyProduction({
      prototype: asMember(p.prototype, DEVELOP_PROTOTYPE_MODES),
      prototypeQty: asIntOrNull(p.prototypeQty),
      scopes: asStringList(p.scopes).flatMap((code) => {
        const hit = asMember(code, DEVELOP_PRODUCTION_SCOPES);
        return hit === null ? [] : [hit];
      }),
      annualQty: asIntOrNull(p.annualQty),
      priority: asMember(p.priority, DEVELOP_PRIORITIES),
      sourcing: asMember(p.sourcing, DEVELOP_SOURCING_MODES),
      delivery: asMember(p.delivery, DEVELOP_DELIVERY_FORMS),
    });
    const c = asRecord(obj.contact);
    // 복원된 빈칸도 고객이 저장한 값이다. 진행 중인 회원정보 조회보다 우선한다.
    contactPrefillApplied = true;
    contactPrefilled.value = false;
    contact.name = asString(c.name);
    contact.company = asString(c.company);
    contact.phone = asString(c.phone);
    contact.email = asString(c.email);
    contact.hours = asString(c.hours);
    resetQuestions();
    for (const [code, value] of Object.entries(asRecord(obj.questions))) {
      const state = asRecord(value);
      questionState[code] = { choices: asStringList(state.choices), note: asString(state.note) };
    }
    // AI 질문·답은 초안에 담지 않는다 — 3스텝에 들어가면 같은 입력의 잡을 다시 받아 온다.
    clearAiFollowup();
    const savedStep = asIntOrNull(obj.stepIndex) ?? 0;
    stepIndex.value = Math.min(Math.max(savedStep, 0), steps.length - 1);
    draftSavedAt.value = asString(obj.savedAt);
    draftFound.value = null;
    return true;
  }

  watch(
    () => toValue(memberId),
    (_id, previous) => {
      if (previous !== undefined) resetAll();
      draftSavedAt.value = null;
      checkDraft();
    },
    { immediate: true, flush: 'sync' },
  );

  return {
    fields,
    contact,
    contactPrefilled,
    prefillContact,
    attachments,
    totalAttachmentCount,
    individualAreas,
    systemMenu: DEVELOP_SYSTEM_MENU,
    isSystem,
    isAreaPicked,
    selectSystemMenu,
    toggleIndividualArea,
    effectiveAreas,
    pickedAreas,
    pickedAreaDefs,
    menuBadge,
    registry: DEVELOP_REGISTRY,
    activeQuestions,
    askedQuestions,
    areaQuestionsOf,
    skipQuestions,
    hideSystemQuestions,
    noteMissingCodes,
    questionState,
    stateOf,
    toggleChoice,
    aiJobId,
    aiUnderstood,
    aiQuestions,
    aiQuestionDefs,
    aiQuestionState,
    aiFollowupUsed,
    aiAnswerRows,
    aiStateOf,
    toggleAiChoice,
    setAiFollowup,
    clearAiFollowup,
    buildAiAnswers,
    buildAiAnswersAll,
    buildAiQuestionsInput,
    buildAnswers,
    buildProduction,
    buildContact,
    buildPayload,
    appendAttachments,
    clearFiles,
    addAttachments,
    removeAttachment,
    hydrate,
    resetAll,
    contactValid,
    menuValid,
    describeValid,
    describeStepValid,
    questionsValid,
    productionValid,
    reviewValid,
    formValid,
    errorMessageOfStep,
    steps,
    stepIndex,
    currentStep,
    isLastStep,
    stepValid,
    currentError,
    next,
    prev,
    goToStep,
    draftSavedAt,
    draftFound,
    checkDraft,
    saveDraft,
    restoreDraft,
    clearDraft,
  };
}

export type DevelopRequestForm = ReturnType<typeof useRequestForm>;
