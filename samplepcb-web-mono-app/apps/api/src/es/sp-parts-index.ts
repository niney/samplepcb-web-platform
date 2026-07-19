import type { estypes } from '@elastic/elasticsearch';
import { esClient } from './client';

// sp-parts 인덱스 정의 — 검색 전용 요약 문서(오퍼 상세는 DB가 진실원본).
// 단위 지능은 ES 애널라이저가 아니라 @sp/utils spec-units(색인·검색 동일 파서)에 있다.
// 애널라이저는 기본만: lowercase·ngram·edge_ngram (설계: docs/PARTS_SEARCH.md).

export const SP_PARTS_INDEX = 'sp-parts-v1';
export const SP_PARTS_READ = 'sp-parts'; // 읽기 alias — 매핑 v2 전환 시 스왑
export const SP_PARTS_WRITE = 'sp-parts-write'; // 쓰기 alias

/** ES 문서 필드명 상수 — 쿼리 빌더가 문자열 오타 없이 참조. */
export const F = {
  partId: 'partId',
  mpn: 'mpn',
  mpnNorm: 'mpnNorm',
  mpnNormNgram: 'mpnNorm.ngram',
  mpnNormKeyword: 'mpnNorm.keyword',
  manufacturerName: 'manufacturerName',
  manufacturerNorm: 'manufacturerNorm',
  description: 'description',
  category: 'category',
  packageCode: 'packageCode',
  packageVariants: 'packageVariants',
  lifecycle: 'lifecycle',
  specVariants: 'specVariants',
  specVariantsPrefix: 'specVariants.prefix',
  suppliers: 'suppliers',
  offerCount: 'offerCount',
  minPrice: 'minPrice',
  totalStock: 'totalStock',
  updatedAt: 'updatedAt',
} as const;

/** 검색 요약 문서 — DB(SpPart)에서 빌드되고 언제든 재구축 가능(parts:reindex). */
export interface SpPartDoc {
  partId: string;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
  description: string | null;
  category: string | null;
  packageCode: string | null;
  packageVariants: string[];
  lifecycle: string | null;
  specVariants: string[];
  resistanceOhm?: number;
  capacitanceF?: number;
  inductanceH?: number;
  voltageV?: number;
  currentA?: number;
  powerW?: number;
  frequencyHz?: number;
  tolerancePct?: number;
  suppliers: string[];
  offerCount: number;
  minPrice: number | null;
  /** minPrice 가 나온 오퍼의 통화(KRW·USD…) — 표시용. */
  minPriceCurrency: string | null;
  totalStock: number;
  /** 오퍼 최신 fetchedAt — 데이터 나이 표시·정렬용. */
  offersFetchedAt: string | null;
  /** 공급사 간 스펙 실충돌 존재 여부(specConflicts) — 관리자 배지용. 구 색인 문서는 undefined. */
  hasSpecConflict: boolean | undefined;
  updatedAt: string;
}

const settings = {
  number_of_shards: 1,
  number_of_replicas: 0, // 단일 노드 클러스터(xpse 공유) — yellow 방지
  analysis: {
    normalizer: {
      lower_norm: { type: 'custom', filter: ['lowercase'] },
    },
    tokenizer: {
      mpn_ngram4: { type: 'ngram', min_gram: 4, max_gram: 4, token_chars: ['letter', 'digit'] },
      mpn_edge216: { type: 'edge_ngram', min_gram: 2, max_gram: 16, token_chars: ['letter', 'digit'] },
      variant_edge112: { type: 'edge_ngram', min_gram: 1, max_gram: 12 },
    },
    analyzer: {
      mpn_ngram: { type: 'custom', tokenizer: 'mpn_ngram4', filter: ['lowercase'] },
      mpn_edge: { type: 'custom', tokenizer: 'mpn_edge216', filter: ['lowercase'] },
      variant_edge: { type: 'custom', tokenizer: 'variant_edge112', filter: ['lowercase'] },
      keyword_lower: { type: 'custom', tokenizer: 'keyword', filter: ['lowercase'] },
    },
  },
} satisfies estypes.IndicesIndexSettings;

