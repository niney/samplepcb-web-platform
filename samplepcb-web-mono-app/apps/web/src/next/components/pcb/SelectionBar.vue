<script setup lang="ts">
import { Trash2Icon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 선택 삭제 툴바 — 선택이 없어도 항상 보인다("체크하면 지울 수 있다"를 먼저 알린다, 2026-08-06).
// 바탕은 중립, 위험색은 버튼에만 — 그것도 실제로 고른 게 있을 때만 붉게 켠다.
// '선택 해제'는 두지 않는다(머리 체크박스가 같은 일을 한다).
defineProps<{ count: number }>();
const emit = defineEmits<{ delete: [] }>();
</script>

<template>
  <div class="bg-muted/40 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
    <p class="text-muted-foreground text-sm">
      현재 페이지에서 견적을 체크해 함께 삭제할 수 있습니다.
      <span v-if="count > 0" class="text-foreground ml-1 font-medium">{{ count }}건 선택</span>
    </p>
    <Button
      :variant="count > 0 ? 'destructive' : 'outline'"
      size="sm"
      :disabled="count === 0"
      @click="emit('delete')"
    >
      <Trash2Icon />
      선택 {{ count }}건 영구 삭제
    </Button>
  </div>
</template>
