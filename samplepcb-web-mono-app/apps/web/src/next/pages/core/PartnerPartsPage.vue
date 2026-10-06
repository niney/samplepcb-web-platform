<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { EraserIcon, PowerIcon, PowerOffIcon, UploadIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { PartnerPartRowType, PartnerPartUpdateBodyType } from '@sp/api-contract';
import {
  useAdminCommitPartnerPartUpload,
  useAdminPartnerPartConfig,
  useAdminPartnerPartSummary,
  useAdminPartnerPartUpload,
  useClearAdminPartnerParts,
  useToggleAdminPartnerParts,
  useUpdateAdminPartnerPart,
  useUpdateAdminPartnerPartConfig,
} from '@/admin/useAdminPartnerParts';
import { useAdminPartnerList } from '@/admin/useAdminPartners';
import PageHeader from '@/next/components/common/PageHeader.vue';
import Panel from '@/next/components/common/Panel.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { confirmDialog } from '@/next/lib/dialog';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import PartnerPartEditDialog from '@/next/components/core/partners/PartnerPartEditDialog.vue';
import PartnerPartRowsSection from '@/next/components/core/partners/PartnerPartRowsSection.vue';
import PartnerPartUploadHistory from '@/next/components/core/partners/PartnerPartUploadHistory.vue';

// 협력사 보유 부품 뒤처리(docs/PARTNER_PARTS.md) — 옛 pages/admin/AdminPartnerParts.vue 의 리뉴얼.
//
// 이 기능은 만료도, 견적요청 제한도 두지 않는다 — 협력사 정보가 낡거나 안 맞아도 관리자가 운영으로
// 뒤처리한다는 결정(2026-08-23)이다. 그 결정이 성립하려면 뒤처리가 여기서 1~2클릭으로 끝나야 한다:
// 낡은 원장을 위로 올려 보여 주고, 끄고(비활성), 비우고, 포털 계정이 없는 협력사는 대신 올린다.

const summaryQuery = useAdminPartnerPartSummary();
const configQuery = useAdminPartnerPartConfig();
const updateConfig = useUpdateAdminPartnerPartConfig();

// 낡음 기준일 — 삭제 기준이 아니라 표시 기준이다(만료를 두지 않기로 했으므로).
// 협력사·품목군마다 재고표 갱신 주기가 달라 운영에서 맞춘다.
const staleEditing = ref(false);
const staleDraft = ref('');
function openStaleEdit(): void {
  staleDraft.value = String(staleAfterDays.value);
  staleEditing.value = true;
}
async function saveStale(): Promise<void> {
  const days = Number(staleDraft.value.trim());
  if (!Number.isInteger(days) || days < 1 || days > 3650) return;
  await updateConfig.mutateAsync({ staleAfterDays: days });
  staleEditing.value = false;
}

const selectedPartnerId = ref<number | null>(null);

const toggleAll = useToggleAdminPartnerParts();
const clearLedger = useClearAdminPartnerParts();
const proxyUpload = useAdminPartnerPartUpload();
const commitUpload = useAdminCommitPartnerPartUpload();
const updateRow = useUpdateAdminPartnerPart();

// 행 수정 — 협력사가 못 고치는 상황(포털 계정 없음·응답 없음)에서 관리자가 바로잡는다.
const editing = ref<PartnerPartRowType | null>(null);
// 방금 저장한 행을 잠깐 표시한다 — 정렬 키가 수정으로 안 바뀌니 행은 제자리에 있고,
// 그래서 "어디로 갔지"가 아니라 "이 줄이 반영됐다"만 보여 주면 된다.
const justSaved = ref<number | null>(null);
let savedTimer: ReturnType<typeof setTimeout> | null = null;
function markSaved(partId: number): void {
  justSaved.value = partId;
  if (savedTimer !== null) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    justSaved.value = null;
  }, 2500);
}
onBeforeUnmount(() => {
  if (savedTimer !== null) clearTimeout(savedTimer);
});

const saveEdit = async (partId: number, body: PartnerPartUpdateBodyType): Promise<void> => {
  await updateRow.mutateAsync({ partId, body });
};
const onSaved = (): void => {
  markSaved(editing.value?.partId ?? 0);
  editing.value = null;
};

const summaries = computed(() => summaryQuery.data.value?.data.items ?? []);
const staleAfterDays = computed(
  () => configQuery.data.value?.data.staleAfterDays ?? summaryQuery.data.value?.data.staleAfterDays ?? 90,
);
const totalActive = computed(() => summaryQuery.data.value?.data.totalActiveParts ?? 0);
const staleCount = computed(() => summaries.value.filter((s) => s.stale).length);
const selectedSummary = computed(() => summaries.value.find((s) => s.partnerId === selectedPartnerId.value) ?? null);

