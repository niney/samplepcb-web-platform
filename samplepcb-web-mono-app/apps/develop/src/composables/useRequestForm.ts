import { computed, reactive, ref } from 'vue';
import {
  DevelopContact,
  MARKET_AREAS,
  MARKET_AREA_CODES,
  MARKET_COMMON_CONDITIONS,
  MARKET_COMMON_QUESTIONS,
  MARKET_TOOLS_VERSION,
  marketArea,
  marketAttachmentField,
  marketQuestionsFor,
  marketRequiredMissing,
  sortMarketAreas,
} from '@sp/api-contract';
import type {
  DevelopContactType,
  DevelopRequestDetailType,
  MarketAnswerType,
  MarketAreaDef,
  MarketBudgetRangeType,
  MarketQuestionDef,
  MarketToolsType,
} from '@sp/api-contract';
import type { QuestionState } from '@sp/ui';

// 개발의뢰 폼 상태(docs/DEVELOP_FLOW.md §7.2) — 위저드 3스텝과 수정 화면이 **같은 상태**를 쓴다.
//   ① 의뢰 내용(분야·제목·설명·참고 자료·AI 동의)
//   ② 조건·질문(예산 + 공통 조건 3 + 비밀유지 희망 + 공통 질문 3 + 분야별 맞춤 질문·희망 툴·추가자료 슬롯)
//   ③ 연락처·확인(이름·회사·전화·이메일·통화 가능 시간 + 요약)
// 마켓 위저드와 달리 AI 잡 오케스트레이션이 없다 — 검토서는 등록 뒤 서버가 관리자용으로 만든다(§2 결정 3).
// 분야·질문·툴·슬롯의 정본은 레지스트리(MARKET_AREAS)라 이 파일에 분야 코드를 문자열로 박지 않는다.

export type StepKey = 'describe' | 'conditions' | 'contact';

export interface DevelopFormFields {
  serviceAreas: string[];
  title: string;
  description: string;
  aiConsent: boolean;
  ndaWanted: boolean;
  budgetRange: MarketBudgetRangeType | null; // null = 아직 안 골랐다(2스텝 필수)
}

export interface DevelopContactFields {
  name: string;
  company: string;
  phone: string;
  email: string;
  hours: string;
}

export const slotKey = (area: string, slot: string): string => `${area}:${slot}`;

