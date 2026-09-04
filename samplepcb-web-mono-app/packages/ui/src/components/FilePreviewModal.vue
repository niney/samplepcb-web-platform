<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { FilePreviewDataType, FileViewKindType } from '@sp/api-contract';
import {
  decodeTextBlob,
  delimiterFor,
  fetchPreviewBlob,
  fetchPreviewData,
  fileViewKind,
  needsServerPreview,
  parseDelimited,
  type PreviewTarget,
} from '../lib/file-preview';
import { errorMessage } from '../lib/error-msg';

// 첨부 미리보기 — 다운로드하지 않고 내용을 확인한다.
//
// 목적은 "받을 가치가 있는지 판단"이지 정독이 아니다. 그래서 서식 재현을 좇지 않고,
// 정독은 다운로드 버튼이 계속 담당한다(모달 안에도 둔다).
//
// 보안 세 가지가 이 컴포넌트의 제약을 만든다:
//   1) blob: URL 은 **생성한 문서의 origin 을 상속**한다. 그래서 SVG 는 `<img>` 로만 그리고
//      (img 컨텍스트에선 스크립트가 안 돈다), PDF iframe 은 allow-same-origin 을 주지 않는다.
//   2) html/htm 은 렌더하지 않고 소스 텍스트로만 보여준다(계약의 fileViewKind 가 text 로 분류).
//   3) 텍스트는 언제나 텍스트 바인딩이다 — v-html 은 이 파일에 존재하지 않는다.

// filesPath — 파일 라우트의 `…/files` 까지(도메인마다 다르다: 마켓 프로젝트·개발의뢰 등).
const props = defineProps<{
  open: boolean;
  filesPath: string;
  file: PreviewTarget | null;
}>();
const emit = defineEmits<{ close: []; download: [fileId: number, name: string] }>();

const loading = ref(false);
const error = ref('');
const blobUrl = ref('');
const textContent = ref('');
const grid = ref<string[][] | null>(null); // csv/tsv 를 표로
const preview = ref<FilePreviewDataType | null>(null);
const activeSheet = ref(0);

const kind = computed<FileViewKindType>(() =>
  props.file === null ? 'none' : fileViewKind(props.file.name),
);
// 새 탭 열기는 원본 origin 을 그대로 물려주므로 **스크립트가 돌 수 없는 형식만** 허용한다.
const canOpenInTab = computed(() => kind.value === 'pdf' || kind.value === 'image');

const releaseBlob = (): void => {
  if (blobUrl.value !== '') {
    URL.revokeObjectURL(blobUrl.value);
    blobUrl.value = '';
  }
};

const reset = (): void => {
  releaseBlob();
  error.value = '';
  textContent.value = '';
  grid.value = null;
  preview.value = null;
  activeSheet.value = 0;
};

async function load(): Promise<void> {
  const file = props.file;
  if (file === null) return;
  reset();
  loading.value = true;
  try {
    if (needsServerPreview(kind.value)) {
      preview.value = await fetchPreviewData(props.filesPath, file.fileId);
    } else {
      const blob = await fetchPreviewBlob(props.filesPath, file.fileId);
      if (kind.value === 'text') {
        const text = await decodeTextBlob(blob);
        const delimiter = delimiterFor(file.name);
        // CSV·TSV 는 표로 보는 게 압도적으로 낫다 — 스프레드시트와 같은 렌더러를 태운다.
        if (delimiter !== null) grid.value = parseDelimited(text, delimiter);
        else textContent.value = text;
      } else {
        blobUrl.value = URL.createObjectURL(blob);
      }
    }
  } catch (e) {
    error.value = errorMessage(e, '미리보기를 불러오지 못했습니다');
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.file?.fileId] as const,
  ([open]) => {
    if (open) void load();
    else reset();
  },
  { immediate: true },
);

onBeforeUnmount(releaseBlob);

