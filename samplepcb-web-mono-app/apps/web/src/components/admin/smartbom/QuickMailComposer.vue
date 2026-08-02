<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  QUICK_MAIL_MAX_FILE_BYTES,
  QUICK_MAIL_MAX_TOTAL_BYTES,
  type AdminMailTemplateType,
} from '@sp/api-contract';
import {
  loadQuickMailContext,
  useDeleteMailTemplate,
  useMailTemplates,
  useSaveMailTemplate,
  useSendQuickMail,
} from '../../../admin/useAdminQuickMail';

// 빠른 메일 컴포즈(§6.15) — Gmail 감성의 우하단 도킹 레이어(화면 이동 없음).
// 수신 기본값 = Case 고객(mb_email, 수정 가능). 템플릿 변수는 여기서 치환해 채우고
// 서버는 받은 그대로 발송한다. 1차는 페이지 내 레이어(라우트 이동 시 닫힘 — 전역
// 유지·최소화는 후속). 첨부 = 이미지·PDF, 개당 10MB·합계 20MB(서버 재검증).

const props = defineProps<{
  quoteId: string;
  /** 변수 치환 소스 — 목록 행이 이미 아는 값(§6.15: {Case번호}{Case제목}{확정금액}). */
  caseNo: string;
  caseTitle: string;
  confirmedTotal: number | null;
}>();
const emit = defineEmits<{ close: [] }>();

const to = ref('');
const subject = ref('');
const body = ref('');
const files = ref<File[]>([]);
const customerName = ref('');
const loading = ref(true);
const error = ref('');
const sent = ref(false);

