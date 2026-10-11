<script setup lang="ts">
// 아직 문항에 안 붙은 그림 — 이 회차에 올렸지만 어느 문항에도 없는 것(서버 looseFigures − 지금 편집 중에 붙인 것).
// 그림 올리기는 저장과 따로라 붙이기 전에 화면을 떠나면 문항 그림 목록에서 사라진다 — 이 줄에서 다시 붙이거나 지운다.
// P2 의 AI 분석도 그림을 먼저 올리고 나중에 문항에 매핑하므로 같은 줄을 쓴다. 초안일 때만 그린다(부모가 판정).
import { ImageIcon, PlusIcon, Trash2Icon } from '@lucide/vue';
import { formatBytes } from '@/lib/format';
import Panel from '@/next/components/common/Panel.vue';
import { Button } from '@/next/components/ui/button';
import EqFigureThumb from './EqFigureThumb.vue';
import type { EqFigureDraft } from './eq-round';
import type { EqFigureUrls } from './useAdminPcbEqRounds';

defineProps<{
  figures: EqFigureDraft[];
  urls: EqFigureUrls;
  poId: number;
  reviewId: number;
  /** 붙일 문항이 있고 그 문항에 자리가 남았는가 — 아니면 붙이기 버튼을 끄고 이유를 말한다. */
  attachBlockedReason: string | null;
}>();

const emit = defineEmits<{
  attach: [fileId: number];
  remove: [fileId: number];
  zoom: [url: string, name: string];
}>();
</script>

<template>
  <Panel v-if="figures.length > 0" tone="muted" size="sm" class="grid gap-2" data-eq-loose-figures>
    <p class="flex flex-wrap items-center gap-1.5 text-xs">
      <ImageIcon class="size-3.5" />
      <span class="font-semibold">아직 문항에 안 붙은 그림 {{ figures.length }}</span>
      <span class="text-muted-foreground">
        — 올리고 저장하지 않았거나 문항에서 빠진 그림입니다. {{ attachBlockedReason ?? '붙인 뒤 [임시저장]하세요.' }}
      </span>
    </p>
    <ul class="grid gap-2 sm:grid-cols-2">
      <li v-for="f in figures" :key="f.fileId">
        <Panel size="xs" tone="card" class="flex items-start gap-2">
          <EqFigureThumb :urls="urls" :po-id="poId" :review-id="reviewId" :file-id="f.fileId" :name="f.name" size="sm" @zoom="(u, n) => emit('zoom', u, n)" />
          <div class="grid min-w-0 flex-1 gap-1.5 text-xs">
            <span class="truncate font-medium" :title="f.name">{{ f.name }}</span>
            <span class="text-muted-foreground tabular-nums">{{ formatBytes(f.size) }}</span>
            <Button
              variant="outline"
              size="xs"
              class="w-fit"
              :disabled="attachBlockedReason !== null"
              :title="attachBlockedReason ?? '지금 보고 있는 문항에 붙입니다(비공개로 — 공개는 붙인 뒤 켜세요).'"
              @click="emit('attach', f.fileId)"
            >
              <PlusIcon />
              이 문항에 붙이기
            </Button>
          </div>
          <Button variant="ghost" size="icon-xs" :aria-label="`붙지 않은 그림 ${f.name} 삭제`" title="그림 삭제" @click="emit('remove', f.fileId)">
            <Trash2Icon class="text-destructive" />
          </Button>
        </Panel>
      </li>
    </ul>
  </Panel>
</template>
