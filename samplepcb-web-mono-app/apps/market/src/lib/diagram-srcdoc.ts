// LLM 또는 프로젝트 API에서 온 HTML을 iframe srcdoc에 넣기 전 적용하는 임시 방어선.
// DOMParser는 문자열 결합과 달리 CSP meta를 실제 <head> 첫 요소로 보장한다. 결정적 SVG
// 렌더러로 교체하기 전까지 외부 리소스 요청·자동 이동·중첩 문서 실행 표면을 차단한다.

const DIAGRAM_CSP = [
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

export function buildDiagramSrcdoc(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // CSP보다 먼저 해석될 수 있는 기존 문서 정책·자동 이동을 제거하고, 정적 구성도에
  // 불필요한 실행·탐색 요소도 걷어낸다. 스타일과 인라인 SVG는 그대로 유지한다.
  doc
    .querySelectorAll('base, meta[http-equiv], script, iframe, object, embed, form')
    .forEach((element) => {
      element.remove();
    });

  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', DIAGRAM_CSP);
  doc.head.prepend(meta);

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
