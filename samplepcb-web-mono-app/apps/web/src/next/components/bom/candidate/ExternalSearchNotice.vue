<script setup lang="ts">
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { useCandidateDrawer } from './useCandidateDrawer';

// 저장된 부품 우선 검색(실험) — 저장된 공급사 부품 중 값·패키지 일치 후보로 외부 API 호출을 생략한 행.
// [외부 공급사 추가 검색]은 기존 외부 공급사 판단 결과로 이 행의 후보와 선정을 갱신한다.
const { props, emit } = useCandidateDrawer();
</script>

<template>
  <Alert variant="info" size="sm">
    <AlertTitle>실험: 저장된 부품을 먼저 검색했습니다</AlertTitle>
    <AlertDescription>
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          기존에 저장된 공급사 부품 중 값과 패키지가 일치하는 후보를 엔진이 확인해 외부 API 호출을 생략했습니다. 추가 검색을
          실행하면 기존 외부 공급사 판단 결과로 이 행의 후보와 선정을 갱신합니다.
          <span v-if="props.externalSearchError !== ''" class="text-destructive mt-1 block font-medium">
            {{ props.externalSearchError }}
          </span>
        </span>
        <Button
          size="sm"
          class="shrink-0"
          :disabled="props.externalSearchRunning || props.interactionLocked"
          @click="emit('externalSupplierSearch')"
        >
          {{ props.externalSearchRunning ? '외부 공급사 검색 중…' : '외부 공급사 추가 검색' }}
        </Button>
      </div>
    </AlertDescription>
  </Alert>
</template>
