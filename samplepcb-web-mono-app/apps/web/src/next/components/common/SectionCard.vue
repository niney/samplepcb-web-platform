<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { ChevronRightIcon, ChevronUpIcon } from '@lucide/vue';
import { Button } from '@/next/components/ui/button';

// 화면 안의 한 덩어리(섹션) — 머리(제목·부가 정보·우측 동작) + 안내 띠(선택) + 본문(선택). 화면마다
// div 로 손수 짓던 섹션 상자·접힘 토글(점선 줄)·안내 띠를 하나로 모았다.
//   · collapsible 이면 v-model:open 으로 접고 편다. 접힌 모양은 점선 한 줄(#collapsed 로 문구 교체).
//     closable=false 면 펼친 뒤 '접기'를 두지 않는다(펼치기 전용 — 조회용 기본 접힘 섹션).
//   · #notice 는 머리 아래 전폭 안내 띠 자리 — NoticeBand 를 넣는다.
//   · 본문 슬롯이 없으면 본문 칸을 그리지 않는다(머리만 있는 섹션: "접수 없음" 같은 한 줄 상태).
//   · flush 면 본문 여백을 없앤다 — 표를 담을 때(표 양끝 칸은 카드 테두리에서 한 단 띄운다).
const props = withDefaults(
  defineProps<{
    title?: string;
    collapsible?: boolean;
    closable?: boolean;
    flush?: boolean;
  }>(),
  { title: '', collapsible: false, closable: true, flush: false },
);
const open = defineModel<boolean>('open', { default: true });
const slots = useSlots();
const hasBody = computed(() => slots.default !== undefined);
const hasNotice = computed(() => slots.notice !== undefined);
</script>

<template>
  <button
    v-if="props.collapsible && !open"
    type="button"
    class="bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-2.5 text-sm"
    @click="open = true"
  >
    <ChevronRightIcon class="size-4" />
    <span class="min-w-0 truncate"><slot name="collapsed">{{ props.title }}</slot></span>
    <span class="ml-auto shrink-0 text-xs">펼치기</span>
  </button>
  <section v-else class="bg-card text-card-foreground overflow-hidden rounded-xl border shadow-xs">
    <header
      class="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
      :class="hasBody || hasNotice ? 'border-b' : ''"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h2 class="text-sm font-semibold"><slot name="title">{{ props.title }}</slot></h2>
        <span class="text-muted-foreground text-xs"><slot name="meta" /></span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <slot name="actions" />
        <Button v-if="props.collapsible && props.closable" variant="ghost" size="xs" @click="open = false">
          <ChevronUpIcon />
          접기
        </Button>
      </div>
    </header>
    <!-- 띠(NoticeBand)는 저마다 아래 구분선을 가진다 — 본문이 없으면 마지막 띠의 선이 카드 테두리와 겹쳐 지운다. -->
    <div v-if="hasNotice" :class="hasBody ? '' : '[&>*:last-child]:border-b-0'">
      <slot name="notice" />
    </div>
    <div
      v-if="hasBody"
      :class="
        props.flush
          ? '[&_td:first-child]:pl-4 [&_td:last-child]:pr-4 [&_th:first-child]:pl-4 [&_th:last-child]:pr-4'
          : 'flex flex-col gap-3 p-4'
      "
    >
      <slot />
    </div>
  </section>
</template>
