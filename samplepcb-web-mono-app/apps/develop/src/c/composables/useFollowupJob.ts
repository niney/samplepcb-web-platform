import { computed, onScopeDispose, ref, watch } from 'vue';
import type { AiJobStageType } from '@sp/api-contract/develop-c';
import { useAiJob, useDevelopFollowupStatus, useRunDevelopFollowup } from '../api/useDevelopAi';
import { errorCode } from '../lib/error-msg';
import type { DevelopRequestForm } from './useRequestForm';

// AI 후속 질문 잡 오케스트레이션(docs/DEVELOP_FLOW.md §7.2.2) — 위저드 전용(수정 화면은 저장된 질문을 그대로 쓴다).
// 2→3스텝 전환에서 run(설명문 + 2스텝 첨부) → 폴링 → 질문. 질문은 폼(useRequestForm)이 받아 답을 든다.
//
// 다시 부르지 않는 규칙: 입력 키(제목 + 설명 + 첨부 name·size·lastModified)가 같으면 기존 잡으로 폴링만 한다.
// 스텝을 오가는 것만으로 모델을 다시 돌리면 고객이 같은 화면에서 두 번 기다리게 된다(서버도 같은 입력의
// 완료 잡을 1시간 재사용하므로 부담은 서버가 아니라 **대기 시간**이다).
//
// 폴백은 조용하다 — 꺼져 있거나(disabled) 실패·시간 초과(error·timeout)면 고정 3문항으로 돌아가고 안내 한 줄만 남긴다.
// 폴백 상태에서는 등록 payload 의 aiQuestions 가 null 이 된다(폼이 jobId 없음으로 판정).

const CLIENT_TIMEOUT_SECS = 300; // 5분 — 서버 타임아웃이 더 길더라도 고객을 여기 붙잡아 두지 않는다

export type FollowupFallbackType = '' | 'disabled' | 'error' | 'timeout';