export function useRequestForm() {
  const fields = reactive<DevelopFormFields>({
    serviceAreas: [],
    title: '',
    description: '',
    aiConsent: true,
    ndaWanted: false,
    budgetRange: null,
  });
  const contact = reactive<DevelopContactFields>({ name: '', company: '', phone: '', email: '', hours: '' });

  // 참고 자료(일반 첨부, 1스텝) + 분야별 추가자료(2스텝, 키 = "area:slot").
  const attachments = ref<File[]>([]);
  const slotFiles = reactive<Record<string, File[]>>({});

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

  const selectedAreas = computed(() => sortMarketAreas(fields.serviceAreas));
  const areaDefs = computed<MarketAreaDef[]>(() =>
    selectedAreas.value.map((c) => marketArea(c)).filter((d): d is MarketAreaDef => d !== undefined),
  );
  const activeQuestions = computed<MarketQuestionDef[]>(() => marketQuestionsFor(fields.serviceAreas));
  const conditionQuestions = MARKET_COMMON_CONDITIONS;
  const commonQuestions = MARKET_COMMON_QUESTIONS;
  // 풀 개발이면 분야당 앞 2개만 묻는다(레지스트리 상한) — 분야 카드는 이 목록으로 그린다.
  const areaQuestionsOf = (area: string): MarketQuestionDef[] =>
    activeQuestions.value.filter((q) => q.code.startsWith(`${area}.`));

  // 메모 필수(noteRequiredFor 선택지를 고른 문항) 미충족 목록.
  const noteMissingCodes = computed<string[]>(() =>
    activeQuestions.value.flatMap((q) => {
      const state = questionState[q.code];
      if (state === undefined || state.choices.length === 0) return [];
      const required = q.noteRequiredFor?.some((c) => state.choices.includes(c)) ?? false;
      return required && state.note.trim() === '' ? [q.code] : [];
    }),
  );

  // 등록에 실을 답변 — 응답한 문항만, 선택 분야 밖 문항은 버린다.
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
  function buildContact(): DevelopContactType {
    return {
      name: contact.name.trim(),
      company: contact.company.trim() === '' ? null : contact.company.trim(),
      phone: contact.phone.trim(),
      email: contact.email.trim(),
      hours: contact.hours.trim() === '' ? null : contact.hours.trim(),
    };
  }

  // 필수 문항(공통 조건 3) 미응답 — 등록 라우트와 같은 함수를 쓴다.
  const requiredMissingCodes = computed<string[]>(() => marketRequiredMissing(buildAnswers(), fields.serviceAreas));
  // 2스텝 "프로젝트 조건" 진행(n/5): 예산 + 조건 3 + 비밀유지(체크박스라 언제나 답).
  const conditionProgress = computed(() => ({
    done: conditionQuestions.length - requiredMissingCodes.value.length + (fields.budgetRange === null ? 0 : 1) + 1,
    total: conditionQuestions.length + 2,
  }));

  // 첨부 — 누적(드래그앤드롭·파일 선택을 여러 번 나눠 하는 것이 정상 동작). 같은 파일만 중복으로 거른다.
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
  function addSlotFiles(area: string, slot: string, files: File[]): void {
    const key = slotKey(area, slot);
    slotFiles[key] = mergeFiles(slotFiles[key] ?? [], files);
  }
  function removeSlotFile(area: string, slot: string, index: number): void {
    const key = slotKey(area, slot);
    slotFiles[key] = (slotFiles[key] ?? []).filter((_, i) => i !== index);
  }
  const filesOfSlot = (area: string, slot: string): File[] => slotFiles[slotKey(area, slot)] ?? [];

  // 선택 분야의 슬롯 첨부만(분야를 해제하면 그 슬롯 파일은 보내지 않는다).
  const activeSlotFiles = computed<{ field: string; file: File }[]>(() =>
    selectedAreas.value.flatMap((area) =>
      (marketArea(area)?.attachmentSlots ?? []).flatMap((slot) =>
        filesOfSlot(area, slot.code).map((file) => ({ field: marketAttachmentField(area, slot.code), file })),
      ),
    ),
  );
  const totalAttachmentCount = computed(() => attachments.value.length + activeSlotFiles.value.length);
  const hasAnyFile = computed(() => totalAttachmentCount.value > 0);

  // 첨부 전체(일반 + 슬롯) — 등록·첨부 추가 multipart 가 쓴다.
  function appendAttachments(fd: FormData): void {
    for (const f of attachments.value) fd.append('attachment', f);
    for (const { field, file } of activeSlotFiles.value) fd.append(field, file);
  }
  function clearFiles(): void {
    attachments.value = [];
    for (const key of Object.keys(slotFiles)) slotFiles[key] = [];
  }

  function toggleServiceArea(code: string): void {
    const i = fields.serviceAreas.indexOf(code);
    if (i >= 0) fields.serviceAreas.splice(i, 1);
    else fields.serviceAreas.push(code);
  }
  // "잘 모르겠어요 — 전부 맡길게요": 분야를 모르는 의뢰자는 전 분야(풀 개발)로 등록한다.
  const allServiceAreasSelected = computed(() => MARKET_AREA_CODES.every((a) => fields.serviceAreas.includes(a)));
  function selectAllServiceAreas(): void {
    fields.serviceAreas = [...MARKET_AREA_CODES];
  }

  // 수정 화면 프리필 — 상세 응답을 그대로 폼 상태로 되돌린다(첨부는 서버에 있으므로 여기서 안 채운다).
  function hydrate(detail: DevelopRequestDetailType): void {
    fields.serviceAreas = sortMarketAreas(detail.serviceAreas);
    fields.title = detail.title;
    fields.description = detail.description;
    fields.aiConsent = detail.aiConsent;
    fields.ndaWanted = detail.ndaWanted;
    fields.budgetRange = detail.budgetRange;
    contact.name = detail.contact.name;
    contact.company = detail.contact.company ?? '';
    contact.phone = detail.contact.phone;
    contact.email = detail.contact.email;
    contact.hours = detail.contact.hours ?? '';
    // Reflect.deleteProperty 는 reactive 프록시의 deleteProperty 트랩을 그대로 타면서 동적 delete 문법을 피한다.
    for (const key of Object.keys(questionState)) Reflect.deleteProperty(questionState, key);
    for (const a of detail.answers) questionState[a.code] = { choices: [...a.choices], note: a.note ?? '' };
    for (const key of Object.keys(tools)) Reflect.deleteProperty(tools, key);
    for (const [area, codes] of Object.entries(detail.tools.byArea)) tools[area] = [...codes];
  }

  const contactValid = computed(() => DevelopContact.safeParse(buildContact()).success);
  const describeValid = computed(
    () => fields.serviceAreas.length > 0 && fields.title.trim().length >= 2 && fields.description.trim().length >= 10,
  );
  const conditionsValid = computed(
    () => fields.budgetRange !== null && requiredMissingCodes.value.length === 0 && noteMissingCodes.value.length === 0,
  );
  const formValid = computed(() => describeValid.value && conditionsValid.value && contactValid.value);

  // ── 위저드 스텝(수정 화면은 안 쓴다) ───────────────────────────────────────
  const steps = [
    { key: 'describe', label: '의뢰 내용' },
    { key: 'conditions', label: '조건 · 질문' },
    { key: 'contact', label: '연락처 · 확인' },
  ] as const;

  const stepIndex = ref(0);
  const currentStep = computed<StepKey>(() => steps[stepIndex.value]?.key ?? 'describe');
  const isLastStep = computed(() => stepIndex.value === steps.length - 1);
  const stepValid = computed<boolean>(() => {
    if (currentStep.value === 'describe') return describeValid.value;
    if (currentStep.value === 'conditions') return conditionsValid.value;
    return formValid.value;
  });
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

  return {
    fields,
    contact,
    attachments,
    slotFiles,
    filesOfSlot,
    activeSlotFiles,
    totalAttachmentCount,
    hasAnyFile,
    areas: MARKET_AREAS,
    selectedAreas,
    areaDefs,
    conditionQuestions,
    commonQuestions,
    areaQuestionsOf,
    activeQuestions,
    requiredMissingCodes,
    noteMissingCodes,
    conditionProgress,
    questionState,
    stateOf,
    toggleChoice,
    tools,
    toggleTool,
    clearTools,
    isRecommended,
    buildAnswers,
    buildTools,
    buildContact,
    appendAttachments,
    clearFiles,
    addAttachments,
    removeAttachment,
    addSlotFiles,
    removeSlotFile,
    toggleServiceArea,
    allServiceAreasSelected,
    selectAllServiceAreas,
    hydrate,
    contactValid,
    describeValid,
    conditionsValid,
    formValid,
    steps,
    stepIndex,
    currentStep,
    isLastStep,
    stepValid,
    next,
    prev,
    goToStep,
  };
}

export type DevelopRequestForm = ReturnType<typeof useRequestForm>;
