<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { DEVELOP_DOC_TYPE_LABELS, developDocDecisionLabel, developDocStatusLabel } from '@sp/api-contract';
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import { formatBytes, formatDateTime } from '@/lib/format';
import { developDocViewBlocks } from '../doc-view-model';

// 프로젝트 문서 한 판의 인쇄본 — 읽기 뷰(DevelopDocView)가 인쇄하는 순간에만 body 직속 호스트로 띄운다.
// 옛 화면이 인쇄하던 범위 그대로: 카드 머리(번호·종류·판·상태·발송 시각·회신 요청일) · 본문 · 첨부 이름 · 고객 결정.
// 내부 메모·보낸 메일 확인본·버튼은 옛 화면도 인쇄에서 뺐다(print:hidden). 종이는 화면 테마와 무관하게 흰 바탕 검은 글자.
const props = defineProps<{ doc: AdminDevelopDocumentViewType }>();

const { t } = useI18n();
const blocks = computed(() => developDocViewBlocks(props.doc));
</script>

<template>
  <article class="bg-white p-6 text-sm text-neutral-900">
    <header class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-neutral-300 pb-2">
      <span class="font-mono text-base font-bold">{{ doc.docNo }}</span>
      <span class="text-base font-semibold">{{ DEVELOP_DOC_TYPE_LABELS[doc.type] }}</span>
      <span class="text-xs text-neutral-500">v{{ doc.version }}</span>
      <span class="rounded border border-neutral-400 px-1.5 text-xs">{{ developDocStatusLabel(doc.type, doc.status) }}</span>
      <span v-if="doc.approval" class="text-xs text-neutral-600">{{ t('admin.develop.docs.card.approval') }}</span>
      <span v-if="doc.sentAt !== null" class="text-xs text-neutral-500">{{ formatDateTime(doc.sentAt) }}</span>
      <span v-if="doc.replyDueOn !== null" class="text-xs font-semibold">{{ t('admin.develop.docs.status.replyDue', { date: doc.replyDueOn }) }}</span>
    </header>

    <dl v-if="blocks.length > 0" class="mt-3 grid grid-cols-2 gap-3">
      <template v-for="b in blocks" :key="b.key">
        <div v-if="b.kind === 'table'" class="col-span-2">
          <dt class="text-xs font-semibold text-neutral-500">{{ b.label }}</dt>
          <dd class="mt-1">
            <table class="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th v-for="c in b.columns" :key="c.key" class="border border-neutral-300 bg-neutral-100 px-2 py-1 text-left font-semibold">{{ c.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(cells, index) in b.rows" :key="index">
                  <td v-for="(cell, ci) in cells" :key="ci" class="border border-neutral-300 px-2 py-1">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </dd>
        </div>
        <div v-else class="break-inside-avoid">
          <dt class="text-xs font-semibold text-neutral-500">{{ b.label }}</dt>
          <dd class="mt-0.5 leading-relaxed whitespace-pre-line">{{ b.text }}</dd>
        </div>
      </template>
    </dl>
    <p v-else class="mt-3 text-neutral-500">{{ t('admin.develop.docs.view.empty') }}</p>

    <section v-if="doc.files.length > 0" class="mt-4">
      <p class="text-xs font-semibold text-neutral-500">{{ t('admin.develop.docs.editor.files') }}</p>
      <ul class="mt-1 grid gap-0.5 text-xs">
        <li v-for="f in doc.files" :key="f.fileId">{{ f.name }} <span class="text-neutral-500">({{ formatBytes(f.size) }})</span></li>
      </ul>
    </section>

    <section v-if="doc.decision !== null" class="mt-4 rounded border border-neutral-400 p-2.5">
      <p class="font-semibold">
        {{ developDocDecisionLabel(doc.type, doc.decision) }}
        <span
          v-if="developDocStatusLabel(doc.type, doc.status) !== developDocDecisionLabel(doc.type, doc.decision)"
          class="ml-1 font-normal text-neutral-600"
        >{{ developDocStatusLabel(doc.type, doc.status) }}</span>
      </p>
      <p class="mt-0.5 text-xs text-neutral-600">
        {{ doc.decidedName ?? '' }}
        <template v-if="doc.decidedAt !== null"> · {{ formatDateTime(doc.decidedAt) }}</template>
      </p>
      <p v-if="doc.decisionNote !== null && doc.decisionNote !== ''" class="mt-1 leading-relaxed whitespace-pre-line">{{ doc.decisionNote }}</p>
    </section>
  </article>
</template>
