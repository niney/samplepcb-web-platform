// 부품 카탈로그 인제스트 통합 검증 — 실 DB(sp_part*) + 실 ES(sp-parts) 대상.
// 명시적 옵트인(PARTS_IT=1 + .env 로드)일 때만 실행 — turbo test/CI 에서는 자동 skip.
// 실행(bash): cd apps/api && export DATABASE_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"')" \
//             && PARTS_IT=1 pnpm exec vitest run parts-ingest.int
import { afterAll, describe, expect, it } from 'vitest';
import { normalizeMpn, parseSpecToken, siRange } from '@sp/utils';
import { prisma } from './prisma';
import { esClient } from '../es/client';
import { SP_PARTS_READ, SP_PARTS_WRITE, bootstrapPartsIndex } from '../es/sp-parts-index';
import { ingestSupplierSearchResult } from './parts-ingest';

const RUN = process.env.PARTS_IT === '1';
const MPN = 'SPTEST-GRM155R71C104KA88D'; // 테스트 전용 접두 — afterAll 에서 제거

describe.skipIf(!RUN)('parts ingest (integration — 실 DB·ES)', () => {
  afterAll(async () => {
    const part = await prisma.spPart.findFirst({ where: { mpnNorm: normalizeMpn(MPN) } });
    if (part !== null) {
      await prisma.spPartIndexQueue.deleteMany({ where: { partId: part.id } });
      await prisma.spPart.delete({ where: { id: part.id } }); // offer·break 는 cascade
      try {
        await esClient().delete({ index: SP_PARTS_WRITE, id: String(part.id) });
      } catch {
        // 문서 없으면 무시
      }
    }
    await prisma.$disconnect();
  });

  it('합성 envelope → DB upsert + ES 색인 → Track A/B 검색 히트', async () => {
    await bootstrapPartsIndex({ info: () => undefined, warn: () => undefined });

    const envelope = {
      search: {
        components: [
          {
            candidates: [
              {
                product: {
                  supplier: 'mouser',
                  manufacturer_part_number: MPN,
                  manufacturer: 'Murata Electronics',
                  description: 'CAP CER 0.1UF 16V X7R 0402',
                  category: 'Ceramic Capacitors',
                  package: '0402',
                  lifecycle_status: 'Active',
                  normalized_specs: {
                    capacitance_f: 1e-7,
                    voltage_v: 16,
                    tolerance_percent: 10,
                    package: '0402',
                    dielectric: 'X7R',
                  },
                  offers: [
                    {
                      supplier: 'mouser',
                      supplier_sku: '81-SPTEST',
                      stock: 1000,
                      moq: 1,
                      price_breaks: [{ quantity: 1, unit_price: 0.0123, currency: 'USD' }],
                      fetched_at: new Date().toISOString(),
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    // 인제스트(1회) + idempotency(2회째도 동일 상태)
    const stats = await ingestSupplierSearchResult(envelope);
    expect(stats).toMatchObject({ parts: 1, offers: 1, indexed: 1, queued: 0 });
    const stats2 = await ingestSupplierSearchResult(envelope);
    expect(stats2).toMatchObject({ parts: 1, offers: 1, indexed: 1 });

    const part = await prisma.spPart.findFirst({
      where: { mpnNorm: normalizeMpn(MPN) },
      include: { offers: { include: { priceBreaks: true } } },
    });
    expect(part).not.toBeNull();
    if (part === null) return;
    expect(part.manufacturerNorm).toBe('murata'); // 별칭 해소(Electronics 접미 제거)
    expect(part.offers).toHaveLength(1);
    expect(part.offers[0]?.priceBreaks).toHaveLength(1);

    await esClient().indices.refresh({ index: SP_PARTS_READ });

    // Track A: "104K" 표기 → SI 정준(100nF) range 히트
    const cap = parseSpecToken('104K').find((s) => s.kind === 'capacitance' && s.confidence === 'high');
    expect(cap).toBeDefined();
    if (cap === undefined) return;
    const trackA = await esClient().search({
      index: SP_PARTS_READ,
      query: {
        bool: {
          must: [{ range: { capacitanceF: siRange(cap.si) } }],
          filter: [{ term: { manufacturerNorm: 'murata' } }, { term: { 'mpnNorm.keyword': normalizeMpn(MPN) } }],
        },
      },
    });
    expect(trackA.hits.hits).toHaveLength(1);

    // Track B: 관행 표기 variants — "104"(EIA)·"0.1uf"·패키지 양코드(0402/1005)
    const trackB = await esClient().search({
      index: SP_PARTS_READ,
      query: {
        bool: {
          must: [{ term: { specVariants: '104' } }],
          filter: [
            { term: { specVariants: '0.1uf' } },
            { terms: { packageVariants: ['1005'] } }, // 메트릭 코드로도 히트
            { term: { 'mpnNorm.keyword': normalizeMpn(MPN) } },
          ],
        },
      },
    });
    expect(trackB.hits.hits).toHaveLength(1);
  });
});