// 열릴 때 프리필 — 고객 이메일·이름 1회 조회.
watch(
  () => props.quoteId,
  async (quoteId) => {
    loading.value = true;
    error.value = '';
    sent.value = false;
    to.value = '';
    subject.value = `[샘플피씨비] ${props.caseTitle}`;
    body.value = '';
    files.value = [];
    try {
      const ctx = await loadQuickMailContext(quoteId);
      to.value = ctx.toEmail ?? '';
      customerName.value = ctx.customerName;
      if (ctx.toEmail === null) {
        error.value = '고객 이메일이 등록되어 있지 않습니다 — 직접 입력해 주세요.';
      }
    } catch {
      error.value = '고객 정보를 불러오지 못했습니다 — 수신자를 직접 입력해 주세요.';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

// ── 템플릿 — 선택 시 변수 치환해 채움, 현재 내용 저장·삭제(컴포즈 안에서 완결) ──
const templatesQuery = useMailTemplates();
const templates = computed(() => templatesQuery.data.value?.data.items ?? []);
const selectedTemplateId = ref<number | ''>('');
const saveTemplate = useSaveMailTemplate();
const deleteTemplate = useDeleteMailTemplate();

const fillVars = (text: string): string =>
  text
    .replaceAll('{고객명}', customerName.value)
    .replaceAll('{Case번호}', props.caseNo)
    .replaceAll('{Case제목}', props.caseTitle)
    .replaceAll(
      '{확정금액}',
      props.confirmedTotal === null ? '' : `${props.confirmedTotal.toLocaleString('ko-KR')}원`,
    );

function applyTemplate(): void {
  const tpl = templates.value.find((t) => t.templateId === selectedTemplateId.value);
  if (tpl === undefined) return;
  if (
    (subject.value.trim() !== '' || body.value.trim() !== '') &&
    !window.confirm('작성 중인 제목·본문을 템플릿 내용으로 바꿀까요?')
  ) {
    return;
  }
  subject.value = fillVars(tpl.subject);
  body.value = fillVars(tpl.body);
}

async function saveCurrentAsTemplate(): Promise<void> {
  const name = window.prompt('템플릿 이름을 입력하세요 (예: 견적 안내)');
  if (name === null || name.trim() === '') return;
  if (subject.value.trim() === '' || body.value.trim() === '') {
    error.value = '제목과 본문을 작성한 뒤 템플릿으로 저장해 주세요.';
    return;
  }
  error.value = '';
  try {
    const res = await saveTemplate.mutateAsync({
      name: name.trim(),
      subject: subject.value,
      body: body.value,
    });
    selectedTemplateId.value = res.data.templateId;
  } catch {
    error.value = '템플릿 저장에 실패했습니다.';
  }
}

async function removeTemplate(): Promise<void> {
  const tpl = templates.value.find((t) => t.templateId === selectedTemplateId.value);
  if (tpl === undefined) return;
  if (!window.confirm(`'${tpl.name}' 템플릿을 삭제할까요?`)) return;
  error.value = '';
  try {
    await deleteTemplate.mutateAsync(tpl.templateId);
    selectedTemplateId.value = '';
  } catch {
    error.value = '템플릿 삭제에 실패했습니다.';
  }
}

const templateLabel = (tpl: AdminMailTemplateType): string => tpl.name;

// ── 첨부 — 이미지·PDF 화이트리스트, 개당 10MB·합계 20MB(클라 선검증) ─────────
const totalBytes = computed(() => files.value.reduce((sum, f) => sum + f.size, 0));
const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${String(Math.ceil(bytes / 1024))}KB`;

function onFilesPicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];
  input.value = '';
  error.value = '';
  for (const file of picked) {
    if (!/^(image\/|application\/pdf$)/.test(file.type)) {
      error.value = '이미지·PDF 파일만 첨부할 수 있습니다.';
      continue;
    }
    if (file.size > QUICK_MAIL_MAX_FILE_BYTES) {
      error.value = `'${file.name}' — 첨부는 개당 10MB 이하만 가능합니다.`;
      continue;
    }
    files.value = [...files.value, file];
  }
  if (totalBytes.value > QUICK_MAIL_MAX_TOTAL_BYTES) {
    error.value = '첨부 합계는 20MB 이하만 가능합니다 — 일부를 제거해 주세요.';
  }
}

function removeFile(idx: number): void {
  files.value = files.value.filter((_, i) => i !== idx);
}

// ── 발송 ────────────────────────────────────────────────────────────────────
const send = useSendQuickMail();

async function submit(): Promise<void> {
  error.value = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.value.trim())) {
    error.value = '수신자 이메일을 확인해 주세요.';
    return;
  }
  if (subject.value.trim() === '' || body.value.trim() === '') {
    error.value = '제목과 본문을 입력해 주세요.';
    return;
  }
  if (totalBytes.value > QUICK_MAIL_MAX_TOTAL_BYTES) {
    error.value = '첨부 합계는 20MB 이하만 가능합니다.';
    return;
  }
  try {
    await send.mutateAsync({
      quoteId: props.quoteId,
      to: to.value.trim(),
      subject: subject.value.trim(),
      body: body.value,
      files: files.value,
    });
    sent.value = true;
    window.setTimeout(() => {
      emit('close');
    }, 900);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '메일 발송에 실패했습니다.';
  }
}
</script>

<template>
  <div
    class="fixed bottom-4 right-4 z-[70] flex w-[520px] max-w-[calc(100vw-2rem)] flex-col rounded-t-xl border border-gray-300 bg-surface shadow-2xl"
  >
    <!-- 헤더(Gmail 컴포즈 감성) -->
    <div class="flex items-center gap-2 rounded-t-xl bg-gray-800 px-4 py-2.5 text-sm text-white">
      <span class="font-bold">✉ 빠른 메일</span>
      <span class="truncate text-xs text-gray-300">{{ caseNo }} · {{ caseTitle }}</span>
      <button type="button" class="ml-auto text-gray-300 hover:text-white" @click="emit('close')">✕</button>
    </div>

    <div class="space-y-2 p-4 text-sm">
      <p v-if="loading" class="py-4 text-center text-xs text-gray-400">불러오는 중…</p>
      <template v-else>
        <label class="block text-xs text-gray-500">받는 사람
          <input v-model="to" type="email" class="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 text-sm" placeholder="customer@example.com">
        </label>
        <label class="block text-xs text-gray-500">제목
          <input v-model="subject" type="text" maxlength="255" class="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 text-sm">
        </label>

        <!-- 템플릿 — 선택 적용·현재 내용 저장·삭제 -->
        <div class="flex items-center gap-1.5 text-xs">
          <select v-model="selectedTemplateId" class="h-8 min-w-0 flex-1 rounded-lg border border-gray-300 px-2">
            <option value="">템플릿 선택…</option>
            <option v-for="tpl in templates" :key="tpl.templateId" :value="tpl.templateId">{{ templateLabel(tpl) }}</option>
          </select>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-blue-200 px-2.5 py-1.5 font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
            :disabled="selectedTemplateId === ''"
            @click="applyTemplate"
          >
            적용
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1.5 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            :disabled="saveTemplate.isPending.value"
            title="현재 제목·본문을 템플릿으로 저장합니다"
            @click="saveCurrentAsTemplate"
          >
            현재 내용 저장
          </button>
          <button
            type="button"
            class="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            :disabled="selectedTemplateId === '' || deleteTemplate.isPending.value"
            title="선택한 템플릿 삭제"
            @click="removeTemplate"
          >
            🗑
          </button>
        </div>
        <p class="text-[11px] text-gray-400">
          변수: {고객명} {Case번호} {Case제목} {확정금액} — 템플릿 적용 시 이 Case 값으로 채워집니다.
        </p>

        <textarea
          v-model="body"
          rows="9"
          maxlength="10000"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          placeholder="본문을 입력하세요 — 발송 시 샘플피씨비 메일 서식에 담겨 전송됩니다."
        />

        <!-- 첨부 -->
        <div class="space-y-1">
          <div v-for="(file, idx) in files" :key="`${file.name}-${String(idx)}`" class="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs">
            <span class="min-w-0 flex-1 truncate">{{ file.type.startsWith('image/') ? '🖼' : '📄' }} {{ file.name }}</span>
            <span class="shrink-0 text-gray-400">{{ fmtSize(file.size) }}</span>
            <button type="button" class="shrink-0 text-gray-400 hover:text-red-600" @click="removeFile(idx)">✕</button>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <label class="cursor-pointer rounded-lg border border-gray-300 px-2.5 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
              📎 이미지·PDF 첨부
              <input type="file" class="hidden" multiple accept="image/*,application/pdf" @change="onFilesPicked">
            </label>
            <span v-if="files.length > 0" class="text-gray-400">합계 {{ fmtSize(totalBytes) }} / 20MB</span>
          </div>
        </div>

        <p v-if="error !== ''" class="text-xs font-semibold text-red-600">{{ error }}</p>
        <p v-else-if="sent" class="text-xs font-semibold text-emerald-600">발송되었습니다 ✓</p>

        <div class="flex items-center justify-end gap-2 pt-1">
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
            취소
          </button>
          <button
            type="button"
            class="rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
            :disabled="send.isPending.value || sent"
            @click="submit"
          >
            {{ send.isPending.value ? '보내는 중…' : '보내기' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
