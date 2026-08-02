<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
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

// ── 창 이동·확대(사용자 요청) — 헤더 드래그로 위치 이동, [확대] 토글로 넓게 ───
const expanded = ref(false);
const rootEl = ref<HTMLElement | null>(null);
const pos = ref<{ x: number; y: number } | null>(null); // null = 기본(우하단 도킹)
let dragFrom: { px: number; py: number; x: number; y: number } | null = null;

function onDragStart(e: PointerEvent): void {
  const el = rootEl.value;
  if (el === null) return;
  const rect = el.getBoundingClientRect();
  pos.value = { x: rect.left, y: rect.top };
  dragFrom = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onDragMove(e: PointerEvent): void {
  if (dragFrom === null) return;
  const width = rootEl.value?.offsetWidth ?? 520;
  // 헤더가 항상 화면에 남도록 클램프(좌우 80px·상단 0·하단 40px 여유)
  const x = Math.min(Math.max(dragFrom.x + e.clientX - dragFrom.px, 80 - width), window.innerWidth - 80);
  const y = Math.min(Math.max(dragFrom.y + e.clientY - dragFrom.py, 0), window.innerHeight - 40);
  pos.value = { x, y };
}
function onDragEnd(): void {
  dragFrom = null;
}
// 수동 리사이즈(사용자 요청) — 4모서리 그립 드래그. 기본 노출이 우하단 도킹이라
// 좌·상 방향 확장(nw·ne·sw)이 오히려 주 사용처다: 잡은 모서리의 반대편을 고정하고
// 그 방향으로 자란다. 수동 크기(size)가 있으면 [확대] 프리셋(w 클래스)보다 우선.
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const MIN_W = 420;
const MIN_H = 340;
const size = ref<{ w: number; h: number } | null>(null);
let resizeFrom: {
  corner: ResizeCorner;
  px: number;
  py: number;
  x: number;
  y: number;
  w: number;
  h: number;
} | null = null;

function onResizeStart(corner: ResizeCorner, e: PointerEvent): void {
  const el = rootEl.value;
  if (el === null) return;
  const rect = el.getBoundingClientRect();
  // 좌상단(left/top) 기준으로 전환(도킹 해제) — 이후 이동·리사이즈 좌표 일원화
  pos.value = { x: rect.left, y: rect.top };
  size.value = { w: rect.width, h: rect.height };
  resizeFrom = {
    corner,
    px: e.clientX,
    py: e.clientY,
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onResizeMove(e: PointerEvent): void {
  if (resizeFrom === null) return;
  const { corner, px, py, x, y, w, h } = resizeFrom;
  const dx = e.clientX - px;
  const dy = e.clientY - py;
  let newX = x;
  let newY = y;
  let newW = w;
  let newH = h;
  if (corner.includes('e')) {
    newW = Math.min(Math.max(w + dx, MIN_W), Math.max(MIN_W, window.innerWidth - x - 8));
  }
  if (corner.includes('w')) {
    newW = Math.min(Math.max(w - dx, MIN_W), Math.max(MIN_W, x + w - 8));
    newX = x + (w - newW); // 우측 변 고정 — 왼쪽으로 자란다
  }
  if (corner.includes('s')) {
    newH = Math.min(Math.max(h + dy, MIN_H), Math.max(MIN_H, window.innerHeight - y - 8));
  }
  if (corner.includes('n')) {
    newH = Math.min(Math.max(h - dy, MIN_H), Math.max(MIN_H, y + h - 8));
    newY = y + (h - newH); // 하단 변 고정 — 위로 자란다
  }
  pos.value = { x: newX, y: newY };
  size.value = { w: newW, h: newH };
}
function onResizeEnd(): void {
  resizeFrom = null;
}

const rootStyle = computed(() => ({
  ...(pos.value === null
    ? {}
    : {
        left: `${String(pos.value.x)}px`,
        top: `${String(pos.value.y)}px`,
        right: 'auto',
        bottom: 'auto',
      }),
  ...(size.value === null
    ? {}
    : { width: `${String(size.value.w)}px`, height: `${String(size.value.h)}px` }),
}));

// 확대/축소 시 위치 보정(사용자 요청) — 드래그로 옮겨둔 창(left/top 고정)은 폭·높이가
// 커지면 화면을 벗어날 수 있어, 토글 후 실제 크기로 재클램프한다. 기본 도킹(pos null)
// 은 right/bottom 기준이라 자연 보정. 수동 리사이즈 크기는 프리셋 복귀를 위해 리셋.
async function toggleExpanded(): Promise<void> {
  expanded.value = !expanded.value;
  size.value = null;
  if (pos.value === null) return;
  await nextTick();
  const rect = rootEl.value?.getBoundingClientRect();
  if (rect === undefined) return;
  pos.value = {
    x: Math.min(Math.max(pos.value.x, 8), Math.max(8, window.innerWidth - rect.width - 8)),
    y: Math.min(Math.max(pos.value.y, 8), Math.max(8, window.innerHeight - rect.height - 8)),
  };
}

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

// 확인·입력은 브라우저 alert 대신 컴포즈 내부 레이어 팝업(사용자 요청).
const dialog = ref<'confirm-apply' | 'prompt-save' | 'confirm-delete' | null>(null);
const templateName = ref('');
const selectedTemplate = computed(
  () => templates.value.find((t) => t.templateId === selectedTemplateId.value) ?? null,
);

function applyTemplate(): void {
  if (selectedTemplate.value === null) return;
  if (subject.value.trim() !== '' || body.value.trim() !== '') {
    dialog.value = 'confirm-apply';
    return;
  }
  doApplyTemplate();
}

function doApplyTemplate(): void {
  const tpl = selectedTemplate.value;
  if (tpl === null) return;
  subject.value = fillVars(tpl.subject);
  body.value = fillVars(tpl.body);
  dialog.value = null;
}

function saveCurrentAsTemplate(): void {
  if (subject.value.trim() === '' || body.value.trim() === '') {
    error.value = '제목과 본문을 작성한 뒤 템플릿으로 저장해 주세요.';
    return;
  }
  error.value = '';
  templateName.value = '';
  dialog.value = 'prompt-save';
}

async function doSaveTemplate(): Promise<void> {
  const name = templateName.value.trim();
  if (name === '') return;
  try {
    const res = await saveTemplate.mutateAsync({
      name,
      subject: subject.value,
      body: body.value,
    });
    selectedTemplateId.value = res.data.templateId;
    dialog.value = null;
  } catch {
    dialog.value = null;
    error.value = '템플릿 저장에 실패했습니다.';
  }
}

function removeTemplate(): void {
  if (selectedTemplate.value === null) return;
  dialog.value = 'confirm-delete';
}

async function doRemoveTemplate(): Promise<void> {
  const tpl = selectedTemplate.value;
  if (tpl === null) return;
  error.value = '';
  try {
    await deleteTemplate.mutateAsync(tpl.templateId);
    selectedTemplateId.value = '';
    dialog.value = null;
  } catch {
    dialog.value = null;
    error.value = '템플릿 삭제에 실패했습니다.';
  }
}

const templateLabel = (tpl: AdminMailTemplateType): string => tpl.name;

// ── 첨부 — 이미지·PDF 화이트리스트, 개당 10MB·합계 20MB(클라 선검증) ─────────
const totalBytes = computed(() => files.value.reduce((sum, f) => sum + f.size, 0));
const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${String(Math.ceil(bytes / 1024))}KB`;

// 파일 선택·드래그앤드롭 공용 검증(형식·개당 크기·합계).
function addFiles(picked: File[]): void {
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

function onFilesPicked(event: Event): void {
  const input = event.target as HTMLInputElement;
  const picked = [...(input.files ?? [])];
  input.value = '';
  addFiles(picked);
}

// 드래그앤드롭 첨부(사용자 요청) — 창 어디든 파일을 끌어다 놓으면 첨부.
// dragenter/leave 는 자식 요소를 오갈 때마다 발화하므로 카운터로 깜빡임을 막는다.
const isDragOver = ref(false);
let dragDepth = 0;

function onDragEnter(e: DragEvent): void {
  if (!(e.dataTransfer?.types ?? []).includes('Files')) return;
  dragDepth += 1;
  isDragOver.value = true;
}
function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDragOver.value = false;
}
function onDrop(e: DragEvent): void {
  dragDepth = 0;
  isDragOver.value = false;
  addFiles([...(e.dataTransfer?.files ?? [])]);
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
    ref="rootEl"
    class="fixed bottom-4 right-4 z-[70] flex max-w-[calc(100vw-2rem)] flex-col rounded-t-xl border border-gray-300 bg-surface shadow-2xl"
    :class="size === null ? (expanded ? 'w-[860px]' : 'w-[520px]') : ''"
    :style="rootStyle"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 드롭 오버레이 — 파일을 끌어온 동안만 -->
    <div
      v-if="isDragOver"
      class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-t-xl border-2 border-dashed border-blue-400 bg-blue-50/80"
    >
      <p class="text-sm font-bold text-blue-700">여기에 놓아 첨부 (이미지·PDF)</p>
    </div>

    <!-- 확인·입력 레이어(브라우저 alert 대체) — 컴포즈 내부 미니 다이얼로그 -->
    <div
      v-if="dialog !== null"
      class="absolute inset-0 z-30 grid place-items-center rounded-t-xl bg-black/30 p-6"
      @click.self="dialog = null"
    >
      <div class="w-full max-w-xs rounded-xl bg-surface p-4 shadow-2xl">
        <template v-if="dialog === 'confirm-apply'">
          <p class="text-sm text-gray-800">작성 중인 제목·본문을 템플릿 내용으로 바꿀까요?</p>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-50" @click="dialog = null">취소</button>
            <button type="button" class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700" @click="doApplyTemplate">바꾸기</button>
          </div>
        </template>
        <template v-else-if="dialog === 'prompt-save'">
          <p class="text-sm font-bold text-gray-800">템플릿으로 저장</p>
          <input
            v-model="templateName"
            type="text"
            maxlength="100"
            placeholder="템플릿 이름 (예: 견적 안내)"
            class="mt-2 h-9 w-full rounded-lg border border-gray-300 px-3 text-sm"
            @keyup.enter="doSaveTemplate"
          >
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-50" @click="dialog = null">취소</button>
            <button
              type="button"
              class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="templateName.trim() === '' || saveTemplate.isPending.value"
              @click="doSaveTemplate"
            >
              저장
            </button>
          </div>
        </template>
        <template v-else>
          <p class="text-sm text-gray-800">'{{ selectedTemplate?.name }}' 템플릿을 삭제할까요?</p>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-bold hover:bg-gray-50" @click="dialog = null">취소</button>
            <button
              type="button"
              class="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-40"
              :disabled="deleteTemplate.isPending.value"
              @click="doRemoveTemplate"
            >
              삭제
            </button>
          </div>
        </template>
      </div>
    </div>
    <!-- 헤더(Gmail 컴포즈 감성) — 드래그 핸들: 잡고 끌면 창이 이동한다 -->
    <div
      class="flex cursor-move touch-none select-none items-center gap-2 rounded-t-xl bg-gray-800 px-4 py-2.5 text-sm text-white"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <span class="font-bold">빠른 메일</span>
      <span class="truncate text-xs text-gray-300">{{ caseNo }} · {{ caseTitle }}</span>
      <button
        type="button"
        class="ml-auto shrink-0 cursor-pointer text-xs text-gray-300 hover:text-white"
        @pointerdown.stop
        @click="toggleExpanded"
      >
        {{ expanded ? '축소' : '확대' }}
      </button>
      <button
        type="button"
        class="shrink-0 cursor-pointer text-gray-300 hover:text-white"
        @pointerdown.stop
        @click="emit('close')"
      >
        ✕
      </button>
    </div>

    <div class="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto p-4 text-sm">
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

        <!-- 수동 리사이즈 시(창 높이 고정) 본문이 남는 공간을 채운다(flex-1) -->
        <textarea
          v-model="body"
          :rows="expanded ? 20 : 9"
          maxlength="10000"
          class="min-h-[100px] w-full flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm"
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

    <!-- 리사이즈 그립 4모서리 — 우하단 도킹이라 좌·상 방향 확장이 주 사용처 -->
    <div
      class="absolute left-0 top-0 z-10 size-3 cursor-nwse-resize touch-none"
      title="드래그로 크기 조절"
      @pointerdown="(e) => onResizeStart('nw', e)"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    />
    <div
      class="absolute right-0 top-0 z-10 size-3 cursor-nesw-resize touch-none"
      title="드래그로 크기 조절"
      @pointerdown="(e) => onResizeStart('ne', e)"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    />
    <div
      class="absolute bottom-0 left-0 z-10 size-3 cursor-nesw-resize touch-none"
      title="드래그로 크기 조절"
      @pointerdown="(e) => onResizeStart('sw', e)"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    />
    <div
      class="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none"
      title="드래그로 크기 조절"
      @pointerdown="(e) => onResizeStart('se', e)"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    >
      <svg viewBox="0 0 12 12" class="absolute bottom-0.5 right-0.5 size-3 text-gray-400" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <path d="M11 5L5 11M11 9l-2 2" stroke-linecap="round" />
      </svg>
    </div>
  </div>
</template>
