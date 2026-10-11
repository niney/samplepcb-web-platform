<script setup lang="ts">
// EQ 작업공간의 AI 분석 띠(D20 P2) — 협력사가 승인요청을 누르면 EQ 엑셀을 자동으로 문항 초안으로 만든다.
// 이 띠는 그 잡의 세 순간만 말한다(초안이 만들어져 들어갔으면 띠는 없고 회차 배지 'AI 초안 · 검토 필요'가 말한다):
//   분석 중  — 기다리면 초안이 열린다(부모가 목록을 4~5초 간격으로 다시 읽는다).
//   안 됨    — 사유(계약 PCB_EQ_AI_FAIL_LABELS)와 덧말 + [AI 다시 분석] · [직접 작성]. 메일은 따로 가지 않는다(P2-3).
//   결과 준비 — 관리자가 먼저 초안을 열어 결과가 안 들어갔다 → [AI 결과를 초안에 적용](초안 문항이 통째로 바뀐다).
// 자동은 초안까지다 — 고객 발송은 관리자가 검토한 뒤(D20-1). 무엇을 보일지는 부모가 정해 kind 로 넘긴다.
// 분석이 **됐을 때의 주의 문구**(ai.detail — 예: 표에는 있는데 AI 가 빠뜨렸을 수 있는 문항)는 따로 주의 띠로 선다:
// 초안이 만들어졌어도 원본과 대조할 이유가 있다는 뜻이라 초안 위에 두고, 읽었으면 닫을 수 있다(caution).
import { PencilLineIcon, RefreshCwIcon, SparklesIcon, TriangleAlertIcon, XIcon } from '@lucide/vue';
import { PCB_EQ_AI_FAIL_LABELS, type PcbEqAiStateType } from '@sp/api-contract';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Spinner } from '@/next/components/ui/spinner';

defineProps<{
  /** 잡의 순간 — null 이면 주의 띠만(초안에 들어간 뒤). */
  kind: 'running' | 'failed' | 'ready' | null;
  ai: PcbEqAiStateType;
  /** 분석이 됐을 때의 주의 문구(서버 ai.detail) — 닫았거나 없으면 null. */
  caution: string | null;
  /** 열린 초안이 있다 — 다시 분석·적용은 그 초안의 문항을 AI 결과로 바꾼다. */
  hasDraft: boolean;
  /** 새 회차를 열 수 있다(열린 회차 없음) — [직접 작성]을 낸다. */
  canWriteDirect: boolean;
  /** 유스케이스가 꺼져 있으면 다시 분석할 수 없다(설정 > AI 연동). */
  aiEnabled: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  /** [AI 다시 분석] · [AI 결과를 초안에 적용] — 초안이 있으면 부모가 확인 뒤 replaceDraft 로 부른다. */
  analyze: [];
  direct: [];
  /** 주의 띠를 닫는다 — 같은 분석(잡)에 대해서는 다시 띄우지 않는다(부모가 기억). */
  dismissCaution: [];
}>();
</script>

<template>
  <div class="grid shrink-0 gap-2 border-b px-5 py-2" data-eq-ai-banner :data-eq-ai-kind="kind ?? 'none'">
    <Alert v-if="kind === 'running'" variant="info" size="sm">
      <Spinner />
      <AlertTitle>AI 가 EQ 파일을 분석 중입니다…</AlertTitle>
      <AlertDescription>
        <p class="text-xs">
          끝나면 문항 초안이 여기 열립니다 — 보통 10~20초 걸립니다. 기다리지 않고 닫아도 분석은 계속됩니다.
          <span class="text-muted-foreground">({{ ai.model }} · {{ formatDateTime(ai.startedAt) }} 시작)</span>
        </p>
      </AlertDescription>
    </Alert>

    <!-- 안 됨인데 이미 초안을 쓰고 있다 — 할 말은 끝났으니 한 줄로 줄인다(편집 자리를 뺏지 않게). 다시 분석은 남긴다. -->
    <div v-else-if="kind === 'failed' && hasDraft" class="flex flex-wrap items-center gap-2 text-xs">
      <Badge variant="warning">AI 분석 안 됨</Badge>
      <span class="text-muted-foreground min-w-0 flex-1 truncate" :title="ai.detail ?? undefined" data-eq-ai-reason>
        {{ ai.reason === null ? '원인을 알 수 없습니다.' : PCB_EQ_AI_FAIL_LABELS[ai.reason] }}
      </span>
      <Button
        variant="ghost"
        size="xs"
        :disabled="busy || !aiEnabled"
        title="EQ 파일을 다시 분석합니다 — 되면 지금 초안의 문항이 AI 결과로 바뀝니다."
        @click="emit('analyze')"
      >
        <RefreshCwIcon />
        AI 다시 분석
      </Button>
    </div>

    <Alert v-else-if="kind === 'failed'" variant="warning" size="sm">
      <TriangleAlertIcon />
      <AlertTitle>AI 분석이 초안을 만들지 못했습니다</AlertTitle>
      <AlertDescription>
        <p class="text-xs" data-eq-ai-reason>
          {{ ai.reason === null ? '원인을 알 수 없습니다 — 다시 분석하거나 직접 작성해 주세요.' : PCB_EQ_AI_FAIL_LABELS[ai.reason] }}
        </p>
        <p v-if="ai.detail !== null && ai.detail !== ''" class="text-muted-foreground mt-0.5 text-xs break-all">{{ ai.detail }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            :disabled="busy || !aiEnabled"
            :title="aiEnabled ? undefined : '설정 > AI 연동에서 PCB EQ 분석이 꺼져 있습니다.'"
            @click="emit('analyze')"
          >
            <RefreshCwIcon />
            AI 다시 분석
          </Button>
          <Button v-if="canWriteDirect" size="sm" :disabled="busy" @click="emit('direct')">
            <PencilLineIcon />
            직접 작성
          </Button>
        </div>
      </AlertDescription>
    </Alert>

    <Alert v-else-if="kind === 'ready'" variant="info" size="sm">
      <SparklesIcon />
      <AlertTitle>AI 분석 결과가 준비됐습니다</AlertTitle>
      <AlertDescription>
        <p class="text-xs">
          {{ hasDraft
            ? '먼저 연 초안이 있어 결과를 넣지 않았습니다 — 적용하면 지금 초안의 문항·그림이 AI 결과로 바뀝니다.'
            : '결과로 초안을 만들 수 있습니다 — 만든 뒤 검토하고 고객에게 보내세요.' }}
        </p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" :disabled="busy" @click="emit('analyze')">
            <SparklesIcon />
            {{ hasDraft ? 'AI 결과를 초안에 적용' : 'AI 결과로 초안 만들기' }}
          </Button>
        </div>
      </AlertDescription>
    </Alert>

    <!-- 분석은 됐지만 원본과 대조할 것이 있다(서버가 잡에 남긴 주의 문구) — 읽었으면 닫는다. -->
    <Alert v-if="caution !== null" variant="warning" size="sm" data-eq-ai-caution>
      <TriangleAlertIcon />
      <AlertDescription>
        <p class="pr-6 text-xs"><b>AI 분석 주의:</b> {{ caution }} — 원본 EQ 와 대조해 주세요.</p>
      </AlertDescription>
      <Button variant="ghost" size="icon-xs" class="absolute top-1 right-1" aria-label="AI 분석 주의 닫기" title="닫기" @click="emit('dismissCaution')">
        <XIcon />
      </Button>
    </Alert>
  </div>
</template>
