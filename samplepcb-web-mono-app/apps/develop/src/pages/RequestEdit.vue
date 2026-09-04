<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { isDevelopEditable, sortMarketAreas } from '@sp/api-contract';
import type { DevelopFileMetaType, DevelopRequestUpdateBodyType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { FileDropZone } from '@sp/ui';
import {
  useAddDevelopFiles,
  useDeleteDevelopFile,
  useDevelopRequest,
  useUpdateDevelopRequest,
} from '../api/useDevelopRequests';
import { useRequestForm } from '../composables/useRequestForm';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import { fileSize } from '../lib/format';
import ContactFields from '../components/request/ContactFields.vue';
import StepConditions from '../components/request/StepConditions.vue';
import StepDescribe from '../components/request/StepDescribe.vue';

// 의뢰 수정(docs/DEVELOP_FLOW.md §7.2) — 견적이 나가기 전(received·reviewing)까지만 열린다.
// 위저드와 **같은 폼 상태**(useRequestForm)를 쓰되 스텝이 없다: 이미 쓴 글을 고치러 온 사람에게
// 3단계를 다시 걷게 하지 않는다. 대신 한 화면에 위저드 1·2스텝 컴포넌트를 이어 붙이고 연락처를 더한다.
// 저장은 세 갈래다 — 본문 필드는 PATCH(바뀐 것만), 새 첨부는 POST files(multipart), 삭제는 DELETE files/:id.
// 첨부는 서버에 이미 있는 실체라 "저장" 을 기다리지 않고 즉시 반영된다(그게 파일에 대한 사용자의 기대다).

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const detailPath = computed(() => `/requests/${String(requestId.value ?? 0)}`);

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);
const editable = computed(() => {
  const d = detail.value;
  if (d === undefined) return false;
  return d.viewer.canEdit && isDevelopEditable(d.status);
});

const form = useRequestForm();
const { fields, attachments, buildAnswers, buildTools, buildContact, hydrate, formValid, clearFiles } = form;

// 프리필 — 상세가 도착하면 한 번만(입력 중 refetch 가 사용자의 편집을 덮어쓰지 않게).
const hydrated = ref(false);
watch(
  detail,
  (d) => {
    if (d === undefined || hydrated.value) return;
    hydrate(d);
    hydrated.value = true;
  },
  { immediate: true },
);

// ── 저장(PATCH) — 바뀐 필드만 실어 보낸다 ─────────────────────────────────────
const update = useUpdateDevelopRequest(requestId);
const saveError = ref('');

