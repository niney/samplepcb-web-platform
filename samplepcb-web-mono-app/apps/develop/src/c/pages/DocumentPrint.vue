<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { DEVELOP_DOC_TYPE_LABELS, developDocDecisionLabel } from '@sp/api-contract/develop-c';
import { useAuthStore } from '@sp/shared';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import { dateShort, dateTimeKst } from '../lib/format';
import DocumentContent from '../components/detail/DocumentContent.vue';

// 프로젝트 문서 인쇄용(docs/DEVELOP_FLOW.md §13) — A4 한 장. 셸이 없는 라우트(meta.bare)라 화면 자체가 종이다.
// 견적서 인쇄와 같은 관례: 문서 단건 라우트가 없어 **상세 응답에서 docId 로 고른다**(캐시도 상세와 공유).
// 서버가 보낸 판만 내려주므로 여기서 초안이 잡힐 일은 없다.

const SUPPLIER = {
  name: '샘플피씨비',
  desc: '회로 · PCB · 펌웨어 · 기구 · 앱 · 서버 개발',
  site: 'samplepcb.co.kr',
} as const;

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const documentId = computed<number | null>(() => {
  const n = Number(route.params.docId);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);
const doc = computed(() => detail.value?.documents.find((d) => d.documentId === documentId.value));

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}
</script>

<template>
  <main class="min-h-screen bg-paper py-8 print:bg-white print:py-0">
    <div v-if="!loggedIn" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">문서는 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white" @click="goLogin">로그인</button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div
      v-else-if="detailQ.isError.value || detail === undefined || doc === undefined"
      class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center"
    >
      <p class="text-body font-semibold text-red-700">
        {{ detailQ.isError.value ? errorMessage(detailQ.error.value, '문서를 불러오지 못했습니다.') : '문서를 찾을 수 없습니다.' }}
      </p>
      <RouterLink
        :to="`/requests/${String(requestId ?? 0)}`"
        class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2"
      >
        의뢰 상세로
      </RouterLink>
    </div>

    <template v-else>
      <!-- 인쇄 버튼(종이에는 안 나온다) -->
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[860px] items-center gap-2.5 px-6">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}#documents`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <!-- A4 한 장 -->
      <article class="mx-auto w-full max-w-[860px] bg-white px-10 py-11 text-tx-1 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header class="flex flex-wrap items-start gap-4 border-b-2 border-ink-950 pb-5">
          <div class="grid gap-1">
            <h1 class="text-h1 font-extrabold tracking-tight">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }}</h1>
            <p class="text-label text-tx-3">{{ SUPPLIER.name }} · {{ SUPPLIER.desc }}</p>
          </div>
          <dl class="ml-auto grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-label">
            <dt class="text-tx-3">문서번호</dt>
            <dd class="font-mono font-bold tabular-nums">{{ doc.docNo }}<span v-if="doc.version > 1"> · v{{ doc.version }}</span></dd>
            <dt class="text-tx-3">발송일</dt>
            <dd class="font-mono tabular-nums">{{ doc.sentAt === null ? '—' : dateShort(doc.sentAt) }}</dd>
            <dt class="text-tx-3">회신 요청일</dt>
            <dd class="font-mono tabular-nums">{{ doc.replyDueOn ?? '—' }}</dd>
          </dl>
        </header>

        <!-- 프로젝트 · 수신 -->
        <section class="mt-6 grid gap-5 sm:grid-cols-2">
          <div class="grid gap-1.5">
            <h2 class="text-label font-bold text-tx-3">프로젝트</h2>
            <p class="text-title font-extrabold">#{{ detail.requestId }} {{ detail.title }}</p>
          </div>
          <div class="grid gap-1.5 sm:justify-items-end sm:text-right">
            <h2 class="text-label font-bold text-tx-3">수신</h2>
            <p class="text-title font-extrabold">
              {{ detail.contact.company ?? detail.contact.name }}<span v-if="detail.contact.company !== null"> 귀중</span>
            </p>
            <p class="text-body text-tx-2">담당 {{ detail.contact.name }}</p>
          </div>
        </section>

        <!-- 본문 -->
        <section class="mt-6">
          <DocumentContent :type="doc.type" :content="doc.content" variant="print" />
        </section>

        <!-- 첨부(종이에는 목록만) -->
        <section v-if="doc.files.length > 0" class="mt-6 break-inside-avoid">
          <h2 class="text-label font-bold text-tx-3">첨부 자료</h2>
          <ul class="mt-2 grid gap-0.5 text-body">
            <li v-for="f in doc.files" :key="f.fileId">· {{ f.name }}</li>
          </ul>
        </section>

        <!-- 결정 결과 -->
        <section class="mt-7 break-inside-avoid border-t border-line pt-4">
          <h2 class="text-label font-bold text-tx-3">고객 회신</h2>
          <template v-if="doc.decision !== null">
            <p class="mt-2 text-body">
              <span class="font-extrabold">{{ developDocDecisionLabel(doc.type, doc.decision) }}</span>
              <span v-if="doc.decidedName !== null"> · {{ doc.decidedName }}</span>
              <span v-if="doc.decidedAt !== null" class="font-mono tabular-nums text-tx-2"> · {{ dateTimeKst(doc.decidedAt) }}</span>
            </p>
            <p v-if="doc.decisionNote !== null" class="mt-1.5 whitespace-pre-wrap text-body leading-relaxed text-tx-2">{{ doc.decisionNote }}</p>
          </template>
          <p v-else-if="doc.approval" class="mt-2 text-body text-tx-2">회신 대기 중입니다.</p>
          <p v-else class="mt-2 text-body text-tx-2">공유용 문서로 별도 회신 절차가 없습니다.</p>
        </section>

        <!-- 서명 · 확인 -->
        <section class="mt-7 break-inside-avoid">
          <h2 class="text-label font-bold text-tx-3">확인</h2>
          <table class="mt-2 w-full border-collapse text-body">
            <tbody>
              <tr class="border-y border-line">
                <th class="w-32 bg-paper px-3 py-3 text-left text-label font-semibold text-tx-3 print:bg-transparent">고객 확인</th>
                <td class="px-3 py-3">
                  {{ detail.contact.company ?? '' }} {{ doc.decidedName ?? detail.contact.name }}
                  <span class="ml-3 text-tx-3">(서명 / 인)</span>
                </td>
                <td class="w-40 px-3 py-3 font-mono tabular-nums text-tx-2">
                  {{ doc.decidedAt === null ? '' : dateShort(doc.decidedAt) }}
                </td>
              </tr>
              <tr class="border-b border-line">
                <th class="bg-paper px-3 py-3 text-left text-label font-semibold text-tx-3 print:bg-transparent">{{ SUPPLIER.name }}</th>
                <td class="px-3 py-3">담당자 <span class="ml-3 text-tx-3">(서명 / 인)</span></td>
                <td class="px-3 py-3" />
              </tr>
            </tbody>
          </table>
        </section>

        <p class="mt-8 text-label text-tx-3">
          본 문서는 개발의뢰 #{{ detail.requestId }} 진행 기록의 일부이며, 회신 내용은 의뢰 화면에 시각과 함께 보관됩니다.
        </p>
      </article>
    </template>
  </main>
</template>