// 대행 업로드 대상 — 승인된 사람 협력사 전부(원장이 없는 곳도 골라야 하므로 별도 조회).
// 서버 상한(pageSize ≤ 100)에 맞춘다 — 옛 화면의 200 은 400 으로 거절돼 목록이 늘 비었다(2026-10-06 실측).
const partnerFilters = ref({ page: 1, pageSize: 100, tab: 'approved' as const, type: 'partner' as const, q: '' });
const partnerListQuery = useAdminPartnerList(partnerFilters);
const partnerOptions = computed(() =>
  (partnerListQuery.data.value?.data.items ?? []).filter((p) => p.capabilities.includes('part_sale')),
);

const error = ref<string | null>(null);
const uploadTargetId = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const asMessage = (caught: unknown, fallback: string): string =>
  caught instanceof ApiRequestError ? (caught.payload?.message ?? fallback) : fallback;

const runToggleAll = async (partnerId: number, isActive: boolean): Promise<void> => {
  const ok = await confirmDialog({
    title: isActive ? '이 협력사 부품을 다시 켤까요?' : '이 협력사 부품을 끌까요?',
    message: isActive
      ? '고객 BOM 분석에서 다시 후보로 뜹니다.'
      : '목록은 남지만 고객 BOM 분석에서 후보로 뜨지 않습니다. 언제든 다시 켤 수 있습니다.',
    confirmLabel: isActive ? '켜기' : '끄기',
  });
  if (!ok) return;
  await toggleAll.mutateAsync({ partnerId, isActive });
};

const runClear = async (partnerId: number, name: string): Promise<void> => {
  const ok = await confirmDialog({
    title: `${name} 의 보유 부품을 모두 지울까요?`,
    message: '되돌릴 수 없습니다. 협력사가 다시 올려야 복구됩니다.',
    confirmLabel: '모두 삭제',
    tone: 'danger',
  });
  if (!ok) return;
  await clearLedger.mutateAsync(partnerId);
};

const pickProxyFile = (partnerId: number): void => {
  error.value = null;
  uploadTargetId.value = partnerId;
  fileInput.value?.click();
};

const onProxyFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const partnerId = uploadTargetId.value;
  if (file === undefined || partnerId === null) return;
  try {
    const created = await proxyUpload.mutateAsync({ partnerId, file });
    const stats = created.data.upload.stats;
    const ok = await confirmDialog({
      title: '읽은 내용을 반영할까요?',
      message: `${file.name} — ${String(stats?.rowCount ?? 0)}행 (고유 품번 ${String(stats?.distinctMpnCount ?? 0)}). 전체 교체로 반영합니다.`,
      confirmLabel: '반영',
    });
    if (!ok) return;
    await commitUpload.mutateAsync({ uploadId: created.data.upload.uploadId, mode: 'replace' });
  } catch (caught) {
    error.value = asMessage(caught, '대행 업로드에 실패했습니다.');
  }
};

const onUploadTarget = (event: Event): void => {
  uploadTargetId.value = Number((event.target as HTMLSelectElement).value) || null;
};
const togglePartner = (partnerId: number): void => {
  selectedPartnerId.value = selectedPartnerId.value === partnerId ? null : partnerId;
};

