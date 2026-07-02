import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { KNOWN_SPEC_KEYS, PcbProjectPayload } from '@sp/api-contract';
import type { PcbProjectPayloadType } from '@sp/api-contract';

// ── 검증 스텁 ──────────────────────────────────────────────────────────────
// POST /api/pcb-projects 의 "수신 계약 검증" 스텁. 거버 뷰어 어댑터(toProjectPayload)가
// 매핑표(.tmp/gerber-project-migration-prompt.md 3장)대로 보내는지 확인하는 용도로,
// 본 구현(가격 엔진·파일서버 업로드·sp_quote/sp_order_spec/g5 cart) 전에 계약을 확정한다.
// 수신 내용 전체를 덤프 파일로 남기고 고정 응답을 반환한다. 본 구현 시 이 파일을 대체.

interface ReceivedFile {
  field: string;
  filename: string;
  mimetype: string;
  bytes: number;
}

// 덤프 위치: 플랫폼 루트 .tmp/received (env PCB_DUMP_DIR 로 override).
// dev 실행 cwd = apps/api → ../../.. = samplepcb-web-platform.
const DUMP_DIR =
  process.env.PCB_DUMP_DIR ?? path.resolve(process.cwd(), '..', '..', '..', '.tmp', 'received');

// 리다이렉트 기준 도메인. 거버 뷰어(dev)와 sp-node 가 다른 오리진이므로 절대 URL 로 내려준다.
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

const findUnknownSpecKeys = (spec: PcbProjectPayloadType['spec']): string[] => {
  const known = new Set<string>(KNOWN_SPEC_KEYS);
  return Object.keys(spec).filter((key) => !known.has(key));
};

export const pcbProjectRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.post('/pcb-projects', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }

    const files: ReceivedFile[] = [];
    let rawPayload: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        files.push({
          field: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          bytes: buffer.byteLength,
        });
      } else if (part.fieldname === 'payload' && typeof part.value === 'string') {
        rawPayload = part.value;
      }
    }

    if (rawPayload === undefined) {
      return reply.badRequest('payload 파트가 없습니다');
    }

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
    }

    const parsed = PcbProjectPayload.safeParse(payloadJson);
    if (!parsed.success) {
      // 어떤 키가 계약 위반인지 그대로 돌려줘 거버 쪽에서 바로 확인 가능하게.
      return reply.status(400).send({
        result: false,
        error: 'PAYLOAD_SCHEMA_MISMATCH',
        issues: parsed.error.issues,
      });
    }

    const payload = parsed.data;
    const unknownSpecKeys = findUnknownSpecKeys(payload.spec);

    await mkdir(DUMP_DIR, { recursive: true });
    const dumpFile = path.join(
      DUMP_DIR,
      `pcb-project-${String(Date.now())}-${payload.category}.json`,
    );
    await writeFile(
      dumpFile,
      JSON.stringify({ receivedAt: new Date().toISOString(), payload, files, unknownSpecKeys }, null, 2),
      'utf-8',
    );
    request.log.info({ dumpFile, unknownSpecKeys, files }, 'pcb-project stub received');

    // 고정 응답 — 거버 쪽 redirectUrl 이동 동작까지 검증 가능하게 실제 형태로.
    return {
      result: true as const,
      data: {
        projectId: 0,
        quoteStatus: payload.flow === 'rfq' ? ('rfq' as const) : ('priced' as const),
        cartAdded: false,
        // 장바구니(견적용) 페이지가 아직 없어 임시로 홈으로. 페이지 생기면 flow 별 분기 복원:
        // order → /shop/cart.php · rfq → 내 PCB 프로젝트(추후 Vue 라우트)
        redirectUrl: `${WEB_BASE_URL}/`,
        stub: { dumpFile, unknownSpecKeys, files },
      },
    };
  });

  done();
};
