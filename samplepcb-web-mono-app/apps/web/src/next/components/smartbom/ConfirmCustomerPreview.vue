<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) 작성 패널의 **고객에게 보일 모습** 미리보기 — 옛 BomConfirmCustomerPreview 의 짝(같은 props).
// 고객 화면(sp-php 주문 상세 _bom_confirm_section.php)의 부품별 4칸 — 기술타입·문제설명·당사제안·참고자료 — 을
// 같은 어휘로 흉내 낸다. 근거 박제·대체품 해석은 보낼 때 서버가 하므로 여기 값은 작성 중 초안이다.
// ⚠ MPN 을 heading 으로 두지 않는다 — 작성 카드(section h3 MPN)를 찾는 e2e 선택자와 겹치지 않게.
import type { BomConfirmPreviewIssue } from '@/admin/bomConfirmPreview';
import { Alert } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Card } from '@/next/components/ui/card';
import Panel from '@/next/components/common/Panel.vue';
import { confirmPreviewToneClass } from './confirm/confirm-tones';

defineProps<{
  issues: BomConfirmPreviewIssue[];
  message: string;
  dueOn: string;
}>();
</script>

<template>
  <div class="grid gap-3">
    <div>
      <p class="text-xs font-semibold">고객에게 보일 모습</p>
      <p class="text-muted-foreground mt-0.5 text-xs">주문 상세 › 부품 확인 요청 — 메일엔 이 화면으로 가는 링크만 갑니다.</p>
    </div>
    <Panel v-if="issues.length === 0" size="md" class="text-muted-foreground border-dashed text-center text-xs">
      품목을 고르면 여기서 고객 화면을 미리 봅니다.
    </Panel>
    <template v-else>
      <Alert variant="info" size="sm">
        <div class="col-span-2 text-xs">
          <template v-if="issues.every((issue) => issue.notice)">
            <Badge variant="info">안내</Badge>
            <span class="text-muted-foreground ml-1">고객이 고를 것은 없습니다</span>
          </template>
          <template v-else>
            <Badge variant="danger">확인 대기</Badge>
            <span v-if="dueOn !== ''" class="text-muted-foreground ml-1">회신 기한 {{ dueOn }}</span>
          </template>
          <Panel v-if="message.trim() !== ''" size="xs" class="bg-background text-foreground mt-1.5 whitespace-pre-line">
            {{ message.trim() }}
          </Panel>
        </div>
      </Alert>
      <Card v-for="(issue, index) in issues" :key="issue.key" class="gap-0 overflow-hidden py-0">
        <p class="flex flex-wrap items-baseline gap-1.5 border-b px-3 py-2 text-xs">
          <Badge>부품 {{ index + 1 }}</Badge>
          <b class="break-all">{{ issue.mpn }}</b>
          <span v-if="issue.manufacturerName !== null" class="text-muted-foreground">{{ issue.manufacturerName }}</span>
        </p>
        <dl class="grid grid-cols-[64px_minmax(0,1fr)] text-xs">
          <dt class="bg-muted/50 text-muted-foreground border-b px-2 py-1.5 font-semibold">기술타입</dt>
          <dd class="border-b px-2 py-1.5">
            <Badge :variant="issue.notice ? 'info' : issue.moq ? 'warning' : 'danger'">{{ issue.issueTypeLabel }}</Badge>
          </dd>
          <dt class="bg-muted/50 text-muted-foreground border-b px-2 py-1.5 font-semibold">문제설명</dt>
          <dd class="border-b px-2 py-1.5 whitespace-pre-line">{{ issue.description.trim() === '' ? '—' : issue.description }}</dd>
          <dt class="bg-muted/50 text-muted-foreground border-b px-2 py-1.5 font-semibold">{{ issue.notice ? '안내' : '당사제안' }}</dt>
          <dd class="border-b px-2 py-1.5">
            <ul class="grid gap-1">
              <li v-for="option in issue.options" :key="option.code">
                <Panel size="xs">
                  <p class="flex flex-wrap items-center gap-1">
                    <span class="bg-muted grid size-4 place-items-center rounded-full text-xs font-semibold">{{ option.code }}</span>
                    <b>{{ option.title }}</b>
                    <span class="ml-auto font-semibold" :class="confirmPreviewToneClass(option.tone)">{{ option.deltaText }}</span>
                  </p>
                  <p v-if="option.summary !== ''" class="text-muted-foreground mt-0.5 pl-5">{{ option.summary }}</p>
                </Panel>
              </li>
            </ul>
          </dd>
          <dt class="bg-muted/50 text-muted-foreground px-2 py-1.5 font-semibold">참고자료</dt>
          <dd class="px-2 py-1.5">
            <Badge variant="outline">분석근거 보기</Badge>
            <span class="text-muted-foreground ml-1">원 부품·확인 근거·제안 부품 비교표</span>
          </dd>
        </dl>
      </Card>
    </template>
  </div>
</template>