const fmtQty = (value: number | null): string => (value === null ? '—' : value.toLocaleString('ko-KR'));
const fmtDate = (iso: string | null): string => (iso === null ? '—' : new Date(iso).toLocaleDateString('ko-KR'));
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageHeader
      title="협력사 보유 부품"
      description="협력사가 올린 재고 목록입니다. 만료를 두지 않으므로 낡은 목록은 여기서 끄거나 비웁니다."
    >
      <template #actions>
        <Panel class="min-w-28">
          <p class="text-muted-foreground text-xs">등록 부품</p>
          <p class="text-lg font-semibold tabular-nums">{{ fmtQty(totalActive) }}</p>
        </Panel>
        <Panel :tone="staleCount > 0 ? 'warning' : 'default'" class="min-w-28">
          <div class="flex items-center gap-1 text-xs" :class="staleCount > 0 ? '' : 'text-muted-foreground'">
            <template v-if="staleEditing">
              <Input
                v-model="staleDraft"
                type="text"
                inputmode="numeric"
                class="h-6 w-14 text-right tabular-nums"
                aria-label="낡음 기준일"
                @keyup.enter="void saveStale()"
              />
              일 경과
              <Button variant="link" size="xs" @click="void saveStale()">저장</Button>
              <Button variant="link" size="xs" @click="staleEditing = false">취소</Button>
            </template>
            <template v-else>
              {{ staleAfterDays }}일 경과
              <Button
                variant="link"
                size="xs"
                title="낡음으로 볼 기준일을 바꿉니다 — 표시 기준일 뿐 원장을 지우지 않습니다"
                @click="openStaleEdit"
              >
                기준 변경
              </Button>
            </template>
          </div>
          <p class="text-lg font-semibold tabular-nums">{{ staleCount }}곳</p>
        </Panel>
      </template>
    </PageHeader>

    <Alert v-if="error !== null" variant="destructive" size="sm" role="alert">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- 협력사별 요약 — 낡은 것이 위로. 행을 누르면 아래 부품 행·업로드 이력을 그 협력사로 좁힌다. -->
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>협력사</TableHead>
            <TableHead class="text-right">사용 중</TableHead>
            <TableHead class="text-right">꺼짐</TableHead>
            <TableHead>마지막 업로드</TableHead>
            <TableHead>파일</TableHead>
            <TableHead class="text-right">뒤처리</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="row in summaries"
            :key="row.partnerId"
            class="cursor-pointer"
            :data-state="selectedPartnerId === row.partnerId ? 'selected' : undefined"
            @click="togglePartner(row.partnerId)"
          >
            <TableCell class="font-medium">{{ row.partnerName }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ fmtQty(row.activeCount) }}</TableCell>
            <TableCell class="text-muted-foreground text-right tabular-nums">
              {{ row.inactiveCount === 0 ? '—' : fmtQty(row.inactiveCount) }}
            </TableCell>
            <TableCell :class="row.stale ? 'text-warning font-semibold' : 'text-muted-foreground'">
              {{ fmtDate(row.lastUploadedAt) }}
              <template v-if="row.ageDays !== null">· {{ row.ageDays }}일 전</template>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">
              <span class="block max-w-56 truncate" :title="row.lastUploadFileName ?? undefined">{{ row.lastUploadFileName ?? '—' }}</span>
            </TableCell>
            <TableCell class="text-right" @click.stop>
              <div class="inline-flex gap-1">
                <Button v-if="row.activeCount > 0" variant="outline" size="xs" @click="void runToggleAll(row.partnerId, false)">
                  <PowerOffIcon />
                  끄기
                </Button>
                <Button v-if="row.inactiveCount > 0" variant="outline" size="xs" @click="void runToggleAll(row.partnerId, true)">
                  <PowerIcon />
                  켜기
                </Button>
                <Button variant="outline" size="xs" @click="pickProxyFile(row.partnerId)">
                  <UploadIcon />
                  대행 업로드
                </Button>
                <Button variant="outline" size="xs" @click="void runClear(row.partnerId, row.partnerName)">
                  <EraserIcon class="text-destructive" />
                  <span class="text-destructive">비우기</span>
                </Button>
              </div>
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="summaries.length === 0"
            :colspan="6"
            text="아직 올라온 협력사 부품이 없습니다."
            :loading="summaryQuery.isLoading.value"
          />
        </TableBody>
      </Table>
    </TableCard>

    <!-- 대행 업로드 진입(원장이 아직 없는 협력사) -->
    <Panel class="flex flex-wrap items-center gap-2">
      <p class="text-sm font-semibold">대행 업로드</p>
      <p class="text-muted-foreground text-xs">포털 계정이 없는 협력사를 대신해 올립니다.</p>
      <div class="ml-auto flex items-center gap-2">
        <NativeSelect
          :model-value="uploadTargetId === null ? '' : String(uploadTargetId)"
          class="w-56"
          aria-label="대행 업로드할 협력사"
          @change="onUploadTarget"
        >
          <NativeSelectOption value="">협력사 선택…</NativeSelectOption>
          <NativeSelectOption v-for="p in partnerOptions" :key="p.partnerId" :value="String(p.partnerId)">
            {{ p.name }}
          </NativeSelectOption>
        </NativeSelect>
        <Button :disabled="uploadTargetId === null || proxyUpload.isPending.value" @click="fileInput?.click()">
          <UploadIcon />
          {{ proxyUpload.isPending.value ? '분석 중…' : '파일 선택' }}
        </Button>
      </div>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".xlsx,.xlsm,.xls,.csv,.tsv,.bom"
        @change="void onProxyFile($event)"
      >
    </Panel>

    <PartnerPartRowsSection
      :partner-id="selectedPartnerId"
      :partner-name="selectedSummary?.partnerName ?? null"
      :just-saved="justSaved"
      @clear-partner="selectedPartnerId = null"
      @edit="(part: PartnerPartRowType) => (editing = part)"
    />

    <PartnerPartUploadHistory :partner-id="selectedPartnerId" />

    <PartnerPartEditDialog
      :part="editing"
      :save="saveEdit"
      :busy="updateRow.isPending.value"
      @close="editing = null"
      @saved="onSaved"
    />
  </div>
</template>
