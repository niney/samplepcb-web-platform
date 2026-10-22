<script setup lang="ts">
import { computed } from 'vue';
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REGISTRY,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  developProductionSummary,
  developWishLabel,
} from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';
import type { DevelopRequestForm, StepKey } from '../../composables/useRequestForm';
import { WIZ } from '../../lib/wizard-copy';
import ContactFields from './ContactFields.vue';
import WizCheck from './WizCheck.vue';
import icoEdit from '../../assets/wizard/ico-edit.svg';

// 위저드 5스텝 — 검토·접수. 피그마 01-5(70:12570, 900 폭): 연락처 4칸 → '내용을 확인해 주세요.' 흰 상자(개발 메뉴 · 의뢰 정보 ·
// 개발 목적 · 첨부 자료 · 세부 질문 답변 · 시제품·제조 — 블록마다 '수정하기', 행 = 120px 굵은 라벨 + 밑줄 값) → 비밀유지 체크 상자.
// 값은 여기서 고치지 않고 '수정하기'로 해당 스텝에 돌아간다(값의 정본은 그 스텝). 개발 메뉴 블록은 시안처럼 '수정하기'가 없다.
// 답변 행은 검토서·관리자 화면과 **같은 함수**(buildDevReviewBriefRows)로 만든다. AI 후속 질문의 답도 같은 자리에 실린다.
const props = defineProps<{ form: DevelopRequestForm }>();
const {
  fields,
  contact,
  contactPrefilled,
  skipQuestions,
  menuBadge,
  attachments,
  aiAnswerRows,
  buildAnswers,
  buildProduction,
  goToStep,
} = props.form;

const briefRows = computed(() => buildDevReviewBriefRows(buildAnswers(), DEVELOP_REGISTRY));
const answerRowCount = computed(() => aiAnswerRows.value.length + briefRows.value.length);
const fileNames = computed(() => attachments.value.map((f) => f.name));
const wishLabel = computed(() =>
  developWishLabel(fields.wishDate === '' ? null : fields.wishDate, fields.wishNote.trim() === '' ? null : fields.wishNote.trim()),
);
const budgetLabel = computed(() => (fields.budgetRange === null ? '미선택' : DEVELOP_BUDGET_RANGE_LABELS[fields.budgetRange]));
const stageLabel = computed(() =>
  fields.currentStage === null || fields.targetStage === null
    ? '미선택'
    : `${DEVELOP_CURRENT_STAGE_LABELS[fields.currentStage]} → ${DEVELOP_TARGET_STAGE_LABELS[fields.targetStage]}`,
);
const productionRows = computed(() => {
  const p = fields.production;
  return [
    { label: '계획', value: developProductionSummary(buildProduction()) },
    { label: '우선순위', value: p.priority === null ? '' : DEVELOP_PRIORITY_LABELS[p.priority] },
    { label: '자재 조달', value: p.sourcing === null ? '' : DEVELOP_SOURCING_MODE_LABELS[p.sourcing] },
    { label: '납품 형태', value: p.delivery === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[p.delivery] },
  ].filter((r) => r.value !== '');
});
// 시안 '홍길동·01030618700' — 이름·전화만(회사·이메일은 바로 위 연락처 칸에 있다).
const contactLine = computed(() => [contact.name, contact.phone].filter((s) => s.trim() !== '').join('·'));
const infoRows = computed(() => [
  { label: '의뢰 제목', value: fields.title.trim() === '' ? '미입력' : fields.title },
  { label: '의뢰자·연락처', value: contactLine.value === '' ? '미입력' : contactLine.value },
  { label: '개발 단계', value: stageLabel.value },
  { label: '일정·예산', value: `${wishLabel.value === '' ? '미입력' : wishLabel.value}·${budgetLabel.value}` },
]);

const BLOCK_HEAD = 'flex items-center justify-between gap-[12px]';
const BLOCK_TITLE = 'text-[17px] font-medium leading-[1.3] text-black sm:text-[18px]';
const ROW = 'flex flex-col gap-[4px] sm:flex-row sm:gap-[14px]';
const ROW_LABEL = 'shrink-0 text-[16px] font-bold leading-[1.8] text-black sm:w-[120px] sm:pb-[12px] sm:pl-[10px] sm:text-[18px]';
const ROW_VALUE = 'min-w-0 flex-1 whitespace-pre-wrap border-b border-[#d9d9d9] pb-[12px] text-[16px] font-medium leading-[1.8] text-black sm:text-[18px]';
const edit = (key: StepKey): void => {
  goToStep(key);
  window.scrollTo({ top: 0 });
};
</script>

