// 시스템 구성도 HTML(AI 생성 또는 담당자 업로드) → 의뢰 상세 시안(피그마 「00-3」 39:9632) 배치용 조각.
// 생성 프롬프트(apps/api/src/lib/ai/dev-diagram.ts)가 문서 순서를 정해 둔다:
//   "요구사항 확인 요약" 박스 → SVG 1~2장(① 시스템 토폴로지 ② 하드웨어 블록도) → 확정된 구성·미확정 항목·… 검토사항.
// 여기서는 그 순서를 읽어 요약(도면 앞)·도면·정리(도면 뒤)로 가른다. 글은 textContent 만 꺼내 텍스트로 그리고,
// 도면 SVG 는 문서의 <style> 과 함께 sandbox iframe 으로만 그린다(LLM 문자열을 v-html 로 흘리지 않는 원칙 유지).
// 모델마다 마크업이 달라 못 읽으면 null — 부모가 문서 전체를 iframe 한 장으로 그린다.
// 출력물(인쇄)은 iframe 대신 도면마다 `img`(SVG data URI)로 그린다 — 이미지로 그린 SVG 는 스크립트·외부 로드가
// 아예 돌지 않아 안전하고, 쪽 폭에 맞춰 줄어들며, iframe 처럼 인쇄 중 잘리거나 비지 않는다.

export interface DiagramFigure {
  svg: string;
  img: string; // 인쇄용 — 원문 <style> 을 SVG 안에 넣은 독립 SVG 의 data URI
  caption: string;
}
export interface DiagramSection {
  title: string;
  items: string[];
}
export interface DiagramDoc {
  title: string;
  styles: string;
  before: DiagramSection[];
  figures: DiagramFigure[];
  after: DiagramSection[];
}

// 제목을 h 태그 대신 div·strong 으로 쓴 문서용 — 프롬프트가 정한 제목들
const SECTION_TITLE_RE = /(요구사항 확인 요약|확정된 구성|미확정 항목|고객 추가 확인사항|검토사항)/;
const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

export function parseDiagramDoc(html: string): DiagramDoc | null {
  if (typeof DOMParser === 'undefined' || html.trim() === '') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styles = [...doc.querySelectorAll('style')].map((s) => s.outerHTML).join('');
  const css = [...doc.querySelectorAll('style')].map((s) => s.textContent).join('\n');

  let title = '';
  const before: DiagramSection[] = [];
  const after: DiagramSection[] = [];
  const figures: DiagramFigure[] = [];
  let current: DiagramSection | null = null;
  let captionFor: DiagramFigure | null = null;

  const isHeading = (el: Element): boolean => {
    if (/^h[1-6]$/i.test(el.tagName)) return true;
    if (el.children.length > 0) return false;
    const t = clean(el.textContent);
    return t.length > 0 && t.length <= 30 && SECTION_TITLE_RE.test(t);
  };
  const push = (text: string): void => {
    if (current === null) {
      current = { title: '', items: [] };
      (figures.length > 0 ? after : before).push(current);
    }
    current.items.push(text);
  };

  // SVG 안쪽은 건너뛴다(도면 자체는 통째로 한 장).
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      const el = n as Element;
      return el.tagName.toLowerCase() !== 'svg' && el.closest('svg') !== null ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode() as Element | null; node !== null; node = walker.nextNode() as Element | null) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'svg') {
      const fig: DiagramFigure = { svg: node.outerHTML, img: svgImageSrc(node, css), caption: '' };
      figures.push(fig);
      captionFor = fig;
      current = null;
      continue;
    }
    if (isHeading(node)) {
      const text = clean(node.textContent);
      if (text === '') continue;
      // 문서 첫 h1(도면 앞) = 문서 제목
      if (tag === 'h1' && title === '' && figures.length === 0 && before.length === 0) {
        title = text;
        continue;
      }
      current = { title: text, items: [] };
      (figures.length > 0 ? after : before).push(current);
      captionFor = null;
      continue;
    }
    if (tag === 'li') {
      if (node.querySelector('li') !== null) continue; // 중첩 목록은 잎 li 만
      const text = clean(node.textContent);
      if (text !== '') push(text);
      captionFor = null;
      continue;
    }
    const leafBlock = tag === 'p' || tag === 'figcaption' || ((tag === 'div' || tag === 'span') && node.children.length === 0);
    if (leafBlock && node.closest('li') === null) {
      const text = clean(node.textContent);
      if (text === '') continue;
      // 도면 바로 뒤의 짧은 문장 = 그 도면의 설명
      if (captionFor !== null && captionFor.caption === '' && text.length <= 300) {
        captionFor.caption = text;
        captionFor = null;
        continue;
      }
      push(text);
    }
  }

  if (figures.length === 0) return null;
  return { title, styles, before: before.filter((s) => s.items.length > 0), figures, after: after.filter((s) => s.items.length > 0) };
}

// 도면 한 장을 독립 SVG 로 — XMLSerializer 가 SVG 네임스페이스와 XML 이스케이프를 맞춰 준다(HTML 직렬화의
// &nbsp; 같은 엔티티는 이미지로 읽을 때 깨진다). 클래스 스타일은 원문 CSS 를 SVG 첫 자식 <style> 로 싣는다.
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgImageSrc(svg: Element, css: string): string {
  const clone = svg.cloneNode(true) as Element;
  if (css.trim() !== '') {
    const style = clone.ownerDocument.createElementNS(SVG_NS, 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
}

// 도면 한 장을 iframe 에 넣을 문서 — 원문 <style> 을 같이 실어 클래스 스타일을 잃지 않는다.
export const figureSrcdoc = (styles: string, svg: string): string =>
  `<!doctype html><html><head><meta charset="utf-8">${styles}<style>html,body{margin:0;height:100%;background:#fff}body>svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`;
