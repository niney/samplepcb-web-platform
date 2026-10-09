<script setup lang="ts">
import { computed, ref } from 'vue';
import { CheckIcon, CopyIcon, LinkIcon, PencilLineIcon, ScaleIcon, SendIcon } from '@lucide/vue';
import {
  ADMIN_BOM_LIVE_SUPPLIERS,
  type AdminBomLiveSupplierType,
  type AdminBomRfqViewType,
  type BomQuoteItemType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { smartbomFmtDate } from '@/admin/smartbom';
import { childReplyCountText, isForeignCurrency, partnerAmountText } from '@/admin/bom-partner-money';
import { partnerPortalActAsUrl } from '@/admin/useAdminPartners';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Item } from '@/next/components/ui/item';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import SelectedProcurementDialog from './SelectedProcurementDialog.vue';
import { bomRfqStatusBadge, procurementKindBadge, type ProcurementProviderKind } from './smartbom-badges';

// Case 상세의 협력사 RFQ 현황 패널 — 옛 components/admin/smartbom/BomRfqPanel.vue 의 짝(같은 props·emits).
// 발송·회신 현황 + 대리 입력 진입 + 선정 공급처 요약. 공급사 시세는 여기 없다(후보/구매 조건 원장 파생 —
// 부품행의 선정 구매 조건이 그 자리, D6).

const props = defineProps<{
  rfqs: AdminBomRfqViewType[];
  scopeItems: BomQuoteItemType[];
  supplierComparisonTargetCount: number;
  loading: boolean;
  canSend: boolean; // reviewing 에서만 발송·선정 가능
  busy?: boolean;
  actionNotice?: string;
  actionError?: string;
}>();
const emit = defineEmits<{
  send: [];
  reply: [rfq: AdminBomRfqViewType];
  compare: [];
  reissueLink: [rfq: AdminBomRfqViewType]; // 매직링크 재발급(§6.9 — 구 토큰 즉시 무효)
}>();

// 매직링크 [복사](§6.9) — 메일 유실·전화 안내 시 수동 전달용. URL 은 현재 origin 기준.
const copiedRfqId = ref<number | null>(null);
async function copyMagicLink(rfq: AdminBomRfqViewType): Promise<void> {
  if (rfq.magicToken === null) return;
  const url = `${window.location.origin}/app/rfq-reply/${rfq.magicToken}`;
  try {
    await navigator.clipboard.writeText(url);
    copiedRfqId.value = rfq.rfqId;
    window.setTimeout(() => {
      if (copiedRfqId.value === rfq.rfqId) copiedRfqId.value = null;
    }, 1500);
  } catch {
    // 클립보드가 막힌 환경 — 링크를 입력칸에 담아 직접 복사하게 한다(옛 window.prompt 자리).
    await promptDialog({
      title: '링크 복사에 실패했습니다',
      description: '아래 링크를 직접 복사하세요.',
      fields: [{ name: 'url', label: `${rfq.partnerName} 회신 링크`, value: url }],
      confirmLabel: '닫기',
    });
  }
}

async function reissue(rfq: AdminBomRfqViewType): Promise<void> {
  if (
    !(await confirmDialog({
      message: `${rfq.partnerName}의 회신 링크를 재발급할까요?\n기존에 보낸 링크는 즉시 무효가 됩니다.`,
      confirmLabel: '재발급',
      tone: 'danger',
    }))
  ) {
    return;
  }
  emit('reissueLink', rfq);
}

const activeQuotedCount = computed(() => props.rfqs.filter((r) => r.status === 'quoted').length);
const comparisonAvailable = computed(() => activeQuotedCount.value > 0 || props.supplierComparisonTargetCount > 0);
const repliedCount = computed(() => props.rfqs.filter((r) => r.respondedAt !== null).length);
const pendingCount = computed(() => props.rfqs.filter((r) => r.status === 'requested').length);

interface SelectedProcurementProvider {
  key: string;
  name: string;
  kind: ProcurementProviderKind;
  items: BomQuoteItemType[];
}

const LIVE_SUPPLIER_NAMES: Record<AdminBomLiveSupplierType, string> = {
  digikey: 'DigiKey',
  mouser: 'Mouser',
  unikeyic: 'UniKeyIC',
};

