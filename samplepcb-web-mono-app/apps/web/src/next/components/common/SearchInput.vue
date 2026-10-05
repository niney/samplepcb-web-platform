<script setup lang="ts">
import { SearchIcon } from '@lucide/vue';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/next/components/ui/input-group';

// 제출형 검색 — 타이핑마다 조회하지 않고 Enter 로 확정한다(2만 건 목록이라 키 입력마다 쿼리를
// 보내지 않는다). v-model 은 입력 중인 글자, search 는 확정 신호.
defineProps<{ placeholder: string }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ search: [] }>();

const onInput = (value: string | number): void => {
  model.value = String(value);
};
</script>

<template>
  <form role="search" class="w-full sm:w-64" @submit.prevent="emit('search')">
    <InputGroup>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        :model-value="model"
        type="search"
        :placeholder="placeholder"
        :aria-label="placeholder"
        @update:model-value="onInput"
      />
    </InputGroup>
  </form>
</template>
