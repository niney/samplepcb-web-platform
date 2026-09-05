import { apiRoutes } from '@sp/api-contract';
import { apiGetBlob } from '@sp/shared';

// 관리자 파일 다운로드 — 의뢰 첨부·이벤트 첨부·미리보기 모달의 '다운로드'가 같은 라우트를 쓴다.
// 실패는 호출자가 잡아 화면 문구로 바꾼다(apiErrorMessage).
export async function downloadAdminDevelopFile(fileId: number, name: string): Promise<void> {
  const blob = await apiGetBlob(`${apiRoutes.adminDevelopFiles}/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
