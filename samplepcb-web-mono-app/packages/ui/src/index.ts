// @sp/ui — 마켓(sp-market)·개발의뢰(sp-develop)·관리자(sp-vue)가 함께 쓰는 Vue 렌더 컴포넌트.
// 2026-09-05 마켓에서 추출(docs/DEVELOP_FLOW.md §7.1). 규칙:
//   • i18n 미사용(도메인 라벨은 계약 상수, 화면 카피는 ko 인라인) — 앱의 i18n 인스턴스에 의존하지 않는다.
//   • Tailwind 클래스는 **시맨틱 토큰만**(brand-*, ink-*, paper, line, line-2, tx-1/2/3, text-micro…text-h1,
//     --color-area-*) — 값은 소비 앱의 style.css `@theme` 가 정한다. 소비 앱은 `@source "../../../packages/ui/src"`
//     를 CSS 에 넣어야 클래스가 생성된다(Tailwind v4 는 node_modules 심링크를 스캔하지 않는다).
//   • API 경로를 하드코딩하지 않는다 — 파일 미리보기는 `filesPath`(…/files 까지의 경로)를 prop 으로 받는다.
export { default as AreaIcon } from './components/AreaIcon.vue';
export { default as UiPagination } from './components/UiPagination.vue';
export { default as QuestionField } from './components/QuestionField.vue';
export { default as FileDropZone } from './components/FileDropZone.vue';
export { default as FilePreviewModal } from './components/FilePreviewModal.vue';
export { default as DevReviewView } from './components/DevReviewView.vue';
export { default as DevDiagramSection } from './components/DevDiagramSection.vue';

export type { QuestionState } from './types';
export { apiErrorMessage, errorMessage } from './lib/error-msg';
export {
  canPreview,
  decodeTextBlob,
  delimiterFor,
  fetchPreviewBlob,
  fetchPreviewData,
  fileViewKind,
  needsServerPreview,
  parseDelimited,
} from './lib/file-preview';
export type { PreviewTarget } from './lib/file-preview';
