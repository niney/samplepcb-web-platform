<script setup lang="ts">
import { usePartnerI18n } from '../../partner/i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError, actAsPartnerId } from '@sp/shared';
import {
  PCB_SHIPMENT_FILE_LABELS,
  PCB_EQ_FORWARD,
  PCB_EQ_REOPEN,
  PCB_EQ_REVERT,
  PCB_PO_FULFILLMENT_MODE_LABELS,
  PCB_PO_STATUSES,
  PCB_PO_STATUS_LABELS,
  PCB_RFQ_STATUS_LABELS,
  PCB_STENCIL_SUBMIT_BLOCKER_MESSAGES,
  PcbEqReopenBody,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  bomShipmentStatusesOf,
  canReopenPcbEq,
  pcbEqCommentTranslated,
  pcbEqReplyFileName,
  isPcbEqRejectionEvent,
  lastPcbEqReworkBoundary,
  pcbEqForwardLabel,
  pcbEqRevertLabel,
  pcbStencilSubmitBlockers,
  type PcbEqFileTypeType,
} from '@sp/api-contract';
import {
  downloadPartnerPcbEqFile,
  downloadPartnerPcbEqReply,
  downloadPartnerPcbPoSpecFile,
  downloadPartnerPcbShipmentFile,
  useCreatePartnerChildPcbPo,
  useDeletePartnerPcbEqFile,
  usePartnerPcbEqReopen,
  usePartnerPcbEqRequest,
  usePartnerPcbEqRevert,
  usePartnerPcbPoDetail,
  usePartnerPcbProductionComplete,
  usePartnerPcbProductionStart,
  usePartnerPcbShipmentAdvance,
  usePartnerPcbShipmentReceive,
  useUploadPartnerPcbEqFile,
} from '../../partner/usePartnerPcbPos';
import { pcbCategoryBadge } from '../../lib/pcb-category';
import { pcbSpecEntries, pcbSpecFormFields } from '../../lib/pcb-spec';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerPcbEqAnswers from '../../components/partner/PartnerPcbEqAnswers.vue';
import PcbEqTimeline from '../../components/pcb/PcbEqTimeline.vue';
import UiPromptModal from '../../components/ui/UiPromptModal.vue';
import { confirmDialog } from '../../lib/confirmDialog';
import { formatBytes } from '../../lib/format';
import { formatPartnerDateTime } from '../../partner/i18n-core';

const { pt, pm, locale, pd, pn } = usePartnerI18n();
const dateOnly = pd;
const fmtPcbAmount = (currency: string, value: number | null): string =>
  value === null ? '—' : pm(value, currency);
const pcbMoneyWithSub = (currency: string, value: number | null, subCurrency: string | null, subValue: number | null): string => {
  const main = fmtPcbAmount(currency, value);
  return value !== null && subCurrency !== null && subValue !== null
    ? `${main} (${fmtPcbAmount(subCurrency, subValue)})` : main;
};


// PCB 발주서 상세(협력사 포털, P2) — EQ 5단계 진행: 발주접수(EQ 선택·Working 권장)
// → EQ 승인요청 → (관리자 승인) → 생산 시작 → 생산 완료. 되돌리기는 직전 전이 주체만.
// MD 는 하위 발주(childRfqs 기반)로 트랙을 열고, 하위 수주자 대신 fallback 진행도 가능.