export function useFollowupJob(form: DevelopRequestForm) {
  const { fields, attachments, isSystem, skipQuestions, appendAttachments, setAiFollowup, clearAiFollowup } = form;

  const statusQ = useDevelopFollowupStatus();
  const enabled = computed(() => statusQ.data.value?.data.enabled ?? false);
  const statusSettled = computed(() => statusQ.isSuccess.value || statusQ.isError.value);

  // AI 질문을 쓰는 자리인가 — 시스템개발이면서 맡김이 아닐 때만(개별 견적은 분야별 전문 질문이 따로 있다).
  const active = computed(() => isSystem.value && !skipQuestions.value);

  const fileKey = (f: File): string => `${f.name}:${String(f.size)}:${String(f.lastModified)}`;
  const inputKey = computed(() =>
    JSON.stringify({
      title: fields.title.trim(),
      description: fields.description.trim(),
      files: attachments.value.map(fileKey),
    }),
  );

  const jobId = ref<string | null>(null);
  const startedKey = ref<string | null>(null);
  const fallback = ref<FollowupFallbackType>('');
  // 3스텝에 한 번이라도 들어왔는가 — 상태 조회가 늦게 끝나도 그때 이어서 시작한다.
  const armed = ref(false);

  const run = useRunDevelopFollowup();
  const job = useAiJob(jobId);
  const jobData = computed(() => job.data.value?.data ?? null);
  const stage = computed<AiJobStageType | null>(() => jobData.value?.stage ?? null);

  const running = computed(
    () =>
      active.value &&
      fallback.value === '' &&
      (run.isPending.value || (jobId.value !== null && (jobData.value === null || jobData.value.status === 'running'))),
  );

  // 경과 초 — 로컬 1초 타이머(완료된 잡은 서버 값).
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
  const elapsedSecs = computed(() => (running.value ? elapsed.value : Math.round(jobData.value?.elapsedSecs ?? elapsed.value)));

  function toFallback(reason: Exclude<FollowupFallbackType, ''>): void {
    if (fallback.value !== '') return;
    fallback.value = reason;
    jobId.value = null; // 폴링 정지 — 잡은 서버에 남지만 이 화면은 더 기다리지 않는다
    clearAiFollowup();
  }

  async function start(key: string): Promise<void> {
    const title = fields.title.trim();
    const description = fields.description.trim();
    // 2스텝 게이트가 막지만(제목 2자·설명 10자) 계약 최소값을 여기서도 지킨다 — 400 을 받아 폴백으로 새지 않게.
    if (title.length < 2 || description.length < 10) return;
    fallback.value = '';
    jobId.value = null;
    clearAiFollowup();
    startedKey.value = key;
    elapsed.value = 0;
    try {
      const res = await run.mutateAsync({ payload: { title, description }, appendFiles: appendAttachments });
      jobId.value = res.data.jobId;
    } catch (err) {
      // 관리자가 방금 껐으면(409) "쓸 수 없음", 그 밖은 "읽지 못함" — 안내 문구가 달라진다.
      toFallback(errorCode(err) === 'USECASE_DISABLED' ? 'disabled' : 'error');
    }
  }

  function tryStart(): void {
    if (!armed.value || !active.value || run.isPending.value) return;
    if (!statusSettled.value) return; // 상태를 아직 모른다 — 조회가 끝나면 watch 가 다시 부른다
    if (!enabled.value) {
      toFallback('disabled');
      return;
    }
    if (startedKey.value === inputKey.value) return; // 같은 입력 — 기존 잡으로 폴링만(또는 이미 폴백)
    void start(inputKey.value);
  }

  // 3스텝 진입(또는 2스텝 "다음" 직후)에 부른다.
  function ensure(): void {
    armed.value = true;
    tryStart();
  }

  // 상태 조회가 늦게 끝났거나, 맡김을 껐다 켰거나, 2스텝으로 돌아가 입력을 고친 뒤 돌아온 경우.
  watch([statusSettled, active], () => {
    tryStart();
  });

  // 잡 결과 — done 이면 질문을 폼에 넘기고, error·404 면 조용히 폴백한다.
  watch(
    [jobData, () => job.isError.value],
    () => {
      if (jobId.value === null) return;
      if (job.isError.value) {
        toFallback('error');
        return;
      }
      const d = jobData.value;
      if (d === null) return;
      if (d.status === 'error') {
        toFallback('error');
        return;
      }
      if (d.status === 'done') {
        if (d.followup === null) {
          toFallback('error');
          return;
        }
        setAiFollowup(d.jobId, d.followup.understood, d.followup.questions);
      }
    },
    { immediate: true },
  );

  // 클라이언트 타임아웃 — 서버가 살아 있어도 5분이면 고정 질문으로 넘어간다.
  watch(elapsed, (secs) => {
    if (secs >= CLIENT_TIMEOUT_SECS && running.value) toFallback('timeout');
  });

  const stageLabel = computed(() => {
    if (stage.value === 'attachments') return '첨부 자료를 읽는 중…';
    if (stage.value === 'followup') return '견적에 필요한 질문을 고르는 중…';
    return '준비 중…';
  });

  const fallbackNotice = computed(() => {
    if (fallback.value === 'disabled') return '지금은 AI 질문을 쓸 수 없어 기본 질문을 드립니다.';
    if (fallback.value === '') return '';
    return '자료를 읽지 못해 기본 질문을 드립니다.';
  });

  // 기다리지 않고 전문가에게 맡김으로 — 3스텝 진행 패널의 탈출구.
  function delegateInstead(): void {
    fields.expertDelegate = true;
  }

  return {
    active,
    enabled,
    running,
    stage,
    stageLabel,
    elapsedSecs,
    fallback,
    fallbackNotice,
    ensure,
    delegateInstead,
  };
}

export type FollowupJob = ReturnType<typeof useFollowupJob>;
