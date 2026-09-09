<script setup lang="ts">
import { WORK_DOCUMENT_TEMPLATES, WORK_DECISION_LABELS } from '@sp/api-contract';
import type { WorkDocumentKind, WorkDocumentVersionType, WorkFileType } from '@sp/api-contract';
import WorkPlanView from './WorkPlanView.vue';
defineProps<{
  kind: WorkDocumentKind;
  version: WorkDocumentVersionType;
  project: string;
  customer: string;
}>();
defineEmits<{ download: [file: WorkFileType] }>();
const money = (v: number): string => `${v.toLocaleString('ko-KR')}원`;
</script>
<template>
  <article class="work-document-view">
    <header>
      <small>SAMPLEPCB · DEVELOPMENT PROJECT</small>
      <h2>{{ WORK_DOCUMENT_TEMPLATES[kind].label }}</h2>
      <p>{{ version.title }}</p>
    </header>
    <dl class="meta">
      <div>
        <dt>프로젝트</dt>
        <dd>{{ project }}</dd>
      </div>
      <div>
        <dt>고객</dt>
        <dd>{{ customer }}</dd>
      </div>
      <div>
        <dt>문서 버전</dt>
        <dd>v{{ version.version }}</dd>
      </div>
      <div>
        <dt>공개일</dt>
        <dd>
          {{
            version.publishedAt
              ? new Date(version.publishedAt).toLocaleDateString('ko-KR')
              : '작업본'
          }}
        </dd>
      </div>
      <div v-if="version.dueDate">
        <dt>회신 요청일</dt>
        <dd>{{ version.dueDate }}</dd>
      </div>
    </dl>
    <section v-if="version.quote" class="quote">
      <h3>연결 견적 · {{ version.quote.title }} (v{{ version.quote.version }})</h3>
      <table>
        <thead>
          <tr>
            <th>항목</th>
            <th>설명</th>
            <th class="amount">금액</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, i) in version.quote.items" :key="i">
            <td>{{ item.title }}</td>
            <td>{{ item.description }}</td>
            <td class="amount">{{ money(item.amount) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="total">
        공급가 {{ money(version.quote.supplyAmount) }} · 부가세
        {{ money(version.quote.vatAmount) }} · <b>합계 {{ money(version.quote.totalAmount) }}</b>
      </p>
      <dl>
        <div>
          <dt>개발기간</dt>
          <dd>
            {{ version.quote.durationDays === null ? '협의' : `${version.quote.durationDays}일` }}
            {{ version.quote.scheduleNote }}
          </dd>
        </div>
        <div>
          <dt>지급 조건</dt>
          <dd v-for="(milestone, i) in version.quote.milestones" :key="i">
            {{ milestone.title }} · {{ money(milestone.amount) }}
          </dd>
        </div>
        <div>
          <dt>납품 결과물</dt>
          <dd>{{ version.quote.deliverables.join('\n') || '견적 조건 참조' }}</dd>
        </div>
        <div>
          <dt>별도 실비·제외 범위</dt>
          <dd>{{ version.quote.exclusions || '없음' }}</dd>
        </div>
        <div>
          <dt>합의 조건</dt>
          <dd>{{ version.quote.terms }}</dd>
        </div>
        <div>
          <dt>검수·하자보수</dt>
          <dd>
            검수 {{ version.quote.reviewDays }}일 · 하자보수
            {{ version.quote.warrantyDays ?? '별도 협의'
            }}{{ version.quote.warrantyDays === null ? '' : '일' }}
          </dd>
        </div>
        <div v-if="version.quote.acceptedAt">
          <dt>견적 수락 기록</dt>
          <dd>
            {{ version.quote.acceptedName }} ·
            {{ new Date(version.quote.acceptedAt).toLocaleString('ko-KR') }}
          </dd>
        </div>
      </dl>
    </section>
    <section v-for="field in WORK_DOCUMENT_TEMPLATES[kind].fields" :key="field" class="field">
      <h3>{{ field }}</h3>
      <p>{{ version.content.fields[field] || '—' }}</p>
    </section>
    <table v-if="version.content.rows.length">
      <thead>
        <tr>
          <th v-for="col in WORK_DOCUMENT_TEMPLATES[kind].columns" :key="col">{{ col }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in version.content.rows" :key="i">
          <td v-for="col in WORK_DOCUMENT_TEMPLATES[kind].columns" :key="col">
            {{ row[col] || '—' }}
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="version.content.checks.length" class="checks">
      확인 범위 · {{ version.content.checks.join(' / ') }}
    </p>
    <WorkPlanView v-if="version.plan" :plan="version.plan" />
    <section v-if="version.files.length" class="files">
      <h3>첨부자료</h3>
      <button
        v-for="file in version.files"
        :key="file.fileId"
        type="button"
        :disabled="file.locked"
        @click="$emit('download', file)"
      >
        {{ file.name }} <span v-if="file.locked">· 잔금 결제 후 공개</span><span v-else>↓</span>
      </button>
    </section>
    <footer v-if="version.requiresApproval">
      <strong>{{
        version.decision ? WORK_DECISION_LABELS[version.decision.decision] : '고객 확인 대기'
      }}</strong>
      <p v-if="version.decision">
        {{ version.decision.actor }} · {{ new Date(version.decision.at).toLocaleString('ko-KR') }}
      </p>
      <p v-if="version.decision?.note">{{ version.decision.note }}</p>
      <small>이 기록은 문서 v{{ version.version }}에 대한 응답입니다.</small>
    </footer>
  </article>
</template>
<style scoped>
.work-document-view {
  background: var(--color-paper, #fff);
  color: var(--color-tx-1, #152033);
  border: 1px solid var(--color-line, #d9e1ec);
  border-radius: 12px;
  padding: 28px;
  font-size: 13px;
  line-height: 1.7;
}
header {
  border-bottom: 2px solid var(--color-ink-950, #09244b);
  padding-bottom: 18px;
  margin-bottom: 18px;
}
header small {
  font-size: 10px;
  letter-spacing: 1.8px;
  color: var(--color-tx-3, #64748b);
}
h2 {
  font-size: 25px;
  font-weight: 800;
  margin: 8px 0;
}
h3 {
  font-size: 14px;
  font-weight: 750;
  margin: 0 0 6px;
}
p,
dd {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
}
.meta {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  background: var(--color-paper, #f3f6fa);
  padding: 12px;
}
dl {
  margin-bottom: 20px;
}
dt {
  font-size: 11px;
  color: var(--color-tx-3, #64748b);
  font-weight: 650;
}
dd {
  margin: 0 0 8px;
}
.field {
  padding: 14px 0;
  border-bottom: 1px solid var(--color-line, #d9e1ec);
  break-inside: avoid;
}
.quote {
  padding: 18px 0;
}
.quote dl > div {
  margin-top: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: 12px;
}
th,
td {
  border: 1px solid var(--color-line, #d9e1ec);
  padding: 9px;
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
th {
  background: var(--color-paper, #f3f6fa);
}
.amount {
  text-align: right;
  white-space: nowrap;
}
.total {
  text-align: right;
  margin: 12px 0;
}
.checks {
  margin: 20px 0;
}
.files {
  margin: 20px 0;
}
.files button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 0;
  background: transparent;
  border: 0;
  text-align: left;
  color: var(--color-brand-600, #2864dc);
  cursor: pointer;
}
.files button:disabled {
  color: var(--color-tx-3, #64748b);
  cursor: default;
}
footer {
  margin-top: 24px;
  padding: 16px;
  background: var(--color-paper, #f3f6fa);
  border: 1px solid var(--color-line, #d9e1ec);
}
footer small {
  color: var(--color-tx-3, #64748b);
}
@media (max-width: 600px) {
  .work-document-view {
    padding: 16px;
  }
  .meta {
    grid-template-columns: 1fr;
  }
}
@media print {
  .work-document-view {
    border: 0;
    padding: 0;
    font-size: 10pt;
  }
  .meta {
    grid-template-columns: repeat(2, 1fr);
  }
  .files button {
    color: inherit;
  }
  h2 {
    font-size: 20pt;
  }
  table {
    page-break-inside: auto;
  }
  tr {
    break-inside: avoid;
  }
  header {
    break-after: avoid;
  }
}
</style>