// 선정 공급처 묶음 — API 3사는 늘 칸을 두고(0건이면 '미선정'), 협력사 회신·기타 구매처는 선정 품목이 있을 때만.
const selectedProcurementProviders = computed<SelectedProcurementProvider[]>(() => {
  const groups = new Map<string, SelectedProcurementProvider>();
  for (const supplier of ADMIN_BOM_LIVE_SUPPLIERS) {
    groups.set(`supplier:${supplier}`, {
      key: `supplier:${supplier}`,
      name: LIVE_SUPPLIER_NAMES[supplier],
      kind: 'supplier',
      items: [],
    });
  }
  const rfqProviderByOfferKey = new Map<string, SelectedProcurementProvider>();
  for (const rfq of props.rfqs) {
    const key = `partner:${String(rfq.rfqId)}`;
    const provider = groups.get(key) ?? { key, name: rfq.partnerName, kind: 'partner' as const, items: [] };
    groups.set(key, provider);
    for (const reply of rfq.items) {
      rfqProviderByOfferKey.set(`rfq:${String(reply.rfqItemId)}`, provider);
    }
  }
  for (const item of props.scopeItems) {
    const offer = item.selectedOffer;
    if (offer === null) continue;
    const offerKey = offer.offerKey;
    let provider = offerKey === null ? undefined : rfqProviderByOfferKey.get(offerKey);
    if (provider === undefined && offerKey?.startsWith('rfq:') === true) {
      const key = `partner:unresolved:${offer.supplier.toLocaleLowerCase()}`;
      provider = groups.get(key) ?? { key, name: offer.supplier, kind: 'partner', items: [] };
      groups.set(key, provider);
    }
    if (provider === undefined) {
      const supplier = ADMIN_BOM_LIVE_SUPPLIERS.find((code) => code === offer.supplier.toLocaleLowerCase());
      if (supplier !== undefined) provider = groups.get(`supplier:${supplier}`);
    }
    if (provider === undefined) {
      const key = `other:${offer.supplier.toLocaleLowerCase()}`;
      provider = groups.get(key) ?? { key, name: offer.supplier, kind: 'other', items: [] };
      groups.set(key, provider);
    }
    provider.items.push(item);
  }
  const suppliers = ADMIN_BOM_LIVE_SUPPLIERS.flatMap((supplier) => {
    const provider = groups.get(`supplier:${supplier}`);
    return provider === undefined ? [] : [provider];
  });
  const others = [...groups.values()]
    .filter((provider) => provider.kind !== 'supplier' && provider.items.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'));
  return [...suppliers, ...others];
});

const selectedProcurementItemCount = computed(() => props.scopeItems.filter((item) => item.selectedOffer !== null).length);
const selectedProcurementTotal = computed(() =>
  props.scopeItems.reduce((sum, item) => sum + (item.selectedOffer === null ? 0 : (item.lineTotalKrw ?? 0)), 0),
);
const selectedProviderKey = ref<string | null>(null);
const selectedProvider = computed(
  () => selectedProcurementProviders.value.find((provider) => provider.key === selectedProviderKey.value) ?? null,
);

const providerTotal = (provider: SelectedProcurementProvider): number =>
  provider.items.reduce((sum, item) => sum + (item.lineTotalKrw ?? 0), 0);

function openSelectedProvider(provider: SelectedProcurementProvider): void {
  if (provider.items.length === 0) return;
  selectedProviderKey.value = provider.key;
}

const fmtWon = (v: number | null): string => (v === null ? '—' : `${Math.round(v).toLocaleString('ko-KR')}원`);
const replyActionLabel = (rfq: AdminBomRfqViewType): string =>
  rfq.status === 'closed' ? '회신 보기' : rfq.status === 'quoted' ? '회신 보기·수정' : '대리 입력';
</script>

<template>
  <SectionCard title="협력사 견적요청 (RFQ)" flush>
    <template v-if="props.rfqs.length > 0" #meta>
      협력사 <b class="text-foreground">{{ props.rfqs.length }}</b> · 회신 <b class="text-success">{{ repliedCount }}</b> ·
      회신 대기 <b class="text-info">{{ pendingCount }}</b>
    </template>
    <template #actions>
      <Button
        v-if="comparisonAvailable"
        variant="outline"
        size="sm"
        :disabled="!props.canSend"
        :title="props.canSend ? '' : '검토 중 상태에서만 선정을 변경할 수 있습니다'"
        @click="emit('compare')"
      >
        <ScaleIcon />
        공급사 비교·선정
      </Button>
      <Button
        size="sm"
        :disabled="!props.canSend"
        :title="props.canSend ? '' : '검토 중 상태에서만 발송할 수 있습니다'"
        @click="emit('send')"
      >
        <SendIcon />
        협력사 견적요청 보내기
      </Button>
    </template>
    <template #notice>
      <NoticeBand v-if="props.actionNotice !== undefined && props.actionNotice !== ''" role="status" tone="success" class="font-medium">
        {{ props.actionNotice }}
      </NoticeBand>
      <NoticeBand v-else-if="props.actionError !== undefined && props.actionError !== ''" role="alert" tone="destructive" class="font-medium">
        {{ props.actionError }}
      </NoticeBand>
    </template>

    <!-- 선정 공급사 — 공급처마다 선정 품목 수·합계, 누르면 품목 목록 -->
    <section class="bg-muted border-b px-4 py-3">
      <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span class="font-semibold">선정 공급사</span>
        <span class="text-muted-foreground text-xs">
          선정 <b class="text-primary">{{ selectedProcurementItemCount }}개</b> · 합계
          <b class="text-foreground tabular-nums">{{ fmtWon(selectedProcurementTotal) }}</b>
        </span>
        <span class="text-muted-foreground text-xs">공급사를 누르면 선정 품목을 확인할 수 있습니다.</span>
      </p>
      <div class="mt-2 flex gap-2 overflow-x-auto pb-1">
        <!-- 옛 화면 밀도의 작은 타일 두 줄: [종류] 이름 (선정 수) / 품목 보기 · 합계. 미선정은 흐리게·눌리지 않게. -->
        <Item
          v-for="provider in selectedProcurementProviders"
          :key="provider.key"
          as="button"
          type="button"
          :variant="provider.kind === 'supplier' ? 'outline-success' : provider.kind === 'partner' ? 'outline-info' : 'outline'"
          size="xs"
          class="min-w-40 shrink-0"
          :disabled="provider.items.length === 0"
          @click="openSelectedProvider(provider)"
        >
          <span class="flex w-full min-w-0 flex-col gap-1">
            <span class="flex items-center gap-2">
              <Badge :variant="procurementKindBadge(provider.kind).variant">{{ procurementKindBadge(provider.kind).short }}</Badge>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ provider.name }}</span>
              <Badge :variant="provider.items.length > 0 ? 'default' : 'secondary'" class="tabular-nums">
                {{ provider.items.length }}
              </Badge>
            </span>
            <span class="flex items-center justify-between gap-2 text-xs">
              <span class="text-muted-foreground">{{ provider.items.length > 0 ? '품목 보기' : '미선정' }}</span>
              <b class="tabular-nums">{{ fmtWon(providerTotal(provider)) }}</b>
            </span>
          </span>
        </Item>
      </div>
    </section>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>협력사</TableHead>
          <TableHead>상태</TableHead>
          <TableHead class="text-right">회신 행</TableHead>
          <TableHead class="text-right">회신 합계</TableHead>
          <TableHead>납기</TableHead>
          <TableHead>회신 메모</TableHead>
          <TableHead>요청/회신일</TableHead>
          <TableHead class="text-right">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <template v-for="rfq in props.rfqs" :key="rfq.rfqId">
          <TableRow>
            <TableCell class="font-medium">{{ rfq.partnerName }}</TableCell>
            <TableCell>
              <Badge :variant="bomRfqStatusBadge(rfq.status).variant">{{ bomRfqStatusBadge(rfq.status).label }}</Badge>
            </TableCell>
            <TableCell class="text-right tabular-nums">
              <span class="inline-flex items-center justify-end gap-1">
                {{ rfq.repliedItemCount }}<template v-if="rfq.requestedItemIds !== null">/{{ rfq.requestedItemIds.length }}</template>
                <!-- 부분 행 선택(§6.13) — 전체가 아닌 요청은 배지로 구분 -->
                <Badge v-if="rfq.requestedItemIds !== null" variant="outline" title="일부 부품행만 요청했습니다">부분</Badge>
              </span>
            </TableCell>
            <TableCell class="text-right tabular-nums">
              {{ partnerAmountText(rfq.totalAmount, rfq.currency) }}
              <span
                v-if="isForeignCurrency(rfq.currency) && rfq.totalAmountKrw !== null"
                class="text-muted-foreground block text-xs"
              >
                ≈ {{ fmtWon(rfq.totalAmountKrw) }}
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ fmtKstDate(rfq.deliveryDate) }}</TableCell>
            <TableCell class="text-muted-foreground max-w-48 truncate" :title="rfq.memo ?? ''">{{ rfq.memo ?? '—' }}</TableCell>
            <TableCell class="text-muted-foreground text-xs">
              {{ smartbomFmtDate(rfq.requestedAt) }}
              <template v-if="rfq.respondedAt !== null"> → {{ smartbomFmtDate(rfq.respondedAt) }}</template>
            </TableCell>
            <TableCell class="text-right">
              <span class="inline-flex flex-wrap justify-end gap-1">
                <!-- 매직링크(§6.9) — 무로그인 회신 URL 수동 전달·회수 -->
                <Button
                  v-if="rfq.magicToken !== null"
                  variant="ghost"
                  size="sm"
                  title="가입 없이 회신할 수 있는 전용 링크를 복사합니다"
                  @click="void copyMagicLink(rfq)"
                >
                  <CheckIcon v-if="copiedRfqId === rfq.rfqId" />
                  <CopyIcon v-else />
                  {{ copiedRfqId === rfq.rfqId ? '복사됨' : '링크 복사' }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  :disabled="props.busy === true"
                  :title="rfq.magicToken === null ? '이 RFQ 는 링크 발급 전입니다 — 재발급으로 만들 수 있습니다' : '기존 링크를 무효화하고 새 링크를 만듭니다'"
                  @click="void reissue(rfq)"
                >
                  <LinkIcon />
                  재발급
                </Button>
                <Button variant="outline" size="sm" @click="emit('reply', rfq)">
                  <PencilLineIcon v-if="rfq.status === 'requested'" />
                  {{ replyActionLabel(rfq) }}
                </Button>
              </span>
            </TableCell>
          </TableRow>
          <!-- 마스터딜러의 하위 재요청 — 관리자는 전부 본다. 대신 처리하려면 그 조직으로 대리 접속한다 -->
          <TableRow v-if="rfq.children.length > 0" data-testid="bom-rfq-children">
            <TableCell :colspan="8">
              <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <b class="text-foreground">└ 마스터딜러 하위 재요청 {{ childReplyCountText(rfq.children) }}</b>
                <span v-for="child in rfq.children" :key="child.rfqId" class="inline-flex items-center gap-1 whitespace-nowrap">
                  {{ child.partnerName }}
                  <Badge :variant="bomRfqStatusBadge(child.status).variant">{{ bomRfqStatusBadge(child.status).label }}</Badge>
                  <template v-if="child.totalAmount !== null">
                    {{ partnerAmountText(child.totalAmount, child.currency) }} · {{ child.repliedItemCount }}행
                  </template>
                </span>
                <a
                  :href="partnerPortalActAsUrl(rfq.partnerId)"
                  target="_blank"
                  rel="noopener"
                  class="text-primary ml-auto font-semibold underline"
                  title="이 마스터딜러의 포털을 새 탭으로 엽니다 — 하위 재요청·선정·마진을 대신 처리할 수 있습니다"
                >
                  마스터딜러 포털로 대리 접속
                </a>
              </div>
            </TableCell>
          </TableRow>
        </template>
        <TableEmptyRow
          v-if="props.rfqs.length === 0"
          :colspan="8"
          :loading="props.loading"
          text="아직 발송한 견적요청이 없습니다."
        />
      </TableBody>
    </Table>

    <SelectedProcurementDialog
      v-if="selectedProvider !== null"
      :open="selectedProvider !== null"
      :provider-name="selectedProvider.name"
      :provider-kind="selectedProvider.kind"
      :items="selectedProvider.items"
      @close="selectedProviderKey = null"
    />
  </SectionCard>
</template>
