import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbEqAiAnalyzeResponse,
  AdminPcbEqFigureUploadResponse,
  AdminPcbEqReviewListResponse,
  AdminPcbEqReviewResponse,
  apiRoutes,
  type AdminPcbEqDraftCreateBodyType,
  type AdminPcbEqDraftUpdateBodyType,
  type AdminPcbEqProxyAnswerBodyType,
  type AdminPcbEqReviewListResponseType,
  type AdminPcbEqReviewViewType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';

// EQ 문항형 회차(D20) 관리자 훅 — docs/PCB_PARTNER_TRACK.md D20. 목록 캐시는 문구형 패널(EqReviewPanel)의
// useAdminPcbEqReviews 와 **같은 키**(['admin','pcbEqReview', poId])라 한쪽에서 바꾸면 다른 쪽도 맞는다.
// 변경 응답은 그 회차의 최신 뷰 하나 — 목록 캐시에 끼워 넣고, 행 요약(칩)은 발주 목록이 들고 있어
// ['admin','pcbPo'] 를 무효화한다.

type QueryClient = ReturnType<typeof useQueryClient>;

const listKey = (poId: number | null) => ['admin', 'pcbEqReview', poId] as const;
const reviewsPath = (poId: number): string => `${apiRoutes.adminPcbEqReviews}/${String(poId)}`;
const reviewPath = (poId: number, reviewId: number): string => `${reviewsPath(poId)}/${String(reviewId)}`;
/** 그림 열람 경로 — Bearer 가 필요해 `<img src>` 로 못 쓴다(useEqFigureUrls 가 blob 으로 받는다). */
export const eqFigurePath = (poId: number, reviewId: number, fileId: number): string =>
  `${reviewPath(poId, reviewId)}/figures/${String(fileId)}`;

/** AI 분석 중일 때 목록을 다시 읽는 간격 — 분석은 10~20초쯤 걸린다(프로빙 p50 11.6초). */
const AI_POLL_MS = 4_500;

/**
 * 발주서의 회차 목록 + 이번 승인요청의 AI 분석 상태(`ai`·`aiEnabled`, D20 P2).
 * `poll` 이 참이고 분석이 도는 중(ai.status='running')이면 끝날 때까지 다시 읽는다 — 끝나면 저절로 멈춘다.
 * 패널이 닫혀 있으면 부르는 쪽이 poll 을 꺼서 폴링하지 않는다(행 칩은 Case 가 따로 본다).
 */
export function useAdminPcbEqRounds(poId: Ref<number | null>, enabled: Ref<boolean>, poll: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => listKey(poId.value)),
    queryFn: () => apiGet(reviewsPath(poId.value ?? 0), AdminPcbEqReviewListResponse),
    enabled: computed(() => enabled.value && poId.value !== null),
    // poll 을 옵션 안에서 읽지 않고 옵션 자체를 바꾼다 — 함수만 넘기면 다음 조회가 끝나야 다시 계산돼, 패널을 닫은
    // 뒤에도 이미 걸린 타이머가 한 번 더 돈다.
    refetchInterval: computed(() =>
      poll.value
        ? (query: { state: { data?: AdminPcbEqReviewListResponseType | undefined } }) =>
            query.state.data?.data.ai?.status === 'running' ? AI_POLL_MS : false
        : false,
    ),
  });
}

/** 회차 하나를 목록 캐시에 반영 — 있으면 갈아 끼우고, 없으면(새 초안) 맨 앞에(목록은 최신 먼저). */
function putReview(qc: QueryClient, review: AdminPcbEqReviewViewType): void {
  qc.setQueryData<AdminPcbEqReviewListResponseType>(listKey(review.poId), (old) => {
    if (old === undefined) return old;
    const rest = old.data.reviews.filter((r) => r.id !== review.id);
    const reviews = [...rest, review].sort((a, b) => b.id - a.id);
    return { ...old, data: { ...old.data, reviews } };
  });
}

const refreshRows = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
};

