<script setup lang="ts">
import { computed } from 'vue';

// AI 작업검토지시서(마크다운) 경량 뷰어 — LLM 산출이므로 v-html 금지, 라인 파싱으로만
// 렌더한다(텍스트 노드 = XSS 안전). 지원 문법은 산출 서식에 필요한 최소치:
// ## 헤딩 / - · * 불릿 / **강조**는 평문 처리 / 나머지는 문단.
const props = defineProps<{ md: string }>();

interface Line {
  type: 'h2' | 'h3' | 'li' | 'p' | 'blank';
  text: string;
}

const lines = computed<Line[]>(() =>
  props.md.split(/\r?\n/).map((raw): Line => {
    const s = raw.trimEnd();
    if (s.trim() === '') return { type: 'blank', text: '' };
    const h2 = /^##\s+(.*)$/.exec(s);
    if (h2?.[1] !== undefined) return { type: 'h2', text: h2[1] };
    const h3 = /^###\s+(.*)$/.exec(s);
    if (h3?.[1] !== undefined) return { type: 'h3', text: h3[1] };
    const li = /^\s*[-*]\s+(.*)$/.exec(s);
    if (li?.[1] !== undefined) return { type: 'li', text: li[1].replaceAll('**', '') };
    return { type: 'p', text: s.replaceAll('**', '').replace(/^#\s+/, '') };
  }),
);
</script>

<template>
  <div class="rounded-xl border border-line bg-white p-5 text-sm leading-relaxed text-tx-2">
    <template v-for="(l, i) in lines" :key="i">
      <p v-if="l.type === 'h2'" class="mt-4 border-b border-line pb-1 text-[13px] font-extrabold text-tx-1 first:mt-0">
        {{ l.text }}
      </p>
      <p v-else-if="l.type === 'h3'" class="mt-3 text-xs font-bold text-tx-1">{{ l.text }}</p>
      <p v-else-if="l.type === 'li'" class="flex gap-2 text-xs">
        <span class="text-copper-500">•</span><span>{{ l.text }}</span>
      </p>
      <p v-else-if="l.type === 'p'" class="text-xs">{{ l.text }}</p>
    </template>
  </div>
</template>
