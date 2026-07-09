import { promises as fs } from 'node:fs';
import path from 'node:path';

// ── 메인 슬라이드 이미지 로컬 저장 ──────────────────────────────────────────
// sp-php 의 data/banner 디렉토리(그누보드 G5_DATA_PATH)에 배너 실파일을 둔다. sp-php
// 브릿지(theme/sp-lite/inc/main_slider.php)가 G5_DATA_URL/banner/{bn_id} 로 서빙하므로,
// 파일명은 확장자 없이 bn_id 그 자체(영카트 배너 규약). sp-node 와 sp-php 는 같은 호스트·
// 유저(samplepcb)로 배포되어 디스크를 공유한다(결정 자문: docker 미도입, 단일 호스트).
// 배포 시 G5_DATA_PATH 로 samplepcb-web/data 절대경로를 지정한다(Windows/Linux 경로차).
//
// 파일서버(file.samplepcb.kr)를 쓰지 않는 이유: 그 API 는 무인증 GET delete 라(file-server.ts
// 참조) 공개 배너 HTML 에 pathToken 을 노출하면 방문자가 파일을 지울 수 있어 구조적 부적합.

function bannerDir(): string {
  const base = process.env.G5_DATA_PATH;
  if (!base) {
    throw new Error(
      'G5_DATA_PATH 가 설정되지 않았습니다. apps/api/.env 에 samplepcb-web/data 의 절대경로를 지정하세요.',
    );
  }
  return path.join(base, 'banner');
}

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

// 매직바이트로 이미지 판별(코어 getimagesize 동등 — 확장자만 믿지 않는다).
export function sniffImage(buf: Buffer): ImageKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif'; // GIF
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'; // BM
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // RIFF
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // WEBP
  ) {
    return 'webp';
  }
  return null;
}

export async function saveBannerImage(id: number, buf: Buffer): Promise<void> {
  const dir = bannerDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, String(id)), buf);
}

// 행 삭제와 동반 호출. 파일이 이미 없으면(ENOENT) 조용히 통과 — 멱등.
export async function deleteBannerImage(id: number): Promise<void> {
  try {
    await fs.unlink(path.join(bannerDir(), String(id)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
