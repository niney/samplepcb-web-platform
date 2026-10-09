<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import {
  PARTNER_STATUS_LABELS,
  PCB_CURRENCIES,
  type PartnerChildItemType,
  type PartnerChildTrackType,
  type PcbCurrencyType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import { confirmDialog } from '../../lib/confirmDialog';
import { usePartnerI18n } from '../../partner/i18n';
import {
  useCreatePartnerChild,
  useDeletePartnerChild,
  useInvitePartnerChild,
  usePartnerChildren,
  useReactivatePartnerChild,
  useUpdatePartnerChild,
} from '../../partner/usePartnerChildren';

// 하위 협력사 직접 관리(docs/PARTNER_PORTAL.md "하위 협력사 직접 관리").
// 마스터딜러가 견적을 다시 요청하고 발주를 맡길 협력사를 직접 등록한다. 등록은 바로 쓰이고
// (자동 승인) 상대방 계정은 만들지 않는다 — 필요하면 초대로 본인이 연결한다.
// 첫 등록은 조직을 마스터딜러로 바꾸므로, 진행 중인 발주가 있으면 서버가 막는다. 폼을 다 채운 뒤
// 거절당하지 않게 화면이 먼저 안내한다(eligibility).

const { pt, pd, pn } = usePartnerI18n();

const query = usePartnerChildren();
const eligibility = computed(() => query.data.value?.data.eligibility ?? null);
const items = computed(() => query.data.value?.data.items ?? []);
// 하위에게 맡길 수 있는 일 — 내가 가진 견적 트랙 안에서만. 트랙이 하나뿐이면 고를 것이 없다.
const parentTracks = computed(() => query.data.value?.data.parentTracks ?? []);
const TRACK_LABELS: Record<PartnerChildTrackType, string> = {
  pcb_rfq: 'PCB 제작',
  bom_rfq: '부품 조달',
};

const createMut = useCreatePartnerChild();
const updateMut = useUpdatePartnerChild();
const deleteMut = useDeletePartnerChild();
const reactivateMut = useReactivatePartnerChild();
const inviteMut = useInvitePartnerChild();

// 관리자 대리 접속이면 진행 중 발주가 있어도 사유를 남기고 등록할 수 있다.
const forceMode = computed(
  () => eligibility.value?.reason === 'ACTIVE_POS' && eligibility.value.canForce,
);
const canCreate = computed(() => eligibility.value?.allowed === true || forceMode.value);

const BLOCK_TEXT = {
  NO_PCB_TRACK: '견적을 받는 협력사(PCB 제작·부품 조달)만 하위 협력사를 둘 수 있습니다.',
  PARENT_IS_CHILD: '다른 마스터딜러에 소속된 협력사는 하위 협력사를 둘 수 없습니다.',
} as const;

// 서버 거절 사유 → 포털 문구(서버 메시지는 한국어뿐이라 코드로 옮긴다).
const ERROR_TEXT: Record<string, string> = {
  PARENT_HAS_ACTIVE_POS: '진행 중인 발주가 있어 지금은 등록할 수 없습니다.',
  PARENT_IS_CHILD: BLOCK_TEXT.PARENT_IS_CHILD,
  NO_PCB_TRACK: BLOCK_TEXT.NO_PCB_TRACK,
  NOT_OWNED: '샘플피씨비에서 연결한 협력사는 여기서 바꿀 수 없습니다.',
  RELATION_ACTIVE: '진행 중인 견적·발주가 있어 삭제할 수 없습니다. 끝난 뒤 다시 시도해 주세요.',
  SHARED_CHILD: '다른 곳에서도 함께 쓰는 협력사입니다. 샘플피씨비 담당자에게 요청해 주세요.',
  NOT_OWNER_SUSPENDED:
    '샘플피씨비에서 정지한 협력사는 다시 사용으로 바꿀 수 없습니다. 담당자에게 문의해 주세요.',
  ALREADY_HAS_ACCOUNT: '이미 포털 계정이 연결된 협력사입니다.',
  NOT_APPROVED: '사용 중지된 협력사입니다.',
  EMAIL_REQUIRED: '초대를 받을 이메일을 먼저 입력해 주세요.',
  TRACK_NOT_ALLOWED: '맡길 일을 하나 이상 골라 주세요.',
};
const errorText = (caught: unknown): string => {
  const code = caught instanceof ApiRequestError ? (caught.payload?.error ?? '') : '';
  return pt(ERROR_TEXT[code] ?? '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
};

const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null);
const say = (tone: 'ok' | 'error', text: string): void => {
  notice.value = { tone, text };
};

// ── 등록·수정 폼 ──────────────────────────────────────────────────────────
interface Draft {
  name: string;
  country: string;
  settlementCurrency: PcbCurrencyType;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  forceReason: string;
  tracks: PartnerChildTrackType[];
}
const emptyDraft = (): Draft => ({
  name: '',
  country: '',
  settlementCurrency: 'USD',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  forceReason: '',
  tracks: [...parentTracks.value],
});
const asCurrency = (value: string | null): PcbCurrencyType =>
  PCB_CURRENCIES.find((c) => c === value) ?? 'USD';

/** null=닫힘 · 'new'=등록 · 숫자=그 조직 수정 */
const editing = ref<number | 'new' | null>(null);
const draft = ref<Draft>(emptyDraft());
const formError = ref<string | null>(null);

const openCreate = (): void => {
  draft.value = emptyDraft();
  formError.value = null;
  editing.value = 'new';
};
const openEdit = (item: PartnerChildItemType): void => {
  draft.value = {
    name: item.name,
    country: item.country ?? '',
    settlementCurrency: asCurrency(item.settlementCurrency),
    contactName: item.contactName ?? '',
    contactPhone: item.contactPhone ?? '',
    contactEmail: item.contactEmail ?? '',
    forceReason: '',
    tracks: item.tracks.filter((track) => parentTracks.value.includes(track)),
  };
  formError.value = null;
  editing.value = item.partnerId;
};
const closeForm = (): void => {
  editing.value = null;
};

const formBusy = computed(() => createMut.isPending.value || updateMut.isPending.value);
const blankToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

async function submitForm(): Promise<void> {
  const target = editing.value;
  if (target === null) return;
  formError.value = null;
  const d = draft.value;
  const country = d.country.trim().toUpperCase();
  const email = d.contactEmail.trim();
  if (d.name.trim() === '') {
    formError.value = pt('회사명을 입력해 주세요.');
    return;
  }
  if (!/^[A-Z]{2}$/.test(country)) {
    formError.value = pt('국가는 영문 2자리로 입력해 주세요. (예: KR, CN)');
    return;
  }
  if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    formError.value = pt('이메일 형식이 올바르지 않습니다.');
    return;
  }
  if (parentTracks.value.length > 1 && d.tracks.length === 0) {
    formError.value = pt('맡길 일을 하나 이상 골라 주세요.');
    return;
  }
  const needsReason = target === 'new' && forceMode.value;
  if (needsReason && d.forceReason.trim() === '') {
    formError.value = pt('사유를 입력해 주세요.');
    return;
  }
  const body = {
    name: d.name.trim(),
    country,
    settlementCurrency: d.settlementCurrency,
    contactName: blankToNull(d.contactName),
    contactPhone: blankToNull(d.contactPhone),
    contactEmail: email === '' ? null : email,
    // 트랙이 하나뿐이면 보내지 않는다 — 서버가 내 트랙 전부로 채운다.
    ...(parentTracks.value.length > 1 ? { tracks: d.tracks } : {}),
  };
  try {
    if (target === 'new') {
      await createMut.mutateAsync(
        needsReason ? { ...body, forceReason: d.forceReason.trim() } : body,
      );
      say('ok', pt('등록했습니다.'));
    } else {
      await updateMut.mutateAsync({ childId: target, body });
      say('ok', pt('저장했습니다.'));
    }
    closeForm();
  } catch (caught) {
    formError.value = errorText(caught);
  }
}

