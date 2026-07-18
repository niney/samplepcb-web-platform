import { Client } from '@elastic/elasticsearch';

// Elasticsearch 접속 — 로컬은 xpse 와 공유하는 단일 노드(127.0.0.1:9200, security off).
// 이 클러스터의 기존 인덱스(pcbparts 등)는 절대 건드리지 않는다 — 신규는 sp- prefix 만.
const ES_NODE_URL = process.env.ES_NODE_URL ?? 'http://127.0.0.1:9200';

let client: Client | null = null;

export function esClient(): Client {
  client ??= new Client({ node: ES_NODE_URL, requestTimeout: 10_000 });
  return client;
}

/** ES 생존 확인 — 다운이어도 앱은 뜨고, 검색만 503·색인은 큐 적재로 축퇴한다. */
export async function esAvailable(): Promise<boolean> {
  try {
    await esClient().ping();
    return true;
  } catch {
    return false;
  }
}
