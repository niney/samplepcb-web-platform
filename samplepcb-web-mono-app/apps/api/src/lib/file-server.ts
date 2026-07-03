import { z } from 'zod';

// file.samplepcb.kr 업로드 대행 클라이언트.
// 거버 뷰어는 파일을 sp-node 로만 보내고(pathToken 클라이언트 미노출),
// 파일서버 전송은 여기서 서버-to-서버로 수행한다 (HANDOFF 2장).

const FILE_SERVER_URL = process.env.FILE_SERVER_URL ?? 'https://file.samplepcb.kr';

const UploadedFile = z.object({
  uploadFileName: z.string(),
  originFileName: z.string(),
  pathToken: z.string(),
  size: z.number(),
});
export type UploadedFileType = z.infer<typeof UploadedFile>;

const UploadResponse = z.object({
  result: z.boolean(),
  message: z.string().optional(),
  data: z.array(UploadedFile).optional(),
});

export interface UploadTarget {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

const uploadOne = async (file: UploadTarget, serviceType: string): Promise<UploadedFileType> => {
  const form = new FormData();
  form.append('serviceType', serviceType);
  form.append(
    'files',
    new File([new Uint8Array(file.buffer)], file.filename, { type: file.mimetype }),
  );

  const res = await fetch(`${FILE_SERVER_URL}/api/uploadFileByAnonymous`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    throw new Error(`file server HTTP ${String(res.status)}`);
  }

  const parsed = UploadResponse.safeParse(await res.json());
  if (!parsed.success || !parsed.data.result || parsed.data.data === undefined) {
    throw new Error(
      `file server upload failed: ${parsed.success ? (parsed.data.message ?? 'no data') : 'invalid response'}`,
    );
  }
  const first = parsed.data.data[0];
  if (first === undefined) {
    throw new Error('file server upload failed: empty data');
  }
  return first;
};

/**
 * 익명 업로드 API 로 파일들을 전송하고 pathToken 목록을 받는다(입력 순서 보존).
 * ⚠ 파일서버가 한 요청 복수 파일을 처리하지 못해(실측: 2개 전송 시 서버 오류)
 *   파일당 1요청으로 순차 전송한다.
 * 실패 시 throw — 담기 트랜잭션은 파일 없이 진행하면 안 되므로 호출측에서 중단할 것.
 */
export const uploadToFileServer = async (
  files: UploadTarget[],
  serviceType = 'gerber',
): Promise<UploadedFileType[]> => {
  const uploaded: UploadedFileType[] = [];
  for (const f of files) {
    uploaded.push(await uploadOne(f, serviceType));
  }
  return uploaded;
};

const DeleteResponse = z.object({
  result: z.boolean(),
  message: z.string().optional(),
});

/**
 * GET /api/delete/:pathToken — 실파일 삭제. 404(이미 없음)는 성공으로 취급해
 * 재시도가 멱등이 되게 한다. 그 외 실패는 throw — 호출측은 DB 를 지우기 **전에**
 * 이걸 호출해야 실패 시 pathToken 이 남아 재시도가 가능하다(고아 파일 방지).
 * ⚠ 이 API 는 pathToken 만으로 삭제되는 GET — 노출 범위 제한은 미처리 과제
 *   (docs/GERBER_ORDER_FLOW.md 보안 메모 참조).
 */
export const deleteFromFileServer = async (pathToken: string): Promise<void> => {
  const res = await fetch(`${FILE_SERVER_URL}/api/delete/${encodeURIComponent(pathToken)}`);
  if (res.status === 404) return;
  if (!res.ok) {
    throw new Error(`file server delete HTTP ${String(res.status)}`);
  }
  const parsed = DeleteResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error('file server delete: invalid response');
  }
  if (!parsed.data.result) {
    throw new Error(`file server delete failed: ${parsed.data.message ?? 'unknown'}`);
  }
};