// ── 삭제(이력이 있으면 사용 중지) · 다시 사용 · 초대 ──────────────────────
async function remove(item: PartnerChildItemType): Promise<void> {
  const ok = await confirmDialog({
    title: pt('이 협력사를 삭제할까요?'),
    message: item.hasHistory
      ? pt(
          '{name} — 거래 이력이 있어 삭제 대신 사용 중지로 남습니다. 견적요청을 더 보낼 수 없게 되고, 나중에 다시 사용으로 되돌릴 수 있습니다.',
          { name: item.name },
        )
      : pt('{name} — 삭제하면 되돌릴 수 없습니다.', { name: item.name }),
    confirmLabel: item.hasHistory ? pt('사용 중지') : pt('삭제'),
    cancelLabel: pt('취소'),
    tone: 'danger',
  });
  if (!ok) return;
  try {
    const res = await deleteMut.mutateAsync(item.partnerId);
    say('ok', pt(res.data.outcome === 'deleted' ? '삭제했습니다.' : '사용 중지로 바꿨습니다.'));
  } catch (caught) {
    say('error', errorText(caught));
  }
}

async function reactivate(item: PartnerChildItemType): Promise<void> {
  try {
    await reactivateMut.mutateAsync(item.partnerId);
    say('ok', pt('다시 사용으로 바꿨습니다.'));
  } catch (caught) {
    say('error', errorText(caught));
  }
}

