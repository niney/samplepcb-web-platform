<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) 작성 패널의 **고객에게 보일 모습** 미리보기.
// 고객 화면(sp-php 주문 상세 _bom_confirm_section.php)의 부품별 4칸 형식 — 기술타입·문제설명·당사제안·참고자료 —
// 을 같은 어휘로 흉내 낸다. 정확한 근거 박제·대체품 해석은 보낼 때 서버가 하므로 여기 값은 작성 중 초안이다.
// ⚠ MPN 을 heading 으로 두지 않는다 — 작성 카드(section > h3 MPN)를 찾는 e2e 선택자와 겹치지 않게.
import type { BomConfirmPreviewIssue, BomConfirmPreviewOption } from '../../../admin/bomConfirmPreview';

defineProps<{
  issues: BomConfirmPreviewIssue[];
  message: string;
  dueOn: string;
}>();

const TONE: Record<BomConfirmPreviewOption['tone'], string> = {
  plus: 'text-rose-700',
  minus: 'text-emerald-700',
  zero: 'text-gray-500',
  unknown: 'text-amber-700',
};
</script>

<template>
  <div class="grid gap-3">
    <div>
      <p class="text-xs font-bold text-gray-900">고객에게 보일 모습</p>
      <p class="mt-0.5 text-[11px] leading-4 text-gray-500">주문 상세 › 부품 확인 요청 — 메일엔 이 화면으로 가는 링크만 갑니다.</p>
    </div>
    <p v-if="issues.length === 0" class="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-xs text-gray-400">
      품목을 고르면 여기서 고객 화면을 미리 봅니다.
    </p>
    <template v-else>
      <div class="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900">
        <template v-if="issues.every((issue) => issue.notice)">
          <span class="rounded-full bg-sky-100 px-1.5 py-0.5 font-bold text-sky-800">안내</span>
          <span class="ml-1 text-gray-600">고객이 고를 것은 없습니다</span>
        </template>
        <template v-else>
          <span class="rounded-full bg-rose-100 px-1.5 py-0.5 font-bold text-rose-700">확인 대기</span>
          <span v-if="dueOn !== ''" class="ml-1 text-gray-600">회신 기한 {{ dueOn }}</span>
        </template>
        <p v-if="message.trim() !== ''" class="mt-1.5 whitespace-pre-line border-l-2 border-sky-400 bg-white px-2 py-1 text-gray-800">{{ message.trim() }}</p>
      </div>
      <article v-for="(issue, index) in issues" :key="issue.key" class="rounded-lg border border-gray-200 bg-white text-[11px]">
        <p class="flex flex-wrap items-baseline gap-1.5 border-b border-gray-100 px-3 py-2">
          <span class="rounded bg-gray-900 px-1.5 py-0.5 font-bold text-white">부품 {{ index + 1 }}</span>
          <b class="break-all text-gray-900">{{ issue.mpn }}</b>
          <span v-if="issue.manufacturerName !== null" class="text-gray-500">{{ issue.manufacturerName }}</span>
        </p>
        <dl class="grid grid-cols-[64px_minmax(0,1fr)]">
          <dt class="border-b border-gray-100 bg-gray-50 px-2 py-1.5 font-bold text-gray-500">기술타입</dt>
          <dd class="border-b border-gray-100 px-2 py-1.5">
            <span class="rounded-full px-1.5 py-0.5 font-bold" :class="issue.notice ? 'bg-sky-100 text-sky-800' : issue.moq ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-700'">{{ issue.issueTypeLabel }}</span>
          </dd>
          <dt class="border-b border-gray-100 bg-gray-50 px-2 py-1.5 font-bold text-gray-500">문제설명</dt>
          <dd class="whitespace-pre-line border-b border-gray-100 px-2 py-1.5 text-gray-800">{{ issue.description.trim() === '' ? '—' : issue.description }}</dd>
          <dt class="border-b border-gray-100 bg-gray-50 px-2 py-1.5 font-bold text-gray-500">{{ issue.notice ? '안내' : '당사제안' }}</dt>
          <dd class="border-b border-gray-100 px-2 py-1.5">
            <ul class="grid gap-1">
              <li v-for="option in issue.options" :key="option.code" class="rounded border border-gray-200 px-1.5 py-1">
                <p class="flex flex-wrap items-center gap-1">
                  <span class="grid size-4 place-items-center rounded-full bg-gray-200 text-[10px] font-bold text-gray-900">{{ option.code }}</span>
                  <b class="text-gray-900">{{ option.title }}</b>
                  <span class="ml-auto font-bold" :class="TONE[option.tone]">{{ option.deltaText }}</span>
                </p>
                <p v-if="option.summary !== ''" class="mt-0.5 pl-5 text-gray-500">{{ option.summary }}</p>
              </li>
            </ul>
          </dd>
          <dt class="bg-gray-50 px-2 py-1.5 font-bold text-gray-500">참고자료</dt>
          <dd class="px-2 py-1.5">
            <span class="inline-block rounded border border-gray-300 px-1.5 py-0.5 font-bold text-gray-600">분석근거 보기</span>
            <span class="ml-1 text-gray-400">원 부품·확인 근거·제안 부품 비교표</span>
          </dd>
        </dl>
      </article>
    </template>
  </div>
</template>
