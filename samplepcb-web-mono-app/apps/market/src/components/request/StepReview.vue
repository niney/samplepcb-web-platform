<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  MARKET_BUDGET_RANGES,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_DEADLINE_PRESETS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
} from '@sp/api-contract';
import DiagramViewer from '../DiagramViewer.vue';
import RocViewer from '../RocViewer.vue';
import { useMarketExpertList } from '../../api/useMarketExperts';
import type { ExpertListFilters } from '../../api/useMarketExperts';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { RequestWizardAi } from '../../composables/useRequestWizardAi';

// 스텝 4 — AI 구성 명세(진입 시 자동 구조화) + 구성도 + 선택 문서 + 견적 조건 + 등록.
// 포함 예정 AI 산출물이 생성 중이면 등록이 차단된다(생성 중인 것만 빼는 건너뛰기 제공).
// 조건 입력은 생성 중에도 가능하다.
const props = defineProps<{ form: RequestWizardForm; ai: RequestWizardAi }>();
const { fields, attachments, todayKst, goToStep } = props.form;
const {
  aiActive,
  rocEnabled,
  postingsEnabled,
  spec,
  specRunning,
  specAwaitingPreanalysis,
  specFailed,
  specStale,
  specTbdBlocks,
  gapInputs,
  generateSpec,
  ensureSpec,
  reopenInterview,
  aiGenerationBlocking,
  skipAiArtifacts,
  diagramHtml,
  generateDiagramFromSpec,
  rocMd,
  rocRunning,
  rocFailed,
  generateRoc,
  postingCards,
  postingsRunning,
  postingsFailed,
  generatePostings,
  includeSpec,
  includeDiagram,
  includeRoc,
  includePostings,
  specIncludable,
  consentRequired,
  shareInterviewAnswersAgreed,
  includedAiArtifactLabels,
} = props.ai;

// 진입 시 자동 구조화(AI 활성 && 아직 생성 전일 때만).
onMounted(() => {
  ensureSpec();
});

function editAnswers(): void {
  reopenInterview();
  goToStep('interview');
}

// 지정 전문가 선택 목록(승인 전문가 전체 — 소규모 전제).
const expertFilters = ref<ExpertListFilters>({
  page: 1,
  pageSize: 100,
  expertType: '',
  serviceArea: '',
  category: '',
  cadTool: '',
  q: '',
});
const expertList = useMarketExpertList(expertFilters);

const gapHasInput = (): boolean =>
  Object.values(gapInputs).some((v) => v.trim() !== '');
</script>

