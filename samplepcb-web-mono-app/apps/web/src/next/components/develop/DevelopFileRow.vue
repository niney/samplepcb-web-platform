<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { DownloadIcon, EyeIcon, Trash2Icon } from '@lucide/vue';
import { canPreview } from '@sp/ui';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import Panel from '@/next/components/common/Panel.vue';
import { formatBytes } from '@/lib/format';

// 개발 모듈 첨부 한 줄 — 의뢰 첨부·타임라인 첨부·프로젝트 문서 첨부가 같은 모양을 쓴다(옛 화면은 세 곳에 따로 그렸다).
// 이름 · (슬롯 표지) · (잠금) · 크기 · 미리보기 · 내려받기 · (지우기). 미리보기 모달·내려받기·지우기의 실행과 오류 표시는
// 부모 몫이라 여기선 신호만 올린다. 버튼은 인쇄에서 빠진다(문서 인쇄본은 첨부 이름만).
const props = withDefaults(
  defineProps<{
    file: { fileId: number; name: string; size: number; locked?: boolean };
    /** 슬롯 표지(분야·슬롯) — 빈 문자열이면 없음. */
    slotLabel?: string;
    /** muted = 편집기·읽기 뷰처럼 이미 카드 안인 목록(바탕을 한 단 낮춘다). */
    tone?: 'default' | 'muted';
    removable?: boolean;
    busy?: boolean;
  }>(),
  { slotLabel: '', tone: 'default', removable: false, busy: false },
);
const emit = defineEmits<{ preview: []; download: []; remove: [] }>();

const { t } = useI18n();
</script>

<template>
  <Panel size="xs" :tone="props.tone" class="flex min-w-0 items-center gap-2 text-sm">
    <Badge v-if="props.slotLabel !== ''" variant="info" class="shrink-0">{{ props.slotLabel }}</Badge>
    <span class="min-w-0 flex-1 truncate" :title="props.file.name">{{ props.file.name }}</span>
    <Badge v-if="props.file.locked === true" variant="warning" class="shrink-0">
      {{ t('admin.develop.timeline.lockedFile') }}
    </Badge>
    <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ formatBytes(props.file.size) }}</span>
    <Button v-if="canPreview(props.file)" variant="ghost" size="xs" class="print:hidden" @click="emit('preview')">
      <EyeIcon />
      {{ t('admin.develop.content.preview') }}
    </Button>
    <Button variant="ghost" size="xs" class="print:hidden" @click="emit('download')">
      <DownloadIcon />
      {{ t('admin.develop.content.download') }}
    </Button>
    <Button
      v-if="props.removable"
      variant="ghost"
      size="xs"
      class="print:hidden"
      :disabled="props.busy"
      @click="emit('remove')"
    >
      <Trash2Icon class="text-destructive" />
      {{ t('admin.develop.docs.task.remove') }}
    </Button>
  </Panel>
</template>
