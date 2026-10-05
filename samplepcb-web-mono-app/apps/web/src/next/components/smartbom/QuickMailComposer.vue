<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import {
  FileTextIcon,
  ImageIcon,
  Maximize2Icon,
  Minimize2Icon,
  PaperclipIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { QUICK_MAIL_MAX_FILE_BYTES, QUICK_MAIL_MAX_TOTAL_BYTES } from '@sp/api-contract';
import {
  loadQuickMailContext,
  useDeleteMailTemplate,
  useMailTemplates,
  useSaveMailTemplate,
  useSendQuickMail,
} from '@/admin/useAdminQuickMail';
import { confirmDialog, promptDialog } from '@/next/lib/dialog';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { Spinner } from '@/next/components/ui/spinner';
import { Textarea } from '@/next/components/ui/textarea';

// 빠른 메일 컴포즈(§6.15) — 옛 components/admin/smartbom/QuickMailComposer.vue 의 포트(같은 props·emits).
// 화면 이동 없이 우하단에 도킹되는 작성 창(Gmail 감성): 헤더를 끌면 이동, 네 모서리로 크기 조절, [확대] 토글.
// 수신 기본값 = Case 고객(mb_email, 수정 가능). 템플릿 변수는 여기서 치환해 채우고 서버는 받은 그대로
// 보낸다. 첨부 = 이미지·PDF, 개당 10MB·합계 20MB(서버 재검증).
// 템플릿 적용·저장·삭제의 확인·입력은 리뉴얼 셸 대화상자(@/next/lib/dialog) — 브라우저 alert 를 쓰지
// 않는다는 옛 결정 그대로이고, 창은 대화상자 아래 층(z-40)에 둬 대화상자가 그 위에 뜬다.
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

// ── 창 이동·크기(사용자 요청) — 헤더 드래그로 이동, 모서리 드래그로 크기, [확대] 토글 ─────────────
// 위치·크기는 CSS 변수(--qm-*)로만 넘기고 클래스가 그 변수를 읽는다(인라인 스타일 금지 규약).
const expanded = ref(false);
const rootEl = useTemplateRef<HTMLElement>('root');
const pos = ref<{ x: number; y: number } | null>(null); // null = 기본(우하단 도킹)
const size = ref<{ w: number; h: number } | null>(null); // null = 프리셋 폭(확대 여부)
let dragFrom: { px: number; py: number; x: number; y: number } | null = null;

const px = (v: number | undefined): string => (v === undefined ? '0px' : `${String(Math.round(v))}px`);
const posX = computed(() => px(pos.value?.x));
const posY = computed(() => px(pos.value?.y));
const sizeW = computed(() => px(size.value?.w));
const sizeH = computed(() => px(size.value?.h));

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

// 모서리 리사이즈 — 우하단 도킹이라 좌·상 방향 확장이 주 사용처. 잡은 모서리의 반대편을 고정하고
// 그 방향으로 자란다. 수동 크기가 있으면 [확대] 프리셋보다 우선.
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const MIN_W = 420;
const MIN_H = 340;
let resizeFrom: { corner: ResizeCorner; px: number; py: number; x: number; y: number; w: number; h: number } | null =
  null;

function onResizeStart(corner: ResizeCorner, e: PointerEvent): void {
  const el = rootEl.value;
  if (el === null) return;
  const rect = el.getBoundingClientRect();
  pos.value = { x: rect.left, y: rect.top };
  size.value = { w: rect.width, h: rect.height };
  resizeFrom = { corner, px: e.clientX, py: e.clientY, x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onResizeMove(e: PointerEvent): void {
  if (resizeFrom === null) return;
  const { corner, px: startX, py: startY, x, y, w, h } = resizeFrom;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  let newX = x;
  let newY = y;
  let newW = w;
  let newH = h;
  if (corner.includes('e')) newW = Math.min(Math.max(w + dx, MIN_W), Math.max(MIN_W, window.innerWidth - x - 8));
  if (corner.includes('w')) {
    newW = Math.min(Math.max(w - dx, MIN_W), Math.max(MIN_W, x + w - 8));
    newX = x + (w - newW); // 우측 변 고정 — 왼쪽으로 자란다
  }
  if (corner.includes('s')) newH = Math.min(Math.max(h + dy, MIN_H), Math.max(MIN_H, window.innerHeight - y - 8));
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
const RESIZE_CORNERS: { corner: ResizeCorner; cls: string }[] = [
  { corner: 'nw', cls: 'top-0 left-0 cursor-nwse-resize' },
  { corner: 'ne', cls: 'top-0 right-0 cursor-nesw-resize' },
  { corner: 'sw', cls: 'bottom-0 left-0 cursor-nesw-resize' },
  { corner: 'se', cls: 'right-0 bottom-0 cursor-nwse-resize' },
];

// 확대/축소 시 위치 보정 — 옮겨 둔 창(left/top 고정)은 커지면 화면을 벗어날 수 있어 실제 크기로
// 다시 클램프한다. 수동 리사이즈 크기는 프리셋 복귀를 위해 지운다.
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
      if (ctx.toEmail === null) error.value = '고객 이메일이 등록되어 있지 않습니다 — 직접 입력해 주세요.';
    } catch {
      error.value = '고객 정보를 불러오지 못했습니다 — 수신자를 직접 입력해 주세요.';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

// ── 템플릿 — 선택 시 변수 치환해 채움, 현재 내용 저장·삭제(컴포즈 안에서 완결) ──────────────────
const templatesQuery = useMailTemplates();
const templates = computed(() => templatesQuery.data.value?.data.items ?? []);
const selectedTemplateId = ref<number | null>(null);
const saveTemplate = useSaveMailTemplate();
const deleteTemplate = useDeleteMailTemplate();
const selectedTemplate = computed(() => templates.value.find((t) => t.templateId === selectedTemplateId.value) ?? null);

const onTemplatePick = (event: Event): void => {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  selectedTemplateId.value = value === '' ? null : Number(value);
};

const fillVars = (text: string): string =>
  text
    .replaceAll('{고객명}', customerName.value)
    .replaceAll('{Case번호}', props.caseNo)
    .replaceAll('{Case제목}', props.caseTitle)
    .replaceAll('{확정금액}', props.confirmedTotal === null ? '' : `${props.confirmedTotal.toLocaleString('ko-KR')}원`);

async function applyTemplate(): Promise<void> {
  const tpl = selectedTemplate.value;
  if (tpl === null) return;
  if (
    (subject.value.trim() !== '' || body.value.trim() !== '') &&
    !(await confirmDialog({ message: '작성 중인 제목·본문을 템플릿 내용으로 바꿀까요?', confirmLabel: '바꾸기' }))
  )
    return;
  subject.value = fillVars(tpl.subject);
  body.value = fillVars(tpl.body);
}

async function saveCurrentAsTemplate(): Promise<void> {
  if (subject.value.trim() === '' || body.value.trim() === '') {
    error.value = '제목과 본문을 작성한 뒤 템플릿으로 저장해 주세요.';
    return;
  }
  error.value = '';
  await promptDialog({
    title: '템플릿으로 저장',
    fields: [{ name: 'name', label: '템플릿 이름', required: true, maxlength: 100, placeholder: '예: 견적 안내' }],
    confirmLabel: '저장',
    errorFallback: '템플릿 저장에 실패했습니다.',
    submit: async (values) => {
      const res = await saveTemplate.mutateAsync({
        name: values.name ?? '',
        subject: subject.value,
        body: body.value,
      });
      selectedTemplateId.value = res.data.templateId;
    },
  });
}

async function removeTemplate(): Promise<void> {
  const tpl = selectedTemplate.value;
  if (tpl === null) return;
  if (
    !(await confirmDialog({
      message: `'${tpl.name}' 템플릿을 삭제할까요?`,
      confirmLabel: '삭제',
      tone: 'danger',
    }))
  )
    return;
  error.value = '';
  try {
    await deleteTemplate.mutateAsync(tpl.templateId);
    selectedTemplateId.value = null;
  } catch {
    error.value = '템플릿 삭제에 실패했습니다.';
  }
}

// ── 첨부 — 이미지·PDF 화이트리스트, 개당 10MB·합계 20MB(클라 선검증) ─────────────────────────
const totalBytes = computed(() => files.value.reduce((sum, f) => sum + f.size, 0));
const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${String(Math.ceil(bytes / 1024))}KB`;
const fileInput = useTemplateRef<HTMLInputElement>('fileInput');

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

// 드래그앤드롭 첨부 — 창 어디든 파일을 끌어다 놓으면 첨부. dragenter/leave 는 자식 요소를 오갈
// 때마다 발화하므로 카운터로 깜빡임을 막는다.
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

// ── 발송 ─────────────────────────────────────────────────────────────────────────────────
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
    ref="root"
    class="bg-card text-card-foreground fixed z-40 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-t-xl border shadow-2xl"
    :class="[
      pos === null ? 'right-4 bottom-4' : 'top-(--qm-y) left-(--qm-x)',
      size === null ? (expanded ? 'w-[860px]' : 'w-[520px]') : 'h-(--qm-h) w-(--qm-w)',
    ]"
    :style="{ '--qm-x': posX, '--qm-y': posY, '--qm-w': sizeW, '--qm-h': sizeH }"
    role="dialog"
    aria-label="빠른 메일"
    @dragenter="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- 드롭 안내 — 파일을 끌어온 동안만 -->
    <div
      v-if="isDragOver"
      class="border-primary bg-background/90 text-primary pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-t-xl border-2 border-dashed text-sm font-semibold"
    >
      여기에 놓아 첨부 (이미지·PDF)
    </div>

    <!-- 헤더 — 드래그 핸들: 잡고 끌면 창이 이동한다 -->
    <div
      class="bg-foreground text-background flex cursor-move touch-none items-center gap-2 px-4 py-2 text-sm select-none"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <span class="shrink-0 font-semibold whitespace-nowrap">빠른 메일</span>
      <span class="min-w-0 truncate text-xs opacity-70">{{ caseNo }} · {{ caseTitle }}</span>
      <span class="ml-auto flex shrink-0 items-center" @pointerdown.stop>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="expanded ? '축소' : '확대'"
          :title="expanded ? '축소' : '확대'"
          @click="void toggleExpanded()"
        >
          <Minimize2Icon v-if="expanded" />
          <Maximize2Icon v-else />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="닫기" @click="emit('close')">
          <XIcon />
        </Button>
      </span>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p v-if="loading" class="text-muted-foreground flex items-center justify-center gap-2 py-4 text-xs">
        <Spinner />
        불러오는 중…
      </p>
      <template v-else>
        <Field>
          <FieldLabel for="quick-mail-to">받는 사람</FieldLabel>
          <Input id="quick-mail-to" v-model="to" type="email" placeholder="customer@example.com" />
        </Field>
        <Field>
          <FieldLabel for="quick-mail-subject">제목</FieldLabel>
          <Input id="quick-mail-subject" v-model="subject" type="text" maxlength="255" />
        </Field>

        <!-- 템플릿 — 선택 적용·현재 내용 저장·삭제 -->
        <div class="flex items-center gap-1.5">
          <NativeSelect
            class="min-w-0 flex-1"
            :model-value="selectedTemplateId === null ? '' : String(selectedTemplateId)"
            aria-label="템플릿 선택"
            @change="onTemplatePick"
          >
            <NativeSelectOption value="">템플릿 선택…</NativeSelectOption>
            <NativeSelectOption v-for="tpl in templates" :key="tpl.templateId" :value="String(tpl.templateId)">
              {{ tpl.name }}
            </NativeSelectOption>
          </NativeSelect>
          <Button variant="outline" size="sm" :disabled="selectedTemplateId === null" @click="void applyTemplate()">
            적용
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="saveTemplate.isPending.value"
            title="현재 제목·본문을 템플릿으로 저장합니다"
            @click="void saveCurrentAsTemplate()"
          >
            현재 내용 저장
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="selectedTemplateId === null || deleteTemplate.isPending.value"
            aria-label="선택한 템플릿 삭제"
            title="선택한 템플릿 삭제"
            @click="void removeTemplate()"
          >
            <Trash2Icon />
          </Button>
        </div>
        <p class="text-muted-foreground text-xs">
          변수: {고객명} {Case번호} {Case제목} {확정금액} — 템플릿 적용 시 이 Case 값으로 채워집니다.
        </p>

        <!-- 크기를 직접 조절하면(창 높이 고정) 본문이 남는 공간을 채운다(flex-1) -->
        <Textarea
          v-model="body"
          :rows="expanded ? 20 : 9"
          maxlength="10000"
          class="min-h-24 flex-1 resize-none"
          aria-label="본문"
          placeholder="본문을 입력하세요 — 발송 시 샘플피씨비 메일 서식에 담겨 전송됩니다."
        />

        <!-- 첨부 -->
        <div class="flex flex-col gap-1">
          <div
            v-for="(file, idx) in files"
            :key="`${file.name}-${String(idx)}`"
            class="bg-muted/40 flex items-center gap-2 rounded-md px-2.5 py-1 text-xs"
          >
            <ImageIcon v-if="file.type.startsWith('image/')" class="text-muted-foreground size-3.5 shrink-0" />
            <FileTextIcon v-else class="text-muted-foreground size-3.5 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
            <span class="text-muted-foreground shrink-0">{{ fmtSize(file.size) }}</span>
            <Button variant="ghost" size="icon-xs" :aria-label="`${file.name} 첨부 제거`" @click="removeFile(idx)">
              <XIcon />
            </Button>
          </div>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" @click="fileInput?.click()">
              <PaperclipIcon />
              이미지·PDF 첨부
            </Button>
            <input
              ref="fileInput"
              type="file"
              class="hidden"
              multiple
              accept="image/*,application/pdf"
              @change="onFilesPicked"
            >
            <span v-if="files.length > 0" class="text-muted-foreground text-xs">
              합계 {{ fmtSize(totalBytes) }} / 20MB
            </span>
          </div>
        </div>

        <Alert v-if="error !== ''" variant="destructive" size="sm">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <Alert v-else-if="sent" variant="success" size="sm">
          <AlertDescription>발송되었습니다.</AlertDescription>
        </Alert>

        <div class="flex items-center justify-end gap-2">
          <Button variant="outline" @click="emit('close')">취소</Button>
          <Button :disabled="send.isPending.value || sent" @click="void submit()">
            <Spinner v-if="send.isPending.value" />
            <SendIcon v-else />
            {{ send.isPending.value ? '보내는 중…' : '보내기' }}
          </Button>
        </div>
      </template>
    </div>

    <!-- 리사이즈 그립 4모서리 — 우하단 도킹이라 좌·상 방향 확장이 주 사용처 -->
    <div
      v-for="grip in RESIZE_CORNERS"
      :key="grip.corner"
      class="absolute z-10 size-3 touch-none"
      :class="grip.cls"
      title="드래그로 크기 조절"
      @pointerdown="(e: PointerEvent) => onResizeStart(grip.corner, e)"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
    />
  </div>
</template>