const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${String(Math.max(1, Math.round(bytes / 1024)))}KB`;

const sheets = computed(() => preview.value?.sheets ?? []);
const shownSheet = computed(() => sheets.value[activeSheet.value] ?? null);

// unsupported 사유별 문구 — "형식이 안 된다"와 "파일이 크다"와 "읽다 실패했다"는
// 사용자가 할 수 있는 일이 다르다.
const unsupportedText = computed(() => {
  const reason = preview.value?.reason;
  if (reason === 'TOO_LARGE') return '파일이 커서 미리보기를 만들지 않았습니다. 내려받아 확인해 주세요.';
  if (reason === 'FAILED') return '파일을 읽지 못했습니다(손상되었거나 암호가 걸려 있을 수 있습니다).';
  return '이 형식은 미리보기를 지원하지 않습니다. 내려받아 확인해 주세요.';
});
</script>

<template>
  <div
    v-if="open && file !== null"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4"
    @click.self="emit('close')"
  >
    <div class="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <!-- 머리 -->
      <div class="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
        <span>📎</span>
        <p class="min-w-0 flex-1 truncate text-body font-bold text-tx-1">{{ file.name }}</p>
        <span class="shrink-0 text-label tabular-nums text-tx-3">{{ fmtSize(file.size) }}</span>
        <a
          v-if="canOpenInTab && blobUrl !== ''"
          :href="blobUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="shrink-0 rounded-lg border border-line-2 px-3 py-1.5 text-label font-bold text-tx-2 hover:border-brand-400 hover:text-brand-600"
        >
          새 탭
        </a>
        <button
          type="button"
          class="shrink-0 rounded-lg border border-line-2 px-3 py-1.5 text-label font-bold text-tx-2 hover:border-brand-400 hover:text-brand-600"
          @click="emit('download', file.fileId, file.name)"
        >
          다운로드
        </button>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-ink-900 px-3 py-1.5 text-label font-bold text-white hover:bg-ink-800"
          @click="emit('close')"
        >
          닫기
        </button>
      </div>

      <!-- 시트 탭 — 여러 시트가 있을 때만 -->
      <div v-if="sheets.length > 1" class="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-paper px-5 py-2">
        <button
          v-for="(s, i) in sheets"
          :key="s.name"
          type="button"
          class="shrink-0 rounded-lg px-3 py-1.5 text-label font-bold"
          :class="i === activeSheet ? 'bg-ink-900 text-white' : 'text-tx-2 hover:bg-white'"
          @click="activeSheet = i"
        >
          {{ s.name }}
        </button>
      </div>

      <!-- 본문 -->
      <div class="min-h-0 flex-1 overflow-auto bg-paper">
        <p v-if="loading" class="p-8 text-center text-body text-tx-3">불러오는 중…</p>
        <p v-else-if="error !== ''" class="p-8 text-center text-body font-semibold text-red-600">{{ error }}</p>

        <!-- 이미지: SVG 를 포함해 반드시 img 로만 그린다(스크립트 미실행) -->
        <div v-else-if="kind === 'image' && blobUrl !== ''" class="flex h-full items-center justify-center p-4">
          <img :src="blobUrl" :alt="file.name" class="max-h-full max-w-full object-contain">
        </div>

        <!-- PDF -->
        <!-- iframe + sandbox 는 안 된다(실측): allow-same-origin 없는 opaque origin 에서
             Chrome 이 내장 PDF 뷰어 로드를 거부하고 "Chrome에서 차단한 페이지입니다"를 띄운다.
             그렇다고 allow-same-origin 을 주면 blob: 이 앱 origin 을 상속해 토큰이 노출된다.
             embed 는 PDF 를 별도 프로세스의 PDFium 으로 그린다 — PDF 안의 JavaScript 는
             Acrobat JS API 라 DOM·스토리지에 손이 닿지 않으므로 origin 상속이 무의미하다.
             (같은 이유로 embed 는 HTML·SVG 에는 절대 쓰지 않는다 — 그건 진짜 스크립트가 돈다.) -->
        <embed
          v-else-if="kind === 'pdf' && blobUrl !== ''"
          :src="blobUrl"
          type="application/pdf"
          :title="file.name"
          class="h-full w-full bg-white"
        >

        <!-- 표: 스프레드시트와 CSV·TSV 가 같은 렌더러를 쓴다 -->
        <div v-else-if="shownSheet !== null || grid !== null" class="p-4">
          <table class="w-max border-collapse bg-white text-label">
            <tbody>
              <tr v-for="(row, ri) in (shownSheet?.rows ?? grid ?? [])" :key="ri" class="even:bg-paper">
                <td
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="max-w-[22rem] truncate border border-line px-2.5 py-1.5 align-top text-tx-1"
                  :title="cell"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="(shownSheet?.rows.length ?? grid?.length ?? 0) === 0" class="py-8 text-center text-body text-tx-3">
            내용이 비어 있습니다.
          </p>
        </div>

        <!-- 문서 텍스트 · 일반 텍스트: 언제나 텍스트 바인딩(v-html 금지) -->
        <pre
          v-else-if="preview?.kind === 'doc' || textContent !== ''"
          class="whitespace-pre-wrap break-words p-5 font-mono text-label leading-relaxed text-tx-1"
        >{{ preview?.kind === 'doc' ? preview.text : textContent }}</pre>

        <!-- 압축 파일 목록: 풀지 않고 안에 무엇이 있는지만 -->
        <ul v-else-if="preview?.kind === 'archive'" class="grid gap-1 p-4">
          <li
            v-for="e in preview.entries ?? []"
            :key="e.name"
            class="flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-2 text-label"
          >
            <span class="min-w-0 flex-1 truncate text-tx-1">{{ e.name }}</span>
            <span class="shrink-0 tabular-nums text-tx-3">{{ fmtSize(e.size) }}</span>
          </li>
        </ul>

        <div v-else-if="preview?.kind === 'unsupported'" class="p-8 text-center">
          <p class="text-body text-tx-2">{{ unsupportedText }}</p>
        </div>
      </div>

      <!-- 꼬리: 무엇을 얼마나 보여주고 있는지 -->
      <div
        v-if="preview !== null && preview.note !== ''"
        class="shrink-0 border-t border-line px-5 py-2.5 text-label text-tx-3"
      >
        {{ preview.note }}<span v-if="preview.truncated"> · 전체 내용은 다운로드해 확인해 주세요</span>
      </div>
    </div>
  </div>
</template>
