<script setup lang="ts">
import type { TabsListProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsList } from "reka-ui"
import { computed, provide } from "vue"
import { cn } from '@/next/lib/utils'
import { TABS_VARIANT_KEY, type TabsVariant } from "./context"

// 관리자 리뉴얼: variant — line(기본, 밑줄 탭·넘치면 줄바꿈)·segment(업스트림 회색 바탕 알약). context.ts 참고.
const props = defineProps<TabsListProps & { class?: HTMLAttributes["class"]; variant?: TabsVariant }>()

const delegatedProps = reactiveOmit(props, "class", "variant")
const variant = computed<TabsVariant>(() => props.variant ?? "line")
provide(TABS_VARIANT_KEY, variant)
</script>

<template>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <TabsList
    data-slot="tabs-list"
    :data-variant="variant"
    v-bind="delegatedProps"
    :class="cn(
      variant === 'segment'
        ? 'bg-muted text-muted-foreground inline-flex h-8 w-fit items-center justify-center rounded-lg p-0.75'
        : 'text-muted-foreground flex w-fit flex-wrap items-end gap-1',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
