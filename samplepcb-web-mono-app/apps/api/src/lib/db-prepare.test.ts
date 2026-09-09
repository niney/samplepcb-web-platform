import { describe, expect, it } from 'vitest';
import { prismaSchemaSignature } from './db-prepare';

describe('Prisma 클라이언트 자동 준비', () => {
  it('포맷과 주석만 바뀌었으면 같은 스키마로 판정한다', () => {
    expect(prismaSchemaSignature('model A {\n id  Int @id // 키\n}')).toBe(prismaSchemaSignature('model A { id Int @id }'));
  });
  it('필드와 문자열 기본값 변경은 다시 생성할 대상으로 판정한다', () => {
    expect(prismaSchemaSignature('value String @default("a  b")')).not.toBe(prismaSchemaSignature('value String @default("a b")'));
    expect(prismaSchemaSignature('id Int @id')).not.toBe(prismaSchemaSignature('id BigInt @id'));
  });
  it('문자열 안의 주석 기호는 제거하지 않는다', () => {
    expect(prismaSchemaSignature('url String @default("https://sample.test/a")')).toContain('"https://sample.test/a"');
  });
});
