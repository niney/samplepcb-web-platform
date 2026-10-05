<script setup lang="ts">
import type { AvatarImageProps } from "reka-ui"
import { AvatarImage } from "reka-ui"

const props = defineProps<AvatarImageProps>()
</script>

<template>
  <!-- @vue-expect-error exactOptionalPropertyTypes — reka-ui 선택 prop 이 undefined 를 받지 않는다(scripts/next-ui-expect-errors.mjs) -->
  <AvatarImage
    data-slot="avatar-image"
    v-bind="props"
    class="aspect-square size-full"
  >
    <slot />
  </AvatarImage>
</template>
