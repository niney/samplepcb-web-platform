<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  PARTNER_CAPABILITIES,
  PARTNER_CAPABILITY_LABELS,
  PARTNER_STATUS_LABELS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  PCB_CURRENCIES,
  type AdminPartnerCreateBodyType,
  type PartnerStatusType,
  type PartnerCapabilityType,
  type PartnerTypeType,
  type PcbCurrencyType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  useAddPartnerMember,
  useAddPartnerRelation,
  useAdminPartnerDetail,
  useAdminPartnerList,
  useAdminPartnerRelations,
  useCreatePartner,
  useDeletePartner,
  usePartnerStatus,
  useRemovePartnerMember,
  useRemovePartnerRelation,
  useUpdatePartner,
  useUpdatePartnerRelationCurrency,
  type AdminPartnerFilters,
} from '../../admin/useAdminPartners';
import UiPagination from '../../components/ui/UiPagination.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 통합 관리의 공용 파트너(조직) 기준정보 — 목록(상태 탭×유형 필터, counts)·상세 드로어·
// 생성/수정·승인/정지·계정 연결. BOM·PCB·부품 판매 트랙이 같은 조직 원장을 사용한다.
// 도메인 라벨은 @sp/api-contract PARTNER_*_LABELS 정본을 그대로 쓴다.

const filters = ref<AdminPartnerFilters>({ page: 1, pageSize: 20, tab: 'all', type: 'all', q: '' });
const qInput = ref('');
const { data, isFetching } = useAdminPartnerList(filters);

const selectedId = ref<number | null>(null);
const detailQ = useAdminPartnerDetail(selectedId);
const detail = computed(() => detailQ.data.value?.data);

const TABS = ['all', 'pending', 'approved', 'suspended'] as const;
const tabLabel: Record<(typeof TABS)[number], string> = {
  all: '전체',
  pending: PARTNER_STATUS_LABELS.pending,
  approved: PARTNER_STATUS_LABELS.approved,
  suspended: PARTNER_STATUS_LABELS.suspended,
};
const TYPE_FILTERS = ['all', ...PARTNER_TYPES] as const;
const typeFilterLabel = (t: (typeof TYPE_FILTERS)[number]): string =>
  t === 'all' ? '전체 유형' : PARTNER_TYPE_LABELS[t];

const setTab = (tab: AdminPartnerFilters['tab']): void => {
  filters.value = { ...filters.value, tab, page: 1 };
};
const setType = (type: AdminPartnerFilters['type']): void => {
  filters.value = { ...filters.value, type, page: 1 };
};
const applySearch = (): void => {
  filters.value = { ...filters.value, q: qInput.value, page: 1 };
};

const statusBadge = (s: PartnerStatusType): string =>
  s === 'approved'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'pending'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-red-100 text-red-700';

