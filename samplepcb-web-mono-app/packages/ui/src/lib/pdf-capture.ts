// 화면의 종이(A4 폭 요소)를 그대로 찍어 PDF 로 내려받는다 — 상업송장 PDF(apps/web InvoiceEditorDialog)와 같은 방식
// (html2canvas-pro + jspdf, 처음 누를 때만 불러온다). 요소 하나 = 한 쪽부터 — A4 폭(210mm)에 맞추고 세로로 넘치면 다음
// 쪽으로 이어 자른다. 글자는 그림으로 들어간다(선택·검색은 안 된다) — 종이 모양을 화면·인쇄와 똑같이 맞추려는 선택이고,
// 글자를 고를 수 있는 파일이 필요하면 엑셀이나 브라우저 인쇄의 'PDF로 저장'을 쓴다.

/** 쪽 높이를 넘는지 볼 때 반올림 여유(mm) — 297.2mm 같은 값이 빈 쪽을 하나 더 만들지 않게. */
const PAGE_SLACK_MM = 1;

// 찍는 복제본에서만 글자 간격을 0 으로 — html2canvas 는 letter-spacing 이 0 이 아니면 글자를 하나씩 따로 그리는데,
// 그때 한글과 숫자·영문·가운뎃점의 세로 위치가 어긋나고 목록 번호(ol)도 떠 버린다(2026-11-04 실험으로 확인 — 0 이면
// 화면과 같다). 화면·브라우저 인쇄는 그대로 두고 PDF 만 고친다.
const resetLetterSpacing = (doc: Document): void => {
  const style = doc.createElement('style');
  style.textContent = '*, *::before, *::after { letter-spacing: 0 !important; }';
  doc.head.appendChild(style);
};

export async function downloadElementsPdf(elements: readonly HTMLElement[], fileName: string): Promise<void> {
  if (elements.length === 0) throw new Error('PDF 로 찍을 내용이 없습니다');
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
  // 웹 글꼴이 다 내려오기 전에 찍으면 대체 글꼴로 줄바꿈이 달라진다.
  await document.fonts.ready;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  let firstPage = true;
  for (const el of elements) {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, onclone: resetLetterSpacing });
    const img = canvas.toDataURL('image/jpeg', 0.92);
    const imgH = (canvas.height * pageW) / canvas.width;
    let offset = 0;
    do {
      if (!firstPage) pdf.addPage();
      firstPage = false;
      pdf.addImage(img, 'JPEG', 0, -offset, pageW, imgH);
      offset += pageH;
    } while (imgH - offset > PAGE_SLACK_MM);
  }
  pdf.save(fileName);
}
