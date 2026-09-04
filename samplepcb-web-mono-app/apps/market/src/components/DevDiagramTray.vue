<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { MARKET_DEV_DIAGRAM_STATUS_LABELS } from '@sp/api-contract';
import type { MyDevDiagramItemType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { useMyDevDiagrams } from '../api/useMyDevDiagrams';

// 시스템 구성도 플로팅 트레이(docs/AI_DEV_REVIEW.md §13.7) — 어느 페이지에 있든 우하단에서 내 구성도의
// 진행·완료를 알린다. 진행 중이면 알약(경과 시간), 완료·실패·생략은 "보기" 를 누르거나 닫을 때까지 남는다
// (닫은 건 localStorage 에 기억해 다시 안 뜬다). 완료 알림은 **이 브라우저가 진행 중인 것을 본 적 있는 건**만
// 띄운다(다른 기기·앱을 닫았다 온 사람은 메일로) — 안 그러면 24시간 전 완료분이 위저드 중에 튀어나와 헷갈린다.
// 위저드(/request)에서는 진행 중만 보인다. 진행 중 0건·알릴 것 0건이면 렌더하지 않는다.
// 진행률 % 는 없다(LLM 이 주지 않는다) — 경과 시간 + 불확정 바.

const auth = useAuthStore();
const loggedIn = computed(() => auth.isLoggedIn);
const query = useMyDevDiagrams(loggedIn);
const items = computed<MyDevDiagramItemType[]>(() => query.data.value?.data.items ?? []);

const isActive = (i: MyDevDiagramItemType): boolean => i.meta.status === 'queued' || i.meta.status === 'running';
const DISMISS_KEY = 'sp-market:dev-diagram-dismissed';
const WATCHED_KEY = 'sp-market:dev-diagram-watched';
const route = useRoute();
const onWizard = computed(() => route.path.startsWith('/request'));
const dismissed = ref<Record<string, string>>({}); // projectId → 닫은 시점의 generatedAt|requestedAt
const watched = ref<Record<string, string>>({}); // projectId → 진행 중으로 본 requestedAt
const storageKey = (i: MyDevDiagramItemType): string => i.meta.generatedAt ?? i.meta.requestedAt;
onMounted(() => {
  try {
    dismissed.value = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '{}') as Record<string, string>;
    watched.value = JSON.parse(localStorage.getItem(WATCHED_KEY) ?? '{}') as Record<string, string>;
  } catch {
    dismissed.value = {};
    watched.value = {};
  }
});
// 진행 중인 것을 보면 기억한다 — 완료 알림은 이 기록이 있는 건만.
watch(items, (list) => {
  const next = { ...watched.value };
  let changed = false;
  for (const i of list) {
    if (isActive(i) && next[String(i.projectId)] !== i.meta.requestedAt) {
      next[String(i.projectId)] = i.meta.requestedAt;
      changed = true;
    }
  }
  if (!changed) return;
  watched.value = next;
  try {
    localStorage.setItem(WATCHED_KEY, JSON.stringify(next));
  } catch {
    /* 무시 */
  }
});
function dismiss(i: MyDevDiagramItemType): void {
  dismissed.value = { ...dismissed.value, [String(i.projectId)]: storageKey(i) };
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed.value));
  } catch {
    /* 저장 실패는 무시 — 새로고침하면 다시 보일 뿐 */
  }
}

const active = computed(() => items.value.filter(isActive));
const finished = computed(() =>
  onWizard.value
    ? []
    : items.value.filter(
        (i) => !isActive(i) && watched.value[String(i.projectId)] === i.meta.requestedAt && dismissed.value[String(i.projectId)] !== storageKey(i),
      ),
);
const visible = computed(() => active.value.length + finished.value.length > 0);

