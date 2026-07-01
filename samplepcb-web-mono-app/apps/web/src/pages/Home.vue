<script setup lang="ts">
import { useHealth, useMe } from '@sp/shared';
import { formatPrice } from '@sp/utils';

// vue-query 결과는 ref 들의 묶음이므로 구조분해해서 템플릿에서 자동 unwrap 시킨다.
const {
  data: health,
  isPending: isHealthPending,
  isError: isHealthError,
  error: healthError,
} = useHealth();

const {
  data: me,
  isPending: isMePending,
  isError: isMeError,
  error: meError,
} = useMe();

// @sp/utils 데모
const demoPrice = formatPrice(1234567);
</script>

<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-bold">SAMPLEPCB 신규 프런트</h1>

    <!-- API 헬스체크 -->
    <section class="rounded-lg border border-gray-200 bg-white p-4">
      <h2 class="mb-2 text-sm font-semibold text-gray-500">API 상태 (/api/health)</h2>
      <p v-if="isHealthPending" class="text-gray-400">불러오는 중…</p>
      <p v-else-if="isHealthError" class="text-red-600">
        오류: {{ healthError?.message ?? '알 수 없는 오류' }}
      </p>
      <p v-else-if="health" class="text-green-700">
        정상 — service: <span class="font-mono">{{ health.service }}</span>
      </p>
    </section>

    <!-- 로그인 회원 정보 -->
    <section class="rounded-lg border border-gray-200 bg-white p-4">
      <h2 class="mb-2 text-sm font-semibold text-gray-500">내 정보 (/api/me)</h2>
      <p v-if="isMePending" class="text-gray-400">불러오는 중…</p>
      <p v-else-if="isMeError" class="text-red-600">
        오류: {{ meError?.message ?? '알 수 없는 오류' }}
      </p>
      <ul v-else-if="me" class="space-y-1 text-sm text-gray-700">
        <li>아이디: {{ me.mbId }}</li>
        <li>닉네임: {{ me.mbNick }}</li>
        <li>레벨: {{ me.level }}</li>
        <li>관리자: {{ me.isAdmin ? '예' : '아니오' }}</li>
      </ul>
      <p v-else class="text-gray-400">로그인 정보가 없습니다.</p>
    </section>

    <!-- @sp/utils 데모 -->
    <section class="rounded-lg border border-gray-200 bg-white p-4">
      <h2 class="mb-2 text-sm font-semibold text-gray-500">formatPrice 데모 (@sp/utils)</h2>
      <p class="text-gray-700">1234567 → <span class="font-semibold">{{ demoPrice }}</span></p>
    </section>
  </div>
</template>