const mappings = {
  dynamic: false,
  properties: {
    partId: { type: 'keyword' },
    mpn: { type: 'keyword', normalizer: 'lower_norm' },
    // 프리픽스(edge) 본필드 + 인픽스(ngram)·정확(keyword) 서브필드.
    // ngram 검색은 쿼리도 동일 애널라이저 + operator AND(포함 의미) — Phase C 쿼리 빌더 참조.
    mpnNorm: {
      type: 'text',
      analyzer: 'mpn_edge',
      search_analyzer: 'keyword_lower',
      fields: {
        ngram: { type: 'text', analyzer: 'mpn_ngram' },
        keyword: { type: 'keyword' },
      },
    },
    manufacturerName: { type: 'keyword', fields: { norm: { type: 'keyword', normalizer: 'lower_norm' } } },
    manufacturerNorm: { type: 'keyword' },
    description: { type: 'text' },
    category: { type: 'keyword' },
    packageCode: { type: 'keyword' },
    packageVariants: { type: 'keyword' },
    lifecycle: { type: 'keyword' },
    // 관행 표기 변형(2n2·472·104…). prefix 서브필드가 "2p"→"2p2" 부분 입력을 커버.
    specVariants: {
      type: 'keyword',
      normalizer: 'lower_norm',
      fields: { prefix: { type: 'text', analyzer: 'variant_edge', search_analyzer: 'keyword_lower' } },
    },
    resistanceOhm: { type: 'double' },
    capacitanceF: { type: 'double' },
    inductanceH: { type: 'double' },
    voltageV: { type: 'double' },
    currentA: { type: 'double' },
    powerW: { type: 'double' },
    frequencyHz: { type: 'double' },
    tolerancePct: { type: 'double' },
    suppliers: { type: 'keyword' },
    offerCount: { type: 'integer' },
    minPrice: { type: 'double' },
    minPriceCurrency: { type: 'keyword' },
    offersFetchedAt: { type: 'date' },
    totalStock: { type: 'long' },
    hasSpecConflict: { type: 'boolean' },
    updatedAt: { type: 'date' },
  },
} satisfies estypes.MappingTypeMapping;

export interface MinimalLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** 기동 시 부트스트랩 — 없으면 생성+alias, 있으면 putMapping 으로 추가 필드 반영(xpse 방식).
 * 필드 추가는 non-breaking 이라 안전 — 기존 필드 타입 변경은 reindex(v2+스왑)로만. 실패해도 앱은 뜬다. */
export async function bootstrapPartsIndex(log: MinimalLogger): Promise<void> {
  try {
    const es = esClient();
    const exists = await es.indices.exists({ index: SP_PARTS_INDEX });
    if (!exists) {
      await es.indices.create({
        index: SP_PARTS_INDEX,
        settings,
        mappings,
        aliases: { [SP_PARTS_READ]: {}, [SP_PARTS_WRITE]: { is_write_index: true } },
      });
      log.info(`ES 인덱스 생성: ${SP_PARTS_INDEX} (alias: ${SP_PARTS_READ}/${SP_PARTS_WRITE})`);
    } else {
      await es.indices.putMapping({ index: SP_PARTS_INDEX, properties: mappings.properties });
    }
  } catch (error) {
    log.warn(`ES 부트스트랩 실패(검색 비활성 축퇴): ${String(error)}`);
  }
}

/** parts:reindex --recreate 전용 — v1 삭제 후 재생성. 운영 무중단 전환은 v2+alias 스왑으로. */
export async function recreatePartsIndex(log: MinimalLogger): Promise<void> {
  const es = esClient();
  const exists = await es.indices.exists({ index: SP_PARTS_INDEX });
  if (exists) {
    await es.indices.delete({ index: SP_PARTS_INDEX });
    log.info(`ES 인덱스 삭제: ${SP_PARTS_INDEX}`);
  }
  await bootstrapPartsIndex(log);
}
