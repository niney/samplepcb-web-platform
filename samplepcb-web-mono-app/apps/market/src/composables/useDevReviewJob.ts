import { computed, onScopeDispose, ref, watch } from 'vue';
import { MarketDevReview } from '@sp/api-contract';
import type { AiJobStageType, MarketDevReviewType } from '@sp/api-contract';
import { useAiJob, useRunDevReview } from '../api/useAi';
import { errorMessage } from '../lib/error-msg';
import type { RequestWizardForm } from './useRequestWizardForm';

// AI 사전 검토서 잡 오케스트레이션(docs/AI_DEV_REVIEW.md §3·§5.1).
// run(multipart) → jobId → 5초 폴링 → 검토서. 루프는 없다 — 사용자가 원할 때만 재생성한다.
//
// 신선도는 **로컬 서명**으로 판정한다: 검토서의 원천(제목·분야·설명·답변·첨부)을 문자열로
// 묶어 생성 시점 값과 비교한다. 서버도 등록 시 같은 원천을 해시로 대조해 REVIEW_STALE 를
// 내므로, 로컬 판정은 그 400 을 사용자가 만나기 전에 잡아주는 앞단일 뿐이다.
// 첨부는 name+size+lastModified 로만 비교한다(브라우저에서 내용 해시는 비싸다).

const attachmentSignature = (files: readonly File[]): string =>
  files.map((f) => `${f.name}:${String(f.size)}:${String(f.lastModified)}`).join('|');

export function useDevReviewJob(form: RequestWizardForm) {
  const { fields, attachments, devReviewEnabled, buildAnswers } = form;

  // 검토서 생성 노출 조건 = 유스케이스 활성 && AI 사전 검토 동의.
  const active = computed(() => devReviewEnabled.value && fields.aiConsent);

  const sourceSignature = computed(() =>
    JSON.stringify({
      title: fields.title.trim(),
      serviceAreas: [...fields.serviceAreas].sort(),
      description: fields.description.trim(),
      answers: buildAnswers(),
      attachments: attachmentSignature(attachments.value),
    }),
  );

  const run = useRunDevReview();
  const jobId = ref<string | null>(null);
  const generatedSignature = ref<string | null>(null);
  const startError = ref('');
  const include = ref(true);

  const job = useAiJob(jobId);
  const jobData = computed(() => job.data.value?.data ?? null);

  const stage = computed<AiJobStageType | null>(() => jobData.value?.stage ?? null);
  // 응답 스키마의 .catch() 필드 때문에 잡 응답은 zod **입력** 타입으로 좁혀져 온다.
  // 이미 검증된 값을 같은 스키마로 한 번 더 통과시켜 출력 타입을 되찾는다(idempotent).
  const review = computed<MarketDevReviewType | null>(() => {
    const raw = jobData.value?.review ?? null;
    return raw === null ? null : MarketDevReview.parse(raw);
  });

  // 실행 요청 중이거나 잡이 running 이면 생성 중. 잡 조회가 아직 도착 전(요청 직후)에도
  // 생성 중으로 본다 — jobId 가 있는데 데이터가 없으면 폴링 첫 응답 대기다.
  const running = computed(
    () =>
      run.isPending.value ||
      (jobId.value !== null && (jobData.value === null || jobData.value.status === 'running')),
  );
  const failed = computed(
    () => startError.value !== '' || jobData.value?.status === 'error' || job.isError.value,
  );
  const errorText = computed<string>(() => {
    if (startError.value !== '') return startError.value;
    const serverError = jobData.value?.error;
    if (jobData.value?.status === 'error') {
      return serverError !== null && serverError !== undefined && serverError !== ''
        ? `검토서 생성에 실패했습니다 — ${serverError}`
        : '검토서 생성에 실패했습니다.';
    }
    if (job.isError.value) return '검토서를 불러오지 못했습니다. 다시 만들어 주세요.';
    return '';
  });

  // 경과 초 — 서버 elapsedSecs 는 5초 폴링 간격이라 표시가 툭툭 끊긴다. 화면 표시는
  // 로컬 1초 타이머로 부드럽게 보여주고, 완료된 잡은 서버 값을 그대로 쓴다.
  const elapsed = ref(0);
  let timer: ReturnType<typeof setInterval> | null = null;
  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  watch(running, (isRunning) => {
    if (isRunning) timer ??= setInterval(() => (elapsed.value += 1), 1000);
    else stopTimer();
  });
  onScopeDispose(stopTimer);

  const elapsedSecs = computed(() =>
    running.value ? elapsed.value : Math.round(jobData.value?.elapsedSecs ?? elapsed.value),
  );

  // 오래됨 — 생성 이후 원천이 바뀌었다. 표시만 바꾸는 게 아니라 포함 체크를 끈다.
  const stale = computed(
    () =>
      jobId.value !== null &&
      generatedSignature.value !== null &&
      generatedSignature.value !== sourceSignature.value,
  );
  watch(stale, (isStale) => {
    if (isStale) include.value = false;
  });

  // 등록 payload 에 실을 수 있는 상태(완료·최신).
  const includable = computed(() => review.value !== null && !stale.value && include.value);
  // 포함하기로 한 검토서가 생성 중이면 등록을 막는다(탈출구는 skip()).
  const blocking = computed(() => active.value && include.value && running.value);

  async function start(): Promise<void> {
    if (!active.value || run.isPending.value) return;
    const title = fields.title.trim();
    const description = fields.description.trim();
    if (title.length < 2 || description.length < 10) return;
    startError.value = '';
    elapsed.value = 0;
    const signatureAtStart = sourceSignature.value;
    try {
      const res = await run.mutateAsync({
        payload: {
          title,
          serviceAreas: [...fields.serviceAreas],
          description,
          answers: buildAnswers(),
        },
        files: attachments.value,
      });
      jobId.value = res.data.jobId;
      generatedSignature.value = signatureAtStart;
      include.value = true;
    } catch (err) {
      startError.value = errorMessage(err);
    }
  }

  // 검토 스텝 진입 시 1회 자동 시작 — 이미 잡이 있거나 실패 표시 중이면 건드리지 않는다.
  function ensure(): void {
    if (jobId.value === null && startError.value === '') void start();
  }

  // 다시 만들기 — 옛 잡을 버리고 현재 원천으로 새로 실행한다(재생성 1회, 루프 없음).
  function regenerate(): void {
    jobId.value = null;
    generatedSignature.value = null;
    startError.value = '';
    void start();
  }

  // 생성 대기 탈출구 — 검토서 없이 바로 등록.
  function skip(): void {
    include.value = false;
  }

  return {
    active,
    running,
    failed,
    errorText,
    stage,
    elapsedSecs,
    review,
    stale,
    include,
    includable,
    blocking,
    jobId,
    start,
    ensure,
    regenerate,
    skip,
  };
}

export type DevReviewJob = ReturnType<typeof useDevReviewJob>;
