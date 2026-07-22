import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { catalogRecoveryBackoffMs, catalogRecoveryErrorCode } from './bom-part-data';

describe('부품 정보 백그라운드 복구 정책', () => {
  it('재시도 간격을 5초부터 늘리되 1분으로 제한한다', () => {
    expect(catalogRecoveryBackoffMs(1)).toBe(5_000);
    expect(catalogRecoveryBackoffMs(2)).toBe(10_000);
    expect(catalogRecoveryBackoffMs(5)).toBe(60_000);
    expect(catalogRecoveryBackoffMs(20)).toBe(60_000);
  });

  it('Prisma 연결 종료 오류 코드를 운영 상태에 보존한다', () => {
    const error = new Prisma.PrismaClientKnownRequestError('Server has closed the connection.', {
      code: 'P1017',
      clientVersion: '6.19.3',
    });
    expect(catalogRecoveryErrorCode(error)).toBe('P1017');
  });

  it('검색 색인 지연을 별도 오류 코드로 분류한다', () => {
    expect(catalogRecoveryErrorCode(new Error('part search indexing deferred for 2 item(s)')))
      .toBe('SEARCH_INDEX_UNAVAILABLE');
  });
});
