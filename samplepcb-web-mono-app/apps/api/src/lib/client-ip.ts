import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

// 방문자 IP — 감사·증빙 기록용(개발의뢰 수락·검수 IP, NDA 서명, 카트 ct_ip, 삭제 감사).
//
// sp-node 는 nginx 뒤에서 127.0.0.1 로만 듣는다. 그래서 request.ip 는 언제나 프록시
// 주소(127.0.0.1)이고, 그대로 기록하면 모든 증빙이 같은 값이 된다. 로컬·운영의 모든
// nginx 설정은 X-Real-IP 에 실제 방문자 주소를 싣는다(Cloudflare 호스트는
// CF-Connecting-IP, 직결 호스트는 $remote_addr — ops/nginx*/ 참조).
//
// trustProxy(X-Forwarded-For) 를 쓰지 않는 이유: Cloudflare 호스트와 직결 호스트의 홉 수가
// 달라 한 설정으로 맞지 않고, XFF 왼쪽 값은 클라이언트가 위조할 수 있다.
//
// 헤더는 연결 상대가 로컬 프록시일 때만 믿는다 — HOST=0.0.0.0 으로 직접 노출된 배치에서
// 클라이언트가 X-Real-IP 를 지어 보내는 것을 막는다. PHP 서버사이드 호출처럼 헤더가 없는
// 로컬 연결은 종전대로 연결 주소를 돌려준다.
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function clientIp(request: FastifyRequest): string {
  const peer = request.ip;
  if (!LOOPBACK_PEERS.has(peer)) return peer;
  const header = request.headers['x-real-ip'];
  const value = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  return isIP(value) === 0 ? peer : value;
}