const route = useRoute();
const poId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const detailQuery = usePartnerPcbPoDetail(poId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
// A/S 회차 역링크(재점검 #16) — 같은 사양의 다른 회차 발주(내가 볼 수 있는 것만).
const asRounds = computed(() => detail.value?.asRounds ?? []);

const actionError = ref('');
const surfaceError = (e: unknown, fallback: string): void => {
  actionError.value = locale.value === 'ko' && e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

// ── 수금 상태(P3.11) — 부분 송금이 있으므로 '완료/대기' 두 값으로는 부족하다 ─────
const remitSummary = computed(() => detail.value?.remittanceSummary ?? null);
const remitStatusText = computed<string>(() => {
  const s = remitSummary.value;
  if (s === null || s.count === 0) return pt('입금 전');
  if (s.balance <= 0) return pt('완료 ({value1})', { value1: dateOnly(s.lastRemittedOn) });
  return pt('부분 입금 — 미수 {value1}', { value1: fmtPcbAmount(s.currency, s.balance) });
});
const remitStatusCls = computed<string>(() => {
  const s = remitSummary.value;
  if (s === null || s.count === 0) return 'text-gray-400';
  return s.balance <= 0 ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700';
});

// ── EQ 스텝퍼·액션 파생(계약 사전이 단일 정본) ───────────────────────────────
const steps = PCB_PO_STATUSES;
const stepIndex = computed(() =>
  detail.value === null ? -1 : steps.indexOf(detail.value.status),
);
const forward = computed(() =>
  detail.value === null ? null : PCB_EQ_FORWARD[detail.value.status],
);
const revert = computed(() =>
  detail.value === null ? null : PCB_EQ_REVERT[detail.value.status],
);
const canForward = computed(
  () =>
    detail.value !== null &&
    detail.value.eq.myRole === 'RECEIVER' &&
    forward.value !== null &&
    forward.value.actor === 'RECEIVER' &&
    detail.value.eq.delegatePoId === null &&
    !detail.value.eq.blocked,
);
const canRevert = computed(
  () =>
    detail.value !== null &&
    detail.value.eq.myRole === 'RECEIVER' &&
    revert.value !== null &&
    revert.value.actor === 'RECEIVER' &&
    detail.value.eq.delegatePoId === null &&
    !detail.value.eq.blocked,
);
const hasWorkingFile = computed(
  () => detail.value?.eq.files.some((f) => f.fileType === 'working') ?? false,
);
const filesEditable = computed(() => detail.value?.status === 'issued');

// ── 올린 파일(EQ 트랙) — 업로드 버튼 바로 아래에서 결과를 보인다(2026-10-11 사용자 지적) ──
// 올린 파일은 타임라인 말풍선으로 나타나는데, 추가 EQ 요청으로 돌아온 화면에서는 그 사이에 '고객 회신'이
// 화면 한두 장을 차지해 버튼을 누른 자리에서 결과가 안 보였다. 여기 목록은 **지금 손댈 수 있는 파일**이다:
// 기록으로 굳은 파일(locked — 승인됐거나 고객 확인에 쓰인 것)은 빼고 건수만 알린다. 타임라인은 그대로 둔다(시간순 기록).
// 2026-10-11 재편(사용자 지적) — 같은 파일이 타임라인 말풍선과 이 목록 양쪽에 나오던 것을 가른다:
//  · 올린 파일 = **아직 승인요청 전**(발주가 발주접수로 (되)돌아온 뒤에 올린 것). 여기서만 보이고 여기서 지운다.
//  · 타임라인 = **요청에 실려 나간 것**(기록). 승인요청을 누르면 목록의 파일이 요청 말풍선과 함께 넘어간다.
// 가름은 목록이 실제로 그려질 때만 한다 — 목록이 없는 화면(차례 아님·스텐실)에서 타임라인까지 비우면 파일이 사라진다.
const showUploadList = computed(
  () => !isStencil.value && filesEditable.value && detail.value?.eq.myRole === 'RECEIVER',
);
/** 발주가 발주접수로 돌아온 마지막 시각(반려·요청 취소·추가 EQ 요청) — 없으면 한 번도 요청한 적이 없다. */
const pendingSince = computed<string | null>(() => {
  const history = detail.value?.eq.history ?? [];
  return history.filter((e) => e.toStatus === 'issued' && e.at !== '').at(-1)?.at ?? null;
});
const pendingFiles = computed(() => {
  if (!showUploadList.value) return [];
  const since = pendingSince.value;
  return (detail.value?.eq.files ?? []).filter(
    (f) => (f.fileType === 'eq' || f.fileType === 'working') && !f.locked && (since === null || f.uploadedAt > since),
  );
});
const timelineFiles = computed(() => {
  const pending = new Set(pendingFiles.value.map((f) => f.fileId));
  return (detail.value?.eq.files ?? []).filter((f) => !pending.has(f.fileId));
});

// 지울 수 있는 올린 사람 — 내 발주서(수주)면 협력사 자리에서 올라온 것 전부(본인·관리자 대행·MD 대행)다.
// 전에는 '내 역할이 올린 것'만 지울 수 있어, **관리자 대리 접속**으로 올린 파일(uploadedBy=ADMIN)은 올린 사람도
// 못 지웠다(서버는 허용 — 화면만 막았다). MD 가 하위 발주서를 볼 때는 자기 대행분만(하위 협력사가 올린 것은
// 받은 자료다), 대리 접속 중이면 그 자리에서 올린 ADMIN 분까지.
const deletableRoles = computed<readonly string[]>(() =>
  detail.value?.direction === 'issued'
    ? actAsPartnerId.value !== null
      ? ['MASTER_DEALER', 'ADMIN']
      : ['MASTER_DEALER']
    : ['PARTNER', 'ADMIN', 'MASTER_DEALER'],
);
const canDeleteFile = (f: { uploadedBy: string | null }): boolean => deletableRoles.value.includes(f.uploadedBy ?? 'PARTNER');
const lockedFileCount = computed(
  () => (detail.value?.eq.files ?? []).filter((f) => (f.fileType === 'eq' || f.fileType === 'working') && f.locked).length,
);
const workingSetCount = (fileType: 'eq' | 'working'): number =>
  pendingFiles.value.filter((f) => f.fileType === fileType).length;
const uploadCountSuffix = (fileType: 'eq' | 'working'): string => {
  const n = workingSetCount(fileType);
  return n > 0 ? ` (${pn(n)})` : '';
};
const uploadKindLabel = (fileType: PcbEqFileTypeType): string => (fileType === 'working' ? pt('Working 데이터') : pt('EQ 질의서'));

// 방금 올린 줄을 잠깐 강조한다 — "올라갔다"를 누른 자리에서 알게.
const freshFileIds = ref<ReadonlySet<number>>(new Set<number>());
let freshBaseline: Set<number> | null = null;
let freshTimer: ReturnType<typeof setTimeout> | null = null;
function armFreshBaseline(): void {
  freshBaseline = new Set((detail.value?.eq.files ?? []).map((f) => f.fileId));
}
watch(
  () => detail.value?.eq.files,
  (files) => {
    const baseline = freshBaseline;
    if (baseline === null || files === undefined) return;
    const fresh = files.filter((f) => !baseline.has(f.fileId)).map((f) => f.fileId);
    if (fresh.length === 0) return;
    for (const id of fresh) baseline.add(id);
    freshFileIds.value = new Set([...freshFileIds.value, ...fresh]);
    if (freshTimer !== null) clearTimeout(freshTimer);
    freshTimer = setTimeout(() => {
      freshFileIds.value = new Set<number>();
      freshBaseline = null;
      freshTimer = null;
    }, 6000);
  },
);
onBeforeUnmount(() => {
  if (freshTimer !== null) clearTimeout(freshTimer);
});

// ── 스텐실(메탈마스크) 트랙 ─────────────────────────────────────────────────
// EQ 질의 왕복이 없는 대신 **고객문의사항 + 좌표파일**을 내고 관리자가 확인한다.
// 트랙 판정은 서버가 실어 보낸 값을 읽기만 한다(카테고리 비교를 화면에 복제하지 않는다).
const track = computed(() => detail.value?.track ?? 'eq');
const isStencil = computed(() => track.value === 'stencil');

/** 고객문의사항(선택) — 제출 시 eqHistory 에 실린다(제출 뒤엔 못 고친다: 첨부와 같은 잠금). */
const noteDraft = ref('');
const coordFiles = computed(
  () => detail.value?.eq.files.filter((f) => f.fileType === 'coord') ?? [],
);
/** 문의 사진(선택·누적) — 문의사항이 말로 다 못 하는 "이 부분이요"를 사진이 잇는다. */
const inquiryFiles = computed(
  () => detail.value?.eq.files.filter((f) => f.fileType === 'inquiry') ?? [],
);
/** 제출을 막는 것들 — 서버 게이트와 **같은 계약 함수**를 쓴다(문구도 계약이 정본).
 *  필수는 좌표파일 하나 — 고객문의사항은 선택이다(2026-08-17 필수 해제). */
const submitBlockers = computed(() =>
  isStencil.value && detail.value?.status === 'issued'
    ? pcbStencilSubmitBlockers(detail.value.eq.files)
    : [],
);

const forwardLabel = computed(() =>
  detail.value === null ? '' : pt(pcbEqForwardLabel(detail.value.status, track.value)),
);
const revertLabel = computed(() =>
  detail.value === null ? '' : pt(pcbEqRevertLabel(detail.value.status, track.value)),
);

/** 타임라인의 파일 클릭 — poId 좁히기를 템플릿에 두지 않는다(콜백 안에서는 안 좁혀진다). */
const downloadEq = (fileId: number, name: string): void => {
  if (poId.value === null) return;
  void downloadPartnerPcbEqFile(poId.value, fileId, name);
};

// ── 고객 회신(D20) — 관리자가 전달한 문항형 회차만 온다(최신 먼저, 위임 상위는 하위의 회차).
const eqRounds = computed(() => detail.value?.eqRounds ?? []);
// 최신 전달 회차가 **이번 승인요청에 대한 답**인가 — 마지막 승인요청(issued → eq_requested) 뒤에
// 전달됐으면 그렇다. 이전 요청의 답(반려·취소 전에 전달된 것)을 "방금 도착"으로 말하면
// 협력사가 이미 반영한 답을 또 반영하려 든다. 승인요청 이력이 없으면(이관분) 지금 것으로
// 본다 — 답이 보이는데 안내가 침묵하는 쪽이 더 나쁘다.
// ⚠ 기준은 **승인요청 전이**다. '승인 취소'(eq_done → eq_requested)도 같은 상태로 들어오지만 새
//   요청이 아니라서, 그걸 기준으로 삼으면 승인 때 자동 전달된 답이 취소 한 번에 "이전 것"이 된다.
const answerForThisRequest = computed<boolean>(() => {
  const d = detail.value;
  const latest = eqRounds.value[0];
  if (d === null || latest === undefined) return false;
  const requestedAt = d.eq.history
    .filter((e) => e.fromStatus === 'issued' && e.toStatus === 'eq_requested')
    .at(-1)?.at;
  return requestedAt === undefined || Date.parse(latest.forwardedAt) >= Date.parse(requestedAt);
});
/** 승인 대기 중에 회신이 먼저 전달됐다(관리자의 수동 전달) — 읽고 기다리거나 요청을 물린다. */
const answerArrived = computed<boolean>(
  () => detail.value?.status === 'eq_requested' && answerForThisRequest.value,
);
// 고객 회신 카드는 EQ 카드 **아래**에 따로 있다 — 읽어야 하는 단계면 '지금 할 일'이 요약 한 줄과 [회신 보기]로 가리킨다.
// (.vue 타입을 ref 주석에 물리면 ESLint 가 error type 으로 읽는다 — 쓰는 모양만 적는다.)
const answersCard = ref<{ reveal: () => Promise<void> } | null>(null);
// 고객 회신서 엑셀(D20 P3) — 회차는 EQ 가 실제로 도는 발주서의 것이라(위임 상위는 하위의 회차) 파일 이름의 발주번호도
// 그 발주서다. 서버가 같은 규칙(계약 pcbEqReplyFileName)으로 이름을 붙인다.
const downloadEqReply = async (round: { reviewId: number; roundNo: number }): Promise<void> => {
  const d = detail.value;
  if (d === null || poId.value === null) return;
  actionError.value = '';
  try {
    await downloadPartnerPcbEqReply(
      poId.value,
      round.reviewId,
      locale.value,
      pcbEqReplyFileName({
        projectName: d.spec.projectName,
        poId: d.eq.delegatePoId ?? poId.value,
        roundNo: round.roundNo,
        locale: locale.value,
      }),
    );
  } catch (e) {
    surfaceError(e, pt('회신서를 내려받지 못했습니다.'));
  }
};
const answerSummary = computed(() =>
  (eqRounds.value[0]?.items ?? []).map((item, i) => ({ no: item.factoryNo ?? String(i + 1), key: item.answer?.key ?? '—' })),
);
/** 승인됐고 회신이 와 있다(승인이 자동 전달한다, D20 후속 R-1) — 읽고 생산하거나 다시 묻는다. */
const answerToReview = computed<boolean>(
  () => detail.value?.status === 'eq_done' && answerForThisRequest.value,
);

// ── 추가 EQ 요청(D20 후속 R-2) — 승인 뒤 협력사가 사유와 함께 EQ 를 다시 연다(eq_done → issued).
// 보이는 조건은 [생산 시작]과 같다(같은 주체의 같은 순간의 갈림길) + 계약의 상태·트랙 문턱.
// 스텐실은 계약이 막는다(확인 완료 뒤 좌표파일은 바뀌지 않는다는 약속).
const reopenLabel = computed(() => pt(PCB_EQ_REOPEN.label));
const canReopen = computed(
  () => canForward.value && detail.value !== null && canReopenPcbEq(detail.value.status, track.value),
);

// '지금 할 일' — 타임라인 마지막 칸이 할 말. 상태마다 **한 문장으로 못박는다**(무엇을 봐야
// 하고 무엇을 해야 하는지를 협력사가 조립하지 않게). 반려 뒤 구간은 보완 여부까지 말한다 —
// 같은 파일로 다시 요청하면 같은 사유로 되돌아온다.
const nowTodo = computed<{ title: string; hint: string }>(() => {
  const d = detail.value;
  if (d === null) return { title: '', hint: '' };
  if (d.eq.myRole !== 'RECEIVER') {
    return {
      title: pt('진행 상황을 확인해 주세요.'),
      hint: pt('이 발주의 {value1} 진행은 수주 조직이 합니다.', { value1: isStencil.value ? pt('확인·생산') : 'EQ' }),
    };
  }
  // MD 관전(하위 발주 열람) — 같은 fallback RECEIVER 라도 주어가 다르다. 협력사 문구를
  // 그대로 내면 "내가 올려야 하나?"로 읽힌다(실주행 확정). 기본은 하위가 진행, 대행은 보조.
  if (d.direction === 'issued') {
    // 2026-08-28 @sp/shared apiGet 이 출력 타입(default 적용 후)을 주므로 빈값 통일이 불필요해졌다.
    const counterparty = d.counterpartyName;
    const sub = counterparty === '' ? pt('하위 협력사') : pt('하위 협력사({value1})', { value1: counterparty });
    // 트랙별 어휘 — 스텐실에는 EQ 왕복이 없어 'EQ 승인'이라는 말 자체가 뜻이 안 통한다.
    const st = isStencil.value;
    const askWord = st ? pt('확인 요청') : pt('승인요청');
    const doneWord = st ? pt('확인이 끝났습니다') : pt('EQ가 승인됐습니다');
    // 추가 EQ 요청으로 돌아온 건 — 반려가 아니다(하위 또는 MD 대행이 스스로 다시 열었다).
    if (eqReopen.value !== null) {
      return {
        title: pt('추가 EQ 요청 건입니다 — {value1}가 수정한 EQ를 올리고 다시 승인요청해야 합니다.', { value1: sub }),
        hint: pt('보완이 늦어지면 아래 버튼으로 MD가 파일을 올리고 대행 진행할 수도 있습니다.'),
      };
    }
    if (d.status === 'issued') {
      return eqRejection.value !== null
        ? {
            title: pt('{value1} 건입니다 — {value2}가 보완 후 다시 {value3}해야 합니다.', { value1: st ? pt('보완 요청을 받은') : pt('반려된'), value2: sub, value3: askWord }),
            hint: pt('보완이 늦어지면 아래 버튼으로 MD가 파일을 올리고 대행 진행할 수도 있습니다.'),
          }
        : {
            title: pt('{value1}가 {value2}을 올리고 {value3}할 차례입니다.', { value1: sub, value2: st ? pt('좌표파일') : pt('EQ 자료'), value3: askWord }),
            hint: pt('필요하면 MD가 파일 업로드·{value1}을 대행할 수 있습니다.', { value1: askWord }),
          };
    }
    if (d.status === 'eq_requested' && !st && answerArrived.value) {
      return {
        title: pt('고객 회신이 도착했습니다 — 아래 \'고객 회신\'에서 문항별 선택을 확인해 주세요.'),
        hint: pt('{value1}가 회신대로 생산할 수 있으면 관리자의 EQ 승인을 기다립니다. EQ를 고쳐야 하면 [{value2}] 후 수정한 EQ를 올려 다시 승인요청합니다(필요하면 MD 대행).', { value1: sub, value2: revertLabel.value }),
      };
    }
    if (d.status === 'eq_requested')
      return { title: st ? pt('샘플피씨비 관리자의 확인을 기다리고 있습니다.') : pt('샘플피씨비 관리자의 EQ 승인을 기다리고 있습니다.'), hint: '' };
    if (d.status === 'eq_done' && canReopen.value) {
      // 승인 뒤의 갈림길(생산 시작 | 추가 EQ 요청)은 하위의 몫이고, MD 는 둘 다 대행할 수 있다.
      return {
        title: answerToReview.value
          ? pt('EQ가 승인됐고 고객 회신이 전달됐습니다 — {value1}가 회신대로 생산을 시작하거나 추가 EQ를 요청합니다.', { value1: sub })
          : pt('{value1} — {value2}가 생산을 시작합니다.', { value1: doneWord, value2: sub }),
        hint: pt('필요하면 MD 대행으로 [{value1}] 또는 [{value2}]을 진행할 수 있습니다.', { value1: forwardLabel.value, value2: reopenLabel.value }),
      };
    }
    if (d.status === 'eq_done')
      return { title: pt('{value1} — {value2}가 생산을 시작합니다.', { value1: doneWord, value2: sub }), hint: pt('필요하면 MD 대행으로 진행할 수 있습니다.') };
    if (d.status === 'producing')
      return { title: pt('{value1}가 생산 중입니다.', { value1: sub }), hint: pt('완료 처리가 늦어지면 MD 대행으로 [생산 완료]를 누를 수 있습니다.') };
    return { title: pt('생산이 끝났습니다 — {value1}가 발송을 시작합니다.', { value1: sub }), hint: pt('물건이 도착하면 아래 발송 카드에서 [입고 확인]을 해주세요.') };
  }
  // 스텐실 트랙 — EQ 왕복이 없다. 낼 것이 정해져 있으므로 문구도 그것만 말한다.
  if (isStencil.value) {
    if (d.status === 'issued') {
      return eqRejection.value !== null
        ? {
            title: pt('보완 요청을 받은 건입니다 — 고쳐서 다시 확인 요청해 주세요.'),
            hint: hasFixAfterReject.value
              ? pt('보완 요청 후 새 파일을 올렸습니다 — 확인 요청을 진행해 주세요.')
              : pt('아직 보완 요청 후 새로 올린 파일이 없습니다. 같은 파일로 다시 요청하면 같은 사유로 되돌아올 수 있습니다.'),
          }
        : {
            title: pt('좌표파일을 올린 뒤 확인 요청해 주세요.'),
            hint: pt('고객에게 확인할 사항이 있으면 고객문의사항과 사진을 함께 남길 수 있습니다(선택). 좌표파일은 확인이 끝난 뒤 고객도 주문내역에서 내려받을 수 있으며, 확인 요청 후에는 파일과 문의사항을 바꿀 수 없습니다.'),
          };
    }
    if (d.status === 'eq_requested') {
      return {
        title: pt('샘플피씨비 관리자의 확인을 기다리고 있습니다.'),
        hint: pt('확인 요청 중에는 첨부·문의사항을 바꿀 수 없습니다 — 바꾸려면 요청을 취소한 뒤 올려 주세요.'),
      };
    }
    if (d.status === 'eq_done') return { title: pt('확인이 끝났습니다 — 생산을 시작해 주세요.'), hint: '' };
    if (d.status === 'producing')
      return { title: pt('생산 중입니다 — 끝나면 [생산 완료]를 눌러 주세요.'), hint: '' };
    return { title: pt('생산이 끝났습니다 — 발송을 시작해 주세요.'), hint: '' };
  }
  // 내가 추가 EQ 를 요청해 돌아온 건 — 반려 문구가 뜨면 안 된다(아무도 반려하지 않았다).
  // 지금 올라 있는 EQ 는 이미 승인된 판이라, 새 파일 없이 다시 요청하면 같은 것을 또 묻게 된다.
  if (eqReopen.value !== null) {
    return {
      title: pt('추가 EQ를 준비 중입니다 — 수정한 EQ를 올리고 다시 승인요청해 주세요.'),
      hint: hasFileAfterReopen.value
        ? pt('추가 EQ 요청 후 새 파일을 올렸습니다 — 승인요청을 진행해 주세요.')
        : pt('아직 추가 EQ 요청 후 새로 올린 파일이 없습니다 — 지금 올라 있는 EQ는 이미 승인된 것입니다.'),
    };
  }
  if (d.status === 'issued') {
    return eqRejection.value !== null
      ? {
          title: pt('반려된 건입니다 — 보완 파일을 올리고 다시 승인요청해 주세요.'),
          hint: hasFixAfterReject.value
            ? pt('반려 후 새 파일을 올렸습니다 — 승인요청을 진행해 주세요.')
            : pt('아직 반려 후 새로 올린 파일이 없습니다. 같은 파일로 다시 요청하면 같은 사유로 반려될 수 있습니다.'),
        }
      : {
          title: pt('EQ 질의서·Working 데이터를 올리고 승인요청해 주세요.'),
          hint: hasWorkingFile.value
            ? ''
            : pt('Working 파일은 생산에 쓰는 자료입니다 — 승인요청 후에는 추가·교체할 수 없으니 지금 올리시길 권합니다(없이도 요청은 가능합니다).'),
        };
  }
  // 고객 회신이 전달됐다 — 다음 수는 둘뿐이다: 그대로 만들 수 있으면 관리자 승인을 기다리고,
  // 답 때문에 EQ 를 고쳐야 하면 요청을 물리고 새 EQ 를 올린다(승인요청 중에는 첨부가 잠긴다).
  if (d.status === 'eq_requested' && answerArrived.value) {
    return {
      title: pt('고객 회신이 도착했습니다 — 아래 \'고객 회신\'에서 문항별 선택을 확인해 주세요.'),
      hint: pt('회신대로 생산할 수 있으면 관리자의 EQ 승인을 기다려 주세요. EQ를 고쳐야 하면 [{value1}] 후 수정한 EQ를 올려 다시 승인요청해 주세요.', { value1: revertLabel.value }),
    };
  }
  if (d.status === 'eq_requested') {
    return {
      title: pt('샘플피씨비 관리자의 EQ 승인을 기다리고 있습니다.'),
      hint: pt('승인요청 중에는 첨부를 바꿀 수 없습니다 — 바꾸려면 요청을 취소한 뒤 올려 주세요.'),
    };
  }
  // 승인 뒤의 갈림길 — 회신을 읽고 그대로 만들거나 다시 묻는다. 생산을 시작하면 다시 묻는 문이 닫힌다.
  if (d.status === 'eq_done' && canReopen.value) {
    return answerToReview.value
      ? {
          title: pt('고객 회신을 확인해 주세요 — 회신대로 생산할 수 있으면 [{value1}], 더 확인할 것이 있으면 [{value2}]을 눌러 주세요.', { value1: forwardLabel.value, value2: reopenLabel.value }),
          hint: pt('추가 EQ 요청은 생산을 시작하기 전까지만 할 수 있습니다.'),
        }
      : {
          title: pt('EQ가 승인됐습니다 — 생산을 시작해 주세요.'),
          hint: pt('더 확인할 것이 있으면 생산을 시작하기 전에 [{value1}]으로 EQ를 다시 열 수 있습니다.', { value1: reopenLabel.value }),
        };
  }
  if (d.status === 'eq_done') return { title: pt('EQ가 승인됐습니다 — 생산을 시작해 주세요.'), hint: '' };
  if (d.status === 'producing')
    return { title: pt('생산 중입니다 — 끝나면 [생산 완료]를 눌러 주세요.'), hint: '' };
  return { title: pt('생산이 끝났습니다 — 발송을 시작해 주세요.'), hint: '' };
});

// ── 파일 업로드 ──────────────────────────────────────────────────────────────
const upload = useUploadPartnerPcbEqFile();
const removeFile = useDeletePartnerPcbEqFile();
// 문의 사진(inquiry)은 여러 장이 자연스럽다 — multiple 로 받아 순서대로 올린다(업로드
// API 는 1건씩). accept 는 안내일 뿐 서버 제약이 아니다(파일 종류 검증은 기존 규칙 그대로).
// ⚠ 한 장이 실패해도 **나머지는 계속 올린다** — 중간에 끊고 한 줄짜리 실패 문구만 내면
//   협력사는 몇 장이 붙었는지 모른 채 확인 요청을 눌러 첨부가 잠긴다. 실패한 파일명을 적는다.
function pickAndUpload(
  fileType: PcbEqFileTypeType,
  opts?: { accept?: string; multiple?: boolean },
): void {
  if (poId.value === null) return;
  const input = document.createElement('input');
  input.type = 'file';
  if (opts?.accept !== undefined) input.accept = opts.accept;
  if (opts?.multiple === true) input.multiple = true;
  input.onchange = async () => {
    const files = [...(input.files ?? [])];
    if (files.length === 0) return;
    actionError.value = '';
    armFreshBaseline();
    const failed: string[] = [];
    let lastMessage = '';
    for (const file of files) {
      try {
        await upload.mutateAsync({ poId: poId.value ?? 0, file, fileType });
      } catch (e) {
        failed.push(file.name);
        if (locale.value === 'ko' && e instanceof ApiRequestError && e.message !== '') lastMessage = e.message;
      }
    }
    if (failed.length > 0) {
      actionError.value =
        pt('파일 {value1}건 업로드 실패: {value2}', { value1: String(failed.length), value2: failed.join(', ') }) +
        (lastMessage === '' ? pt(' — 다시 올려 주세요.') : ` — ${lastMessage}`);
    }
  };
  input.click();
}
/** 삭제는 한 번 묻는다 — 목록의 [삭제]와 타임라인의 ✕ 가 같은 문을 지난다(되돌릴 수 없다). */
async function askDeleteFile(fileId: number): Promise<void> {
  const file = detail.value?.eq.files.find((f) => f.fileId === fileId);
  const ok = await confirmDialog({
    message: pt('\'{value1}\' 파일을 삭제할까요? 삭제하면 되돌릴 수 없습니다.', { value1: file?.name ?? '' }),
    confirmLabel: pt('삭제'),
    tone: 'danger',
  });
  if (ok) await deleteFile(fileId);
}
async function deleteFile(fileId: number): Promise<void> {
  if (poId.value === null) return;
  actionError.value = '';
  try {
    await removeFile.mutateAsync({ poId: poId.value, fileId });
  } catch (e) {
    surfaceError(e, pt('파일 삭제에 실패했습니다.'));
  }
}

// ── 전이 ─────────────────────────────────────────────────────────────────────
const eqRequest = usePartnerPcbEqRequest();
const prodStart = usePartnerPcbProductionStart();
const prodComplete = usePartnerPcbProductionComplete();
const eqRevert = usePartnerPcbEqRevert();
const eqReopenRun = usePartnerPcbEqReopen();
const busy = computed(
  () =>
    eqRequest.isPending.value ||
    prodStart.isPending.value ||
    prodComplete.isPending.value ||
    eqRevert.isPending.value ||
    eqReopenRun.isPending.value,
);
async function runForward(): Promise<void> {
  if (poId.value === null || detail.value === null) return;
  actionError.value = '';
  const status = detail.value.status;
  try {
    // note = 스텐실의 고객문의사항. EQ 트랙에서는 빈 값이라 종전과 같다(서버가 null 로 접는다).
    if (status === 'issued')
      await eqRequest.mutateAsync({ poId: poId.value, note: noteDraft.value.trim() });
    else if (status === 'eq_done') await prodStart.mutateAsync({ poId: poId.value });
    else if (status === 'producing') await prodComplete.mutateAsync({ poId: poId.value });
  } catch (e) {
    surfaceError(e, pt('진행에 실패했습니다.'));
  }
}
async function runRevert(): Promise<void> {
  if (poId.value === null || revert.value === null) return;
  if (!(await confirmDialog({ message: pt('\'{value1}\' — 한 단계 되돌릴까요?', { value1: revertLabel.value }), confirmLabel: pt('되돌리기'), tone: 'danger' }))) return;
  actionError.value = '';
  try {
    await eqRevert.mutateAsync({ poId: poId.value });
  } catch (e) {
    surfaceError(e, pt('되돌리기에 실패했습니다.'));
  }
}

// 추가 EQ 요청 — 사유를 받아야 하는 전이라 대화상자를 거친다. 오류는 **대화상자 안**에 적는다
// (페이지 위쪽 actionError 는 창에 가려 안 보인다). 사유 규칙은 서버와 같은 계약 스키마로 먼저 본다.
const reopenPromptOpen = ref(false);
const reopenError = ref('');
function openReopen(): void {
  reopenError.value = '';
  reopenPromptOpen.value = true;
}
async function submitReopen(values: Record<string, string>): Promise<void> {
  if (poId.value === null) return;
  const body = PcbEqReopenBody.safeParse({ reason: values.reason ?? '' });
  if (!body.success) {
    reopenError.value = pt('사유를 2자 이상 적어 주세요.');
    return;
  }
  reopenError.value = '';
  actionError.value = '';
  try {
    await eqReopenRun.mutateAsync({ poId: poId.value, body: body.data });
    reopenPromptOpen.value = false;
  } catch (e) {
    reopenError.value =
      locale.value === 'ko' && e instanceof ApiRequestError && e.message !== '' ? e.message : pt('추가 EQ 요청에 실패했습니다.');
  }
}

// ── MD 하위 발주 ─────────────────────────────────────────────────────────────
const childPo = useCreatePartnerChildPcbPo();
const childRfqPick = ref<number | null>(null);
// 실패 메시지는 누른 버튼 곁에 — 페이지 위쪽 actionError 는 이 구역(화면 아래)에서 보이지 않는다.
const childPoError = ref('');
const surfaceChildPoError = (e: unknown): void => {
  childPoError.value =
    locale.value === 'ko' && e instanceof ApiRequestError && e.message !== '' ? e.message : pt('하위 발주에 실패했습니다.');
};
async function issueChildPo(): Promise<void> {
  if (poId.value === null || childRfqPick.value === null) return;
  actionError.value = '';
  childPoError.value = '';
  try {
    await childPo.mutateAsync({
      poId: poId.value,
      body: { childRfqId: childRfqPick.value },
    });
  } catch (e) {
    surfaceChildPoError(e);
  }
}
const selectableChildRfqs = computed(
  () => detail.value?.childRfqs.filter((r) => r.priceOriginal !== null) ?? [],
);

// A/S 회차(A′) 하위 발주 — 회차 하위 RFQ 는 만들 경로가 없으므로, 원회차(round 0) 하위
// 발주 조건 복사(childRfqId 없이 partnerId 지정)로 발주한다. 이미 이 회차에 발주된
// 대상은 제외 — "하위 발주를 진행해 주세요" 안내가 실행 가능해지는 버튼(여정 7호 교정).
const originChildTargets = computed(() => {
  const d = detail.value;
  if (d?.direction !== 'received' || d.reorderRound === 0) return [];
  return d.originChildPos.filter(
    (o) => !d.children.some((c) => c.partnerId === o.partnerId),
  );
});
async function issueChildPoFromOrigin(target: {
  partnerId: number;
  partnerName: string;
  currency: string;
  priceOriginal: number;
  subCurrency: string | null;
  subPriceOriginal: number | null;
}): Promise<void> {
  if (poId.value === null || detail.value === null) return;
  const ok = await confirmDialog({
    title: pt('원발주 조건으로 하위 발주'),
    message:
      pt('{value1}에게 A/S {value2}차 하위 발주를 발행합니다.\n', { value1: target.partnerName, value2: String(detail.value.reorderRound) }) +
      pt('원주문 하위 발주 조건 그대로 — 발주가 {value1}.\n', { value1: pcbMoneyWithSub(target.currency, target.priceOriginal, target.subCurrency, target.subPriceOriginal) }) +
      pt('납기는 비워집니다(협력사와 협의 후 입력).'),
    confirmLabel: pt('하위 발주'),
  });
  if (!ok) return;
  actionError.value = '';
  childPoError.value = '';
  try {
    await childPo.mutateAsync({ poId: poId.value, body: { partnerId: target.partnerId } });
  } catch (e) {
    surfaceChildPoError(e);
  }
}

// ── P3 선적 — 발송 준비/핑퐁/입고확인/첨부/상업송장 ──────────────────────────
const ship = computed(() => detail.value?.shipment ?? null);
const shipMode = computed(() => ship.value?.mode ?? 'international');
const shipNext = computed(() =>
  ship.value === null ? null : bomShipmentNextStatus(shipMode.value, ship.value.status),
);
const shipNextActor = computed(() =>
  shipNext.value === null ? null : bomShipmentActorOf(shipMode.value, shipNext.value),
);
// 발송 조작은 [📦 PCB 보내기] 보드가 단일 창구(§9 재구성 후속) — 수주(보내는측) 발송
// 섹션은 읽기 요약+보드 링크만 남긴다. 받는측(MD 입고) 액션은 "발주한 하위 건"의
// 자리이므로 이 상세에 유지한다.
const isMdReceiverView = computed(
  () =>
    detail.value?.direction === 'issued' &&
    ship.value !== null &&
    ship.value.receiverKind === 'md',
);
// 받는측 전이(국제 선적 이후 단계) — MD 조직이 ADMIN 측을 맡는다.
// 국내 종점('입고 완료')은 제외한다: 그건 [입고 확인]이 상태까지 함께 닫는 같은 사건이라
// 버튼을 둘로 두면 어느 쪽을 눌러야 하는지 알 수 없다(서버도 RECEIVE_REQUIRED 로 막는다).
const receiverCanAdvance = computed(
  () =>
    isMdReceiverView.value &&
    shipNextActor.value === 'ADMIN' &&
    !(ship.value?.mode === 'domestic' && shipNext.value === 'delivered'),
);
const receiverCanReceive = computed(
  () =>
    isMdReceiverView.value &&
    ship.value !== null &&
    ship.value.status !== 'preparing' &&
    ship.value.receivedAt === null,
);
// 지금 이 발주서가 "반려로 되돌아온 상태"인가 — issued 로 내려와 있고 마지막 이력이
// 관리자 반려면 그렇다. 재요청하면 이력이 덧붙어 자연히 사라진다.
//
// ⚠ 전이 모양(eq_requested→issued)만 보던 것을 계약 판정으로 바꿨다(2026-08-16 교정).
//    협력사가 **자기 요청을 취소**한 것도 같은 전이라, 모양만 보면 "반려된 건입니다 —
//    보완 파일을 올리고 다시 승인요청해 주세요"가 떴다(아무도 반려하지 않았는데).
const eqRejection = computed<{ note: string | null; at: string } | null>(() => {
  const d = detail.value;
  if (d?.status !== 'issued') return null;
  const last = d.eq.history.at(-1);
  if (last === undefined || !isPcbEqRejectionEvent(last)) return null;
  return { note: last.note, at: last.at };
});
// 발주접수로 돌아온 이유가 **추가 EQ 요청**인가(D20 후속) — 반려(eq_requested → issued)와 전이
// 모양부터 다르다(eq_done → issued). 판정은 계약의 경계 함수 하나다: 가장 최근에 EQ 를 다시 돌게
// 만든 것이 반려면 위 eqRejection 이, 추가 EQ 요청이면 이것이 말한다(둘이 동시에 서지 않는다).
// 재요청을 잠깐 물렸다(요청 취소) 해도 추가 EQ 를 준비 중인 것은 그대로라 마지막 이벤트로 좁히지 않는다.
const eqReopen = computed<{ note: string; at: string } | null>(() => {
  const d = detail.value;
  if (d?.status !== 'issued') return null;
  const boundary = lastPcbEqReworkBoundary(d.eq.history);
  return boundary?.kind === 'reopen' ? { note: boundary.note, at: boundary.at } : null;
});
// 그 사유를 관리자가 대행으로(한국어로) 썼으면 번역이 이력에 붙어 있다(D20 P4) — 포털 언어가 영어·중국어일 때
// 번역문을 먼저, 원문을 그 아래 보인다. 협력사가 직접 쓴 사유에는 번역이 없다(자기 말이다).
const eqReopenTranslated = computed<string | null>(() => {
  const reopen = eqReopen.value;
  if (reopen === null || reopen.note === '') return null;
  const event = detail.value?.eq.history.find((e) => e.at === reopen.at && e.note === reopen.note);
  return pcbEqCommentTranslated(event?.noteI18n ?? null, locale.value);
});
// 추가 EQ 요청 뒤 새 파일을 올렸는가 — 지금 올라 있는 EQ 는 이미 승인된 판이다. 서버가 찍는
// afterReject 는 **가장 최근 경계**(반려 또는 추가 EQ 요청) 뒤의 파일이라 같은 표시를 읽는다.
// 관리자 회신(reply)은 내 산출물이 아니라 세지 않는다.
const hasFileAfterReopen = computed<boolean>(
  () =>
    eqReopen.value !== null &&
    (detail.value?.eq.files.some((f) => f.fileType !== 'reply' && f.afterReject) ?? false),
);
// 반려 뒤 보완 파일을 실제로 올렸는가 — 서버가 파일마다 afterReject 를 찍어 준다.
// 안 올린 채 재요청하면 관리자에게 "같은 도면"으로 보이고 다시 반려된다.
const hasFixAfterReject = computed<boolean>(
  () => detail.value?.eq.files.some((f) => f.afterReject) ?? false,
);

const shipAdvance = usePartnerPcbShipmentAdvance(); // 받는측(MD) 전이 전용
const shipReceive = usePartnerPcbShipmentReceive();
// 받는측(MD) 전이 — '선적' 포함 전부 무입력 즉시 전이(2026-08-15 정정). MD향 발송은
// Case ID 갈래가 없어(receiverKind admin 한정) 직접 발송뿐이고, 운송장의 원천은
// 보내는 하위 협력사다 — 받는 MD 에게 물으면 지어낸 값만 들어온다. 하위가 준비
// 단계에 적어 둔 값이 있으면 그대로 실린다(서버 판정 body ?? 박제값).
async function runReceiverAdvance(): Promise<void> {
  if (poId.value === null || ship.value === null || shipNext.value === null) return;
  actionError.value = '';
  try {
    await shipAdvance.mutateAsync({ poId: poId.value, body: {} });
  } catch (e) {
    surfaceError(e, pt('진행에 실패했습니다.'));
  }
}

const receivePromptOpen = ref(false);
async function submitShipReceive(values: Record<string, string>): Promise<void> {
  if (poId.value === null) return;
  const note = values.note ?? '';
  actionError.value = '';
  try {
    await shipReceive.mutateAsync({ poId: poId.value, note: note === '' ? null : note });
    receivePromptOpen.value = false;
  } catch (e) {
    surfaceError(e, pt('입고 확인에 실패했습니다.'));
  }
}
const SHIP_STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};

const STATUS_CLS: Record<string, string> = {
  issued: 'bg-blue-100 text-blue-700',
  eq_requested: 'bg-amber-100 text-amber-700',
  eq_done: 'bg-sky-100 text-sky-700',
  producing: 'bg-indigo-100 text-indigo-700',
  produced: 'bg-emerald-100 text-emerald-700',
};
// 명칭·순서는 레거시 정본(lib/pcb-spec.ts, estimate_form_ca10 승계).
// 항목 이름·순서는 거버 앱이 정본 — 카테고리 세트를 골라야 맞는다(lib/pcb-spec.ts).
const specEntries = computed(() => {
  const json = detail.value?.spec.specJson ?? {};
  const context = {
    category: detail.value?.spec.category,
    orderCategory: detail.value?.spec.orderCategory,
    kindPcb: typeof json.kindPcb === 'string' ? json.kindPcb : null,
  };
  const fields = pcbSpecFormFields(context);
  return pcbSpecEntries(json, context).map((entry) => {
    const field = fields.find((candidate) => candidate.key === entry.key);
    const listed = field?.options.some((option) =>
      option.value.toLowerCase() === entry.value.toLowerCase() || option.name === entry.value,
    ) ?? false;
    return { ...entry, display: listed || entry.display !== entry.value ? pt(entry.display) : entry.display };
  });
});

// Clear transient feedback on language changes; preserve entered form values.
watch(locale, () => {
  actionError.value = '';
  reopenError.value = '';
});
</script>

<template>
  <div class="pcb-readable space-y-5">
    <PartnerPageHeader :back="{ to: { name: 'partner-pcb-pos' }, label: pt('발주서') }" />

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">{{ pt('불러오는 중…') }}</p>

    <template v-else-if="detail !== null">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-bold">{{ detail.spec.projectName }}</h1>
        <span
          v-if="detail.reorderRound > 0"
          class="rounded bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700"
          :title="pt('A/S 재생산 회차 발주 — {value1} 다시 진행합니다', { value1: isStencil ? pt('확인 절차부터') : pt('EQ부터') })"
        >{{ pt('A/S {value1}차', { value1: detail.reorderRound }) }}</span>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLS[detail.status]">
          {{ pt(PCB_PO_STATUS_LABELS[detail.track][detail.status]) }}
        </span>
        <span
          v-if="detail.direction === 'received'"
          class="rounded px-2 py-0.5 text-xs font-semibold"
          :class="detail.fulfillmentMode === 'self' ? 'bg-teal-100 text-teal-700' : 'bg-indigo-100 text-indigo-700'"
        >
          {{ pt(PCB_PO_FULFILLMENT_MODE_LABELS[detail.fulfillmentMode]) }}
        </span>
        <!-- 상대는 counterpartyName — issued(하위 발주)에서 requesterName 은 **내 조직**이라
             "하위 발주: 마스터딜러"처럼 자기 이름이 상대 자리에 서 있었다(MD 실주행 확정). -->
        <span class="text-sm text-gray-500">
          {{ detail.direction === 'received' ? pt('발주처') : pt('하위 협력사') }}: {{ detail.counterpartyName }}
        </span>
      </div>

      <!-- A/S 회차 역링크(재점검 #16) — 같은 사양에 회차 발주가 생기면 원발주 상세에서도
           존재를 알린다(내가 볼 수 있는 회차만, 서버 asRounds). -->
      <p
        v-if="asRounds.length > 0"
        class="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
      >
        {{ pt('🔧 이 사양의 A/S 회차 발주 {value1}건 —', { value1: pn(asRounds.length) }) }}<template v-for="(r, i) in asRounds" :key="r.poId">
          <template v-if="i > 0"> · </template>
          <RouterLink
            :to="{ name: 'partner-pcb-po', params: { id: String(r.poId) } }"
            class="font-bold underline hover:text-rose-900"
          >
            {{ pt('{value1}차(PO-{value2} · {value3}) 열기 →', { value1: r.reorderRound, value2: r.poId, value3: pt(PCB_PO_STATUS_LABELS[detail.track][r.status]) }) }}
          </RouterLink>
        </template>
      </p>

      <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{{ actionError }}</p>

      <!-- 발주 조건 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">{{ pt('발주 조건') }}</h2>
        <dl class="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          <div class="flex justify-between">
            <dt class="text-gray-500">{{ pt('발주가') }}</dt>
            <dd class="font-bold tabular-nums">{{ pcbMoneyWithSub(detail.currency, detail.priceOriginal, detail.subCurrency, detail.subPriceOriginal) }}</dd>
          </div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ pt('결제조건') }}</dt><dd>{{ detail.paymentTerms ?? '—' }}</dd></div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ pt('송금 예정') }}</dt><dd>{{ dateOnly(detail.remittanceDueOn) }}</dd></div>
          <div class="flex justify-between">
            <dt class="text-gray-500">{{ pt('수금') }}</dt>
            <dd :class="remitStatusCls">{{ remitStatusText }}</dd>
          </div>
          <div class="flex justify-between"><dt class="text-gray-500">{{ pt('납기일') }}</dt><dd>{{ dateOnly(detail.deliveryDate) }}</dd></div>
        </dl>
        <p v-if="detail.memo !== null && detail.memo !== ''" class="mt-2 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">{{ detail.memo }}</p>

        <!-- 수금 내역(P3.11) — 부분 송금이 있으므로 건별로 보여준다. 이 발주서 건만 보인다. -->
        <div v-if="remitSummary !== null && remitSummary.count > 0" class="mt-3 rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50 text-left text-[11px] uppercase text-gray-500">
              <tr>
                <th class="px-3 py-1.5">{{ pt('입금일') }}</th>
                <th class="px-3 py-1.5 text-right">{{ pt('금액') }}</th>
                <th class="px-3 py-1.5">{{ pt('메모') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="r in detail.remittances" :key="r.id">
                <td class="whitespace-nowrap px-3 py-1.5 text-gray-600">{{ dateOnly(r.remittedOn) }}</td>
                <td class="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums text-gray-800">
                  {{ fmtPcbAmount(r.currency, r.amount) }}
                </td>
                <td class="px-3 py-1.5 text-xs text-gray-500">{{ r.memo ?? '—' }}</td>
              </tr>
            </tbody>
            <tfoot v-if="remitSummary !== null && remitSummary.balance > 0" class="border-t border-gray-200 bg-amber-50">
              <tr>
                <td class="px-3 py-1.5 text-xs font-semibold text-amber-800">{{ pt('미수금') }}</td>
                <td class="whitespace-nowrap px-3 py-1.5 text-right font-bold tabular-nums text-amber-800">
                  {{ fmtPcbAmount(remitSummary.currency, remitSummary.balance) }}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <!-- EQ(스텐실: 고객문의사항·좌표파일 확인) 진행 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">
          {{ isStencil ? pt('고객문의사항 · 생산 진행') : pt('EQ · 생산 진행') }}
        </h2>

        <!-- 스텝퍼 -->
        <ol class="mt-3 flex flex-wrap items-center gap-1">
          <template v-for="(step, i) in steps" :key="step">
            <li
              class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="i < stepIndex ? 'bg-emerald-50 text-emerald-700' : i === stepIndex ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'"
            >
              <span v-if="i < stepIndex">✓</span>{{ pt(PCB_PO_STATUS_LABELS[detail.track][step]) }}
            </li>
            <span v-if="i < steps.length - 1" class="text-gray-300">→</span>
          </template>
        </ol>

        <!-- 경유/차단 안내 -->
        <p v-if="detail.eq.delegatePoId !== null" class="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">{{ pt('MD 경유 발주입니다. {workflow} 진행은 하위 발주서에서 처리되며 이 문서에 자동 반영됩니다.', { workflow: isStencil ? pt('확인·생산') : pt('EQ·생산') }) }} <RouterLink :to="{ name: 'partner-pcb-po', params: { id: String(detail.eq.delegatePoId) } }" class="font-bold underline">{{ pt('하위 발주서') }}</RouterLink></p>
        <p v-else-if="detail.eq.blocked" class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ pt('하위 협력사에 발주하면 {value1} 시작됩니다 — 아래 [하위 발주]를 진행해 주세요.', { value1: isStencil ? pt('확인 절차가') : pt('EQ가') }) }}</p>
        <p
          v-else-if="detail.direction === 'received' && detail.fulfillmentMode === 'self' && detail.status === 'issued'"
          class="mt-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800"
        >
          {{ pt('직접 제작 발주입니다 — 이 발주서에서 {value1}과 생산을 진행해 주세요.', { value1: isStencil ? pt('확인 요청') : pt('EQ 승인요청') }) }}
        </p>


        <!-- EQ 진행 — 이력과 첨부를 **한 시간축**으로. 예전에는 반려 배너·내 파일 두 칸·받은
             첨부·이력 details 네 곳에 흩어져 있어 협력사가 순서를 스스로 조립해야 했다. -->
        <div v-if="detail.eq.delegatePoId === null && !detail.eq.blocked" class="mt-4">
          <!-- 관점: 하위 발주 관전(MD)이면 '내 말'은 MASTER_DEALER — 하위 협력사의 활동이
               내 활동처럼 오른쪽에 붙던 것을 상대측으로 되돌린다. ✕(삭제)도 isMine 을 따르므로
               MD 는 자기 대행 업로드만 지울 수 있게 된다(받은 자료 보존 원칙과 정합). -->
          <PcbEqTimeline
            :history="detail.eq.history"
            :files="timelineFiles"
            :me-role="detail.direction === 'issued' ? 'MASTER_DEALER' : 'PARTNER'"
            :track="track"
            :editable="filesEditable && detail.eq.myRole === 'RECEIVER'"
            :deletable-roles="deletableRoles"
            @download="downloadEq"
            @delete="(fileId) => void askDeleteFile(fileId)"
          />
        </div>


        <div v-if="detail.eq.delegatePoId === null && !detail.eq.blocked">
          <!-- 지금 할 일 — 타임라인의 마지막 칸. 무엇을 해야 하는지 한 문장으로 못박고,
               할 수 있는 것만 버튼으로 연다(첨부는 승인요청 뒤 잠긴다). -->
          <div class="mt-3 rounded-xl border border-blue-200 bg-blue-50/40 p-3" data-testid="partner-eq-now-todo">
            <p class="text-sm font-bold text-blue-900">{{ nowTodo.title }}</p>
            <p v-if="nowTodo.hint !== ''" class="mt-1 text-xs leading-5 text-blue-700">
              {{ nowTodo.hint }}
            </p>
            <!-- 고객 회신을 읽어야 하는 단계 — 요약만으로도 판단할 수 있게 한 줄로 보이고, 자세한 것은 아래 카드로 보낸다 -->
            <div
              v-if="eqRounds.length > 0 && (answerArrived || answerToReview)"
              class="mt-2 flex flex-wrap items-center gap-1.5 text-xs"
              data-testid="partner-eq-answer-pointer"
            >
              <span class="font-semibold text-blue-900">{{ pt('고객 선택 요약') }}</span>
              <span
                v-for="s in answerSummary"
                :key="s.no"
                class="rounded-md bg-surface px-2 py-0.5 font-mono font-bold text-violet-900 ring-1 ring-violet-200"
              >{{ s.no }}: {{ s.key }}</span>
              <button
                type="button"
                class="rounded-md border border-violet-200 bg-surface px-2 py-0.5 font-semibold text-violet-700 hover:bg-violet-50"
                data-testid="partner-eq-answer-jump"
                @click="void answersCard?.reveal()"
              >
                {{ pt('회신 보기') }} ↓
              </button>
            </div>
            <!-- 추가 EQ 요청으로 돌아온 건 — 무엇을 더 확인하려 했는지(요청 때 쓴 사유)를 다시 보인다.
                 수정 EQ 를 만드는 동안 이 문장이 작업 지시다. 협력사가 쓴 사유는 쓴 그대로이고, 관리자가 대행으로
                 (한국어로) 쓴 사유는 번역이 있으면 번역문을 먼저·원문을 그 아래 보인다(D20 P4). -->
            <div
              v-if="eqReopen !== null && eqReopen.note !== ''"
              class="mt-2 min-w-0 rounded-md border-l-4 border-amber-400 bg-surface px-3 py-2"
              data-testid="partner-eq-reopen-reason"
            >
              <p class="text-xs font-semibold text-amber-800">
                {{ pt('추가 EQ 요청 사유') }}<span v-if="eqReopenTranslated !== null" class="font-normal text-gray-400"> · {{ pt('AI 번역') }}</span>
              </p>
              <template v-if="eqReopenTranslated !== null">
                <p class="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]" data-testid="partner-eq-reopen-reason-translated">
                  {{ eqReopenTranslated }}
                </p>
                <p class="mt-1 whitespace-pre-wrap text-xs text-gray-500 [overflow-wrap:anywhere]">
                  <span class="font-semibold">{{ pt('원문(한국어)') }}:</span> {{ eqReopen.note }}
                </p>
              </template>
              <p v-else class="mt-0.5 whitespace-pre-wrap text-sm text-gray-800 [overflow-wrap:anywhere]">{{ eqReopen.note }}</p>
            </div>
            <!-- 스텐실 — 필수는 좌표파일 하나, 문의사항·사진은 선택이다. 문의사항은 제출과
                 한 몸이라 여기 둔다(제출 뒤엔 첨부와 같이 잠긴다 — 따로 저장 버튼을 두면
                 잠금이 거짓말이 된다). -->
            <template v-if="isStencil && filesEditable && detail.eq.myRole === 'RECEIVER'">
              <label class="mt-3 block text-xs font-bold text-blue-900" for="stencil-note">{{ pt('고객문의사항') }} <span class="font-normal text-blue-400">{{ pt('(선택)') }}</span>
              </label>
              <textarea
                id="stencil-note"
                v-model="noteDraft"
                rows="3"
                maxlength="2000"
                :placeholder="pt('고객에게 확인할 사항이나 전달할 내용이 있으면 적어 주세요.')"
                class="mt-1 w-full rounded-md border border-blue-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
              />
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-blue-50 disabled:opacity-40"
                  :class="coordFiles.length > 0 ? 'border-blue-300 bg-surface text-blue-700' : 'border-amber-300 bg-amber-50 text-amber-700'"
                  :disabled="upload.isPending.value"
                  @click="pickAndUpload('coord')"
                >
                  {{ pt('＋ 좌표파일{value1}', { value1: coordFiles.length > 0 ? ` (${pn(coordFiles.length)})` : ' *' }) }}
                </button>
                <!-- 문의 사진 — 문의사항이 말로 다 못 하는 부분을 사진이 잇는다(여러 장 가능) -->
                <button
                  type="button"
                  class="rounded-md border border-blue-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                  :disabled="upload.isPending.value"
                  @click="pickAndUpload('inquiry', { accept: 'image/*', multiple: true })"
                >
                  {{ pt('＋ 문의 사진{value1}', { value1: inquiryFiles.length > 0 ? ` (${pn(inquiryFiles.length)})` : '' }) }}
                </button>
                <span v-if="coordFiles.length === 0" class="text-[11px] text-amber-700">{{ pt('좌표파일이 있어야 확인 요청을 보낼 수 있습니다.') }}</span>
              </div>
            </template>

            <template v-else-if="filesEditable && detail.eq.myRole === 'RECEIVER'">
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-md border border-blue-300 bg-surface px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                  :disabled="upload.isPending.value"
                  @click="pickAndUpload('eq')"
                >
                  {{ pt('＋ EQ 질의서') }}{{ uploadCountSuffix('eq') }}
                </button>
                <button
                  type="button"
                  class="rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-blue-50 disabled:opacity-40"
                  :class="hasWorkingFile ? 'border-blue-300 bg-surface text-blue-700' : 'border-amber-300 bg-amber-50 text-amber-700'"
                  :disabled="upload.isPending.value"
                  @click="pickAndUpload('working')"
                >
                  {{ pt('＋ Working 데이터') }}{{ uploadCountSuffix('working') }}
                </button>
              </div>
              <!-- 올린 파일 — 누른 자리에서 결과를 보고, 잘못 올렸으면 바로 지운다 -->
              <div class="mt-2 rounded-lg border border-blue-100 bg-surface p-2.5" data-testid="partner-eq-upload-list">
                <p class="text-xs font-bold text-blue-900">{{ pt('올린 파일') }}</p>
                <ul v-if="pendingFiles.length > 0" class="mt-1.5 space-y-1">
                  <li
                    v-for="f in pendingFiles"
                    :key="f.fileId"
                    class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-xs transition-colors"
                    :class="freshFileIds.has(f.fileId) ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-gray-50'"
                    data-testid="partner-eq-upload-row"
                    :data-fresh="freshFileIds.has(f.fileId) ? 'true' : 'false'"
                  >
                    <span class="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800">{{ uploadKindLabel(f.fileType) }}</span>
                    <button
                      type="button"
                      class="min-w-0 truncate font-medium text-blue-700 hover:underline"
                      @click="downloadEq(f.fileId, f.name)"
                    >
                      {{ f.name }}
                    </button>
                    <span class="shrink-0 text-gray-400">{{ formatBytes(f.size) }} · {{ formatPartnerDateTime(f.uploadedAt, locale) }}</span>
                    <span v-if="freshFileIds.has(f.fileId)" class="shrink-0 font-semibold text-emerald-700">✓ {{ pt('업로드됨') }}</span>
                    <span
                      v-if="!f.isLatest"
                      class="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700"
                      :title="pt('같은 종류로 더 나중 파일이 있습니다 — 이건 이전 것입니다.')"
                    >{{ pt('이전') }}</span>
                    <button
                      v-if="canDeleteFile(f)"
                      type="button"
                      class="ml-auto shrink-0 rounded-md border border-red-200 bg-surface px-2 py-0.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
                      :disabled="removeFile.isPending.value"
                      data-testid="partner-eq-upload-delete"
                      @click="void askDeleteFile(f.fileId)"
                    >
                      {{ pt('삭제') }}
                    </button>
                  </li>
                </ul>
                <p v-else class="mt-1 text-xs text-gray-500" data-testid="partner-eq-upload-empty">{{ pt('아직 올린 파일이 없습니다.') }}</p>
                <p v-if="lockedFileCount > 0" class="mt-1.5 text-[11px] leading-4 text-gray-500" data-testid="partner-eq-upload-locked">
                  {{ pt('이미 승인됐거나 고객 확인에 쓰인 파일 {value1}개는 기록으로 남아 삭제할 수 없습니다 — 새 파일을 올리면 이전 파일로 접힙니다.', { value1: pn(lockedFileCount) }) }}
                </p>
              </div>
            </template>
          </div>
        </div>

        <!-- 액션 -->
        <div v-if="detail.eq.delegatePoId === null && !detail.eq.blocked" class="mt-4 flex flex-wrap items-center gap-2">
          <button
            v-if="canForward && forward !== null"
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            :class="detail.eq.fallback ? 'border border-indigo-300 bg-indigo-500 hover:bg-indigo-600' : 'bg-blue-600 hover:bg-blue-700'"
            :disabled="busy || submitBlockers.length > 0"
            @click="void runForward()"
          >
            {{ detail.eq.fallback ? pt('(MD 대행) {value1}', { value1: forwardLabel }) : forwardLabel }}
          </button>
          <!-- 못 보내는 이유는 버튼 옆에 적는다 — 비활성 버튼만 두면 왜 안 눌리는지 모른다.
               판정은 서버 게이트와 같은 계약 함수라 화면과 서버가 다른 말을 하지 않는다. -->
          <span v-if="canForward && submitBlockers.length > 0" class="text-xs font-semibold text-amber-700">
            {{ submitBlockers.map((b) => pt(PCB_STENCIL_SUBMIT_BLOCKER_MESSAGES[b])).join(' · ') }}
          </span>
          <!-- 추가 EQ 요청 — [생산 시작]과 같은 순간의 다른 길이라 바로 옆에, 보조 모양으로 둔다
               (주 동작은 생산 시작이다). 사유를 받아야 해서 누르면 대화상자가 먼저 뜬다. -->
          <button
            v-if="canReopen"
            type="button"
            class="rounded-lg border border-amber-300 bg-surface px-3 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-40"
            :disabled="busy"
            data-testid="partner-eq-reopen"
            @click="openReopen()"
          >
            {{ detail.eq.fallback ? pt('(MD 대행) {value1}', { value1: reopenLabel }) : reopenLabel }}
          </button>
          <!-- 안내 문구는 위 '지금 할 일' 한 곳으로 모았다(같은 말을 두 번 하지 않는다). -->
          <button
            v-if="canRevert && revert !== null"
            type="button"
            class="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            :disabled="busy"
            @click="void runRevert()"
          >
            ↩ {{ detail.eq.fallback ? pt('(MD 대행) {value1}', { value1: revertLabel }) : revertLabel }}
          </button>
        </div>
      </section>

      <!-- 고객 회신(D20) — EQ 카드 **아래의 별도 카드**. 타임라인과 '지금 할 일' 사이에 끼어 있을 때는 올린 파일과
           업로드 버튼 사이를 갈랐다(2026-10-11 사용자 지적). 읽어야 하는 단계(승인 직후·승인 대기 중 회신 도착)에만
           펼치고 그 밖에는 접는다 — '지금 할 일'의 요약 한 줄과 [회신 보기]가 이 카드를 가리킨다. 위임 상위(MD 관전)는
           타임라인이 없어도 하위의 회차를 받으므로 위임 조건 밖에 둔다. -->
      <PartnerPcbEqAnswers
        v-if="eqRounds.length > 0"
        ref="answersCard"
        :rounds="eqRounds"
        :collapsed-by-default="!(answerArrived || answerToReview)"
        @download="(round) => void downloadEqReply(round)"
      />

      <!-- P3 선적 — 발송 준비/핑퐁/입고확인 -->
      <section
        v-if="detail.canShip || detail.outboundBlocked || detail.shipment !== null"
        class="rounded-xl border border-teal-200 bg-surface p-4"
      >
        <h2 class="text-sm font-bold text-teal-700">
          {{ pt('발송 · 선적') }} <span v-if="ship !== null" class="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold" :class="SHIP_STATUS_CLS[ship.status]">
            {{ pt(bomShipmentStatusLabel(ship.mode, ship.status)) }}
          </span>
          <span v-if="ship !== null" class="ml-1 text-xs font-normal text-gray-400">
            {{ pt('{value1} · 받는 곳 {value2}', { value1: ship.mode === 'domestic' ? pt('국내(택배)') : pt('국제'), value2: ship.receiverName }) }}<template v-if="ship.destinationCountry !== null">{{ pt('· 직송 {value1}', { value1: ship.destinationCountry }) }}</template>
          </span>
        </h2>

        <p v-if="detail.outboundBlocked" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ pt('하위 협력사 물품의 입고 확인이 끝나야 출고할 수 있습니다.') }}</p>

        <!-- 담기·발송 조작은 보드가 단일 창구(§9 재구성 후속) — 여기서는 안내만 -->
        <RouterLink
          v-if="detail.canShip && ship === null"
          :to="{ name: 'partner-pcb-ship' }"
          class="mt-3 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
        >
          {{ pt('📦 PCB 보내기에서 담아 발송 →') }}
        </RouterLink>

        <template v-if="ship !== null">
          <!-- 스텝퍼 -->
          <ol class="mt-3 flex flex-wrap items-center gap-1">
            <template v-for="(step, i) in bomShipmentStatusesOf(ship.mode)" :key="step">
              <li
                class="rounded-full px-2.5 py-1 text-xs font-semibold"
                :class="bomShipmentStatusesOf(ship.mode).indexOf(ship.status) > i ? 'bg-emerald-50 text-emerald-700' : bomShipmentStatusesOf(ship.mode).indexOf(ship.status) === i ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400'"
              >
                {{ pt(bomShipmentStatusLabel(ship.mode, step)) }}
              </li>
              <span v-if="i < bomShipmentStatusesOf(ship.mode).length - 1" class="text-gray-300">→</span>
            </template>
          </ol>
          <p v-if="ship.receivedAt !== null" class="mt-1.5 text-xs font-semibold text-emerald-700">
            {{ pt('입고 확인 완료 {value1}', { value1: dateOnly(ship.receivedAt) }) }}<template v-if="ship.receivedNote !== null && ship.receivedNote !== ''">{{ pt('— 메모: {value1}', { value1: ship.receivedNote }) }}</template>
          </p>
          <p v-if="ship.trackingNumber !== null" class="mt-1 text-xs text-gray-500">
            {{ pt('운송장: {value1} {value2}', { value1: ship.carrier ?? '', value2: ship.trackingNumber }) }}
          </p>

          <!-- 이 발송의 묶음 구성(읽기) — 담기·꺼내기·전이·서류는 [📦 PCB 보내기]에서 -->
          <div class="mt-3 rounded-lg border border-gray-100 p-3">
            <p class="text-xs font-semibold text-gray-500">{{ pt('이 발송에 담긴 발주서 ({value1})', { value1: pn(ship.groupPos.length) }) }}</p>
            <ul class="mt-1.5 space-y-1">
              <li v-for="g in ship.groupPos" :key="g.poId" class="flex items-center gap-2 text-xs">
                <span
                  class="min-w-0 flex-1 truncate"
                  :class="g.poId === detail.poId ? 'font-bold text-gray-900' : 'text-gray-700'"
                >
                  {{ g.projectName }} <span v-if="g.poId === detail.poId" class="font-normal text-gray-400">{{ pt('— 이 발주서') }}</span>
                </span>
                <span class="shrink-0 text-gray-400">{{ fmtPcbAmount(g.currency, g.priceOriginal) }}</span>
              </li>
            </ul>
          </div>

          <!-- 보내는측 — 조작은 보드 단일 창구 -->
          <RouterLink
            v-if="detail.direction === 'received' && shipNext !== null"
            :to="{ name: 'partner-pcb-ship' }"
            class="mt-3 inline-block rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700"
          >
            {{ pt('📦 발송 진행·서류는 PCB 보내기에서 →') }}
          </RouterLink>

          <!-- MD 받는측 — 전이·입고확인 -->
          <div v-if="receiverCanAdvance || receiverCanReceive" class="mt-3 flex flex-wrap gap-2">
            <button
              v-if="receiverCanAdvance && shipNext !== null"
              type="button"
              class="rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
              :disabled="shipAdvance.isPending.value"
              @click="void runReceiverAdvance()"
            >
              {{ pt('{value1} 처리', { value1: pt(bomShipmentStatusLabel(ship.mode, shipNext)) }) }}
            </button>
            <button
              v-if="receiverCanReceive"
              type="button"
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
              :disabled="shipReceive.isPending.value"
              @click="receivePromptOpen = true"
            >
              {{ pt('입고 확인(수령)') }}
            </button>
          </div>

          <!-- 첨부 열람(읽기) — 업로드·상업송장 생성은 보드의 발송 카드에서 -->
          <div v-if="ship.files.length > 0" class="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <template v-for="f in ship.files" :key="f.fileId">
              <button
                type="button"
                class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
                @click="void downloadPartnerPcbShipmentFile(detail.poId, f.fileId, f.name)"
              >
                ⬇ {{ pt(PCB_SHIPMENT_FILE_LABELS[f.fileType]) }}
              </button>
            </template>
          </div>
        </template>
      </section>

      <!-- MD — 하위 발주 -->
      <section
        v-if="detail.direction === 'received' && detail.fulfillmentMode === 'delegated' && (detail.children.length > 0 || selectableChildRfqs.length > 0 || originChildTargets.length > 0)"
        class="rounded-xl border border-indigo-200 bg-surface p-4"
      >
        <h2 class="text-sm font-bold text-indigo-700">{{ pt('하위 협력사 발주 (마스터딜러)') }}</h2>
        <p v-if="childPoError !== ''" class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert" data-testid="partner-pcb-child-po-error">{{ childPoError }}</p>

        <div v-if="detail.children.length > 0" class="mt-3 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2">{{ pt('하위 협력사') }}</th>
                <th class="px-3 py-2">{{ pt('상태') }}</th>
                <th class="whitespace-nowrap px-3 py-2">{{ pt('발주가') }}</th>
                <th class="whitespace-nowrap px-3 py-2">{{ pt('납기일') }}</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="child in detail.children" :key="child.poId">
                <td class="px-3 py-2 font-medium text-gray-800">{{ child.partnerName }}</td>
                <td class="px-3 py-2">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[child.status]">
                    {{ pt(PCB_PO_STATUS_LABELS[child.track][child.status]) }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 tabular-nums">
                  {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ dateOnly(child.deliveryDate) }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <!-- 라벨은 하위 상태를 입는다(재점검 #17) — 생산완료 뒤에도 '진행'이면
                       아직 할 일이 남은 듯 읽힌다. 어휘는 하위 발주의 트랙을 따른다. -->
                  <RouterLink
                    :to="{ name: 'partner-pcb-po', params: { id: String(child.poId) } }"
                    class="rounded-md border border-indigo-200 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                  >
                    {{ child.status === 'produced' ? pt('생산 완료 — 보기') : child.track === 'stencil' ? pt('확인 진행 →') : pt('EQ 진행 →') }}
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="detail.children.length === 0 && selectableChildRfqs.length > 0" class="mt-3 flex flex-wrap items-center gap-2">
          <select v-model="childRfqPick" class="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none">
            <option :value="null" disabled>{{ pt('발주할 하위 회신 선택') }}</option>
            <option v-for="rfq in selectableChildRfqs" :key="rfq.rfqId" :value="rfq.rfqId">
              {{ rfq.partnerName }} — {{ fmtPcbAmount(rfq.currency, rfq.priceOriginal) }}
              ({{ pt(PCB_RFQ_STATUS_LABELS[rfq.status]) }})
            </option>
          </select>
          <button
            type="button"
            class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            :disabled="childPo.isPending.value || childRfqPick === null"
            @click="void issueChildPo()"
          >
            {{ pt('하위 발주') }}
          </button>
          <span class="text-xs text-gray-400">{{ pt('선정(selected) 회신이 기본 후보입니다 — 발주 시 {value1} 하위에서 시작됩니다.', { value1: isStencil ? pt('확인 절차가') : pt('EQ가') }) }}</span>
        </div>

        <!-- A/S 회차(A′) — 회차 하위 RFQ 가 없어도 원회차(round 0) 하위 발주 조건을 복사해
             발주할 수 있다(여정 7호 교정). 대상은 원회차 하위 발주 목록에서 온다. -->
        <div v-else-if="originChildTargets.length > 0" class="mt-3 space-y-2">
          <div
            v-for="t in originChildTargets"
            :key="t.partnerId"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2"
          >
            <span class="text-sm font-medium text-gray-800">{{ t.partnerName }}</span>
            <span class="text-sm tabular-nums text-gray-600">
              {{ pcbMoneyWithSub(t.currency, t.priceOriginal, t.subCurrency, t.subPriceOriginal) }}
            </span>
            <span v-if="t.paymentTerms !== null" class="text-xs text-gray-400">{{ t.paymentTerms }}</span>
            <span class="grow" />
            <button
              type="button"
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
              :disabled="childPo.isPending.value"
              @click="void issueChildPoFromOrigin(t)"
            >
              {{ pt('원발주 조건으로 하위 발주') }}
            </button>
          </div>
          <p class="text-xs text-gray-400">{{ pt('A/S {value1}차 — 원주문(round 0) 하위 발주 조건을 복사해 발주합니다. 납기는 비워지니 협력사와 협의 후 입력하세요. 발주하면 {value2} 하위에서 다시 시작됩니다.', { value1: detail.reorderRound, value2: isStencil ? pt('확인 절차가') : pt('EQ가') }) }}</p>
        </div>
      </section>

      <!-- 제작 사양 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">{{ pt('제작 사양') }}</h2>
        <!-- 제품군 배지 — 관리자 Case 상세와 같은 사전(공정·단가가 다른 물건을 갈라 준다). -->
        <p class="mt-1 text-sm text-gray-500">
          <span
            class="mr-1 rounded px-1.5 py-0.5 text-xs font-semibold"
            :class="pcbCategoryBadge(detail.spec.category).cls"
          >
            {{ pt(pcbCategoryBadge(detail.spec.category).label) }}
          </span>{{ pt('{value1} · {value2}매', { value1: detail.spec.orderCategory === 'mass' ? pt('양산') : pt('샘플'), value2: pn(detail.spec.qty) }) }}
        </p>
        <div v-if="detail.spec.files.length > 0" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="f in detail.spec.files"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadPartnerPcbPoSpecFile(detail.poId, f.fileId, f.name)"
          >
            ⬇ {{ f.name }}
          </button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
            <dt class="text-gray-400">{{ pt(entry.label) }}</dt>
            <dd class="truncate font-medium text-gray-700" :title="pt('저장값 {value1}', { value1: entry.value })">{{ entry.display }}</dd>
          </div>
        </dl>
        <p v-if="detail.spec.message !== null && detail.spec.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.spec.message }}
        </p>
      </section>
    </template>

    <div v-else class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{{ pt('발주서를 찾을 수 없습니다.') }}</div>

    <!-- 값을 받아야 하는 조작들(예전엔 window.prompt) -->
    <UiPromptModal
      :title="receivePromptOpen ? pt('입고 확인(수령)') : null"
      :fields="[{
        name: 'note',
        label: pt('검수 메모 (선택)'),
        type: 'textarea',
        placeholder: pt('수량 부족·불량 등 특이사항이 있으면 적어 주세요.'),
      }]"
      :description="pt('실물 검수를 기록합니다 — 하위 발송이 모두 확인되면 상위 출고가 열립니다.')"
      :confirm-label="pt('입고 확인')"
      :busy="shipReceive.isPending.value"
      @close="receivePromptOpen = false"
      @confirm="(v) => void submitShipReceive(v)"
    />
    <!-- 추가 EQ 요청 — 사유 필수(관리자에게 그대로 간다). 검증·서버 오류는 필드 아래에 적는다. -->
    <UiPromptModal
      :title="reopenPromptOpen ? reopenLabel : null"
      :fields="[{
        name: 'reason',
        label: pt('요청 사유'),
        type: 'textarea',
        required: true,
        maxlength: 2000,
        placeholder: pt('무엇을 더 확인해야 하는지 적어 주세요.'),
        hint: reopenError !== '' ? `⚠ ${reopenError}` : pt('2자 이상 적어 주세요.'),
      }]"
      :description="pt('고객 회신을 보고 더 확인할 것이 있을 때 씁니다. 발주가 발주접수로 돌아가 EQ 파일을 다시 올릴 수 있고, 샘플피씨비 담당자에게 사유가 전달됩니다.')"
      :confirm-label="reopenLabel"
      :busy="eqReopenRun.isPending.value"
      @close="reopenPromptOpen = false"
      @confirm="(v) => void submitReopen(v)"
    />
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
