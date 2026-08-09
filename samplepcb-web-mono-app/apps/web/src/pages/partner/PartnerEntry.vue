<script setup lang="ts">
import { computed, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import { readPartnerModule } from '../../partner/partnerModule';

// /partner 진입 리졸버(포털 재설계 R1) — 리다이렉트 잔재가 아니라 **정식 진입점**이다
// (발송되는 모든 포털 메일이 이 URL 을 가리킨다). 규칙: 트랙 0=안내 / 1=그 모듈 /
// 2=기억값(현재 트랙에 유효할 때만, 무효·없음이면 BOM 우선). 트랙의 단일 진실은
// 서버 tracks(조직 capabilities) — 관리자가 트랙을 바꾸면 기억값은 자동 무효화된다.

const router = useRouter();
const { data, isLoading } = usePartnerAccess();

const access = computed(() => data.value?.data ?? null);
const noTrack = computed(() => {
  const a = access.value;
  if (a?.isPartner !== true) return false;
  return !a.tracks.bom && !a.tracks.pcb;
});

watchEffect(() => {
  const a = access.value;
  if (!a?.isPartner) return;
  const { bom, pcb } = a.tracks;
  if (!bom && !pcb) return; // 트랙 없음 — 아래 안내 렌더
  const remembered = readPartnerModule();
  const target =
    bom && pcb
      ? remembered !== null && a.tracks[remembered]
        ? remembered
        : 'bom'
      : bom
        ? 'bom'
        : 'pcb';
  void router.replace({ name: target === 'bom' ? 'partner-bom' : 'partner-pcb' });
});
</script>

<template>
  <p v-if="isLoading" class="text-sm text-gray-400">불러오는 중…</p>
  <div
    v-else-if="access !== null && !access.isPartner"
    class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
  >
    승인된 파트너 계정이 아닙니다. 파트너 등록·계정 연결은 샘플피씨비 담당자에게 문의해 주세요.
  </div>
  <div
    v-else-if="noTrack"
    class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
  >
    참여 중인 트랙(BOM 부품·PCB 제작)이 없습니다 — 샘플피씨비 담당자에게 문의해 주세요.
  </div>
</template>
