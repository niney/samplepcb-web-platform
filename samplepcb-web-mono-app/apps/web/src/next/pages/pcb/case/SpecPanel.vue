<script setup lang="ts">
import { DownloadIcon, PencilIcon, PinIcon, PinOffIcon, XIcon } from '@lucide/vue';
import { downloadAdminFile } from '@/admin/useAdminQuotes';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { pcbCategoryBadge } from '@/next/components/pcb/pcb-badges';
import { usePcbCaseContext } from './usePcbCase';

// 제작 사양 곁판 — 덮개가 아니라 곁판이다(모달 아님). 뒤 조작을 막지 않아, 사양을 보면서 협력사를 고르고
// 발주서를 쓸 수 있다. 항목은 접지 않고 전부 세운다(사양은 협력사에 그대로 넘어가는 값이라 요약하지 않는다).
const { detail, specEntries, gerberFiles, specPanelOpen, specPanelPinned, toggleSpecPin, closeSpecPanel, specEditOpen } =
  usePcbCaseContext();
</script>

<template>
  <aside
    v-if="detail !== null"
    class="bg-background fixed top-0 right-0 z-40 flex h-dvh w-full max-w-md flex-col border-l transition-transform duration-200 motion-reduce:transition-none"
    :class="specPanelOpen ? 'translate-x-0 shadow-2xl' : 'pointer-events-none translate-x-full'"
    role="complementary"
    aria-label="제작 사양"
    :aria-hidden="!specPanelOpen"
  >
    <div class="flex shrink-0 items-center gap-2 border-b px-4 py-3">
      <h2 class="text-sm font-semibold">제작 사양</h2>
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" :title="detail.projectName">{{ detail.projectName }}</span>
      <Button
        :variant="specPanelPinned ? 'secondary' : 'ghost'"
        size="icon-sm"
        :aria-pressed="specPanelPinned"
        :aria-label="specPanelPinned ? '고정 풀기' : '열어 둔 채 고정'"
        title="열어 둔 채 고정 — 본문이 자리를 내줍니다"
        @click="toggleSpecPin"
      >
        <PinOffIcon v-if="specPanelPinned" />
        <PinIcon v-else />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="닫기" title="닫기 (Esc)" @click="closeSpecPanel">
        <XIcon />
      </Button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Badge :variant="pcbCategoryBadge(detail.category).variant">{{ pcbCategoryBadge(detail.category).label }}</Badge>
        {{ detail.orderCategory === 'mass' ? '양산' : '샘플' }} · {{ detail.qty }}매
      </p>
      <!-- 값은 거버 화면의 선택지 표시명, 저장 원문은 title 로 남긴다(협력사에 넘어가는 값). -->
      <dl v-if="specEntries.length > 0" class="mt-3 columns-2 gap-x-4 text-xs">
        <div v-for="entry in specEntries" :key="entry.key" class="flex break-inside-avoid items-baseline gap-1.5 border-b py-1">
          <dt class="text-muted-foreground w-20 shrink-0 truncate" :title="entry.label">{{ entry.label }}</dt>
          <dd class="min-w-0 flex-1 font-medium tabular-nums" :title="`저장값 ${entry.value}`">{{ entry.display }}</dd>
        </div>
      </dl>
      <div v-else class="bg-muted/40 mt-3 rounded-lg border border-dashed p-3.5">
        <b class="block text-sm">사양 항목이 없는 견적입니다</b>
        <p class="text-muted-foreground mt-1 text-xs">수동으로 접수된 건입니다. 아래 요청 내용과 첨부 파일로 검토하세요.</p>
      </div>

      <div v-if="detail.message !== null && detail.message !== ''" class="mt-4 border-t pt-3">
        <p class="text-muted-foreground text-xs font-medium">고객 요청</p>
        <p class="bg-muted/40 mt-1 rounded-lg border p-2.5 text-sm whitespace-pre-wrap">{{ detail.message }}</p>
      </div>

      <div v-if="gerberFiles.length > 0" class="mt-4 border-t pt-3">
        <p class="text-muted-foreground text-xs font-medium">첨부</p>
        <div class="mt-1 flex flex-wrap gap-1.5">
          <Button
            v-for="f in gerberFiles"
            :key="f.fileId"
            variant="outline"
            size="sm"
            class="max-w-full"
            :title="f.originFileName"
            @click="void downloadAdminFile(f.fileId, f.originFileName)"
          >
            <DownloadIcon />
            <span class="truncate">{{ f.originFileName }}</span>
          </Button>
        </div>
      </div>
    </div>

    <!-- 사양 수정 — 저장하면 서버가 재견적까지 한다. 발주된 건은 서버가 409. -->
    <div class="bg-muted/40 shrink-0 border-t px-4 py-3">
      <Button class="w-full" @click="specEditOpen = true">
        <PencilIcon />
        사양 수정
      </Button>
    </div>
  </aside>
</template>
