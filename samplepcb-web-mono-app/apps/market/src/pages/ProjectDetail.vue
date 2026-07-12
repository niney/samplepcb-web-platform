<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import {
  MARKET_BID_STATUS_LABELS,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CATEGORY_LABELS,
  MARKET_TOOL_LABELS,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_METHOD_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  apiRoutes,
} from '@sp/api-contract';
import type { MarketBidSubmitBodyType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import BidFormModal from '../components/BidFormModal.vue';
import ContractCard from '../components/ContractCard.vue';
import DiagramViewer from '../components/DiagramViewer.vue';
import RocViewer from '../components/RocViewer.vue';
import DeliverModal from '../components/DeliverModal.vue';
import NdaSignModal from '../components/NdaSignModal.vue';
import {
  useAwardBid,
  useCancelProject,
  useCloseProject,
  useMyBid,
  useProjectBids,
  useSignNda,
  useSubmitBid,
  useUpdateMyBid,
  useWithdrawMyBid,
} from '../api/useMarketBids';
import {
  useCancelContract,
  useCheckout,
  useConfirm,
  useContractQuery,
  useDeliver,
} from '../api/useMarketContract';
import { useMarketProjectDetail } from '../api/useMarketProjects';
import { useMarketSettings } from '../api/useMarketSettings';
import { downloadAuthedFile } from '../lib/download';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';
import { dateShort, ddayBadge, ddayToneClass, won } from '../lib/market-format';

// 프로젝트 상세 — 역할별 표면(프로토타입 project-detail.html 이식):
//   비로그인: 열람 + 로그인 유도 / 전문가: NDA 서명·첨부 열람·블라인드 견적 제출·수정·철회
//   소유자: 받은 견적 비교·채택·조기마감·취소. 실제 강제는 서버 가드 — 여기는 UX 분기.

const auth = useAuthStore();
const route = useRoute();
const projectId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useMarketProjectDetail(projectId);
const detail = computed(() => detailQ.data.value?.data);
const viewer = computed(() => detail.value?.viewer ?? null);
const isOwner = computed(() => viewer.value?.isOwner === true);

const canBid = computed(() => {
  const d = detail.value;
  const v = viewer.value;
  if (d === undefined || v === null) return false;
  if (v.isOwner || !v.isApprovedExpert || d.biddingClosed) return false;
  return d.method === 'open' || v.isTargetExpert;
});
// NDA 서명 자격 = 입찰 자격과 동일 집합(서버와 동일 규칙).
const canSignNda = computed(() => {
  const d = detail.value;
  return canBid.value && d !== undefined && d.ndaRequired && viewer.value?.ndaSigned === false;
});

const bidsQ = useProjectBids(projectId, isOwner);
const isExpertViewer = computed(
  () => viewer.value?.isApprovedExpert === true && !isOwner.value,
);
const myBidQ = useMyBid(projectId, isExpertViewer);
const myBid = computed(() => myBidQ.data.value?.data ?? null);
const settingsQ = useMarketSettings();
const feeRateBp = computed(() => settingsQ.data.value?.data.feeRateBp ?? 1000);

// 계약(2차) — 당사자(viewer.contract 존재)일 때만 상세 조회.
const hasContract = computed(() => viewer.value?.contract != null);
const contractQ = useContractQuery(projectId, hasContract);
const contract = computed(() => contractQ.data.value?.data);

const submitBid = useSubmitBid();
const updateBid = useUpdateMyBid();
const withdrawBid = useWithdrawMyBid();
const awardBid = useAwardBid();
const signNda = useSignNda();
const closeProject = useCloseProject();
const cancelProject = useCancelProject();
const checkout = useCheckout();
const deliver = useDeliver();
const confirmContract = useConfirm();
const cancelContract = useCancelContract();

// 모달·인라인 확인 상태 (네이티브 confirm 미사용 — 접근성·자동화 친화)
const ndaOpen = ref(false);
const bidOpen = ref(false);
const bidMode = ref<'create' | 'edit'>('create');
const modalError = ref('');
const actionError = ref('');
const confirmAwardId = ref<number | null>(null);
const confirmAction = ref<'close' | 'cancel' | 'withdraw' | null>(null);
const reportOpen = ref(false);
const reportError = ref('');

const dday = computed(() => (detail.value !== undefined ? ddayBadge(detail.value) : null));

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

function openBidModal(mode: 'create' | 'edit'): void {
  bidMode.value = mode;
  modalError.value = '';
  bidOpen.value = true;
}

async function onSignNda(signedName: string): Promise<void> {
  if (projectId.value === null) return;
  modalError.value = '';
  try {
    await signNda.mutateAsync({ projectId: projectId.value, body: { agree: true, signedName } });
    ndaOpen.value = false;
  } catch (err) {
    modalError.value = errorMessage(err);
  }
}

async function onSubmitBid(body: MarketBidSubmitBodyType): Promise<void> {
  if (projectId.value === null) return;
  modalError.value = '';
  try {
    if (bidMode.value === 'create') {
      await submitBid.mutateAsync({ projectId: projectId.value, body });
    } else {
      await updateBid.mutateAsync({ projectId: projectId.value, body });
    }
    bidOpen.value = false;
  } catch (err) {
    modalError.value = errorMessage(err);
  }
}

async function onWithdraw(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await withdrawBid.mutateAsync(projectId.value);
    confirmAction.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onAward(bidId: number): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await awardBid.mutateAsync({ projectId: projectId.value, bidId });
    confirmAwardId.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onProjectAction(kind: 'close' | 'cancel'): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    if (kind === 'close') await closeProject.mutateAsync(projectId.value);
    else await cancelProject.mutateAsync(projectId.value);
    confirmAction.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await downloadAuthedFile(
      `${apiRoutes.marketProjects}/${String(projectId.value)}/files/${String(fileId)}`,
      name,
    );
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

// ── 계약(2차) 액션 ──────────────────────────────────────────────────────────
async function onCheckout(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    // 결제 직전 me 재발급 — JWT cartId 클레임이 10분 스테일이면 주입이 옛 버킷으로 감(거버 관례).
    await auth.bootstrap();
    const res = await checkout.mutateAsync(projectId.value);
    window.location.assign(res.data.redirectUrl);
  } catch (err) {
    actionError.value = errorMessage(err);
    // ORDER_PENDING(무통장 대기)·ALREADY_PAID 등은 계약 재조회로 결제 파생 상태를 갱신.
    void contractQ.refetch();
  }
}

async function onConfirmContract(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await confirmContract.mutateAsync(projectId.value);
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onCancelContract(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await cancelContract.mutateAsync(projectId.value);
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

function openReport(): void {
  reportError.value = '';
  reportOpen.value = true;
}

async function onSubmitReport(payload: { note: string; files: File[] }): Promise<void> {
  if (projectId.value === null) return;
  reportError.value = '';
  const fd = new FormData();
  if (payload.note !== '') fd.append('note', payload.note);
  for (const f of payload.files) fd.append('deliverable', f);
  try {
    await deliver.mutateAsync({ projectId: projectId.value, form: fd });
    reportOpen.value = false;
  } catch (err) {
    reportError.value = errorMessage(err);
  }
}

async function downloadContractFile(fileId: number, name: string): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await downloadAuthedFile(
      `${apiRoutes.marketProjects}/${String(projectId.value)}/contract/files/${String(fileId)}`,
      name,
    );
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toString()}KB`;
</script>

<template>
  <section class="mx-auto w-full max-w-6xl px-4 py-10">
    <div v-if="detailQ.isLoading.value" class="py-20 text-center text-sm text-tx-3">
      {{ $t('common.loading') }}
    </div>

    <div
      v-else-if="detail === undefined"
      class="rounded-2xl border border-line bg-white p-14 text-center"
    >
      <p class="text-sm text-tx-3">프로젝트를 찾을 수 없습니다.</p>
      <RouterLink
        to="/projects"
        class="mt-4 inline-block rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
      >
        {{ $t('nav.projects') }}
      </RouterLink>
    </div>

    <template v-else>
      <!-- 헤더 -->
      <div class="rounded-2xl border border-line bg-white p-6 sm:p-8">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="font-mono text-[11px] tracking-widest text-tx-3">
            PRJ-{{ String(detail.projectId).padStart(4, '0') }}
          </span>
          <span
            v-if="dday !== null"
            class="rounded-md px-2 py-0.5 font-bold"
            :class="ddayToneClass[dday.tone]"
          >
            {{ dday.label }}
          </span>
          <span class="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">
            {{ MARKET_REQUEST_TYPE_LABELS[detail.requestType] }} · {{ detail.serviceAreas.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join(' · ') }}
          </span>
          <span
            class="rounded-full px-2 py-0.5 font-semibold"
            :class="detail.method === 'open' ? 'bg-copper-50 text-copper-600' : 'bg-ink-900 text-white'"
          >
            {{ MARKET_METHOD_LABELS[detail.method] }}
          </span>
          <span v-if="detail.ndaRequired" class="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">
            🔏 NDA
          </span>
        </div>
        <h1 class="mt-3 text-2xl font-extrabold leading-snug text-tx-1">{{ detail.title }}</h1>
        <div class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-tx-2">
          <span>의뢰인 <b class="text-tx-1">{{ detail.ownerName }}</b></span>
          <span>예산 <b class="text-tx-1">{{ MARKET_BUDGET_RANGE_LABELS[detail.budgetRange] }}</b></span>
          <span>
            마감 <b class="text-tx-1">{{ dateShort(detail.bidDeadlineAt) }}</b>
          </span>
          <span>견적 <b class="text-tx-1">{{ detail.bidCount }}건</b></span>
          <span>조회 {{ detail.viewCount }}</span>
          <span>{{ dateShort(detail.createdAt) }} 등록</span>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <!-- 본문 -->
        <div class="grid gap-4">
          <div class="rounded-2xl border border-line bg-white p-6">
            <p class="font-mono text-[11px] tracking-widest text-tx-3">BRIEF</p>
            <h2 class="mt-1 text-sm font-extrabold text-tx-1">상세 설명</h2>
            <p class="mt-3 whitespace-pre-line text-sm leading-relaxed text-tx-2">
              {{ detail.description }}
            </p>
            <div class="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-4 text-xs text-tx-2">
              <span v-if="detail.categories.length > 0">
                세부분야:
                <b class="text-tx-1">{{ detail.categories.map((c) => MARKET_CATEGORY_LABELS[c]).join(' · ') }}</b>
              </span>
              <span>
                요구 툴:
                <b class="text-tx-1">{{ detail.cadTools.length > 0 ? detail.cadTools.map((c) => MARKET_TOOL_LABELS[c]).join(' · ') : '특정 툴 요구 없음' }}</b>
              </span>
              <span v-if="detail.startHopeDate !== null">시작 희망 {{ detail.startHopeDate }}</span>
              <span v-if="detail.dueHopeDate !== null">완료 희망 {{ detail.dueHopeDate }}</span>
            </div>
          </div>

          <!-- AI 시스템 구성도 — sandbox iframe 전용(LLM 산출 HTML, DOM 직결 금지) -->
          <div v-if="detail.diagramHtml !== null" class="rounded-2xl border border-line bg-white p-6">
            <p class="font-mono text-[11px] tracking-widest text-tx-3">SYSTEM DIAGRAM</p>
            <h2 class="mt-1 text-sm font-extrabold text-tx-1">
              시스템 구성도 <span class="font-normal text-tx-3">(AI 자동 생성 초안 · 클릭하면 크게 보기)</span>
            </h2>
            <div class="mt-3">
              <DiagramViewer :html="detail.diagramHtml" />
            </div>
          </div>

          <!-- AI 작업검토지시서 — 마크다운 라인 파서 렌더(v-html 금지) -->
          <div v-if="detail.rocMd !== null" class="rounded-2xl border border-line bg-white p-6">
            <p class="font-mono text-[11px] tracking-widest text-tx-3">WORK REVIEW DOC</p>
            <h2 class="mt-1 text-sm font-extrabold text-tx-1">
              작업검토지시서 <span class="font-normal text-tx-3">(AI 자동 생성 초안 · 미확정 값은 TBD)</span>
            </h2>
            <div class="mt-3">
              <RocViewer :md="detail.rocMd" />
            </div>
          </div>

          <!-- 첨부 (NDA 게이트) -->
          <div class="rounded-2xl border border-line bg-white p-6">
            <p class="font-mono text-[11px] tracking-widest text-tx-3">FILES</p>
            <h2 class="mt-1 text-sm font-extrabold text-tx-1">
              첨부 자료 <span class="font-normal text-tx-3">({{ detail.attachments.count }}개)</span>
            </h2>

            <template v-if="detail.attachments.files !== null">
              <ul v-if="detail.attachments.files.length > 0" class="mt-3 grid gap-2">
                <li
                  v-for="f in detail.attachments.files"
                  :key="f.fileId"
                  class="flex items-center gap-3 rounded-xl border border-line px-4 py-2.5 text-sm"
                >
                  <span class="text-base">📎</span>
                  <span class="min-w-0 flex-1 truncate text-tx-1">{{ f.name }}</span>
                  <span class="text-xs text-tx-3">{{ fmtSize(f.size) }}</span>
                  <button
                    v-if="auth.isLoggedIn"
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-copper-400 hover:text-copper-600"
                    @click="downloadFile(f.fileId, f.name)"
                  >
                    다운로드
                  </button>
                </li>
              </ul>
              <p v-else class="mt-3 text-xs text-tx-3">첨부된 자료가 없습니다.</p>
            </template>

            <div v-else class="mt-3 rounded-xl bg-paper p-5 text-center">
              <p class="text-sm font-bold text-tx-1">🔏 NDA 서명 후 열람할 수 있습니다</p>
              <p class="mt-1 text-xs leading-relaxed text-tx-3">
                파일명·내용은 비밀유지 서명자에게만 공개됩니다.
              </p>
              <button
                v-if="canSignNda"
                type="button"
                class="mt-3 rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800"
                @click="ndaOpen = true"
              >
                NDA 전자서명
              </button>
              <p v-else-if="viewer === null" class="mt-2 text-xs text-tx-3">
                열람 자격(승인 전문가)은 로그인 후 확인됩니다.
              </p>
            </div>
          </div>

          <!-- 소유자: 받은 견적 비교 -->
          <div v-if="isOwner" class="rounded-2xl border border-line bg-white p-6">
            <p class="font-mono text-[11px] tracking-widest text-tx-3">BIDS</p>
            <h2 class="mt-1 text-sm font-extrabold text-tx-1">받은 견적</h2>

            <div v-if="(bidsQ.data.value?.data.items ?? []).length === 0" class="mt-3 rounded-xl bg-paper p-6 text-center text-xs text-tx-3">
              아직 도착한 견적이 없습니다. 견적이 오면 이메일로 알려드립니다.
            </div>
            <div v-else class="mt-3 grid gap-3">
              <div
                v-for="b in bidsQ.data.value?.data.items ?? []"
                :key="b.bidId"
                class="rounded-xl border p-4"
                :class="b.status === 'awarded' ? 'border-copper-400 bg-copper-50' : 'border-line'"
              >
                <div class="flex flex-wrap items-center gap-2 text-sm">
                  <b class="text-tx-1">{{ b.expert.displayName }}</b>
                  <span class="text-xs text-tx-3">
                    {{ MARKET_EXPERT_TYPE_LABELS[b.expert.expertType] }} ·
                    경력 {{ MARKET_CAREER_RANGE_LABELS[b.expert.careerRange] }}
                  </span>
                  <span
                    class="ml-auto rounded-md px-2 py-0.5 text-[11px] font-bold"
                    :class="
                      b.status === 'awarded'
                        ? 'bg-copper-500 text-white'
                        : b.status === 'submitted'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-line text-tx-3'
                    "
                  >
                    {{ MARKET_BID_STATUS_LABELS[b.status] }}
                  </span>
                </div>
                <div class="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-tx-2">
                  <span>금액 <b class="text-base font-extrabold text-tx-1">{{ won(b.amount) }}</b></span>
                  <span>기간 <b class="text-tx-1">{{ b.durationDays }}일</b></span>
                  <span v-if="b.warranty !== null">하자보수 {{ b.warranty }}</span>
                  <span class="text-tx-3">{{ dateShort(b.updatedAt) }} 제출</span>
                </div>
                <p class="mt-2 whitespace-pre-line rounded-lg bg-paper p-3 text-xs leading-relaxed text-tx-2">
                  {{ b.message }}
                </p>
                <div v-if="b.status === 'submitted' && detail.status !== 'awarded' && detail.status !== 'cancelled'" class="mt-3 flex justify-end gap-2">
                  <template v-if="confirmAwardId === b.bidId">
                    <span class="self-center text-xs font-bold text-tx-2">이 견적으로 확정할까요?</span>
                    <button
                      type="button"
                      class="rounded-lg bg-copper-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
                      :disabled="awardBid.isPending.value"
                      @click="onAward(b.bidId)"
                    >
                      {{ awardBid.isPending.value ? '처리 중…' : '확정' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2"
                      @click="confirmAwardId = null"
                    >
                      취소
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="rounded-lg bg-ink-900 px-4 py-1.5 text-xs font-bold text-white hover:bg-ink-800"
                    @click="confirmAwardId = b.bidId"
                  >
                    채택
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 사이드바 -->
        <aside class="grid h-fit gap-4">
          <!-- 비로그인 -->
          <div v-if="viewer === null" class="rounded-2xl border border-line bg-white p-5 text-center">
            <p class="text-sm font-bold text-tx-1">견적을 제출하려면</p>
            <p class="mt-1 text-xs text-tx-3">로그인 후 전문가 자격이 확인됩니다.</p>
            <button
              type="button"
              class="mt-3 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
              @click="goLogin"
            >
              {{ $t('auth.login') }}
            </button>
          </div>

          <!-- 계약 진행(당사자: 의뢰인·채택 전문가) — 채택 후 결제·납품·검수·정산 -->
          <template v-else-if="viewer.contract !== null">
            <ContractCard
              v-if="contract !== undefined"
              :contract="contract"
              :is-owner="isOwner"
              :checkout-pending="checkout.isPending.value"
              :confirm-pending="confirmContract.isPending.value"
              :cancel-pending="cancelContract.isPending.value"
              :error="actionError"
              @checkout="onCheckout"
              @confirm="onConfirmContract"
              @cancel="onCancelContract"
              @report="openReport"
              @download="downloadContractFile"
            />
            <div v-else class="rounded-2xl border border-line bg-white p-5 text-sm text-tx-3">
              계약 정보를 불러오는 중…
            </div>
          </template>

          <!-- 소유자 액션 -->
          <div v-else-if="isOwner" class="rounded-2xl border border-line bg-white p-5">
            <p class="text-sm font-extrabold text-tx-1">내 프로젝트</p>
            <p class="mt-1 text-xs leading-relaxed text-tx-3">
              받은 견적 {{ detail.bidCount }}건 · 채택하면 나머지 견적은 자동 종결됩니다.
            </p>
            <div v-if="detail.status === 'bidding' && !detail.biddingClosed" class="mt-3 grid gap-2">
              <template v-if="confirmAction === 'close'">
                <p class="text-xs font-bold text-tx-2">견적 접수를 조기 마감할까요?</p>
                <div class="flex gap-2">
                  <button type="button" class="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-xs font-bold text-white" :disabled="closeProject.isPending.value" @click="onProjectAction('close')">확인</button>
                  <button type="button" class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2" @click="confirmAction = null">취소</button>
                </div>
              </template>
              <button
                v-else
                type="button"
                class="rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
                @click="confirmAction = 'close'"
              >
                조기 마감
              </button>
            </div>
            <div v-if="detail.status !== 'cancelled' && detail.status !== 'awarded'" class="mt-2 grid gap-2">
              <template v-if="confirmAction === 'cancel'">
                <p class="text-xs font-bold text-red-600">프로젝트를 취소할까요? 되돌릴 수 없습니다.</p>
                <div class="flex gap-2">
                  <button type="button" class="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white" :disabled="cancelProject.isPending.value" @click="onProjectAction('cancel')">취소 확정</button>
                  <button type="button" class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2" @click="confirmAction = null">닫기</button>
                </div>
              </template>
              <button
                v-else
                type="button"
                class="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-500 hover:border-red-400"
                @click="confirmAction = 'cancel'"
              >
                프로젝트 취소
              </button>
            </div>
          </div>

          <!-- 전문가 액션 -->
          <div v-else class="rounded-2xl border border-line bg-white p-5">
            <p class="text-sm font-extrabold text-tx-1">견적 제출</p>

            <!-- 내 입찰 있음 -->
            <template v-if="myBid !== null">
              <div class="mt-3 rounded-xl bg-paper p-3 text-xs text-tx-2">
                <p>
                  내 견적:
                  <b class="text-tx-1">{{ won(myBid.amount) }}</b> · {{ myBid.durationDays }}일
                </p>
                <p class="mt-1">
                  상태:
                  <b class="text-copper-600">{{ MARKET_BID_STATUS_LABELS[myBid.status] }}</b>
                </p>
              </div>
              <div
                v-if="(myBid.status === 'submitted' || myBid.status === 'withdrawn') && !detail.biddingClosed"
                class="mt-3 grid gap-2"
              >
                <button
                  type="button"
                  class="rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-ink-800"
                  @click="openBidModal('edit')"
                >
                  {{ myBid.status === 'withdrawn' ? '다시 제출' : '견적 수정' }}
                </button>
                <template v-if="myBid.status === 'submitted'">
                  <template v-if="confirmAction === 'withdraw'">
                    <p class="text-xs font-bold text-tx-2">견적을 철회할까요?</p>
                    <div class="flex gap-2">
                      <button type="button" class="flex-1 rounded-lg bg-ink-900 px-3 py-2 text-xs font-bold text-white" :disabled="withdrawBid.isPending.value" @click="onWithdraw">확인</button>
                      <button type="button" class="flex-1 rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2" @click="confirmAction = null">취소</button>
                    </div>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="rounded-lg border border-line px-3 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
                    @click="confirmAction = 'withdraw'"
                  >
                    철회
                  </button>
                </template>
              </div>
            </template>

            <!-- 입찰 가능 -->
            <template v-else-if="canBid">
              <p class="mt-1 text-xs leading-relaxed text-tx-3">
                견적은 의뢰인만 볼 수 있습니다(블라인드).
                <template v-if="detail.ndaRequired && viewer.ndaSigned === false">
                  첨부 열람에는 NDA 서명이 필요합니다.
                </template>
              </p>
              <button
                type="button"
                class="mt-3 w-full rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-copper-600"
                @click="openBidModal('create')"
              >
                블라인드 견적 제출
              </button>
              <button
                v-if="canSignNda"
                type="button"
                class="mt-2 w-full rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
                @click="ndaOpen = true"
              >
                🔏 NDA 서명하고 첨부 열람
              </button>
            </template>

            <!-- 자격 없음 -->
            <template v-else>
              <p class="mt-1 text-xs leading-relaxed text-tx-3">
                <template v-if="detail.biddingClosed">견적 접수가 마감되었습니다.</template>
                <template v-else-if="detail.method === 'targeted' && viewer.isTargetExpert === false">
                  지정견적 프로젝트 — 지정된 전문가만 참여할 수 있습니다.
                </template>
                <template v-else-if="viewer.isApprovedExpert === false">
                  승인된 전문가만 견적을 제출할 수 있습니다.
                </template>
              </p>
              <RouterLink
                v-if="viewer.isApprovedExpert === false"
                to="/expert/register"
                class="mt-3 block rounded-lg bg-ink-900 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-ink-800"
              >
                {{ $t('nav.expertRegister') }}
              </RouterLink>
            </template>
          </div>

          <!-- 안전거래 안내 (계약 전) -->
          <div
            v-if="viewer?.contract == null"
            class="rounded-2xl bg-ink-900 p-5 text-xs leading-relaxed text-dk-tx-2"
          >
            <p class="font-bold text-dk-tx-1">🛡️ 안전거래 안내</p>
            <p class="mt-1.5">
              견적은 블라인드로 보호되고, NDA 서명 기록이 남습니다. 계약·결제는 채택 후
              샘플피씨비가 순차 안내드립니다.
            </p>
          </div>

          <p
            v-if="actionError !== '' && viewer?.contract == null"
            class="text-xs font-semibold text-red-600"
          >
            {{ actionError }}
          </p>
        </aside>
      </div>

      <!-- 모달 -->
      <NdaSignModal
        :open="ndaOpen"
        :nda-text="detail.ndaText"
        :nda-version="detail.ndaTextVersion"
        :pending="signNda.isPending.value"
        :error="modalError"
        @close="ndaOpen = false"
        @sign="onSignNda"
      />
      <BidFormModal
        :open="bidOpen"
        :mode="bidMode"
        :initial="myBid"
        :fee-rate-bp="feeRateBp"
        :pending="submitBid.isPending.value || updateBid.isPending.value"
        :error="modalError"
        @close="bidOpen = false"
        @submit="onSubmitBid"
      />
      <DeliverModal
        :open="reportOpen"
        :is-report="contract !== undefined && contract.status === 'delivered'"
        :pending="deliver.isPending.value"
        :error="reportError"
        @close="reportOpen = false"
        @submit="onSubmitReport"
      />
    </template>
  </section>
</template>
