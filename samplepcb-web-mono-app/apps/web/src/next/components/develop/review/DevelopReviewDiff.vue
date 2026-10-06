<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ArrowRightIcon } from '@lucide/vue';
import { DEVELOP_REGISTRY } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { DEV_REVIEW_DIFF_SECTION_LABELS, diffDevReview, diffWords } from '@sp/utils';
import type { DevReviewDiffEntry } from '@sp/utils';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Badge } from '@/next/components/ui/badge';
import { Empty, EmptyDescription } from '@/next/components/ui/empty';

// 두 판의 구조 비교(docs/DEVELOP_FLOW.md §6.2) — 옛 components/admin/develop/DevelopReviewDiff.vue 의 짝(같은 props).
// 항목 단위 추가/삭제/변경, 변경 문장은 단어 하이라이트. 계산은 전부 @sp/utils 순수 함수(diffDevReview·diffWords)라
// 이 컴포넌트는 그리기만 한다. 개발의뢰 레지스트리로 비교해 분야 표기가 나머지 화면과 같다.
const props = defineProps<{ a: MarketDevReviewType; b: MarketDevReviewType; aLabel: string; bLabel: string }>();

const { t } = useI18n();

const diff = computed(() => diffDevReview(props.a, props.b, DEVELOP_REGISTRY));
const groups = computed(() =>
  diff.value.changedSections.map((section) => ({
    section,
    title: DEV_REVIEW_DIFF_SECTION_LABELS[section],
    entries: diff.value.entries.filter((e) => e.section === section),
  })),
);

// 추가=완료색 · 삭제=문제색 · 변경=주의색(옛 화면과 같은 뜻).
const OP_VARIANT: Record<DevReviewDiffEntry['op'], BadgeVariant> = {
  added: 'success',
  removed: 'danger',
  changed: 'warning',
};

const words = (before: string | null, after: string | null) => diffWords(before ?? '', after ?? '');
</script>

<template>
  <div class="grid gap-3">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <span class="font-semibold">{{ props.aLabel }}</span>
      <ArrowRightIcon class="text-muted-foreground size-4" />
      <span class="font-semibold">{{ props.bLabel }}</span>
      <template v-if="!diff.isEmpty">
        <span class="text-muted-foreground ml-2 text-xs">{{ t('admin.develop.review.versions.changedSections') }}:</span>
        <Badge v-for="g in groups" :key="g.section" variant="secondary" class="tabular-nums">
          {{ g.title }} {{ g.entries.length }}
        </Badge>
      </template>
    </div>

    <Empty v-if="diff.isEmpty">
      <EmptyDescription>{{ t('admin.develop.review.versions.same') }}</EmptyDescription>
    </Empty>

    <SectionCard v-for="g in groups" :key="g.section" :title="g.title" flush>
      <ul class="divide-y">
        <li v-for="(e, i) in g.entries" :key="i" class="grid gap-1.5 px-4 py-2.5">
          <div class="flex flex-wrap items-center gap-2">
            <Badge :variant="OP_VARIANT[e.op]">{{ t(`admin.develop.review.versions.op.${e.op}`) }}</Badge>
            <span class="text-sm font-semibold">{{ e.label }}</span>
          </div>
          <!-- 변경: 한 줄에 단어 하이라이트(삭제=취소선·추가=밑줄 없는 강조) -->
          <p v-if="e.op === 'changed'" class="text-sm leading-relaxed whitespace-pre-line">
            <template v-for="(w, wi) in words(e.before, e.after)" :key="wi">
              <span v-if="w.op === 'same'">{{ w.text }}</span>
              <!-- ui-audit-allow: 단어 단위 diff 표지(글자 위 하이라이트 — 상자·알림이 아니다) -->
              <del v-else-if="w.op === 'removed'" class="bg-destructive-soft text-destructive rounded-sm px-0.5">{{ w.text }}</del>
              <!-- ui-audit-allow: 단어 단위 diff 표지(글자 위 하이라이트 — 상자·알림이 아니다) -->
              <ins v-else class="bg-success-soft text-success rounded-sm px-0.5 no-underline">{{ w.text }}</ins>
            </template>
          </p>
          <Panel v-else-if="e.op === 'added'" size="xs" tone="success" class="text-sm leading-relaxed whitespace-pre-line">
            {{ e.after }}
          </Panel>
          <Panel v-else size="xs" tone="destructive" class="text-sm leading-relaxed whitespace-pre-line line-through">
            {{ e.before }}
          </Panel>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
