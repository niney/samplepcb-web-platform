<script setup lang="ts">
import type { SeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from '@/next/lib/utils'
import { Separator } from '@/next/components/ui/separator'

const props = withDefaults(defineProps<SeparatorProps & { class?: HTMLAttributes["class"] }>(), {
  orientation: "vertical",
})
const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <Separator
    data-slot="button-group-separator"
    v-bind="delegatedProps"
    :orientation="props.orientation"
    :class="cn(
      'bg-input relative !m-0 self-stretch data-[orientation=vertical]:h-auto',
      props.class,
    )"
  />
</template>