// 분야는 고른 순서가 뜻을 갖지 않는다 — 정렬해 비교해야 "카드를 껐다 켰다"가 수정으로 안 잡힌다.
const sameAreas = (a: string[], b: string[]): boolean => {
  const x = sortMarketAreas(a);
  const y = sortMarketAreas(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

function changedBody(): DevelopRequestUpdateBodyType {
  const d = detail.value;
  const body: DevelopRequestUpdateBodyType = {};
  if (d === undefined) return body;
  const title = fields.title.trim();
  const description = fields.description.trim();
  const answers = buildAnswers();
  const tools = buildTools();
  const contact = buildContact();
  if (title !== d.title) body.title = title;
  if (description !== d.description) body.description = description;
  if (!sameAreas(fields.serviceAreas, d.serviceAreas)) body.serviceAreas = sortMarketAreas(fields.serviceAreas);
  if (fields.budgetRange !== null && fields.budgetRange !== d.budgetRange) body.budgetRange = fields.budgetRange;
  if (fields.ndaWanted !== d.ndaWanted) body.ndaWanted = fields.ndaWanted;
  if (JSON.stringify(answers) !== JSON.stringify(d.answers)) body.answers = answers;
  if (JSON.stringify(tools) !== JSON.stringify(d.tools)) body.tools = tools;
  if (JSON.stringify(contact) !== JSON.stringify(d.contact)) body.contact = contact;
  return body;
}
const dirty = computed<boolean>(() => {
  if (!hydrated.value) return false;
  // 폼 값을 읽는 계산이라 입력이 바뀔 때마다 다시 돈다(detail 이 캐시로 갱신돼도 마찬가지).
  return Object.keys(changedBody()).length > 0;
});

async function save(): Promise<void> {
  saveError.value = '';
  const body = changedBody();
  if (Object.keys(body).length === 0) {
    void router.push(detailPath.value);
    return;
  }
  try {
    await update.mutateAsync(body);
    void router.push(detailPath.value);
  } catch (err) {
    saveError.value = errorMessage(err);
  }
}

// ── 첨부(즉시 반영) ─────────────────────────────────────────────────────────
const addFiles = useAddDevelopFiles(requestId);
const deleteFile = useDeleteDevelopFile(requestId);
const fileError = ref('');
const removingId = ref<number | null>(null);

async function uploadPending(): Promise<void> {
  fileError.value = '';
  if (attachments.value.length === 0) return;
  const fd = new FormData();
  for (const f of attachments.value) fd.append('attachment', f);
  try {
    await addFiles.mutateAsync(fd);
    clearFiles();
  } catch (err) {
    fileError.value = errorMessage(err);
  }
}
async function removeFile(f: DevelopFileMetaType): Promise<void> {
  fileError.value = '';
  removingId.value = f.fileId;
  try {
    await deleteFile.mutateAsync(f.fileId);
  } catch (err) {
    fileError.value = errorMessage(err);
  } finally {
    removingId.value = null;
  }
}

// 드롭존을 빗나간 파일 드롭 방어 — 기본 동작이면 브라우저가 그 파일을 이 탭에서 열어 편집 중인 내용이 사라진다.
function swallowDrop(e: DragEvent): void {
  e.preventDefault();
}
onMounted(() => {
  window.addEventListener('dragover', swallowDrop);
  window.addEventListener('drop', swallowDrop);
});
onBeforeUnmount(() => {
  window.removeEventListener('dragover', swallowDrop);
  window.removeEventListener('drop', swallowDrop);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
</script>

<template>
  <section class="mx-auto w-full max-w-[1080px] px-6 pt-9 pb-32">
    <p class="font-mono text-micro tracking-[.14em] text-tx-3">EDIT REQUEST</p>
    <h1 class="mt-1.5 text-h1 font-extrabold text-tx-1">의뢰 수정</h1>

    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">의뢰 수정은 로그인 후 진행할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600" @click="goLogin">
        로그인
      </button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="mt-8 rounded-2xl border border-line bg-white px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div v-else-if="detailQ.isError.value || detail === undefined" class="mt-8 rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body font-semibold text-red-700">{{ errorMessage(detailQ.error.value, '의뢰를 불러오지 못했습니다.') }}</p>
      <RouterLink to="/me" class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2">
        내 의뢰로
      </RouterLink>
    </div>

    <!-- 수정 창이 닫힌 의뢰 -->
    <div v-else-if="!editable" class="mt-8 rounded-2xl border border-line bg-white p-10 text-center sm:p-12">
      <h2 class="text-title font-extrabold text-tx-1">지금은 수정할 수 없습니다</h2>
      <p class="mx-auto mt-2 max-w-xl text-body leading-relaxed text-tx-2">
        견적서가 나간 뒤에는 의뢰 내용을 고칠 수 없습니다. 바꾸실 내용이 있으면 담당자에게 알려 주세요 —
        수정 견적으로 반영해 드립니다.
      </p>
      <RouterLink
        :to="detailPath"
        class="mt-6 inline-block h-11 rounded-lg bg-ink-950 px-6 text-body font-bold leading-[2.75rem] text-white transition hover:bg-brand-600"
      >
        의뢰 상세로
      </RouterLink>
    </div>

    <template v-else>
      <p class="mt-2 max-w-2xl text-body leading-relaxed text-tx-2">
        견적서가 나가기 전까지 자유롭게 고치실 수 있습니다. 수정하면 담당자에게 알림이 가고, 이미 만들어진
        검토서는 다시 검토됩니다.
      </p>

      <div class="mt-7 grid gap-7">
        <StepDescribe :form="form" :show-attachments="false" />
        <StepConditions :form="form" :show-slots="false" />

        <!-- 연락처 -->
        <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
          <h2 class="text-title font-extrabold text-tx-1">연락처</h2>
          <ContactFields :form="form" />
        </section>

        <!-- 이미 올린 첨부 -->
        <section class="grid gap-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
          <div class="grid gap-1">
            <h2 class="text-title font-extrabold text-tx-1">올려 둔 자료</h2>
            <p class="text-label leading-relaxed text-tx-3">
              여기서 지우거나 더하는 것은 저장을 기다리지 않고 바로 반영됩니다.
            </p>
          </div>

          <ul v-if="detail.files.length > 0" class="grid gap-1.5">
            <li
              v-for="f in detail.files"
              :key="f.fileId"
              class="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-label"
            >
              <span class="min-w-0 flex-1 truncate font-semibold text-tx-1">{{ f.name }}</span>
              <span class="shrink-0 tabular-nums text-tx-3">{{ fileSize(f.size) }}</span>
              <button
                type="button"
                class="h-7 shrink-0 rounded-md border border-line-2 px-2.5 font-bold text-tx-3 transition hover:border-red-400 hover:text-red-600 disabled:opacity-40"
                :disabled="removingId === f.fileId"
                @click="void removeFile(f)"
              >
                {{ removingId === f.fileId ? '지우는 중…' : '삭제' }}
              </button>
            </li>
          </ul>
          <p v-else class="rounded-xl bg-paper px-4 py-3 text-body text-tx-3">올려 둔 자료가 없습니다.</p>

          <div class="grid gap-3 border-t border-line pt-4">
            <FileDropZone
              :files="attachments"
              label="자료 추가"
              hint="회로도 · 사양서 · 화면 시안 · 참고 링크 캡처 등 무엇이든"
              variant="panel"
              @add="form.addAttachments"
              @remove="form.removeAttachment"
            />
            <div class="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                class="h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600 disabled:bg-line-2 disabled:text-tx-3"
                :disabled="attachments.length === 0 || addFiles.isPending.value"
                @click="void uploadPending()"
              >
                {{ addFiles.isPending.value ? '올리는 중…' : `선택한 ${attachments.length}건 올리기` }}
              </button>
              <p v-if="attachments.length > 0" class="text-label text-tx-3">올리기를 눌러야 서버에 저장됩니다.</p>
            </div>
            <p v-if="fileError !== ''" class="rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ fileError }}</p>
          </div>
        </section>

        <p v-if="saveError !== ''" class="rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ saveError }}</p>
      </div>

      <!-- 하단 고정 액션 바 -->
      <div class="print-hidden fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 backdrop-blur">
        <div class="mx-auto flex w-full max-w-[1080px] items-center gap-3 px-6 py-3.5">
          <RouterLink
            :to="detailPath"
            class="h-11 rounded-lg border border-line-2 bg-white px-5 text-body font-bold leading-[2.75rem] text-tx-2 transition hover:border-tx-3"
          >
            그만두기
          </RouterLink>
          <p class="hidden min-w-0 flex-1 truncate text-label text-tx-3 sm:block">
            {{ dirty ? '수정한 내용이 있습니다.' : '바뀐 내용이 없습니다.' }}
          </p>
          <button
            type="button"
            class="ml-auto h-11 rounded-lg bg-brand-500 px-7 text-body font-bold text-white transition hover:bg-brand-600 disabled:bg-line-2 disabled:text-tx-3"
            :disabled="!formValid || !dirty || update.isPending.value"
            @click="void save()"
          >
            {{ update.isPending.value ? '저장 중…' : '저장' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
