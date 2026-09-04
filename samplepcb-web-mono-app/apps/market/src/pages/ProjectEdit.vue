<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  MARKET_AREAS,
  MARKET_BUDGET_RANGES,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_DEADLINE_PRESETS,
  marketQuestionsFor,
  marketRequiredMissing,
  sortMarketAreas,
} from '@sp/api-contract';
import type {
  MarketAnswerType,
  MarketBudgetRangeType,
  MarketProjectDeadlineType,
  MarketQuestionDef,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import {
  useAddProjectFiles,
  useDeleteProjectFile,
  useMarketProjectDetail,
  useRegenerateDevReview,
  useRequestDevDiagram,
  useUpdateProject,
} from '../api/useMarketProjects';
import { useDevReviewStatus } from '../api/useAi';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';
import AreaIcon from '../components/AreaIcon.vue';
import FileDropZone from '../components/request/FileDropZone.vue';
import QuestionField from '../components/request/QuestionField.vue';
import SaveResultModal from '../components/SaveResultModal.vue';
import type { QuestionState } from '../composables/useRequestWizardForm';

// 의뢰 수정(docs/MARKET_FLOW.md §의뢰 수정·버전) — 접수 중이면 견적이 들어온 뒤에도 고칠 수 있다.
// 등록 위저드를 재사용하지 않는다: 위저드는 AI 잡 오케스트레이션까지 소유해서 수정 경로에 끌고 오면
// 검토서를 다시 돌리게 된다. 대신 문항·분야 카드 컴포넌트(QuestionField·AreaIcon·FileDropZone)만 빌려 쓴다.
// 필드는 [저장]으로 한 번에, 첨부는 '첨부 올리기'로 즉시 또는 저장할 때 함께 올라간다(파일서버 왕복이라
// 되돌릴 지점이 다르다) — 화면에 명시한다.

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const projectId = computed(() => {
  const raw = route.params.id;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const detail = useMarketProjectDetail(projectId);
const project = computed(() => detail.data.value?.data ?? null);
const isOwner = computed(() => project.value?.viewer?.isOwner === true);
const editable = computed(() => project.value !== null && !project.value.biddingClosed);

const update = useUpdateProject(projectId);
const addFiles = useAddProjectFiles(projectId);
const deleteFile = useDeleteProjectFile(projectId);

// ── 폼 상태 — 상세가 오면 한 번 채운다(그 뒤 서버 갱신이 입력을 덮지 않게 loaded 로 잠근다) ──
const loaded = ref(false);
const title = ref('');
const description = ref('');
const serviceAreas = ref<string[]>([]);
const budgetRange = ref<MarketBudgetRangeType>('undecided');
const ndaRequired = ref(true);
const deadlineMode = ref<'3' | '7' | '14' | 'date'>('date');
const deadlineDate = ref('');
// 마감은 **손댔을 때만** 보낸다 — 안 그러면 저장만 눌러도 "지금 마감일의 23:59" 로 밀려
// 중대한 수정(입찰자 경고)이 공짜로 발생한다(등록은 시각까지 있는 값이라 날짜 입력과 어긋난다).
const deadlineTouched = ref(false);
const questionState = reactive<Record<string, QuestionState>>({});
const newFiles = ref<File[]>([]);

const kstDate = (iso: string): string => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

watch(project, (p) => {
  if (p === null || loaded.value) return;
  title.value = p.title;
  description.value = p.description;
  serviceAreas.value = [...p.serviceAreas];
  budgetRange.value = p.budgetRange;
  ndaRequired.value = p.ndaRequired;
  deadlineMode.value = 'date';
  deadlineDate.value = kstDate(p.bidDeadlineAt);
  for (const a of p.answers) questionState[a.code] = { choices: [...a.choices], note: a.note ?? '' };
  loaded.value = true;
}, { immediate: true });

function stateOf(code: string): QuestionState {
  const s = questionState[code];
  if (s !== undefined) return s;
  const created: QuestionState = { choices: [], note: '' };
  questionState[code] = created;
  return created;
}
function toggleChoice(q: MarketQuestionDef, choice: string): void {
  const state = stateOf(q.code);
  if (!q.multi) {
    state.choices = state.choices[0] === choice ? [] : [choice];
    return;
  }
  const i = state.choices.indexOf(choice);
  if (i >= 0) state.choices.splice(i, 1);
  else state.choices.push(choice);
}
function toggleArea(code: string): void {
  const i = serviceAreas.value.indexOf(code);
  if (i >= 0) serviceAreas.value.splice(i, 1);
  else serviceAreas.value.push(code);
}

const questions = computed(() => marketQuestionsFor(serviceAreas.value));
const conditionQuestions = computed(() => questions.value.filter((q) => q.required === true));
const otherQuestions = computed(() => questions.value.filter((q) => q.required !== true));

const answers = computed<MarketAnswerType[]>(() =>
  questions.value.flatMap((q) => {
    const state = questionState[q.code];
    if (state === undefined || state.choices.length === 0) return [];
    const note = state.note.trim();
    return [{ code: q.code, choices: [...state.choices], ...(note !== '' ? { note } : {}) }];
  }),
);
const requiredMissing = computed(() => marketRequiredMissing(answers.value, serviceAreas.value));
const noteMissingCodes = computed<string[]>(() =>
  questions.value.flatMap((q) => {
    const state = questionState[q.code];
    if (state === undefined || state.choices.length === 0) return [];
    const required = q.noteRequiredFor?.some((c) => state.choices.includes(c)) ?? false;
    return required && state.note.trim() === '' ? [q.code] : [];
  }),
);

const canSave = computed(
  () =>
    editable.value &&
    title.value.trim().length >= 2 &&
    description.value.trim().length >= 10 &&
    serviceAreas.value.length > 0 &&
    requiredMissing.value.length === 0 &&
    noteMissingCodes.value.length === 0 &&
    (deadlineMode.value !== 'date' || deadlineDate.value >= todayKst),
);

const saveError = ref('');
const saved = ref<{ revNo: number | null; major: boolean; deadlineExtendedTo: string | null } | null>(null);

function deadlinePayload(): MarketProjectDeadlineType {
  return deadlineMode.value === 'date'
    ? { date: deadlineDate.value }
    : { days: Number(deadlineMode.value) as 3 | 7 | 14 };
}

// 저장 = 편집의 끝(§11.5). 결과를 알릴 것이 있으면 모달 하나로 묻고, 어느 쪽을 고르든 상세로 나간다.
// 알릴 것이 없으면(검토서가 없거나 낡지 않았으면) 모달 없이 바로 상세로 — 흔한 경우에 클릭이 늘지 않게.
const aiStatus = useDevReviewStatus();
const regenerating = ref(false);
const regenerate = useRegenerateDevReview(projectId);
const requestDiagram = useRequestDevDiagram(projectId);

async function save(): Promise<void> {
  saveError.value = '';
  saved.value = null;
  try {
    // 고른 첨부를 올리지 않고 저장하면 그대로 사라진다 — 저장이 곧 이탈이라 여기서 먼저 올린다.
    // 올리기가 실패하면 여기서 던져져 저장이 멈춘다(에러를 삼키고 나가면 파일도 에러도 사라진다).
    const uploaded = newFiles.value.length > 0 ? await uploadPending() : null;
    // 바뀐 필드만 고르지 않는다 — 서버가 스냅샷으로 견주므로 같은 값은 이력에 남지 않는다.
    const res = await update.mutateAsync({
      title: title.value.trim(),
      serviceAreas: sortMarketAreas(serviceAreas.value),
      description: description.value.trim(),
      answers: answers.value,
      budgetRange: budgetRange.value,
      ndaRequired: ndaRequired.value,
      ...(deadlineTouched.value ? { deadline: deadlinePayload() } : {}),
    });
    // 첨부 올리기와 PATCH 는 판을 따로 남긴다(첨부 v2 · 필드 v3). 사용자에겐 한 번의 저장이니
    // 마지막 판 번호와 "둘 중 하나라도 중대" 로 합쳐 한 번만 알린다.
    const result = {
      ...res.data,
      revNo: res.data.revNo ?? uploaded?.revNo ?? null,
      major: res.data.major || (uploaded?.major ?? false),
    };
    saved.value = result;
    await detail.refetch();
    const stale = project.value?.devReviewStale === true && aiStatus.data.value?.data.enabled === true;
    // 알릴 것 = 검토서가 낡았거나 · 마감이 자동 연장됐거나 · 입찰자에게 경고가 나갈 때.
    if (stale || result.deadlineExtendedTo !== null || result.major) {
      modalStale.value = stale;
      modalOpen.value = true;
      return;
    }
    goDetail(result.revNo);
  } catch (err) {
    saveError.value = errorMessage(err);
  }
}

// 결과 모달 — 두 버튼 모두 상세로 나간다.
const modalOpen = ref(false);
const modalStale = ref(false);
async function onRegenerate(alsoDiagram: boolean): Promise<void> {
  saveError.value = '';
  regenerating.value = true;
  try {
    const res = await regenerate.mutateAsync();
    // 구성도는 검토서보다 10배 오래 걸린다 — 고른 사람만 같이 돌린다.
    if (alsoDiagram) await requestDiagram.mutateAsync();
    modalOpen.value = false;
    goDetail(saved.value?.revNo ?? null, res.data.jobId);
  } catch (err) {
    modalOpen.value = false;
    saveError.value = errorMessage(err);
  } finally {
    regenerating.value = false;
  }
}
function onLater(): void {
  modalOpen.value = false;
  goDetail(saved.value?.revNo ?? null);
}
// 배경 클릭·ESC — 닫기만. 저장은 끝났고 폼에 남는다(상세로는 버튼으로만).
function onDismiss(): void {
  modalOpen.value = false;
}

// 고른 첨부를 올린다 — 실패는 던진다(저장 흐름이 멈춰야 하므로). 남긴 판(revNo·major)을 돌려준다.
async function uploadPending(): Promise<{ revNo: number | null; major: boolean }> {
  const fd = new FormData();
  for (const f of newFiles.value) fd.append('attachment', f);
  const res = await addFiles.mutateAsync(fd);
  newFiles.value = [];
  return { revNo: res.data.revNo, major: res.data.major };
}
// '첨부 올리기' 버튼 — 저장 없이 첨부만 먼저 올릴 때. 여기서는 화면에 남아 에러를 보여 준다.
async function uploadNew(): Promise<void> {
  if (newFiles.value.length === 0) return;
  saveError.value = '';
  try {
    await uploadPending();
  } catch (err) {
    saveError.value = errorMessage(err);
  }
}

const removing = ref<number | null>(null);
async function removeFile(fileId: number): Promise<void> {
  saveError.value = '';
  removing.value = fileId;
  try {
    await deleteFile.mutateAsync(fileId);
  } catch (err) {
    saveError.value = errorMessage(err);
  } finally {
    removing.value = null;
  }
}

const addAttachments = (files: File[]): void => {
  const next = [...newFiles.value];
  for (const f of files) {
    if (!next.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) next.push(f);
  }
  newFiles.value = next;
};
const removeAttachment = (i: number): void => {
  newFiles.value = newFiles.value.filter((_, idx) => idx !== i);
};

// 상세로 이동 — 저장 뒤라면 ?saved=2 로 넘겨 상세가 "수정했습니다 — v2" 한 줄을 띄운다(그 뒤 쿼리는 지운다).
// 저장했는데 바뀐 게 없으면(revNo null) ?saved=none — 조용히 옮겨지면 "저장이 됐나" 가 남는다.
// 인자 없음(undefined)은 취소·돌아가기라 아무 말도 안 한다.
// 재생성을 시작했으면 ?reviewJob=<uuid> 도 함께: 상세가 그 잡을 이어 폴링해 도착 즉시 진행 띠를 보인다
// (편집 화면에서 시작한 잡을 상세가 모르면 "다 되면 이 자리에서 바뀝니다" 약속이 깨진다).
const goDetail = (revNo?: number | null, reviewJobId?: string): void => {
  const path = `/projects/${String(projectId.value ?? 0)}`;
  const query: Record<string, string> = {};
  if (revNo !== undefined) query.saved = revNo === null ? 'none' : String(revNo);
  if (reviewJobId !== undefined) query.reviewJob = reviewJobId;
  void router.push(Object.keys(query).length === 0 ? path : { path, query });
};
const goLogin = (): void => {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
};
</script>

<template>
  <section class="mx-auto w-full max-w-[900px] px-6 pt-9 pb-24">
    <p class="font-mono text-micro tracking-[.14em] text-tx-3">EDIT REQUEST</p>
    <h1 class="mt-1.5 text-h1 font-extrabold text-tx-1">의뢰 수정</h1>

    <div v-if="!auth.isLoggedIn" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">로그인 후 수정할 수 있습니다.</p>
      <button type="button" class="mt-4 h-11 rounded-lg bg-ink-900 px-6 text-body font-bold text-white hover:bg-ink-800" @click="goLogin">
        로그인
      </button>
    </div>

    <p v-else-if="detail.isPending.value" class="mt-8 text-body text-tx-3">불러오는 중…</p>

    <div v-else-if="project === null || !isOwner" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">내가 등록한 의뢰만 수정할 수 있습니다.</p>
    </div>

    <div v-else-if="!editable" class="mt-8 grid gap-4">
      <div class="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <p class="text-lead font-extrabold">마감된 의뢰는 수정할 수 없습니다</p>
        <p class="mt-1 text-label leading-relaxed">
          견적 접수가 끝난 뒤 내용이 바뀌면 이미 받은 견적의 전제가 달라집니다. 조건이 크게 달라졌다면 새 의뢰로 등록해 주세요.
        </p>
      </div>
      <div><button type="button" class="h-10 rounded-lg border border-line-2 px-4 text-label font-bold text-tx-2 hover:border-tx-3" @click="goDetail()">의뢰로 돌아가기</button></div>
    </div>

    <div v-else class="mt-7 grid gap-6">
      <!-- 입찰자가 있으면 먼저 알린다 — 수정이 남에게 미치는 영향을 저장 전에 보여 준다 -->
      <p v-if="project.bidCount > 0" class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-label leading-relaxed text-blue-900">
        이미 <b>견적 {{ project.bidCount }}건</b>이 들어왔습니다. 분야·설명·답변·첨부·마감을 바꾸면 견적을 낸 전문가 화면에
        <b>“의뢰가 바뀌었다”</b> 경고가 뜨고, 마감이 24시간보다 가까우면 <b>48시간 뒤로 자동 연장</b>됩니다.
      </p>

      <!-- 제목·분야 -->
      <div class="grid gap-5 rounded-2xl border border-line bg-white p-6">
        <label class="grid gap-2 text-label font-semibold text-tx-2">
          <span>프로젝트 제목 <span class="text-red-500">*</span></span>
          <input v-model="title" type="text" class="h-11 rounded-lg border border-line-2 px-3.5 text-body font-normal text-tx-1">
        </label>
        <div class="grid gap-3">
          <p class="text-label font-semibold text-tx-2">어떤 개발이 필요한가요? <span class="text-red-500">*</span></p>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              v-for="area in MARKET_AREAS"
              :key="area.code"
              type="button"
              class="relative grid gap-3 rounded-2xl border-2 p-4 text-left transition"
              :class="serviceAreas.includes(area.code) ? 'border-copper-500 bg-copper-50' : 'border-line bg-white hover:border-line-2'"
              @click="toggleArea(area.code)"
            >
              <span
                class="absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border-2 text-micro font-bold"
                :class="serviceAreas.includes(area.code) ? 'border-copper-500 bg-copper-500 text-white' : 'border-line-2 text-transparent'"
              >✓</span>
              <AreaIcon :code="area.code" />
              <span class="grid gap-0.5 pr-6">
                <span class="text-lead font-extrabold text-tx-1">{{ area.label }}</span>
                <span class="text-label leading-relaxed text-tx-3">{{ area.hint }}</span>
              </span>
            </button>
          </div>
          <p v-if="serviceAreas.length === 0" class="text-label text-red-500">개발 분야를 1개 이상 선택해 주세요.</p>
        </div>
        <label class="grid gap-2 text-label font-semibold text-tx-2">
          <span>무엇을 만들고 싶은가요? <span class="text-red-500">*</span></span>
          <textarea v-model="description" rows="10" class="rounded-lg border border-line-2 p-3.5 text-body font-normal leading-relaxed text-tx-1" />
          <span class="text-right font-normal tabular-nums text-tx-3">{{ description.length.toLocaleString() }} / 20,000</span>
        </label>
      </div>

      <!-- 조건·질문 -->
      <div class="grid gap-5 rounded-2xl border-2 border-ink-900 bg-white p-6">
        <div class="flex flex-wrap items-center gap-2.5">
          <h2 class="text-title font-extrabold text-tx-1">프로젝트 공통 조건</h2>
          <span class="rounded-full bg-copper-50 px-2.5 py-0.5 text-micro font-bold text-copper-700">필수</span>
        </div>
        <div class="grid gap-5 sm:grid-cols-2 sm:gap-x-6">
          <label class="grid content-start gap-2">
            <span class="text-label font-semibold text-tx-2">예상 개발 예산 <span class="text-red-500">*</span></span>
            <select v-model="budgetRange" class="h-10 rounded-lg border border-line-2 bg-white px-3 text-body font-normal text-tx-1">
              <option v-for="b in MARKET_BUDGET_RANGES" :key="b" :value="b">{{ MARKET_BUDGET_RANGE_LABELS[b] }}</option>
            </select>
          </label>
          <QuestionField
            v-for="q in conditionQuestions"
            :key="q.code"
            :question="q"
            :state="stateOf(q.code)"
            :note-missing="noteMissingCodes.includes(q.code)"
            @toggle="toggleChoice(q, $event)"
            @note="stateOf(q.code).note = $event"
          />
        </div>
        <label class="flex items-start gap-3 rounded-xl bg-paper px-4 py-3.5 text-label leading-relaxed text-tx-2">
          <input v-model="ndaRequired" type="checkbox" class="mt-1">
          <span><b class="text-body text-tx-1">🔏 NDA 보호</b> · 첨부 자료를 NDA에 전자서명한 전문가만 열람하도록 잠급니다.</span>
        </label>
      </div>

      <div v-if="otherQuestions.length > 0" class="grid gap-5 rounded-2xl border border-line bg-white p-6">
        <h2 class="text-title font-extrabold text-tx-1">질문 답변</h2>
        <QuestionField
          v-for="q in otherQuestions"
          :key="q.code"
          :question="q"
          :state="stateOf(q.code)"
          :note-missing="noteMissingCodes.includes(q.code)"
          @toggle="toggleChoice(q, $event)"
          @note="stateOf(q.code).note = $event"
        />
      </div>

      <!-- 견적 마감 -->
      <div class="grid gap-3 rounded-2xl border border-line bg-white p-6">
        <h2 class="text-title font-extrabold text-tx-1">견적 마감</h2>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="d in MARKET_DEADLINE_PRESETS"
            :key="d"
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="deadlineMode === String(d) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 text-tx-2 hover:border-tx-3'"
            @click="deadlineMode = String(d) as '3' | '7' | '14'; deadlineTouched = true"
          >
            지금부터 {{ d }}일
          </button>
          <button
            type="button"
            class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
            :class="deadlineMode === 'date' ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 text-tx-2 hover:border-tx-3'"
            @click="deadlineMode = 'date'; deadlineTouched = true"
          >
            날짜 지정
          </button>
          <input
            v-if="deadlineMode === 'date'"
            v-model="deadlineDate"
            type="date"
            :min="todayKst"
            class="h-9 rounded-lg border border-line-2 px-3 text-label"
            @change="deadlineTouched = true"
          >
          <span v-if="!deadlineTouched" class="text-label text-tx-3">건드리지 않으면 마감은 그대로 둡니다.</span>
        </div>
      </div>

      <!-- 첨부 — 즉시 반영 -->
      <div class="grid gap-4 rounded-2xl border border-line bg-white p-6">
        <div class="flex flex-wrap items-baseline gap-2.5">
          <h2 class="text-title font-extrabold text-tx-1">첨부 자료</h2>
          <span class="text-label text-tx-3">추가·삭제는 <b>누르는 즉시</b> 반영됩니다(아래 저장 버튼과 별개)</span>
        </div>
        <ul v-if="(project.attachments.files ?? []).length > 0" class="grid gap-2">
          <li
            v-for="f in project.attachments.files ?? []"
            :key="f.fileId"
            class="flex min-w-0 items-center gap-3 rounded-xl border border-line px-4 py-3 text-label"
          >
            <span class="min-w-0 flex-1 truncate font-semibold text-tx-1">{{ f.name }}</span>
            <button
              type="button"
              class="h-8 shrink-0 rounded-lg border border-line-2 px-3 text-label font-bold text-tx-2 hover:border-red-400 hover:text-red-600 disabled:opacity-40"
              :disabled="removing === f.fileId"
              @click="removeFile(f.fileId)"
            >
              {{ removing === f.fileId ? '삭제 중…' : '삭제' }}
            </button>
          </li>
        </ul>
        <p v-else class="text-label text-tx-3">첨부된 자료가 없습니다.</p>

        <FileDropZone
          :files="newFiles"
          label="PDF · Word · 엑셀 · 이미지 · 손그림 사진"
          hint="여기로 끌어다 놓거나 눌러서 선택 — '첨부 올리기'를 누르거나, 저장할 때 함께 올라갑니다."
          @add="addAttachments"
          @remove="removeAttachment"
        />
        <div v-if="newFiles.length > 0">
          <button
            type="button"
            class="h-10 rounded-lg bg-ink-900 px-4 text-label font-bold text-white hover:bg-ink-800 disabled:opacity-40"
            :disabled="addFiles.isPending.value"
            @click="uploadNew"
          >
            {{ addFiles.isPending.value ? '올리는 중…' : `첨부 올리기 (${newFiles.length}개)` }}
          </button>
        </div>
      </div>

      <p v-if="saveError !== ''" class="rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ saveError }}</p>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="h-11 rounded-lg bg-copper-500 px-6 text-body font-bold text-white hover:bg-copper-600 disabled:opacity-40"
          :disabled="!canSave || update.isPending.value"
          @click="save"
        >
          {{ update.isPending.value ? '저장 중…' : '저장하기' }}
        </button>
        <button type="button" class="h-11 rounded-lg border border-line-2 px-5 text-body font-bold text-tx-2 hover:border-tx-3" @click="goDetail()">
          취소하고 돌아가기
        </button>
        <span v-if="requiredMissing.length > 0" class="text-label text-red-500">필수 조건에 답해야 저장할 수 있습니다.</span>
      </div>

      <!-- 저장 결과 + 다음 한 걸음 — 어느 버튼을 눌러도 상세로 나간다(§11.5) -->
      <SaveResultModal
        :open="modalOpen"
        :rev-no="saved?.revNo ?? null"
        :major="saved?.major ?? false"
        :deadline-extended-to="saved?.deadlineExtendedTo == null ? null : kstDate(saved.deadlineExtendedTo)"
        :review-stale="modalStale"
        :pending="regenerating"
        @regenerate="onRegenerate"
        @later="onLater"
        @dismiss="onDismiss"
      />
    </div>
  </section>
</template>
