<script setup lang="ts">
// 고객 의견의 번역(D20 P4) — 고객은 한국어로 쓰고, 협력사 포털 언어가 영어·중국어면 화면과 회신서 엑셀에
// 이 번역문이 **원문과 함께** 보인다. 고객 회신이 도착하면 AI 가 뒤에서 한 번 번역해 두고(by=ai), 여기서 고치면
// 고친 문장이 나간다(by=admin). 번역이 없으면 협력사에게는 지금처럼 원문만 보인다 — 전달·승인을 막지 않는다.
import { ref, watch } from 'vue';
import { LanguagesIcon, PencilIcon, RefreshCwIcon } from '@lucide/vue';
import type { AdminPcbEqCommentTranslationBodyType, PcbEqCommentTranslationType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Textarea } from '@/next/components/ui/textarea';

const props = defineProps<{
  /** 문항 id — 입력 칸 id 가 겹치지 않게. */
  itemId: number;
  translation: PcbEqCommentTranslationType | null;
  /** 'PCB EQ 분석'이 켜져 있는가 — 꺼져 있으면 AI 번역 버튼 대신 직접 적기만 남는다. */
  aiEnabled: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  save: [body: AdminPcbEqCommentTranslationBodyType];
  /** 이 회차의 의견을 AI 로 번역 — force 면 이미 있는 번역(직접 고친 것 포함)도 다시. */
  translate: [force: boolean];
}>();

const editing = ref(false);
const en = ref('');
const zh = ref('');
function startEdit(): void {
  en.value = props.translation?.en ?? '';
  zh.value = props.translation?.['zh-CN'] ?? '';
  editing.value = true;
}
// 저장·번역이 끝나 서버 값이 바뀌면 편집을 닫는다(같은 값이 다시 와도 닫히게 시각까지 본다).
watch(
  () => [props.translation?.at, props.translation?.by],
  () => {
    editing.value = false;
  },
);
const setEn = (value: string | number): void => {
  en.value = String(value);
};
const setZh = (value: string | number): void => {
  zh.value = String(value);
};
function save(): void {
  emit('save', { en: en.value.trim(), 'zh-CN': zh.value.trim() });
}
</script>

<template>
  <div class="mt-2 grid gap-1.5 border-t border-dashed pt-2 text-xs" data-eq-comment-translation>
    <p class="flex flex-wrap items-center gap-1.5">
      <LanguagesIcon class="size-3.5" />
      <span class="font-semibold">번역</span>
      <Badge v-if="translation !== null" :variant="translation.by === 'admin' ? 'success' : 'info'" data-eq-translation-by>
        {{ translation.by === 'admin' ? '담당자 수정' : 'AI 번역' }}
      </Badge>
      <span class="text-muted-foreground">협력사 화면·회신서에 원문과 함께 보입니다(포털 언어가 영어·중국어일 때).</span>
    </p>

    <template v-if="editing">
      <Field>
        <FieldLabel :for="`eq-tr-en-${String(itemId)}`">English</FieldLabel>
        <Textarea :id="`eq-tr-en-${String(itemId)}`" :model-value="en" rows="2" maxlength="6000" @update:model-value="setEn" />
      </Field>
      <Field>
        <FieldLabel :for="`eq-tr-zh-${String(itemId)}`">简体中文</FieldLabel>
        <Textarea :id="`eq-tr-zh-${String(itemId)}`" :model-value="zh" rows="2" maxlength="6000" @update:model-value="setZh" />
      </Field>
      <p class="text-muted-foreground">두 칸을 다 비우고 저장하면 번역을 지웁니다(협력사에게 원문만 보입니다).</p>
      <p class="flex flex-wrap gap-1.5">
        <Button size="xs" :disabled="busy" data-eq-translation-save @click="save">번역 저장</Button>
        <Button variant="ghost" size="xs" :disabled="busy" @click="editing = false">취소</Button>
      </p>
    </template>

    <template v-else>
      <dl v-if="translation !== null" class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
        <dt class="text-muted-foreground">English</dt>
        <dd class="text-foreground whitespace-pre-wrap" data-eq-translation-en>{{ translation.en === '' ? '—' : translation.en }}</dd>
        <dt class="text-muted-foreground">中文</dt>
        <dd class="text-foreground whitespace-pre-wrap" data-eq-translation-zh>{{ translation['zh-CN'] === '' ? '—' : translation['zh-CN'] }}</dd>
      </dl>
      <p v-else class="text-muted-foreground" data-eq-translation-none>
        번역이 없습니다 — 협력사에게는 한국어 원문만 보입니다.
        <template v-if="!aiEnabled">(AI 번역은 설정 &gt; AI 연동의 'PCB EQ 분석'을 켜면 자동으로 됩니다.)</template>
      </p>
      <p class="flex flex-wrap gap-1.5">
        <Button variant="outline" size="xs" :disabled="busy" data-eq-translation-edit @click="startEdit">
          <PencilIcon />
          {{ translation === null ? '직접 적기' : '번역 수정' }}
        </Button>
        <Button
          v-if="aiEnabled"
          variant="ghost"
          size="xs"
          :disabled="busy"
          :title="translation === null ? '이 회차에서 번역이 없는 의견을 AI 로 번역합니다.' : '이 회차의 의견을 모두 AI 로 다시 번역합니다 — 직접 고친 번역도 바뀝니다.'"
          data-eq-translation-ai
          @click="emit('translate', translation !== null)"
        >
          <RefreshCwIcon />
          {{ busy ? '번역 중…' : translation === null ? 'AI 번역' : 'AI 로 다시 번역' }}
        </Button>
      </p>
    </template>
  </div>
</template>
