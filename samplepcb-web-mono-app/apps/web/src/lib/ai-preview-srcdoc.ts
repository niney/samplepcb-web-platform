// 관리자 프롬프트 테스트의 HTML 미리보기 방어선. sandbox iframe에 더해 외부 요청과
// 문서 실행 요소를 제거하고 CSP를 문서 head 첫 요소로 강제한다.

const AI_PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "font-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export function buildAiPreviewSrcdoc(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc
    .querySelectorAll('base, meta[http-equiv], script, iframe, object, embed, form')
    .forEach((element) => {
      element.remove();
    });

  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', AI_PREVIEW_CSP);
  doc.head.prepend(meta);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
