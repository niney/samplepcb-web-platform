<script setup lang="ts">
import { reactive, ref } from 'vue';
import { MARKET_TOOLS_VERSION, sortMarketAreas } from '@sp/api-contract';
import type { MarketExpertMeType, MarketToolsType } from '@sp/api-contract';
import { useDeleteExpertFile, useUpdateExpertMe } from '../api/useMarketExpertMe';
import { errorMessage } from '../lib/error-msg';
import AreaToolsPicker from './AreaToolsPicker.vue';

// pending·rejected 상태의 본인 프로필 수정 폼 — 저장이 곧 재제출(rejected→pending, 서버).
// approved 프로필 수정(재승인 플로우)은 2차 — 호출측이 이 폼을 노출하지 않는다.
// 분야·툴은 레지스트리 기반(AreaToolsPicker) — 저장값에 남은 옛 분야 코드는 조용히 지난다.

const props = defineProps<{ me: MarketExpertMeType }>();
const emit = defineEmits<{ saved: [] }>();

const update = useUpdateExpertMe();
const deleteFile = useDeleteExpertFile();
const error = ref('');
const saved = ref(false);

const form = reactive({
  displayName: props.me.displayName,
  phone: props.me.phone,
  intro: props.me.intro ?? '',
  serviceAreas: sortMarketAreas(props.me.serviceAreas),
  tools: Object.fromEntries(Object.entries(props.me.tools.byArea).map(([k, v]) => [k, [...v]])),
  bankName: props.me.bankName ?? '',
  bankHolder: props.me.bankHolder ?? '',
  bankAccount: props.me.bankAccount ?? '',
});
const licenseFiles = ref<File[]>([]);
const portfolioFiles = ref<File[]>([]);
const bizregFile = ref<File | null>(null);

function pickFiles(e: Event, kind: 'license' | 'portfolio' | 'bizreg'): void {
  const input = e.target as HTMLInputElement;
  const files = input.files !== null ? Array.from(input.files) : [];
  if (kind === 'license') licenseFiles.value = files;
  else if (kind === 'portfolio') portfolioFiles.value = files;
  else bizregFile.value = files[0] ?? null;
}

function toggleArea(code: string): void {
  const i = form.serviceAreas.indexOf(code);
  if (i >= 0) form.serviceAreas.splice(i, 1);
  else form.serviceAreas.push(code);
}
function toggleTool(area: string, code: string): void {
  const list = form.tools[area] ?? (form.tools[area] = []);
  const i = list.indexOf(code);
  if (i >= 0) list.splice(i, 1);
  else list.push(code);
}
const buildTools = (): MarketToolsType => ({
  version: MARKET_TOOLS_VERSION,
  byArea: Object.fromEntries(
    form.serviceAreas.filter((a) => (form.tools[a] ?? []).length > 0).map((a) => [a, [...(form.tools[a] ?? [])]]),
  ),
});

async function onDeleteFile(fileId: number): Promise<void> {
  error.value = '';
  try {
    await deleteFile.mutateAsync(fileId);
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function save(): Promise<void> {
  error.value = '';
  saved.value = false;
  if (form.serviceAreas.length === 0) {
    error.value = '개발 분야를 1개 이상 선택해 주세요.';
    return;
  }
  const payload = {
    displayName: form.displayName.trim(),
    phone: form.phone.trim(),
    intro: form.intro.trim(),
    serviceAreas: form.serviceAreas,
    tools: buildTools(),
    ...(form.bankName !== '' ? { bankName: form.bankName } : {}),
    ...(form.bankHolder.trim() !== '' ? { bankHolder: form.bankHolder.trim() } : {}),
    ...(form.bankAccount.trim() !== '' ? { bankAccount: form.bankAccount.trim() } : {}),
  };
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const f of licenseFiles.value) fd.append('license', f);
  for (const f of portfolioFiles.value) fd.append('portfolio', f);
  if (bizregFile.value !== null) fd.append('bizreg', bizregFile.value);
  try {
    await update.mutateAsync(fd);
    saved.value = true;
    licenseFiles.value = [];
    portfolioFiles.value = [];
    bizregFile.value = null;
    emit('saved');
  } catch (err) {
    error.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="grid gap-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        이름/상호
        <input v-model="form.displayName" type="text" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
      </label>
      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        연락처
        <input v-model="form.phone" type="tel" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
      </label>
    </div>
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      내 소개
      <textarea v-model="form.intro" rows="4" class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed" />
    </label>

    <AreaToolsPicker
      :service-areas="form.serviceAreas"
      :tools="form.tools"
      @toggle-area="toggleArea"
      @toggle-tool="toggleTool"
    />

    <div class="grid gap-4 sm:grid-cols-3">
      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        은행
        <input v-model="form.bankName" type="text" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
      </label>
      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        예금주
        <input v-model="form.bankHolder" type="text" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
      </label>
      <label class="grid gap-1.5 text-xs font-bold text-tx-2">
        계좌번호
        <input v-model="form.bankAccount" type="text" class="h-10 rounded-lg border border-line px-3 text-sm font-normal">
      </label>
    </div>

    <!-- 증빙 파일 -->
    <div>
      <p class="text-xs font-bold text-tx-2">증빙 파일</p>
      <ul v-if="me.files.length > 0" class="mt-2 grid gap-1.5">
        <li
          v-for="f in me.files"
          :key="f.fileId"
          class="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs"
        >
          <span class="rounded bg-line px-1.5 py-0.5 font-mono text-[10px] text-tx-3">{{ f.fileType }}</span>
          <span class="min-w-0 flex-1 truncate text-tx-1">{{ f.name }}</span>
          <button
            type="button"
            class="text-red-500 hover:text-red-600"
            :disabled="deleteFile.isPending.value"
            @click="onDeleteFile(f.fileId)"
          >
            삭제
          </button>
        </li>
      </ul>
      <div class="mt-3 grid gap-2 text-xs font-bold text-tx-2 sm:grid-cols-3">
        <label class="grid gap-1">
          자격증·경력 추가
          <input type="file" multiple class="text-xs font-normal" @change="pickFiles($event, 'license')">
        </label>
        <label class="grid gap-1">
          포트폴리오 추가
          <input type="file" multiple class="text-xs font-normal" @change="pickFiles($event, 'portfolio')">
        </label>
        <label class="grid gap-1">
          사업자등록증 교체
          <input type="file" class="text-xs font-normal" @change="pickFiles($event, 'bizreg')">
        </label>
      </div>
    </div>

    <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
    <p v-if="saved" class="text-xs font-semibold text-emerald-600">
      저장되었습니다{{ me.status === 'rejected' ? ' — 재심사(심사 대기)로 전환됩니다.' : '.' }}
    </p>
    <div class="flex justify-end">
      <button
        type="button"
        class="rounded-lg bg-copper-500 px-5 py-2 text-xs font-bold text-white hover:bg-copper-600 disabled:opacity-40"
        :disabled="update.isPending.value"
        @click="save"
      >
        {{ update.isPending.value ? '저장 중…' : me.status === 'rejected' ? '수정하고 재제출' : '저장' }}
      </button>
    </div>
  </div>
</template>