// 경과 초 — 로컬 1초 타이머(폴링은 10초라 표시가 툭툭 끊긴다).
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;
watch(
  () => active.value.length > 0,
  (on) => {
    if (on && timer === null) timer = setInterval(() => (now.value = Date.now()), 1000);
    if (!on && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  },
  { immediate: true },
);
const elapsedLabel = (i: MyDevDiagramItemType): string => {
  const secs = Math.max(0, Math.round((now.value - new Date(i.meta.requestedAt).getTime()) / 1000));
  return secs < 60 ? `${String(secs)}초` : `${String(Math.floor(secs / 60))}분 ${String(secs % 60)}초`;
};

const open = ref(false);
const statusClass = (s: string): string =>
  s === 'done' ? 'bg-emerald-100 text-emerald-700' : s === 'error' ? 'bg-red-100 text-red-700' : s === 'skipped' ? 'bg-line text-tx-3' : 'bg-copper-50 text-copper-700';
const headline = computed(() => {
  if (active.value.length > 0) return `시스템 구성도 생성 중 ${String(active.value.length)}건`;
  const done = finished.value.filter((i) => i.meta.status === 'done').length;
  if (done > 0) return `시스템 구성도가 완성됐습니다 (${String(done)}건)`;
  return '시스템 구성도 알림';
});
</script>

<template>
  <div v-if="visible" class="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))]">
    <!-- 펼친 패널 -->
    <div v-if="open" class="mb-2 overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
      <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p class="text-xs font-extrabold text-tx-1">시스템 구성도</p>
        <button type="button" class="text-xs font-bold text-tx-3 hover:text-tx-1" @click="open = false">접기 ⌄</button>
      </div>
      <ul class="max-h-[50vh] divide-y divide-line overflow-auto">
        <li v-for="i in [...active, ...finished]" :key="i.projectId" class="grid gap-1.5 px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold" :class="statusClass(i.meta.status)">
              {{ MARKET_DEV_DIAGRAM_STATUS_LABELS[i.meta.status] }}
            </span>
            <RouterLink :to="`/projects/${String(i.projectId)}`" class="min-w-0 flex-1 truncate text-xs font-bold text-tx-1 hover:text-copper-600" @click="open = false">
              {{ i.title }}
            </RouterLink>
          </div>
          <template v-if="isActive(i)">
            <div class="h-1 overflow-hidden rounded-full bg-line">
              <div class="tray-bar h-full w-1/3 rounded-full bg-copper-500" />
            </div>
            <p class="text-[11px] text-tx-3">경과 {{ elapsedLabel(i) }} · 보통 5~10분 걸립니다. 화면을 벗어나도 계속 만들어집니다.</p>
          </template>
          <template v-else>
            <p class="text-[11px] text-tx-3">
              <template v-if="i.meta.status === 'done'">완성됐습니다{{ i.meta.elapsedSecs === null ? '' : ` · ${String(Math.round(i.meta.elapsedSecs / 60))}분 소요` }}.</template>
              <template v-else-if="i.meta.status === 'skipped'">{{ i.meta.skipReason ?? '자료가 부족해 만들지 않았습니다.' }}</template>
              <template v-else>생성에 실패했습니다{{ i.meta.error === null ? '' : ` (${i.meta.error})` }}. 상세에서 다시 만들 수 있습니다.</template>
            </p>
            <div class="flex gap-2">
              <RouterLink :to="`/projects/${String(i.projectId)}`" class="rounded-lg bg-ink-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-ink-800" @click="dismiss(i); open = false">
                보기
              </RouterLink>
              <button type="button" class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2" @click="dismiss(i)">닫기</button>
            </div>
          </template>
        </li>
      </ul>
    </div>

    <!-- 알약 -->
    <button
      type="button"
      class="ml-auto flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold shadow-lg transition"
      :class="active.length > 0 ? 'border-copper-300 bg-white text-copper-700' : 'border-emerald-300 bg-emerald-50 text-emerald-800'"
      @click="open = !open"
    >
      <span v-if="active.length > 0" class="tray-dot h-2 w-2 rounded-full bg-copper-500" />
      <span v-else>✓</span>
      <span>{{ headline }}</span>
      <span v-if="active.length > 0" class="font-normal text-tx-3">· {{ elapsedLabel(active[0]!) }}</span>
    </button>
  </div>
</template>

<style scoped>
.tray-bar { animation: tray-slide 1.6s ease-in-out infinite; }
.tray-dot { animation: tray-pulse 1.2s ease-in-out infinite; }
@keyframes tray-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(300%); } }
@keyframes tray-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