<template>
  <div class="grid gap-5">
    <!-- ── AI 구성 명세·구성도 (AI 활성 시) ─────────────────────────────────── -->
    <div v-if="aiActive" class="grid gap-4">
      <div>
        <p class="text-xs font-bold text-tx-2">AI 구성 명세 <span class="font-normal text-tx-3">(선택)</span></p>
        <p class="mt-1.5 text-xs leading-relaxed text-tx-3">
          입력한 내용과 답변으로 구성 명세를 만들고, 확정된 명세를 브라우저에서 즉시 구성도로 그립니다.
          명세 생성에 약 30초~3분이 걸립니다. 생성 중에도 아래 조건을 미리 입력할 수 있고, 생성이 끝나면 등록됩니다.
        </p>
      </div>

      <!-- 명세 생성 중/실패 -->
      <p v-if="specAwaitingPreanalysis" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
        ⏳ AI가 설명·첨부를 먼저 확인하고 있습니다 — 곧 구성 명세를 만듭니다.
      </p>
      <p v-else-if="specRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
        ⏳ AI가 구성 명세를 만들고 있습니다(약 30초~3분).
      </p>

      <!-- 생성 대기 탈출구 — 포함하기로 한 AI 산출물이 생성 중이면 등록이 차단된다. -->
      <div
        v-if="aiGenerationBlocking"
        class="flex flex-wrap items-center gap-2 rounded-lg bg-paper px-3 py-2 text-[11px] leading-relaxed text-tx-3"
      >
        <span>AI 생성이 끝나면 등록됩니다.</span>
        <button
          type="button"
          class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2"
          @click="skipAiArtifacts"
        >
          생성 중인 AI 산출물 빼고 바로 등록
        </button>
      </div>
      <div v-else-if="specFailed && spec === null" class="grid gap-2">
        <p class="text-xs font-semibold text-red-600">구조화에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
        <div>
          <button
            type="button"
            class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
            @click="generateSpec"
          >
            다시 시도
          </button>
        </div>
      </div>

      <!-- stale 배지 -->
      <div
        v-if="specStale"
        class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800"
      >
        <p class="font-bold">입력이 바뀌어 기존 AI 결과가 오래된 상태입니다.</p>
        <p class="mt-1">현재 결과는 의뢰 등록에서 자동 제외됩니다. 변경된 내용으로 다시 생성해 주세요.</p>
        <button
          type="button"
          class="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-bold hover:border-amber-500"
          @click="editAnswers"
        >
          질문·명세 다시 확인
        </button>
      </div>

      <!-- 명세 요약 + TBD + 포함 체크 -->
      <template v-if="spec !== null">
        <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
          <p class="flex flex-wrap items-center gap-2">
            <b class="text-tx-1">AI가 이해한 시스템</b>
            <span class="rounded bg-ink-900 px-1.5 py-0.5 text-[10px] font-bold text-white">{{ spec.project.name }}</span>
            <span class="text-tx-3">블록 {{ spec.blocks.length }} · 연결 {{ spec.connections.length }} · 그룹 {{ spec.groups.length }}</span>
          </p>
          <p v-if="spec.project.summary !== ''" class="mt-1">{{ spec.project.summary }}</p>
          <p class="mt-2 flex flex-wrap gap-1.5">
            <span v-for="g in spec.groups" :key="g.id" class="rounded-full border border-line px-2 py-0.5 text-[11px] text-tx-3">{{ g.label }}</span>
          </p>
          <p v-if="specTbdBlocks.length > 0" class="mt-2 leading-relaxed">
            <b class="text-amber-700">미확정(TBD) {{ specTbdBlocks.length }}건:</b>
            {{ specTbdBlocks.join(' · ') }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <label class="flex items-center gap-2 text-[11px] font-semibold text-tx-2">
              <input v-model="includeSpec" type="checkbox" :disabled="specStale">
              이 AI 구성 명세를 의뢰에 포함
            </label>
            <button
              type="button"
              class="rounded-lg border border-line px-3 py-1.5 text-[11px] font-bold text-tx-2 hover:border-line-2"
              @click="editAnswers"
            >
              답변 수정(명세 다시 만들기)
            </button>
          </div>
        </div>

        <!-- questions_missing 보강 입력 → 재구조화 -->
        <div v-if="spec.questions_missing.length > 0" class="grid gap-2 rounded-xl border border-line p-4">
          <p class="text-xs font-bold text-tx-2">
            AI 추가 질문 <span class="font-normal text-tx-3">— 답해주시면 더 정확해집니다(선택)</span>
          </p>
          <label
            v-for="(mq, i) in spec.questions_missing"
            :key="i"
            class="grid gap-1 text-xs font-normal text-tx-2"
          >
            {{ mq.question }}
            <input
              :value="gapInputs[String(i)] ?? ''"
              type="text"
              class="h-9 rounded-lg border border-line px-3 text-xs"
              @input="gapInputs[String(i)] = ($event.target as HTMLInputElement).value"
            >
          </label>
          <div>
            <button
              type="button"
              class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
              :disabled="specRunning || !gapHasInput()"
              @click="generateSpec"
            >
              {{ specRunning ? '반영 중…' : '보강 답변 반영해 명세 다시 만들기' }}
            </button>
          </div>
        </div>

        <!-- 구성도 -->
        <div v-if="diagramHtml === null" class="grid gap-2">
          <div>
            <button
              type="button"
              class="rounded-lg bg-ink-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
              :disabled="specRunning || specStale || !includeSpec"
              @click="generateDiagramFromSpec"
            >
              이 명세로 구성도 만들기
            </button>
          </div>
          <p class="text-xs text-tx-3">외부 AI 재호출 없이 같은 명세에서 항상 같은 구성도를 즉시 생성합니다.</p>
        </div>
        <template v-else>
          <DiagramViewer :html="diagramHtml" />
          <div class="flex flex-wrap items-center gap-4">
            <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
              <input v-model="includeDiagram" type="checkbox" :disabled="specStale || !includeSpec">
              이 구성도를 의뢰에 첨부
            </label>
            <button
              type="button"
              class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
              :disabled="specStale || !includeSpec"
              @click="generateDiagramFromSpec"
            >
              다시 그리기
            </button>
          </div>
        </template>

        <!-- 답변 원문 공개 동의(답변이 있고 명세를 포함할 때만) -->
        <label
          v-if="consentRequired"
          class="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-800"
        >
          <input v-model="shareInterviewAnswersAgreed" type="checkbox" class="mt-0.5">
          <span>
            <b>AI 질문 답변 원문 공개 동의</b> — 답변은 이 신규 의뢰에 견적을 낼 수 있는
            전문가와 채택 전문가에게 공개됩니다. 기존 의뢰에는 이 정책을 소급 적용하지 않습니다.
          </span>
        </label>

        <!-- 추가 AI 문서(선택, 기본 접힘) -->
        <details v-if="rocEnabled || postingsEnabled" class="rounded-xl border border-line p-4">
          <summary class="cursor-pointer text-xs font-bold text-tx-2">추가 AI 문서 <span class="font-normal text-tx-3">(선택)</span></summary>
          <div class="mt-3 grid gap-4">
            <!-- 작업검토지시서 -->
            <div v-if="rocEnabled" class="grid gap-2">
              <p class="text-xs font-bold text-tx-2">AI 작업검토지시서 <span class="font-normal text-tx-3">(선택)</span></p>
              <p class="text-xs leading-relaxed text-tx-3">
                확정된 명세로 견적 낼 전문가·검수자가 참고할 요구사항 문서를 만듭니다(약 1분). 공개 범위는 상세 설명과 같습니다.
              </p>
              <div v-if="rocMd === null" class="grid gap-2">
                <div>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="rocRunning || specRunning || !specIncludable"
                    @click="generateRoc"
                  >
                    {{ rocRunning ? '지시서 생성 중…' : '작업검토지시서 생성' }}
                  </button>
                </div>
                <p v-if="rocRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                  ⏳ 생성 중입니다 — 완료되면 함께 등록됩니다.
                </p>
                <p v-else-if="rocFailed" class="text-xs font-semibold text-red-600">생성에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
              </div>
              <template v-else>
                <div class="max-h-80 overflow-y-auto">
                  <RocViewer :md="rocMd" />
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                    <input v-model="includeRoc" type="checkbox" :disabled="!specIncludable">
                    이 지시서를 의뢰에 첨부
                  </label>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="rocRunning || !specIncludable"
                    @click="generateRoc"
                  >
                    {{ rocRunning ? '생성 중…' : '다시 생성' }}
                  </button>
                </div>
              </template>
            </div>

            <!-- 분야별 작업 안내 카드 -->
            <div v-if="postingsEnabled && fields.serviceAreas.length > 0" class="grid gap-2 border-t border-line pt-4">
              <p class="text-xs font-bold text-tx-2">분야별 작업 안내 카드 <span class="font-normal text-tx-3">(선택)</span></p>
              <p class="text-xs leading-relaxed text-tx-3">
                선택하신 개발 분야별로 전문가가 견적 가능 여부를 빠르게 판단할 요약 카드를 만듭니다(약 30초~1분).
              </p>
              <div v-if="postingCards === null" class="grid gap-2">
                <div>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="postingsRunning || specRunning || !specIncludable"
                    @click="generatePostings"
                  >
                    {{ postingsRunning ? '카드 생성 중…' : '분야별 카드 생성' }}
                  </button>
                </div>
                <p v-if="postingsRunning" class="rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
                  ⏳ 생성 중입니다 — 완료되면 함께 등록됩니다.
                </p>
                <p v-else-if="postingsFailed" class="text-xs font-semibold text-red-600">생성에 실패했습니다. 잠시 후 다시 시도해 주세요.</p>
              </div>
              <template v-else>
                <div class="grid gap-2 sm:grid-cols-2">
                  <div
                    v-for="card in postingCards"
                    :key="card.serviceArea"
                    class="rounded-xl border border-line p-3 text-xs leading-relaxed text-tx-2"
                  >
                    <p class="font-extrabold text-tx-1">{{ MARKET_SERVICE_AREA_LABELS[card.serviceArea] }}</p>
                    <ul class="mt-1.5 grid gap-1">
                      <li v-for="(s, i) in card.summary" :key="i" class="flex gap-1.5">
                        <span class="text-copper-500">•</span><span>{{ s }}</span>
                      </li>
                    </ul>
                    <p class="mt-1.5 text-tx-3">작업 {{ card.scope.length }}항목<template v-if="(card.notes ?? []).length > 0"> · 확인 필요 {{ (card.notes ?? []).length }}건</template></p>
                  </div>
                </div>
                <div class="flex flex-wrap items-center gap-4">
                  <label class="flex items-center gap-2 text-xs font-semibold text-tx-2">
                    <input v-model="includePostings" type="checkbox" :disabled="!specIncludable">
                    이 카드를 의뢰에 첨부
                  </label>
                  <button
                    type="button"
                    class="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-tx-2 hover:border-line-2 disabled:opacity-40"
                    :disabled="postingsRunning || !specIncludable"
                    @click="generatePostings"
                  >
                    {{ postingsRunning ? '생성 중…' : '다시 생성' }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </details>
      </template>
    </div>

    <!-- ── 견적 조건 폼 (항상) ──────────────────────────────────────────────── -->
    <div class="grid gap-5" :class="aiActive ? 'border-t border-line pt-5' : ''">
      <p class="text-xs font-bold text-tx-1">견적 조건</p>

      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        예산 범위 <span class="text-red-500">*</span>
        <select v-model="fields.budgetRange" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
          <option v-for="b in MARKET_BUDGET_RANGES" :key="b" :value="b">{{ MARKET_BUDGET_RANGE_LABELS[b] }}</option>
        </select>
      </label>

      <div>
        <p class="text-xs font-bold text-tx-2">견적 마감 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            v-for="d in MARKET_DEADLINE_PRESETS"
            :key="d"
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="fields.deadlineMode === String(d) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
            @click="fields.deadlineMode = String(d) as '3' | '7' | '14'"
          >
            {{ d }}일 뒤
          </button>
          <button
            type="button"
            class="rounded-full border px-3 py-1.5 text-xs font-semibold transition"
            :class="fields.deadlineMode === 'date' ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
            @click="fields.deadlineMode = 'date'"
          >
            날짜 지정
          </button>
          <input
            v-if="fields.deadlineMode === 'date'"
            v-model="fields.deadlineDate"
            type="date"
            :min="todayKst"
            class="h-9 rounded-lg border border-line px-3 text-xs"
          >
        </div>
        <p class="mt-2 text-xs text-tx-3">마감 시각은 해당 일 23:59(KST)입니다. 마감 전에는 언제든 조기 마감할 수 있습니다.</p>
      </div>

      <div>
        <p class="text-xs font-bold text-tx-2">견적 방식 <span class="text-red-500">*</span></p>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            class="rounded-2xl border-2 p-4 text-left transition"
            :class="fields.method === 'open' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="fields.method = 'open'"
          >
            <p class="text-sm font-extrabold text-tx-1">역견적 (공개 입찰) <span class="ml-1 rounded bg-copper-500 px-1.5 py-0.5 text-[10px] font-bold text-white">추천</span></p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">조건이 맞는 전문가들이 블라인드로 견적을 제출합니다. 견적은 나만 볼 수 있습니다.</p>
          </button>
          <button
            type="button"
            class="rounded-2xl border-2 p-4 text-left transition"
            :class="fields.method === 'targeted' ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
            @click="fields.method = 'targeted'"
          >
            <p class="text-sm font-extrabold text-tx-1">지정견적 (1:1)</p>
            <p class="mt-1.5 text-xs leading-relaxed text-tx-2">원하는 전문가 한 명에게만 견적을 요청합니다.</p>
          </button>
        </div>
        <label v-if="fields.method === 'targeted'" class="mt-3 grid gap-1.5 text-xs font-bold text-tx-2">
          작업자 선택 <span class="text-red-500">*</span>
          <select v-model="fields.targetExpertId" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
            <option :value="null" disabled>전문가를 선택하세요</option>
            <option v-for="e in expertList.data.value?.data.items ?? []" :key="e.expertId" :value="e.expertId">
              {{ e.displayName }} · {{ MARKET_EXPERT_TYPE_LABELS[e.expertType] }}
            </option>
          </select>
          <span v-if="(expertList.data.value?.data.items ?? []).length === 0" class="font-normal text-tx-3">
            선택할 수 있는 전문가가 없습니다.
          </span>
        </label>
      </div>

      <label class="flex items-start gap-2 rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
        <input v-model="fields.ndaRequired" type="checkbox" class="mt-0.5">
        <span>
          <b class="text-tx-1">🔏 NDA 보호</b> — 첨부 자료를 NDA에 전자서명한 전문가만 열람하도록 잠급니다. (권장)
        </span>
      </label>
    </div>

    <!-- ── 최종 요약 ────────────────────────────────────────────────────────── -->
    <div class="rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
      <p class="font-bold text-tx-1">최종 의뢰 내용</p>
      <p class="mt-1"><b class="text-tx-1">{{ fields.title || '(제목 미입력)' }}</b></p>
      <p class="mt-1">
        {{ MARKET_REQUEST_TYPE_LABELS[fields.requestType] }} ·
        {{ fields.serviceAreas.map((area) => MARKET_SERVICE_AREA_LABELS[area]).join('/') }}
      </p>
      <p class="mt-1">
        {{ MARKET_BUDGET_RANGE_LABELS[fields.budgetRange] }} ·
        견적 마감 {{ fields.deadlineMode === 'date' ? fields.deadlineDate : `${fields.deadlineMode}일 뒤` }} ·
        {{ fields.method === 'open' ? '역견적' : '지정견적' }} ·
        {{ fields.ndaRequired ? 'NDA 보호' : 'NDA 없음' }} · 첨부 {{ attachments.length }}개
        <template v-if="consentRequired && shareInterviewAnswersAgreed">· 답변 원문 전문가 공개</template>
      </p>
      <p v-if="aiActive" class="mt-1 text-tx-3">
        <template v-if="aiGenerationBlocking">AI 생성 중 — 완료 후 등록 가능</template>
        <template v-else>AI 산출물: {{ includedAiArtifactLabels.length > 0 ? includedAiArtifactLabels.join(' · ') : '없음' }}</template>
      </p>
    </div>
  </div>
</template>
