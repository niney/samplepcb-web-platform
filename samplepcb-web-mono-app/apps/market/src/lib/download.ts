import { apiGetBlob } from '@sp/shared';

// 인증 프록시 파일 다운로드 — <a href> 는 Authorization 헤더를 못 실으므로
// fetch(Blob) 후 objectURL 로 저장한다(sp-vue 관리자 다운로드 관례).
export async function downloadAuthedFile(path: string, filename: string): Promise<void> {
  const blob = await apiGetBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
