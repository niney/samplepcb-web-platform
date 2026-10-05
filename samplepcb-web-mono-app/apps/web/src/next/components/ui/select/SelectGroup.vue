<script setup lang="ts">
import type { SelectGroupProps } from "reka-ui"
import { SelectGroup } from "reka-ui"

const props = defineProps<SelectGroupProps>()
</script>

<template>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <SelectGroup
    data-slot="select-group"
    v-bind="props"
  >
    <slot />
  </SelectGroup>
</template>