async function invite(item: PartnerChildItemType): Promise<void> {
  const email = item.contactEmail ?? '';
  if (email === '') {
    say('error', pt('초대를 받을 이메일을 먼저 입력해 주세요.'));
    return;
  }
  const ok = await confirmDialog({
    title: pt('포털 초대를 보낼까요?'),
    message: pt(
      '{email} 로 초대 메일을 보냅니다. 받은 분이 본인 계정으로 로그인해 수락하면 포털을 직접 쓸 수 있습니다.',
      { email },
    ),
    confirmLabel: pt('초대 보내기'),
    cancelLabel: pt('취소'),
  });
  if (!ok) return;
  try {
    await inviteMut.mutateAsync({ childId: item.partnerId, body: {} });
    say('ok', pt('초대 메일을 보냈습니다.'));
  } catch (caught) {
    say('error', errorText(caught));
  }
}

const rowBusy = computed(
  () => deleteMut.isPending.value || reactivateMut.isPending.value || inviteMut.isPending.value,
);

const FIELD_CLS =
  'w-full rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-teal-400 focus:outline-none';
const ROW_BTN_CLS =
  'rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40';
</script>

<template>
  <div class="pcb-readable space-y-5">
    <PartnerPageHeader
      :title="pt('하위 협력사')"
      :subtitle="pt('견적을 다시 요청하고 발주를 맡길 협력사를 직접 등록합니다. 계정이 없어도 견적요청 메일의 링크로 회신할 수 있습니다.')"
    >
      <template #actions>
        <button
          type="button"
          class="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          data-testid="partner-child-create"
          :disabled="!canCreate"
          @click="openCreate"
        >
          {{ pt('하위 협력사 등록') }}
        </button>
      </template>
      <!-- 조직과 소속은 트랙 공용 — 하위마다 맡길 일(PCB 제작·부품 조달)을 따로 정한다 -->
      <p class="mt-1 text-xs text-gray-400">
        {{ pt('받은 견적요청을 하위 협력사에 다시 요청할 때 쓰입니다.') }}
      </p>
    </PartnerPageHeader>

    <!-- 지금 등록할 수 없는 이유 — 폼을 열기 전에 알린다 -->
    <section
      v-if="eligibility !== null && !eligibility.allowed"
      class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      data-testid="partner-child-blocked"
    >
      <template v-if="eligibility.reason === 'ACTIVE_POS'">
        <p class="font-semibold">
          {{ pt('진행 중인 발주 {count}건이 끝나면 하위 협력사를 등록할 수 있습니다.', { count: pn(eligibility.activePoCount) }) }}
        </p>
        <p class="mt-1 text-xs text-amber-800">
          {{ pt('하위 협력사를 두면 받은 발주를 하위에 맡길 수 있게 됩니다. 진행 중인 발주가 있는 동안에는 이 역할을 바꾸지 않습니다.') }}
        </p>
        <ul class="mt-2 flex flex-wrap gap-1.5">
          <li v-for="po in eligibility.activePos" :key="po.poId">
            <RouterLink
              :to="{ name: 'partner-pcb-po', params: { id: String(po.poId) } }"
              class="inline-block max-w-56 truncate rounded-md border border-amber-300 bg-surface px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              :title="po.projectName"
            >
              {{ po.projectName }}
            </RouterLink>
          </li>
        </ul>
        <p v-if="eligibility.canForce" class="mt-2 text-xs font-semibold text-amber-900">
          {{ pt('관리자 접속 중에는 사유를 남기고 등록할 수 있습니다. 진행 중인 발주는 직접 제작으로 그대로 진행됩니다.') }}
        </p>
      </template>
      <p v-else-if="eligibility.reason !== null" class="font-semibold">
        {{ pt(BLOCK_TEXT[eligibility.reason]) }}
      </p>
    </section>

    <p
      v-if="notice !== null"
      :role="notice.tone === 'error' ? 'alert' : 'status'"
      class="rounded-md px-3 py-2 text-sm"
      :class="notice.tone === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'"
    >
      {{ notice.text }}
    </p>

    <PartnerEmpty v-if="items.length === 0">
      {{ query.isFetching.value ? pt('불러오는 중…') : pt('등록한 하위 협력사가 없습니다.') }}
    </PartnerEmpty>

    <div v-else class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="px-4 py-2.5">{{ pt('회사명') }}</th>
            <th class="whitespace-nowrap px-4 py-2.5">{{ pt('국가') }}</th>
            <th class="whitespace-nowrap px-4 py-2.5">{{ pt('결제 통화') }}</th>
            <th class="px-4 py-2.5">{{ pt('담당자') }}</th>
            <th class="whitespace-nowrap px-4 py-2.5">{{ pt('포털 계정') }}</th>
            <th class="whitespace-nowrap px-4 py-2.5">{{ pt('진행 중') }}</th>
            <th class="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="item in items" :key="item.partnerId" data-testid="partner-child-row">
            <td class="max-w-xs px-4 py-2.5">
              <p class="truncate font-medium text-gray-900" :title="item.name">{{ item.name }}</p>
              <p class="mt-0.5 flex flex-wrap gap-1">
                <span
                  v-if="item.status !== 'approved'"
                  class="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                >{{ item.ownerSuspended ? pt('사용 중지') : pt(PARTNER_STATUS_LABELS[item.status]) }}</span>
                <span
                  v-if="!item.owned"
                  class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600"
                  :title="pt('샘플피씨비에서 연결한 협력사입니다 — 변경은 담당자에게 요청해 주세요.')"
                >{{ pt('관리자 연결') }}</span>
                <span
                  v-for="track in item.tracks"
                  :key="track"
                  class="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
                >{{ pt(TRACK_LABELS[track]) }}</span>
              </p>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ item.country ?? '—' }}</td>
            <td class="whitespace-nowrap px-4 py-2.5 text-gray-600">{{ item.settlementCurrency ?? 'USD' }}</td>
            <td class="max-w-56 px-4 py-2.5 text-xs text-gray-600">
              <p class="truncate">{{ item.contactName ?? '—' }}</p>
              <p v-if="item.contactEmail !== null" class="truncate text-gray-400" :title="item.contactEmail">
                {{ item.contactEmail }}
              </p>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-xs">
              <span v-if="item.hasPortalAccount" class="font-semibold text-emerald-700">{{ pt('연결됨') }}</span>
              <template v-else>
                <span v-if="item.invite?.pending === true" class="text-amber-700">
                  {{ pt('초대 보냄 · {date}까지', { date: pd(item.invite.expiresAt) }) }}
                </span>
                <span v-else class="text-gray-400">{{ pt('계정 없음') }}</span>
                <button
                  v-if="item.owned && item.status === 'approved'"
                  type="button"
                  class="ml-2"
                  :class="ROW_BTN_CLS"
                  :disabled="rowBusy"
                  @click="void invite(item)"
                >
                  {{ item.invite === null ? pt('초대') : pt('다시 초대') }}
                </button>
              </template>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums">
              <span v-if="item.activeCount > 0" class="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                {{ pt('{count}건', { count: pn(item.activeCount) }) }}
              </span>
              <span v-else class="text-gray-300">—</span>
            </td>
            <td class="whitespace-nowrap px-4 py-2.5 text-right">
              <div v-if="item.owned" class="flex justify-end gap-1.5">
                <button
                  v-if="item.ownerSuspended"
                  type="button"
                  :class="ROW_BTN_CLS"
                  :disabled="rowBusy"
                  @click="void reactivate(item)"
                >
                  {{ pt('다시 사용') }}
                </button>
                <template v-else-if="item.status === 'approved'">
                  <button type="button" :class="ROW_BTN_CLS" :disabled="rowBusy" @click="openEdit(item)">
                    {{ pt('수정') }}
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                    :disabled="rowBusy || item.activeCount > 0"
                    :title="item.activeCount > 0 ? pt('진행 중인 견적·발주가 있어 삭제할 수 없습니다. 끝난 뒤 다시 시도해 주세요.') : undefined"
                    @click="void remove(item)"
                  >
                    {{ pt('삭제') }}
                  </button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 등록·수정 -->
    <div
      v-if="editing !== null"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      @click.self="closeForm"
    >
      <form
        class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-5 shadow-2xl"
        data-testid="partner-child-form"
        @submit.prevent="void submitForm()"
      >
        <div class="mb-3">
          <h2 class="text-base font-bold text-gray-900">
            {{ editing === 'new' ? pt('하위 협력사 등록') : pt('하위 협력사 수정') }}
          </h2>
          <p v-if="editing === 'new'" class="mt-0.5 text-xs text-gray-500">
            {{ pt('등록하면 바로 견적을 요청할 수 있습니다. 상대방의 회원가입은 필요하지 않습니다.') }}
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="sm:col-span-2">
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('회사명') }} *</span>
            <input v-model="draft.name" type="text" name="name" :class="FIELD_CLS" maxlength="191">
          </label>
          <label>
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('국가 (영문 2자리)') }} *</span>
            <input
              v-model="draft.country"
              type="text"
              name="country"
              class="uppercase"
              :class="FIELD_CLS"
              maxlength="2"
              placeholder="KR"
            >
          </label>
          <label>
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('결제 통화') }} *</span>
            <select v-model="draft.settlementCurrency" name="settlementCurrency" :class="FIELD_CLS">
              <option v-for="cur in PCB_CURRENCIES" :key="cur" :value="cur">{{ cur }}</option>
            </select>
          </label>
          <p class="text-[11px] text-gray-400 sm:col-span-2">
            {{ pt('이 협력사와 정산할 통화입니다. 바꾸면 이후 견적요청부터 적용됩니다.') }}
          </p>
          <fieldset v-if="parentTracks.length > 1" class="sm:col-span-2">
            <legend class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('맡길 일') }} *</legend>
            <div class="flex flex-wrap gap-4">
              <label v-for="track in parentTracks" :key="track" class="flex items-center gap-1.5 text-sm text-gray-700">
                <input v-model="draft.tracks" type="checkbox" name="tracks" :value="track">
                {{ pt(TRACK_LABELS[track]) }}
              </label>
            </div>
            <span class="mt-1 block text-[11px] text-gray-400">
              {{ pt('고른 일의 견적요청만 이 협력사에 다시 요청할 수 있습니다.') }}
            </span>
          </fieldset>
          <label>
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('담당자') }}</span>
            <input v-model="draft.contactName" type="text" name="contactName" :class="FIELD_CLS" maxlength="100">
          </label>
          <label>
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('연락처') }}</span>
            <input v-model="draft.contactPhone" type="text" name="contactPhone" :class="FIELD_CLS" maxlength="50">
          </label>
          <label class="sm:col-span-2">
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('이메일') }}</span>
            <input v-model="draft.contactEmail" type="email" name="contactEmail" :class="FIELD_CLS" maxlength="255">
            <span class="mt-1 block text-[11px] text-gray-400">{{ pt('견적요청과 포털 초대를 받을 주소입니다.') }}</span>
          </label>
          <label v-if="editing === 'new' && forceMode" class="sm:col-span-2">
            <span class="mb-1 block text-xs font-semibold text-gray-700">{{ pt('강제 전환 사유') }} *</span>
            <textarea v-model="draft.forceReason" name="forceReason" rows="2" :class="FIELD_CLS" maxlength="255" />
          </label>
        </div>

        <p v-if="formError !== null" role="alert" class="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ formError }}
        </p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50"
            @click="closeForm"
          >
            {{ pt('취소') }}
          </button>
          <button
            type="submit"
            class="rounded-lg bg-teal-600 px-4 py-2 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
            :disabled="formBusy"
          >
            <template v-if="editing === 'new'">{{ formBusy ? pt('등록 중…') : pt('등록') }}</template>
            <template v-else>{{ formBusy ? pt('저장 중…') : pt('저장') }}</template>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