// ── 생성 모달 ────────────────────────────────────────────────────────────────
const createOpen = ref(false);
const createError = ref('');
const emptyForm = (): {
  type: PartnerTypeType;
  name: string;
  supplierCode: string;
  country: string;
  defaultCurrency: string;
  capabilities: PartnerCapabilityType[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  businessNo: string;
  ownerName: string;
  businessZip: string;
  businessAddress: string;
  businessType: string;
  businessItem: string;
  fax: string;
  memo: string;
} => ({
  type: 'partner',
  name: '',
  supplierCode: '',
  country: '',
  defaultCurrency: 'KRW',
  capabilities: ['bom_rfq'],
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  businessNo: '',
  ownerName: '',
  businessZip: '',
  businessAddress: '',
  businessType: '',
  businessItem: '',
  fax: '',
  memo: '',
});
const createForm = ref(emptyForm());
const createMut = useCreatePartner();

const toNullable = (v: string): string | null => (v.trim() === '' ? null : v.trim());

async function submitCreate(): Promise<void> {
  createError.value = '';
  if (createForm.value.name.trim() === '') {
    createError.value = '이름(회사명)을 입력해 주세요.';
    return;
  }
  if (createForm.value.type === 'partner' && createForm.value.country.trim() === '') {
    createError.value = '승인 협력사는 국가(ISO 2)를 입력해 주세요.';
    return;
  }
  const body: AdminPartnerCreateBodyType = {
    type: createForm.value.type,
    name: createForm.value.name.trim(),
    supplierCode: toNullable(createForm.value.supplierCode),
    country: toNullable(createForm.value.country),
    defaultCurrency:
      createForm.value.defaultCurrency.trim() === ''
        ? 'KRW'
        : createForm.value.defaultCurrency.trim(),
    capabilities: createForm.value.capabilities,
    status: 'approved',
    contactName: toNullable(createForm.value.contactName),
    contactPhone: toNullable(createForm.value.contactPhone),
    contactEmail: toNullable(createForm.value.contactEmail),
    businessNo: toNullable(createForm.value.businessNo),
    ownerName: toNullable(createForm.value.ownerName),
    businessZip: toNullable(createForm.value.businessZip),
    businessAddress: toNullable(createForm.value.businessAddress),
    businessType: toNullable(createForm.value.businessType),
    businessItem: toNullable(createForm.value.businessItem),
    fax: toNullable(createForm.value.fax),
    memo: toNullable(createForm.value.memo),
  };
  try {
    const res = await createMut.mutateAsync(body);
    createOpen.value = false;
    createForm.value = emptyForm();
    selectedId.value = res.data.partnerId;
  } catch (e) {
    createError.value = e instanceof ApiRequestError ? e.message : '등록에 실패했습니다.';
  }
}

// ── 상세 드로어: 수정 폼 ─────────────────────────────────────────────────────
const editForm = ref(emptyForm());
const editError = ref('');
const updateMut = useUpdatePartner();

watch(detail, (d) => {
  if (d === undefined) return;
  editForm.value = {
    type: d.type,
    name: d.name,
    supplierCode: d.supplierCode ?? '',
    country: d.country ?? '',
    defaultCurrency: d.defaultCurrency,
    capabilities: [...d.capabilities],
    contactName: d.contactName ?? '',
    contactPhone: d.contactPhone ?? '',
    contactEmail: d.contactEmail ?? '',
    businessNo: d.businessNo ?? '',
    ownerName: d.ownerName ?? '',
    businessZip: d.businessZip ?? '',
    businessAddress: d.businessAddress ?? '',
    businessType: d.businessType ?? '',
    businessItem: d.businessItem ?? '',
    fax: d.fax ?? '',
    memo: d.memo ?? '',
  };
  editError.value = '';
  statusReason.value = '';
  memberMbId.value = '';
  memberError.value = '';
  relationError.value = '';
  relationChildId.value = null;
  relationCurrency.value = 'USD';
});

async function submitUpdate(): Promise<void> {
  if (selectedId.value === null) return;
  editError.value = '';
  if (
    detail.value?.status === 'approved' &&
    editForm.value.type === 'partner' &&
    editForm.value.country.trim() === ''
  ) {
    editError.value = '승인 협력사는 국가(ISO 2)를 입력해 주세요.';
    return;
  }
  try {
    await updateMut.mutateAsync({
      partnerId: selectedId.value,
      body: {
        type: editForm.value.type,
        name: editForm.value.name.trim(),
        supplierCode: toNullable(editForm.value.supplierCode),
        country: toNullable(editForm.value.country),
        defaultCurrency: editForm.value.defaultCurrency.trim(),
        capabilities: editForm.value.capabilities,
        contactName: toNullable(editForm.value.contactName),
        contactPhone: toNullable(editForm.value.contactPhone),
        contactEmail: toNullable(editForm.value.contactEmail),
        businessNo: toNullable(editForm.value.businessNo),
        ownerName: toNullable(editForm.value.ownerName),
        businessZip: toNullable(editForm.value.businessZip),
        businessAddress: toNullable(editForm.value.businessAddress),
        businessType: toNullable(editForm.value.businessType),
        businessItem: toNullable(editForm.value.businessItem),
        fax: toNullable(editForm.value.fax),
        memo: toNullable(editForm.value.memo),
      },
    });
  } catch (e) {
    editError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

// ── 상태 액션 ────────────────────────────────────────────────────────────────
const statusMut = usePartnerStatus();
const statusReason = ref('');
const statusError = ref('');

async function changeStatus(status: PartnerStatusType): Promise<void> {
  if (selectedId.value === null) return;
  statusError.value = '';
  if (status === 'suspended' && statusReason.value.trim() === '') {
    statusError.value = '정지 사유를 입력해 주세요.';
    return;
  }
  if (
    status === 'approved' &&
    detail.value?.type === 'partner' &&
    (detail.value.country ?? '').trim() === ''
  ) {
    statusError.value = '조직 정보에서 국가를 저장한 뒤 승인해 주세요.';
    return;
  }
  try {
    await statusMut.mutateAsync({
      partnerId: selectedId.value,
      body: {
        status,
        ...(status === 'suspended' ? { reason: statusReason.value.trim() } : {}),
      },
    });
    statusReason.value = '';
  } catch (e) {
    statusError.value = e instanceof ApiRequestError ? e.message : '처리에 실패했습니다.';
  }
}

// ── 계정 연결 ────────────────────────────────────────────────────────────────
const memberMbId = ref('');
const memberError = ref('');
const addMemberMut = useAddPartnerMember();
const removeMemberMut = useRemovePartnerMember();

async function addMember(): Promise<void> {
  if (selectedId.value === null) return;
  memberError.value = '';
  const mbId = memberMbId.value.trim();
  if (mbId === '') {
    memberError.value = '연결할 회원 ID(mb_id)를 입력해 주세요.';
    return;
  }
  try {
    await addMemberMut.mutateAsync({ partnerId: selectedId.value, body: { mbId, role: 'owner' } });
    memberMbId.value = '';
  } catch (e) {
    memberError.value = e instanceof ApiRequestError ? e.message : '연결에 실패했습니다.';
  }
}

async function removeMember(mbId: string): Promise<void> {
  if (selectedId.value === null) return;
  memberError.value = '';
  try {
    await removeMemberMut.mutateAsync({ partnerId: selectedId.value, mbId });
  } catch (e) {
    memberError.value = e instanceof ApiRequestError ? e.message : '해제에 실패했습니다.';
  }
}

// ── 마스터딜러(MD) 소속 — sp_partner_relation ───────────────────────────────
// 사람 협력사(type partner)에서만 조회·노출. 링크 통화는 배정 시점에 견적행으로
// 박제되므로 변경은 이후 배정부터 적용된다. 해제는 진행 중 문서 0건일 때만(서버 가드).
const relationPartnerId = computed(() =>
  detail.value?.type === 'partner' ? selectedId.value : null,
);
const relationsQ = useAdminPartnerRelations(relationPartnerId);
const relations = computed(() => relationsQ.data.value?.data);
const relationError = ref('');
const relationChildId = ref<number | null>(null);
const relationCurrency = ref<PcbCurrencyType>('USD');
const addRelationMut = useAddPartnerRelation();
const relationCurrencyMut = useUpdatePartnerRelationCurrency();
const removeRelationMut = useRemovePartnerRelation();

async function addRelation(): Promise<void> {
  if (selectedId.value === null) return;
  relationError.value = '';
  if (relationChildId.value === null) {
    relationError.value = '연결할 하위 협력사를 선택해 주세요.';
    return;
  }
  try {
    await addRelationMut.mutateAsync({
      partnerId: selectedId.value,
      body: {
        childPartnerId: relationChildId.value,
        settlementCurrency: relationCurrency.value,
      },
    });
    relationChildId.value = null;
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '연결에 실패했습니다.';
  }
}

async function changeLinkCurrency(parentId: number, childId: number, ev: Event): Promise<void> {
  relationError.value = '';
  const value = (ev.target as HTMLSelectElement).value as PcbCurrencyType;
  try {
    await relationCurrencyMut.mutateAsync({
      partnerId: parentId,
      childId,
      body: { settlementCurrency: value },
    });
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '통화 변경에 실패했습니다.';
  }
}

async function removeLink(parentId: number, childId: number): Promise<void> {
  relationError.value = '';
  try {
    await removeRelationMut.mutateAsync({ partnerId: parentId, childId });
  } catch (e) {
    relationError.value = e instanceof ApiRequestError ? e.message : '해제에 실패했습니다.';
  }
}

// ── 삭제(오기 정리) ──────────────────────────────────────────────────────────
const deleteMut = useDeletePartner();

async function removePartner(): Promise<void> {
  if (selectedId.value === null) return;
  if (
    !(await confirmDialog({
      message: `${detail.value?.name ?? '이 조직'}을(를) 삭제할까요?\n오기 정리용입니다 — 되돌릴 수 없습니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  ) {
    return;
  }
  statusError.value = '';
  try {
    await deleteMut.mutateAsync(selectedId.value);
    selectedId.value = null;
  } catch (e) {
    // 서버 안내문(payload.message)만 보여준다 — Prisma 원문 등 내부 오류 문자열을 그대로
    // 렌더하지 않는다(가드 밖 실패는 일반 문구).
    statusError.value =
      e instanceof ApiRequestError
        ? (e.payload?.message ?? '삭제에 실패했습니다.')
        : '삭제에 실패했습니다.';
  }
}

const showsSupplierCode = computed(() => editForm.value.type !== 'partner');
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-bold">파트너 관리</h1>
      <button
        type="button"
        class="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700"
        @click="
          createOpen = true;
          createError = '';
        "
      >
        파트너 등록
      </button>
    </div>

    <!-- 탭 + 유형 필터 + 검색 -->
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex rounded-lg border border-gray-200 bg-surface p-1 text-xs font-semibold">
        <button
          v-for="t in TABS"
          :key="t"
          type="button"
          class="rounded-md px-3 py-1.5"
          :class="filters.tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setTab(t)"
        >
          {{ tabLabel[t] }}
          <span v-if="data !== undefined" class="ml-1 text-[11px] opacity-70">
            {{ data.data.counts[t] }}
          </span>
        </button>
      </div>
      <div class="flex rounded-lg border border-gray-200 bg-surface p-1 text-xs font-semibold">
        <button
          v-for="t in TYPE_FILTERS"
          :key="t"
          type="button"
          class="rounded-md px-2.5 py-1.5"
          :class="filters.type === t ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'"
          @click="setType(t)"
        >
          {{ typeFilterLabel(t) }}
        </button>
      </div>
      <div class="ml-auto flex items-center gap-1.5">
        <input
          v-model="qInput"
          type="search"
          placeholder="이름·코드·이메일·회원ID 검색"
          class="h-9 w-56 rounded-lg border border-gray-200 bg-surface px-3 text-xs"
          @keyup.enter="applySearch"
        >
        <button
          type="button"
          class="h-9 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white"
          @click="applySearch"
        >
          검색
        </button>
      </div>
    </div>

    <!-- 목록 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-gray-200 text-xs text-gray-500">
          <tr>
            <th class="px-4 py-3">이름</th>
            <th class="px-4 py-3">유형</th>
            <th class="px-4 py-3">코드</th>
            <th class="px-4 py-3">통화</th>
            <th class="px-4 py-3">참여 트랙</th>
            <th class="px-4 py-3">계정</th>
            <th class="px-4 py-3">상태</th>
            <th class="px-4 py-3">등록일</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in data?.data.items ?? []"
            :key="p.partnerId"
            class="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
            @click="selectedId = p.partnerId"
          >
            <td class="px-4 py-3 font-semibold text-gray-900">{{ p.name }}</td>
            <td class="px-4 py-3 text-xs">{{ PARTNER_TYPE_LABELS[p.type] }}</td>
            <td class="px-4 py-3 font-mono text-xs text-gray-500">{{ p.supplierCode ?? '—' }}</td>
            <td class="px-4 py-3 text-xs">{{ p.defaultCurrency }}</td>
            <td class="px-4 py-3">
              <span
                v-for="c in p.capabilities"
                :key="c"
                class="mr-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700"
              >
                {{ PARTNER_CAPABILITY_LABELS[c] }}
              </span>
              <span v-if="p.capabilities.length === 0" class="text-xs text-gray-400">—</span>
            </td>
            <td class="px-4 py-3 text-xs" :class="p.memberCount === 0 ? 'text-gray-400' : ''">
              {{ p.memberCount }}
            </td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                :class="statusBadge(p.status)"
              >
                {{ PARTNER_STATUS_LABELS[p.status] }}
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500">{{ p.createdAt.slice(0, 10) }}</td>
          </tr>
          <tr v-if="(data?.data.items ?? []).length === 0">
            <td colspan="8" class="px-4 py-10 text-center text-xs text-gray-400">
              {{ isFetching ? '불러오는 중…' : '대상이 없습니다.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data !== undefined" class="flex items-center justify-between">
      <p class="text-sm text-gray-500">총 {{ data.data.total }}곳</p>
      <UiPagination
        :page="filters.page"
        :page-size="filters.pageSize"
        :total="data.data.total"
        @update:page="(p) => (filters = { ...filters, page: p })"
      />
    </div>

    <!-- 상세 드로어 -->
    <div
      v-if="selectedId !== null"
      class="fixed inset-0 z-40 flex justify-end bg-black/30"
      @click.self="selectedId = null"
    >
      <div class="h-full w-full max-w-lg overflow-y-auto bg-surface p-6 shadow-2xl">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">파트너 상세</h2>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-700"
            @click="selectedId = null"
          >
            ✕
          </button>
        </div>

        <div v-if="detail === undefined" class="py-10 text-center text-sm text-gray-400">
          불러오는 중…
        </div>
        <template v-else>
          <div class="mt-4 flex items-center gap-2">
            <span class="text-base font-bold text-gray-900">{{ detail.name }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[11px] font-bold"
              :class="statusBadge(detail.status)"
            >
              {{ PARTNER_STATUS_LABELS[detail.status] }}
            </span>
            <span class="text-xs text-gray-500">{{ PARTNER_TYPE_LABELS[detail.type] }}</span>
          </div>
          <p v-if="detail.statusReason !== null" class="mt-1 text-xs text-red-600">
            사유: {{ detail.statusReason }}
          </p>

          <!-- 조직 정보 수정 -->
          <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
            <label class="text-gray-500">유형
              <select
                v-model="editForm.type"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
                <option v-for="t in PARTNER_TYPES" :key="t" :value="t">
                  {{ PARTNER_TYPE_LABELS[t] }}
                </option>
              </select>
            </label>
            <label class="text-gray-500">이름(회사명)
              <input
                v-model="editForm.name"
                type="text"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label v-if="showsSupplierCode" class="text-gray-500">supplierCode
              <input
                v-model="editForm.supplierCode"
                type="text"
                placeholder="digikey"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 font-mono"
              >
            </label>
            <label class="text-gray-500">국가(ISO 2){{ editForm.type === 'partner' ? ' *' : '' }}
              <input
                v-model="editForm.country"
                type="text"
                placeholder="KR"
                maxlength="2"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 uppercase"
              >
            </label>
            <label class="text-gray-500">기본 통화
              <input
                v-model="editForm.defaultCurrency"
                type="text"
                maxlength="3"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 uppercase"
              >
            </label>
            <label class="text-gray-500">담당자
              <input
                v-model="editForm.contactName"
                type="text"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">전화
              <input
                v-model="editForm.contactPhone"
                type="text"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">이메일(RFQ 알림 수신)
              <input
                v-model="editForm.contactEmail"
                type="email"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <p class="col-span-2 mt-2 border-t border-gray-100 pt-3 font-bold text-gray-700">
              거래 문서 사업자정보
            </p>
            <p class="col-span-2 -mt-1 text-[11px] text-amber-700">
              견적서는 PO 발행 시점의 정보로 고정됩니다. 발주 전에 확인해 주세요.
            </p>
            <label class="text-gray-500">사업자등록번호
              <input
                v-model="editForm.businessNo"
                type="text"
                maxlength="30"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">대표자명
              <input
                v-model="editForm.ownerName"
                type="text"
                maxlength="100"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">우편번호
              <input
                v-model="editForm.businessZip"
                type="text"
                maxlength="10"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">팩스번호
              <input
                v-model="editForm.fax"
                type="text"
                maxlength="50"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="col-span-2 text-gray-500">사업장주소
              <input
                v-model="editForm.businessAddress"
                type="text"
                maxlength="500"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">업태
              <input
                v-model="editForm.businessType"
                type="text"
                maxlength="100"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
            <label class="text-gray-500">종목
              <input
                v-model="editForm.businessItem"
                type="text"
                maxlength="100"
                class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
              >
            </label>
          </div>
          <div class="mt-3">
            <p class="text-xs font-bold text-gray-500">참여 트랙(capabilities)</p>
            <div class="mt-1.5 flex flex-wrap gap-3 text-xs">
              <label v-for="c in PARTNER_CAPABILITIES" :key="c" class="flex items-center gap-1.5">
                <input
                  v-model="editForm.capabilities"
                  type="checkbox"
                  :value="c"
                  class="size-3.5"
                >
                {{ PARTNER_CAPABILITY_LABELS[c] }}
              </label>
            </div>
          </div>
          <label class="mt-3 block text-xs text-gray-500">내부 메모(협력사 비노출)
            <textarea
              v-model="editForm.memo"
              rows="2"
              class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
          </label>
          <p v-if="editError !== ''" class="mt-2 text-xs font-semibold text-red-600">
            {{ editError }}
          </p>
          <button
            type="button"
            class="mt-2 rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50 disabled:opacity-40"
            :disabled="updateMut.isPending.value"
            @click="submitUpdate"
          >
            정보 저장
          </button>

          <!-- 계정 연결 -->
          <div class="mt-6 rounded-xl border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-700">
              연결 계정 ({{ detail.members.length }})
              <span class="ml-1 font-normal text-gray-400">— 로그인·포털 회신 가능 주체</span>
            </p>
            <ul class="mt-2 grid gap-1">
              <li
                v-for="m in detail.members"
                :key="m.mbId"
                class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
              >
                <span
                  class="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500"
                >{{ m.role }}</span>
                <span class="min-w-0 flex-1 truncate">{{ m.mbId }}</span>
                <button
                  type="button"
                  class="font-bold text-red-500 hover:text-red-700"
                  :disabled="removeMemberMut.isPending.value"
                  @click="removeMember(m.mbId)"
                >
                  해제
                </button>
              </li>
              <li v-if="detail.members.length === 0" class="text-xs text-gray-400">
                연결 계정 없음{{ detail.type === 'supplier' ? ' (API 공급사)' : '' }}
              </li>
            </ul>
            <div class="mt-2 flex items-center gap-1.5">
              <input
                v-model="memberMbId"
                type="text"
                placeholder="회원 ID(mb_id) 입력"
                class="h-8 flex-1 rounded-lg border border-gray-200 px-3 text-xs"
                @keyup.enter="addMember"
              >
              <button
                type="button"
                class="h-8 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white disabled:opacity-40"
                :disabled="addMemberMut.isPending.value"
                @click="addMember"
              >
                연결
              </button>
            </div>
            <p v-if="memberError !== ''" class="mt-1.5 text-xs font-semibold text-red-600">
              {{ memberError }}
            </p>
          </div>

          <!-- 마스터딜러 소속 (사람 협력사만) -->
          <div v-if="detail.type === 'partner'" class="mt-4 rounded-xl border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-700">
              마스터딜러 소속
              <span class="ml-1 font-normal text-gray-400">— PCB 2단 중개 링크(MD↔하위)</span>
            </p>

            <div v-if="relations === undefined" class="mt-2 text-xs text-gray-400">
              불러오는 중…
            </div>
            <template v-else>
              <!-- 이 조직이 소속된 상위 MD -->
              <div v-if="relations.parents.length > 0" class="mt-2">
                <p class="text-[11px] font-semibold text-indigo-500">소속된 마스터딜러</p>
                <ul class="mt-1 grid gap-1">
                  <li
                    v-for="p in relations.parents"
                    :key="p.partnerId"
                    class="flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-1.5 text-xs"
                  >
                    <span class="min-w-0 flex-1 truncate font-semibold text-indigo-700">
                      {{ p.name }}
                    </span>
                    <span class="text-gray-400">{{ p.country ?? '—' }}</span>
                    <select
                      :value="p.settlementCurrency ?? 'USD'"
                      class="h-7 rounded-md border border-gray-300 bg-surface px-1 font-mono text-[11px]"
                      :disabled="relationCurrencyMut.isPending.value"
                      @change="changeLinkCurrency(p.partnerId, detail.partnerId, $event)"
                    >
                      <option v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">
                        {{ cur }}
                      </option>
                    </select>
                    <span
                      v-if="p.activeCount > 0"
                      class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                    >
                      진행 {{ p.activeCount }}건
                    </span>
                    <button
                      type="button"
                      class="font-bold text-red-500 hover:text-red-700 disabled:opacity-40"
                      :disabled="p.activeCount > 0 || removeRelationMut.isPending.value"
                      @click="removeLink(p.partnerId, detail.partnerId)"
                    >
                      해제
                    </button>
                  </li>
                </ul>
              </div>

              <!-- 하위 협력사 -->
              <p class="mt-3 text-[11px] font-semibold text-gray-500">
                하위 협력사 ({{ relations.children.length }})
              </p>
              <p v-if="relations.children.length === 0" class="mt-1 text-xs text-gray-400">
                하위 협력사 없음 — 연결하면 이 조직이 마스터딜러로 동작합니다(하위 재요청·재발주).
              </p>
              <ul v-else class="mt-1 grid gap-1">
                <li
                  v-for="c in relations.children"
                  :key="c.partnerId"
                  class="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-xs"
                >
                  <span class="min-w-0 flex-1 truncate">{{ c.name }}</span>
                  <span
                    v-if="c.status !== 'approved'"
                    class="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600"
                  >
                    {{ PARTNER_STATUS_LABELS[c.status] }}
                  </span>
                  <span class="text-gray-400">{{ c.country ?? '—' }}</span>
                  <select
                    :value="c.settlementCurrency ?? 'USD'"
                    class="h-7 rounded-md border border-gray-300 bg-surface px-1 font-mono text-[11px]"
                    :disabled="relationCurrencyMut.isPending.value"
                    @change="changeLinkCurrency(detail.partnerId, c.partnerId, $event)"
                  >
                    <option v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">
                      {{ cur }}
                    </option>
                  </select>
                  <span
                    v-if="c.activeCount > 0"
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                    title="진행 중 견적·발주가 있어 해제할 수 없습니다"
                  >
                    진행 {{ c.activeCount }}건
                  </span>
                  <button
                    type="button"
                    class="font-bold text-red-500 hover:text-red-700 disabled:opacity-40"
                    :disabled="c.activeCount > 0 || removeRelationMut.isPending.value"
                    @click="removeLink(detail.partnerId, c.partnerId)"
                  >
                    해제
                  </button>
                </li>
              </ul>

              <!-- 하위 연결 — 다른 MD 의 하위 조직이면 후보가 비어 폼을 감춘다(2단 제한) -->
              <div
                v-if="relations.parents.length === 0"
                class="mt-2 flex items-center gap-1.5"
              >
                <select
                  v-model="relationChildId"
                  class="h-8 min-w-0 flex-1 rounded-lg border border-gray-200 bg-surface px-2 text-xs"
                >
                  <option :value="null" disabled>하위로 연결할 협력사 선택</option>
                  <option
                    v-for="cand in relations.candidates"
                    :key="cand.partnerId"
                    :value="cand.partnerId"
                  >
                    {{ cand.name }}{{ cand.country !== null ? ` · ${cand.country}` : ''
                    }}{{ cand.hasPcbRfq ? '' : ' (PCB 견적 능력 없음)' }}
                  </option>
                </select>
                <select
                  v-model="relationCurrency"
                  class="h-8 w-20 rounded-lg border border-gray-200 bg-surface px-1 font-mono text-xs"
                >
                  <option v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">{{ cur }}</option>
                </select>
                <button
                  type="button"
                  class="h-8 rounded-lg bg-gray-800 px-3 text-xs font-bold text-white disabled:opacity-40"
                  :disabled="addRelationMut.isPending.value"
                  @click="addRelation"
                >
                  연결
                </button>
              </div>
              <p v-else class="mt-2 text-[11px] text-gray-400">
                다른 마스터딜러의 하위 조직입니다 — 하위를 둘 수 없습니다(2단 제한).
              </p>
              <p class="mt-1.5 text-[11px] text-gray-400">
                링크 통화는 MD↔하위 결제통화입니다 — 배정 시점에 견적행으로 박제되며, 변경은
                이후 배정부터 적용됩니다.
              </p>
              <p v-if="relationError !== ''" class="mt-1.5 text-xs font-semibold text-red-600">
                {{ relationError }}
              </p>
            </template>
          </div>

          <!-- 상태 처리 -->
          <div class="mt-4 rounded-xl border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-700">상태 처리</p>
            <input
              v-if="detail.status !== 'suspended'"
              v-model="statusReason"
              type="text"
              placeholder="정지 사유 (정지 시 필수)"
              class="mt-2 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs"
            >
            <p v-if="statusError !== ''" class="mt-2 text-xs font-semibold text-red-600">
              {{ statusError }}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-if="detail.status === 'pending'"
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="statusMut.isPending.value"
                @click="changeStatus('approved')"
              >
                승인
              </button>
              <button
                v-if="detail.status !== 'suspended'"
                type="button"
                class="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
                :disabled="statusMut.isPending.value"
                @click="changeStatus('suspended')"
              >
                정지
              </button>
              <button
                v-if="detail.status === 'suspended'"
                type="button"
                class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
                :disabled="statusMut.isPending.value"
                @click="changeStatus('approved')"
              >
                정지 해제
              </button>
              <button
                type="button"
                class="ml-auto rounded-lg border border-red-200 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
                :disabled="deleteMut.isPending.value"
                @click="removePartner"
              >
                삭제
              </button>
            </div>
            <p class="mt-2 text-[11px] text-gray-400">
              삭제는 RFQ 이력이 없는 오기 정리용입니다 — 운영 배제는 정지를 사용하세요.
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- 생성 모달 -->
    <div
      v-if="createOpen"
      class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4"
      @click.self="createOpen = false"
    >
      <div
        class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-6 shadow-2xl"
      >
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-bold">파트너 등록</h2>
          <button
            type="button"
            class="text-gray-400 hover:text-gray-700"
            @click="createOpen = false"
          >
            ✕
          </button>
        </div>
        <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
          <label class="text-gray-500">유형
            <select
              v-model="createForm.type"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
              <option v-for="t in PARTNER_TYPES" :key="t" :value="t">
                {{ PARTNER_TYPE_LABELS[t] }}
              </option>
            </select>
          </label>
          <label class="text-gray-500">이름(회사명)
            <input
              v-model="createForm.name"
              type="text"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label v-if="createForm.type !== 'partner'" class="text-gray-500">supplierCode
            <input
              v-model="createForm.supplierCode"
              type="text"
              placeholder="digikey"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 font-mono"
            >
          </label>
          <label class="text-gray-500">국가(ISO 2){{ createForm.type === 'partner' ? ' *' : '' }}
            <input
              v-model="createForm.country"
              type="text"
              placeholder="KR"
              maxlength="2"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 uppercase"
            >
          </label>
          <label class="text-gray-500">기본 통화
            <input
              v-model="createForm.defaultCurrency"
              type="text"
              maxlength="3"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2 uppercase"
            >
          </label>
          <label class="text-gray-500">담당자 이메일
            <input
              v-model="createForm.contactEmail"
              type="email"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <p class="col-span-2 mt-2 border-t border-gray-100 pt-3 font-bold text-gray-700">
            거래 문서 사업자정보
          </p>
          <label class="text-gray-500">사업자등록번호
            <input
              v-model="createForm.businessNo"
              type="text"
              maxlength="30"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="text-gray-500">대표자명
            <input
              v-model="createForm.ownerName"
              type="text"
              maxlength="100"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="text-gray-500">우편번호
            <input
              v-model="createForm.businessZip"
              type="text"
              maxlength="10"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="text-gray-500">팩스번호
            <input
              v-model="createForm.fax"
              type="text"
              maxlength="50"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="col-span-2 text-gray-500">사업장주소
            <input
              v-model="createForm.businessAddress"
              type="text"
              maxlength="500"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="text-gray-500">업태
            <input
              v-model="createForm.businessType"
              type="text"
              maxlength="100"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
          <label class="text-gray-500">종목
            <input
              v-model="createForm.businessItem"
              type="text"
              maxlength="100"
              class="mt-1 h-8 w-full rounded-md border border-gray-300 px-2"
            >
          </label>
        </div>
        <div class="mt-3">
          <p class="text-xs font-bold text-gray-500">참여 트랙</p>
          <div class="mt-1.5 flex flex-wrap gap-3 text-xs">
            <label v-for="c in PARTNER_CAPABILITIES" :key="c" class="flex items-center gap-1.5">
              <input
                v-model="createForm.capabilities"
                type="checkbox"
                :value="c"
                class="size-3.5"
              >
              {{ PARTNER_CAPABILITY_LABELS[c] }}
            </label>
          </div>
        </div>
        <p v-if="createError !== ''" class="mt-3 text-xs font-semibold text-red-600">
          {{ createError }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50"
            @click="createOpen = false"
          >
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="createMut.isPending.value"
            @click="submitCreate"
          >
            등록(즉시 승인)
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