export function useEqRoundMutations() {
  const qc = useQueryClient();
  const onReview = (res: { data: { review: AdminPcbEqReviewViewType } }): void => {
    putReview(qc, res.data.review);
    refreshRows(qc);
  };

  const createDraft = useMutation({
    mutationFn: ({ poId, body }: { poId: number; body: AdminPcbEqDraftCreateBodyType }) =>
      apiSend('POST', `${reviewsPath(poId)}/drafts`, body, AdminPcbEqReviewResponse),
    onSuccess: onReview,
  });

  const saveDraft = useMutation({
    mutationFn: ({ poId, reviewId, body }: { poId: number; reviewId: number; body: AdminPcbEqDraftUpdateBodyType }) =>
      apiSend('PUT', `${reviewPath(poId, reviewId)}/draft`, body, AdminPcbEqReviewResponse),
    onSuccess: onReview,
  });

  // 그림 올리기·지우기는 버전을 올리지 않는다(서버 규칙) — 문항에 붙이는 것은 저장의 몫이다. 올린 그림은 서버에서
  // 아직 '붙지 않은 그림'(looseFigures)이라 캐시에도 그렇게 더한다: 화면의 붙지 않은 그림 줄이 캐시(서버가 아는
  // 그림) − 편집 버퍼(문항에 붙인 그림)로 계산되므로, 캐시가 올린 그림을 모르면 문항을 지웠을 때 그림이 화면에서 사라진다.
  const uploadFigure = useMutation({
    mutationFn: ({ poId, reviewId, file }: { poId: number; reviewId: number; file: File }) => {
      const form = new FormData();
      form.set('file', file);
      return apiSendForm('POST', `${reviewPath(poId, reviewId)}/figures`, form, AdminPcbEqFigureUploadResponse);
    },
    onSuccess: (res, vars) => {
      qc.setQueryData<AdminPcbEqReviewListResponseType>(listKey(vars.poId), (old) => {
        if (old === undefined) return old;
        const reviews = old.data.reviews.map((r) =>
          r.id === vars.reviewId ? { ...r, looseFigures: [...r.looseFigures, res.data.figure] } : r,
        );
        return { ...old, data: { ...old.data, reviews } };
      });
    },
  });

  // 지우기 응답은 그 회차의 최신 뷰(문항 그림·붙지 않은 그림에서 모두 빠진 판) — 행 요약은 안 바뀌어 캐시만 갈아 끼운다.
  const deleteFigure = useMutation({
    mutationFn: ({ poId, reviewId, fileId }: { poId: number; reviewId: number; fileId: number }) =>
      apiSend('DELETE', eqFigurePath(poId, reviewId, fileId), undefined, AdminPcbEqReviewResponse),
    onSuccess: (res) => {
      putReview(qc, res.data.review);
    },
  });

  const send = useMutation({
    mutationFn: ({ poId, reviewId, expectedVersion }: { poId: number; reviewId: number; expectedVersion: number }) =>
      apiSend('POST', `${reviewPath(poId, reviewId)}/send`, { expectedVersion }, AdminPcbEqReviewResponse),
    onSuccess: onReview,
  });

  const proxyAnswer = useMutation({
    mutationFn: ({ poId, reviewId, body }: { poId: number; reviewId: number; body: AdminPcbEqProxyAnswerBodyType }) =>
      apiSend('POST', `${reviewPath(poId, reviewId)}/answer`, body, AdminPcbEqReviewResponse),
    onSuccess: onReview,
  });

  const forward = useMutation({
    mutationFn: ({ poId, reviewId, expectedVersion }: { poId: number; reviewId: number; expectedVersion: number }) =>
      apiSend('POST', `${reviewPath(poId, reviewId)}/forward`, { expectedVersion }, AdminPcbEqReviewResponse),
    onSuccess: onReview,
  });

  /** 초안 삭제·요청 취소 — 같은 라우트(작성 중·회신 대기만). 응답은 발주서의 회차 목록 전체. */
  const cancel = useMutation({
    mutationFn: ({ poId, reviewId }: { poId: number; reviewId: number }) =>
      apiSend('DELETE', reviewPath(poId, reviewId), undefined, AdminPcbEqReviewListResponse),
    onSuccess: (res, vars) => {
      qc.setQueryData<AdminPcbEqReviewListResponseType>(listKey(vars.poId), res);
      refreshRows(qc);
    },
  });

  /**
   * [AI 분석]·[AI 다시 분석]·[AI 결과를 초안에 적용](D20 P2) — 202 로 잡 상태만 돌아온다(분석은 뒤에서 돈다).
   * 캐시의 `ai` 를 갈아 끼우면 목록 폴링(useAdminPcbEqRounds)이 이어받고, 행 칩(AI 분석 중)은 발주 목록이 다시 읽는다.
   * 같은 파일·같은 설정의 최근 결과가 있으면 서버가 바로 적용하고 done 을 주므로 그때는 목록도 다시 읽는다.
   */
  const aiAnalyze = useMutation({
    mutationFn: ({ poId, replaceDraft }: { poId: number; replaceDraft: boolean }) =>
      apiSend('POST', `${reviewsPath(poId)}/ai-analyze`, { replaceDraft }, AdminPcbEqAiAnalyzeResponse),
    onSuccess: (res, vars) => {
      qc.setQueryData<AdminPcbEqReviewListResponseType>(listKey(vars.poId), (old) =>
        old === undefined ? old : { ...old, data: { ...old.data, ai: res.data.ai } },
      );
      if (res.data.ai.status !== 'running') void qc.invalidateQueries({ queryKey: listKey(vars.poId) });
      refreshRows(qc);
    },
  });

  return { createDraft, saveDraft, uploadFigure, deleteFigure, send, proxyAnswer, forward, cancel, aiAnalyze };
}

/**
 * 문항 그림 미리보기 — 인증 fetch → blob → objectURL. 같은 그림을 여러 칸(편집·미리보기·확대)이 쓰므로
 * fileId 로 한 번만 받는다. 쓰는 쪽이 사라질 때 revokeAll 로 비운다(패널은 Case 화면 수명 동안 산다).
 */
export function createEqFigureUrls() {
  const urls = new Map<number, Promise<string>>();
  const get = (poId: number, reviewId: number, fileId: number): Promise<string> => {
    const cached = urls.get(fileId);
    if (cached !== undefined) return cached;
    const pending = apiGetBlob(eqFigurePath(poId, reviewId, fileId)).then((blob) => URL.createObjectURL(blob));
    // 실패하면 캐시에서 빼서 다음에 다시 받게 한다(일시 오류가 영구 빈칸이 되지 않게).
    void pending.catch(() => urls.delete(fileId));
    urls.set(fileId, pending);
    return pending;
  };
  const revokeAll = (): void => {
    for (const pending of urls.values()) {
      void pending.then((url) => {
        URL.revokeObjectURL(url);
      }, () => undefined);
    }
    urls.clear();
  };
  return { get, revokeAll };
}

export type EqFigureUrls = ReturnType<typeof createEqFigureUrls>;
