<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { XIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 편집기 행 삭제 — 아이콘 버튼 하나, 접근 이름은 옛 화면과 같은 '삭제'(admin.develop.editor.removeRow).
const emit = defineEmits<{ remove: [] }>();
const { t } = useI18n();
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    class="shrink-0"
    :aria-label="t('admin.develop.editor.removeRow')"
    :title="t('admin.develop.editor.removeRow')"
    @click="emit('remove')"
  >
    <XIcon class="text-destructive" />
  </Button>
</template>
