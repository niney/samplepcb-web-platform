<script setup lang="ts">
import { APP_BAR } from '../../lib/app-bar';

// 앱 셸 위 바 채우기 — 화면이 자기 제목·안내·버튼을 AppShellLayout 의 위 바 자리로 보낸다(Teleport). 셸은 화면이 바뀌어도
// 그대로 남아 사이드바·사용자 메뉴를 다시 그리지 않는다. 버튼은 슬롯: title-actions = 제목 옆, actions = 안내 옆,
// menu = 사용자 메뉴 맨 위. 자리는 셸이 먼저 그려야 하므로 defer(같은 렌더가 끝난 뒤 자리를 찾는다).
defineProps<{
  title: string;
  guide: string;
  guideError?: boolean; // 안내 자리에 오류 문구를 띄울 때(빨강)
}>();
</script>

<template>
  <Teleport defer :to="`#${APP_BAR.title}`">
    <p class="hidden text-[21px] font-bold leading-[1.3] text-white xl:block">{{ title }}</p>
    <slot name="title-actions" />
  </Teleport>
  <Teleport defer :to="`#${APP_BAR.guide}`">
    <p
      class="text-[15px] font-bold leading-[1.3] lg:text-[18px] 2xl:text-[21px]"
      :class="guideError ? 'text-[#ff8f8f]' : 'text-[#1bfffb]'"
      :role="guideError ? 'alert' : undefined"
    >
      {{ guide }}
    </p>
  </Teleport>
  <Teleport v-if="$slots.actions" defer :to="`#${APP_BAR.actions}`">
    <slot name="actions" />
  </Teleport>
  <Teleport v-if="$slots.menu" defer :to="`#${APP_BAR.menu}`">
    <slot name="menu" />
  </Teleport>
</template>
