<script setup lang="ts">
import type { TabsTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { TabsTrigger, useForwardProps } from "reka-ui"
import { computed, inject } from "vue"
import { cn } from '@/next/lib/utils'
import { TABS_VARIANT_KEY, type TabsVariant } from "./context"

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")

const forwardedProps = useForwardProps(delegatedProps)

// 관리자 리뉴얼: 모양은 감싸는 TabsList 의 variant 를 따른다(context.ts).
const variant = inject(TABS_VARIANT_KEY, computed<TabsVariant>(() => "line"))

// 옛 관리자 탭: 활성 = 주 색 글자 + 주 색 밑줄(2px), 그 외 = 흐린 글자·hover 옅은 바탕. -mb-px 로 줄 밑줄 위에 겹친다.
const LINE = "-mb-px inline-flex items-center justify-center gap-1.5 rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
const SEGMENT = "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-3 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
</script>

<template>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <TabsTrigger
    data-slot="tabs-trigger"
    :class="cn(variant === 'segment' ? SEGMENT : LINE, props.class)"
    v-bind="forwardedProps"
  >
    <slot />
  </TabsTrigger>
</template>
