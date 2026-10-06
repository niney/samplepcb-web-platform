<script setup lang="ts">
import { XIcon } from '@lucide/vue';
import type { PartBulkDeletePreviewDataType } from '@sp/api-contract';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { supplierLabel } from './part-format';

// 현재 필터 결과 전체 삭제 확인 — 서버 미리보기(대상·보호 건수·previewHash)를 보여 주고, 미리보기가 내준 확인
// 문구를 그대로 입력해야 삭제 버튼이 열린다. 견적에 연결된 부품은 삭제하지 않고 보호한다(서버 판정).
// 상태(미리보기·입력·오류)는 화면이 갖고, 여기는 그리기만 한다 — 필터가 바뀌면 화면이 닫는다.
defineProps<{
  preview: PartBulkDeletePreviewDataType;
  error: string;
  pending: boolean;
}>();
const confirmation = defineModel<string>('confirmation', { required: true });
const emit = defineEmits<{ close: []; execute: [] }>();
</script>

<template>
  <Panel tone="destructive" size="md" class="flex flex-col gap-3 text-sm">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 class="font-semibold">필터 결과 전체 삭제 확인</h3>
        <p class="mt-1 text-xs">
          현재 페이지가 아니라 필터에 맞는 전체 {{ preview.matchedParts }}건이 대상입니다. 견적 연결 부품은 삭제하지 않고 그대로
          보호합니다.
        </p>
      </div>
      <Button variant="ghost" size="xs" @click="emit('close')">
        <XIcon />
        닫기
      </Button>
    </div>

    <div class="text-foreground grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Panel tone="card">
        <p class="text-muted-foreground text-xs">필터 일치</p>
        <p class="font-semibold tabular-nums">{{ preview.matchedParts }}건</p>
      </Panel>
      <Panel tone="card">
        <p class="text-muted-foreground text-xs">삭제 가능</p>
        <p class="text-destructive font-semibold tabular-nums">{{ preview.deletableParts }}건</p>
      </Panel>
      <Panel tone="card">
        <p class="text-muted-foreground text-xs">견적 연결 보호</p>
        <p class="text-warning font-semibold tabular-nums">{{ preview.protectedParts }}건</p>
      </Panel>
      <Panel tone="card">
        <p class="text-muted-foreground text-xs">견적 라인</p>
        <p class="font-semibold tabular-nums">{{ preview.protectedQuoteItems }}건</p>
      </Panel>
    </div>

    <Alert v-if="preview.multiSupplierParts > 0" variant="warning" size="sm">
      <AlertDescription>
        여러 실공급사 구매 조건을 함께 가진 부품 {{ preview.multiSupplierParts }}건도 삭제 대상에 포함될 수 있습니다.
      </AlertDescription>
    </Alert>
    <Alert v-if="preview.staleIndexDocuments > 0" variant="muted" size="sm">
      <AlertDescription>DB에는 없고 검색 색인에만 남은 문서 {{ preview.staleIndexDocuments }}건도 함께 정리합니다.</AlertDescription>
    </Alert>

    <div class="text-foreground grid gap-3 lg:grid-cols-2">
      <Panel tone="card">
        <p class="text-xs font-semibold">포함 구매 조건</p>
        <div class="mt-1 flex flex-wrap gap-1.5">
          <Badge v-for="supplier in preview.supplierOffers" :key="supplier.value" variant="secondary" class="tabular-nums">
            {{ supplierLabel(supplier.value) }} {{ supplier.count }}
          </Badge>
          <span v-if="preview.supplierOffers.length === 0" class="text-muted-foreground text-xs">구매 조건 없음</span>
        </div>
      </Panel>
      <Panel tone="card">
        <p class="text-xs font-semibold">카탈로그 원본</p>
        <ul v-if="preview.catalogSources.length > 0" class="mt-1 space-y-1 text-xs">
          <li
            v-for="source in preview.catalogSources"
            :key="`${source.supplier}-${source.sourceDataset}-${source.sourceSha256 ?? ''}`"
          >
            {{ supplierLabel(source.supplier) }} · {{ source.sourceDataset }} · {{ source.count }}건
            <span v-if="source.sourceSha256 !== null" class="text-muted-foreground font-mono">{{ source.sourceSha256.slice(0, 12) }}…</span>
          </li>
        </ul>
        <span v-else class="text-muted-foreground text-xs">카탈로그 원본 메타 없음</span>
      </Panel>
    </div>

    <Panel v-if="preview.protectedSample.length > 0" class="bg-card text-foreground">
      <p class="text-warning text-xs font-semibold">삭제하지 않는 견적 연결 부품</p>
      <ul class="mt-1 max-h-32 space-y-1 overflow-y-auto text-xs">
        <li v-for="part in preview.protectedSample" :key="part.partId">
          <span class="font-medium">{{ part.mpn }}</span>
          <span class="text-muted-foreground"> · {{ part.manufacturerName }} · 견적 #{{ part.quoteIds.join(', #') }}</span>
        </li>
      </ul>
    </Panel>

    <div class="flex flex-wrap items-end gap-2">
      <Field class="min-w-56 flex-1">
        <FieldLabel for="parts-bulk-delete-confirm">
          <span class="text-foreground">삭제하려면 <span class="font-mono font-semibold">{{ preview.confirmation }}</span> 입력</span>
        </FieldLabel>
        <Input
          id="parts-bulk-delete-confirm"
          v-model="confirmation"
          type="text"
          class="font-mono"
          :placeholder="preview.confirmation"
          @keydown.enter="emit('execute')"
        />
      </Field>
      <Button
        variant="destructive"
        :disabled="confirmation !== preview.confirmation || preview.deletableParts === 0 || pending"
        @click="emit('execute')"
      >
        {{ pending ? '삭제 중…' : `${String(preview.deletableParts)}건 삭제` }}
      </Button>
    </div>
    <p v-if="error !== ''" class="text-xs">{{ error }}</p>
  </Panel>
</template>