<template>
  <div class="flex flex-col gap-[40px]">
    <!-- 연락처 -->
    <section :class="WIZ.section">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">어떻게 연락드릴까요?</h2>
        <p :class="WIZ.sectionLead">접수 후 담당자가 전화나 메일로 요구사항을 함께 정리합니다. 그 뒤에 견적 제안서를 보내드립니다.</p>
      </div>
      <ContactFields :form="form" />
      <p v-if="contactPrefilled" :class="WIZ.sectionLead" role="status">회원정보로 채웠습니다. 이번 의뢰의 담당자 정보로 수정할 수 있습니다.</p>
    </section>

    <!-- 확인 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">내용을 확인해 주세요.</h2>
      <div class="flex flex-col gap-[26px] rounded-[10px] bg-white px-[20px] py-[26px] sm:px-[24px]">
        <!-- 개발 메뉴 -->
        <div class="flex flex-col gap-[20px]">
          <p :class="BLOCK_TITLE">개발 메뉴</p>
          <p class="pb-[12px] pl-[10px] text-[17px] font-bold leading-[1.8] text-black sm:text-[18px]">
            {{ menuBadge === '' ? '선택 안 됨' : menuBadge }}<span v-if="skipQuestions" class="font-medium text-[#666]"> · 전문가에게 맡김</span>
          </p>
        </div>

        <!-- 의뢰 정보 -->
        <div class="flex flex-col gap-[20px]">
          <div :class="BLOCK_HEAD">
            <p :class="BLOCK_TITLE">의뢰 정보</p>
            <button type="button" class="flex h-[34px] w-[84px] shrink-0 items-center justify-center gap-[4px] rounded-[6px] bg-[#f0f4fa] text-[14px] text-[#0a151e] hover:bg-[#e2e8f2]" @click="edit('describe')">
              <img :src="icoEdit" alt="" width="14" height="14" class="block size-[14px]">수정하기
            </button>
          </div>
          <div class="flex flex-col gap-[12px]">
            <div v-for="row in infoRows" :key="row.label" :class="ROW">
              <p :class="ROW_LABEL">{{ row.label }}</p>
              <p :class="ROW_VALUE">{{ row.value }}</p>
            </div>
          </div>
        </div>

        <!-- 개발 목적 -->
        <div class="flex flex-col gap-[20px]">
          <div :class="BLOCK_HEAD">
            <p :class="BLOCK_TITLE">개발 목적</p>
            <button type="button" class="flex h-[34px] w-[84px] shrink-0 items-center justify-center gap-[4px] rounded-[6px] bg-[#f0f4fa] text-[14px] text-[#0a151e] hover:bg-[#e2e8f2]" @click="edit('describe')">
              <img :src="icoEdit" alt="" width="14" height="14" class="block size-[14px]">수정하기
            </button>
          </div>
          <p :class="ROW_VALUE">{{ fields.description.trim() === '' ? '미입력' : fields.description }}</p>
        </div>

        <!-- 첨부 자료 -->
        <div class="flex flex-col gap-[20px]">
          <div :class="BLOCK_HEAD">
            <p :class="BLOCK_TITLE">첨부 자료</p>
            <button type="button" class="flex h-[34px] w-[84px] shrink-0 items-center justify-center gap-[4px] rounded-[6px] bg-[#f0f4fa] text-[14px] text-[#0a151e] hover:bg-[#e2e8f2]" @click="edit('describe')">
              <img :src="icoEdit" alt="" width="14" height="14" class="block size-[14px]">수정하기
            </button>
          </div>
          <p :class="ROW_VALUE">{{ fileNames.length === 0 ? '등록된 파일 없음' : fileNames.join('\n') }}</p>
        </div>

        <!-- 세부 질문 답변 — AI 질문의 답(있으면)과 레지스트리 문항의 답 -->
        <div class="flex flex-col gap-[20px]">
          <div :class="BLOCK_HEAD">
            <p :class="BLOCK_TITLE">세부 질문 답변</p>
            <button type="button" class="flex h-[34px] w-[84px] shrink-0 items-center justify-center gap-[4px] rounded-[6px] bg-[#f0f4fa] text-[14px] text-[#0a151e] hover:bg-[#e2e8f2]" @click="edit('questions')">
              <img :src="icoEdit" alt="" width="14" height="14" class="block size-[14px]">수정하기
            </button>
          </div>
          <div v-if="answerRowCount > 0" class="flex flex-col gap-[12px]">
            <!-- AI 질문은 문장이 길어 라벨을 한 줄 위에 둔다 -->
            <div v-for="row in aiAnswerRows" :key="row.id" class="flex flex-col gap-[4px]">
              <p class="pl-[10px] text-[16px] font-bold leading-[1.6] text-black sm:text-[18px]">{{ row.label }}</p>
              <p :class="[ROW_VALUE, 'pl-[10px]', row.unknown ? 'text-[#999]' : '']">{{ row.value }}</p>
            </div>
            <div v-for="row in briefRows" :key="row.code" :class="ROW">
              <p :class="ROW_LABEL">{{ row.label }}</p>
              <p :class="[ROW_VALUE, row.unknown ? 'text-[#999]' : '']">{{ row.value }}</p>
            </div>
          </div>
          <p v-else :class="ROW_VALUE">{{ skipQuestions ? '전문가 검토로 접수합니다 — 담당자가 사양을 제안합니다.' : '답한 항목이 없습니다.' }}</p>
        </div>

        <!-- 시제품 · 제조 -->
        <div class="flex flex-col gap-[20px]">
          <div :class="BLOCK_HEAD">
            <p :class="BLOCK_TITLE">시제품·제조</p>
            <button type="button" class="flex h-[34px] w-[84px] shrink-0 items-center justify-center gap-[4px] rounded-[6px] bg-[#f0f4fa] text-[14px] text-[#0a151e] hover:bg-[#e2e8f2]" @click="edit('production')">
              <img :src="icoEdit" alt="" width="14" height="14" class="block size-[14px]">수정하기
            </button>
          </div>
          <div class="flex flex-col gap-[12px]">
            <div v-for="row in productionRows" :key="row.label" :class="ROW">
              <p :class="ROW_LABEL">{{ row.label }}</p>
              <p :class="ROW_VALUE">{{ row.value }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 비밀유지(선택) — 자료 사용 동의는 2스텝에서 받았다 -->
    <div class="rounded-[10px] bg-white px-[20px] py-[26px] sm:px-[24px]">
      <WizCheck
        v-model="fields.ndaWanted"
        label="비밀유지 계약(NDA)을 맺고 싶습니다. (선택)"
        hint="담당자가 계약서를 준비해 연락드립니다. 체크하지 않아도 자료는 외부에 공개되지 않습니다."
      />
    </div>
  </div>
</template>
