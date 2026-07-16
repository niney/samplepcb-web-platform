import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MarketServiceArea } from '@sp/api-contract';
import type {
  MarketBudgetRangeType,
  MarketProjectDeadlineType,
  MarketProjectMethodType,
  MarketRequestTypeType,
  MarketServiceAreaType,
} from '@sp/api-contract';
import { useAiUsecaseStatus } from '../api/useAi';

// 의뢰 마법사 v2 폼 상태 — AI-우선 4스텝(분야 → 설명·자료 → AI 인터뷰 → 검토·등록).
// 인터뷰 스텝은 structurize 유스케이스 활성 && AI 분석 동의일 때만 존재한다(둘 중 하나라도
// 빠지면 스텝 배열은 [area, describe, review], 검토 스텝은 조건 폼만 노출).
// 이 컴포저블은 폼 값·스텝 정의·네비게이션·폼 자체 유효성만 소유한다 — AI 잡 오케스트레이션과
// 답변 공개 동의 결합은 useRequestWizardAi·셸이 담당한다.

export type StepKey = 'area' | 'describe' | 'interview' | 'review';

export interface RequestForm {
  requestType: MarketRequestTypeType;
  serviceAreas: MarketServiceAreaType[];
  title: string;
  description: string;
  // AI 분석 동의(기본 true) — 해제 시 인터뷰 스텝이 빠지고 일반 등록으로 진행된다.
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

  // ?cat= 분야 프리셋, ?expert= 지정견적 프리셋(전문가 상세의 CTA 진입).
  const presetServiceArea = ((): MarketServiceAreaType => {
    const area = MarketServiceArea.safeParse(route.query.cat);
    return area.success ? area.data : 'circuit';
  })();
  const presetExpertId = ((): number | null => {
    const n = Number(route.query.expert);
    return Number.isInteger(n) && n > 0 ? n : null;
  })();

  const fields = reactive<RequestForm>({
    requestType: 'individual',
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
  const typeNotice = ref('');

  // 인터뷰 스텝 게이트 — structurize 활성 여부(관리자 토글은 드물어 오래 캐시).
  const structurizeStatus = useAiUsecaseStatus('market.request-structurize');
  const interviewEnabled = computed(() => structurizeStatus.data.value?.data.enabled ?? false);
  const interviewStepShown = computed(() => interviewEnabled.value && fields.aiConsent);

  const steps = computed<{ key: StepKey; label: string }[]>(() => [
    { key: 'area', label: '분야' },
    { key: 'describe', label: '설명·자료' },
    ...(interviewStepShown.value ? [{ key: 'interview' as const, label: 'AI 인터뷰' }] : []),
    { key: 'review', label: '검토·등록' },
  ]);

  const stepIndex = ref(0);
  const currentStep = computed<StepKey>(() => steps.value[stepIndex.value]?.key ?? 'area');
  const isLastStep = computed(() => stepIndex.value === steps.value.length - 1);

  // 동의 해제로 인터뷰 스텝이 사라져 인덱스가 배열을 벗어나면 마지막 스텝으로 보정.
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

  function toggleServiceArea(code: MarketServiceAreaType): void {
    const i = fields.serviceAreas.indexOf(code);
    if (i >= 0) fields.serviceAreas.splice(i, 1);
    else fields.serviceAreas.push(code);
    if (fields.requestType === 'individual' && fields.serviceAreas.length > 1) {
      fields.requestType = 'system';
      typeNotice.value = '개발 분야를 여러 개 선택해 의뢰 유형이 시스템 통합 개발로 자동 변경되었습니다.';
    }
  }
  function selectRequestType(type: MarketRequestTypeType): void {
    fields.requestType = type;
    typeNotice.value = '';
    if (type === 'individual' && fields.serviceAreas.length > 1) {
      fields.serviceAreas = [fields.serviceAreas[0] ?? 'circuit'];
      typeNotice.value = '개별 분야 개발은 한 분야만 선택할 수 있어 첫 번째 분야만 유지했습니다.';
    }
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

  // 스텝별 폼 자체 유효성 — 답변 공개 동의처럼 AI 상태와 얽힌 조건은 셸에서 결합한다.
  const stepValid = computed<boolean>(() => {
    const key = currentStep.value;
    if (key === 'area') return fields.requestType === 'system' || fields.serviceAreas.length === 1;
    if (key === 'describe') return fields.title.trim().length >= 2 && fields.description.trim().length >= 10;
    if (key === 'interview') return true; // 전 문항 선택 사항
    const deadlineOk = fields.deadlineMode !== 'date' || fields.deadlineDate >= todayKst;
    const methodOk = fields.method === 'open' || fields.targetExpertId !== null;
    return deadlineOk && methodOk;
  });

  const requestTypeDescs: Record<MarketRequestTypeType, string> = {
    system: '여러 개발 분야를 연결해 제품 또는 시스템 전체를 개발합니다.',
    individual: '필요한 개발 분야를 하나 이상 선택해 의뢰합니다.',
  };

  return {
    fields,
    attachments,
    typeNotice,
    presetExpertId,
    interviewEnabled,
    interviewStepShown,
    steps,
    stepIndex,
    currentStep,
    isLastStep,
    next,
    prev,
    goToStep,
    toggleServiceArea,
    selectRequestType,
    pickAttachments,
    todayKst,
    projectDeadline,
    stepValid,
    requestTypeDescs,
  };
}

export type RequestWizardForm = ReturnType<typeof useRequestWizardForm>;
