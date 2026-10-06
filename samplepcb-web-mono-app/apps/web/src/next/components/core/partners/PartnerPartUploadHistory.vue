<script setup lang="ts">
import { computed } from 'vue';
import { PARTNER_PART_UPLOAD_STATUS_LABELS, type PartnerPartUploadStatusType } from '@sp/api-contract';
import { useAdminPartnerPartUploads } from '@/admin/useAdminPartnerParts';
import SectionCard from '@/next/components/common/SectionCard.vue';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import { Badge } from '@/next/components/ui/badge';

// 선택 협력사의 업로드 이력 — 협력사를 골랐고 이력이 있을 때만 그린다(옛 화면과 같은 조건).
// 반영됨=끝남(success), 실패=문제(danger), 그 밖(분석·대기)=중립.
const props = defineProps<{ partnerId: number | null }>();

const partnerIdRef = computed(() => props.partnerId);
const uploadsQuery = useAdminPartnerPartUploads(partnerIdRef);
const uploads = computed(() => uploadsQuery.data.value?.data.items ?? []);

const statusVariant = (status: PartnerPartUploadStatusType): BadgeVariant =>
  status === 'applied' ? 'success' : status === 'failed' ? 'danger' : 'secondary';
const fmtQty = (value: number | null): string => (value === null ? '—' : value.toLocaleString('ko-KR'));
const fmtDate = (iso: string | null): string => (iso === null ? '—' : new Date(iso).toLocaleDateString('ko-KR'));
</script>

<template>
  <SectionCard v-if="partnerId !== null && uploads.length > 0" title="업로드 이력">
    <ul class="divide-y">
      <li
        v-for="upload in uploads"
        :key="upload.uploadId"
        class="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
      >
        <div class="min-w-0">
          <p class="truncate text-sm">{{ upload.fileName }}</p>
          <p class="text-muted-foreground text-xs">
            {{ fmtDate(upload.createdAt) }} ·
            {{ upload.uploadedBy === 'ADMIN' ? '관리자 대행' : '협력사 직접' }}
            <template v-if="upload.stats !== null"> · {{ fmtQty(upload.stats.rowCount) }}행</template>
            · 현재 {{ fmtQty(upload.activePartCount) }}행 사용 중
          </p>
        </div>
        <Badge :variant="statusVariant(upload.status)">{{ PARTNER_PART_UPLOAD_STATUS_LABELS[upload.status] }}</Badge>
      </li>
    </ul>
  </SectionCard>
</template>
