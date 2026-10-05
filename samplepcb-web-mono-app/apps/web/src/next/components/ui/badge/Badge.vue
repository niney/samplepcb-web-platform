<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { BadgeVariants } from "."
import { reactiveOmit } from "@vueuse/core"
import { Primitive } from "reka-ui"
import { cn } from '@/next/lib/utils'
import { badgeVariants } from "."

const props = defineProps<PrimitiveProps & {
  variant?: BadgeVariants["variant"]
  class?: HTMLAttributes["class"]
}>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <!-- 관리자 리뉴얼: as·asChild 가 없으면 span 하나만 그린다 — 배지가 많은 화면(후보 서랍 등)에서 Primitive
       인스턴스 수만큼 열기 비용이 들던 것을 줄인다. 다른 태그·asChild 가 필요할 때만 Primitive. -->
  <span v-if="props.as === undefined && props.asChild !== true" data-slot="badge" :class="cn(badgeVariants({ variant }), props.class)">
    <slot />
  </span>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <Primitive
    v-else
    data-slot="badge"
    :class="cn(badgeVariants({ variant }), props.class)"
    v-bind="delegatedProps"
  >
    <slot />
  </Primitive>
</template>
