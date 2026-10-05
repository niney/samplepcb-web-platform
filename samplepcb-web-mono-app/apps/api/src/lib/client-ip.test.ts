import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const request = (ip: string, realIp?: string | string[]): FastifyRequest =>
  ({ ip, headers: realIp === undefined ? {} : { 'x-real-ip': realIp } }) as unknown as FastifyRequest;

describe('clientIp', () => {
  it('로컬 프록시 연결이면 X-Real-IP 를 쓴다', () => {
    expect(clientIp(request('127.0.0.1', '203.0.113.7'))).toBe('203.0.113.7');
    expect(clientIp(request('::1', '2001:db8::1'))).toBe('2001:db8::1');
    expect(clientIp(request('::ffff:127.0.0.1', ' 203.0.113.7 '))).toBe('203.0.113.7');
  });

  it('헤더가 없거나 IP 가 아니면 연결 주소로 돌아간다', () => {
    expect(clientIp(request('127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(request('127.0.0.1', ''))).toBe('127.0.0.1');
    expect(clientIp(request('127.0.0.1', 'not-an-ip'))).toBe('127.0.0.1');
    expect(clientIp(request('127.0.0.1', '203.0.113.7, 10.0.0.1'))).toBe('127.0.0.1');
  });

  it('직접 연결(프록시 아님)은 헤더를 믿지 않는다', () => {
    expect(clientIp(request('198.51.100.9', '203.0.113.7'))).toBe('198.51.100.9');
  });

  it('헤더가 여러 번 오면 첫 값을 쓴다', () => {
    expect(clientIp(request('127.0.0.1', ['203.0.113.7', '10.0.0.1']))).toBe('203.0.113.7');
  });
});
